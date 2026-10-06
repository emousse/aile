import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, ChevronDown, Compass, Globe2, LoaderCircle, MessageCircle, ScanText, Search, Type, X } from 'lucide-react';
import { type AppConfig, type Envelope, type Explanation, type SearchResponse, blockText } from '../shared/types';
import { api } from './api';
import Reader from './Reader';
import './style.css';

type View = { type: 'home' } | { type: 'results'; query: string; data: SearchResponse } | { type: 'page'; envelope: Envelope };
type Entry = { view: View; scroll: number };
type Panel = 'understand' | 'explore' | 'examine' | null;
const fallbackConfig: AppConfig = { aiEnabled: false, searchProvider: 'wikipedia', restrictedHosts: [] };
const isAddress = (text: string) => /^[a-z][a-z\d+.-]*:\/\//i.test(text) || /^[^\s/]+\.[^\s/]{2,}(\/|$)/.test(text);
const domain = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

export default function App() {
  const [config, setConfig] = useState<AppConfig>(fallbackConfig);
  const [view, setView] = useState<View>({ type: 'home' });
  const entries = useRef<Entry[]>([{ view: { type: 'home' }, scroll: 0 }]);
  const position = useRef(0);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [selection, setSelection] = useState<{ blockId: string; quote: string } | null>(null);
  const [answer, setAnswer] = useState<Explanation | null>(null);
  const [answerError, setAnswerError] = useState('');
  const [answerBusy, setAnswerBusy] = useState(false);
  const [textSize, setTextSize] = useState(0);
  const navigationRequest = useRef<AbortController | null>(null);
  const explanationRequest = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const activePageId = useRef<string | null>(null);
  const doc = view.type === 'page' ? view.envelope.document : null;

  function clearInteraction() {
    explanationRequest.current?.abort(); setAnswerBusy(false); setPanel(null); setSelection(null); setAnswer(null); setAnswerError('');
  }
  useEffect(() => {
    const controller = new AbortController();
    void api<AppConfig>('config', undefined, controller.signal).then(setConfig).catch(() => {});
    window.history.replaceState({ aile: 0 }, '', window.location.pathname);
    function onPop(event: PopStateEvent) {
      const next = event.state?.aile as number | undefined;
      if (next === undefined || !entries.current[next]) return;
      navigationRequest.current?.abort(); setBusy(null); setError(''); clearInteraction();
      entries.current[position.current]!.scroll = window.scrollY;
      position.current = next;
      const entry = entries.current[next]!; setView(entry.view);
      requestAnimationFrame(() => window.scrollTo({ top: entry.scroll }));
    }
    window.addEventListener('popstate', onPop);
    return () => { controller.abort(); window.removeEventListener('popstate', onPop); navigationRequest.current?.abort(); explanationRequest.current?.abort(); };
  }, []);
  useEffect(() => {
    activePageId.current = doc?.id ?? null;
    document.title = doc ? `${doc.title} — Aile` : 'Aile — Le Web, à ton rythme';
    if (view.type === 'page') setQuery(view.envelope.document.url);
    else if (view.type === 'results') setQuery(view.query);
    else setQuery('');
  }, [view, doc]);

  function navigate(next: View) {
    entries.current[position.current]!.scroll = window.scrollY;
    entries.current = entries.current.slice(0, position.current + 1);
    entries.current.push({ view: next, scroll: 0 });
    position.current++;
    window.history.pushState({ aile: position.current }, '', '/');
    clearInteraction(); setView(next); setError('');
    requestAnimationFrame(() => { window.scrollTo({ top: 0 }); headingRef.current?.focus({ preventScroll: true }); });
  }
  async function openPage(url: string) {
    if (doc) {
      try {
        const destination = new URL(url);
        const hash = destination.hash; destination.hash = '';
        if (hash && destination.href === doc.url) {
          const anchor = doc.anchors?.[decodeURIComponent(hash.slice(1))];
          if (anchor) returnToPassage(anchor);
          else { setPanel('examine'); setError('Ce repère n’a pas été restitué. Tu peux consulter la source originale dans Examiner.'); }
          return;
        }
      } catch { /* The API validates malformed addresses. */ }
    }
    navigationRequest.current?.abort();
    const controller = new AbortController(); navigationRequest.current = controller;
    setBusy('Préparation de la page…'); setError('');
    try {
      const envelope = await api<Envelope>('page', { url }, controller.signal);
      if (!controller.signal.aborted) navigate({ type: 'page', envelope });
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Page indisponible.'); }
    finally { if (!controller.signal.aborted) setBusy(null); }
  }
  async function search(event: FormEvent) {
    event.preventDefault(); const input = query.trim(); if (!input) return;
    if (isAddress(input)) { await openPage(input); return; }
    navigationRequest.current?.abort();
    const controller = new AbortController(); navigationRequest.current = controller;
    setBusy('Recherche en cours…'); setError('');
    try {
      const data = await api<SearchResponse>('search', { query: input }, controller.signal);
      if (!controller.signal.aborted) navigate({ type: 'results', query: input, data });
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Recherche indisponible.'); }
    finally { if (!controller.signal.aborted) setBusy(null); }
  }
  async function explain(blockId: string, quote: string) {
    if (view.type !== 'page') return;
    explanationRequest.current?.abort();
    const controller = new AbortController(); explanationRequest.current = controller;
    const pageId = view.envelope.document.id;
    setPanel('understand'); setSelection({ blockId, quote }); setAnswer(null); setAnswerError(''); setAnswerBusy(true);
    try {
      const result = await api<Explanation>('explain', { ...view.envelope, blockId, quote }, controller.signal);
      if (!controller.signal.aborted && activePageId.current === pageId) setAnswer(result);
    } catch (err) { if (!controller.signal.aborted) setAnswerError(err instanceof Error ? err.message : 'Explication indisponible.'); }
    finally { if (!controller.signal.aborted) setAnswerBusy(false); }
  }
  function captureSelection() {
    if (!doc) return;
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !selected.rangeCount) return;
    const quote = selected.toString().trim(); if (quote.length < 2 || quote.length > 1200) return;
    const range = selected.getRangeAt(0);
    const element = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer as Element : range.commonAncestorContainer.parentElement;
    const blockId = element?.closest('[data-source-block]')?.getAttribute('data-source-block');
    const block = doc.blocks.find(item => item.id === blockId);
    if (block && blockText(block).includes(quote)) {
      explanationRequest.current?.abort(); setAnswerBusy(false);
      setSelection({ blockId: block.id, quote }); setAnswer(null); setAnswerError('');
    }
  }
  function returnToPassage(id: string) {
    setPanel(null);
    requestAnimationFrame(() => { const block = document.getElementById(id); block?.scrollIntoView({ block: 'center', behavior: 'instant' }); block?.focus({ preventScroll: true }); });
  }
  const togglePanel = (next: Panel) => setPanel(current => current === next ? null : next);
  const form = (compact = false) => <form className={`search-form ${compact ? 'compact' : ''}`} onSubmit={search} role="search">
    <label className="sr-only" htmlFor="address">Une recherche ou une adresse Web</label>
    <Search size={21} className="search-icon" aria-hidden="true" />
    <input id="address" name="address" type="text" value={query} onChange={event => setQuery(event.target.value)} placeholder={compact ? 'Rechercher ou ouvrir une page' : 'Une question, un sujet, une adresse…'} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={2048} enterKeyHint="go" />
    <button type="submit" aria-label="Explorer" disabled={!!busy || !query.trim()}>{busy ? <LoaderCircle size={20} className="spin" aria-hidden="true" /> : <ArrowRight size={21} aria-hidden="true" />}{!compact && <span>Explorer</span>}</button>
  </form>;

  return <div className={`app ${view.type === 'home' ? 'is-home' : ''} ${panel ? 'panel-open' : ''} text-size-${textSize}`}>
    <a className="skip-link" href="#main">Aller au contenu</a>
    <header className="topbar">
      <div className="brand-group">{view.type !== 'home' && <button className="icon-button back-button" type="button" aria-label="Page précédente" onClick={() => window.history.back()}><ArrowLeft size={20} /></button>}
        <button className="brand" type="button" aria-label="Aile, accueil" onClick={() => { navigationRequest.current?.abort(); setBusy(null); navigate({ type: 'home' }); }}><span className="brand-symbol" aria-hidden="true">a<span>·</span></span>aile<span className="brand-dot">.</span></button>
      </div>
      {view.type === 'home' ? <span className="pilot-label"><span aria-hidden="true" /> Atelier pilote</span> : <div className="header-tools">{doc && <button type="button" className="icon-button" aria-label="Augmenter la taille du texte" onClick={() => setTextSize(n => (n + 1) % 3)}><Type size={20} /></button>}<span className="quiet-label">À ton rythme</span></div>}
    </header>

    <main id="main" ref={mainRef} tabIndex={-1} onPointerUp={captureSelection} onKeyUp={captureSelection}>
      {view.type === 'home' ? <div className="home-layout">
        <div className="home-main">
          <p className="eyebrow"><span className="small-star" aria-hidden="true">✳</span> LA CURIOSITÉ T’APPARTIENT</p>
          <h1 ref={headingRef} tabIndex={-1}>Le Web,<br /><span>à ton rythme.</span></h1>
          <p className="home-intro">Une page à découvrir. Un passage à comprendre.<br className="desktop-break" /> Et la liberté de choisir la suite.</p>
          {form()}
          <p className="search-hint">{config.searchProvider === 'wikipedia' ? 'Recherche sur Wikipédia' : 'Recherche Web'}<span aria-hidden="true"> · </span>ou ouvre directement l’adresse d’un site.</p>
          {config.restrictedHosts.length > 0 && <p className="pilot-note">Cet essai est limité aux domaines autorisés par l’adulte.</p>}
        </div>
        <div className="curiosity-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-page page-back" /><div className="art-page page-front"><span className="art-label">ET SI…</span><div className="art-line long" /><div className="art-line" /><div className="art-graphic"><div className="art-circle" /><div className="art-grid" /></div><div className="art-line long" /><div className="art-line short" /></div><span className="art-asterisk">✳</span><div className="art-note">suivre sa curiosité <ArrowUpRight size={19} /></div></div>
        <div className="home-principles"><div><BookOpen size={22} /><h2>Lire, simplement.</h2><p>Le contenu principal prend sa place.</p></div><div><MessageCircle size={22} /><h2>Comprendre un peu plus.</h2><p>Une aide quand tu en as besoin.</p></div><div><Compass size={22} /><h2>Choisir la suite.</h2><p>Des liens à explorer, sans défilement infini.</p></div></div>
        <footer className="home-footer"><span>Un Web à explorer, pas un fil à suivre.</span><span>Version d’essai · avec un adulte{!config.aiEnabled && ' · IA inactive'}</span></footer>
      </div> : <>
        <div className="browser-address">{form(true)}</div>
        {view.type === 'results' && <div className="results-layout"><p className="eyebrow">À TOI DE CHOISIR</p><h1 ref={headingRef} tabIndex={-1}>{view.query}</h1><p className="results-description">{view.data.results.length} résultat{view.data.results.length > 1 ? 's' : ''} · {view.data.provider === 'wikipedia' ? 'Recherche limitée à Wikipédia pour cet essai.' : 'Recherche Web · filtrage strict demandé au fournisseur.'}</p><div className="search-results">{view.data.results.map(result => <a key={result.url} href={result.url} onClick={event => { event.preventDefault(); void openPage(result.url); }} className="result-link"><div><span className="result-domain"><Globe2 size={14} />{domain(result.url)}</span><h2>{result.title}</h2><p>{result.description}</p></div><ArrowUpRight size={21} aria-hidden="true" /></a>)}</div>{!view.data.results.length && <p>Aucun résultat pour ces mots. Essaie un autre sujet ou une adresse de site.</p>}<p className="finite-note">C’est la fin des résultats. Tu peux préciser ta recherche.</p></div>}
        {doc && <article className="reader-layout">
          <div className="page-meta"><span className="source-domain"><Globe2 size={14} />{domain(doc.url)}</span><button type="button" onClick={() => togglePanel('examine')} className="text-button">À propos de cette page <ArrowUpRight size={14} /></button></div>
          <h1 ref={headingRef} tabIndex={-1}>{doc.title}</h1>
          <p className="byline">{doc.byline || 'Auteur non trouvé'}<span aria-hidden="true"> · </span>{doc.date && !Number.isNaN(Date.parse(doc.date)) ? new Date(doc.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date non trouvée'}</p>
          <div className="reading-note"><BookOpen size={16} aria-hidden="true" /><span>Texte extrait conservé · présentation simplifiée</span></div>
          {doc.ai.status === 'ready' && doc.ai.landmarks.length > 0 && <nav className="landmarks" aria-label="Repères proposés par l’IA"><span>Repères IA</span>{doc.ai.landmarks.map(mark => <button key={mark.blockId} type="button" onClick={() => returnToPassage(mark.blockId)}>{mark.label}<ArrowRight size={13} /></button>)}</nav>}
          {doc.ai.status !== 'ready' && <p className="ai-status">{doc.ai.status === 'off' ? 'IA inactive pour cet essai. Lecture et liens disponibles.' : 'Repères IA indisponibles. Le contenu extrait reste lisible.'}</p>}
          <Reader document={doc} onNavigate={url => void openPage(url)} onExplain={(id, quote) => void explain(id, quote)} selectedId={selection?.blockId} />
        </article>}
      </>}
      {(busy || error) && <div className={`status-notice ${error ? 'error-notice' : ''}`}>{busy && <p role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" />{busy}</p>}{error && <p role="alert">{error}</p>}<button type="button" className="icon-button" aria-label={busy ? 'Annuler le chargement' : 'Fermer le message'} onClick={() => { navigationRequest.current?.abort(); setBusy(null); setError(''); }}><X size={18} /></button></div>}
    </main>

    {doc && <aside className="interaction-dock" aria-label="Outils de lecture">
      {panel && <div className="dock-content" id="interaction-panel" role="region" aria-label={panel === 'understand' ? 'Comprendre' : panel === 'explore' ? 'Explorer' : 'Examiner'}>
        <div className="panel-header"><h2>{panel === 'understand' ? 'Un peu plus clair.' : panel === 'explore' ? 'Où veux-tu aller ?' : 'Regarder de plus près.'}</h2><button type="button" className="icon-button" aria-label="Replier le panneau" onClick={() => setPanel(null)}><ChevronDown size={22} /></button></div>
        {panel === 'understand' && <div className="understand-panel">
          {!selection ? <p>Sélectionne quelques mots dans la page, ou touche la bulle à côté d’un paragraphe.</p> : <>
            <div className="selected-quote"><span className="eyebrow">PASSAGE SOURCE</span><blockquote>{selection.quote}</blockquote></div>
            {!answer && !answerBusy && !answerError && <button className="primary-button" type="button" onClick={() => void explain(selection.blockId, selection.quote)}>Expliquer ce passage <ArrowRight size={16} /></button>}
            {answerBusy && <p className="answer-loading" role="status"><LoaderCircle size={17} className="spin" />Préparation de l’explication…</p>}
            {answerError && <p role="alert" className="inline-error">{answerError}</p>}
            {answer && <div className="answer"><span className="ai-badge">Explication IA</span><p>{answer.explanation}</p>{answer.caveat && <p className="answer-caveat">{answer.caveat}</p>}<button className="text-button" type="button" onClick={() => returnToPassage(answer.source.blockId)}>Revenir au passage <ArrowUpRight size={16} /></button></div>}
          </>}
        </div>}
        {panel === 'explore' && <><p className="panel-description">Liens présents dans cette page</p><div className="explore-links">{doc.links.filter(link => link.url !== doc.url).slice(0, 3).map(link => <a href={link.url} key={link.id} onClick={event => { event.preventDefault(); void openPage(link.url); }}><span><strong>{link.label}</strong><small>{domain(link.url)} · cité dans la page</small></span><ArrowUpRight size={19} aria-hidden="true" /></a>)}</div>{doc.links.filter(link => link.url !== doc.url).length === 0 && <p>Aucun lien vers une autre page n’a été trouvé. Tu peux lancer une recherche en haut.</p>}<p className="panel-footnote">Ces liens viennent de la source. Leur contenu n’a pas été vérifié.</p></>}
        {panel === 'examine' && <><dl className="source-details"><div><dt>Site</dt><dd>{doc.siteName}</dd></div><div><dt>Auteur</dt><dd>{doc.byline || 'Non trouvé dans la page'}</dd></div><div><dt>Date indiquée</dt><dd>{doc.date || 'Non trouvée dans la page'}</dd></div><div><dt>Liens repérés</dt><dd>{doc.links.length} · leur présence n’est pas une preuve</dd></div><div><dt>Publicité</dt><dd>Non évaluée dans cette version</dd></div><div><dt>Licence déclarée</dt><dd>{doc.licenseUrl ? <a href={doc.licenseUrl} target="_blank" rel="noopener noreferrer">Consulter la licence (site externe)</a> : 'Non trouvée · droits à vérifier'}</dd></div></dl>{doc.notices.map((notice, i) => <p className="panel-footnote" key={i}>{notice}</p>)}<p className="source-url">Adresse source : {doc.url}</p><a className="text-button" href={doc.url} target="_blank" rel="noopener noreferrer">Ouvrir l’original hors d’Aile <ArrowUpRight size={15} /></a><p className="panel-footnote">Une présentation lisible ne garantit pas une information juste. Aucun score de fiabilité n’est attribué.</p></>}
      </div>}
      {!panel && selection && <button className="selection-action" type="button" onClick={() => void explain(selection.blockId, selection.quote)}><MessageCircle size={16} />Expliquer la sélection<ArrowUpRight size={16} /></button>}
      <div className="dock-tabs"><button type="button" aria-label="Comprendre un passage" aria-expanded={panel === 'understand'} aria-controls="interaction-panel" onClick={() => togglePanel('understand')} className={panel === 'understand' ? 'active' : ''}><MessageCircle size={20} /><span>Comprendre</span></button><button type="button" aria-label="Explorer la suite" aria-expanded={panel === 'explore'} aria-controls="interaction-panel" onClick={() => togglePanel('explore')} className={panel === 'explore' ? 'active' : ''}><Compass size={20} /><span>Explorer</span></button><button type="button" aria-label="Examiner la page" aria-expanded={panel === 'examine'} aria-controls="interaction-panel" onClick={() => togglePanel('examine')} className={panel === 'examine' ? 'active' : ''}><ScanText size={20} /><span>Examiner</span></button></div>
    </aside>}
  </div>;
}
