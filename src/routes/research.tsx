import { createFileRoute } from "@tanstack/react-router";
import { ResearchPage } from "../components/ResearchPage";

/** /research?q=<topic>: papers, researchers, images and articles about a topic. */
export const Route = createFileRoute("/research")({
  validateSearch: (search: Record<string, unknown>): { q: string; wiki?: string } => ({
    q: typeof search.q === "string" ? search.q.slice(0, 160) : "",
    wiki: typeof search.wiki === "string" ? search.wiki : undefined,
  }),
  component: function ResearchRoute() {
    const { q, wiki } = Route.useSearch();
    return <ResearchPage q={q} wiki={wiki} />;
  },
});
