import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { SearchHit } from "../../shared/types";
import { parseWikiUrl } from "../../shared/wiki";
import { useDebouncedValue } from "./hooks";
import { searchQuery } from "./queries";

export interface SearchOption {
  key: string;
  kind: "article" | "url" | "recent" | "action" | "fulltext";
  wiki: string;
  title: string;
  description: string;
  thumbnail: string | null;
}

/** Typeahead results for a query, plus a direct hit when the query is a wiki URL. */
export function useArticleSearch(query: string, wiki: string) {
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, 140);
  const pasted = /^(https?:\/\/|[a-z-]+\.(m\.)?wiki)/i.test(trimmed) ? parseWikiUrl(trimmed) : null;

  const results = useQuery({
    ...searchQuery(wiki, pasted ? "" : debounced),
    placeholderData: keepPreviousData,
  });

  const options: SearchOption[] = [];
  if (pasted) {
    options.push({
      key: `url:${pasted.wiki}:${pasted.title}`,
      kind: "url",
      wiki: pasted.wiki,
      title: pasted.title,
      description: `Open from ${pasted.wiki}`,
      thumbnail: null,
    });
  } else if (trimmed) {
    for (const hit of (results.data ?? []) as SearchHit[]) {
      options.push({
        key: `article:${wiki}:${hit.title}`,
        kind: "article",
        wiki,
        title: hit.title,
        description: hit.description,
        thumbnail: hit.thumbnail,
      });
    }
  }

  return {
    options,
    isFetching: results.isFetching && !pasted,
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
