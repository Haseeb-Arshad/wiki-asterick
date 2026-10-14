import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { SearchHit } from "../../shared/types";
import { parseWikiUrl } from "../../shared/wiki";
import { aiStatusQuery } from "./assistant";
import { useDebouncedValue } from "./hooks";
import { searchQuery } from "./queries";

export interface SearchOption {
  key: string;
  kind: "article" | "url" | "link" | "ask" | "recent" | "action" | "fulltext";
  wiki: string;
  title: string;
  description: string;
  thumbnail: string | null;
  /** Web pages (kind "link"). */
  url?: string;
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

/**
 * Typeahead results for a query. A pasted wiki link opens that article, any
 * other link opens in the web reader, and a question offers to ask the AI.
 */
export function useArticleSearch(query: string, wiki: string) {
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, 140);
  const link = parseLink(trimmed);
  const wikiTarget = link ? parseWikiUrl(link.toString()) : null;
  const ai = useQuery(aiStatusQuery);

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
    if (ai.data?.enabled && looksLikeQuestion(trimmed)) {
      options.push({ key: `ask:${trimmed}`, kind: "ask", wiki, title: trimmed, description: "Ask AI · answers with live sources", thumbnail: null });
    }
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
