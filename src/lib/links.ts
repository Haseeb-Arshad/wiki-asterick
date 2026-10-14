import { normalizeWikiHost, titleToPath, wikiSlug } from "../../shared/wiki";

/** Props for <Link> (or navigate) to an article in the reader. */
export function articleLink(wiki: string, title: string, hash?: string) {
  return {
    to: "/read/$wiki/$" as const,
    params: { wiki: wikiSlug(wiki), _splat: titleToPath(title) },
    ...(hash ? { hash } : {}),
  };
}

/** Resolves the `$wiki` route param ("en", "de.wikivoyage") to a host. */
export function wikiFromParam(param: string): string | null {
  return normalizeWikiHost(param);
}

export function absoluteArticleUrl(wiki: string, title: string): string {
  return `${window.location.origin}/read/${wikiSlug(wiki)}/${encodeURIComponent(titleToPath(title))}`;
}
