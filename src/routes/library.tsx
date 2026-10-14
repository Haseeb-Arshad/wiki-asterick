import { createFileRoute } from "@tanstack/react-router";
import { LibraryPage, type LibraryTab } from "../components/LibraryPage";

const TABS: LibraryTab[] = ["saved", "highlights", "history"];

export const Route = createFileRoute("/library")({
  validateSearch: (search: Record<string, unknown>): { tab?: LibraryTab } => ({
    tab: TABS.includes(search.tab as LibraryTab) ? (search.tab as LibraryTab) : undefined,
  }),
  component: function LibraryRoute() {
    const { tab } = Route.useSearch();
    return <LibraryPage tab={tab ?? "saved"} />;
  },
});
