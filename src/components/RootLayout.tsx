import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { onSessionEnded } from "../lib/api";
import { sessionQuery, useSession } from "../lib/auth";
import { useHotkeys } from "../lib/hooks";
import { useGuestLibrarySync } from "../lib/library";
import { articleLink } from "../lib/links";
import { useApplyTheme, wikiStore } from "../lib/preferences";
import { fetchRandomArticle } from "../lib/queries";
import { setPaletteOpen } from "../lib/search";
import { toast } from "../lib/toast";
import { aiStatusQuery, focusAskBar } from "../lib/assistant";
import { AskBar } from "./ai/AskBar";
import { NotesDrawer } from "./ai/NotesDrawer";
import { AppHeader } from "./AppHeader";
import { AsteriskMark } from "./AsteriskIcon";
import { CommandPalette } from "./CommandPalette";
import { Icon } from "./Icon";
import { Toaster } from "./Toaster";

export function RootLayout() {
  useApplyTheme();
  const queryClient = useQueryClient();
  const { user } = useSession();
  useGuestLibrarySync(user);

  useEffect(
    () =>
      onSessionEnded(() => {
        if (!queryClient.getQueryData(sessionQuery.queryKey)) return;
        queryClient.setQueryData(sessionQuery.queryKey, null);
        queryClient.removeQueries({ queryKey: ["library"] });
        toast("Your session ended. Sign in again to keep syncing.");
      }),
    [queryClient]
  );

  const aiStatus = useQuery(aiStatusQuery);
  useHotkeys({
    "mod+k": () => setPaletteOpen(true),
    "/": () => setPaletteOpen(true),
    a: (event) => {
      if (!aiStatus.data?.enabled) return;
      event.preventDefault();
      focusAskBar();
    },
  });

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <AppHeader />
      <main id="main" className="app-main" tabIndex={-1}>
        <Outlet />
      </main>
      <AppFooter />
      <CommandPalette />
      <AskBar />
      <NotesDrawer />
      <Toaster />
    </div>
  );
}

function AppFooter() {
  const navigate = useNavigate();
  const wiki = wikiStore.use();

  return (
    <footer className="app-footer">
      <div className="container footer-inner">
        <div>
          <Link to="/" className="brand">
            <AsteriskMark size={20} />
            <span>WikiAsterisk</span>
          </Link>
          <p>
            Articles and media come from Wikipedia and other Wikimedia projects, written by their contributors and shared under{" "}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">
              CC BY-SA 4.0
            </a>
            . WikiAsterisk is an independent reader, not affiliated with the Wikimedia Foundation.
          </p>
        </div>
        <nav className="footer-links" aria-label="Footer">
          <Link to="/">Home</Link>
          <Link to="/library">Library</Link>
          <button type="button" onClick={() => setPaletteOpen(true)}>
            Search
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                const article = await fetchRandomArticle(wiki);
                navigate(articleLink(article.wiki, article.title));
              } catch {
                toast("Couldn't fetch a random article. Try again.", { tone: "error" });
              }
            }}
          >
            Surprise me
          </button>
          <a href="https://wikimediafoundation.org/support/" target="_blank" rel="noopener noreferrer">
            Support Wikipedia <Icon name="external" size={12} />
          </a>
        </nav>
      </div>
    </footer>
  );
}

export function NotFound() {
  return (
    <section className="message-page">
      <AsteriskMark size={48} />
      <h1>This page wandered off</h1>
      <p>The address doesn't match anything here. Try searching for the article instead.</p>
      <div className="message-actions">
        <button type="button" className="btn btn-primary" onClick={() => setPaletteOpen(true)}>
          <Icon name="search" size={17} /> Search articles
        </button>
        <Link to="/" className="btn btn-secondary">
          Go home
        </Link>
      </div>
    </section>
  );
}
