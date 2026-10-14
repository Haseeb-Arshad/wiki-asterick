import { createFileRoute, redirect } from "@tanstack/react-router";
import { parseWikiUrl, titleToPath, wikiSlug } from "../../shared/wiki";

// Links from the previous version (/article?url=https://en.wikipedia.org/wiki/…).
export const Route = createFileRoute("/article")({
  validateSearch: (search: Record<string, unknown>) => ({ url: typeof search.url === "string" ? search.url : "" }),
  beforeLoad: ({ search }) => {
    const target = parseWikiUrl(search.url);
    if (!target) throw redirect({ to: "/" });
    throw redirect({ to: "/read/$wiki/$", params: { wiki: wikiSlug(target.wiki), _splat: titleToPath(target.title) }, replace: true });
  },
});
