import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "wiki-asterisk-web-opening-test-"));
process.env.DATABASE_FILE = ":memory:";

const { assemble } = await import("../server/web/extract.ts");

const SUMMARY = "If you collected lists of techniques for doing great work in a lot of different fields, what would the intersection look like? I decided to find out by making it.";

function page(contentHtml: string, description = SUMMARY) {
  const article = assemble({
    title: "How to Do Great Work",
    contentHtml,
    url: "https://essays.example.com/greatwork.html",
    description,
    image: null,
    site: "Essays",
    byline: "",
    published: null,
    lang: "en",
  });
  return { article, html: article.sections.map((section) => section.html).join("\n") };
}

describe("a page's opening, when the header already shows it", () => {
  // The shape of a real essay page: the title as a picture, a date line, then the opening paragraph.
  const essay = `
    <div id="readability-page-1" class="page">
      <img src="/title.gif" width="185" height="18" alt="How to Do Great Work">
      <p>July 2023</p>
      <p>If you collected lists of techniques for doing great work in a lot
      of different fields, what would the intersection look like? I decided
      to find out by making it.</p>
      <p>Partly my goal was to create a guide that could be used by someone working in any field.</p>
    </div>`;

  test("drops the title picture and the paragraph that is the summary line", () => {
    const { html } = page(essay);
    assert.doesNotMatch(html, /title\.gif/);
    assert.doesNotMatch(html, /If you collected lists/);
  });

  test("keeps the date line and the rest of the page", () => {
    const { html } = page(essay);
    assert.match(html, /<p>July 2023<\/p>/);
    assert.match(html, /Partly my goal was to create a guide/);
  });

  test("does not count the dropped picture as a gallery image", () => {
    const { article } = page(essay);
    assert.equal(article.media.length, 0);
  });

  test("removes a link or paragraph that held only the title picture", () => {
    const { html } = page(`<p><a href="/"><img src="/title.gif" alt="How to Do Great Work"></a></p><p>Body text of the essay goes here and carries on for a while.</p>`);
    assert.doesNotMatch(html, /<a |<img/);
    assert.match(html, /Body text of the essay/);
  });

  test("leaves a picture alone when its alt text isn't the title", () => {
    const { html } = page(`<img src="/chart.png" alt="A chart of output over time"><p>Body text of the essay goes here and carries on for a while.</p>`);
    assert.match(html, /chart\.png/);
  });

  test("keeps a first paragraph that only starts like the summary", () => {
    const longer = `${SUMMARY} And then it carries on with a good deal more that the summary line does not show.`;
    const { html } = page(`<p>${longer}</p><p>Second paragraph of the essay goes on.</p>`);
    assert.match(html, /carries on with a good deal more/);
  });

  test("keeps a first paragraph longer than the header can show, so no text is lost", () => {
    const long = `${"A long opening paragraph that runs on and on. ".repeat(10)}`.trim();
    const { html } = page(`<p>${long}</p><p>Second paragraph.</p>`, long);
    assert.match(html, /A long opening paragraph/);
  });

  test("never drops a short paragraph that happens to equal a short summary", () => {
    const { html } = page(`<p>Short.</p><p>The real article starts here and goes on.</p>`, "Short.");
    assert.match(html, /<p>Short\.<\/p>/);
  });

  test("leaves everything alone when the summary is not in the page", () => {
    const { html } = page(`<p>An entirely different opening paragraph that is not the summary line at all.</p><p>More.</p>`);
    assert.match(html, /An entirely different opening paragraph/);
  });
});
