import type { SearchIntent } from "../../shared/types.js";
import { decide as defaultDecide, decideEach, type Decide } from "./decisions.js";

/*
 * The small judgements the app asks the decision model for. Each returns null (or its input
 * unchanged) when the model is unavailable or slow, so callers keep their rule-based behaviour.
 */

// ---- routing a question: which model, and whether to search the web ------------------------------

/** How sure the model must be that a question needs careful analysis before using the reasoning model. */
export const DEEP_ABOVE = 0.7;

export interface AnswerPlan {
  mode: "quick" | "deep";
  web: boolean;
  /** "model" when the decision model chose; "rules" when the keyword rules did. */
  by: "model" | "rules";
}

/**
 * Picks the fast or the reasoning model, and whether to search the web, for a question in any
 * language. Settings the reader chose themselves always win. On any failure the rule-based plan
 * (English keywords) is used.
 */
export async function planAnswer(
  question: string,
  options: {
    hasArticle: boolean;
    requestedMode: "auto" | "quick" | "deep";
    requestedWeb: "auto" | "on" | "off";
    webAvailable: boolean;
    rules: { mode: "quick" | "deep"; web: boolean };
    decide?: Decide;
  }
): Promise<AnswerPlan> {
  const { hasArticle, requestedMode, requestedWeb, webAvailable, rules, decide = defaultDecide } = options;
  const modeFixed = requestedMode !== "auto";
  const webFixed = requestedWeb !== "auto" || !webAvailable || !hasArticle;
  if (modeFixed && webFixed) return { ...rules, by: "rules" };

  try {
    const answers = await decide(
      "route question",
      `A reader asked the reading assistant of a Wikipedia reading app: "${question.slice(0, 1500)}"${
        hasArticle ? " The assistant has the article the reader is reading, which may be some weeks old." : " No article is open."
      }`,
      {
        fresh: {
          type: "noul",
          instructions: "Does a good answer need information published in the last few weeks, beyond an encyclopedia article?",
          criteria: { true: "Needs recent news or the current state of something", false: "An encyclopedia article is enough" },
        },
        depth: {
          type: "score",
          instructions: "How much reasoning does a good answer need?",
          criteria: ["A single fact", "A short explanation", "A careful analysis weighing several factors"],
        },
      },
      // About 1 s normally; a cold call can take longer. Runs while the article loads.
      { timeoutMs: 3000 }
    );
    // The reasoning model is slower and dearer: use it only when the model is sure it's needed.
    // Measured: questions that need analysis score 0.86 to 1.00; summaries, explanations and news
    // round-ups score 0.51 or less.
    const mode = modeFixed ? rules.mode : (answers.depth.probabilities["2"] ?? 0) >= DEEP_ABOVE ? "deep" : "quick";
    const web = webFixed ? rules.web : answers.fresh.noul >= 0.5;
    return { mode, web, by: "model" };
  } catch {
    return { ...rules, by: "rules" };
  }
}

// ---- does the answer stay within its sources? ---------------------------------------------------------

const MAX_SOURCES_CHARS = 48_000;

/**
 * The probability that every factual claim in the answer is supported by the sources the model
 * was given. Null when it couldn't be checked.
 */
export async function checkGrounded(sources: string, answer: string, { decide = defaultDecide }: { decide?: Decide } = {}): Promise<number | null> {
  if (!sources.trim() || !answer.trim()) return null;
  try {
    const answers = await decide(
      "check answer",
      `Sources given to the assistant:\n${sources.slice(0, MAX_SOURCES_CHARS)}\n\nThe assistant's answer:\n${answer.slice(0, 8000)}`,
      {
        grounded: {
          type: "noul",
          instructions: "Is every factual claim in the answer supported by the sources?",
          criteria: { true: "Every claim is stated in or follows from the sources", false: "At least one claim contradicts the sources or is not in them" },
        },
      },
      { timeoutMs: 4000 }
    );
    return answers.grounded.noul;
  } catch {
    return null;
  }
}

// ---- what is a search for? -----------------------------------------------------------------------------

const LANGUAGES: Record<string, string> = {
  en: "English",
  ur: "Urdu",
  ar: "Arabic",
  de: "German",
  es: "Spanish",
  fr: "French",
  hi: "Hindi",
  it: "Italian",
  ja: "Japanese",
  pt: "Portuguese",
  ru: "Russian",
  tr: "Turkish",
  zh: "Chinese",
  other: "Another language",
};

/** What the reader wants from a search (an article, an answer, a definition, travel, quotes) and its language. */
export async function readSearchIntent(query: string, { decide = defaultDecide }: { decide?: Decide } = {}): Promise<SearchIntent | null> {
  try {
    const answers = await decide(
      "search intent",
      `A reader typed this into the search box of a Wikipedia reading app: "${query.slice(0, 200)}"`,
      {
        intent: {
          type: "choice",
          instructions: "What is the reader trying to do with this search?",
          criteria: {
            article: "Open an article about a person, place, thing, event or topic by its name",
            question: "Get an answer to a question",
            definition: "Learn what a single word or short phrase means, how to say it, or how to translate it",
            travel: "Plan a trip: what to see and do, where to stay, how to get around",
            quotes: "Find quotations said or written by someone",
          },
        },
        language: { type: "choice", instructions: "Which language is the query written in?", criteria: LANGUAGES },
      },
      { timeoutMs: 2500 }
    );
    return {
      intent: answers.intent.choice as SearchIntent["intent"],
      intentConfidence: answers.intent.probabilities[answers.intent.choice] ?? answers.intent.confidence,
      language: answers.language.choice === "other" ? null : answers.language.choice,
      languageConfidence: answers.language.probabilities[answers.language.choice] ?? answers.language.confidence,
    };
  } catch {
    return null;
  }
}

// ---- keeping the home page calm ------------------------------------------------------------------------

/**
 * Drops entries that are about sexually explicit material (or people known mainly for it) from a
 * list such as today's most-read articles. Serious or sensitive topics stay. On failure the list is
 * returned unchanged.
 */
export async function withoutExplicit<T extends { title: string; description: string }>(items: T[], { decide = defaultDecide }: { decide?: Decide } = {}): Promise<T[]> {
  if (!items.length) return items;
  try {
    const explicit = await decideEach(
      "trending safety",
      "Today's most-read Wikipedia articles, numbered:",
      items.map((item) => (item.description ? `${item.title}: ${item.description}` : item.title)),
      {
        instructions: (n) => `Is entry ${n} about sexually explicit material or a person known mainly for it?`,
        criteria: { true: "Sexually explicit topic", false: "Not sexually explicit (serious or sensitive topics are fine)" },
      },
      { decide, timeoutMs: 3000 }
    );
    return items.filter((_, index) => (explicit[index] ?? 0) < 0.6);
  } catch {
    return items;
  }
}
