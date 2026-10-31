import { Fragment } from 'react';

/**
 * Parseur maison de la narration IA.
 * Le modèle renvoie du texte brut avec `**gras**`, des titres `###`, des puces
 * `-`/`*` et des paragraphes. On le convertit en éléments React — jamais en
 * HTML injecté (`dangerouslySetInnerHTML` n'est pas utilisé).
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|__[^_]+__)/g;

function renderInline(text) {
  const parts = String(text).split(INLINE).filter((part) => part !== '');
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('__') && part.endsWith('__') && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

const isHeading = (line) => /^\s{0,3}#{1,6}\s+\S/.test(line);
const isBullet = (line) => /^\s{0,3}[-*•]\s+\S/.test(line);
const isOrdered = (line) => /^\s{0,3}\d{1,2}[.)]\s+\S/.test(line);

function cleanHeading(line) {
  return line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/\s*#+\s*$/, '').trim();
}

function cleanBullet(line) {
  return line.replace(/^\s{0,3}[-*•]\s+/, '').trim();
}

/**
 * @param {{ text?: string, className?: string }} props
 */
export function Narrative({ text, className = '' }) {
  const source = typeof text === 'string' ? text : '';
  if (!source.trim()) return null;

  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: 'p', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push(list);
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    if (isHeading(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'h', text: cleanHeading(line) });
      continue;
    }
    if (isBullet(line) || isOrdered(line)) {
      flushParagraph();
      const ordered = isOrdered(line);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { type: 'ul', ordered, items: [] };
      }
      list.items.push(isBullet(line) ? cleanBullet(line) : line.replace(/^\s{0,3}\d{1,2}[.)]\s+/, '').trim());
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();

  return (
    <div className={`narrative ${className}`.trim()}>
      {blocks.map((block, index) => {
        if (block.type === 'h') {
          return (
            <h4 key={index} className="narrative__heading">
              {renderInline(block.text)}
            </h4>
          );
        }
        if (block.type === 'ul') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag key={index} className={`narrative__list${block.ordered ? ' narrative__list--ordered' : ''}`}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ListTag>
          );
        }
        return (
          <p key={index} className="narrative__paragraph">
            {renderInline(block.text)}
          </p>
        );
      })}
    </div>
  );
}
