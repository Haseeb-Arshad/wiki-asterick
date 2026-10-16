import type { Highlight, WikiArticle } from "../../../shared/types";
import type { OutlineEntry } from "./outline";

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function blockToMarkdown(element: Element): string[] {
  element.querySelectorAll("sup.fn, .mw-empty-elt, style").forEach((node) => node.remove());
  const tag = element.tagName.toLowerCase();

  if (tag === "p") return [clean(element.textContent ?? "")];
  if (tag === "blockquote") return [`> ${clean(element.textContent ?? "")}`];
  if (tag === "ul" || tag === "ol") {
    return Array.from(element.children)
      .filter((child) => child.tagName === "LI")
      .map((item, index) => `${tag === "ol" ? `${index + 1}.` : "-"} ${clean(item.textContent ?? "")}`);
  }
  if (tag === "dl") return Array.from(element.children).map((child) => (child.tagName === "DT" ? `**${clean(child.textContent ?? "")}**` : clean(child.textContent ?? "")));
  if (tag === "figure") {
    const image = element.querySelector("img");
    const caption = clean(element.querySelector("figcaption")?.textContent ?? "");
    return image ? [`![${caption}](${image.getAttribute("src")})`] : caption ? [`_${caption}_`] : [];
  }
  return [];
}

/** Plain Markdown of the article, with attribution as the licence requires. */
export function articleToMarkdown(article: WikiArticle, outline: OutlineEntry[]): string {
  const parser = new DOMParser();
  const lines: string[] = [`# ${article.title}`, ""];
  if (article.description) lines.push(`_${article.description}_`, "");

  for (const entry of outline) {
    if (entry.title) lines.push(`${"#".repeat(Math.min(entry.level, 6))} ${entry.title}`, "");
    const doc = parser.parseFromString(entry.html, "text/html");
    for (const block of Array.from(doc.body.children)) {
      const rendered = blockToMarkdown(block).filter(Boolean);
      if (rendered.length) lines.push(...rendered, "");
    }
  }

  lines.push("---", "", `Source: [${article.title}](${article.sourceUrl}) on ${article.wiki}, by its contributors. Text available under CC BY-SA 4.0.`, "");
  return lines.join("\n");
}

export function notesToMarkdown(article: WikiArticle, highlights: Highlight[]): string {
  const lines = [`# Highlights from ${article.title}`, "", `Source: ${article.sourceUrl}`, ""];
  for (const highlight of highlights) {
    lines.push(`> ${clean(highlight.text)}`, "");
    if (highlight.note) lines.push(highlight.note, "");
    lines.push(`— ${highlight.sectionTitle || "Introduction"}`, "");
  }
  return lines.join("\n");
}

export function downloadText(filename: string, text: string, type = "text/markdown;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/[\\/:*?"<>|]+/g, "-");
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
