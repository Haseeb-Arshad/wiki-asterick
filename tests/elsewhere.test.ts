import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { elsewhereFor, quotedPerson, termToDefine } from "../shared/elsewhere.ts";
import type { SearchIntent } from "../shared/types.ts";

const intent = (value: SearchIntent["intent"], language: string | null = "en", intentConfidence = 0.95, languageConfidence = 0.99): SearchIntent => ({
  intent: value,
  intentConfidence,
  language,
  languageConfidence,
});

describe("termToDefine", () => {
  test("finds the word being asked about", () => {
    assert.equal(termToDefine("define serendipity"), "serendipity");
    assert.equal(termToDefine("meaning of ephemeral"), "ephemeral");
    assert.equal(termToDefine("What does ubiquitous mean?"), "ubiquitous");
    assert.equal(termToDefine("what is the meaning of déjà vu"), "déjà vu");
    assert.equal(termToDefine("how to pronounce quinoa"), "quinoa");
    assert.equal(termToDefine("serendipity"), "serendipity");
  });
});

describe("quotedPerson", () => {
  test("finds whose quotes", () => {
    assert.equal(quotedPerson("einstein quotes"), "einstein");
    assert.equal(quotedPerson("famous lines by shakespeare"), "shakespeare");
    assert.equal(quotedPerson("quotes from Maya Angelou"), "Maya Angelou");
  });
});

describe("elsewhereFor", () => {
  test("a definition opens the Wiktionary entry for one word", () => {
    assert.deepEqual(elsewhereFor(intent("definition"), "define Serendipity", "en.wikipedia.org"), [
      { wiki: "en.wiktionary.org", query: "serendipity", label: "Define “Serendipity” in Wiktionary", description: "Meaning, pronunciation and translations", open: "article", reason: "definition" },
    ]);
  });

  test("a phrase is searched for in Wiktionary", () => {
    const [suggestion] = elsewhereFor(intent("definition"), "what does carpe diem mean", "en.wikipedia.org");
    assert.equal(suggestion.open, "search");
    assert.equal(suggestion.query, "carpe diem");
  });

  test("travel goes to Wikivoyage and quotes to Wikiquote", () => {
    assert.equal(elsewhereFor(intent("travel"), "things to do in lisbon", "en.wikipedia.org")[0].wiki, "en.wikivoyage.org");
    const [quotes] = elsewhereFor(intent("quotes"), "einstein quotes", "en.wikipedia.org");
    assert.equal(quotes.wiki, "en.wikiquote.org");
    assert.equal(quotes.query, "einstein");
  });

  test("a query in another language offers that language's Wikipedia", () => {
    const [suggestion] = elsewhereFor(intent("article", "ur"), "پاکستان کی تاریخ", "en.wikipedia.org");
    assert.equal(suggestion.wiki, "ur.wikipedia.org");
    assert.equal(suggestion.reason, "language");
    assert.equal(suggestion.label, "Search Urdu Wikipedia");
  });

  test("a sister wiki in the query's own language", () => {
    const suggestions = elsewhereFor(intent("travel", "de"), "Sehenswürdigkeiten in Berlin", "en.wikipedia.org");
    assert.deepEqual(
      suggestions.map((item) => item.wiki),
      ["de.wikipedia.org", "de.wikivoyage.org"]
    );
  });

  test("says nothing when unsure, when already there, or for plain lookups and questions", () => {
    assert.deepEqual(elsewhereFor(null, "anything", "en.wikipedia.org"), []);
    assert.deepEqual(elsewhereFor(intent("definition", "en", 0.4), "define x", "en.wikipedia.org"), []);
    assert.deepEqual(elsewhereFor(intent("definition"), "define serendipity", "en.wiktionary.org"), []);
    assert.deepEqual(elsewhereFor(intent("article"), "Ada Lovelace", "en.wikipedia.org"), []);
    assert.deepEqual(elsewhereFor(intent("question"), "why is the sky blue", "en.wikipedia.org"), []);
    // Not sure enough of the language: stay put.
    assert.deepEqual(elsewhereFor(intent("article", "de", 0.95, 0.5), "Berlin", "en.wikipedia.org"), []);
  });
});
