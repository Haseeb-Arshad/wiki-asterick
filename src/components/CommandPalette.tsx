import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FEATURED_LANGUAGES, normalizeWikiHost, wikiLanguage, wikiSlug } from "../../shared/wiki";
import { useSession } from "../lib/auth";
import { useLibrary } from "../lib/library";
import { articleLink } from "../lib/links";
import { openAssistant } from "../lib/assistant";
import { recentSearchStore, rememberSearch, wikiStore } from "../lib/preferences";
import { fetchRandomArticle } from "../lib/queries";
import { setPaletteOpen, useArticleSearch, usePaletteOpen, type SearchOption } from "../lib/search";
import { toast } from "../lib/toast";
import { Icon } from "./Icon";
import { SearchResultRow } from "./SearchResults";

export function CommandPalette() {
  const open = usePaletteOpen();
  if (!open) return null;
  return <Palette onClose={() => setPaletteOpen(false)} />;
}

function Palette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wiki = wikiStore.use();
  const recent = recentSearchStore.use();
  const { user } = useSession();
  const { snapshot } = useLibrary(user);
  const { options: results, isFetching, isSettled } = useArticleSearch(query, wiki);

  useEffect(() => {
    restoreFocus.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      restoreFocus.current?.focus?.();
    };
  }, []);

  const options = useMemo<SearchOption[]>(() => {
    const trimmed = query.trim();
    if (trimmed) {
      return [
        ...results,
        {
          key: "fulltext",
          kind: "fulltext",
          wiki,
          title: `Search all articles for “${trimmed}”`,
          description: "Full-text results with excerpts",
          thumbnail: null,
        },
      ];
    }

    const seen = new Set<string>();
    const recentItems: SearchOption[] = [];
    const candidates = [
      ...snapshot.history.slice(0, 4),
      ...recent.map((item) => ({ ...item, description: "", thumbnail: null, url: null })),
    ];
    for (const item of candidates) {
      const key = `${item.wiki}:${item.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recentItems.push({
        key: `recent:${key}`,
        kind: "recent",
        wiki: item.wiki,
        title: item.title,
        description: item.description,
        thumbnail: item.thumbnail,
        url: item.url ?? undefined,
      });
    }

    return [
      ...recentItems.slice(0, 6),
      { key: "random", kind: "action", wiki, title: "Surprise me", description: "Open a random article", thumbnail: null },
      { key: "library", kind: "action", wiki, title: "Your library", description: "Saved articles, highlights and history", thumbnail: null },
    ];
  }, [query, results, wiki, snapshot.history, recent]);

  // Keep the active row valid as results change.
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));

  async function choose(option: SearchOption) {
    onClose();
    if (option.key === "random") {
      try {
        const article = await fetchRandomArticle(option.wiki);
        navigate(articleLink(article.wiki, article.title));
      } catch {
        toast("Couldn't fetch a random article. Try again.", { tone: "error" });
      }
      return;
    }
    if (option.key === "library") {
      navigate({ to: "/library" });
      return;
    }
    if (option.kind === "ask") {
      openAssistant({ question: option.title });
      return;
    }
    if (option.kind === "link" && option.url) {
      navigate({ to: "/web", search: { url: option.url } });
      return;
    }
    if (option.kind === "recent" && option.url) {
      navigate({ to: "/web", search: { url: option.url } });
      return;
    }
    if (option.kind === "fulltext") {
      navigate({ to: "/search", search: { q: query.trim(), wiki: wikiSlug(wiki) } });
      return;
    }
    rememberSearch({ wiki: option.wiki, title: option.title });
    navigate(articleLink(option.wiki, option.title));
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((activeIndex + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((activeIndex - 1 + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) void choose(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  const trimmed = query.trim();
  const noResults = trimmed && isSettled && results.length === 0;
  const recentCount = options.filter((option) => option.kind === "recent").length;

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search articles">
        <div className="palette-input-row">
          {isFetching ? <span className="spinner" aria-hidden="true" /> : <Icon name="search" size={20} />}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search, paste any article link, or ask a question"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={options[activeIndex] ? `${listId}-${activeIndex}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="kbd" onClick={onClose} aria-label="Close search">
            Esc
          </button>
        </div>

        <div className="palette-body" id={listId} role="listbox" aria-label="Results">
          {!trimmed && recentCount > 0 && <div className="result-group-label">Recent</div>}
          {!trimmed && recentCount === 0 && <div className="result-group-label">Quick actions</div>}
          {trimmed && results.length > 0 && <div className="result-group-label">Articles on {wiki}</div>}
          {options.map((option, index) => (
            <div key={option.key}>
              {!trimmed && index === recentCount && recentCount > 0 && <div className="result-group-label">Quick actions</div>}
              {trimmed && option.kind === "fulltext" && noResults && (
                <p className="palette-empty">No titles match “{trimmed}”. Full-text search may still find it.</p>
              )}
              <SearchResultRow
                id={`${listId}-${index}`}
                option={option}
                selected={index === activeIndex}
                onSelect={() => void choose(option)}
                onHover={() => setActive(index)}
                icon={option.key === "random" ? "shuffle" : option.key === "library" ? "library" : undefined}
              />
            </div>
          ))}
        </div>

        <div className="palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>↵</kbd> to open
          </span>
          <span className="palette-lang">
            <Icon name="globe" size={14} />
            <select
              className="select select-sm"
              aria-label="Search language"
              value={wikiLanguage(wiki)}
              onChange={(event) => wikiStore.set(normalizeWikiHost(event.target.value) ?? wiki)}
            >
              {FEATURED_LANGUAGES.some((language) => language.code === wikiLanguage(wiki)) ? null : (
                <option value={wikiLanguage(wiki)}>{wiki}</option>
              )}
              {FEATURED_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.name}
                </option>
              ))}
            </select>
          </span>
        </div>
      </div>
    </>
  );
}
