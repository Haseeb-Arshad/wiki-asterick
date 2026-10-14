import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type {
  ArticleSummary,
  ExternalLink,
  Footnote,
  InfoboxRow,
  MediaItem,
  MediaSource,
  WikiArticle,
  WikiSection,
} from "../../shared/types.js";
import {
  absoluteUrl,
  languageDirection,
  parseWikiUrl,
  pathToTitle,
  resizeThumb,
  snapThumbWidth,
  titleToPath,
  wikiArticleUrl,
  wikiLanguage,
  wikiSlug,
} from "../../shared/wiki.js";

export interface BuildArticleInput {
  wiki: string;
  title: string;
  html: string;
  revisionId: number;
  languages: WikiArticle["languages"];
  summary: ArticleSummary | null;
  lastEdited: string | null;
  /** Lower-cased namespace prefixes ("file", "category", "datei", ...). */
  namespaces: string[];
}

/** Elements that never belong in a reading view. */
const REMOVE_SELECTORS = [
  "style",
  "link",
  "script",
  "noscript",
  "meta",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  ".mw-editsection",
  ".mw-empty-elt",
  ".shortdescription",
  ".hatnote",
  ".navbox",
  ".navbox-styles",
  ".vertical-navbox",
  ".ambox",
  ".ombox",
  ".tmbox",
  ".cmbox",
  ".fmbox",
  ".sistersitebox",
  ".side-box",
  ".metadata",
  ".noprint",
  ".portalbox",
  ".authority-control",
  ".mw-authority-control",
  ".asbox",
  ".stub",
  ".catlinks",
  ".printfooter",
  ".mw-indicators",
  "#coordinates",
  "#toc",
  ".toc",
].join(",");

const REFERENCE_SECTION_TITLES =
  /^(references|notes|citations|sources|bibliography|footnotes|works cited|notes and references|references and notes|explanatory notes|general references|further reading)$/i;
const LINK_SECTION_TITLES = /^(external links|links)$/i;
const REFERENCE_CONTAINERS = ".mw-references-wrap, .reflist, ol.references, .refbegin";

const STRIPPED_STYLE_PROPERTIES = new Set([
  "color",
  "background",
  "background-color",
  "background-image",
  "border-color",
  "font-family",
  "font-size",
  "float",
  "clear",
  "width",
  "min-width",
  "max-width",
  "height",
  "margin",
  "margin-left",
  "margin-right",
  "margin-top",
  "margin-bottom",
]);

const SUPERSCRIPTS: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "-": "⁻", "−": "⁻", "+": "⁺",
};

const CJK_LANGUAGES = new Set(["zh", "ja", "ko", "th", "yue", "wuu", "lzh"]);

const isElement = (node: AnyNode): node is Element =>
  node.type === "tag" || node.type === "script" || node.type === "style";

interface Context {
  $: cheerio.CheerioAPI;
  wiki: string;
  slug: string;
  namespaces: Set<string>;
  media: MediaItem[];
  footnoteLabels: Map<string, string>;
  sectionId: string;
}

// ---- links ----------------------------------------------------------------

function articleRoute(slug: string, title: string, fragment = ""): string {
  return `/read/${slug}/${encodeURIComponent(titleToPath(title))}${fragment}`;
}

function isNamespaced(title: string, namespaces: Set<string>): boolean {
  const colon = title.indexOf(":");
  return colon > 0 && namespaces.has(title.slice(0, colon).toLowerCase());
}

function rewriteLinks(ctx: Context, $root: cheerio.Cheerio<Element>) {
  const { $ } = ctx;

  // <area> comes from clickable image maps.
  $root.find("a, area").each((_, anchor) => {
    const $a = $(anchor);
    const href = ($a.attr("href") || "").trim();

    // Red links point at pages that do not exist yet; show plain text.
    if ($a.hasClass("new") || href.includes("redlink=1")) {
      if (anchor.tagName === "area") $a.removeAttr("href");
      else $a.replaceWith($("<span>").text($a.text()));
      return;
    }

    if (!href || href.startsWith("#")) return;

    if (href.startsWith("/wiki/") || href.startsWith("./")) {
      const raw = href.startsWith("/wiki/") ? href.slice(6) : href.slice(2);
      const [path, fragment] = raw.split("#");
      const title = pathToTitle(path);

      if (isNamespaced(title, ctx.namespaces)) {
        // File:, Category:, Help: … pages live on the wiki itself.
        markExternal($a, wikiArticleUrl(ctx.wiki, title), "wiki-ns");
      } else {
        $a.attr("href", articleRoute(ctx.slug, title, fragment ? `#${fragment}` : ""));
        $a.attr("data-wiki-title", title);
        $a.attr("data-wiki", ctx.wiki);
        $a.removeAttr("title").removeAttr("target").removeAttr("rel");
      }
      return;
    }

    const absolute = absoluteUrl(href)!;
    if (!/^https?:\/\//i.test(absolute)) {
      $a.removeAttr("href");
      return;
    }

    // Interlanguage links ({{ill}}) and links to sister wikis stay in the app.
    const target = parseWikiUrl(absolute);
    if (target && new URL(absolute).pathname.startsWith("/wiki/") && !target.title.includes(":")) {
      $a.attr("href", articleRoute(wikiSlug(target.wiki), target.title));
      $a.attr("data-wiki-title", target.title);
      $a.attr("data-wiki", target.wiki);
      $a.removeAttr("target").removeAttr("rel");
      return;
    }

    markExternal($a, absolute);
  });
}

function markExternal($a: cheerio.Cheerio<Element>, href: string, className = "external") {
  $a.attr("href", href);
  $a.attr("target", "_blank");
  $a.attr("rel", "noopener noreferrer nofollow");
  $a.removeClass("external").addClass(className);
}

// ---- sanitizing -----------------------------------------------------------

function sanitize(ctx: Context, $root: cheerio.Cheerio<Element>) {
  const { $ } = ctx;
  $root.find(REMOVE_SELECTORS).remove();

  // Formulas ship as hidden MathML plus an SVG image. Keep the image: it is
  // what MediaWiki shows by default, and the MathML can triple the page size.
  $root.find(".mwe-math-element").each((_, el) => {
    const $math = $(el);
    const $image = $math.find("img[class*='mwe-math-fallback-image']");
    if ($image.length) {
      $math.find(".mwe-math-mathml-a11y, .mwe-math-mathml-inline, .mwe-math-mathml-display").remove();
      // The MathML was the accessible version; let screen readers use the TeX alt text instead.
      $image.removeAttr("aria-hidden");
    }
  });

  $root.find("*").addBack().each((_, el) => {
    if (!isElement(el)) return;
    for (const name of Object.keys(el.attribs)) {
      if (name.startsWith("on") || name === "srcdoc" || name === "formaction") {
        delete el.attribs[name];
      }
    }

    // Image sizing (e.g. formulas measured in ex units) must stay as authored.
    const style = el.attribs.style;
    if (!style || el.tagName === "img") return;

    const declarations = style.split(";").map((declaration: string) => declaration.trim()).filter(Boolean);
    const kept = declarations.filter((declaration: string) => {
      const property = declaration.split(":")[0]?.trim().toLowerCase();
      return property && !STRIPPED_STYLE_PROPERTIES.has(property);
    });
    if (kept.length === declarations.length) return;

    // Colour swatches (empty cells, legend boxes) carry meaning; keep them intact.
    if (el.children.length === 0 || !$(el).text().trim()) return;

    if (kept.length) el.attribs.style = kept.join("; ");
    else delete el.attribs.style;
  });
}

// ---- footnotes ------------------------------------------------------------

function rewriteFootnoteRefs(ctx: Context, $root: cheerio.Cheerio<Element>) {
  const { $ } = ctx;
  $root.find("sup.reference").each((_, sup) => {
    const $sup = $(sup);
    const href = $sup.find("a").attr("href") || "";
    if (!href.startsWith("#")) {
      $sup.remove();
      return;
    }
    const id = href.slice(1);
    const label = $sup.text().replace(/[[\]]/g, "").trim();
    if (!ctx.footnoteLabels.has(id)) ctx.footnoteLabels.set(id, label);

    const $link = $("<a>").attr("href", href).attr("data-fn", id).text(label);
    $sup.replaceWith($("<sup>").addClass("fn").append($link));
  });
}

function extractFootnotes($: cheerio.CheerioAPI, labels: Map<string, string>): Footnote[] {
  const footnotes: Footnote[] = [];
  const seen = new Set<string>();

  $("ol.references > li[id]").each((index, li) => {
    const $li = $(li);
    const id = $li.attr("id")!;
    if (seen.has(id)) return;
    seen.add(id);

    $li.find(".mw-cite-backlink").remove();
    const $text = $li.find(".reference-text").first();
    const text = ($text.length ? $text : $li).text().replace(/\s+/g, " ").trim();
    if (!text) return;

    const externalHref = $li.find("a.external[href], a[href^='http'], a[href^='//']").first().attr("href");
    footnotes.push({
      id,
      label: labels.get(id) || String(index + 1),
      text: text.length > 700 ? `${text.slice(0, 700)}…` : text,
      url: externalHref ? absoluteUrl(externalHref) : null,
    });
  });

  return footnotes;
}

// ---- infobox --------------------------------------------------------------

function extractInfobox($: cheerio.CheerioAPI): InfoboxRow[] {
  const rows: InfoboxRow[] = [];
  const $infobox = $("table.infobox").first();
  if (!$infobox.length) return rows;

  $infobox.find("tr").each((_, tr) => {
    const $tr = $(tr);
    const $label = $tr.children("th").first();
    const $value = $tr.children("td").first();
    if (!$label.length || !$value.length) return;

    $value.find("sup.reference, style, .noprint, .mw-editsection").remove();
    // Keep exponents readable in plain text: 10<sup>22</sup> → 10²²
    $value.find("sup").each((__, sup) => {
      const text = $(sup).text().trim();
      if (/^[-−+0-9]+$/.test(text)) $(sup).replaceWith([...text].map((ch) => SUPERSCRIPTS[ch] ?? ch).join(""));
    });
    $value.find("br").replaceWith(" · ");
    $value.find("li").each((__, li) => {
      $(li).append(" · ");
    });

    const label = $label.text().replace(/\s+/g, " ").trim();
    const value = $value
      .text()
      .replace(/\s+/g, " ")
      .replace(/(\s·\s*)+$/g, "")
      .replace(/(\s·\s){2,}/g, " · ")
      .trim();

    if (label && value && label.length < 60 && value.length > 0) {
      rows.push({ label, value: value.length > 220 ? `${value.slice(0, 220)}…` : value });
    }
  });

  return rows.slice(0, 14);
}

// ---- media ----------------------------------------------------------------

/** Splits "Datei:Mond.jpg" into a display name and a link to its file page. */
function fileInfo(ctx: Context, rawTitle: string): { file: string; filePage: string } {
  const title = pathToTitle(rawTitle);
  const colon = title.indexOf(":");
  const hasNamespace = colon > 0 && ctx.namespaces.has(title.slice(0, colon).toLowerCase());
  return {
    file: hasNamespace ? title.slice(colon + 1) : title,
    // "File:" is a canonical alias that works on every wiki.
    filePage: wikiArticleUrl(ctx.wiki, hasNamespace ? title : `File:${title}`),
  };
}

function readSources(ctx: Context, $media: cheerio.Cheerio<Element>): { sources: MediaSource[]; width: number; height: number } {
  const { $ } = ctx;
  let width = 0;
  let height = 0;
  const sources: MediaSource[] = [];

  $media.find("source").each((_, source) => {
    const $source = $(source);
    const src = absoluteUrl($source.attr("src"));
    if (!src) return;
    const type = ($source.attr("type") || "").split(";")[0].trim();
    sources.push({ src, type });
    width = Math.max(width, Number($source.attr("data-width")) || 0);
    height = Math.max(height, Number($source.attr("data-height")) || 0);
    $source.attr("src", src);
  });

  // Browsers pick the first playable source; put widely supported formats first.
  const rank = (type: string) => (type.includes("webm") ? 0 : type.includes("mp4") ? 1 : type.includes("mpeg") ? 2 : 3);
  sources.sort((a, b) => rank(a.type) - rank(b.type));
  return { sources, width, height };
}

function processTimedMedia(ctx: Context, $media: cheerio.Cheerio<Element>, caption: string): MediaItem | null {
  const element = $media.get(0);
  if (!element) return null;

  const isVideo = element.tagName === "video";
  const { file, filePage } = fileInfo(ctx, $media.attr("data-mwtitle") || "");
  const { sources, width, height } = readSources(ctx, $media);
  if (!sources.length) return null;

  const rawPoster = $media.attr("poster");
  const poster = rawPoster ? resizeThumb(rawPoster, 960, width || 960) : null;
  const durationSeconds = Number($media.attr("data-durationhint")) || null;
  const id = `m${ctx.media.length + 1}`;

  const tracks = $media
    .find("track")
    .toArray()
    .map((track) => ctx.$(track))
    .map(($track) => ({
      src: absoluteUrl($track.attr("src")),
      kind: $track.attr("kind") || "subtitles",
      srclang: $track.attr("srclang") || "",
      label: ($track.attr("label") || "").replace(/[‪-‮]/g, "").trim(),
    }))
    .filter((track) => track.src);

  // Rebuild in place so only attributes we control survive.
  element.attribs = { controls: "", preload: isVideo ? "none" : "metadata", "data-media-id": id };
  if (isVideo) {
    element.attribs.playsinline = "";
    if (poster) element.attribs.poster = poster;
    if (width && height) {
      element.attribs.width = String(width);
      element.attribs.height = String(height);
    }
  }
  $media.empty();
  for (const source of sources) {
    $media.append(ctx.$("<source>").attr("src", source.src).attr("type", source.type));
  }
  for (const track of tracks) {
    $media.append(
      ctx.$("<track>").attr("src", track.src!).attr("kind", track.kind).attr("srclang", track.srclang).attr("label", track.label)
    );
  }

  return {
    id,
    type: isVideo ? "video" : "audio",
    file,
    caption,
    src: sources[0].src,
    thumb: poster ?? "",
    width,
    height,
    poster,
    sources,
    durationSeconds,
    sectionId: ctx.sectionId,
    filePage,
  };
}

/** A thumbnail-CDN rendition near `width`, never larger than the original file. */
function imageAt(src: string, width: number, fileWidth: number): string {
  if (!src.includes("/thumb/") || !fileWidth) return src;
  return resizeThumb(src, width, fileWidth) ?? src;
}

function processImage(ctx: Context, $img: cheerio.Cheerio<Element>, caption: string, inFigure: boolean): MediaItem | null {
  const src = absoluteUrl($img.attr("src"));
  if (!src) return null;

  const fileWidth = Number($img.attr("data-file-width")) || 0;
  const fileHeight = Number($img.attr("data-file-height")) || 0;
  const displayWidth = Number($img.attr("width")) || fileWidth;
  const displayHeight = Number($img.attr("height")) || fileHeight;

  // Tiny images (icons, flags) are decoration, not media.
  if (displayWidth && displayWidth < 60 && !inFigure) return null;

  const anchorHref = $img.parent("a").attr("href") || "";
  const fallbackName = decodeURIComponent(src.split("?")[0].split("/").pop() || "").replace(/^(?:[a-z-]+-)?\d+px-/i, "");
  const { file, filePage } = fileInfo(ctx, anchorHref.replace(/^(\.\/|\/wiki\/)/, "") || fallbackName);

  const id = `m${ctx.media.length + 1}`;
  $img.attr("data-media-id", id);
  $img.attr("loading", "lazy");
  $img.attr("decoding", "async");
  $img.attr("alt", $img.attr("alt") || caption.slice(0, 160));
  $img.removeAttr("srcset");

  // Image maps use pixel coordinates, so those images must keep their size.
  if (inFigure && fileWidth && !$img.attr("usemap")) {
    // Wikipedia thumbs are ~250px; the reading column is ~720px.
    const bodyWidth = Math.min(fileWidth, 960);
    const ratio = fileHeight && fileWidth ? fileHeight / fileWidth : displayHeight / displayWidth || 0.66;
    $img.attr("src", imageAt(src, 960, fileWidth));
    const candidates = [500, 960, 1280].filter((w) => w < fileWidth && snapThumbWidth(w, fileWidth) === w);
    if (src.includes("/thumb/") && candidates.length > 1) {
      $img.attr("srcset", candidates.map((w) => `${resizeThumb(src, w, fileWidth)} ${w}w`).join(", "));
      $img.attr("sizes", "(max-width: 760px) 100vw, 720px");
    }
    $img.attr("width", String(bodyWidth));
    $img.attr("height", String(Math.round(bodyWidth * ratio)));
  } else {
    $img.attr("src", src);
  }

  for (const attr of ["data-file-width", "data-file-height", "data-file-type", "resource", "typeof"]) {
    $img.removeAttr(attr);
  }

  return {
    id,
    type: "image",
    file,
    caption,
    src: imageAt(src, 1920, fileWidth),
    thumb: imageAt(src, 500, fileWidth),
    width: fileWidth || displayWidth,
    height: fileHeight || displayHeight,
    poster: null,
    sources: [],
    durationSeconds: null,
    sectionId: ctx.sectionId,
    filePage,
  };
}

/** Like $root.find(selector), but also matches $root itself. */
function within($root: cheerio.Cheerio<Element>, selector: string): cheerio.Cheerio<Element> {
  return $root.find(selector).addBack(selector) as cheerio.Cheerio<Element>;
}

function processMedia(ctx: Context, $root: cheerio.Cheerio<Element>) {
  const { $ } = ctx;

  // Older markup: <div class="thumb"><div class="thumbinner">…<div class="thumbcaption">.
  // Converted in place so a top-level block keeps its identity.
  within($root, "div.thumb").each((_, div) => {
    const $div = $(div);
    const $caption = $div.find(".thumbcaption").first();
    $caption.find(".magnify").remove();
    const $media = $div.find("img, video, audio").first();
    const $content = $media.parent("a").length ? $media.parent("a") : $media;
    const captionHtml = $caption.html();

    div.name = "figure";
    div.attribs = {};
    $div.empty().append($content);
    if (captionHtml) $div.append($("<figcaption>").html(captionHtml));
  });

  within($root, "figure, li.gallerybox").each((_, container) => {
    const $container = $(container);
    const inFigure = container.tagName === "figure";
    const caption = (inFigure ? $container.children("figcaption") : $container.find(".gallerytext"))
      .text()
      .replace(/\s+/g, " ")
      .trim();

    let item: MediaItem | null = null;
    const $timed = $container.find("video, audio").first();
    if ($timed.length) {
      item = processTimedMedia(ctx, $timed, caption);
    } else {
      const $img = $container.find("img").first();
      if ($img.length) item = processImage(ctx, $img, caption, true);
    }

    if (item) {
      ctx.media.push(item);
      $container.attr("data-media-id", item.id);
      $container.addClass(`media-${item.type}`);
    }
    $container.removeAttr("style").removeAttr("typeof");
  });

  // Inline players outside figures still get clean markup.
  within($root, "video:not([data-media-id]), audio:not([data-media-id])").each((_, el) => {
    const item = processTimedMedia(ctx, $(el), "");
    if (item) ctx.media.push(item);
  });

  within($root, "img:not([data-media-id])").each((_, img) => {
    const $img = $(img);
    const src = absoluteUrl($img.attr("src"));
    if (src) $img.attr("src", src);
    $img.removeAttr("srcset").attr("loading", "lazy").attr("decoding", "async");
  });
}

// ---- tables ---------------------------------------------------------------

function wrapTables(ctx: Context, $root: cheerio.Cheerio<Element>) {
  const { $ } = ctx;
  $root.find("table").addBack("table").each((_, table) => {
    const $table = $(table);
    if ($table.parents("table").length || $table.parent().hasClass("table-scroll")) return;
    $table.wrap('<div class="table-scroll"></div>');
  });
}

// ---- sections -------------------------------------------------------------

function flattenBlocks($: cheerio.CheerioAPI, nodes: AnyNode[]): Element[] {
  const blocks: Element[] = [];
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (node.tagName === "section") blocks.push(...flattenBlocks($, $(node).contents().toArray()));
    else blocks.push(node);
  }
  return blocks;
}

function headingInfo($: cheerio.CheerioAPI, el: Element): { level: number; title: string; id: string } | null {
  const $el = $(el);
  const $heading = /^h[1-6]$/.test(el.tagName)
    ? $el
    : $el.hasClass("mw-heading")
      ? $el.find("h1, h2, h3, h4, h5, h6").first()
      : null;
  if (!$heading?.length) return null;

  const tag = ($heading.prop("tagName") as string).toLowerCase();
  const $headline = $heading.find(".mw-headline").first();
  const title = ($headline.length ? $headline : $heading).text().replace(/\s+/g, " ").trim();
  const id = $heading.attr("id") || $headline.attr("id") || title.replace(/\s+/g, "_");
  return { level: Number(tag[1]), title, id };
}

function textOf(html: string): string {
  return cheerio.load(`<div>${html}</div>`)("div").text().replace(/\s+/g, " ").trim();
}

type SectionKind = "content" | "references" | "links";

function classifySection(title: string, html: string): { kind: SectionKind; html: string; links: ExternalLink[] } {
  const $section = cheerio.load(`<div id="root">${html}</div>`);
  const $root = $section("#root");

  if (!title) return { kind: "content", html, links: [] };
  if (REFERENCE_SECTION_TITLES.test(title)) return { kind: "references", html: "", links: [] };

  const anchors = $root.find("a[href]").not("figure a, .gallerybox a").toArray();
  const external = anchors.filter((a) => $section(a).hasClass("external"));
  const longParagraph = $root.find("p").toArray().some((p) => $section(p).text().trim().length > 200);
  const looksLikeLinkList = anchors.length >= 3 && external.length / anchors.length >= 0.8 && !longParagraph;

  if (LINK_SECTION_TITLES.test(title) || looksLikeLinkList) {
    const links = external
      .map((a) => ({ label: $section(a).text().replace(/\s+/g, " ").trim(), url: $section(a).attr("href") || "" }))
      .filter((link) => link.label && link.url.startsWith("http"))
      .slice(0, 30);
    return { kind: "links", html: "", links };
  }

  if ($root.find(REFERENCE_CONTAINERS).length) {
    $root.find(REFERENCE_CONTAINERS).remove();
    if ($root.text().trim().length < 40) return { kind: "references", html: "", links: [] };
    return { kind: "content", html: $root.html() || "", links: [] };
  }

  return { kind: "content", html, links: [] };
}

function buildSections(ctx: Context, $content: cheerio.Cheerio<Element>) {
  const { $ } = ctx;
  const blocks = flattenBlocks($, $content.contents().toArray());
  const usedIds = new Set<string>();

  interface Draft {
    section: WikiSection;
    parts: string[];
  }

  const lead: Draft = { section: { id: "lead", title: "", level: 1, html: "", subsections: [] }, parts: [] };
  const drafts: Draft[] = [lead];

  for (const block of blocks) {
    const heading = headingInfo($, block);
    if (heading) {
      let id = heading.id;
      for (let n = 2; usedIds.has(id); n++) id = `${heading.id}_${n}`;
      usedIds.add(id);
      ctx.sectionId = id;
      drafts.push({
        section: { id, title: heading.title, level: Math.max(2, heading.level), html: "", subsections: [] },
        parts: [],
      });
      continue;
    }

    const $block = $(block);
    if ($block.is("p") && !$block.text().trim() && !$block.find("img, video, audio").length) continue;

    processMedia(ctx, $block);
    rewriteFootnoteRefs(ctx, $block);
    rewriteLinks(ctx, $block);
    wrapTables(ctx, $block);

    // A top-level table is now inside its scroll wrapper; serialize the wrapper.
    const $out = $block.parent().hasClass("table-scroll") ? $block.parent() : $block;
    const html = $.html($out);
    if (html.trim()) drafts[drafts.length - 1].parts.push(html);
  }

  const externalLinks: ExternalLink[] = [];
  const flat: WikiSection[] = [];

  for (const draft of drafts) {
    const classified = classifySection(draft.section.title, draft.parts.join("\n"));
    externalLinks.push(...classified.links);
    if (classified.kind !== "content") {
      // A dropped heading also drops its children ("References" > "Citations").
      draft.section.level = draft.section.level * -1;
    }
    draft.section.html = classified.html;
    flat.push(draft.section);
  }

  // Nest by heading level, skipping dropped sections and everything under them.
  const roots: WikiSection[] = [];
  const stack: WikiSection[] = [];
  let droppedLevel = 0;

  for (const section of flat) {
    if (section.id === "lead") {
      roots.push(section);
      continue;
    }

    const level = Math.abs(section.level);
    if (droppedLevel && level > droppedLevel) continue;
    droppedLevel = 0;

    if (section.level < 0) {
      droppedLevel = level;
      continue;
    }

    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    if (stack.length) stack[stack.length - 1].subsections.push(section);
    else roots.push(section);
    stack.push(section);
  }

  const prune = (sections: WikiSection[]): WikiSection[] =>
    sections
      .map((section) => ({ ...section, subsections: prune(section.subsections) }))
      .filter((section) => section.html.trim() || section.subsections.length);

  return { sections: prune(roots), externalLinks };
}

function countWords(sections: WikiSection[], lang: string): number {
  let total = 0;
  const walk = (list: WikiSection[]) => {
    for (const section of list) {
      const text = textOf(section.html);
      total += CJK_LANGUAGES.has(lang) ? Math.round(text.replace(/\s/g, "").length / 2) : text.split(/\s+/).filter(Boolean).length;
      walk(section.subsections);
    }
  };
  walk(sections);
  return total;
}

export function buildArticle(input: BuildArticleInput): WikiArticle {
  const $ = cheerio.load(input.html);
  let $content = $(".mw-parser-output").first();
  if (!$content.length) $content = $("body");

  const ctx: Context = {
    $,
    wiki: input.wiki,
    slug: wikiSlug(input.wiki),
    namespaces: new Set(input.namespaces),
    media: [],
    footnoteLabels: new Map(),
    sectionId: "lead",
  };

  const infobox = extractInfobox($);
  $content.find("table.infobox, table.sidebar, .infobox, .sidebar").remove();

  sanitize(ctx, $content);
  const { sections, externalLinks } = buildSections(ctx, $content);
  const footnotes = extractFootnotes($, ctx.footnoteLabels);

  const lang = input.summary?.lang || wikiLanguage(input.wiki);
  const wordCount = countWords(sections, lang);

  return {
    wiki: input.wiki,
    title: input.summary?.title || input.title,
    description: input.summary?.description ?? "",
    extract: input.summary?.extract ?? "",
    lang,
    dir: input.summary?.dir || languageDirection(lang),
    image: input.summary?.image ?? null,
    sections,
    footnotes,
    infobox,
    media: ctx.media,
    languages: input.languages,
    externalLinks: dedupeLinks(externalLinks),
    wordCount,
    readingMinutes: Math.max(1, Math.round(wordCount / (CJK_LANGUAGES.has(lang) ? 400 : 230))),
    lastEdited: input.lastEdited,
    revisionId: input.revisionId,
    sourceUrl: wikiArticleUrl(input.wiki, input.title),
  };
}

function dedupeLinks(links: ExternalLink[]): ExternalLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}
