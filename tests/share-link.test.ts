import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { extractLink } from "../shared/wiki.ts";

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
