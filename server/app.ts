import { existsSync } from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import { authRouter, readSession } from "./auth/routes.js";
import { config } from "./config.js";
import { HttpError, errorHandler, requireCsrfHeader } from "./http.js";
import { libraryRouter } from "./library.js";
import { wikiRouter } from "./wiki/routes.js";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://upload.wikimedia.org https://thumb.wikimedia.org https://wikimedia.org https://maps.wikimedia.org",
  "media-src 'self' https://upload.wikimedia.org https://commons.wikimedia.org",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: "512kb" }));
  api.use(cookieParser());
  api.use(requireCsrfHeader);
  api.use(readSession);

  api.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  api.use("/auth", authRouter);
  api.use("/library", libraryRouter);
  api.use("/wiki", wikiRouter);
  api.use((_req, _res, next) => next(new HttpError(404, "Not found.")));

  app.use("/api", api);

  // In production this server also hosts the built client.
  const indexHtml = path.join(config.clientDir, "index.html");
  if (config.isProduction && existsSync(indexHtml)) {
    app.use(
      express.static(config.clientDir, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else if (filePath.endsWith(".woff2")) {
            // Fonts in public/ aren't content-hashed, so cache them for a month rather than forever.
            res.setHeader("Cache-Control", "public, max-age=2592000");
          }
        },
      })
    );
    app.get("*", (_req, res) => {
      res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(indexHtml);
    });
  }

  app.use(errorHandler);
  return app;
}
