import { useState, useCallback, useEffect, useRef } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { WikiArticle, WikiSection, Highlight } from "../lib/types";
import { flattenSections } from "../lib/types";
import { getHighlightsForArticle, addHighlight, generateHighlightId } from "../lib/highlights";
import { AsteriskMark } from "./AsteriskIcon";

interface FootnotePopupData {
  id: string;
  text: string;
  x: number;
  y: number;
}

export function ArticlePage() {
  const search = useSearch({ strict: false }) as { url?: string };
  const navigate = useNavigate();
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [selectedText, setSelectedText] = useState<string>("");
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const [activeSection, setActiveSection] = useState("");
  const [footnotePopup, setFootnotePopup] = useState<FootnotePopupData | null>(null);
  const articleRef = useRef<HTMLDivElement>(null);

  const { data: article, isLoading, error } = useQuery<WikiArticle>({
    queryKey: ["article", search.url],
    queryFn: async () => {
      const res = await fetch(`/api/article?url=${encodeURIComponent(search.url || "")}`);
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Failed to fetch"); }
      return res.json();
    },
    enabled: !!search.url,
  });

  useEffect(() => {
    if (!article?.title) return;
    const title = article.title;
    queueMicrotask(() => {
      setHighlights(getHighlightsForArticle(title));
    });
  }, [article?.title]);

  useEffect(() => {
    if (!article) return;
    const container = articleRef.current;
    if (!container) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const supRef = target.closest("sup.reference a, sup.footnote-ref a");
      if (supRef) {
        e.preventDefault(); e.stopPropagation();
        const href = supRef.getAttribute("href") || "";
        const refId = href.startsWith("#") ? href.slice(1) : "";
        if (!refId) return;
        const footnote = article.footnotes.find(fn => fn.id === refId || fn.id.replace(/_/g, "-") === refId || fn.id.endsWith(refId));
        if (footnote) {
          const rect = supRef.getBoundingClientRect();
          setFootnotePopup({ id: footnote.id, text: footnote.text, x: rect.left + rect.width / 2, y: rect.bottom + 8 });
        }
        return;
      }
      const anchor = target.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href") || "";
      if (href.startsWith("https://en.wikipedia.org/wiki/") || href.startsWith("//en.wikipedia.org/wiki/")) {
        e.preventDefault();
        navigate({ to: "/article", search: { url: href.startsWith("//") ? `https:${href}` : href } });
        return;
      }
      if (href.startsWith("#")) {
        e.preventDefault();
        const el = document.getElementById(href.slice(1));
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [article, navigate]);

  useEffect(() => {
    if (!footnotePopup) return;
    const close = () => setFootnotePopup(null);
    const t = setTimeout(() => document.addEventListener("click", close, { once: true }), 150);
    return () => { clearTimeout(t); document.removeEventListener("click", close); };
  }, [footnotePopup]);

  useEffect(() => {
    if (!article) return;
    const container = articleRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => { for (const entry of entries) { if (entry.isIntersecting) setActiveSection(entry.target.id); } },
      { root: container, rootMargin: "-60px 0px -55% 0px" }
    );
    container.querySelectorAll("[id]").forEach(s => observer.observe(s));
    return () => observer.disconnect();
  }, [article]);

  const handleTextSelect = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const text = sel.toString().trim();
    if (!text || text.length < 3) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setSelectedText(text);
    setPopupPosition({ x: rect.left + rect.width / 2, y: rect.top - 14 });
  }, []);

  const handleHighlightSave = useCallback(() => {
    if (!selectedText || !article) return;
    const h: Highlight = {
      id: generateHighlightId(),
      articleTitle: article.title,
      text: selectedText.length > 180 ? selectedText.slice(0, 180) + "..." : selectedText,
      sectionId: activeSection || article.sections[0]?.id || "",
      sectionTitle: activeSection || article.sections[0]?.title || "",
      createdAt: Date.now(),
      color: "#2d90cf",
    };
    setHighlights(addHighlight(h).filter(x => x.articleTitle.toLowerCase() === article.title.toLowerCase()));
    setSelectedText(""); setPopupPosition(null);
    window.getSelection()?.removeAllRanges();
  }, [selectedText, article, activeSection]);

  const handleClosePopup = useCallback(() => { setPopupPosition(null); setSelectedText(""); }, []);

  const scrollToSection = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  if (!search.url) return <div className="flex-1 flex items-center justify-center font-sans text-[var(--color-grey-dark)]">No article URL provided. <button onClick={() => navigate({ to: "/" })} className="text-[var(--color-primary)] hover:underline ml-1">Go home</button></div>;

  if (isLoading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center animate-fade-in">
        <AsteriskMark size={48} className="text-[var(--color-primary)] mx-auto animate-pulse" />
        <p className="font-sans text-sm mt-5 text-[var(--color-grey)] tracking-wider">Loading article...</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md">
        <AsteriskMark size={48} className="text-[var(--color-primary)] mx-auto" />
        <p className="font-serif-display italic text-lg mt-5">Could not load this article</p>
        <p className="font-sans text-sm mt-2 text-[var(--color-grey)]">{(error as Error).message}</p>
        <button onClick={() => navigate({ to: "/" })} className="mt-5 px-5 py-2.5 border border-[var(--color-black)] font-sans text-sm font-bold tracking-wider hover:text-[var(--color-primary)] hover:border-[var(--color-primary)] transition-colors">Try again</button>
      </div>
    </div>
  );

  if (!article) return null;
  const flatSections = flattenSections(article.sections).filter(s => s.level <= 4);
  const sectionNums: Record<string, number> = {};
  let num = 1;
  flatSections.forEach(s => { sectionNums[s.id] = num++; });

  return (
    <div className="flex-1 flex h-[calc(100vh-48px)]">
      {/* LEFT TOC SIDEBAR */}
      <aside className="toc-sidebar hidden md:block">
        <div className="sticky top-0 p-3 pb-4">
          <div className="flex items-center gap-2 mb-4 px-2">
            <AsteriskMark size={14} className="text-[var(--color-primary)]" />
            <span className="font-sans text-[10px] uppercase tracking-[0.15em] text-[var(--color-grey)] font-bold">Contents</span>
          </div>
          <nav className="space-y-0">
            {flatSections.map((sec) => {
              const isActive = activeSection === sec.id;
              const isSub = sec.level > 2;
              const sectionHls = highlights.filter(h => h.sectionId === sec.id);
              return (
                <div key={sec.id}>
                  <div className={`toc-section ${isActive ? "active" : ""} ${isSub ? "sub" : ""}`} onClick={() => scrollToSection(sec.id)}>
                    <span className="toc-number">{sectionNums[sec.id] ?? ""}</span>
                    <span className="toc-title" dangerouslySetInnerHTML={{ __html: sec.title }} />
                  </div>
                  {sectionHls.map(h => (
                    <div key={h.id} className="toc-highlight" onClick={() => scrollToSection(h.sectionId)}>
                      <AsteriskMark size={10} className="text-[var(--color-primary)]" />
                      <p>{h.text}</p>
                    </div>
                  ))}
                </div>
              );
            })}
          </nav>
          <div className="mt-6 pt-4 border-t border-[var(--color-grey-light)] px-2">
            <div className="flex items-start gap-2 mb-3">
              <AsteriskMark size={13} className="text-[var(--color-primary)] flex-shrink-0 mt-0.5" />
              <p className="text-[0.68rem] text-[var(--color-grey)] leading-snug">Select text in the article, then click the asterisk to save a highlight.</p>
            </div>
            <button onClick={() => navigate({ to: "/" })} className="w-full text-center font-sans text-[10px] uppercase tracking-wider text-[var(--color-grey)] hover:text-[var(--color-primary)] transition-colors py-1.5">&lt;- New article</button>
          </div>
        </div>
      </aside>

      {/* MAIN ARTICLE */}
      <div ref={articleRef} className="flex-1 overflow-y-auto scroll-smooth" onMouseUp={handleTextSelect}>
        <div className="py-16 md:py-20 px-6 md:px-10">
          <div className="max-w-[750px] mx-auto animate-fade-in">
            <header className="mb-12 pb-10 border-b border-[var(--color-grey-light)]">
              <div className="flex items-center gap-3 mb-6">
                <AsteriskMark size={20} className="text-[var(--color-primary)]" />
                <span className="font-sans text-[10px] uppercase tracking-[0.14em] text-[var(--color-grey)] font-bold">Wikipedia, reimagined</span>
              </div>
              <h1 className="font-serif-display text-[2.8rem] md:text-[3.2rem] font-normal italic leading-[1.05] tracking-tight mb-5">{article.title}</h1>
              {article.description && <p className="text-[var(--color-grey-dark)] text-lg leading-relaxed italic max-w-[600px]">{article.description}</p>}
              <div className="flex items-center gap-4 mt-7 font-sans text-[10px] text-[var(--color-grey)] tracking-wider uppercase">
                {article.lastModified && <span>{article.lastModified}</span>}
                <a href={search.url} target="_blank" rel="noopener noreferrer" className="text-[var(--color-primary)] hover:text-[var(--color-primary-dark)] no-underline normal-case tracking-normal font-bold">Wikipedia source -&gt;</a>
              </div>
            </header>
            <ArticleBody article={article} />
            <div className="mt-16 pt-8 border-t border-[var(--color-grey-light)] text-center">
              <AsteriskMark size={18} className="text-[var(--color-grey-light)] mx-auto mb-2" />
              <p className="font-sans text-[0.72rem] text-[var(--color-grey)]">Content from Wikipedia under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer" className="text-[var(--color-primary)]">CC BY-SA 4.0</a></p>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT REFERENCES SIDEBAR */}
      <aside className="refs-sidebar hidden lg:block">
        <div className="sticky top-0 p-3">
          <div className="flex items-center gap-2 mb-3 px-1">
            <span className="font-sans text-[10px] uppercase tracking-[0.15em] text-[var(--color-grey)] font-bold">References</span>
            {article.footnotes.length > 0 && <span className="font-sans text-[0.6rem] text-[var(--color-grey)]">({Math.min(article.footnotes.length, 99)})</span>}
          </div>
          <div className="space-y-0">
            {article.footnotes.slice(0, 80).map((fn, i) => (
              <div key={fn.id || i} className="ref-item" id={`sidebar-ref-${fn.id || i}`}>
                <span className="ref-num">{i + 1}.</span> {fn.text.length > 160 ? fn.text.slice(0, 160) + "..." : fn.text}
              </div>
            ))}
          </div>
          {article.footnotes.length > 80 && <p className="text-[0.65rem] text-[var(--color-grey)] font-sans mt-3 px-3 italic">{article.footnotes.length - 80} more references</p>}
        </div>
      </aside>

      {/* HIGHLIGHT POPUP */}
      {popupPosition && <HighlightPopupUI position={popupPosition} onSave={handleHighlightSave} onClose={handleClosePopup} />}

      {/* FOOTNOTE POPUP */}
      {footnotePopup && (
        <div className="footnote-popup animate-fade-in" style={{ left: `${Math.min(footnotePopup.x, window.innerWidth - 360)}px`, top: `${footnotePopup.y}px` }} dangerouslySetInnerHTML={{ __html: footnotePopup.text }} />
      )}
    </div>
  );
}

function ArticleBody({ article }: { article: WikiArticle }) {
  const skipSections = new Set(["Citations", "Bibliography", "External links", "Further reading"]);
  return (
    <div className="post-content">
      {article.sections.filter(s => !skipSections.has(s.title) || s.title === "See also").map(s => <SectionBlock key={s.id} section={s} />)}
    </div>
  );
}

function SectionHeading({ level, id, title }: { level: number; id: string; title: string }) {
  if (level <= 2) return <h2 id={id}>{title}</h2>;
  if (level === 3) return <h3 id={id}>{title}</h3>;
  return <h4 id={id}>{title}</h4>;
}

function SectionBlock({ section }: { section: WikiSection }) {
  return (
    <div id={section.id}>
      <SectionHeading level={section.level} id={section.id} title={section.title} />
      {section.html && <div className="post-content" dangerouslySetInnerHTML={{ __html: section.html }} />}
      {section.subsections.map(sub => <SectionBlock key={sub.id} section={sub} />)}
    </div>
  );
}

function HighlightPopupUI({ position, onSave, onClose }: { position: { x: number; y: number }; onSave: () => void; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const x = Math.min(position.x, window.innerWidth - 220);
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed z-50 animate-fade-in" style={{ left: `${x}px`, top: `${position.y}px`, transform: "translateX(-50%)" }}>
        <div className="flex items-center bg-[var(--color-black)] text-[var(--color-cream)] rounded overflow-hidden shadow-xl">
          <button onClick={onSave} className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--color-grey-dark)] transition-colors">
            <AsteriskMark size={14} className="text-[var(--color-primary)]" />
            <span className="font-sans text-[13px] font-semibold">Save highlight</span>
          </button>
          <button onClick={onClose} className="px-3 py-2 hover:bg-[var(--color-grey-dark)] transition-colors text-[var(--color-cream)]/60 font-sans text-[13px]">x</button>
        </div>
      </div>
    </>
  );
}
