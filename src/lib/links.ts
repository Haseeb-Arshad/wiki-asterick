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

/** Link to any saved item: wiki articles go to the wiki reader, web pages to /web. */
export function refLink(ref: { wiki: string; title: string; url?: string | null }, hash?: string) {
  if (ref.wiki.startsWith("web:") && ref.url) {
    return { to: "/web" as const, search: { url: ref.url }, ...(hash ? { hash } : {}) };
  }
  return articleLink(ref.wiki, ref.title, hash);
}

export function isWebWiki(wiki: string): boolean {
  return wiki.startsWith("web:");
}
