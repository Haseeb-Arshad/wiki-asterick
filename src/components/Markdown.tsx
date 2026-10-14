import { Fragment, type ReactNode } from "react";
import type { AssistantSource } from "../lib/assistant";

/*
 * A small Markdown renderer for AI answers. It builds React elements (never
 * raw HTML), so model output can't inject markup, and it turns citation
 * markers like [2] into links to the matching source.
 */

type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "rule" };

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++) code.push(lines[i]);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: "rule" });
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    if (trimmed.startsWith(">")) {
      flushParagraph();
      blocks.push({ type: "quote", text: trimmed.replace(/^>\s?/, "") });
      continue;
    }
    const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const last = blocks[blocks.length - 1];
      const item = (bullet ?? numbered)![1];
      if (last?.type === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ type: "list", ordered, items: [item] });
      continue;
    }
    // Continuation of a list item ("  more text" under a bullet).
    const previous = blocks[blocks.length - 1];
    if (!paragraph.length && previous?.type === "list" && /^\s{2,}/.test(line)) {
      previous.items[previous.items.length - 1] += ` ${trimmed}`;
      continue;
    }
    paragraph.push(trimmed);
  }
  flushParagraph();
  return blocks;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))|((?:\[\d{1,2}(?:\s*,\s*\d{1,2})*\])+)/g;

function renderInline(text: string, sources: AssistantSource[], keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;

  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const key = `${keyPrefix}-${index++}`;
    const [token, code, bold, italic, link, linkUrl, citations] = match;

    if (code) nodes.push(<code key={key}>{code.slice(1, -1)}</code>);
    else if (bold) nodes.push(<strong key={key}>{renderInline(bold.slice(2, -2), sources, key)}</strong>);
    else if (italic) nodes.push(<em key={key}>{renderInline(italic.slice(1, -1), sources, key)}</em>);
    else if (link && linkUrl) {
      const label = link.slice(1, link.indexOf("]("));
      nodes.push(
        <a key={key} href={linkUrl} target="_blank" rel="noopener noreferrer nofollow">
          {label}
        </a>
      );
    } else if (citations) {
      const numbers = [...citations.matchAll(/\d{1,2}/g)].map((n) => Number(n[0]));
      nodes.push(
        <span key={key} className="cites">
          {numbers.map((n) => {
            const source = sources.find((item) => item.n === n);
            return source ? (
              <a key={n} className="cite" href={source.url} target="_blank" rel="noopener noreferrer nofollow" title={`${source.title} — ${source.site}`}>
                {n}
              </a>
            ) : (
              <span key={n} className="cite is-missing">
                {n}
              </span>
            );
          })}
        </span>
      );
    } else nodes.push(token);
    last = start + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ text, sources = [] }: { text: string; sources?: AssistantSource[] }) {
  const blocks = parseBlocks(text);
  return (
    <>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.type) {
          case "paragraph":
            return <p key={key}>{renderInline(block.text, sources, key)}</p>;
          case "heading":
            return block.level <= 2 ? (
              <h3 key={key}>{renderInline(block.text, sources, key)}</h3>
            ) : (
              <h4 key={key}>{renderInline(block.text, sources, key)}</h4>
            );
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={key}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item, sources, `${key}-${itemIndex}`)}</li>
                ))}
              </Tag>
            );
          }
          case "quote":
            return <blockquote key={key}>{renderInline(block.text, sources, key)}</blockquote>;
          case "code":
            return (
              <pre key={key}>
                <code>{block.text}</code>
              </pre>
            );
          case "rule":
            return <hr key={key} />;
          default:
            return <Fragment key={key} />;
        }
      })}
    </>
  );
}
