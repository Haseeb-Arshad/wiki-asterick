import { FEATURED_LANGUAGES } from "../../../shared/wiki";

export const PROJECT_NAMES: Record<string, string> = {
  wikipedia: "Wikipedia",
  wiktionary: "Wiktionary",
  wikivoyage: "Wikivoyage",
  wikibooks: "Wikibooks",
  wikiquote: "Wikiquote",
  wikinews: "Wikinews",
  wikiversity: "Wikiversity",
  wikisource: "Wikisource",
};

export function languageName(lang: string): string {
  const featured = FEATURED_LANGUAGES.find((language) => language.code === lang)?.name;
  if (featured) return featured;
  try {
    return new Intl.DisplayNames([lang], { type: "language" }).of(lang) ?? lang;
  } catch {
    return lang;
  }
}
