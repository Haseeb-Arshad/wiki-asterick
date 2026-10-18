import type { SearchIntent } from "./types.js";
import { FEATURED_LANGUAGES, wikiLanguage, wikiProject } from "./wiki.js";

/** A better place to look for a search: a sister wiki (Wiktionary, Wikivoyage, Wikiquote) or another language. */
export interface Elsewhere {
  wiki: string;
  query: string;
  label: string;
  description: string;
  /** "article" opens `query` as a page title; "search" runs a full-text search for it. */
  open: "article" | "search";
  reason: "definition" | "travel" | "quotes" | "language";
}

const SISTERS = {
  definition: { project: "wiktionary", name: "Wiktionary" },
  travel: { project: "wikivoyage", name: "Wikivoyage" },
  quotes: { project: "wikiquote", name: "Wikiquote" },
} as const;

/** How sure the model must be before the app suggests looking elsewhere. */
const SURE_OF_INTENT = 0.6;
const SURE_OF_LANGUAGE = 0.8;

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The word or phrase being asked about: "define serendipity" → "serendipity". */
export function termToDefine(query: string): string {
  return query
    .trim()
    .replace(/^(what\s+(does|is)\s+(the\s+)?(meaning\s+of\s+)?|define\s+|definition\s+of\s+|meaning\s+of\s+|how\s+to\s+(say|pronounce)\s+)/i, "")
    .replace(/\s+(mean|means|meaning|definition)\s*\??$/i, "")
    .replace(/[?.!]+$/, "")
    .replace(/^["“']|["”']$/g, "")
    .trim();
}

/** Whose quotes: "einstein quotes" → "einstein"; "famous lines by shakespeare" → "shakespeare". */
export function quotedPerson(query: string): string {
  return query
    .trim()
    .replace(/\b(famous\s+)?(quotes?|quotations?|sayings|lines)\b(\s+(by|from|of))?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Suggestions to look in a sister wiki or another language's Wikipedia, for a search's intent. */
export function elsewhereFor(intent: SearchIntent | null, query: string, wiki: string): Elsewhere[] {
  if (!intent) return [];
  const results: Elsewhere[] = [];
  const currentLang = wikiLanguage(wiki);
  const typedIn = intent.language && intent.languageConfidence >= SURE_OF_LANGUAGE ? intent.language : currentLang;

  // Typed in another language than the wiki being searched: offer that language's Wikipedia.
  if (typedIn !== currentLang && FEATURED_LANGUAGES.some((language) => language.code === typedIn)) {
    results.push({
      wiki: `${typedIn}.wikipedia.org`,
      query,
      label: `Search ${languageName(typedIn)} Wikipedia`,
      description: `This looks like ${languageName(typedIn)}; you're searching ${languageName(currentLang)}`,
      open: "search",
      reason: "language",
    });
  }

  if (intent.intent in SISTERS && intent.intentConfidence >= SURE_OF_INTENT) {
    const sister = SISTERS[intent.intent as keyof typeof SISTERS];
    if (wikiProject(wiki) !== sister.project) {
      const sisterWiki = `${typedIn}.${sister.project}.org`;
      if (intent.intent === "definition") {
        const term = termToDefine(query) || query.trim();
        // One word opens its entry; a phrase is searched for.
        const single = !/\s/.test(term);
        results.push({
          wiki: sisterWiki,
          query: single ? term.toLowerCase() : term,
          label: `Define “${term}” in Wiktionary`,
          description: "Meaning, pronunciation and translations",
          open: single ? "article" : "search",
          reason: "definition",
        });
      } else if (intent.intent === "travel") {
        results.push({ wiki: sisterWiki, query: query.trim(), label: `Plan the trip in Wikivoyage`, description: "The free travel guide: see, do, sleep, get around", open: "search", reason: "travel" });
      } else {
        const person = quotedPerson(query) || query.trim();
        results.push({ wiki: sisterWiki, query: person, label: `Quotes from ${person} in Wikiquote`, description: "Sourced quotations", open: "search", reason: "quotes" });
      }
    }
  }
  return results;
}
