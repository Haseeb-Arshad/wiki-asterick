import type { WikiArticle, WikiSection } from "../../shared/types.js";

/*
 * PDFs (papers, reports, archives) opened in the reader. The text comes from PDF.js (via unpdf);
 * structure is rebuilt from the layout: lines in a larger type, or short numbered lines, become
 * headings; a bigger gap between lines starts a new paragraph; words split across lines are
 * joined; running headers, footers and page numbers are dropped; the references are left out of
 * the body.
 */

/** One run of text as PDF.js reports it. */
export interface PdfItem {
  str: string;
  /** Text height in points (the font size). */
  height: number;
  x: number;
  y: number;
  hasEOL: boolean;
  /** Set sideways (margin stamps such as arXiv IDs); left out of the text. */
  rotated?: boolean;
}

interface Line {
  text: string;
  size: number;
  y: number;
  page: number;
}

const MAX_PAGES = 80;

const KNOWN_HEADINGS =
  /^(abstract|summary|introduction|background|related work|methods?|materials and methods|methodology|results?|results and discussion|discussion|conclusions?|limitations|future work|acknowledge?ments|references|bibliography|works cited|appendix|supplementary (material|information))$/i;
const ENDS_BODY = /^(references|bibliography|works cited|literature cited)$/i;
const NUMBERED = /^((\d+(\.\d+){0,3})\.?|[IVX]{1,5}\.|[A-H]\.)\s+\S/;

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Items of each page grouped into lines. */
export function linesOf(pages: PdfItem[][]): Line[] {
  const lines: Line[] = [];
  pages.forEach((items, page) => {
    let text = "";
    let size = 0;
    let y: number | null = null;
    const flush = () => {
      if (squash(text)) lines.push({ text: squash(text), size, y: y ?? 0, page });
      text = "";
      size = 0;
      y = null;
    };
    for (const item of items) {
      if (item.rotated) continue;
      // A run on a clearly different baseline starts a new line even without an end-of-line mark.
      if (y !== null && item.str.trim() && Math.abs(item.y - y) > Math.max(2, item.height * 0.6)) flush();
      if (item.str.trim()) {
        y ??= item.y;
        size = Math.max(size, item.height);
      }
      text += item.str;
      if (item.hasEOL) flush();
    }
    flush();
  });
  return lines;
}

/** The size most of the text is set in, weighted by length. */
function bodySize(lines: Line[]): number {
  const weight = new Map<number, number>();
  for (const line of lines) {
    const size = Math.round(line.size * 2) / 2;
    weight.set(size, (weight.get(size) ?? 0) + line.text.length);
  }
  return [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
}

/** Text that repeats at the top or bottom of many pages (running heads, journal names), and page numbers. */
function runningText(lines: Line[], pageCount: number): Set<string> {
  const key = (text: string) => text.toLowerCase().replace(/\d+/g, "#");
  const pagesWith = new Map<string, Set<number>>();
  for (const line of lines) {
    const set = pagesWith.get(key(line.text)) ?? new Set<number>();
    set.add(line.page);
    pagesWith.set(key(line.text), set);
  }
  const repeated = new Set<string>();
  if (pageCount >= 3) {
    for (const [text, pages] of pagesWith) if (pages.size >= Math.max(3, pageCount * 0.4)) repeated.add(text);
  }
  return repeated;
}

function headingLevel(text: string): number {
  const numbered = text.match(/^(\d+(\.\d+)*)/);
  return numbered ? Math.min(4, numbered[1].split(".").length + 1) : 2;
}

/** Set in clearly larger type than the body, and short enough to be a heading. */
const isLarge = (line: Line, body: number) => line.size >= body * 1.12 && line.text.length <= 90 && !/[,;]$/.test(line.text);

/**
 * Whether a line is a section heading. `neighbours` are the lines just before and after it on the
 * same page: several large lines in a row are a notice or a pull quote, not a heading.
 */
function isHeading(line: Line, body: number, neighbours: (Line | undefined)[] = []): boolean {
  const text = line.text;
  if (text.length > 120 || !/\p{L}/u.test(text)) return false;
  const bare = text.replace(NUMBERED, (match) => match.replace(/^\S+\s+/, "")).replace(/[:.]$/, "");
  if (KNOWN_HEADINGS.test(bare) || KNOWN_HEADINGS.test(text.replace(/[:.]$/, ""))) return true;
  if (NUMBERED.test(text) && text.length <= 80 && !/[.,;]$/.test(text) && line.size >= body * 0.98 && /^\S+\s+\p{Lu}/u.test(text)) return true;
  if (!isLarge(line, body) || /\.$/.test(text)) return false;
  return !neighbours.some((other) => other && other.page === line.page && Math.abs(other.size - line.size) < 0.5 && isLarge(other, body));
}

function slug(text: string, used: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "section";
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

export interface PdfStructure {
  title: string;
  sections: WikiSection[];
  abstract: string;
  wordCount: number;
}

/** Rebuilds a readable article (title, sections, paragraphs) from the text runs of each page. */
export function structurePdf(pages: PdfItem[][], fallbackTitle: string): PdfStructure | null {
  const all = linesOf(pages);
  if (all.reduce((sum, line) => sum + line.text.length, 0) < 300) return null; // A scan without a text layer.
  const body = bodySize(all);
  const running = runningText(all, pages.length);
  const lines = all.filter((line) => !running.has(line.text.toLowerCase().replace(/\d+/g, "#")) && !/^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d+)?$/i.test(line.text));

  // The title: the largest type in the first lines of the first page.
  const opening = lines.filter((line) => line.page === 0).slice(0, 20);
  const largest = Math.max(...opening.map((line) => line.size), 0);
  const titleLines = largest > body * 1.2 ? opening.filter((line) => Math.abs(line.size - largest) < 0.5).slice(0, 4) : [];
  const title = squash(titleLines.map((line) => line.text).join(" ")) || fallbackTitle;
  const titleSet = new Set(titleLines);

  // Typical distance between lines of a paragraph.
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (lines[i].page === lines[i - 1].page && gap > 0 && gap < body * 3) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const lineGap = gaps[Math.floor(gaps.length / 2)] ?? body * 1.2;

  const used = new Set<string>();
  const drafts: { id: string; title: string; level: number; paragraphs: string[] }[] = [{ id: "lead", title: "", level: 1, paragraphs: [] }];
  let paragraph = "";
  const endParagraph = () => {
    if (squash(paragraph)) drafts[drafts.length - 1].paragraphs.push(squash(paragraph));
    paragraph = "";
  };

  let previous: Line | null = null;
  for (const [index, line] of lines.entries()) {
    if (titleSet.has(line)) continue;
    if (isHeading(line, body, [lines[index - 1], lines[index + 1]])) {
      endParagraph();
      if (ENDS_BODY.test(line.text.replace(NUMBERED, (match) => match.replace(/^\S+\s+/, "")).replace(/[:.]$/, ""))) break;
      const heading = line.text.replace(/[:.]$/, "");
      drafts.push({ id: slug(heading, used), title: heading, level: headingLevel(heading), paragraphs: [] });
      previous = line;
      continue;
    }
    const gap = previous && previous.page === line.page ? previous.y - line.y : 0;
    const newParagraph = previous !== null && previous.page === line.page && gap > lineGap * 1.4;
    if (newParagraph) endParagraph();
    if (/[A-Za-z]-$/.test(paragraph) && /^\p{Ll}/u.test(line.text)) paragraph = paragraph.slice(0, -1) + line.text;
    else paragraph += (paragraph ? " " : "") + line.text;
    previous = line;
  }
  endParagraph();

  const sections: WikiSection[] = drafts
    .filter((draft) => draft.paragraphs.length || draft.title)
    .map((draft) => ({
      id: draft.id,
      title: draft.title,
      level: draft.level,
      html: draft.paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join("\n"),
      subsections: [],
    }));
  if (!sections.length || sections[0].id !== "lead") sections.unshift({ id: "lead", title: "", level: 1, html: "", subsections: [] });

  const abstractSection = drafts.find((draft) => /^(abstract|summary)$/i.test(draft.title.replace(NUMBERED, (m) => m.replace(/^\S+\s+/, ""))));
  const abstract = squash((abstractSection?.paragraphs ?? drafts[0].paragraphs).join(" ")).slice(0, 600);
  const wordCount = drafts.reduce((sum, draft) => sum + draft.paragraphs.join(" ").split(/\s+/).filter(Boolean).length, 0);
  return { title, sections, abstract, wordCount };
}

/** A PDF from the web as a reader article, or null when it has no text to read (a scan). */
export async function buildPdfArticle(bytes: Uint8Array, url: string): Promise<WikiArticle | null> {
  const { getDocumentProxy, getMeta } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const meta = (await getMeta(pdf).catch(() => null)) as { info?: Record<string, unknown> } | null;
  const pageCount = Math.min(pdf.numPages, MAX_PAGES);
  const pages: PdfItem[][] = [];
  for (let n = 1; n <= pageCount; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    pages.push(
      (content.items as { str?: string; height?: number; transform?: number[]; hasEOL?: boolean }[])
        .filter((item) => typeof item.str === "string")
        .map((item) => ({ str: item.str!, height: item.height ?? 0, x: item.transform?.[4] ?? 0, y: item.transform?.[5] ?? 0, hasEOL: Boolean(item.hasEOL),
          rotated: Math.abs(item.transform?.[1] ?? 0) > 0.01 || Math.abs(item.transform?.[2] ?? 0) > 0.01,
        }))
    );
  }

  const host = new URL(url).hostname.replace(/^www\./, "");
  const file = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "").replace(/\.pdf$/i, "").replace(/[-_]+/g, " ");
  const metaTitle = typeof meta?.info?.Title === "string" ? squash(meta.info.Title) : "";
  const structure = structurePdf(pages, metaTitle || file || host);
  if (!structure) return null;

  const author = typeof meta?.info?.Author === "string" ? squash(meta.info.Author).slice(0, 120) : "";
  // A real title in the metadata beats the guess from type sizes; generic ones ("Microsoft Word - x.docx") don't.
  const title = metaTitle && metaTitle.length > 8 && !/^(untitled|microsoft word|document|slide|pdf)/i.test(metaTitle) ? metaTitle : structure.title;

  return {
    kind: "web",
    format: "pdf",
    wiki: `web:${host}`,
    title,
    description: structure.abstract.slice(0, 300),
    extract: structure.abstract,
    lang: "en",
    dir: "ltr",
    image: null,
    sections: structure.sections,
    footnotes: [],
    infobox: [],
    media: [],
    languages: [],
    externalLinks: [],
    wordCount: structure.wordCount,
    readingMinutes: Math.max(1, Math.round(structure.wordCount / 230)),
    lastEdited: null,
    revisionId: 0,
    sourceUrl: url,
    site: host,
    byline: author,
    pageCount: pdf.numPages,
  };
}
