import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { parseHTML } from "linkedom";
import type { MediaItem, WikiArticle, WikiSection } from "../../shared/types.js";
import { languageDirection, parseWikiUrl, titleToPath, wikiSlug } from "../../shared/wiki.js";

/** Page details from <meta> tags (Open Graph and friends). */
interface PageMeta {
  title: string;
  description: string;
  image: string | null;
  site: string;
  author: string;
  published: string | null;
  lang: string;
  canonical: string | null;
}

const REMOVE = [
  "script",
  "style",
  "noscript",
  "template",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "object",
  "embed",
  "svg",
  "canvas",
  "link",
  "meta",
].join(",");

// Newsletter prompts, share bars and similar clutter that reader mode sometimes keeps.
const CLUTTER = /subscri|newsletter|share|social|paywall|related-posts|comments?\b|promo|advert/i;

const VIDEO_EMBEDS = /^https:\/\/(www\.)?(youtube\.com\/embed\/|youtube-nocookie\.com\/embed\/|player\.vimeo\.com\/video\/)/i;

const isElement = (node: AnyNode): node is Element => node.type === "tag";

function absolute(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function readMeta(html: string, pageUrl: string): PageMeta {
  const $ = cheerio.load(html);
  const meta = (...names: string[]) => {
    for (const name of names) {
      const value = $(`meta[property="${name}"], meta[name="${name}"]`).attr("content")?.trim();
      if (value) return value;
    }
    return "";
  };
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  return {
    title: meta("og:title", "twitter:title") || $("title").first().text().trim(),
    description: meta("og:description", "twitter:description", "description"),
    image: absolute(meta("og:image", "twitter:image", "twitter:image:src"), pageUrl),
    site: meta("og:site_name", "application-name") || host,
    author: meta("author", "article:author", "twitter:creator"),
    published: meta("article:published_time", "og:article:published_time", "date", "pubdate") || null,
    lang: ($("html").attr("lang") || "en").slice(0, 2).toLowerCase(),
    canonical: absolute($('link[rel="canonical"]').attr("href"), pageUrl),
  };
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "section"
  );
}

function bestFromSrcset(srcset: string | undefined, base: string): string | null {
  if (!srcset) return null;
  const candidates = srcset
    .split(/,\s+(?=\S)/)
    .map((entry) => {
      const [url, descriptor = ""] = entry.trim().split(/\s+/);
      return { url, width: parseInt(descriptor, 10) || 0 };
    })
    .filter((candidate) => candidate.url);
  // The smallest rendition at least ~1000px wide, or the largest available.
  const sorted = candidates.sort((a, b) => a.width - b.width);
  const pick = sorted.find((candidate) => candidate.width >= 1000) ?? sorted[sorted.length - 1];
  return pick ? absolute(pick.url, base) : null;
}

interface CleanResult {
  sections: WikiSection[];
  media: MediaItem[];
  wordCount: number;
}

/** Sanitizes reader-mode HTML and splits it into sections at its headings. */
export function cleanContent(contentHtml: string, pageUrl: string, title: string): CleanResult {
  const $ = cheerio.load(`<div id="wa-root">${contentHtml}</div>`);
  const $root = $("#wa-root");
  const media: MediaItem[] = [];

  $root.find(REMOVE).remove();
  $root.find("iframe").each((_, frame) => {
    const src = $(frame).attr("src") || "";
    if (!VIDEO_EMBEDS.test(src)) {
      $(frame).remove();
      return;
    }
    const clean = src.replace("youtube.com/embed/", "youtube-nocookie.com/embed/");
    $(frame).replaceWith(
      $("<div>")
        .addClass("embed")
        .append(
          $("<iframe>")
            .attr("src", clean)
            .attr("title", $(frame).attr("title") || "Embedded video")
            .attr("loading", "lazy")
            .attr("allow", "accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen")
            .attr("referrerpolicy", "strict-origin-when-cross-origin")
            .attr("allowfullscreen", "")
        )
    );
  });

  // Drop clutter blocks, but never anything long enough to be real content.
  $root.find("[class], [id]").each((_, el) => {
    const $el = $(el);
    const marker = `${$el.attr("class") ?? ""} ${$el.attr("id") ?? ""}`;
    if (CLUTTER.test(marker) && $el.text().trim().length < 400 && !$el.find("img, video").length) $el.remove();
  });

  // Many blogs mark section titles as a bold one-line paragraph; make them headings.
  $root.find("p").each((_, p) => {
    const $p = $(p);
    const children = $p.children();
    const text = $p.text().replace(/\s+/g, " ").trim();
    if (
      children.length === 1 &&
      children.is("strong, b") &&
      children.text().replace(/\s+/g, " ").trim() === text &&
      text.length >= 2 &&
      text.length <= 80 &&
      !/[.:;,!?]$/.test(text)
    ) {
      $p.replaceWith($("<h2>").text(text));
    }
  });

  // Keep in-page anchors (footnotes, "jump to") working, prefixed so they can't clash with the app.
  $root.find("[id]").each((_, el) => {
    if (isElement(el)) el.attribs["data-anchor"] = `wa-${el.attribs.id}`;
  });

  // The title usually repeats as the first heading.
  const firstHeading = $root.find("h1, h2").first();
  if (firstHeading.length && firstHeading.text().trim().toLowerCase() === title.trim().toLowerCase()) firstHeading.remove();

  $root.find("*").each((_, el) => {
    if (!isElement(el)) return;
    const keep: Record<string, string> = {};
    for (const [name, value] of Object.entries(el.attribs)) {
      if (["href", "src", "srcset", "alt", "title", "width", "height", "colspan", "rowspan", "start", "poster", "controls", "type", "loading", "allow", "allowfullscreen", "referrerpolicy"].includes(name)) {
        keep[name] = value;
      }
    }
    if (el.attribs.class === "embed") keep.class = "embed";
    if (el.attribs["data-anchor"]) keep.id = el.attribs["data-anchor"];
    el.attribs = keep;
  });

  $root.find("a").each((_, anchor) => {
    const $a = $(anchor);
    const raw = ($a.attr("href") || "").trim();
    if (raw.startsWith("#") && raw.length > 1) {
      $a.attr("href", `#wa-${raw.slice(1)}`);
      return;
    }
    const href = absolute(raw, pageUrl);
    if (!href) {
      $a.removeAttr("href");
      return;
    }
    const wiki = parseWikiUrl(href);
    if (wiki && new URL(href).pathname.startsWith("/wiki/") && !wiki.title.includes(":")) {
      $a.attr("href", `/read/${wikiSlug(wiki.wiki)}/${encodeURIComponent(titleToPath(wiki.title))}`);
      $a.attr("data-wiki-title", wiki.title);
      $a.attr("data-wiki", wiki.wiki);
      return;
    }
    $a.attr("href", href);
    $a.attr("target", "_blank");
    $a.attr("rel", "noopener noreferrer nofollow");
    $a.addClass("external");
  });

  let sectionId = "lead";
  const sectionOf = new Map<Element, string>();

  // Assign media after sections are known (below), so walk headings first.
  const blocks: Element[] = [];
  const headingTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
  const walk = (parent: Element) => {
    for (const child of $(parent).contents().toArray()) {
      if (child.type === "text") {
        const text = ($(child).text() || "").trim();
        if (text) {
          const $p = $("<p>").text(text);
          $(child).replaceWith($p);
          blocks.push($p.get(0) as Element);
        }
        continue;
      }
      if (!isElement(child)) continue;
      const containsHeading = $(child).find("h1, h2, h3, h4, h5, h6").length > 0;
      if (!headingTags.has(child.tagName) && containsHeading && ["div", "section", "article", "main", "header", "footer", "span"].includes(child.tagName)) {
        walk(child);
      } else {
        blocks.push(child);
      }
    }
  };
  walk($root.get(0)!);

  const drafts: { section: WikiSection; parts: string[] }[] = [{ section: { id: "lead", title: "", level: 1, html: "", subsections: [] }, parts: [] }];
  const usedIds = new Set(["lead"]);
  let words = 0;

  for (const block of blocks) {
    if (headingTags.has(block.tagName)) {
      const heading = $(block).text().replace(/\s+/g, " ").trim();
      if (!heading) continue;
      let id = slugify(heading);
      for (let n = 2; usedIds.has(id); n++) id = `${slugify(heading)}-${n}`;
      usedIds.add(id);
      sectionId = id;
      const level = block.tagName === "h1" || block.tagName === "h2" ? 2 : block.tagName === "h3" ? 3 : 4;
      drafts.push({ section: { id, title: heading, level, html: "", subsections: [] }, parts: [] });
      continue;
    }
    sectionOf.set(block, sectionId);

    const $block = $(block);
    $block.find("img").addBack("img").each((_, img) => {
      const $img = $(img);
      const src = bestFromSrcset($img.attr("srcset"), pageUrl) ?? absolute($img.attr("src"), pageUrl);
      if (!src) {
        $img.remove();
        return;
      }
      const width = Number($img.attr("width")) || 0;
      if (width && width < 48) return; // icons and tracking pixels
      const id = `m${media.length + 1}`;
      const $figure = $img.closest("figure");
      const caption = ($figure.find("figcaption").text() || $img.attr("alt") || "").replace(/\s+/g, " ").trim();
      $img.attr("src", src).removeAttr("srcset").attr("loading", "lazy").attr("decoding", "async").attr("data-media-id", id);
      if ($figure.length) $figure.attr("data-media-id", id).addClass("media-image");
      media.push({
        id,
        type: "image",
        file: decodeURIComponent(src.split("?")[0].split("/").pop() || "image"),
        caption,
        src,
        thumb: src,
        width,
        height: Number($img.attr("height")) || 0,
        poster: null,
        sources: [],
        durationSeconds: null,
        sectionId,
        filePage: src,
      });
    });

    $block.find("video").addBack("video").each((_, video) => {
      const $video = $(video);
      const sources = [$video.attr("src"), ...$video.find("source").toArray().map((s) => $(s).attr("src"))]
        .map((src) => absolute(src, pageUrl))
        .filter((src): src is string => Boolean(src));
      if (!sources.length) {
        $video.remove();
        return;
      }
      const id = `m${media.length + 1}`;
      const poster = absolute($video.attr("poster"), pageUrl);
      $video.attr("controls", "").attr("preload", "metadata").attr("playsinline", "").attr("data-media-id", id);
      if (poster) $video.attr("poster", poster);
      media.push({
        id,
        type: "video",
        file: decodeURIComponent(sources[0].split("?")[0].split("/").pop() || "video"),
        caption: "",
        src: sources[0],
        thumb: poster ?? "",
        width: 0,
        height: 0,
        poster,
        sources: sources.map((src) => ({ src, type: /\.webm/i.test(src) ? "video/webm" : "video/mp4" })),
        durationSeconds: null,
        sectionId,
        filePage: sources[0],
      });
    });

    $block.find("table").addBack("table").each((_, table) => {
      if (!$(table).parent().hasClass("table-scroll")) $(table).wrap('<div class="table-scroll"></div>');
    });

    const text = $block.text().replace(/\s+/g, " ").trim();
    if (!text && !$block.find("img, video, iframe").length && !$block.is("img, hr")) continue;
    words += text ? text.split(" ").length : 0;

    const $out = $block.parent().hasClass("table-scroll") ? $block.parent() : $block;
    drafts[drafts.length - 1].parts.push($.html($out));
  }

  const sections = drafts
    .map((draft) => ({ ...draft.section, html: draft.parts.join("\n") }))
    .filter((section) => section.html.trim());

  return { sections, media, wordCount: words };
}

interface BuildInput {
  html: string;
  url: string;
}

/** Turns any article page into the same shape the reader uses for wiki articles. */
export function buildWebArticle({ html, url }: BuildInput): WikiArticle | null {
  const meta = readMeta(html, url);
  const { document } = parseHTML(html);
  const parsed = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], { charThreshold: 300 }).parse();
  if (!parsed?.content || (parsed.textContent ?? "").trim().length < 400) return null;

  const title = meta.title || parsed.title || new URL(url).hostname;
  return assemble({
    title,
    contentHtml: parsed.content,
    url: meta.canonical ?? url,
    description: meta.description || parsed.excerpt || "",
    image: meta.image,
    site: meta.site || parsed.siteName || "",
    byline: parsed.byline || meta.author,
    published: meta.published || parsed.publishedTime || null,
    lang: parsed.lang?.slice(0, 2) || meta.lang,
    dir: parsed.dir === "rtl" ? "rtl" : undefined,
  });
}

export function assemble(input: {
  title: string;
  contentHtml: string;
  url: string;
  description: string;
  image: string | null;
  site: string;
  byline: string;
  published: string | null;
  lang: string;
  dir?: "rtl" | "ltr";
}): WikiArticle {
  const host = new URL(input.url).hostname.replace(/^www\./, "");
  const { sections, media, wordCount } = cleanContent(input.contentHtml, input.url, input.title);
  const lang = input.lang || "en";

  return {
    kind: "web",
    wiki: `web:${host}`,
    title: input.title.replace(/\s+/g, " ").trim(),
    description: input.description.replace(/\s+/g, " ").trim().slice(0, 300),
    extract: input.description,
    lang,
    dir: input.dir ?? languageDirection(lang),
    image: input.image ? { src: input.image, width: 0, height: 0 } : null,
    sections,
    footnotes: [],
    infobox: [],
    media,
    languages: [],
    externalLinks: [],
    wordCount,
    readingMinutes: Math.max(1, Math.round(wordCount / 230)),
    lastEdited: input.published && !Number.isNaN(Date.parse(input.published)) ? new Date(input.published).toISOString() : null,
    revisionId: 0,
    sourceUrl: input.url,
    site: input.site || host,
    byline: input.byline.replace(/\s+/g, " ").trim().slice(0, 120),
  };
}
