import { decide, decisionsEnabled } from "./ai/decisions.js";
import { createApp } from "./app.js";
import { pruneExpiredRefreshTokens } from "./auth/tokens.js";
import { config } from "./config.js";
import { db } from "./db.js";

pruneExpiredRefreshTokens();
setInterval(pruneExpiredRefreshTokens, 6 * 60 * 60 * 1000).unref();

const server = createApp().listen(config.port, () => {
  const mode = config.isProduction ? "production" : "development";
  console.log(`[server] WikiAsterisk API (${mode}) listening on http://localhost:${config.port}`);
  // The first decision after a start is slow (connection and model warm-up). Make it now, so a
  // reader's first question is routed by the model rather than falling back to the rules.
  if (decisionsEnabled()) {
    void decide("warm up", "The app has started.", { ready: { type: "noul", instructions: "Has the app started?", criteria: { true: "Yes", false: "No" } } }, { timeoutMs: 15_000 }).catch(
      () => undefined
    );
  }
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
