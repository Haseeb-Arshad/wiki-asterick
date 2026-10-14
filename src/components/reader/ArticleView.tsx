import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ArticleRef, Footnote, Highlight, HighlightColor, WikiArticle } from "../../../shared/types";
import { FEATURED_LANGUAGES, resizeThumb, wikiLanguage, wikiProject } from "../../../shared/wiki";
import { useSession } from "../../lib/auth";
import { formatDate, formatReadingTime, pluralize } from "../../lib/format";
import { useHotkeys } from "../../lib/hooks";
import { highlightsFor, useLibrary } from "../../lib/library";
import { absoluteArticleUrl, articleLink } from "../../lib/links";
import { aiStatusQuery, openAssistant, setAssistantContext } from "../../lib/assistant";
import { articleQuery, relatedQuery, similarPagesQuery } from "../../lib/queries";
import { caretAt, clearPaintedHighlights, describeRange, findQuote, paintHighlights } from "../../lib/text-anchor";
import { toast } from "../../lib/toast";
import { AsteriskMark } from "../AsteriskIcon";
import { Icon } from "../Icon";
import { Lightbox } from "../Lightbox";
import { downloadText, articleToMarkdown, notesToMarkdown } from "./exporters";
import { flattenSections, scrollToSection, type OutlineEntry } from "./outline";
import { ContentsSheet, LanguagesSheet, MediaSheet, NotesSheet, ReferencesSheet, ShortcutsDialog, TocList } from "./ReaderPanels";
import { FootnotePopover, HighlightPopover, LinkPreview, SelectionToolbar } from "./ReaderPopovers";
import { useReadAloud } from "./useReadAloud";

type Panel = "contents" | "notes" | "references" | "media" | "languages" | "shortcuts" | "more" | null;

const PROJECT_NAMES: Record<string, string> = {
  wikipedia: "Wikipedia",
  wiktionary: "Wiktionary",
  wikivoyage: "Wikivoyage",
  wikibooks: "Wikibooks",
  wikiquote: "Wikiquote",
  wikinews: "Wikinews",
  wikiversity: "Wikiversity",
  wikisource: "Wikisource",
};

function languageName(lang: string): string {
  const featured = FEATURED_LANGUAGES.find((language) => language.code === lang)?.name;
  if (featured) return featured;
  try {
    return new Intl.DisplayNames([lang], { type: "language" }).of(lang) ?? lang;
  } catch {
    return lang;
  }
}

const coarsePointer = () => window.matchMedia("(pointer: coarse)").matches;

async function copyText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message, { tone: "success" });
  } catch {
    toast("Couldn't copy to the clipboard.", { tone: "error" });
  }
}

export function ArticleView({ article, webUrl }: { article: WikiArticle; webUrl?: string }) {
  const isWeb = article.kind === "web";
  const aiStatus = useQuery(aiStatusQuery);
  const aiEnabled = aiStatus.data?.enabled === true;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hash = useLocation({ select: (location) => location.hash });
  const { user, isLoading: sessionLoading } = useSession();
  const library = useLibrary(user);

  const bodyRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLElement>(null);
  const progressValue = useRef(0);
  const activeRef = useRef("lead");
  const ranges = useRef(new Map<string, Range>());

  const [activeId, setActiveId] = useState("lead");
  const [pastHeader, setPastHeader] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [refTarget, setRefTarget] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [footnote, setFootnote] = useState<{ note: Footnote; anchor: HTMLElement } | null>(null);
  const [preview, setPreview] = useState<{ wiki: string; title: string; anchor: HTMLElement } | null>(null);
  const [selection, setSelection] = useState<Range | null>(null);
  // `fallback` positions the editor before a brand-new highlight has been painted.
  const [openHighlight, setOpenHighlight] = useState<{ id: string; editing: boolean; fallback?: DOMRect } | null>(null);
  const [savePulse, setSavePulse] = useState(0);

  const outline = useMemo(() => flattenSections(article.sections), [article]);
  const sectionTitles = useMemo(() => new Map(outline.map((entry) => [entry.id, entry.title])), [outline]);
  const footnotes = useMemo(() => new Map(article.footnotes.map((note) => [note.id, note])), [article]);
  const mediaIndex = useMemo(() => new Map(article.media.map((item, index) => [item.id, index])), [article]);
  const highlights = useMemo(() => highlightsFor(library.snapshot, article.wiki, article.title), [library.snapshot, article]);
  const highlightColors = useMemo(() => {
    const map = new Map<string, HighlightColor[]>();
    for (const highlight of highlights) map.set(highlight.sectionId, [...(map.get(highlight.sectionId) ?? []), highlight.color]);
    return map;
  }, [highlights]);

  const ref: ArticleRef = useMemo(
    () => ({
      wiki: article.wiki,
      title: article.title,
      description: article.description || article.extract.slice(0, 160),
      thumbnail: article.image ? (isWeb ? article.image.src : resizeThumb(article.image.src, 330, article.image.width)) : null,
      url: webUrl ?? null,
    }),
    [article, isWeb, webUrl]
  );

  const saved = library.isBookmarked(article.wiki, article.title);
  const project = isWeb ? (article.site ?? article.wiki.slice(4)) : (PROJECT_NAMES[wikiProject(article.wiki)] ?? "Wiki");
  const lang = isWeb ? article.lang : wikiLanguage(article.wiki);
  const shareUrl = webUrl ? `${window.location.origin}/web?url=${encodeURIComponent(webUrl)}` : absoluteArticleUrl(article.wiki, article.title);
  const readAloud = useReadAloud(bodyRef, article.lang);
  const videoCount = article.media.filter((item) => item.type === "video").length;

  const closePanel = useCallback(() => setPanel(null), []);

  // ---- the AI assistant answers about this article ---------------------------------
  useEffect(() => {
    setAssistantContext(webUrl ? { kind: "web", url: webUrl, title: article.title } : { kind: "wiki", wiki: article.wiki, title: article.title });
    return () => setAssistantContext(null);
  }, [article.wiki, article.title, webUrl]);

  // ---- page title ---------------------------------------------------------------
  useEffect(() => {
    document.title = `${article.title} — WikiAsterisk`;
    return () => {
      document.title = "WikiAsterisk — Wikipedia, without the clutter";
    };
  }, [article.title]);

  // ---- scroll: progress bar, header state, active section ------------------------
  useEffect(() => {
    let frame = 0;
    const update = () => {
      const body = bodyRef.current;
      if (!body) return;
      const rect = body.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight * 0.7;
      const progress = Math.min(1, Math.max(0, -rect.top / Math.max(1, scrollable)));
      progressValue.current = progress;
      progressRef.current?.style.setProperty("--progress", progress.toFixed(4));
      setPastHeader(rect.top < 80);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const order = new Map(outline.map((entry, index) => [entry.id, index]));
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = [...visible].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))[0];
        if (first) {
          activeRef.current = first;
          setActiveId(first);
        }
      },
      { rootMargin: "-90px 0px -62% 0px" }
    );
    body.querySelectorAll(".article-section").forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [outline]);

  useEffect(() => {
    const end = endRef.current;
    if (!end) return;
    const observer = new IntersectionObserver(([entry]) => setAtEnd(entry.isIntersecting), { rootMargin: "0px 0px -20% 0px" });
    observer.observe(end);
    return () => observer.disconnect();
  }, []);

  // ---- resume at #section when arriving with a hash --------------------------------
  useLayoutEffect(() => {
    if (!hash) return;
    const target = document.getElementById(decodeURIComponent(hash));
    if (!target) return;
    target.scrollIntoView({ block: "start" });
    target.classList.add("flash-target");
    window.setTimeout(() => target.classList.remove("flash-target"), 1700);
    // Only on arrival; later hash changes are our own scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article]);

  // ---- reading history -------------------------------------------------------------
  const recordVisit = useRef(library.recordVisit);
  useEffect(() => {
    recordVisit.current = library.recordVisit;
  }, [library.recordVisit]);

  useEffect(() => {
    let lastProgress = -1;
    const save = (force = false) => {
      const progress = Math.round(progressValue.current * 100) / 100;
      if (!force && Math.abs(progress - lastProgress) < 0.02) return;
      lastProgress = progress;
      recordVisit.current(ref, progress, activeRef.current === "lead" ? null : activeRef.current);
    };
    save(true);
    const interval = window.setInterval(() => save(), 15_000);
    const onHide = () => document.visibilityState === "hidden" && save(true);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onHide);
      save(true);
    };
  }, [ref]);

  // ---- paint saved highlights ----------------------------------------------------------
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const found = new Map<string, Range>();
    const entries: { color: HighlightColor; range: Range }[] = [];
    for (const highlight of highlights) {
      const section = highlight.sectionId ? document.getElementById(highlight.sectionId) : null;
      const root = section && body.contains(section) ? section : body;
      const range = findQuote(root, highlight) ?? (root !== body ? findQuote(body, highlight) : null);
      if (!range) continue;
      found.set(highlight.id, range);
      entries.push({ color: highlight.color, range });
    }
    ranges.current = found;
    paintHighlights(entries);
  }, [highlights]);

  useEffect(() => clearPaintedHighlights, []);

  // ---- text selection ------------------------------------------------------------------
  useEffect(() => {
    let pointerDown = false;
    let timer = 0;

    const read = () => {
      const current = window.getSelection();
      const body = bodyRef.current;
      if (!current || current.isCollapsed || current.rangeCount === 0 || !body) {
        setSelection(null);
        return;
      }
      const range = current.getRangeAt(0);
      if (!body.contains(range.commonAncestorContainer) || range.toString().trim().length < 2) {
        setSelection(null);
        return;
      }
      setSelection(range.cloneRange());
    };

    const onDown = () => {
      pointerDown = true;
    };
    const onUp = () => {
      pointerDown = false;
      window.setTimeout(read, 10);
    };
    const onChange = () => {
      const current = window.getSelection();
      if (!current || current.isCollapsed) {
        setSelection(null);
        return;
      }
      // Touch and keyboard selections finish without a pointerup we can rely on.
      if (pointerDown) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(read, 280);
    };

    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("selectionchange", onChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("selectionchange", onChange);
    };
  }, []);

  const quoteText = (text: string) => `“${text.trim()}”\n— ${article.title}, ${project} (${shareUrl})`;

  function createHighlight(color: HighlightColor, withNote = false) {
    const range = selection;
    const body = bodyRef.current;
    if (!range || !body) return;
    const startElement = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const section = startElement?.closest<HTMLElement>(".article-section") ?? body;
    const quote = describeRange(range, section);
    const text = quote.text.trim().slice(0, 2000);
    if (!text) return;

    const highlight = library.addHighlight({
      wiki: article.wiki,
      url: webUrl ?? null,
      articleTitle: article.title,
      sectionId: section === body ? "" : section.id,
      sectionTitle: sectionTitles.get(section.id) ?? "",
      text,
      prefix: quote.prefix,
      suffix: quote.suffix,
      color,
    });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    if (withNote) setOpenHighlight({ id: highlight.id, editing: true, fallback: range.getBoundingClientRect() });

    if (!user && library.snapshot.highlights.length === 0) {
      toast("Highlight saved in this browser.", {
        action: { label: "Sync it", onClick: () => navigate({ to: "/signup", search: { redirect: window.location.pathname } }) },
      });
    }
  }

  // ---- clicks inside the article ---------------------------------------------------------
  function onBodyClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (event.defaultPrevented || event.button !== 0) return;

    const footnoteLink = target.closest<HTMLAnchorElement>("a[data-fn]");
    if (footnoteLink) {
      event.preventDefault();
      const note = footnotes.get(footnoteLink.dataset.fn ?? "");
      if (note) {
        setPreview(null);
        setFootnote({ note, anchor: footnoteLink });
      }
      return;
    }

    const wikiLink = target.closest<HTMLAnchorElement>("a[data-wiki-title]");
    if (wikiLink) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      setPreview(null);
      const fragment = (wikiLink.getAttribute("href") ?? "").split("#")[1];
      navigate(articleLink(wikiLink.dataset.wiki ?? article.wiki, wikiLink.dataset.wikiTitle ?? "", fragment));
      return;
    }

    const mediaHost = target.closest<HTMLElement>("[data-media-id]");
    if (mediaHost && target.tagName === "IMG") {
      const index = mediaIndex.get(mediaHost.dataset.mediaId ?? "");
      if (index !== undefined) {
        event.preventDefault();
        setLightbox(index);
        return;
      }
    }

    const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]');
    if (anchor) {
      event.preventDefault();
      scrollToSection(decodeURIComponent(anchor.getAttribute("href")!.slice(1)));
      return;
    }

    // A click on painted text opens that highlight.
    if (window.getSelection()?.isCollapsed !== false && ranges.current.size) {
      const caret = caretAt(event.clientX, event.clientY);
      if (!caret) return;
      for (const [id, range] of ranges.current) {
        try {
          if (range.isPointInRange(caret.node, caret.offset)) {
            setOpenHighlight({ id, editing: false });
            return;
          }
        } catch {
          // The caret node may sit outside the range's document tree.
        }
      }
    }
  }

  // ---- hover previews for links (mouse only) -----------------------------------------------
  const previewTimer = useRef(0);
  const hideTimer = useRef(0);

  function onBodyPointerOver(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[data-wiki-title]");
    if (!link) return;
    window.clearTimeout(hideTimer.current);
    window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      setPreview({ wiki: link.dataset.wiki ?? article.wiki, title: link.dataset.wikiTitle ?? "", anchor: link });
    }, 380);
  }

  function onBodyPointerOut(event: React.PointerEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest("a[data-wiki-title]");
    if (!link || link.contains(event.relatedTarget as Node | null)) return;
    window.clearTimeout(previewTimer.current);
    hideTimer.current = window.setTimeout(() => setPreview(null), 220);
  }

  function onBodyPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Start loading the next article the moment a link is pressed.
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[data-wiki-title]");
    if (link) void queryClient.prefetchQuery(articleQuery(link.dataset.wiki ?? article.wiki, link.dataset.wikiTitle ?? ""));
  }

  // ---- actions ----------------------------------------------------------------------------
  function toggleSave() {
    const nowSaved = library.toggleBookmark(ref);
    setSavePulse((value) => value + 1);
    toast(nowSaved ? (user || sessionLoading ? "Saved to your library" : "Saved in this browser") : "Removed from your library", {
      tone: nowSaved ? "success" : "neutral",
      action: nowSaved ? { label: "View", onClick: () => navigate({ to: "/library" }) } : undefined,
    });
  }

  async function shareArticle() {
    const url = shareUrl;
    if (navigator.share && coarsePointer()) {
      await navigator.share({ title: article.title, text: article.description, url }).catch(() => undefined);
    } else {
      await copyText(url, "Link copied");
    }
  }

  function jumpTo(id: string) {
    setPanel(null);
    scrollToSection(id);
  }

  function jumpToHighlight(highlight: Highlight) {
    setPanel(null);
    const range = ranges.current.get(highlight.id);
    const element = range?.startContainer.parentElement ?? document.getElementById(highlight.sectionId);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function step(direction: 1 | -1) {
    const index = outline.findIndex((entry) => entry.id === activeRef.current);
    const next = outline[Math.min(outline.length - 1, Math.max(0, index + direction))];
    if (next) scrollToSection(next.id);
  }

  useHotkeys(
    {
      j: () => step(1),
      k: () => step(-1),
      s: toggleSave,
      t: () => setPanel("contents"),
      n: () => setPanel("notes"),
      r: () => article.footnotes.length && setPanel("references"),
      m: () => article.media.length && setPanel("media"),
      p: () => readAloud.toggle(activeRef.current),
      "?": () => setPanel("shortcuts"),
    },
    panel === null && lightbox === null
  );

  const activeHighlight = openHighlight ? highlights.find((item) => item.id === openHighlight.id) : undefined;
  const showDock = pastHeader && !atEnd;

  return (
    <div className="reader">
      <div className="reading-progress" ref={progressRef} aria-hidden="true">
        <span />
      </div>

      <header className="article-header column">
        <div className="article-kicker">
          <Icon name={isWeb ? "link" : "globe"} size={15} />
          <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer">
            {isWeb ? `${project} · Open original` : `${project} · ${languageName(lang)}`}
          </a>
          {article.languages.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <button type="button" className="text-link" style={{ border: 0, background: "none", padding: 0, fontSize: 14 }} onClick={() => setPanel("languages")}>
                {pluralize(article.languages.length, "language")}
              </button>
            </>
          )}
        </div>
        <h1 className="article-title" dir={article.dir} lang={article.lang}>
          {article.title}
        </h1>
        {article.description && (
          <p className="article-dek" dir={article.dir} lang={article.lang}>
            {article.description}
          </p>
        )}

        <div className="byline">
          <span className="byline-mark">
            <AsteriskMark size={22} />
          </span>
          <span className="byline-text">
            <strong>{isWeb ? article.byline || project : `${project} contributors`}</strong>
            <span className="byline-meta">
              <span>{formatReadingTime(article.readingMinutes)}</span>
              {article.lastEdited && <span>{isWeb ? formatDate(article.lastEdited) : `Updated ${formatDate(article.lastEdited)}`}</span>}
              {videoCount > 0 && <span>{pluralize(videoCount, "video")}</span>}
            </span>
          </span>
        </div>

        <div className="action-bar">
          <div className="action-group">
            <button type="button" className="action-btn" aria-pressed={saved} onClick={toggleSave} title="Save (s)">
              <Icon key={savePulse} name={saved ? "bookmarkFilled" : "bookmark"} size={19} className={savePulse ? "save-pop" : ""} />
              <span className="label">{saved ? "Saved" : "Save"}</span>
            </button>
            {readAloud.supported && (
              <button type="button" className="action-btn" aria-pressed={readAloud.state !== "idle"} onClick={() => readAloud.toggle(activeRef.current)} title="Listen (p)">
                <Icon name={readAloud.state === "playing" ? "pause" : "headphones"} size={19} />
                <span className="label">{readAloud.state === "playing" ? "Pause" : readAloud.state === "paused" ? "Resume" : "Listen"}</span>
              </button>
            )}
            {readAloud.state !== "idle" && (
              <button type="button" className="action-btn" onClick={readAloud.stop} aria-label="Stop reading aloud">
                <Icon name="stop" size={16} />
              </button>
            )}
            <button type="button" className="action-btn" onClick={shareArticle} title="Share">
              <Icon name="share" size={19} />
              <span className="label">Share</span>
            </button>
            {aiEnabled && (
              <button type="button" className="action-btn ask-btn" onClick={() => openAssistant()} title="Ask AI about this article (a)">
                <Icon name="sparkle" size={18} />
                <span className="label">Ask AI</span>
              </button>
            )}
          </div>
          <div className="action-group">
            {article.media.length > 0 && (
              <button type="button" className="action-btn" onClick={() => setPanel("media")} title="Media (m)">
                <Icon name={videoCount ? "video" : "image"} size={19} />
                <span className="count">{article.media.length}</span>
              </button>
            )}
            <button type="button" className="action-btn" onClick={() => setPanel("notes")} title="Highlights (n)">
              <Icon name="pen" size={19} />
              <span className="count">{highlights.length}</span>
            </button>
            <MoreMenu
              open={panel === "more"}
              onToggle={() => setPanel(panel === "more" ? null : "more")}
              onClose={closePanel}
              items={[
                article.footnotes.length > 0 && { icon: "book", label: `References (${article.footnotes.length})`, onClick: () => setPanel("references") },
                article.languages.length > 0 && { icon: "globe", label: "Other languages", onClick: () => setPanel("languages") },
                { icon: "external", label: isWeb ? "Open original" : `Open on ${project}`, href: article.sourceUrl },
                { icon: "link", label: "Copy link", onClick: () => copyText(shareUrl, "Link copied") },
                {
                  icon: "download",
                  label: "Download as Markdown",
                  onClick: () => downloadText(`${article.title}.md`, articleToMarkdown(article, outline)),
                },
                { icon: "keyboard", label: "Keyboard shortcuts", onClick: () => setPanel("shortcuts") },
              ]}
            />
          </div>
        </div>
      </header>

      {article.image && (
        // Portraits and tall images are shown whole; cropping them to a wide banner cuts off faces.
        <figure className={`hero-figure ${article.image.width && article.image.height > article.image.width * 0.9 ? "is-tall" : ""}`}>
          <button type="button" onClick={() => setLightbox(-1)} aria-label="View image full screen">
            <img
              src={article.image.src}
              alt=""
              width={article.image.width || undefined}
              height={article.image.height || undefined}
              fetchPriority="high"
            />
          </button>
        </figure>
      )}

      <div className="column">
        {article.infobox.length > 0 && (
          <details className="glance">
            <summary>
              <span>At a glance · {pluralize(article.infobox.length, "fact")}</span>
              <Icon name="chevronDown" size={18} />
            </summary>
            <dl dir={article.dir}>
              {article.infobox.map((row) => (
                <div key={row.label} style={{ display: "contents" }}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}

        <div
          ref={bodyRef}
          className="prose"
          dir={article.dir}
          lang={article.lang}
          onClick={onBodyClick}
          onPointerOver={onBodyPointerOver}
          onPointerOut={onBodyPointerOut}
          onPointerDown={onBodyPointerDown}
        >
          <ArticleBody outline={outline} />
        </div>

        <ArticleEnd article={article} webUrl={webUrl} endRef={endRef} project={project} onLanguages={() => setPanel("languages")} />
      </div>

      <nav className={`toc-rail ${pastHeader && !atEnd ? "is-visible" : ""}`} aria-label="Article contents">
        <h2>Contents</h2>
        <TocList outline={outline} activeId={activeId} highlightCounts={highlightColors} onSelect={jumpTo} />
      </nav>

      <div className={`reader-dock ${showDock ? "" : "is-hidden"}`} aria-hidden={!showDock}>
        <button type="button" className="icon-btn" onClick={() => setPanel("contents")} aria-label="Contents" title="Contents (t)" tabIndex={showDock ? 0 : -1}>
          <Icon name="list" size={19} />
        </button>
        {article.media.length > 0 && (
          <button type="button" className="icon-btn" onClick={() => setPanel("media")} aria-label="Media" title="Media (m)" tabIndex={showDock ? 0 : -1}>
            <Icon name={videoCount ? "video" : "image"} size={19} />
          </button>
        )}
        <button type="button" className="icon-btn" onClick={() => setPanel("notes")} aria-label="Highlights" title="Highlights (n)" tabIndex={showDock ? 0 : -1}>
          <Icon name="pen" size={19} />
          {highlights.length > 0 && <span className="badge">{highlights.length}</span>}
        </button>
        {aiEnabled && (
          <button type="button" className="icon-btn" onClick={() => openAssistant()} aria-label="Ask AI" title="Ask AI (a)" tabIndex={showDock ? 0 : -1}>
            <Icon name="sparkle" size={19} />
          </button>
        )}
        <span className="divider" />
        <button type="button" className="icon-btn" aria-pressed={saved} onClick={toggleSave} aria-label={saved ? "Remove from library" : "Save"} title="Save (s)" tabIndex={showDock ? 0 : -1}>
          <Icon name={saved ? "bookmarkFilled" : "bookmark"} size={19} />
        </button>
        <button type="button" className="icon-btn" onClick={shareArticle} aria-label="Share" tabIndex={showDock ? 0 : -1}>
          <Icon name="share" size={19} />
        </button>
        <button type="button" className="icon-btn" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Back to top" tabIndex={showDock ? 0 : -1}>
          <Icon name="arrowUp" size={19} />
        </button>
      </div>

      {/* Floating UI */}
      {footnote && (
        <FootnotePopover
          footnote={footnote.note}
          anchor={footnote.anchor}
          onClose={() => setFootnote(null)}
          onShowAll={() => {
            setRefTarget(footnote.note.id);
            setFootnote(null);
            setPanel("references");
          }}
        />
      )}
      {preview && (
        <LinkPreview
          key={`${preview.wiki}:${preview.title}`}
          wiki={preview.wiki}
          title={preview.title}
          anchor={preview.anchor}
          onPointerEnter={() => window.clearTimeout(hideTimer.current)}
          onPointerLeave={() => {
            hideTimer.current = window.setTimeout(() => setPreview(null), 220);
          }}
        />
      )}
      {selection && !openHighlight && (
        <SelectionToolbar
          getRect={() => selection.getBoundingClientRect()}
          onHighlight={(color) => createHighlight(color)}
          onNote={() => createHighlight("yellow", true)}
          onCopy={() => {
            void copyText(quoteText(selection.toString()), "Quote copied");
            window.getSelection()?.removeAllRanges();
          }}
          onAsk={
            aiEnabled
              ? () => {
                  const text = selection.toString().replace(/\s+/g, " ").trim().slice(0, 1500);
                  window.getSelection()?.removeAllRanges();
                  setSelection(null);
                  openAssistant({ selection: text, question: "Explain this passage." });
                }
              : undefined
          }
          onShare={async () => {
            const text = quoteText(selection.toString());
            if (navigator.share && coarsePointer()) await navigator.share({ text }).catch(() => undefined);
            else await copyText(text, "Quote copied with a link");
          }}
        />
      )}
      {activeHighlight && (
        <HighlightPopover
          key={activeHighlight.id}
          highlight={activeHighlight}
          startEditing={openHighlight?.editing ?? false}
          getRect={() => ranges.current.get(activeHighlight.id)?.getBoundingClientRect() ?? openHighlight?.fallback ?? new DOMRect(window.innerWidth / 2, 120, 0, 0)}
          onChange={(patch) => library.updateHighlight(activeHighlight.id, patch)}
          onCopy={() => copyText(quoteText(activeHighlight.text), "Quote copied")}
          onDelete={() => {
            library.removeHighlight(activeHighlight.id);
            setOpenHighlight(null);
            const removed = activeHighlight;
            toast("Highlight removed", {
              action: {
                label: "Undo",
                onClick: () =>
                  library.addHighlight({
                    wiki: removed.wiki,
                    url: removed.url ?? null,
                    articleTitle: removed.articleTitle,
                    sectionId: removed.sectionId,
                    sectionTitle: removed.sectionTitle,
                    text: removed.text,
                    prefix: removed.prefix,
                    suffix: removed.suffix,
                    color: removed.color,
                    note: removed.note,
                  }),
              },
            });
          }}
          onClose={() => setOpenHighlight(null)}
        />
      )}

      {/* Panels */}
      {panel === "contents" && (
        <ContentsSheet outline={outline} activeId={activeId} highlightCounts={highlightColors} onSelect={jumpTo} onClose={closePanel} />
      )}
      {panel === "notes" && (
        <NotesSheet
          highlights={highlights}
          isGuest={!user}
          onJump={jumpToHighlight}
          onUpdate={library.updateHighlight}
          onRemove={(highlight) => library.removeHighlight(highlight.id)}
          onExport={() => downloadText(`${article.title} — highlights.md`, notesToMarkdown(article, highlights))}
          onClose={closePanel}
        />
      )}
      {panel === "references" && (
        <ReferencesSheet
          footnotes={article.footnotes}
          targetId={refTarget}
          onClose={() => {
            setRefTarget(null);
            closePanel();
          }}
        />
      )}
      {panel === "media" && (
        <MediaSheet
          media={article.media}
          onOpen={(index) => {
            setPanel(null);
            setLightbox(index);
          }}
          onClose={closePanel}
        />
      )}
      {panel === "languages" && <LanguagesSheet wiki={article.wiki} languages={article.languages} onClose={closePanel} />}
      {panel === "shortcuts" && <ShortcutsDialog onClose={closePanel} />}

      {lightbox !== null && (
        <Lightbox
          items={
            lightbox === -1 && article.image
              ? [
                  {
                    id: "hero",
                    type: "image",
                    file: article.title,
                    caption: article.description || article.title,
                    src: article.image.src,
                    thumb: article.image.src,
                    width: article.image.width,
                    height: article.image.height,
                    poster: null,
                    sources: [],
                    durationSeconds: null,
                    sectionId: "",
                    filePage: article.sourceUrl,
                  },
                ]
              : article.media
          }
          index={Math.max(0, lightbox)}
          onIndexChange={setLightbox}
          onClose={() => setLightbox(null)}
          onJumpToSection={lightbox === -1 ? undefined : (id) => scrollToSection(id)}
        />
      )}
    </div>
  );
}

// ---- body -------------------------------------------------------------------------------

/** Rendered once per article; React leaves the HTML alone on later re-renders. */
const ArticleBody = memo(function ArticleBody({ outline }: { outline: OutlineEntry[] }) {
  return (
    <>
      {outline.map((entry) => {
        const Heading = (entry.level <= 2 ? "h2" : entry.level === 3 ? "h3" : entry.level === 4 ? "h4" : "h5") as "h2";
        return (
          <section key={entry.id} id={entry.id} className="article-section" data-level={entry.level}>
            {entry.title && (
              <Heading className="section-heading">
                {entry.title}
                <a className="anchor" href={`#${entry.id}`} aria-label={`Link to ${entry.title}`}>
                  #
                </a>
              </Heading>
            )}
            <div className="section-body" dangerouslySetInnerHTML={{ __html: entry.html }} />
          </section>
        );
      })}
    </>
  );
});

// ---- end of article ---------------------------------------------------------------------

function ArticleEnd({
  article,
  webUrl,
  endRef,
  project,
  onLanguages,
}: {
  article: WikiArticle;
  webUrl?: string;
  endRef: React.RefObject<HTMLElement | null>;
  project: string;
  onLanguages: () => void;
}) {
  const [nearEnd, setNearEnd] = useState(false);
  useEffect(() => {
    const element = endRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setNearEnd(true), { rootMargin: "900px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [endRef]);

  // Only ask for recommendations once the reader gets close to the end.
  const related = useQuery({ ...relatedQuery(article.wiki, article.title), enabled: nearEnd && !webUrl });
  const similar = useQuery({ ...similarPagesQuery(webUrl ?? ""), enabled: nearEnd && Boolean(webUrl) });

  return (
    <footer className="article-end" ref={endRef}>
      <div className="end-mark" aria-hidden="true">
        <AsteriskMark size={22} />
      </div>

      {webUrl ? (
        <div className="attribution">
          <Icon name="link" size={20} />
          <p>
            Originally published by{" "}
            <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer">
              {article.byline ? `${article.byline}, ${project}` : project}
            </a>
            {article.lastEdited ? ` on ${formatDate(article.lastEdited)}` : ""}. WikiAsterisk shows a reader-friendly copy; the original page is the
            authoritative version.
          </p>
        </div>
      ) : (
      <div className="attribution">
        <Icon name="book" size={20} />
        <p>
          This article is from{" "}
          <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer">
            {project}
          </a>
          , written by its contributors and available under{" "}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">
            CC BY-SA 4.0
          </a>
          . {article.lastEdited && `Last edited ${formatDate(article.lastEdited)}. `}
          Spotted a mistake?{" "}
          <a href={`${article.sourceUrl}?action=edit`} target="_blank" rel="noopener noreferrer">
            Improve it on {project}
          </a>
          .
        </p>
      </div>
      )}

      {similar.data && similar.data.length > 0 && (
        <section className="end-section" aria-labelledby="keep-reading-web">
          <h2 id="keep-reading-web">Keep reading</h2>
          <ul className="reading-list">
            {similar.data.map((page) => (
              <li key={page.url}>
                <Link to="/web" search={{ url: page.url }} className="reading-row">
                  <span className="reading-title">{page.title}</span>
                  <span className="reading-desc">{page.description || page.site}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {related.data && related.data.length > 0 && (
        <section className="end-section" aria-labelledby="keep-reading">
          <h2 id="keep-reading">Keep reading</h2>
          <ul className="reading-list">
            {related.data.map((hit) => (
              <li key={hit.title}>
                <Link {...articleLink(article.wiki, hit.title)} className="reading-row">
                  <span className="reading-title">{hit.title}</span>
                  <span className="reading-desc">{hit.description || hit.excerpt}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {article.externalLinks.length > 0 && (
        <section className="end-section" aria-labelledby="further">
          <h2 id="further">Further reading</h2>
          <ul className="source-links">
            {article.externalLinks.slice(0, 10).map((link) => (
              <li key={link.url}>
                <a href={link.url} target="_blank" rel="noopener noreferrer nofollow">
                  <span>{link.label}</span>
                  <Icon name="external" size={15} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {article.languages.length > 0 && (
        <section className="end-section">
          <h2>Also available in</h2>
          <div className="link-row">
            {article.languages.slice(0, 8).map((language) => (
              <Link key={language.lang} {...articleLink(`${language.lang}.${wikiProject(article.wiki)}.org`, language.title)} className="chip">
                {language.autonym}
              </Link>
            ))}
            {article.languages.length > 8 && (
              <button type="button" className="chip" onClick={onLanguages}>
                +{article.languages.length - 8} more
              </button>
            )}
          </div>
        </section>
      )}
    </footer>
  );
}

// ---- overflow menu ---------------------------------------------------------------------------

interface MenuEntry {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  onClick?: () => void;
  href?: string;
}

function MoreMenu({ open, onToggle, onClose, items }: { open: boolean; onToggle: () => void; onClose: () => void; items: (MenuEntry | false)[] }) {
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div className="menu-anchor" ref={anchorRef}>
      <button type="button" className="action-btn" aria-haspopup="menu" aria-expanded={open} onClick={onToggle} aria-label="More actions">
        <Icon name="more" size={19} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.filter((item): item is MenuEntry => Boolean(item)).map((item) =>
            item.href ? (
              <a key={item.label} className="menu-item" role="menuitem" href={item.href} target="_blank" rel="noopener noreferrer" onClick={onClose}>
                <Icon name={item.icon} size={17} /> {item.label}
              </a>
            ) : (
              <button
                key={item.label}
                type="button"
                className="menu-item"
                role="menuitem"
                onClick={() => {
                  onClose();
                  item.onClick?.();
                }}
              >
                <Icon name={item.icon} size={17} /> {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
