import { Fragment, useMemo, type ReactNode } from 'react';
import { Marked, type MarkedToken, type Token, type Tokens } from 'marked';
import { decodeHTML } from 'entities';
import { safeMarkdownLink } from '../lib/markdown-link';

// A private lexer produces data only. Never parse its output as HTML or spread
// token properties onto elements. New/unknown tokens fall back to plain text.
const markdown = new Marked({ breaks: true, gfm: true });
const headings = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
const MAX_MARKDOWN_CHARS = 32_768;
const MAX_RENDER_DEPTH = 64;

function renderTokens(tokens: Token[], depth = 0): ReactNode {
  return tokens.map((value, index) => {
    if (depth >= MAX_RENDER_DEPTH) return <Fragment key={index}>{value.raw}</Fragment>;
    const token = value as MarkedToken;
    const children = (nested: Token[]) => renderTokens(nested, depth + 1);
    let node: ReactNode;
    switch (token.type) {
      case 'space': case 'def': node = null; break;
      case 'paragraph': node = <p>{children(token.tokens)}</p>; break;
      case 'text': node = token.tokens ? children(token.tokens) : decodeHTML(token.text); break;
      case 'escape': node = token.text; break;
      case 'html': node = token.raw; break;
      case 'strong': node = <strong>{children(token.tokens)}</strong>; break;
      case 'em': node = <em>{children(token.tokens)}</em>; break;
      case 'del': node = <del>{children(token.tokens)}</del>; break;
      case 'codespan': node = <code>{token.text}</code>; break;
      case 'code': node = <pre><code>{token.text}</code></pre>; break;
      case 'br': node = <br />; break;
      case 'hr': node = <hr />; break;
      case 'heading': {
        const Heading = headings[token.depth - 1];
        node = Heading ? <Heading>{children(token.tokens)}</Heading> : token.raw;
        break;
      }
      case 'blockquote': node = <blockquote>{children(token.tokens)}</blockquote>; break;
      case 'list': {
        const items = token.items.map((item, i) => (
          <li key={i}>{children(item.tokens)}</li>
        ));
        node = token.ordered
          ? <ol start={typeof token.start === 'number' && Number.isSafeInteger(token.start) ? token.start : undefined}>{items}</ol>
          : <ul>{items}</ul>;
        break;
      }
      case 'list_item': node = <li>{children(token.tokens)}</li>; break;
      case 'checkbox': node = token.checked ? '☑ ' : '☐ '; break;
      case 'table': {
        const cells = (row: Tokens.TableCell[], header = false) => row.map((cell, i) => {
          const Cell = header ? 'th' : 'td';
          const alignment = cell.align === 'left' ? 'text-left'
            : cell.align === 'right' ? 'text-right' : cell.align === 'center' ? 'text-center' : undefined;
          return <Cell key={i} className={alignment}>{children(cell.tokens)}</Cell>;
        });
        node = <table><thead><tr>{cells(token.header, true)}</tr></thead><tbody>
          {token.rows.map((row, i) => <tr key={i}>{cells(row)}</tr>)}
        </tbody></table>;
        break;
      }
      case 'link': {
        const link = safeMarkdownLink(token.href);
        const label = children(token.tokens);
        node = link ? <a href={link.href} title={token.title ? decodeHTML(token.title) : undefined}
          target={link.external ? '_blank' : undefined} rel="noopener noreferrer" referrerPolicy="no-referrer">{label}</a> : label;
        break;
      }
      // Images/embeds are intentionally text: no automatic external requests.
      case 'image': node = decodeHTML(token.text); break;
      default: node = value.raw;
    }
    return <Fragment key={index}>{node}</Fragment>;
  });
}

export default function FormattedText({ text }: { text: string }) {
  const content = useMemo(() => {
    if (text.length > MAX_MARKDOWN_CHARS) return text;
    try { return renderTokens(markdown.lexer(text)); }
    catch { return text; } // A partial/malformed stream remains escaped text.
  }, [text]);
  return <div className="formatted-text">{content}</div>;
}
