import type { Highlight } from "./types";

const STORAGE_KEY = "wiki-asterisk-highlights";

export function loadHighlights(): Highlight[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Highlight[];
  } catch {
    return [];
  }
}

export function saveHighlights(highlights: Highlight[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(highlights));
  } catch {
    // storage full or unavailable
  }
}

export function addHighlight(highlight: Highlight): Highlight[] {
  const highlights = loadHighlights();
  highlights.unshift(highlight);
  saveHighlights(highlights);
  return highlights;
}

export function removeHighlight(id: string): Highlight[] {
  const highlights = loadHighlights().filter((h) => h.id !== id);
  saveHighlights(highlights);
  return highlights;
}

export function getHighlightsForArticle(articleTitle: string): Highlight[] {
  return loadHighlights().filter(
    (h) => h.articleTitle.toLowerCase() === articleTitle.toLowerCase()
  );
}

export function clearAllHighlights(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function generateHighlightId(): string {
  return `hl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}