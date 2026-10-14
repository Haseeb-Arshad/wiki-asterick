import assert from "node:assert/strict";
import { test } from "node:test";
import { buildArticle } from "../server/wiki/parser.ts";
import type { WikiSection } from "../shared/types.ts";

const FIXTURE = `
<div class="mw-parser-output">
  <div class="shortdescription">Natural satellite</div>
  <div role="note" class="hatnote">For other uses, see Moon (disambiguation).</div>
  <table class="infobox"><tbody>
    <tr><th>Mass</th><td>7.342×10<sup>22</sup> kg<sup class="reference"><a href="#cite_note-9">[9]</a></sup></td></tr>
    <tr><th>Mean radius</th><td>1737.4 km</td></tr>
  </tbody></table>
  <p>The <b>Moon</b> is <a href="/wiki/Earth" title="Earth">Earth</a>'s only
  <a href="/wiki/Natural_satellite">natural satellite</a>.<sup id="cite_ref-1" class="reference"><a href="#cite_note-1"><span class="cite-bracket">[</span>1<span class="cite-bracket">]</span></a></sup>
  See <a href="/w/index.php?title=Moonlet_X&amp;action=edit&amp;redlink=1" class="new">Moonlet X</a>
  and <a href="/wiki/Category:Moons">the category</a>.</p>
  <p onclick="alert(1)" style="color:red; text-align:center">Centered <a href="javascript:alert(1)">bad link</a>.</p>
  <script>alert("x")</script>
  <div class="mw-heading mw-heading2"><h2 id="Orbit">Orbit</h2></div>
  <p>Text about the orbit with a <a href="https://example.org/orbit">source</a>.</p>
  <figure typeof="mw:File/Thumb"><a href="/wiki/File:Full_Moon.jpg" class="mw-file-description"><img src="//upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Full_Moon.jpg/250px-Full_Moon.jpg" width="250" height="250" data-file-width="3000" data-file-height="3000"></a><figcaption>The full Moon</figcaption></figure>
  <div class="mw-heading mw-heading3"><h3 id="Tides">Tides</h3></div>
  <figure typeof="mw:File/Thumb"><span><video poster="//thumb.wikimedia.org/wikipedia/commons/thumb/1/19/Tide.ogv/250px--Tide.ogv.jpg" controls="" data-mwtitle="Tide.ogv" data-durationhint="42"><source src="//upload.wikimedia.org/wikipedia/commons/1/19/Tide.ogv" type="video/ogg; codecs=&quot;theora&quot;" data-width="640" data-height="480"><source src="//upload.wikimedia.org/wikipedia/commons/transcoded/1/19/Tide.ogv/Tide.ogv.480p.vp9.webm" type="video/webm; codecs=&quot;vp9&quot;" data-width="640" data-height="480"></video></span><figcaption>Tidal motion</figcaption></figure>
  <table class="wikitable"><tr><th>Body</th><td>Moon</td></tr></table>
  <div class="mw-heading mw-heading2"><h2 id="References">References</h2></div>
  <div class="mw-references-wrap"><ol class="references">
    <li id="cite_note-1"><span class="mw-cite-backlink"><a href="#cite_ref-1">^</a></span> <span class="reference-text"><cite>Moon facts</cite>. <a class="external text" href="https://nasa.gov/moon">NASA</a>.</span></li>
    <li id="cite_note-9"><span class="mw-cite-backlink">^</span> <span class="reference-text">Mass estimate.</span></li>
  </ol></div>
  <div class="mw-heading mw-heading2"><h2 id="External_links">External links</h2></div>
  <ul><li><a class="external text" href="https://moon.nasa.gov">NASA Moon</a></li><li><a class="external text" href="https://example.org/a">A</a></li><li><a class="external text" href="https://example.org/b">B</a></li></ul>
</div>`;

const article = buildArticle({
  wiki: "en.wikipedia.org",
  title: "Moon",
  html: FIXTURE,
  revisionId: 42,
  languages: [{ lang: "de", title: "Mond", autonym: "Deutsch" }],
  summary: null,
  lastEdited: null,
  namespaces: ["file", "category"],
});

const find = (sections: WikiSection[], id: string): WikiSection | undefined => {
  for (const section of sections) {
    if (section.id === id) return section;
    const nested = find(section.subsections, id);
    if (nested) return nested;
  }
};

test("keeps the lead section before the first heading", () => {
  const lead = article.sections[0];
  assert.equal(lead.id, "lead");
  assert.equal(lead.title, "");
  assert.match(lead.html, /<p>The <b>Moon<\/b>/);
});

test("nests subsections and drops reference and link sections", () => {
  assert.deepEqual(
    article.sections.map((section) => section.id),
    ["lead", "Orbit"]
  );
  assert.equal(find(article.sections, "Tides")?.level, 3);
  assert.equal(find(article.sections, "References"), undefined);
  assert.equal(find(article.sections, "External_links"), undefined);
  assert.deepEqual(
    article.externalLinks.map((link) => link.url),
    ["https://moon.nasa.gov", "https://example.org/a", "https://example.org/b"]
  );
});

test("rewrites wiki links to app routes and leaves namespaces on the wiki", () => {
  const lead = article.sections[0].html;
  assert.match(lead, /href="\/read\/en\/Earth" data-wiki-title="Earth"/);
  assert.match(lead, /href="https:\/\/en\.wikipedia\.org\/wiki\/Category:Moons"[^>]*target="_blank"/);
  assert.doesNotMatch(lead, /redlink/);
  assert.match(lead, /<span>Moonlet X<\/span>/);
});

test("strips scripts, event handlers and javascript: links", () => {
  const lead = article.sections[0].html;
  assert.doesNotMatch(lead, /<script|onclick|javascript:/);
  assert.doesNotMatch(lead, /color:\s*red/);
  assert.match(lead, /text-align:center/);
});

test("removes hatnotes, short descriptions and the infobox from the body", () => {
  const lead = article.sections[0].html;
  assert.doesNotMatch(lead, /hatnote|Natural satellite<\/div>|infobox/);
  assert.deepEqual(article.infobox[0], { label: "Mass", value: "7.342×10²² kg" });
});

test("extracts footnotes with labels and source links", () => {
  assert.deepEqual(article.footnotes[0], {
    id: "cite_note-1",
    label: "1",
    text: "Moon facts. NASA.",
    url: "https://nasa.gov/moon",
  });
  assert.match(article.sections[0].html, /<sup class="fn"><a href="#cite_note-1" data-fn="cite_note-1">1<\/a><\/sup>/);
});

test("collects images and videos with absolute URLs", () => {
  const [image, video] = article.media;
  assert.equal(image.type, "image");
  assert.equal(image.caption, "The full Moon");
  assert.equal(image.file, "Full Moon.jpg");
  assert.equal(image.sectionId, "Orbit");
  assert.equal(image.src, "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/dd/Full_Moon.jpg/1920px-Full_Moon.jpg");

  assert.equal(video.type, "video");
  assert.equal(video.sectionId, "Tides");
  assert.equal(video.durationSeconds, 42);
  assert.equal(video.sources[0].type, "video/webm");
  assert.ok(video.sources.every((source) => source.src.startsWith("https://")));

  const orbit = find(article.sections, "Orbit")!.html;
  assert.match(orbit, /960px-Full_Moon\.jpg/);
  const tides = find(article.sections, "Tides")!.html;
  assert.match(tides, /<video controls="" preload="none" data-media-id="m2"/);
  assert.match(tides, /<div class="table-scroll"><table class="wikitable">/);
});

test("reports reading metadata", () => {
  assert.ok(article.wordCount > 10);
  assert.equal(article.readingMinutes, 1);
  assert.equal(article.sourceUrl, "https://en.wikipedia.org/wiki/Moon");
  assert.equal(article.dir, "ltr");
});
