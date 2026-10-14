import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { normalizeWikiHost, wikiSlug } from "../../shared/wiki";
import { articleLink } from "../lib/links";
import { wikiStore } from "../lib/preferences";
import { searchQuery } from "../lib/queries";
import { Icon } from "./Icon";
import { SearchBox } from "./SearchBox";
import { Thumb } from "./Thumb";

export function SearchPage({ q, wiki: wikiParam }: { q: string; wiki?: string }) {
  const preferred = wikiStore.use();
  const wiki = (wikiParam && normalizeWikiHost(wikiParam)) || preferred;
  const results = useQuery(searchQuery(wiki, q, "full"));
  const navigate = useNavigate();

  return (
    <div className="container" style={{ maxWidth: 780 }}>
      <header className="page-head">
        <h1 className="page-title">{q ? `Results for “${q}”` : "Search"}</h1>
        <p className="page-sub">Full-text search across {wiki}.</p>
        <div className="search-page-field">
          <SearchBox
            key={`${wiki}:${q}`}
            wiki={wiki}
            initialQuery={q}
            onWikiChange={(next) => {
              wikiStore.set(next);
              navigate({ to: "/search", search: { q, wiki: wikiSlug(next) }, replace: true });
            }}
          />
        </div>
      </header>

      {!q ? null : results.isPending ? (
        <div aria-busy="true">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="skeleton" style={{ height: 96, margin: "18px 0", borderRadius: 14 }} />
          ))}
        </div>
      ) : results.isError ? (
        <div className="empty-state">
          <Icon name="search" size={28} />
          <h3>Search is unavailable</h3>
          <p>{results.error.message}</p>
          <button type="button" className="btn btn-primary" onClick={() => results.refetch()}>
            Try again
          </button>
        </div>
      ) : results.data.length === 0 ? (
        <div className="empty-state">
          <Icon name="search" size={28} />
          <h3>Nothing found</h3>
          <p>No articles on {wiki} mention “{q}”. Check the spelling or try another language.</p>
        </div>
      ) : (
        <ol className="search-results">
          {results.data.map((hit, index) => (
            <li key={hit.title} className="rise" style={{ "--i": Math.min(index, 8) } as React.CSSProperties}>
              <Link {...articleLink(wiki, hit.title)} className="search-hit">
                <div style={{ minWidth: 0 }}>
                  <span className="item-title">{hit.title}</span>
                  {hit.description && <span className="item-desc">{hit.description}</span>}
                  {hit.excerpt && <p>{hit.excerpt}…</p>}
                </div>
                <Thumb src={hit.thumbnail} width={250} />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
