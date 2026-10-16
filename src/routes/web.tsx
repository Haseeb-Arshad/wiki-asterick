import { createFileRoute, redirect } from "@tanstack/react-router";
import { parseWikiUrl, titleToPath, wikiSlug } from "../../shared/wiki";
import { WebReaderPage } from "../components/reader/WebReaderPage";

/** Any article link someone shares: /web?url=https://… */
export const Route = createFileRoute("/web")({
  validateSearch: (search: Record<string, unknown>): { url: string; quote?: string } => ({
    url: typeof search.url === "string" ? search.url : "",
    quote: typeof search.quote === "string" && search.quote.trim() ? search.quote.slice(0, 300) : undefined,
  }),
  beforeLoad: ({ search }) => {
    // Wiki links read better in the wiki reader.
    const wiki = search.url ? parseWikiUrl(search.url) : null;
    if (wiki) throw redirect({ to: "/read/$wiki/$", params: { wiki: wikiSlug(wiki.wiki), _splat: titleToPath(wiki.title) }, search: { quote: search.quote }, replace: true });
  },
  component: function WebRoute() {
    const { url } = Route.useSearch();
    return <WebReaderPage url={url} />;
  },
});
