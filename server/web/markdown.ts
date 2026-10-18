// Exa's crawler answers some pages, PDFs especially, with markdown instead of HTML.
// This turns that markdown into the plain HTML the reader cleans; anything unusual stays as text.

const BLOCK_TAG = /<(p|div|h[1-6]|ul|ol|li|br|article|section|table|blockquote|pre)\b/i;

/** True when crawled text has no HTML structure of its own. */
export function isMarkdownText(text: string): boolean {
  return !BLOCK_TAG.test(text);
}

/** Exa opens a paper with a card (title, journal, authors, topics) and then repeats the title; keep what follows. */
export function withoutExaCard(markdown: string, title: string): string {
  const key = title.toLowerCase().replace(/\s+/g, " ").trim();
  const lines = markdown.split("\n");
  const titles = lines.flatMap((line, index) => (/^#{1,6}\s/.test(line) && line.replace(/^#+/, "").toLowerCase().replace(/\s+/g, " ").trim() === key ? [index] : []));
  return titles.length >= 2 ? lines.slice(titles[1] + 1).join("\n") : markdown;
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function inline(text: string): string {
  const codes: string[] = [];
  // Code spans are set aside behind a private-use character so emphasis and links leave them alone.
  let html = escape(text).replace(/`([^`]+)`/g, (_, code: string) => `${codes.push(code) - 1}`);
  html = html
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt: string, src: string) => {
      const url = safeUrl(src.replace(/&amp;/g, "&"));
      return url ? `<img src="${escape(url)}" alt="${alt}">` : alt;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
      const url = safeUrl(href.replace(/&amp;/g, "&"));
      return url ? `<a href="${escape(url)}">${label}</a>` : label;
    })
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a?: string, b?: string) => `<strong>${a ?? b}</strong>`)
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  return html.replace(/(\d+)/g, (_, index: string) => `<code>${codes[Number(index)]}</code>`);
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const FENCE = /^```/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function cells(row: string): string[] {
  return row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => inline(cell.trim()));
}

/** Markdown to simple HTML: headings, paragraphs, lists, quotes, code, tables, rules, links and emphasis. */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) {
      flush();
      continue;
    }
    if (FENCE.test(line.trim())) {
      flush();
      const code: string[] = [];
      while (++index < lines.length && !FENCE.test(lines[index].trim())) code.push(lines[index]);
      out.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = Math.max(2, heading[1].length);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (RULE.test(line)) {
      flush();
      out.push("<hr>");
      continue;
    }
    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[index + 1] ?? "")) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      index++;
      while (index + 1 < lines.length && TABLE_ROW.test(lines[index + 1])) rows.push(cells(lines[++index]));
      out.push(
        `<table><thead><tr>${head.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${rows
          .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`
      );
      continue;
    }
    const listPattern = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
    if (listPattern) {
      flush();
      const items: string[] = [];
      for (; index < lines.length; index++) {
        const item = listPattern.exec(lines[index]);
        if (item) items.push(item[1]);
        else if (lines[index].trim() && /^\s{2,}/.test(lines[index]) && items.length) items[items.length - 1] += ` ${lines[index].trim()}`;
        else break;
      }
      index--;
      const tag = listPattern === BULLET ? "ul" : "ol";
      out.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const quoted: string[] = [];
      for (; index < lines.length && QUOTE.test(lines[index]); index++) quoted.push(QUOTE.exec(lines[index])![1]);
      index--;
      out.push(`<blockquote>${markdownToHtml(quoted.join("\n"))}</blockquote>`);
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return out.join("\n");
}
