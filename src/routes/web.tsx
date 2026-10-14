import { createFileRoute, redirect } from "@tanstack/react-router";
import { parseWikiUrl, titleToPath, wikiSlug } from "../../shared/wiki";
import { WebReaderPage } from "../components/reader/WebReaderPage";

/** Any article link someone shares: /web?url=https://… */
export const Route = createFileRoute("/web")({
  validateSearch: (search: Record<string, unknown>) => ({ url: typeof search.url === "string" ? search.url : "" }),
  beforeLoad: ({ search }) => {
    // Wiki links read better in the wiki reader.
    const wiki = search.url ? parseWikiUrl(search.url) : null;
    if (wiki) throw redirect({ to: "/read/$wiki/$", params: { wiki: wikiSlug(wiki.wiki), _splat: titleToPath(wiki.title) }, replace: true });
  },
  component: function WebRoute() {
    const { url } = Route.useSearch();
    return <WebReaderPage url={url} />;
  },
});
