import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "wiki-asterisk-web-test-"));
process.env.DATABASE_FILE = ":memory:";

const { assertFetchableUrl, isPublicAddress } = await import("../server/web/safe-fetch.ts");
const { assemble } = await import("../server/web/extract.ts");
const { canonicalUrl } = await import("../server/web/routes.ts");

describe("link safety", () => {
  test("blocks private, loopback, link-local and metadata addresses", () => {
    for (const address of ["127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.1.10", "169.254.169.254", "100.64.1.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      assert.equal(isPublicAddress(address), false, address);
    }
    for (const address of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"]) {
      assert.equal(isPublicAddress(address), true, address);
    }
  });

  test("refuses unsafe links before fetching", () => {
    const refused = (url: string) => assert.throws(() => assertFetchableUrl(url), url);
    refused("ftp://example.com/file");
    refused("file:///etc/passwd");
    refused("http://localhost/admin");
    refused("http://printer.local/");
    refused("http://user:pass@example.com/");
    refused("http://example.com:8080/");
    refused("http://[::1]/");
    refused("http://169.254.169.254/latest/meta-data");
    assert.equal(assertFetchableUrl("https://example.com/post").hostname, "example.com");
  });

  test("normalizes shared links for caching", () => {
    assert.equal(
      canonicalUrl("https://mindslice.substack.com/p/post?r=6te2l3&utm_medium=ios&utm_source=x#comments"),
      "https://mindslice.substack.com/p/post"
    );
    assert.equal(canonicalUrl("https://example.com/a?id=7&utm_campaign=z"), "https://example.com/a?id=7");
  });
});

describe("web article extraction", () => {
  const article = assemble({
    title: "Every Supply Chain",
    url: "https://blog.example.com/p/supply",
    description: "Where things come from.",
    image: "https://cdn.example.com/cover.jpg",
    site: "Example Blog",
    byline: "  Vincent   Huang ",
    published: "2026-05-15T07:38:21Z",
    lang: "en",
    contentHtml: `
      <div class="post"><h1>Every Supply Chain</h1>
        <p>Intro paragraph about <a href="https://en.wikipedia.org/wiki/Fertilizer">fertilizer</a> and <a href="/p/other" onclick="steal()">another post</a>.<sup><a href="#footnote-1" id="footnote-anchor-1">1</a></sup></p>
        <div class="subscription-widget"><p>Subscribe for more</p><button>Subscribe</button></div>
        <p><strong>i. fossil fuels</strong></p>
        <p style="color:red">Coal, oil and gas.</p>
        <figure><img src="/img/map.png" srcset="/img/map-400.png 400w, /img/map-1200.png 1200w" alt="A map"><figcaption>Where coal is mined</figcaption></figure>
        <script>alert(1)</script>
        <iframe src="https://evil.example/tracker"></iframe>
        <iframe src="https://www.youtube.com/embed/abc123"></iframe>
        <p><strong>ii. metals</strong></p>
        <p>Copper and lithium.</p>
        <div class="footnote"><a id="footnote-1" href="#footnote-anchor-1">1</a> A note.</div>
      </div>`,
  });
  const html = article.sections.map((section) => section.html).join("\n");

  test("keeps metadata and marks the page as a web article", () => {
    assert.equal(article.kind, "web");
    assert.equal(article.wiki, "web:blog.example.com");
    assert.equal(article.byline, "Vincent Huang");
    assert.equal(article.site, "Example Blog");
    assert.equal(article.lastEdited, "2026-05-15T07:38:21.000Z");
  });

  test("turns bold one-line paragraphs into sections and drops the repeated title", () => {
    assert.deepEqual(
      article.sections.map((section) => section.title),
      ["", "i. fossil fuels", "ii. metals"]
    );
    assert.doesNotMatch(html, /<h1>/);
  });

  test("removes scripts, handlers, inline styles, clutter and unknown iframes", () => {
    assert.doesNotMatch(html, /<script|onclick|style=|Subscribe|evil\.example/);
    assert.match(html, /<div class="embed"><iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/abc123"/);
  });

  test("rewrites links: wiki links stay in the app, others open safely, footnotes stay in-page", () => {
    assert.match(html, /href="\/read\/en\/Fertilizer" data-wiki-title="Fertilizer"/);
    assert.match(html, /href="https:\/\/blog\.example\.com\/p\/other" target="_blank" rel="noopener noreferrer nofollow"/);
    assert.match(html, /href="#wa-footnote-1"/);
    assert.match(html, /id="wa-footnote-1"/);
  });

  test("collects images with absolute, high-resolution sources", () => {
    assert.equal(article.media.length, 1);
    assert.equal(article.media[0].src, "https://blog.example.com/img/map-1200.png");
    assert.equal(article.media[0].caption, "Where coal is mined");
    assert.equal(article.media[0].sectionId, "i-fossil-fuels");
  });
});
