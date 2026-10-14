import { createFileRoute } from "@tanstack/react-router";
import { SearchPage } from "../components/SearchPage";

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q.slice(0, 200) : "",
    wiki: typeof search.wiki === "string" ? search.wiki : undefined,
  }),
  component: function SearchRoute() {
    const { q, wiki } = Route.useSearch();
    return <SearchPage q={q} wiki={wiki} />;
  },
});
