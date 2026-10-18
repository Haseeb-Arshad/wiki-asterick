import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { ResearchExpert, ResearchLink, ResearchPage as ResearchData, ResearchPaper } from "../../shared/types";
import { ask } from "../lib/assistant";
import { formatDate, pluralize } from "../lib/format";
import { useDocumentTitle } from "../lib/hooks";
import { articleLink } from "../lib/links";
import { researchQuery } from "../lib/queries";
import { AsteriskMark } from "./AsteriskIcon";
import { Icon } from "./Icon";
import { Thumb } from "./Thumb";

/** A topic gathered from Wikipedia, research papers, the field's leading researchers, images, the web and discussions. */
export function ResearchPage({ q, wiki }: { q: string; wiki?: string }) {
  const research = useQuery({ ...researchQuery(q, wiki ?? "en"), enabled: q.trim().length >= 2 });
  useDocumentTitle(q ? `Research: ${q}` : "Research");

  if (q.trim().length < 2) {
    return (
      <section className="message-page">
        <AsteriskMark size={48} />
        <h1>Research a topic</h1>
        <p>Type a topic in search and choose “Research” to gather papers, researchers, images and articles about it.</p>
      </section>
    );
  }

  if (research.isPending) return <ResearchLoading q={q} />;

  if (research.isError) {
    return (
      <section className="message-page">
        <AsteriskMark size={48} />
        <h1>We couldn't gather this topic</h1>
        <p>{research.error.message}</p>
        <div className="message-actions">
          <button type="button" className="btn btn-primary" onClick={() => research.refetch()}>
            Try again
          </button>
          <Link to="/" className="btn btn-secondary">
            Go home
          </Link>
        </div>
      </section>
    );
  }

  // Pages are shared by topic regardless of case, so the title keeps the casing that was typed.
  return <ResearchView data={research.data} topic={q.trim()} />;
}

function ResearchLoading({ q }: { q: string }) {
  return (
    <div className="container research" aria-busy="true">
      <header className="page-head">
        <p className="research-kicker">
          <Icon name="book" size={15} /> Research
        </p>
        <h1 className="page-title">{q}</h1>
        <p className="page-sub research-progress">
          <span className="spinner" aria-hidden="true" /> Gathering papers, leading researchers, images and articles, and checking each for relevance. The first time takes about ten
          seconds.
        </p>
      </header>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="skeleton" style={{ height: 110, margin: "18px 0", borderRadius: 16 }} />
      ))}
    </div>
  );
}

function ResearchView({ data, topic }: { data: ResearchData; topic: string }) {
  const sections = [
    { id: "overview", label: "Overview", count: data.overview ? 1 + data.articles.length : 0 },
    { id: "papers", label: "Papers", count: data.papers.length },
    { id: "researchers", label: "Researchers", count: data.experts.length },
    { id: "images", label: "Images", count: data.images.length },
    { id: "web", label: "From the web", count: data.web.length },
    { id: "discussions", label: "Discussions", count: data.discussions.length },
  ].filter((section) => section.count > 0);

  return (
    <div className="container research">
      <header className="page-head">
        <p className="research-kicker">
          <Icon name="book" size={15} /> Research
          {data.field && <span className="research-field">{data.field}</span>}
        </p>
        <h1 className="page-title">{topic}</h1>
        <p className="page-sub">
          Gathered from Wikipedia, research archives, the field's leading researchers, image collections and the web.
        </p>
        <div className="research-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void ask(`Give me an overview of ${topic}: the key ideas, the current state of research and the open questions.`)}>
            <Icon name="sparkle" size={16} /> Ask AI about this
          </button>
        </div>
        {sections.length > 1 && (
          <nav className="research-nav" aria-label="On this page">
            {sections.map((section) => (
              <a key={section.id} href={`#${section.id}`} className="chip">
                {section.label}
                <span className="count">{section.count}</span>
              </a>
            ))}
          </nav>
        )}
      </header>

      {sections.length === 0 && (
        <div className="empty-state">
          <Icon name="search" size={28} />
          <h3>Nothing relevant found</h3>
          <p>No source had material clearly about “{topic}”. Try a shorter or more common name for the topic.</p>
        </div>
      )}

      {data.overview && (
        <section id="overview" className="research-section">
          <h2 className="research-heading">Overview</h2>
          <article className={data.overview.image ? "research-overview has-image" : "research-overview"}>
            {data.overview.image && <img src={data.overview.image} alt="" loading="lazy" />}
            <div>
              <h3>{data.overview.title}</h3>
              {data.overview.description && <p className="research-muted">{data.overview.description}</p>}
              <p>{data.overview.extract}</p>
              <Link {...articleLink(data.wiki, data.overview.title)} className="btn btn-secondary btn-sm">
                Read the article <Icon name="arrowRight" size={15} />
              </Link>
            </div>
          </article>
          {data.articles.length > 0 && (
            <div className="link-row research-related">
              {data.articles.map((article) => (
                <Link key={article.title} {...articleLink(data.wiki, article.title)} className="chip" title={article.description}>
                  {article.title}
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {data.papers.length > 0 && (
        <section id="papers" className="research-section">
          <h2 className="research-heading">
            Papers
            <span className="research-muted">
              {data.paperCount > data.papers.length ? `The most relevant of about ${data.paperCount.toLocaleString()}` : pluralize(data.papers.length, "paper")}
            </span>
          </h2>
          <ol className="research-list">
            {data.papers.map((paper) => (
              <PaperItem key={paper.id} paper={paper} />
            ))}
          </ol>
        </section>
      )}

      {data.experts.length > 0 && (
        <section id="researchers" className="research-section">
          <h2 className="research-heading">
            Leading researchers
            {data.field && <span className="research-muted">in {data.field}</span>}
          </h2>
          <div className="research-grid">
            {data.experts.map((person) => (
              <ExpertCard key={person.id} person={person} />
            ))}
          </div>
        </section>
      )}

      {data.images.length > 0 && (
        <section id="images" className="research-section">
          <h2 className="research-heading">
            Images <span className="research-muted">From Wikimedia Commons</span>
          </h2>
          <div className="research-images">
            {data.images.map((image) => (
              <a key={image.filePage} href={image.filePage} target="_blank" rel="noopener noreferrer" className="research-image" title={image.description || image.title}>
                <img src={image.src} alt={image.description || image.title} loading="lazy" width={image.width} height={image.height} />
                <span className="research-image-caption">
                  {image.title}
                  <small>{[image.credit, image.license].filter(Boolean).join(" · ")}</small>
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {data.web.length > 0 && (
        <section id="web" className="research-section">
          <h2 className="research-heading">From the web</h2>
          <ul className="research-list">
            {data.web.map((link) => (
              <WebItem key={link.url} link={link} />
            ))}
          </ul>
        </section>
      )}

      {data.discussions.length > 0 && (
        <section id="discussions" className="research-section">
          <h2 className="research-heading">
            Discussions <span className="research-muted">On Hacker News</span>
          </h2>
          <ul className="research-list">
            {data.discussions.map((link) => (
              <li key={link.threadUrl ?? link.url} className="research-item">
                <div>
                  <a href={link.threadUrl ?? link.url} target="_blank" rel="noopener noreferrer" className="item-title">
                    {link.title}
                  </a>
                  <p className="research-meta">
                    {pluralize(link.points ?? 0, "point")} · {pluralize(link.comments ?? 0, "comment")} · {link.site}
                    {link.publishedDate && ` · ${formatDate(link.publishedDate)}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="research-footnote">
        Sources: Wikipedia, OpenAlex (research papers and authors), Wikimedia Commons, Exa web search and Hacker News.
        {data.checked === "model"
          ? " Every item was checked for relevance by a decision model, which also looked at each image."
          : " Items weren't checked for relevance this time, so some may be off topic."}
      </p>
    </div>
  );
}

function PaperItem({ paper }: { paper: ResearchPaper }) {
  const [open, setOpen] = useState(false);
  const authors = paper.authors.length > 3 ? `${paper.authors.slice(0, 3).join(", ")} et al.` : paper.authors.join(", ");
  return (
    <li className="research-item">
      <div>
        {paper.pdfUrl ? (
          <Link to="/web" search={{ url: paper.pdfUrl }} className="item-title">
            {paper.title}
          </Link>
        ) : (
          <a href={paper.url} target="_blank" rel="noopener noreferrer" className="item-title">
            {paper.title}
          </a>
        )}
        <p className="research-meta">
          {[paper.year, paper.venue, paper.citedBy ? pluralize(paper.citedBy, "citation") : null, authors].filter(Boolean).join(" · ")}
        </p>
        {open && paper.abstract && <p className="research-abstract">{paper.abstract}</p>}
        <div className="research-item-actions">
          {paper.pdfUrl && (
            <Link to="/web" search={{ url: paper.pdfUrl }} className="btn btn-secondary btn-sm">
              <Icon name="book" size={15} /> Read the PDF here
            </Link>
          )}
          {paper.abstract && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
              {open ? "Hide abstract" : "Abstract"}
            </button>
          )}
          <a href={paper.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
            Open the paper <Icon name="external" size={13} />
          </a>
        </div>
      </div>
    </li>
  );
}

function ExpertCard({ person }: { person: ResearchExpert }) {
  return (
    <article className="research-card">
      <h3>{person.name}</h3>
      {person.institution && <p className="research-muted">{person.institution}</p>}
      <p className="research-stats">
        {person.hIndex !== null && (
          <span title="h-index: this many of their papers have at least this many citations each">
            <strong>{person.hIndex}</strong> h-index
          </span>
        )}
        <span>
          <strong>{person.worksOnTopic.toLocaleString()}</strong> papers in the field
        </span>
      </p>
      {person.topPaper && (
        <p className="research-top-paper">
          Most cited:{" "}
          {person.topPaper.pdfUrl ? (
            <Link to="/web" search={{ url: person.topPaper.pdfUrl }}>
              {person.topPaper.title}
            </Link>
          ) : (
            <a href={person.topPaper.url} target="_blank" rel="noopener noreferrer">
              {person.topPaper.title}
            </a>
          )}
          {person.topPaper.year && ` (${person.topPaper.year})`}
        </p>
      )}
      {person.collaborators.length > 0 && <p className="research-muted">Often works with {person.collaborators.join(", ")}</p>}
      {person.orcid && (
        <a href={person.orcid} target="_blank" rel="noopener noreferrer" className="research-link">
          ORCID profile <Icon name="external" size={12} />
        </a>
      )}
    </article>
  );
}

function WebItem({ link }: { link: ResearchLink }) {
  return (
    <li className="research-item has-thumb">
      <div>
        <Link to="/web" search={{ url: link.url }} className="item-title">
          {link.title}
        </Link>
        <p className="research-meta">
          {link.site}
          {link.publishedDate && ` · ${formatDate(link.publishedDate)}`}
        </p>
        {link.description && <p className="research-abstract">{link.description}</p>}
      </div>
      {link.image ? <Thumb src={link.image} width={250} /> : <span />}
    </li>
  );
}
