import { createFileRoute } from "@tanstack/react-router";
import { pathToTitle } from "../../shared/wiki";
import { ReaderPage } from "../components/reader/ReaderPage";
import { wikiFromParam } from "../lib/links";
import { articleQuery, summaryQuery } from "../lib/queries";

export const Route = createFileRoute("/read/$wiki/$")({
  // A shared passage: the article opens scrolled to it, with the passage flashing.
  validateSearch: (search: Record<string, unknown>): { quote?: string } => ({
    quote: typeof search.quote === "string" && search.quote.trim() ? search.quote.slice(0, 300) : undefined,
  }),
  // Runs on hover (preload: "intent") and on navigation. Start fetching without
  // blocking, so the skeleton shows immediately instead of a frozen page.
  loader: ({ context, params }) => {
    const wiki = wikiFromParam(params.wiki);
    const title = pathToTitle(params._splat ?? "");
    if (!wiki || !title) return;
    void context.queryClient.prefetchQuery(articleQuery(wiki, title));
    // The short summary comes back first and fills the page while the full article loads.
    void context.queryClient.prefetchQuery(summaryQuery(wiki, title));
  },
  component: ReaderPage,
});
