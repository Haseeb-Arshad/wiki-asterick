import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { pathToTitle, wikiSlug } from "../../../shared/wiki";
import { ApiError } from "../../lib/api";
import { articleLink, wikiFromParam } from "../../lib/links";
import { articleQuery, searchQuery } from "../../lib/queries";
import { setPaletteOpen } from "../../lib/search";
import { AsteriskMark } from "../AsteriskIcon";
import { Icon } from "../Icon";
import { Thumb } from "../Thumb";
import { ArticleView } from "./ArticleView";

export function ReaderPage() {
  const params = useParams({ from: "/read/$wiki/$" });
  const wiki = wikiFromParam(params.wiki);
  const title = pathToTitle(params._splat ?? "");

  if (!wiki || !title) {
    return (
      <section className="message-page">
        <AsteriskMark size={48} />
        <h1>That link doesn't point to an article</h1>
        <p>WikiAsterisk reads Wikipedia and other Wikimedia wikis in any language. Try searching instead.</p>
        <div className="message-actions">
          <button type="button" className="btn btn-primary" onClick={() => setPaletteOpen(true)}>
            <Icon name="search" size={17} /> Search articles
          </button>
        </div>
      </section>
    );
  }

  return <ArticleLoader wiki={wiki} title={title} />;
}

function ArticleLoader({ wiki, title }: { wiki: string; title: string }) {
  const query = useQuery(articleQuery(wiki, title));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const article = query.data;

  // Redirects ("USA" → "United States"): show the canonical title in the URL.
  useEffect(() => {
    if (!article || article.title === title || article.wiki !== wiki) return;
    queryClient.setQueryData(articleQuery(wiki, article.title).queryKey, article);
    navigate({ ...articleLink(wiki, article.title, window.location.hash.slice(1) || undefined), replace: true });
  }, [article, navigate, queryClient, title, wiki]);

  if (query.isPending) return <ArticleSkeleton />;
  if (query.isError) return <ArticleError error={query.error} wiki={wiki} title={title} onRetry={() => query.refetch()} />;
  return <ArticleView key={`${article!.wiki}:${article!.title}`} article={article!} />;
}

export function ArticleSkeleton() {
  return (
    <div className="reader" aria-busy="true" aria-label="Loading article">
      <div className="column article-header">
        <div className="skeleton skeleton-text" style={{ width: 180 }} />
        <div className="skeleton skeleton-title" style={{ width: "85%", marginTop: 18 }} />
        <div className="skeleton skeleton-title" style={{ width: "55%" }} />
        <div className="skeleton skeleton-text" style={{ width: "70%", marginTop: 20, height: 20 }} />
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 30 }}>
          <div className="skeleton" style={{ width: 44, height: 44, borderRadius: 14 }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton skeleton-text" style={{ width: 160 }} />
            <div className="skeleton skeleton-text" style={{ width: 220 }} />
          </div>
        </div>
        <div className="skeleton" style={{ height: 1, margin: "28px 0" }} />
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="skeleton skeleton-text" style={{ height: 18, width: index % 4 === 3 ? "62%" : "100%", margin: "16px 0" }} />
        ))}
      </div>
    </div>
  );
}

function ArticleError({ error, wiki, title, onRetry }: { error: Error; wiki: string; title: string; onRetry: () => void }) {
  const notFound = error instanceof ApiError && error.status === 404;
  const suggestions = useQuery({ ...searchQuery(wiki, title), enabled: notFound });

  if (!notFound) {
    return (
      <section className="message-page">
        <AsteriskMark size={48} />
        <h1>We couldn't load this article</h1>
        <p>{error.message}</p>
        <div className="message-actions">
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            Try again
          </button>
          <Link to="/" className="btn btn-secondary">
            Go home
          </Link>
        </div>
      </section>
    );
  }

  const hits = suggestions.data ?? [];
  return (
    <section className="container" style={{ maxWidth: 680, paddingTop: 64 }}>
      <AsteriskMark size={44} />
      <h1 className="page-title" style={{ marginTop: 18 }}>
        No article called “{title}”
      </h1>
      <p className="page-sub">
        {wiki} doesn't have a page with that exact title.{hits.length ? " Maybe you meant one of these:" : ""}
      </p>
      {hits.length > 0 && (
        <ul className="item-list" style={{ marginTop: 24 }}>
          {hits.slice(0, 6).map((hit) => (
            <li key={hit.title} className="item">
              <Thumb src={hit.thumbnail} width={120} />
              <div>
                <Link {...articleLink(wiki, hit.title)} className="item-title">
                  {hit.title}
                </Link>
                {hit.description && <span className="item-desc">{hit.description}</span>}
              </div>
              <span />
            </li>
          ))}
        </ul>
      )}
      <div className="message-actions" style={{ justifyContent: "flex-start", marginTop: 28 }}>
        <Link to="/search" search={{ q: title, wiki: wikiSlug(wiki) }} className="btn btn-primary">
          <Icon name="search" size={17} /> Search all articles
        </Link>
        <Link to="/" className="btn btn-secondary">
          Go home
        </Link>
      </div>
    </section>
  );
}
