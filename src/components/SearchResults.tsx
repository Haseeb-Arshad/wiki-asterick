import type { SearchOption } from "../lib/search";
import { Icon, type IconName } from "./Icon";
import { Thumb } from "./Thumb";

const KIND_ICON: Record<SearchOption["kind"], IconName> = {
  article: "book",
  url: "link",
  link: "link",
  ask: "sparkle",
  recent: "clock",
  action: "arrowRight",
  fulltext: "search",
};

export function SearchResultRow({
  option,
  id,
  selected,
  onSelect,
  onHover,
  icon,
}: {
  option: SearchOption;
  id: string;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
  icon?: IconName;
}) {
  const showThumb = option.kind === "article" || option.kind === "recent";
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={selected}
      className={`result ${option.kind === "ask" ? "is-ask" : ""}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      onMouseMove={onHover}
      tabIndex={-1}
    >
      <span className="result-thumb">
        {showThumb && option.thumbnail ? <Thumb src={option.thumbnail} width={120} /> : <Icon name={icon ?? KIND_ICON[option.kind]} size={18} />}
      </span>
      <span className="result-text">
        <span className="result-title">{option.title}</span>
        {option.description && <span className="result-desc">{option.description}</span>}
      </span>
      <span className="result-hint">
        <Icon name="arrowRight" size={16} />
      </span>
    </button>
  );
}
