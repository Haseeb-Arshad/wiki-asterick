import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Express 4 does not catch rejected promises; forward them to the error handler. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }

  if (error?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Request body is not valid JSON." });
    return;
  }

  console.error("[server] Unhandled error:", error);
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
};

/**
 * Rejects state-changing requests that lack our custom header. Browsers cannot
 * add custom headers to cross-site requests without a CORS preflight, and this
 * server never answers preflights, so forged form posts are refused.
 */
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  const safe = req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";
  if (safe || req.get("x-wa-request") === "1") {
    next();
    return;
  }
  next(new HttpError(403, "Missing request header.", "csrf"));
};

/** Small fixed-window limiter. Good enough for a single-instance deployment. */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  key?: (req: Request) => string;
  message?: string;
}): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, options.windowMs);
  sweep.unref();

  return (req, res, next) => {
    const key = options.key ? options.key(req) : req.ip ?? "unknown";
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    entry.count += 1;
    if (entry.count > options.max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      next(new HttpError(429, options.message ?? "Too many requests. Please slow down.", "rate_limited"));
      return;
    }
    next();
  };
}

/** LRU cache with a time-to-live, built on Map insertion order. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries: number, ttlMs: number) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs = this.ttlMs): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Caches results and collapses concurrent requests for the same key. */
export function memoizeAsync<V>(cache: TtlCache<V>, load: (key: string) => Promise<V>) {
  const inflight = new Map<string, Promise<V>>();

  return async (key: string): Promise<V> => {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    let pending = inflight.get(key);
    if (!pending) {
      pending = load(key).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }

    const value = await pending;
    cache.set(key, value);
    return value;
  };
}

export function readString(value: unknown, field: string, { min = 1, max = 500 } = {}): string {
  if (typeof value !== "string") throw new HttpError(400, `${field} is required.`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw new HttpError(400, `${field} is required.`);
  if (trimmed.length > max) throw new HttpError(400, `${field} is too long.`);
  return trimmed;
}

export function readOptionalString(value: unknown, max = 500): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}
