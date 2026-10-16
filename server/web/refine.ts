import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { WikiArticle } from "../../shared/types.js";
import { decide as defaultDecide, decideEach, type Decide } from "../ai/decisions.js";

/*
 * A second pass over a web page after reader-mode extraction. Readability keeps most clutter out,
 * but some always slips through at the edges of an article: share buttons, newsletter prompts,
 * author bios, photo credits, avatars, logos and ads. The decision model reads the doubtful
 * blocks and every image (by its file name, size, alt text and caption) and the clear clutter is
 * removed. It also notices pages that show only the start of an article behind a paywall.
 *
 * Only removes what the model is fairly sure about, and any failure leaves the page as it was.
 */

const isElement = (node: AnyNode): node is Element => node.type === "tag";
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** Blocks this short at the start or end of a page are where clutter collects. */
const SHORT_BLOCK = 400;
const LEADING = 5;
const TRAILING = 8;
const MAX_IMAGES = 20;

/** Remove only what the model is fairly sure is clutter. */
const KEEP_BELOW = 0.25;
/** Call a page a paywalled preview only when the model is quite sure. */
const PREVIEW_ABOVE = 0.7;
/** The clean-up runs before a page's first open is shown, so it never holds the page up for long. */
const TIMEOUT_MS = 2500;

interface Block {
  section: number;
  el: Element;
  text: string;
}

function describeImage($: cheerio.CheerioAPI, img: Element): string {
  const $img = $(img);
  const src = $img.attr("src") ?? "";
  const file = decodeURIComponent(src.split(/[?#]/)[0].split("/").pop() ?? "") || "unknown";
  const width = $img.attr("width");
  const height = $img.attr("height");
  const alt = squash($img.attr("alt") ?? "");
  const caption = squash($img.closest("figure").find("figcaption").first().text());
  return [
    `file ${file.slice(0, 120)}`,
    width && height ? `${width}x${height} pixels` : "",
    alt ? `alt text "${alt.slice(0, 200)}"` : "no alt text",
    caption ? `caption "${caption.slice(0, 200)}"` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

export async function refineWebArticle(article: WikiArticle, { decide = defaultDecide }: { decide?: Decide } = {}): Promise<WikiArticle> {
  if (article.kind !== "web") return article;

  const docs = article.sections.map((section) => cheerio.load(section.html, null, false));

  // Top-level blocks in reading order (a list counts once, not once per item).
  const blocks: Block[] = [];
  docs.forEach(($, section) => {
    $("p, ul, ol, blockquote").each((_, el) => {
      if (!isElement(el) || $(el).parents("p, ul, ol, blockquote").length) return;
      const text = squash($(el).text());
      if (text) blocks.push({ section, el, text });
    });
  });
  const edges = new Set([...blocks.slice(0, LEADING), ...blocks.slice(-TRAILING)]);
  const doubtful = blocks.filter((block) => edges.has(block) && block.text.length <= SHORT_BLOCK);

  const images: { section: number; el: Element; description: string }[] = [];
  docs.forEach(($, section) => {
    $("img").each((_, el) => {
      if (isElement(el) && images.length < MAX_IMAGES) images.push({ section, el, description: describeImage($, el) });
    });
  });

  const title = article.title;
  const allText = blocks.map((block) => block.text).join("\n");

  const [blockVerdicts, imageVerdicts, preview] = await Promise.allSettled([
    decideEach(
      "page clean-up",
      `Blocks of text extracted from a web page titled "${title}", numbered:`,
      doubtful.map((block) => block.text),
      {
        instructions: (n) =>
          `Is block ${n} part of the article's own text, rather than navigation, sharing buttons, ads, subscription prompts, author bios, related links, comments or photo credits?`,
        criteria: { true: "Part of the article itself", false: "Page clutter around the article" },
      },
      { decide, timeoutMs: TIMEOUT_MS }
    ),
    decideEach(
      "page images",
      `Images on a web page titled "${title}", numbered:`,
      images.map((image) => image.description),
      {
        instructions: (n) => `Does image ${n} illustrate the article's subject, rather than being a logo, avatar, icon, advertisement or decoration?`,
        criteria: { true: "Illustrates the article", false: "Logo, avatar, icon, ad or decoration" },
      },
      { decide, timeoutMs: TIMEOUT_MS }
    ),
    allText.length
      ? decide(
          "paywall check",
          `A web page titled "${title}", about ${article.wordCount} words long, as extracted for a reading app.\n\nIt begins:\n${allText.slice(0, 1500)}\n\nIt ends:\n${allText.slice(-700)}`,
          {
            preview: {
              type: "noul",
              instructions:
                "Does the page show only the beginning of the article, cut off by a paywall, a sign-up or log-in wall, or a 'subscribe to keep reading' prompt?",
              criteria: { true: "Only a preview of the article", false: "The whole article (or a complete short piece)" },
            },
          },
          { timeoutMs: TIMEOUT_MS }
        )
      : Promise.reject(new Error("empty page")),
  ]);

  let removedBlocks = 0;
  if (blockVerdicts.status === "fulfilled") {
    doubtful.forEach((block, index) => {
      if ((blockVerdicts.value[index] ?? 1) < KEEP_BELOW) {
        docs[block.section](block.el).remove();
        removedBlocks += 1;
      }
    });
  }

  const droppedMedia = new Set<string>();
  if (imageVerdicts.status === "fulfilled") {
    images.forEach((image, index) => {
      if ((imageVerdicts.value[index] ?? 1) >= KEEP_BELOW) return;
      const $ = docs[image.section];
      const $img = $(image.el);
      const id = $img.attr("data-media-id");
      if (id) {
        droppedMedia.add(id);
        $(`[data-media-id="${id}"]`).remove();
      } else {
        $img.remove();
      }
    });
  }

  // A link or paragraph left holding nothing goes too (but not in-page anchors, which footnotes jump to).
  if (removedBlocks || droppedMedia.size) {
    docs.forEach(($) => {
      $("a, p, figure").each((_, el) => {
        const $el = $(el);
        if (!$el.attr("id") && !squash($el.text()) && !$el.find("img, video, audio, iframe, svg, [id]").length) $el.remove();
      });
    });
  }

  const isPreview = preview.status === "fulfilled" && preview.value.preview.noul >= PREVIEW_ABOVE;
  if (removedBlocks || droppedMedia.size || isPreview) {
    console.log(`[refine] ${title}: removed ${removedBlocks} block(s), ${droppedMedia.size} image(s)${isPreview ? ", looks like a preview" : ""}`);
  }

  return {
    ...article,
    sections: article.sections.map((section, index) => ({ ...section, html: docs[index].html() })),
    media: article.media.filter((item) => !droppedMedia.has(item.id)),
    ...(isPreview ? { notice: "preview" as const } : {}),
  };
}
