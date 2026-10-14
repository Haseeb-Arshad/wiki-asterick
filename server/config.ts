import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

try {
  process.loadEnvFile();
} catch {
  // No .env file; rely on the process environment.
}

const isProduction = process.env.NODE_ENV === "production" || process.argv.includes("--production");
const rootDir = path.resolve(import.meta.dirname, "..");
const dataDir = path.resolve(rootDir, process.env.DATA_DIR ?? "data");

mkdirSync(dataDir, { recursive: true });

function resolveJwtSecret(): Uint8Array {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error("JWT_SECRET must be at least 32 characters long.");
    return new TextEncoder().encode(fromEnv);
  }

  if (isProduction) throw new Error("JWT_SECRET is required when NODE_ENV=production.");

  // Development: keep a generated secret on disk so sessions survive restarts.
  const secretFile = path.join(dataDir, ".dev-jwt-secret");
  if (!existsSync(secretFile)) {
    writeFileSync(secretFile, randomBytes(48).toString("base64url"), { mode: 0o600 });
  }
  return new TextEncoder().encode(readFileSync(secretFile, "utf8").trim());
}

export const config = {
  isProduction,
  // Hosting platforms set PORT in production. In development the API uses its own
  // variable so it never collides with the Vite dev server's PORT.
  port: Number(isProduction ? (process.env.PORT ?? 3001) : (process.env.API_PORT ?? 3001)),
  rootDir,
  dataDir,
  dbFile: process.env.DATABASE_FILE ?? path.join(dataDir, "wiki-asterisk.db"),
  clientDir: path.join(rootDir, "dist"),
  jwtSecret: resolveJwtSecret(),
  jwtIssuer: "wiki-asterisk",
  jwtAudience: "wiki-asterisk-web",
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : isProduction,
  trustProxy: process.env.TRUST_PROXY ?? "",
  wikiUserAgent:
    process.env.WIKI_USER_AGENT ??
    "WikiAsterisk/2.0 (https://github.com/wiki-asterisk; reader app) Node.js",

  // AI assistant (optional: the reader works without these keys).
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  exaApiKey: process.env.EXA_API_KEY ?? "",
  aiQuickModel: process.env.AI_QUICK_MODEL ?? "anthropic/claude-haiku-5.5",
  aiDeepModel: process.env.AI_DEEP_MODEL ?? "openai/gpt-6-luna",
  appUrl: process.env.APP_URL ?? "https://github.com/Haseeb-Arshad/wiki-asterick",
};
