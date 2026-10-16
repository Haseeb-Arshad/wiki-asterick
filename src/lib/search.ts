import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { SearchHit } from "../../shared/types";
import { parseWikiUrl } from "../../shared/wiki";
import { aiStatusQuery } from "./assistant";
import { useSession } from "./auth";
import { useDebouncedValue } from "./hooks";
import { useLibrary } from "./library";
import { recentSearchStore } from "./preferences";
import { searchQuery } from "./queries";

export interface SearchOption {
  key: string;
  kind: "article" | "url" | "link" | "ask" | "recent" | "action" | "fulltext";
  wiki: string;
  title: string;
  description: string;
  thumbnail: string | null;
  /** Web pages (kind "link", or a recent web page). */
  url?: string;
  /** What to send to the AI when it differs from the title shown (kind "ask"). */
  query?: string;
}

const QUESTION = /^(what|why|how|who|whom|whose|when|where|which|is|are|was|were|can|could|does|do|did|should|would|will|explain|compare|summari[sz]e|tell me|help me|give me|list)\b/i;

/** True for "why is the sky blue?" or "explain photosynthesis", not for "Apollo 11". */
export function looksLikeQuestion(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return words.length >= 3 && (text.trim().endsWith("?") || QUESTION.test(text.trim()));
}

/** Any http(s) link, or something like "example.com/post". */
export function parseLink(text: string): URL | null {
  const value = text.trim();
  if (/\s/.test(value) || value.length < 4) return null;
  const candidate = /^https?:\/\//i.test(value) ? value : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(value) ? `https://${value}` : null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.hostname.includes(".") ? url : null;
  } catch {
    return null;
  }
}

function recentOption(item: { wiki: string; title: string; description: string; thumbnail: string | null; url?: string | null }, prefix = "recent"): SearchOption {
  return {
    key: `${prefix}:${item.wiki}:${item.title}`,
    kind: "recent",
    wiki: item.wiki,
    title: item.title,
    description: item.description,
    thumbnail: item.thumbnail,
    url: item.url ?? undefined,
  };
}

/** Recently read and recently searched articles, newest first, without repeats. */
export function useRecentOptions(limit = 6): SearchOption[] {
  const { user } = useSession();
  const { snapshot } = useLibrary(user);
  const recent = recentSearchStore.use();
  const seen = new Set<string>();
  const items: SearchOption[] = [];
  const candidates = [...snapshot.history.slice(0, 4), ...recent.map((item) => ({ ...item, description: "", thumbnail: null, url: null }))];
  for (const item of candidates) {
    const key = `${item.wiki}:${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(recentOption(item));
  }
  return items.slice(0, limit);
}

/**
 * Typeahead results for a query. A pasted wiki link opens that article, any
 * other link opens in the web reader, saved and recently read pages that match
 * show instantly, and the AI is always offered as the last row (first for questions).
 */
export function useArticleSearch(query: string, wiki: string) {
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, 140);
  const link = parseLink(trimmed);
  const wikiTarget = link ? parseWikiUrl(link.toString()) : null;
  const ai = useQuery(aiStatusQuery);
  const { user } = useSession();
  const { snapshot } = useLibrary(user);

  const results = useQuery({
    ...searchQuery(wiki, link ? "" : debounced),
    placeholderData: keepPreviousData,
  });

  const options: SearchOption[] = [];
  if (wikiTarget) {
    options.push({
      key: `url:${wikiTarget.wiki}:${wikiTarget.title}`,
      kind: "url",
      wiki: wikiTarget.wiki,
      title: wikiTarget.title,
      description: `Open from ${wikiTarget.wiki}`,
      thumbnail: null,
    });
  } else if (link) {
    options.push({
      key: `link:${link}`,
      kind: "link",
      wiki: `web:${link.hostname.replace(/^www\./, "")}`,
      title: "Read this page",
      description: link.hostname.replace(/^www\./, "") + (link.pathname.length > 1 ? link.pathname : ""),
      thumbnail: null,
      url: link.toString(),
    });
  } else if (trimmed) {
    const asking = ai.data?.enabled === true && trimmed.length >= 2;
    const question = looksLikeQuestion(trimmed);
    const askOption: SearchOption = {
      key: `ask:${trimmed}`,
      kind: "ask",
      wiki,
      title: question ? trimmed : `Ask AI about “${trimmed}”`,
      query: trimmed,
      description: "Ask AI · answers with live sources",
      thumbnail: null,
    };
    if (asking && question) options.push(askOption);

    // Saved and recently read pages that match, before the network answers.
    const needle = trimmed.toLowerCase();
    const local: SearchOption[] = [];
    const taken = new Set<string>();
    if (needle.length >= 2) {
      for (const item of [...snapshot.bookmarks, ...snapshot.history]) {
        const key = `${item.wiki}:${item.title}`;
        if (taken.has(key) || !item.title.toLowerCase().includes(needle)) continue;
        taken.add(key);
        local.push(recentOption(item, "mine"));
        if (local.length === 3) break;
      }
    }
    options.push(...local);
    for (const hit of (results.data ?? []) as SearchHit[]) {
      if (taken.has(`${wiki}:${hit.title}`)) continue;
      options.push({
        key: `article:${wiki}:${hit.title}`,
        kind: "article",
        wiki,
        title: hit.title,
        description: hit.description,
        thumbnail: hit.thumbnail,
      });
    }
    if (asking && !question) options.push(askOption);
  }

  return {
    options,
    isFetching: results.isFetching && !link,
    isSettled: debounced === trimmed && !results.isFetching,
  };
}

// ---- command palette open state --------------------------------------------

let paletteOpen = false;
const listeners = new Set<() => void>();

export function setPaletteOpen(open: boolean) {
  paletteOpen = open;
  listeners.forEach((listener) => listener());
}

export function usePaletteOpen() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => paletteOpen,
    () => false
  );
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? "⌘" : "Ctrl";
