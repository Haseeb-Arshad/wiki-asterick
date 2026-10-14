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
