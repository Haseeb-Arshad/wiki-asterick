# Maintainer notes

Practical notes for working on WikiAsterisk. For setup, features and the API, see the README.

## How an article gets to the screen

1. The reader route `/read/$wiki/$title` (e.g. `/read/en/Apollo_11`) asks `GET /api/wiki/article`.
2. The server fetches, in parallel: the rendered page (`action=parse`, with language links), the REST summary (description, lead image, last edit) and the wiki's namespace names (cached for a day).
3. `server/wiki/parser.ts` turns MediaWiki HTML into reader sections:
   - removes edit links, navboxes, hatnotes, maintenance boxes, scripts, event handlers and `javascript:` links;
   - keeps the lead section (text before the first heading);
   - drops reference, bibliography and external-link sections from the body, keeping footnotes and links as data;
   - rewrites article links to app routes (`/read/...`) and links to File:/Category:/… pages to the wiki;
   - collects images, video and audio into `media`, using thumbnail-CDN URLs sized for the reading column;
   - keeps formulas as their SVG rendering and drops the hidden MathML copy (it can triple the page size);
   - strips inline colors, fonts, widths and floats so pages fit the theme, but keeps empty color swatches.
4. The result is cached for 30 minutes (LRU, 80 articles), compressed once (Brotli and gzip) and served with an ETag.

When Wikipedia markup changes, add a case to `tests/parser.test.ts` first, then adjust the parser.

## Images and video on slow or filtered networks

Original files and video transcodes are served from `upload.wikimedia.org`; resized images come from `thumb.wikimedia.org`. Some networks throttle the upload host heavily. To stay fast everywhere, every image URL goes through `resizeThumb()` (`shared/wiki.ts`), which:

- only asks for the widths Wikimedia renders (120, 250, 330, 500, 960, 1280, 1920);
- never asks for a width at or above the original (the image server answers 400);
- moves thumbnails onto `thumb.wikimedia.org`.

Video has no thumbnail equivalent, so playback depends on reaching `upload.wikimedia.org`.

## Accounts and data

- SQLite file at `data/wiki-asterisk.db` (via `node:sqlite`, no native modules). Migrations are an append-only list in `server/db.ts`, tracked with `PRAGMA user_version`. Never edit a migration that has shipped; add a new one.
- Tables: `users`, `refresh_tokens`, `bookmarks`, `history`, `highlights`. Deleting a user cascades to the rest.
- The JWT secret comes from `JWT_SECRET`. In development one is generated into `data/.dev-jwt-secret`.
- Guests keep their library in `localStorage` (`wa-library`). After sign-in, or whenever a signed-in user has guest items left in the browser, they are merged through `POST /api/library/import`.

## Highlights

Highlights store the quoted text plus about 32 characters of context on each side, the W3C text-quote approach. `src/lib/text-anchor.ts` finds them again even if positions shift, and paints them with the CSS Custom Highlight API, so the article DOM is never modified. Browsers without that API still list highlights in the notes panel.

## Offline reading and the service worker

`public/sw.js` is plain JavaScript (it is copied to the site root, not bundled) and is registered only in production builds (`src/lib/offline.ts`).

- Built files, fonts and icons are cached as they are used; page navigations go to the network and fall back to the cached app shell (`/`), which then routes itself.
- Saved articles live in the `wa-offline-v1` cache, separate from the app cache so an update never clears them. The key is the exact article request path (`articlePath()` / `webArticlePath()` in `src/lib/queries.ts`); keep those helpers as the only place that builds it.
- Saving posts a message to the worker, which stores the article JSON and replies, then fetches the article's Wikimedia images (CORS copies only; opaque copies count heavily against the storage quota) and replies again. The page confirms "Available offline" on the first reply. At most 600 images are kept, oldest dropped first.
- Bump `VERSION` in `sw.js` only when the worker's own caching rules change.
- The in-app preview browser cannot run service workers. Test with a production build in a real browser (`npm run smoke` does).

## The decision model

`server/ai/decisions.ts` calls OpenRouter's Decisions API (`POST /api/alpha/decisions`): a `state` (text) and named questions (`noul` yes/no, `choice`, `score`), answered with probabilities. `decideEach()` asks one yes/no question about many numbered items in a single request; measured as accurate as one request per item. Every use is in `server/ai/judgements.ts` or `server/web/refine.ts`, takes the decision function as a parameter (tests pass a fake one), and returns "no opinion" on failure, so the app behaves as before when the model is slow, off or out of credit.

Thresholds come from live measurements, not round numbers: the reasoning model is used when P(careful analysis) ≥ 0.6 (analysis questions scored 0.81 to 0.99 with Jev and 0.86 to 1.00 with Microsoft; summaries and news round-ups at most 0.22 and 0.51); clutter is removed below 0.25; a paywalled preview needs 0.7. Re-measure them before switching models (`DECISION_MODEL`), since probabilities differ between models. Each call logs its time and cost as `[decide] …`.

Jev also takes images (`decideEachImage()`, up to 8 per request), but only as base64 PNG or JPEG data URLs, and it rejects images whose short side is under about 244 px ("Invalid image dimensions"). Links to images are refused.

## PDFs and Exa's text

`safe-fetch.ts` recognises a PDF by its content type, its `.pdf` path or the `%PDF-` bytes, and allows up to 30 MB. `server/web/pdf.ts` reads the text layer with unpdf (PDF.js) and rebuilds the structure from the layout: headings are lines in larger type, numbered lines (`3.2 Results`) or known names (Abstract, Methods…); a run of large lines on one page is a notice, not headings; rotated text (arXiv's margin stamp) is skipped; a line repeated on at least three pages and 40% of them is a running head. The body stops at References. A PDF with no text layer answers 422 `pdf_no_text` and is not sent to Exa.

When a site refuses the fetch, Exa's crawl is used instead. Exa answers PDFs and some pages in markdown, not HTML; `server/web/markdown.ts` converts it, and drops the summary card Exa puts before a paper (everything up to the second copy of the title heading).

## Research pages

`GET /api/research?q=` (`server/research/`) builds one page per topic and wiki, kept for six hours. `buildResearch()` runs each source as its own pipeline in parallel, so a slow or failing source only empties its own section:

- **Articles**: Wikipedia search, a relevance check, then the summary of the best match as the overview.
- **Papers**: OpenAlex works search (25), a relevance check on title and abstract, de-duplicated by normalised title.
- **Leading researchers**: the model chooses the research field from the kept papers' OpenAlex topics (falling back to the topic that at least three papers share). OpenAlex then groups that topic's works by author; authors need an h-index of 10 or more, and each person's most cited paper must itself be in the field. "Often works with" lists up to three co-authors who appear on two or more of the person's top papers.
- **Images**: Commons file search for the topic and the top article titles, run through `en.wikipedia.org`'s API (commons.wikimedia.org doesn't resolve on some networks). Only photos and diagrams in sensible proportions are kept; the model looks at each one, and images too small for it to judge are dropped.
- **Web** (Exa) and **discussions** (Hacker News through Algolia), each with a relevance check.

Thresholds, measured on live topics: kept when P(relevant) ≥ 0.5, images 0.35 (pictures of a topic rarely look "about" it as strongly as text does), discussions 0.6 (Hacker News titles are loose), and the field is used only when the model's choice has at least 0.5. The server logs how many images were kept; set `RESEARCH_DEBUG=1` to log each image's score as well. A page takes 5 to 11 seconds and costs under a cent of decision calls.

## Link previews and 404s

Every route is the same `index.html`. In production `server/app.ts` fills in each article's (or web page's) title, description, image, canonical address and Twitter card (`server/meta.ts`), from the cached summary. A lookup failure must never stop the app loading, so it falls back to the plain page. `isKnownPath()` lists the app's routes: add a new route there, or its address will answer 404.

## Shared code lives in `shared/`

Anything the server's tests need to import must live in `shared/` (or `server/`). The server's TypeScript config compiles `tests/` with `nodenext` resolution and no browser types, so a test that imports from `src/` fails `tsc -b`. Files in `shared/` import each other with `.js` extensions and must not touch `window` or `document`.

## Checks before shipping

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run build
```

```bash
npm run smoke
```

`npm run smoke` needs the build and a Chrome or Edge (set `CHROME_PATH` if it is not found). Add `-- --live` to include the checks that read real Wikipedia articles. CI runs all of these.
