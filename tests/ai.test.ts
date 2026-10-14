import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { WikiArticle } from "../shared/types.ts";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "wiki-asterisk-ai-test-"));
process.env.DATABASE_FILE = ":memory:";

const { chooseMode, wantsWebSearch } = await import("../server/ai/routes.ts");
const { buildContextText } = await import("../server/ai/context.ts");

describe("answer routing", () => {
  test("auto uses the fast model unless the question needs reasoning", () => {
    assert.equal(chooseMode("When did Apollo 11 land?", "auto"), "quick");
    assert.equal(chooseMode("Why did the computer raise 1202 alarms?", "auto"), "deep");
    assert.equal(chooseMode("Compare the Apollo and Artemis programs", undefined), "deep");
    assert.equal(chooseMode("Why?", "quick"), "quick");
    assert.equal(chooseMode("Who was on board?", "deep"), "deep");
  });

  test("auto searches the web without an article, or for recent events", () => {
    assert.equal(wantsWebSearch("Who was on board?", true, "auto"), false);
    assert.equal(wantsWebSearch("What's the latest news on this?", true, "auto"), true);
    assert.equal(wantsWebSearch("Explain photosynthesis", false, "auto"), true);
    assert.equal(wantsWebSearch("Explain photosynthesis", false, "off"), false);
    assert.equal(wantsWebSearch("Who was on board?", true, "on"), true);
  });
});

describe("article context", () => {
  const section = (id: string, title: string, text: string) => ({ id, title, level: 2, html: `<p>${text}</p>`, subsections: [] });
  const article = {
    title: "Moon",
    infobox: [{ label: "Radius", value: "1737 km" }],
    sections: [
      section("lead", "", "The Moon is Earth's only natural satellite."),
      section("Tides", "Tides", "Tidal forces from the Moon raise the oceans twice a day. ".repeat(40)),
      section("Exploration", "Exploration", "Apollo astronauts landed on the Moon and collected rocks. ".repeat(40)),
      section("Culture", "Culture", "The Moon appears in myths and calendars. ".repeat(40)),
    ],
  } as unknown as WikiArticle;

  test("always includes the lead and key facts, then the most relevant sections", () => {
    const text = buildContextText(article, "Which astronauts collected rocks during exploration?", 3500);
    assert.match(text, /Radius: 1737 km/);
    assert.match(text, /only natural satellite/);
    assert.match(text, /## Exploration/);
    assert.doesNotMatch(text, /## Culture/);
    assert.match(text, /not included: .*Culture/);
  });
});
