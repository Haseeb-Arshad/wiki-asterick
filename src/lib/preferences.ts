import { useEffect } from "react";
import { FEATURED_LANGUAGES, normalizeWikiHost } from "../../shared/wiki";
import { createPersistedStore } from "./store";

export type ThemePreference = "system" | "light" | "dark";

export const themeStore = createPersistedStore<ThemePreference>("wa-theme", "system", (raw) =>
  raw === "light" || raw === "dark" ? raw : "system"
);

/** Mirrors the theme preference onto <html data-theme>; "system" defers to the OS. */
export function useApplyTheme() {
  const theme = themeStore.use();
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);
}

function defaultWiki(): string {
  const browserLanguage = (typeof navigator !== "undefined" ? navigator.language : "en").split("-")[0];
  return FEATURED_LANGUAGES.some((language) => language.code === browserLanguage)
    ? `${browserLanguage}.wikipedia.org`
    : "en.wikipedia.org";
}

/** The wiki used for search, the home feed and "surprise me". */
export const wikiStore = createPersistedStore<string>("wa-wiki", defaultWiki(), (raw) =>
  typeof raw === "string" ? (normalizeWikiHost(raw) ?? defaultWiki()) : defaultWiki()
);

export interface RecentSearch {
  wiki: string;
  title: string;
}

export const recentSearchStore = createPersistedStore<RecentSearch[]>("wa-recent-searches", [], (raw) =>
  Array.isArray(raw) ? raw.filter((item) => item && typeof item.title === "string").slice(0, 8) : []
);

export function rememberSearch(item: RecentSearch) {
  recentSearchStore.set((list) =>
    [item, ...list.filter((entry) => !(entry.title === item.title && entry.wiki === item.wiki))].slice(0, 8)
  );
}
