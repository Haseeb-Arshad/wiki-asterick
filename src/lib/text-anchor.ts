import type { HighlightColor } from "../../shared/types";

/**
 * Highlights are stored as a text quote plus a little context on each side
 * (the W3C "TextQuoteSelector" approach), so they survive article edits that
 * shift positions. They are painted with the CSS Custom Highlight API, which
 * styles ranges without touching the article's DOM.
 */

const CONTEXT = 32;

interface TextIndex {
  text: string;
  nodes: { node: Text; start: number }[];
}

function indexText(root: Node): TextIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: TextIndex["nodes"] = [];
  let text = "";
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    nodes.push({ node, start: text.length });
    text += node.data;
  }
  return { text, nodes };
}

function offsetWithin(root: Node, container: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(container, offset);
  return range.toString().length;
}

function pointAt(index: TextIndex, offset: number): { node: Text; offset: number } | null {
  let low = 0;
  let high = index.nodes.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const { node, start } = index.nodes[mid];
    if (offset < start) high = mid - 1;
    else if (offset > start + node.data.length) low = mid + 1;
    else return { node, offset: offset - start };
  }
  return null;
}

export interface TextQuote {
  text: string;
  prefix: string;
  suffix: string;
}

export function describeRange(range: Range, root: Node): TextQuote {
  const { text } = indexText(root);
  const start = offsetWithin(root, range.startContainer, range.startOffset);
  const end = offsetWithin(root, range.endContainer, range.endOffset);
  return {
    text: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
  };
}

/** Collapses whitespace while remembering where each character came from. */
function normalize(value: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < value.length; i++) {
    const isSpace = /\s/.test(value[i]);
    if (isSpace && lastWasSpace) continue;
    text += isSpace ? " " : value[i];
    map.push(i);
    lastWasSpace = isSpace;
  }
  map.push(value.length);
  return { text, map };
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

export function findQuote(root: Node, quote: TextQuote): Range | null {
  const index = indexText(root);
  const haystack = normalize(index.text);
  const needle = normalize(quote.text).text.trim();
  if (!needle) return null;

  const prefix = normalize(quote.prefix).text;
  const suffix = normalize(quote.suffix).text;

  // Several matches are possible; prefer the one whose surroundings match best.
  let best = -1;
  let bestScore = -1;
  for (let at = haystack.text.indexOf(needle); at !== -1; at = haystack.text.indexOf(needle, at + 1)) {
    const score =
      commonSuffixLength(haystack.text.slice(Math.max(0, at - prefix.length), at), prefix) +
      commonPrefixLength(haystack.text.slice(at + needle.length, at + needle.length + suffix.length), suffix);
    if (score > bestScore) {
      best = at;
      bestScore = score;
    }
  }
  if (best === -1) return null;

  const start = pointAt(index, haystack.map[best]);
  const end = pointAt(index, haystack.map[best + needle.length - 1] + 1);
  if (!start || !end) return null;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

export const supportsHighlights = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

const COLORS: HighlightColor[] = ["yellow", "green", "blue", "pink"];

export function paintHighlights(entries: { color: HighlightColor; range: Range }[]) {
  if (!supportsHighlights) return;
  for (const color of COLORS) {
    const ranges = entries.filter((entry) => entry.color === color).map((entry) => entry.range);
    if (ranges.length) CSS.highlights.set(`wa-${color}`, new Highlight(...ranges));
    else CSS.highlights.delete(`wa-${color}`);
  }
}

export function clearPaintedHighlights() {
  if (!supportsHighlights) return;
  for (const color of COLORS) CSS.highlights.delete(`wa-${color}`);
}

/** The text position under the pointer, used to detect clicks on painted highlights. */
export function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (doc.caretPositionFromPoint) {
    const position = doc.caretPositionFromPoint(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
  }
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  return null;
}

const WORD = /[\p{L}\p{N}'’-]/u;

/** Widens a selection that starts or ends mid-word to the whole words. */
export function snapToWords(range: Range): Range {
  const snapped = range.cloneRange();
  const { startContainer, endContainer } = snapped;
  if (startContainer instanceof Text) {
    let offset = snapped.startOffset;
    while (offset > 0 && WORD.test(startContainer.data[offset - 1])) offset--;
    snapped.setStart(startContainer, offset);
  }
  if (endContainer instanceof Text) {
    let offset = snapped.endOffset;
    while (offset < endContainer.data.length && WORD.test(endContainer.data[offset])) offset++;
    snapped.setEnd(endContainer, offset);
  }
  return snapped;
}

/** Passages the reader asked the AI about get a quieter mark of their own. */
export function paintAiPassages(ranges: Range[]) {
  if (!supportsHighlights) return;
  if (!ranges.length) {
    CSS.highlights.delete("wa-ai");
    return;
  }
  const highlight = new Highlight(...ranges);
  // The reader's own highlight colors win where the two overlap.
  highlight.priority = -1;
  CSS.highlights.set("wa-ai", highlight);
}

export function clearAiPassages() {
  if (supportsHighlights) CSS.highlights.delete("wa-ai");
}

/** Finds a quote in the open article, scrolls to it and flashes it. */
export function revealQuote(quote: TextQuote & { sectionId?: string }): boolean {
  const body = document.querySelector<HTMLElement>(".reader .prose");
  if (!body || !quote.text) return false;
  const section = quote.sectionId ? document.getElementById(quote.sectionId) : null;
  const root = section && body.contains(section) ? section : body;
  const range = findQuote(root, quote) ?? (root !== body ? findQuote(body, quote) : null);
  if (!range) return false;
  range.startContainer.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" });
  if (supportsHighlights) {
    CSS.highlights.set("wa-flash", new Highlight(range));
    window.setTimeout(() => CSS.highlights.delete("wa-flash"), 1800);
  }
  return true;
}
