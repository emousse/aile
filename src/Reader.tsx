import { useState, type MouseEvent, type ReactNode } from 'react';
import { MessageCircle } from 'lucide-react';
import { type Block, type Inline, type PageDocument, blockText } from '../shared/types';

type Props = { document: PageDocument; onNavigate: (url: string) => void; onExplain: (blockId: string, quote: string) => void; selectedId?: string };
function InlineText({ content, navigate }: { content: Inline[]; navigate: (url: string) => void }) {
  return content.map((part, i) => {
    let child: ReactNode = part.text;
    if (part.emphasis === 'strong') child = <strong>{child}</strong>;
    if (part.emphasis === 'em') child = <em>{child}</em>;
    if (part.href) return <a key={i} href={part.href} onClick={event => { event.preventDefault(); navigate(part.href!); }}>{child}</a>;
    return <span key={i}>{child}</span>;
  });
}
function ArticleImage({ block }: { block: Extract<Block, { type: 'image' }> }) {
  const [failed, setFailed] = useState(false);
  return <figure className="article-image">
    {failed ? <div className="image-unavailable">Image indisponible{block.alt ? ` : ${block.alt}` : ''}</div> : <img src={block.src} alt={block.alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
    {block.caption && <figcaption>{block.caption}</figcaption>}
  </figure>;
}
export default function Reader({ document: doc, onNavigate, onExplain, selectedId }: Props) {
  let passage = 0;
  const inline = (content: Inline[]) => <InlineText content={content} navigate={onNavigate} />;
  return <div className="article-body" lang={doc.lang}>
    {doc.blocks.map(block => {
      let content: ReactNode;
      switch (block.type) {
        case 'paragraph': content = <p>{inline(block.content)}</p>; break;
        case 'quote': content = <blockquote>{inline(block.content)}</blockquote>; break;
        case 'heading': {
          const Heading = `h${block.level}` as 'h2' | 'h3' | 'h4';
          content = <Heading>{inline(block.content)}</Heading>; break;
        }
        case 'image': content = <ArticleImage block={block} />; break;
        case 'list': {
          const List = block.ordered ? 'ol' : 'ul';
          content = <List>{block.items.map((item, i) => <li key={i} id={`${block.id}-item-${i}`} tabIndex={-1}>{inline(item)}</li>)}</List>; break;
        }
        case 'table': content = <div className="table-scroll" role="region" aria-label={block.caption || 'Tableau de la page'} tabIndex={0}><table>{block.caption && <caption>{block.caption}</caption>}<tbody>{block.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => cell.header ? <th key={j} scope="col">{inline(cell.content)}</th> : <td key={j}>{inline(cell.content)}</td>)}</tr>)}</tbody></table></div>; break;
      }
      const canExplain = block.type === 'paragraph' || block.type === 'quote';
      if (canExplain) passage++;
      const explain = (event: MouseEvent) => { event.preventDefault(); onExplain(block.id, blockText(block).trim().slice(0, 1200)); };
      return <section className={`source-block ${canExplain ? 'explainable' : ''} ${selectedId === block.id ? 'selected' : ''}`} key={block.id} id={block.id} data-source-block={block.id} tabIndex={-1}>
        {content}
        {canExplain && <button type="button" className="passage-button" aria-label={`Comprendre le passage ${passage}`} title="Comprendre ce passage" onClick={explain}><MessageCircle size={16} aria-hidden="true" /></button>}
      </section>;
    })}
    <div className="document-end"><span aria-hidden="true">✳</span><p>Tu es au bout de cette page.</p><small>La suite, c’est toi qui la choisis.</small></div>
  </div>;
}
