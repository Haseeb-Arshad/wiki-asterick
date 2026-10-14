import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { webArticleQuery } from "../../lib/queries";
import { openAssistant } from "../../lib/assistant";
import { setPaletteOpen } from "../../lib/search";
import { AsteriskMark } from "../AsteriskIcon";
import { Icon } from "../Icon";
import { ArticleView } from "./ArticleView";
import { ArticleSkeleton } from "./ReaderPage";

/** Reads any shared article link in the same reader as wiki articles. */
export function WebReaderPage({ url }: { url: string }) {
  const query = useQuery({ ...webArticleQuery(url), enabled: Boolean(url) });

  if (!url) {
    return (
      <section className="message-page">
        <AsteriskMark size={48} />
        <h1>Paste a link to read it here</h1>
        <p>Any article (a blog post, a newsletter, a news story) opens in the same calm reader, with highlights and AI help.</p>
        <div className="message-actions">
          <button type="button" className="btn btn-primary" onClick={() => setPaletteOpen(true)}>
            <Icon name="link" size={17} /> Paste a link
          </button>
        </div>
      </section>
    );
  }

  if (query.isPending) return <ArticleSkeleton />;

  if (query.isError) {
    return (
      <section className="message-page">
        <AsteriskMark size={48} />
        <h1>We couldn't read this page</h1>
        <p>{query.error.message} Some sites block reader apps or need a login.</p>
        <div className="message-actions">
          <a className="btn btn-primary" href={url} target="_blank" rel="noopener noreferrer nofollow">
            Open the original <Icon name="external" size={15} />
          </a>
          <button type="button" className="btn btn-secondary" onClick={() => openAssistant({ question: `What is this page about? ${url}` })}>
            <Icon name="sparkle" size={16} /> Ask AI about it
          </button>
          <Link to="/" className="btn btn-ghost">
            Go home
          </Link>
        </div>
      </section>
    );
  }

  return <ArticleView key={url} article={query.data} webUrl={url} />;
}
