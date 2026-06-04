import fetch from "node-fetch";
import * as cheerio from "cheerio";

export interface WikiSection {
  id: string;
  title: string;
  level: number;
  content: string;
  html: string;
  subsections: WikiSection[];
}

export interface WikiArticle {
  title: string;
  subtitle: string;
  description: string;
  imageUrl: string | null;
  imageCaption: string;
  sections: WikiSection[];
  footnotes: { id: string; text: string }[];
  infobox: { label: string; value: string }[];
  lastModified: string;
}

async function fetchWikipediaParse(pageTitle: string): Promise<string> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=text&format=json&origin=*&disabletoc=true&disablelimitreport=true&sectionpreview=1`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "WikiAsterisk/1.0 (https://github.com/wiki-asterisk)",
    },
  });
  if (!response.ok) {
    throw new Error(`Wikipedia API returned ${response.status}`);
  }
  const json = (await response.json()) as {
    parse?: { text?: { ["*"]?: string }; title?: string };
    error?: { info?: string };
  };
  if (json.error) {
    throw new Error(json.error.info || "Wikipedia API error");
  }
  if (!json.parse?.text?.["*"]) {
    throw new Error("Could not parse Wikipedia article");
  }
  return json.parse.text["*"];
}

async function fetchWikipediaSummary(
  pageTitle: string
): Promise<{ extract: string; thumbnail?: { source: string }; description?: string } | null> {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "WikiAsterisk/1.0" },
    });
    if (!response.ok) return null;
    return response.json() as Promise<{
      extract: string;
      thumbnail?: { source: string };
      description?: string;
    }>;
  } catch {
    return null;
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function cleanHtml($: cheerio.CheerioAPI, el: cheerio.Element): string {
  const $el = $(el);
  $el.find(".mw-editsection").remove();
  $el.find(".mw-empty-elt").remove();
  $el.find(".mw-heading .mw-editsection").remove();
  $el.find("sup.reference").each(function () {
    const num = $(this).text().trim();
    const link = $(this).find("a").attr("href") || "";
    $(this).replaceWith(
      `<sup class="footnote-ref"><a href="${link}" data-ref="${num}">${num}</a></sup>`
    );
  });
  $el.find("a").each(function () {
    const href = $(this).attr("href") || "";
    if (href.startsWith("/wiki/")) {
      $(this).attr("href", `https://en.wikipedia.org${href}`);
      $(this).attr("target", "_blank");
      $(this).attr("rel", "noopener noreferrer");
    } else if (href.startsWith("//")) {
      $(this).attr("href", `https:${href}`);
      $(this).attr("target", "_blank");
      $(this).attr("rel", "noopener noreferrer");
    }
  });
  $el.find("img").each(function () {
    const src = $(this).attr("src") || "";
    if (src.startsWith("//")) {
      $(this).attr("src", `https:${src}`);
    }
    // Try to use higher-resolution image versions
    const srcset = $(this).attr("srcset");
    if (srcset) {
      const entries = srcset.split(",").map((s: string) => s.trim());
      let bestUrl = src.startsWith("https:") ? src : `https:${src}`;
      let bestWidth = 0;
      for (const entry of entries) {
        const parts = entry.split(/\s+/);
        const url = parts[0].startsWith("//") ? `https:${parts[0]}` : parts[0];
        const width = parseInt(parts[1] || "0", 10);
        if (width > bestWidth) {
          bestWidth = width;
          bestUrl = url;
        }
      }
      if (bestWidth > 0) {
        $(this).attr("src", bestUrl);
      }
    }
    $(this).attr("loading", "lazy");
    $(this).removeAttr("srcset");
    $(this).removeAttr("data-file-width");
    $(this).removeAttr("data-file-height");
    $(this).removeAttr("data-file-type");
    $(this).removeAttr("data-mw");
  });
  // Make figure/figcaption more semantic for our CSS
  $el.find("figure").each(function () {
    $(this).addClass("article-figure");
    const caption = $(this).find("figcaption");
    if (caption.length) {
      caption.addClass("article-caption");
    }
  });
  $el.find("style").remove();
  $el.find("link[rel='mw-deduplicated-inline-style']").remove();
  return $el.html() || "";
}

function isHeadingWrapper(el: cheerio.Element, $: cheerio.CheerioAPI): boolean {
  const cls = $(el).attr("class") || "";
  return el.tagName.toLowerCase() === "div" && cls.includes("mw-heading");
}

function getHeadingInfo(el: cheerio.Element, $: cheerio.CheerioAPI): { level: number; title: string; id: string } | null {
  const $el = $(el);
  const h = $el.find("h1, h2, h3, h4, h5, h6").first();
  if (!h.length) return null;
  const tag = h.prop("tagName")?.toLowerCase() || "h2";
  const level = parseInt(tag[1]);
  $el.find(".mw-editsection").remove();
  const title = h.text().trim();
  const id = h.attr("id") || h.find("[id]").attr("id") || slugify(title);
  return { level, title, id };
}

const SKIP_TAGS = new Set(["style", "link", "script", "noscript"]);
const SKIP_CLASSES = [
  "shortdescription",
  "hatnote",
  "ambox",
  "noprint",
  "mw-empty-elt",
  "mw-cite-backlink",
  "refbegin",
  "navbox",
  "sistersitebox",
  "side-box",
  "metadata",
  "mw-parser-output>p:empty",
];

function shouldSkip(el: cheerio.Element, $: cheerio.CheerioAPI): boolean {
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return true;
  const cls = $(el).attr("class") || "";
  return SKIP_CLASSES.some((c) => cls.includes(c));
}

function extractSections($: cheerio.CheerioAPI, $content: cheerio.Cheerio<cheerio.Element>): WikiSection[] {
  const sections: WikiSection[] = [];
  const stack: { section: WikiSection; level: number }[] = [];
  let currentContentParts: string[] = [];
  let leadContentAdded = false;

  function pushSection() {
    if (stack.length === 0) return;
    const top = stack[stack.length - 1];
    top.section.html = currentContentParts.join("\n");
    top.section.content = cheerio
      .load(currentContentParts.join("\n"))
      .text()
      .trim()
      .slice(0, 5000);
  }

  function finalizeAll() {
    while (stack.length > 0) {
      const popped = stack.pop()!;
      if (popped.section.html || popped.section.subsections.length > 0) {
        if (stack.length > 0) {
          stack[stack.length - 1].section.subsections.push(popped.section);
        } else {
          sections.push(popped.section);
        }
      }
    }
  }

  const children = $content.children().toArray();

  for (const child of children) {
    if (shouldSkip(child, $)) continue;

    if (isHeadingWrapper(child, $)) {
      pushSection();
      currentContentParts = [];

      const info = getHeadingInfo(child, $);
      if (!info) continue;

      const section: WikiSection = {
        id: info.id,
        title: info.title,
        level: info.level,
        content: "",
        html: "",
        subsections: [],
      };

      while (stack.length > 0 && stack[stack.length - 1].level >= info.level) {
        const popped = stack.pop()!;
        if (stack.length > 0) {
          stack[stack.length - 1].section.subsections.push(popped.section);
        } else {
          sections.push(popped.section);
        }
      }

      stack.push({ section, level: info.level });
    } else if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(child.tagName.toLowerCase())) {
      pushSection();
      currentContentParts = [];

      const level = parseInt(child.tagName.toLowerCase()[1]);
      const title = $(child).text().trim().replace(/\[edit\]/g, "").trim();
      const id = $(child).attr("id") || $(child).find("[id]").attr("id") || slugify(title);

      const section: WikiSection = {
        id,
        title,
        level,
        content: "",
        html: "",
        subsections: [],
      };

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        const popped = stack.pop()!;
        if (stack.length > 0) {
          stack[stack.length - 1].section.subsections.push(popped.section);
        } else {
          sections.push(popped.section);
        }
      }

      stack.push({ section, level });
    } else if (child.tagName.toLowerCase() === "div" && ($(child).attr("class") || "").includes("infobox") || $(child).hasClass("sidebar")) {
      // skip infoboxes in content flow
    } else {
      const html = cleanHtml($, child);
      if (html.trim()) {
        if (stack.length === 0 && !leadContentAdded) {
          // Lead content before first heading
          currentContentParts.push(html);
        } else if (stack.length > 0) {
          currentContentParts.push(html);
        }
      }
    }
  }

  // Handle remaining lead content
  if (stack.length === 0 && currentContentParts.length > 0) {
    const leadContent = currentContentParts.join("\n");
    const leadText = cheerio.load(leadContent).text().trim().slice(0, 5000);
    if (leadText) {
      sections.unshift({
        id: "introduction",
        title: "Introduction",
        level: 2,
        content: leadText,
        html: leadContent,
        subsections: [],
      });
    }
    leadContentAdded = true;
    currentContentParts = [];
  }

  pushSection();
  finalizeAll();

  return sections;
}

function extractFootnotes($: cheerio.CheerioAPI): { id: string; text: string }[] {
  const footnotes: { id: string; text: string }[] = [];
  $("ol.references li, .reflist ol li, .refbegin li").each(function () {
    const id = $(this).attr("id") || $(this).find("[id]").first().attr("id") || "";
    let text = $(this).text().trim().replace(/\s+/g, " ");
    if (text.length > 500) {
      text = text.slice(0, 500) + "...";
    }
    if (text) {
      footnotes.push({ id: id || `fn-${footnotes.length + 1}`, text });
    }
  });
  return footnotes;
}

function extractInfobox($: cheerio.CheerioAPI): { label: string; value: string }[] {
  const entries: { label: string; value: string }[] = [];
  const $infobox = $("table.infobox, table.sidebar").first();
  if ($infobox.length === 0) return entries;

  $infobox.find("tr").each(function () {
    const $th = $(this).find("th");
    const $td = $(this).find("td");
    if ($th.length > 0 && $td.length > 0) {
      const label = $th.text().trim().replace(/\s+/g, " ");
      const value = $td.text().trim().replace(/\s+/g, " ").slice(0, 300);
      if (label && value && label.length < 100 && value.length > 1) {
        entries.push({ label, value });
      }
    }
  });
  return entries.slice(0, 15);
}

export async function parseWikipediaArticle(urlOrTitle: string): Promise<WikiArticle> {
  let pageTitle: string;
  try {
    const url = new URL(urlOrTitle);
    const pathParts = url.pathname.split("/");
    const wikiIndex = pathParts.indexOf("wiki");
    if (wikiIndex !== -1) {
      pageTitle = pathParts.slice(wikiIndex + 1).join("/");
    } else {
      pageTitle = pathParts[pathParts.length - 1];
    }
  } catch {
    pageTitle = urlOrTitle;
  }

  pageTitle = decodeURIComponent(pageTitle).replace(/_/g, " ");

  const [html, summary] = await Promise.all([
    fetchWikipediaParse(pageTitle),
    fetchWikipediaSummary(pageTitle),
  ]);

const $ = cheerio.load(html);

  const title = summary?.title || pageTitle;

  let $content = $(".mw-parser-output").first();
  if ($content.length === 0) {
    $content = $(".mw-body-content").first();
  }
  if ($content.length === 0) {
    $content = $("body").first();
    if ($content.length === 0) {
      throw new Error("Could not find article content on Wikipedia page.");
    }
  }

  const thumbnailUrl = summary?.thumbnail?.source || null;

  const description = summary?.extract || "";

  const sections = extractSections($, $content);
  const footnotes = extractFootnotes($);
  const infobox = extractInfobox($);

  const lastModified = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    title,
    subtitle: infobox.length > 0 ? infobox[0].value : "",
    description,
    imageUrl: thumbnailUrl,
    imageCaption: "",
    sections,
    footnotes,
    infobox,
    lastModified,
  };
}
