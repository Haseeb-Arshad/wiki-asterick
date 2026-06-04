export function extractPageTitle(url: string): string | null {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/");
    const wikiIndex = pathParts.indexOf("wiki");
    if (wikiIndex === -1) return null;
    return pathParts.slice(wikiIndex + 1).join("/");
  } catch {
    return null;
  }
}

export function isWikipediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /^([a-z]+\.)?wikipedia\.org$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function normalizeWikipediaUrl(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^en\.wikipedia\.org/i.test(trimmed)) return `https://${trimmed}`;
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(trimmed.replace(/\s+/g, "_"))}`;
}