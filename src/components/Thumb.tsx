import { useState } from "react";
import { resizeThumb } from "../../shared/wiki";
import { AsteriskMark } from "./AsteriskIcon";

/**
 * A Wikimedia thumbnail that fades in when loaded. Wikimedia only renders
 * certain widths and never larger than the original, so if the requested
 * size fails we fall back to the URL we were given.
 */
export function Thumb({
  src,
  width = 330,
  alt = "",
  className = "",
  eager = false,
}: {
  src: string | null | undefined;
  width?: number;
  alt?: string;
  className?: string;
  eager?: boolean;
}) {
  const preferred = resizeThumb(src, width);
  const [state, setState] = useState<{ for: string | null; url: string | null; loaded: boolean; failed: boolean }>({
    for: src ?? null,
    url: preferred,
    loaded: false,
    failed: false,
  });

  // Reset when the source changes (derived state, no effect needed).
  if (state.for !== (src ?? null)) {
    setState({ for: src ?? null, url: preferred, loaded: false, failed: false });
  }

  const showImage = state.url && !state.failed;

  return (
    <span className={`thumb ${className}`}>
      {showImage ? (
        <img
          src={state.url!}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          data-loaded={state.loaded}
          onLoad={() => setState((current) => ({ ...current, loaded: true }))}
          onError={() =>
            setState((current) =>
              current.url !== src && src ? { ...current, url: src.startsWith("//") ? `https:${src}` : src } : { ...current, failed: true }
            )
          }
        />
      ) : (
        <span className="thumb-fallback">
          <AsteriskMark size={22} />
        </span>
      )}
    </span>
  );
}
