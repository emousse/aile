import { describe, expect, it } from 'vitest';
import { extractArticle } from '../server/extraction';
import { articleHtml } from './fixtures';

describe('restitution fidèle en blocs', () => {
  it('conserve texte, liens absolus, légendes, listes et tableaux sans HTML exécutable', () => {
    const doc = extractArticle(articleHtml, 'https://example.com/science');
    expect(doc.title).toBe('Les couleurs du poulpe');
    expect(doc.byline).toBe('Camille Exemple');
    expect(doc.date).toBe('2026-01-12');
    const serialized = JSON.stringify(doc.blocks);
    expect(serialized).toContain('chromatophores');
    expect(serialized).toContain('Une légende à conserver.');
    expect(serialized).toContain('https://example.com/animaux');
    expect(doc.blocks.some(b => b.type === 'table')).toBe(true);
    expect(doc.blocks.some(b => b.type === 'list')).toBe(true);
    expect(serialized).not.toMatch(/javascript:|PWNED|tracker.org|127.0.0.1|<script|<iframe/);
    expect(new Set(doc.blocks.map(b => b.id)).size).toBe(doc.blocks.length);
  });
  it('refuse une page sans contenu principal au lieu d’inventer un article', () => {
    expect(() => extractArticle('<html><body><script>load()</script></body></html>', 'https://example.com')).toThrow();
  });
  it('préserve les ancres de référence et les titres entourés de contrôles d’édition', () => {
    const html = articleHtml.replace('<h2>Observer et comparer</h2>', '<div class="mw-heading"><h2 id="observer">Observer et comparer</h2><span class="mw-editsection"><a href="/edit">modifier le code de la section</a></span></div>').replace('<p>Le poulpe', '<p id="intro">Le poulpe').replace('Ces cellules contiennent', '<a href="#observer">Lire la suite</a>. Ces cellules contiennent');
    const doc = extractArticle(html, 'https://example.com/science');
    expect(doc.blocks.some(b => b.type === 'heading' && b.content.some(p => p.text.includes('Observer')))).toBe(true);
    expect(JSON.stringify(doc.blocks)).toContain('https://example.com/science#observer');
    expect(doc.anchors?.observer).toBeTruthy();
    expect(JSON.stringify(doc.blocks)).not.toContain('modifier le code');
  });
  it('conserve le lien de licence déclaré, sans inventer de droits', () => {
    const doc = extractArticle(articleHtml.replace('</head>', '<link rel="license" href="https://creativecommons.org/licenses/by-sa/4.0/"></head>'), 'https://example.com/science');
    expect(doc.licenseUrl).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
  });
});
