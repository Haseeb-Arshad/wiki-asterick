import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { WikiArticle } from "../shared/types.ts";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "wiki-asterisk-ai-passages-test-"));
process.env.DATABASE_FILE = ":memory:";

const { expandPrompt, systemParts, systemMessage } = await import("../server/ai/routes.ts");
const { buildContextPassages } = await import("../server/ai/context.ts");

describe("article passages as sources", () => {
  const section = (id: string, title: string, text: string) => ({ id, title, level: 2, html: `<p>${text}</p>`, subsections: [] });
  const article = {
    title: "Moon",
    infobox: [{ label: "Radius", value: "1737 km" }],
    sections: [
      section("lead", "", "The Moon is Earth's only natural satellite."),
      section("Tides", "Tides", "Tidal forces from the Moon raise the oceans twice a day. ".repeat(10)),
      section("Exploration", "Exploration", "Apollo astronauts landed on the Moon and collected rocks. ".repeat(10)),
      section("Culture", "Culture", "The Moon appears in myths and calendars. ".repeat(10)),
      section("Orbit", "Orbit", "The Moon orbits Earth every twenty seven days. ".repeat(10)),
    ],
  } as unknown as WikiArticle;

  test("returns each section with its anchor, lead first, in reading order", () => {
    const { passages, facts } = buildContextPassages(article, "Which astronauts collected rocks?");
    assert.deepEqual(
      passages.map((passage) => passage.id),
      ["lead", "Tides", "Exploration", "Culture", "Orbit"]
    );
    assert.equal(facts, "Radius: 1737 km");
  });

  test("keeps to the passage limit, preferring the relevant sections", () => {
    const { passages, omitted } = buildContextPassages(article, "Which astronauts collected rocks during exploration?", { maxPassages: 2 });
    assert.deepEqual(
      passages.map((passage) => passage.id),
      ["lead", "Exploration"]
    );
    assert.deepEqual(omitted.sort(), ["Culture", "Orbit", "Tides"]);
  });

  test("always includes the section the highlighted passage came from", () => {
    const quote = "The Moon appears in myths and calendars.";
    const without = buildContextPassages(article, "Explain this", { maxPassages: 2 });
    assert.ok(!without.passages.some((passage) => passage.id === "Culture"));
    const withFocus = buildContextPassages(article, "Explain this", { maxPassages: 2, focus: quote });
    assert.deepEqual(
      withFocus.passages.map((passage) => passage.id),
      ["lead", "Culture"]
    );
  });

  test("ignores a highlighted passage that is too short to place", () => {
    const { passages } = buildContextPassages(article, "Explain this", { maxPassages: 2, focus: "Moon" });
    assert.equal(passages.length, 2);
  });
});

describe("prompt wording", () => {
  test("spells out the preset prompts and leaves other questions alone", () => {
    assert.match(expandPrompt("Explain this"), /^Explain this\. Explain the highlighted passage/);
    assert.match(expandPrompt("Say it more simply"), /plain language/);
    assert.match(expandPrompt("Why does it matter?"), /^Why does it matter\?\. Say why the highlighted passage matters/);
    assert.match(expandPrompt("why does it matter"), /Say why the highlighted passage matters/);
    assert.match(expandPrompt("Is this accurate?"), /Check the highlighted passage against the sources/);
    assert.match(expandPrompt("is this accurate?"), /Check the highlighted passage against the sources/);
    assert.match(expandPrompt("Summarize the key points"), /4 to 6 short bullets/);
    assert.match(expandPrompt("What should I know first?"), /core idea in two sentences/);
    assert.equal(expandPrompt("Explain this to me like I am five"), "Explain this to me like I am five");
    assert.equal(expandPrompt("What year did it land?"), "What year did it land?");
  });
});

describe("system prompt and caching", () => {
  const notes = [{ question: "Q", quote: "", answer: "A" }];
  const parts = systemParts("[1] source text", "a highlighted passage", notes, "2026-10-16");

  test("keeps the part that changes with each question out of the cacheable part", () => {
    assert.match(parts.stable, /Today is 2026-10-16/);
    assert.match(parts.stable, /\[1\] source text/);
    assert.doesNotMatch(parts.stable, /highlighted this passage/);
    assert.match(parts.changing, /highlighted this passage/);
    assert.match(parts.changing, /Q: Q/);
  });

  test("marks only the stable part for caching on Anthropic models", () => {
    const message = systemMessage("anthropic/claude-haiku-5.5", parts);
    assert.ok(Array.isArray(message.content));
    const content = message.content as { text: string; cache_control?: unknown }[];
    assert.equal(content.length, 2);
    assert.deepEqual(content[0].cache_control, { type: "ephemeral" });
    assert.equal(content[1].cache_control, undefined);
  });

  test("sends one plain string to other providers", () => {
    const message = systemMessage("openai/gpt-6-luna", parts);
    assert.equal(typeof message.content, "string");
    assert.match(message.content as string, /\[1\] source text[\s\S]*highlighted this passage/);
  });

  test("leaves out the changing part when there is nothing in it", () => {
    const message = systemMessage("anthropic/claude-haiku-5.5", systemParts("[1] x", "", []));
    assert.equal((message.content as unknown[]).length, 1);
  });
});
