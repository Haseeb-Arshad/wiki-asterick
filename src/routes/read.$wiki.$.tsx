import { createFileRoute } from "@tanstack/react-router";
import { pathToTitle } from "../../shared/wiki";
import { ReaderPage } from "../components/reader/ReaderPage";
import { wikiFromParam } from "../lib/links";
import { articleQuery } from "../lib/queries";

export const Route = createFileRoute("/read/$wiki/$")({
  // Runs on hover (preload: "intent") and on navigation. Start fetching without
  // blocking, so the skeleton shows immediately instead of a frozen page.
  loader: ({ context, params }) => {
    const wiki = wikiFromParam(params.wiki);
    const title = pathToTitle(params._splat ?? "");
    if (wiki && title) void context.queryClient.prefetchQuery(articleQuery(wiki, title));
  },
  component: ReaderPage,
});
