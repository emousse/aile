import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { type Block, type Inline, type PageDocument, blockText } from '../shared/types';
import { normalizeUrl } from './network';
import { AppError } from './errors';

const clean = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim() ?? '';
export function extractArticle(html: string, url: string): PageDocument {
  // No runScripts or resources option: source scripts and subresources never execute/load.
  const dom = new JSDOM(html, { url });
  const source = dom.window.document;
  const meta = (selector: string) => clean(source.querySelector(selector)?.getAttribute('content')) || null;
  const date = meta('meta[property="article:published_time"]') ?? (clean(source.querySelector('time[datetime]')?.getAttribute('datetime')) || null);
  const byline = meta('meta[name="author"]');
  const lang = source.documentElement.lang || 'fr';
  let licenseUrl: string | null = null;
  const declaredLicense = source.querySelector('[rel~="license"]')?.getAttribute('href');
  if (declaredLicense) { try { licenseUrl = normalizeUrl(new URL(declaredLicense, url).href).href; } catch { /* Invalid metadata is omitted. */ } }
  source.querySelectorAll('script, style, iframe, form, input, button, video, audio, noscript, svg, canvas, [hidden], [aria-hidden="true"], .mw-editsection').forEach(el => el.remove());
  const parsed = new Readability(source, { charThreshold: 120, keepClasses: false }).parse();
  if (!parsed?.content || (parsed.textContent?.trim().length ?? 0) < 100) { dom.window.close(); throw new AppError('NO_ARTICLE', 'Le contenu principal de cette page n’a pas pu être isolé. Essaie une page documentaire.', 422); }
  const body = new JSDOM(parsed.content, { url });
  const blocks: Block[] = []; const links = new Map<string, { id: string; label: string; url: string }>();
  const anchors: Record<string, string> = Object.create(null) as Record<string, string>;
  const safeLink = (href: string | null): string | undefined => {
    if (!href) return undefined;
    try { const destination = new URL(href, url); const safe = normalizeUrl(destination.href); safe.hash = destination.hash; return safe.href; } catch { return undefined; }
  };
  function inline(node: Node, inherited: Pick<Inline, 'href' | 'emphasis'> = {}): Inline[] {
    if (node.nodeType === 3) return [{ text: (node.textContent ?? '').replace(/\s+/g, ' '), ...inherited }];
    if (node.nodeType !== 1) return [];
    const el = node as Element;
    if (['SCRIPT','STYLE','IFRAME','FORM','INPUT'].includes(el.tagName)) return [];
    const next = { ...inherited };
    if (el.tagName === 'A') {
      const href = safeLink(el.getAttribute('href'));
      if (href) { next.href = href; const label = clean(el.textContent); if (label && links.size < 100 && !links.has(href)) links.set(href, { id: `l-${links.size}`, label: label.slice(0, 180), url: href }); }
    }
    if (el.tagName === 'STRONG' || el.tagName === 'B') next.emphasis = 'strong';
    if (el.tagName === 'EM' || el.tagName === 'I') next.emphasis = 'em';
    if (el.tagName === 'BR') return [{ text: '\n' }];
    return Array.from(el.childNodes).flatMap(child => inline(child, next));
  }
  const id = () => `b-${blocks.length}`;
  function registerAnchors(node: Element, target: string) {
    for (const element of [node, ...Array.from(node.querySelectorAll('[id]'))]) if (element.id && !Object.hasOwn(anchors, element.id)) anchors[element.id] = target;
  }
  function walk(node: Element) {
    const before = blocks.length;
    walkElement(node);
    if (blocks.length > before) registerAnchors(node, blocks[before]!.id);
  }
  function walkElement(node: Element) {
    const tag = node.tagName;
    if (/^H[1-6]$/.test(tag)) {
      if (tag === 'H1' && clean(node.textContent) === clean(parsed!.title)) return;
      blocks.push({ id: id(), type: 'heading', level: Math.min(4, Math.max(2, Number(tag[1]))), content: inline(node) }); return;
    }
    if (tag === 'TABLE') {
      blocks.push({ id: id(), type: 'table', caption: clean(node.querySelector('caption')?.textContent), rows: Array.from(node.querySelectorAll('tr')).map(row => Array.from(row.children).filter(cell => ['TH','TD'].includes(cell.tagName)).map(cell => ({ header: cell.tagName === 'TH', content: inline(cell) }))) }); return;
    }
    if (tag === 'UL' || tag === 'OL') {
      const blockId = id();
      const items = Array.from(node.children).filter(el => el.tagName === 'LI').map((el, index) => { registerAnchors(el, `${blockId}-item-${index}`); return inline(el); });
      blocks.push({ id: blockId, type: 'list', ordered: tag === 'OL', items }); return;
    }
    if (tag === 'IMG') {
      const src = safeLink(node.getAttribute('src') || node.getAttribute('data-src'));
      if (src) blocks.push({ id: id(), type: 'image', src, alt: clean(node.getAttribute('alt')), caption: clean(node.closest('figure')?.querySelector('figcaption')?.textContent) });
      return;
    }
    if (tag === 'FIGCAPTION' || ['SCRIPT','STYLE','IFRAME'].includes(tag)) return;
    if (['P', 'BLOCKQUOTE', 'PRE'].includes(tag) && clean(node.textContent)) {
      blocks.push({ id: id(), type: tag === 'BLOCKQUOTE' ? 'quote' : 'paragraph', content: inline(node) });
      node.querySelectorAll('img').forEach(walk); return;
    }
    // Preserve direct text in article containers, including pages with no paragraph tags.
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 1) walk(child as Element);
      else if (child.nodeType === 3 && clean(child.textContent)) blocks.push({ id: id(), type: 'paragraph', content: [{ text: clean(child.textContent) }] });
    }
  }
  walk(body.window.document.body);
  dom.window.close(); body.window.close();
  if (!blocks.length) throw new AppError('NO_ARTICLE', 'Cette page ne contient pas de texte lisible.', 422);
  if (blocks.length > 350 || blocks.reduce((n, b) => n + blockText(b).length, 0) > 100_000) throw new AppError('ARTICLE_TOO_LONG', 'Cette page dépasse la taille prise en charge par cette version.', 422);
  return {
    id: createHash('sha256').update(url + JSON.stringify(blocks)).digest('hex').slice(0, 24), url,
    title: clean(parsed.title) || new URL(url).hostname, siteName: clean(parsed.siteName) || new URL(url).hostname,
    byline: byline || clean(parsed.byline) || null, date, lang, fetchedAt: new Date().toISOString(), blocks, links: [...links.values()],
    notices: ['Présentation simplifiée : les scripts, formulaires et contenus interactifs ne sont pas restitués. Le texte extrait est conservé ; l’extraction peut omettre des éléments.'],
    ai: { status: 'off', landmarks: [] }, anchors, licenseUrl,
  };
}
