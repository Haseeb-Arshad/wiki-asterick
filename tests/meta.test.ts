import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "wiki-asterisk-meta-test-"));
process.env.DATABASE_FILE = ":memory:";

const { escapeHtml, injectMeta, isKnownPath } = await import("../server/meta.ts");

const template = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="Generic description." />
    <meta property="og:title" content="WikiAsterisk" />
    <meta property="og:description" content="Generic og description." />
    <meta property="og:type" content="website" />
    <title>WikiAsterisk — Wikipedia, without the clutter</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

const meta = {
  status: 200,
  title: "Moon — WikiAsterisk",
  description: "Earth's only natural satellite.",
  image: "https://upload.wikimedia.org/moon.jpg",
  path: "/read/en/Moon",
};

describe("isKnownPath", () => {
  test("knows the app's pages", () => {
    for (const known of ["/", "/library", "/search", "/signin", "/signup", "/account", "/web", "/share", "/article", "/read/en/Moon", "/read/de.wikivoyage/Berlin", "/library/"]) {
      assert.equal(isKnownPath(known), true, known);
    }
  });

  test("answers 404 for anything else", () => {
    for (const unknown of ["/nope", "/assets/missing.js", "/favicon.ico", "/read", "/read/en", "/read/en/", "/library/extra"]) {
      assert.equal(isKnownPath(unknown), false, unknown);
    }
  });
});

describe("escapeHtml", () => {
  test("escapes everything that could break out of an attribute", () => {
    assert.equal(escapeHtml(`"><script>alert('x')</script> & more`), "&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; more");
  });
});

describe("injectMeta", () => {
  const html = injectMeta(template, meta, "https://wiki.example");

  test("replaces the generic title and descriptions", () => {
    assert.match(html, /<title>Moon — WikiAsterisk<\/title>/);
    assert.match(html, /<meta name="description" content="Earth&#39;s only natural satellite\." \/>/);
    assert.match(html, /<meta property="og:title" content="Moon — WikiAsterisk" \/>/);
    assert.match(html, /<meta property="og:type" content="article" \/>/);
    assert.doesNotMatch(html, /Generic/);
  });

  test("adds the address, preview image and card type", () => {
    assert.match(html, /<meta property="og:url" content="https:\/\/wiki\.example\/read\/en\/Moon" \/>/);
    assert.match(html, /<link rel="canonical" href="https:\/\/wiki\.example\/read\/en\/Moon" \/>/);
    assert.match(html, /<meta property="og:image" content="https:\/\/upload\.wikimedia\.org\/moon\.jpg" \/>/);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
  });

  test("puts the new tags inside <head> and leaves the body alone", () => {
    assert.ok(html.indexOf("og:image") < html.indexOf("</head>"));
    assert.match(html, /<body><div id="root"><\/div><\/body>/);
  });

  test("uses a plain summary card when there is no image", () => {
    const plain = injectMeta(template, { ...meta, image: null }, "https://wiki.example");
    assert.match(plain, /<meta name="twitter:card" content="summary" \/>/);
    assert.doesNotMatch(plain, /og:image/);
  });

  test("never lets page text break out of the tags", () => {
    const hostile = injectMeta(template, { ...meta, title: `</title><script>alert(1)</script>`, description: `" onload="alert(1)` }, "https://wiki.example");
    assert.doesNotMatch(hostile, /<script>alert/);
    assert.match(hostile, /&lt;\/title&gt;&lt;script&gt;/);
    assert.match(hostile, /content="&quot; onload=&quot;alert\(1\)"/);
  });

  test("keeps dollar signs in text literal", () => {
    const priced = injectMeta(template, { ...meta, description: "Costs $& $1 each" }, "https://wiki.example");
    assert.match(priced, /Costs \$&amp; \$1 each/);
  });
});
