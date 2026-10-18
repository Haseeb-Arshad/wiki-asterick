import { Router } from "express";
import { normalizeWikiHost } from "../../shared/wiki.js";
import { HttpError, TtlCache, asyncHandler, memoizeAsync, rateLimit } from "../http.js";
import { sendPayload, toPayload, type Payload } from "../payload.js";
import { buildResearch } from "./research.js";

const HOUR = 60 * 60_000;

// A research page costs a web search and a few model checks, so each topic is built once and kept.
const pages = memoizeAsync(new TtlCache<Payload>(200, 6 * HOUR), async (key) => {
  const [wiki, ...rest] = key.split("|");
  return toPayload(await buildResearch(rest.join("|"), wiki));
});

export const researchRouter = Router();

researchRouter.use(
  rateLimit({
    windowMs: 60_000,
    max: 12,
    key: (req) => req.auth?.userId ?? req.ip ?? "anonymous",
    message: "You're opening research pages very quickly. Wait a moment and try again.",
  })
);

/** GET /api/research?q=<topic>&wiki=<wiki for the encyclopedia part, default English Wikipedia> */
researchRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim().replace(/\s+/g, " ") : "";
    if (query.length < 2) throw new HttpError(400, "Type a topic to research.", "bad_query");
    if (query.length > 160) throw new HttpError(400, "That topic is too long. Try a shorter phrase.", "bad_query");
    const wiki = normalizeWikiHost(typeof req.query.wiki === "string" ? req.query.wiki : "en") ?? "en.wikipedia.org";
    sendPayload(req, res, await pages(`${wiki}|${query.toLowerCase()}`), 1800);
  })
);
