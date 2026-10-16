import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { clipQuote, extractLink } from "../shared/wiki.ts";

describe("clipQuote", () => {
  test("collapses whitespace and leaves short passages alone", () => {
    assert.equal(clipQuote("  The Moon\n is   Earth's satellite.  "), "The Moon is Earth's satellite.");
  });

  test("ends a long passage at a whole word within the limit", () => {
    const clipped = clipQuote("alpha beta gamma delta epsilon zeta", 20);
    assert.equal(clipped, "alpha beta gamma");
    assert.ok(clipped.length <= 20);
  });

  test("keeps the last word when the limit falls exactly after it", () => {
    assert.equal(clipQuote("alpha beta gamma delta", 16), "alpha beta gamma");
  });

  test("cuts a single very long word instead of returning nothing", () => {
    assert.equal(clipQuote("x".repeat(50), 10), "x".repeat(10));
  });

  test("the clipped passage is the start of the original", () => {
    const original = "The citric acid cycle releases stored energy by oxidizing acetyl-CoA derived from carbohydrates, fats and proteins.";
    assert.ok(original.startsWith(clipQuote(original, 60)));
  });
});

describe("extractLink", () => {
  test("finds a bare address", () => {
    assert.equal(extractLink("https://example.com/post"), "https://example.com/post");
  });

  test("finds an address inside shared text", () => {
    assert.equal(extractLink("Great read https://example.com/post?id=7 thanks"), "https://example.com/post?id=7");
  });

  test("leaves out sentence punctuation and brackets after the address", () => {
    assert.equal(extractLink("See https://example.com/a."), "https://example.com/a");
    assert.equal(extractLink("(https://example.com/a)"), "https://example.com/a");
    assert.equal(extractLink("Is it https://example.com/a?"), "https://example.com/a");
  });

  test("keeps the first address when there are several", () => {
    assert.equal(extractLink("https://a.example/x and https://b.example/y"), "https://a.example/x");
  });

  test("returns null when there is no address", () => {
    assert.equal(extractLink("no links here"), null);
    assert.equal(extractLink(""), null);
    assert.equal(extractLink(null), null);
    assert.equal(extractLink(undefined), null);
  });
});
