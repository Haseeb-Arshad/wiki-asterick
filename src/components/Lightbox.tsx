import { useEffect, useRef, useState } from "react";
import type { MediaItem } from "../../shared/types";
import { formatDuration } from "../lib/format";
import { Icon } from "./Icon";

/** Full-screen viewer for article images, videos and audio. */
export function Lightbox({
  items,
  index,
  onIndexChange,
  onClose,
  onJumpToSection,
}: {
  items: MediaItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onJumpToSection?: (sectionId: string) => void;
}) {
  const item = items[index];
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const count = items.length;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight" && count > 1) onIndexChange((index + 1) % count);
      else if (event.key === "ArrowLeft" && count > 1) onIndexChange((index - 1 + count) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, index, onClose, onIndexChange]);

  // Warm the cache for the neighbours so arrowing through feels instant.
  useEffect(() => {
    for (const offset of [1, -1]) {
      const neighbour = items[(index + offset + count) % count];
      if (neighbour?.type === "image") new Image().src = neighbour.src;
    }
  }, [count, index, items]);

  if (!item) return null;

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={item.caption || item.file || "Media viewer"}
      onTouchStart={(event) => {
        touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start || count < 2) return;
        const dx = event.changedTouches[0].clientX - start.x;
        const dy = event.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          onIndexChange((index + (dx < 0 ? 1 : -1) + count) % count);
        }
      }}
    >
      <div className="lightbox-top">
        <span>
          {count > 1 && `${index + 1} / ${count} · `}
          {item.file}
        </span>
        <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close viewer">
          <Icon name="x" size={22} />
        </button>
      </div>

      <div className="lightbox-stage" onClick={(event) => event.target === event.currentTarget && onClose()}>
        {item.type === "image" && <LightboxImage key={item.id} item={item} />}
        {item.type === "video" && (
          <video key={item.id} controls autoPlay playsInline poster={item.poster ?? undefined}>
            {item.sources.map((source) => (
              <source key={source.src} src={source.src} type={source.type} />
            ))}
          </video>
        )}
        {item.type === "audio" && (
          <audio key={item.id} controls autoPlay>
            {item.sources.map((source) => (
              <source key={source.src} src={source.src} type={source.type} />
            ))}
          </audio>
        )}

        {count > 1 && (
          <>
            <button type="button" className="icon-btn lightbox-nav prev" onClick={() => onIndexChange((index - 1 + count) % count)} aria-label="Previous">
              <Icon name="chevronLeft" size={24} />
            </button>
            <button type="button" className="icon-btn lightbox-nav next" onClick={() => onIndexChange((index + 1) % count)} aria-label="Next">
              <Icon name="chevronRight" size={24} />
            </button>
          </>
        )}
      </div>

      <div className="lightbox-caption">
        <p>
          {item.caption || item.file}
          {item.durationSeconds ? ` · ${formatDuration(item.durationSeconds)}` : ""}
        </p>
        <div className="links">
          {onJumpToSection && item.sectionId && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                onClose();
                onJumpToSection(item.sectionId);
              }}
            >
              Show in article
            </button>
          )}
          {item.filePage && (
            <a className="btn btn-sm" href={item.filePage} target="_blank" rel="noopener noreferrer">
              File details <Icon name="external" size={14} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shows the small thumbnail (usually cached already) until the sharp version arrives. */
function LightboxImage({ item }: { item: MediaItem }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="lightbox-figure">
      {!loaded && item.thumb && item.thumb !== item.src && <img className="lightbox-placeholder" src={item.thumb} alt="" aria-hidden="true" />}
      <img src={item.src} alt={item.caption || item.file} data-loaded={loaded} onLoad={() => setLoaded(true)} />
      {!loaded && <span className="spinner lightbox-spinner" aria-label="Loading image" />}
    </div>
  );
}
