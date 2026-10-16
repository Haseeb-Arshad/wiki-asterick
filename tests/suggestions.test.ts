import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { suggestQuestions } from "../shared/suggestions.ts";

const words = (count: number) => `<p>${"word ".repeat(count)}</p>`;
const section = (id: string, title: string, count: number) => ({ id, title, html: words(count) });

describe("suggestQuestions", () => {
  test("asks about the two fullest sections, in reading order", () => {
    const questions = suggestQuestions([
      section("lead", "", 300),
      section("History", "History", 200),
      section("Uses", "Uses", 500),
      section("Names", "Names", 120),
      section("Culture", "Culture", 400),
    ]);
    assert.deepEqual(questions, [
      "Summarize the key points",
      "What does it say about “Uses”?",
      "What does it say about “Culture”?",
      "What's the latest on this?",
    ]);
  });

  test("skips the lead, short sections and reference-style sections", () => {
    const questions = suggestQuestions([
      section("lead", "", 900),
      section("References", "References", 900),
      section("External_links", "External links", 900),
      section("See_also", "See also", 900),
      section("Tiny", "Tiny", 20),
    ]);
    assert.deepEqual(questions, ["Summarize the key points", "What should I know first?", "What's the latest on this?"]);
  });

  test("adds a starting point when only one section stands out", () => {
    const questions = suggestQuestions([section("lead", "", 100), section("Overview", "Overview", 300)]);
    assert.deepEqual(questions, [
      "Summarize the key points",
      "What does it say about “Overview”?",
      "What should I know first?",
      "What's the latest on this?",
    ]);
  });

  test("never suggests more than four and shortens long titles", () => {
    const long = "A very long section title that goes on and on well past the width of a chip";
    const questions = suggestQuestions([section("a", long, 300), section("b", "Second", 250), section("c", "Third", 240)]);
    assert.ok(questions.length <= 4);
    const first = questions.find((question) => question.includes("A very long"));
    assert.ok(first && first.length < 80);
    // Cut at a whole word, not in the middle of "section".
    assert.equal(first, "What does it say about “A very long section title that goes on and…”?");
  });

  test("works for an article with no sections at all", () => {
    assert.deepEqual(suggestQuestions([]), ["Summarize the key points", "What should I know first?", "What's the latest on this?"]);
  });
});
