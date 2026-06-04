# WikiAsterisk

WikiAsterisk is a focused Wikipedia reading workspace built with React, Vite, TanStack Router, Express, and Cheerio. It turns a standard Wikipedia article into a cleaner long-form reading experience with structured sections, side navigation, reference previews, and local highlights.

The project is also designed as a foundation for text mining and AI-assisted reading. The backend extracts article sections, plain text, references, infobox fields, and metadata in a predictable JSON shape, so future features can add entity detection, claim review, topic clustering, summarization, and research-note generation without rewriting the article parser.

## What It Does

- Accepts valid Wikipedia article URLs and routes the reader to a dedicated article page.
- Fetches article HTML and summary data from official Wikipedia APIs.
- Cleans parser output with Cheerio and removes editing controls, empty MediaWiki elements, nav boxes, and other non-reading noise.
- Converts article headings into nested section data.
- Extracts references and displays them in a right-side reference rail.
- Builds a left-side table of contents from the real article section tree.
- Supports article-to-article navigation for internal Wikipedia links.
- Allows readers to select text and save local highlights.
- Preserves source attribution and links back to the original Wikipedia article.

## Why It Exists

Wikipedia contains high-quality public knowledge, but its default article pages are not always ideal for deep reading, annotation, or later AI processing. WikiAsterisk separates article structure from presentation:

- Readers get a quieter, magazine-style interface.
- Developers get structured article data instead of raw page markup.
- Future AI and text-mining features can work from sections, references, and clean text.

This makes the project useful as both a reading product and an experimental base for knowledge extraction.

## AI And Text-Mining Direction

The current project does not send article content to an AI model. Instead, it prepares the data layer that makes those features practical.

Planned AI-ready capabilities include:

- Entity detection for people, places, organizations, dates, and concepts.
- Topic and section classification.
- Reference-aware claim extraction.
- Citation and source density signals.
- Article summaries at page and section level.
- Reader questions answered from the current article context.
- Highlight clustering into study notes.
- Exportable clean text for downstream NLP pipelines.

The important design choice is that Wikipedia content is already normalized into `WikiArticle`, `WikiSection`, references, and infobox records before it reaches the UI.

## Tech Stack

- React 19
- TypeScript
- Vite
- TanStack Router
- TanStack Query
- Express
- Cheerio
- Wikipedia Parse API
- Wikipedia REST Summary API
- Tailwind CSS through the Vite plugin

## Project Structure

```text
server/
  index.ts          Express API and health route
  wikipedia.ts      Wikipedia fetching, cleanup, section extraction, references

src/
  components/       Reader UI, home page, article view, highlights
  lib/              Shared types, URL helpers, local highlight storage
  routes/           TanStack Router routes
  index.css         Global typography and reader styling
```

## Local Development

Install dependencies:

```bash
npm install
```

Run the client and API server together:

```bash
npm run dev
```

The Vite client proxies `/api` requests to the Express server on port `3001`.

Build for production:

```bash
npm run build
```

Run lint checks:

```bash
npm run lint
```

## API

Fetch a parsed article:

```http
GET /api/article?url=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FArtificial_intelligence
```

The response includes title, description, sections, footnotes, infobox data, thumbnail metadata, and a generated last-read date.

Health check:

```http
GET /api/health
```

## Development Timeline

- Earlier work: created the core Wikipedia reader concept, app shell, article route, local article examples, typography, and highlight interaction.
- Recent work: added repository-ready documentation, clarified the AI/text-mining direction, documented the backend parsing contract, and prepared the project for a meaningful first GitHub upload.
- Next work: improve parser edge cases, add persisted notes, add export options, and introduce opt-in AI analysis on top of the existing structured article data.

## Roadmap

- Add saved reading history.
- Add export to Markdown or JSON.
- Add section-level search and filters.
- Add reference quality and citation-density indicators.
- Add optional AI summaries and entity detection.
- Add tests for URL validation, section extraction, and reference parsing.
- Add deployment configuration for a public hosted demo.

## Repository Description

Suggested GitHub description:

```text
Magazine-style Wikipedia reader with section extraction, references, highlights, and AI-ready text-mining structure.
```

Suggested GitHub topics:

```text
wikipedia, react, vite, typescript, tanstack-router, express, cheerio, text-mining, ai-ready, knowledge-tools
```

## License And Attribution

Wikipedia article content is provided by Wikipedia contributors and is available under the Creative Commons Attribution-ShareAlike License. This project links back to source articles and should preserve attribution when displaying or exporting content.
