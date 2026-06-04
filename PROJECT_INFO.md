# Project Information

## Summary

WikiAsterisk is a Wikipedia article reader and article-structure extraction project. It accepts a Wikipedia URL, fetches the source article through Wikipedia APIs, cleans the MediaWiki HTML, extracts sections and references, and renders the article in a focused reading interface.

The project is intentionally built so future maintainers can add AI and text-mining features on top of structured article data instead of scraping the visible UI.

## Current Product Surface

- Home page with Wikipedia URL input.
- Curated example article shortcuts.
- Article page with clean typography.
- Left-side table of contents generated from extracted headings.
- Right-side reference rail generated from extracted footnotes.
- Clickable reference popups inside the article.
- Internal Wikipedia link routing.
- Local text highlights saved per article title.
- Source attribution link to the original Wikipedia article.

## Data Pipeline

1. The user submits a Wikipedia URL.
2. The client navigates to `/article?url=...`.
3. TanStack Query calls `/api/article`.
4. Express validates the URL.
5. The server fetches article HTML through Wikipedia's Parse API.
6. The server fetches summary metadata through Wikipedia's REST Summary API.
7. Cheerio removes non-reader elements and normalizes links, images, figures, and references.
8. The parser converts headings into nested `WikiSection` records.
9. Footnotes and infobox rows are extracted into structured arrays.
10. The client renders the article, contents rail, references rail, and highlight controls.

## AI And Text Mining Readiness

The project currently prepares content for AI work but does not require an AI provider. The useful extraction surfaces are:

- `WikiArticle.title`
- `WikiArticle.description`
- `WikiArticle.sections`
- `WikiSection.title`
- `WikiSection.content`
- `WikiSection.html`
- `WikiArticle.footnotes`
- `WikiArticle.infobox`

These fields can support:

- entity detection
- keyword extraction
- topic modeling
- text classification
- question answering
- citation-aware summarization
- knowledge graph experiments
- reading-note generation

## Maintenance Notes

- Keep the server parser conservative. Wikipedia markup changes often, so parser fixes should be incremental and tested against multiple article types.
- Keep raw AI features optional. The reader should continue to work without model keys or external AI services.
- Preserve source attribution whenever content is displayed, exported, or summarized.
- Do not commit `node_modules`, `dist`, `.tanstack/tmp`, local logs, or machine-specific files.

## Suggested Release Story

This repository should look like a project that grew in stages:

- Foundation: React, Vite, TanStack Router, and the first Wikipedia URL reader flow.
- Reader experience: typography, sidebars, examples, references, and local highlights.
- Parser maturity: server-side Wikipedia API integration, HTML cleanup, section extraction, and structured metadata.
- Recent repository work: complete GitHub documentation, AI/text-mining positioning, and upload-ready project hygiene.

## Near-Term Work

- Add unit tests for `normalizeWikipediaUrl`, `isWikipediaUrl`, and parser helpers.
- Add a saved reading-history panel.
- Add Markdown and JSON export.
- Add optional entity detection for current article sections.
- Add a deployment target and public demo link.
