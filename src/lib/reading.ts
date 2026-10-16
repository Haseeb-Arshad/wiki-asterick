import type { CSSProperties } from "react";
import { createPersistedStore } from "./store";

export type LineWidth = "narrow" | "standard" | "wide";
export type TypeFace = "serif" | "sans";
export type Spacing = "standard" | "relaxed";
export type Paper = "theme" | "sepia";

export interface ReadingPrefs {
  /** Index into READING_SCALES. */
  size: number;
  width: LineWidth;
  face: TypeFace;
  spacing: Spacing;
  paper: Paper;
}

export const READING_DEFAULTS: ReadingPrefs = { size: 1, width: "standard", face: "serif", spacing: "standard", paper: "theme" };

/** Text size steps, relative to the 18px body size. */
export const READING_SIZES = [
  { label: "Small", scale: 0.9 },
  { label: "Default", scale: 1 },
  { label: "Large", scale: 1.12 },
  { label: "Extra large", scale: 1.25 },
] as const;

const WIDTHS: Record<LineWidth, number> = { narrow: 600, standard: 680, wide: 800 };

// Sepia is a warm paper tone for the reading column only. The app chrome keeps the theme.
const SEPIA: Record<string, string> = {
  "--bg": "#f4ecd8",
  "--bg-elevated": "#fbf5e6",
  "--bg-sunken": "#ebe2cc",
  "--bg-hover": "#e6dbc2",
  "--ink": "#3b3024",
  "--ink-soft": "#4a3e30",
  "--muted": "#7b6d58",
  "--faint": "#a0917a",
  "--line": "#dcd0b5",
  "--line-strong": "#c8b996",
};

function parseReading(raw: unknown): ReadingPrefs {
  const value = (raw ?? {}) as Partial<ReadingPrefs>;
  return {
    size: Number.isInteger(value.size) && value.size! >= 0 && value.size! < READING_SIZES.length ? value.size! : READING_DEFAULTS.size,
    width: value.width === "narrow" || value.width === "wide" ? value.width : READING_DEFAULTS.width,
    face: value.face === "sans" ? "sans" : READING_DEFAULTS.face,
    spacing: value.spacing === "relaxed" ? "relaxed" : READING_DEFAULTS.spacing,
    paper: value.paper === "sepia" ? "sepia" : READING_DEFAULTS.paper,
  };
}

export const readingStore = createPersistedStore<ReadingPrefs>("wa-reading", READING_DEFAULTS, parseReading);

/** CSS custom properties for the article column; read by `.reader` and `.prose` in index.css. */
export function readingStyle(prefs: ReadingPrefs): CSSProperties {
  const vars: Record<string, string> = {
    "--reader-scale": String(READING_SIZES[prefs.size].scale),
    "--measure": `${WIDTHS[prefs.width]}px`,
    "--reader-leading": prefs.spacing === "relaxed" ? "1.85" : "1.62",
    "--reader-para": prefs.spacing === "relaxed" ? "1.5em" : "1.25em",
    "--reader-face": prefs.face === "sans" ? "var(--font-sans)" : "var(--font-serif)",
    ...(prefs.paper === "sepia" ? SEPIA : {}),
  };
  return vars as CSSProperties;
}
