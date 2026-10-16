import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { FEATURED_LANGUAGES, normalizeWikiHost, wikiLanguage, wikiSlug } from "../../shared/wiki";
import { useOutsidePress } from "../lib/hooks";
import { articleLink } from "../lib/links";
import { aiStatusQuery, ask } from "../lib/assistant";
import { rememberSearch } from "../lib/preferences";
import { modKey, useArticleSearch, useRecentOptions, type SearchOption } from "../lib/search";
import { Icon } from "./Icon";
import { SearchResultRow } from "./SearchResults";

/** The large search field on the home and search pages, with live suggestions. */
export function SearchBox({
  wiki,
  onWikiChange,
  initialQuery = "",
  autoFocus = false,
  placeholder,
}: {
  wiki: string;
  /** When given, a compact language picker sits inside the field. */
  onWikiChange?: (wiki: string) => void;
  initialQuery?: string;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const navigate = useNavigate();
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const { options: matches, isFetching } = useArticleSearch(query, wiki);
  const recents = useRecentOptions(5);
  const aiEnabled = useQuery(aiStatusQuery).data?.enabled === true;
  const lang = wikiLanguage(wiki);

  useOutsidePress([boxRef], () => setOpen(false), open);

  // An empty, focused box offers where you left off; typing offers matches and the AI.
  const typing = query.trim().length > 0;
  const options = typing ? matches : recents;
  const visible = open && options.length > 0;
  const hint = placeholder ?? (aiEnabled ? "Search, paste a link, or ask a question" : "Search any topic or paste a link");

  function go(option: SearchOption) {
    setOpen(false);
    if (option.kind === "ask") {
      setQuery("");
      void ask(option.query ?? option.title);
      return;
    }
    if ((option.kind === "link" || option.kind === "recent") && option.url) {
      navigate({ to: "/web", search: { url: option.url } });
      return;
    }
    rememberSearch({ wiki: option.wiki, title: option.title });
    navigate(articleLink(option.wiki, option.title));
  }

  function submit() {
    // Enter opens the highlighted row; links and questions go straight through.
    const option = options[active] ?? (["url", "link", "ask"].includes(options[0]?.kind ?? "") ? options[0] : null);
    if (option) {
      go(option);
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) return;
    setOpen(false);
    navigate({ to: "/search", search: { q: trimmed, wiki: wikiSlug(wiki) } });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && options.length) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index + 1) % options.length);
    } else if (event.key === "ArrowUp" && options.length) {
      event.preventDefault();
      setActive((index) => (index <= 0 ? options.length - 1 : index - 1));
    } else if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div className="search-box" ref={boxRef}>
      <form
        role="search"
        className="search-field"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {onWikiChange && (
          <label className="search-lang" title="Search language">
            <span aria-hidden="true">{lang.toUpperCase()}</span>
            <Icon name="chevronDown" size={13} strokeWidth={2} />
            <select
              value={lang}
              aria-label="Search language"
              onChange={(event) => onWikiChange(normalizeWikiHost(event.target.value) ?? wiki)}
            >
              {!FEATURED_LANGUAGES.some((language) => language.code === lang) && <option value={lang}>{wiki}</option>}
              {FEATURED_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <span className="search-icon" aria-hidden="true">
          {isFetching ? <span className="spinner" /> : <Icon name="search" size={19} />}
        </span>

        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={hint}
          aria-label="Search articles"
          role="combobox"
          aria-expanded={visible}
          aria-controls={listId}
          aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          enterKeyHint="search"
        />

        {!query && <kbd title="Open quick search from anywhere">{modKey} K</kbd>}

        <button type="submit" className="search-submit">
          Read
        </button>
      </form>

      {visible && (
        <div className="search-suggestions" id={listId} role="listbox" aria-label={typing ? "Suggestions" : "Recent"}>
          {options.map((option, index) => (
            <SearchResultRow
              key={option.key}
              id={`${listId}-${index}`}
              option={option}
              selected={index === active}
              onSelect={() => go(option)}
              onHover={() => setActive(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
