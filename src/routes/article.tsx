import { createFileRoute } from "@tanstack/react-router";
import { ArticlePage } from "../components/ArticlePage";

export const Route = createFileRoute("/article")({
  component: ArticlePage,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      url: (search.url as string) || "",
    };
  },
});