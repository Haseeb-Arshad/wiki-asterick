import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { ArticleSummary, MediaItem, WikiFeed } from "../../shared/types";
import { FEATURED_LANGUAGES, normalizeWikiHost, wikiLanguage } from "../../shared/wiki";
import { useSession } from "../lib/auth";
import { formatCompact, formatDate, formatRelative } from "../lib/format";
import { useLibrary } from "../lib/library";
import { articleLink } from "../lib/links";
import { wikiStore } from "../lib/preferences";
import { feedQuery, fetchRandomArticle } from "../lib/queries";
import { toast } from "../lib/toast";
import { AsteriskMark } from "./AsteriskIcon";
import { Icon } from "./Icon";
import { Lightbox } from "./Lightbox";
import { SearchBox } from "./SearchBox";
import { Sparkline } from "./Sparkline";
import { Thumb } from "./Thumb";

const STARTERS: Record<string, string[]> = {
  en: ["Apollo 11", "Byzantine Empire", "Ada Lovelace", "Black hole"],
  ur: ["پاکستان", "علامہ محمد اقبال", "لاہور"],
  de: ["Mond", "Berliner Mauer", "Johann Sebastian Bach"],
  fr: ["Lune", "Révolution française", "Marie Curie"],
  es: ["Luna", "Imperio inca", "Frida Kahlo"],
};

export function HomePage() {
  const wiki = wikiStore.use();
  const lang = wikiLanguage(wiki);
  const navigate = useNavigate();
  const [randomLoading, setRandomLoading] = useState(false);
  const languageName = FEATURED_LANGUAGES.find((language) => language.code === lang)?.name ?? lang;

  async function surprise() {
    setRandomLoading(true);
    try {
      const article = await fetchRandomArticle(wiki);
      navigate(articleLink(article.wiki, article.title));
    } catch {
      toast("Couldn't fetch a random article. Try again.", { tone: "error" });
    } finally {
      setRandomLoading(false);
    }
  }

  return (
    <>
      <section className="hero">
        <AsteriskMark className="hero-mark" size={560} />
        <div className="container">
          <p className="hero-eyebrow rise">
            <span className="dot" aria-hidden="true" />
            Reading {languageName} Wikipedia · 300+ languages available
          </p>
          <h1 className="hero-title rise" style={{ "--i": 1 } as React.CSSProperties}>
            Wikipedia, <em>without the clutter.</em>
          </h1>
          <p className="hero-copy rise" style={{ "--i": 2 } as React.CSSProperties}>
            Search any article, read it in a calm layout, watch its videos, and keep your highlights in one place, synced
            when you sign in.
          </p>
          <div className="rise" style={{ "--i": 3 } as React.CSSProperties}>
            <SearchBox wiki={wiki} />
            <div className="hero-actions">
              <label className="visually-hidden" htmlFor="home-language">
                Language
              </label>
              <select
                id="home-language"
                className="select"
                value={lang}
                onChange={(event) => wikiStore.set(normalizeWikiHost(event.target.value) ?? wiki)}
              >
                {!FEATURED_LANGUAGES.some((language) => language.code === lang) && <option value={lang}>{wiki}</option>}
                {FEATURED_LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.name}
                  </option>
                ))}
              </select>
              <button type="button" className="chip" onClick={surprise} disabled={randomLoading}>
                {randomLoading ? <span className="spinner" aria-hidden="true" /> : <Icon name="shuffle" size={15} />}
                Surprise me
              </button>
            </div>
            {STARTERS[lang] && (
              <div className="hero-try">
                <span>Try</span>
                {STARTERS[lang].map((title) => (
                  <Link key={title} {...articleLink(wiki, title)} className="chip">
                    {title}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <ContinueReading />
      <TodayFeed wiki={wiki} />
    </>
  );
}

function ContinueReading() {
  const { user } = useSession();
  const { snapshot } = useLibrary(user);
  const items = snapshot.history.filter((entry) => entry.progress < 0.97).slice(0, 8);
  if (!items.length) return null;

  return (
    <section className="section container" aria-labelledby="continue-title">
      <div className="section-head">
        <h2 className="section-title" id="continue-title">
          Continue reading
        </h2>
        <Link to="/library" search={{ tab: "history" }} className="text-link">
          History
        </Link>
      </div>
      <div className="shelf">
        {items.map((entry) => (
          <Link key={`${entry.wiki}:${entry.title}`} {...articleLink(entry.wiki, entry.title, entry.sectionId ?? undefined)} className="shelf-card">
            <Thumb src={entry.thumbnail} width={120} />
            <span>
              <strong>{entry.title}</strong>
              <small>
                {Math.round(entry.progress * 100)}% · {formatRelative(entry.readAt)}
              </small>
              <span className="progress-track" aria-hidden="true">
                <span style={{ transform: `scaleX(${Math.max(0.04, entry.progress)})` }} />
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function TodayFeed({ wiki }: { wiki: string }) {
  const feed = useQuery(feedQuery(wiki));
  const [viewer, setViewer] = useState<MediaItem | null>(null);

  if (!wiki.endsWith(".wikipedia.org")) return null;

  if (feed.isError) {
    return (
      <section className="section container">
        <div className="empty-state">
          <Icon name="calendar" size={28} />
          <h3>No daily highlights here</h3>
          <p>This language edition doesn't publish a daily feed. Search above to start reading.</p>
        </div>
      </section>
    );
  }

  const data = feed.data;

  return (
    <section className="section container" aria-labelledby="today-title">
      <div className="section-head">
        <h2 className="section-title" id="today-title">
          Today on Wikipedia
        </h2>
        <span className="section-meta">{data ? formatDate(`${data.date}T12:00:00Z`, { dateStyle: "full" }) : " "}</span>
      </div>

      {!data ? (
        <FeedSkeleton />
      ) : (
        <div className="feed">
          <div className="feed-col">
            {data.featured && <Featured article={data.featured} />}
            {data.news.length > 0 && <News feed={data} />}
            {data.onThisDay.length > 0 && <OnThisDay feed={data} />}
          </div>
          <div className="feed-col">
            {data.mostRead.length > 0 && <Trending feed={data} />}
            {data.picture && (
              <div>
                <h3 className="block-title">
                  <Icon name="image" size={18} /> Picture of the day
                </h3>
                <button
                  type="button"
                  className="potd"
                  onClick={() =>
                    setViewer({
                      id: "potd",
                      type: "image",
                      file: data.picture!.title,
                      caption: data.picture!.description || data.picture!.title,
                      src: data.picture!.src,
                      thumb: data.picture!.thumb,
                      width: data.picture!.width,
                      height: data.picture!.height,
                      poster: null,
                      sources: [],
                      durationSeconds: null,
                      sectionId: "",
                      filePage: data.picture!.filePage,
                    })
                  }
                >
                  <img src={data.picture.thumb} alt={data.picture.description || data.picture.title} loading="lazy" />
                  <span className="potd-caption">
                    <strong>{data.picture.title}</strong>
                    {data.picture.credit && <span>{data.picture.credit}</span>}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {viewer && <Lightbox items={[viewer]} index={0} onIndexChange={() => undefined} onClose={() => setViewer(null)} />}
    </section>
  );
}

function Featured({ article }: { article: ArticleSummary }) {
  return (
    <Link {...articleLink(article.wiki, article.title)} className="feature">
      <Thumb src={article.image?.src ?? article.thumbnail} width={960} eager alt="" />
      <div>
        <span className="eyebrow">
          <Icon name="book" size={15} /> Featured article
        </span>
        <h3 className="feature-title">{article.title}</h3>
        <p className="feature-extract">{article.extract}</p>
        <span className="read-more">
          Read the article <Icon name="arrowRight" size={16} />
        </span>
      </div>
    </Link>
  );
}

function Trending({ feed }: { feed: WikiFeed }) {
  return (
    <div>
      <h3 className="block-title">
        <Icon name="trending" size={18} /> Trending now
      </h3>
      <ol className="trend-list">
        {feed.mostRead.slice(0, 8).map((article) => (
          <li key={article.title}>
            <Link {...articleLink(article.wiki, article.title)} className="trend">
              <span className="trend-rank">{String(article.rank).padStart(2, "0")}</span>
              <span>
                <span className="trend-title">{article.title}</span>
                {article.description && <span className="trend-desc">{article.description}</span>}
              </span>
              <span className="trend-stats" title={`${article.views.toLocaleString()} views yesterday`}>
                <Sparkline values={article.trend} />
                {formatCompact(article.views)}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

function News({ feed }: { feed: WikiFeed }) {
  return (
    <div>
      <h3 className="block-title">
        <Icon name="newspaper" size={18} /> In the news
      </h3>
      <ul className="news-list">
        {feed.news.map((item) => {
          const lead = item.links.find((link) => link.thumbnail) ?? item.links[0];
          return (
            <li key={item.story} className="news-item">
              <div>
                <p>{item.story}</p>
                <div className="link-row">
                  {item.links.map((link) => (
                    <Link key={link.title} {...articleLink(link.wiki, link.title)} className="chip">
                      {link.title}
                    </Link>
                  ))}
                </div>
              </div>
              {lead?.thumbnail ? <Thumb src={lead.thumbnail} width={250} /> : <span />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OnThisDay({ feed }: { feed: WikiFeed }) {
  return (
    <div>
      <h3 className="block-title">
        <Icon name="calendar" size={18} /> On this day
      </h3>
      <ol className="timeline">
        {feed.onThisDay.map((event) => (
          <li key={`${event.year}-${event.text.slice(0, 24)}`}>
            <span className="timeline-year">{event.year}</span>
            <div>
              <p className="timeline-text">{event.text}</p>
              <div className="link-row">
                {event.pages.map((page) => (
                  <Link key={page.title} {...articleLink(page.wiki, page.title)} className="chip">
                    {page.title}
                  </Link>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="feed" aria-busy="true" aria-label="Loading today's highlights">
      <div className="feed-col">
        <div>
          <div className="skeleton" style={{ aspectRatio: "16 / 10", borderRadius: 16 }} />
          <div className="skeleton skeleton-text" style={{ width: "30%", marginTop: 22 }} />
          <div className="skeleton" style={{ height: 40, width: "80%", marginTop: 12 }} />
          <div className="skeleton skeleton-text" style={{ marginTop: 16 }} />
          <div className="skeleton skeleton-text" style={{ width: "90%" }} />
        </div>
      </div>
      <div className="feed-col">
        <div>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="skeleton" style={{ height: 44, margin: "0 0 14px" }} />
          ))}
        </div>
      </div>
    </div>
  );
}
