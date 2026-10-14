import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  normalizeWikiHost,
  parseWikiUrl,
  resizeThumb,
  snapThumbWidth,
  wikiArticleUrl,
  wikiSlug,
} from "../shared/wiki.ts";

describe("normalizeWikiHost", () => {
  test("accepts language codes, short forms, full and mobile hosts", () => {
    assert.equal(normalizeWikiHost("en"), "en.wikipedia.org");
    assert.equal(normalizeWikiHost("de.wikivoyage"), "de.wikivoyage.org");
    assert.equal(normalizeWikiHost("ur.wikipedia.org"), "ur.wikipedia.org");
    assert.equal(normalizeWikiHost("EN.M.WIKIPEDIA.ORG"), "en.wikipedia.org");
    assert.equal(normalizeWikiHost("zh-min-nan"), "zh-min-nan.wikipedia.org");
  });

  test("rejects other sites", () => {
    assert.equal(normalizeWikiHost("evil.com"), null);
    assert.equal(normalizeWikiHost("en.wikipedia.org.evil.com"), null);
    assert.equal(normalizeWikiHost("commons.wikimedia.org"), null);
    assert.equal(normalizeWikiHost(""), null);
  });
});

describe("parseWikiUrl", () => {
  test("reads titles from article and index.php URLs", () => {
    assert.deepEqual(parseWikiUrl("https://en.wikipedia.org/wiki/Apollo_11"), { wiki: "en.wikipedia.org", title: "Apollo 11" });
    assert.deepEqual(parseWikiUrl("de.m.wikipedia.org/wiki/Mond#Entstehung"), { wiki: "de.wikipedia.org", title: "Mond" });
    assert.deepEqual(parseWikiUrl("https://en.wikipedia.org/w/index.php?title=AC/DC"), { wiki: "en.wikipedia.org", title: "AC/DC" });
    assert.deepEqual(parseWikiUrl("https://ur.wikipedia.org/wiki/%D9%BE%D8%A7%DA%A9%D8%B3%D8%AA%D8%A7%D9%86"), {
      wiki: "ur.wikipedia.org",
      title: "پاکستان",
    });
  });

  test("rejects non-wiki or title-less URLs", () => {
    assert.equal(parseWikiUrl("https://example.com/wiki/Moon"), null);
    assert.equal(parseWikiUrl("https://en.wikipedia.org/"), null);
    assert.equal(parseWikiUrl("not a url at all"), null);
  });
});

describe("thumbnail helpers", () => {
  const thumb = "//upload.wikimedia.org/wikipedia/commons/thumb/4/41/Moon.jpg/250px-Moon.jpg?utm_source=x";

  test("snaps to widths the image servers render", () => {
    assert.equal(snapThumbWidth(400), 500);
    assert.equal(snapThumbWidth(960), 960);
    assert.equal(snapThumbWidth(960, 800), 500);
    assert.equal(snapThumbWidth(100, 50), null);
  });

  test("resizes below the original and serves from the thumbnail CDN", () => {
    assert.equal(resizeThumb(thumb, 960), "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/41/Moon.jpg/960px-Moon.jpg");
    assert.equal(resizeThumb(thumb, 960, 600), "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/41/Moon.jpg/500px-Moon.jpg");
    assert.equal(resizeThumb(thumb, 960, 960), "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/41/Moon.jpg/500px-Moon.jpg");
    assert.equal(
      resizeThumb("https://thumb.wikimedia.org/x/thumb/a/ab/Flag.svg/langur-960px-Flag.svg.png", 330),
      "https://thumb.wikimedia.org/x/thumb/a/ab/Flag.svg/langur-330px-Flag.svg.png"
    );
    assert.equal(resizeThumb("https://upload.wikimedia.org/wikipedia/commons/a/ab/Moon.jpg", 500), "https://upload.wikimedia.org/wikipedia/commons/a/ab/Moon.jpg");
  });
});

test("wikiSlug and wikiArticleUrl round-trip titles", () => {
  assert.equal(wikiSlug("en.wikipedia.org"), "en");
  assert.equal(wikiSlug("en.wikivoyage.org"), "en.wikivoyage");
  assert.equal(wikiArticleUrl("en.wikipedia.org", "AC/DC"), "https://en.wikipedia.org/wiki/AC/DC");
  assert.equal(wikiArticleUrl("en.wikipedia.org", "C++ (language)"), "https://en.wikipedia.org/wiki/C%2B%2B_(language)");
});
