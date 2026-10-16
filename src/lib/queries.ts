import { queryOptions } from "@tanstack/react-query";
import type { ArticleSummary, SearchHit, WikiArticle, WikiFeed } from "../../shared/types";
import { api } from "./api";

const MINUTE = 60_000;

const params = (values: Record<string, string>) => new URLSearchParams(values).toString();

/** The exact request address for an article; offline copies are stored under it. */
export const articlePath = (wiki: string, title: string) => `/api/wiki/article?${params({ wiki, title })}`;
export const webArticlePath = (url: string) => `/api/web/article?${params({ url })}`;

export const articleQuery = (wiki: string, title: string) =>
  queryOptions({
    queryKey: ["article", wiki, title],
    queryFn: ({ signal }) => api<WikiArticle>(articlePath(wiki, title), { signal }),
    staleTime: 15 * MINUTE,
    gcTime: 30 * MINUTE,
  });

export const summaryQuery = (wiki: string, title: string) =>
  queryOptions({
    queryKey: ["summary", wiki, title],
    queryFn: ({ signal }) => api<ArticleSummary>(`/api/wiki/summary?${params({ wiki, title })}`, { signal }),
    staleTime: 30 * MINUTE,
  });

export const searchQuery = (wiki: string, q: string, mode: "title" | "full" = "title") =>
  queryOptions({
    queryKey: ["search", wiki, mode, q],
    queryFn: ({ signal }) => api<SearchHit[]>(`/api/wiki/search?${params({ wiki, q, mode })}`, { signal }),
    staleTime: 10 * MINUTE,
    enabled: q.trim().length > 0,
  });

export const relatedQuery = (wiki: string, title: string) =>
  queryOptions({
    queryKey: ["related", wiki, title],
    queryFn: ({ signal }) => api<SearchHit[]>(`/api/wiki/related?${params({ wiki, title })}`, { signal }),
    staleTime: 60 * MINUTE,
  });

export const feedQuery = (wiki: string) =>
  queryOptions({
    queryKey: ["feed", wiki],
    queryFn: ({ signal }) => api<WikiFeed>(`/api/wiki/feed?${params({ wiki })}`, { signal }),
    staleTime: 30 * MINUTE,
    retry: (count, error) => count < 1 && (error as { status?: number }).status !== 404,
  });

export function fetchRandomArticle(wiki: string) {
  return api<ArticleSummary>(`/api/wiki/random?${params({ wiki })}`);
}

export const webArticleQuery = (url: string) =>
  queryOptions({
    queryKey: ["web-article", url],
    queryFn: ({ signal }) => api<WikiArticle>(webArticlePath(url), { signal }),
    staleTime: 15 * MINUTE,
    gcTime: 30 * MINUTE,
  });

export interface SimilarPage {
  title: string;
  url: string;
  site: string;
  description: string;
}

export const similarPagesQuery = (url: string) =>
  queryOptions({
    queryKey: ["similar", url],
    queryFn: ({ signal }) => api<SimilarPage[]>(`/api/web/similar?${params({ url })}`, { signal }),
    staleTime: 60 * MINUTE,
  });
