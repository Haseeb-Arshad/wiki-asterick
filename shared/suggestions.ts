export interface SuggestionSection {
  id: string;
  title: string;
  html: string;
}

// Sections that list sources or media rather than say something worth asking about.
const BOILERPLATE = /^(references|notes|citations|footnotes|bibliography|further reading|external links|see also|sources|works cited|literature|gallery|related articles)$/i;

const wordCount = (html: string) => html.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;

/** Long titles are cut at a whole word. */
const shorten = (title: string) => {
  if (title.length <= 46) return title;
  const cut = title.slice(0, 44);
  return `${(cut.includes(" ") ? cut.replace(/\s+\S*$/, "") : cut).trimEnd()}…`;
};

/**
 * Questions worth asking about an article, drawn from the article itself: a summary, one
 * question for each of its two fullest sections, a starting point when it has few sections,
 * and what's new. At most four, so they fit above the Ask bar.
 */
export function suggestQuestions(sections: SuggestionSection[]): string[] {
  const candidates = sections
    .filter((section) => section.title.trim() && section.id !== "lead" && !BOILERPLATE.test(section.title.trim()))
    .map((section) => ({ title: section.title.trim(), words: wordCount(section.html) }))
    .filter((section) => section.words >= 80);

  // The two fullest, kept in reading order.
  const fullest = [...candidates].sort((a, b) => b.words - a.words).slice(0, 2);
  const chosen = candidates.filter((section) => fullest.includes(section));

  const questions = ["Summarize the key points", ...chosen.map((section) => `What does it say about “${shorten(section.title)}”?`)];
  if (chosen.length < 2) questions.push("What should I know first?");
  questions.push("What's the latest on this?");
  return questions;
}
