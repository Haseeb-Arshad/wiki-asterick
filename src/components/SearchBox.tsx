import { useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { wikiSlug } from "../../shared/wiki";
import { useOutsidePress } from "../lib/hooks";
import { articleLink } from "../lib/links";
import { rememberSearch } from "../lib/preferences";
import { modKey, useArticleSearch, type SearchOption } from "../lib/search";
import { Icon } from "./Icon";
import { SearchResultRow } from "./SearchResults";

/** The large search field on the home and search pages, with live suggestions. */
export function SearchBox({
  wiki,
  initialQuery = "",
  autoFocus = false,
  placeholder = "Search any topic, or paste a Wikipedia link",
}: {
  wiki: string;
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
  const { options, isFetching } = useArticleSearch(query, wiki);

  useOutsidePress([boxRef], () => setOpen(false), open);

  const visible = open && query.trim().length > 0 && options.length > 0;

  function go(option: SearchOption) {
    setOpen(false);
    rememberSearch({ wiki: option.wiki, title: option.title });
    navigate(articleLink(option.wiki, option.title));
  }

  function submit() {
    const option = options[active] ?? (options[0]?.kind === "url" ? options[0] : null);
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
        {isFetching ? <span className="spinner" aria-hidden="true" /> : <Icon name="search" size={21} />}
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
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
        <kbd title="Open quick search anywhere">{modKey} K</kbd>
        <button type="submit" className="btn btn-primary btn-sm">
          Read
        </button>
      </form>

      {visible && (
        <div className="search-suggestions" id={listId} role="listbox" aria-label="Suggestions">
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
