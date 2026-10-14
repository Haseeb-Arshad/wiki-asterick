import { createApp } from "./app.js";
import { pruneExpiredRefreshTokens } from "./auth/tokens.js";
import { config } from "./config.js";
import { db } from "./db.js";

pruneExpiredRefreshTokens();
setInterval(pruneExpiredRefreshTokens, 6 * 60 * 60 * 1000).unref();

const server = createApp().listen(config.port, () => {
  const mode = config.isProduction ? "production" : "development";
  console.log(`[server] WikiAsterisk API (${mode}) listening on http://localhost:${config.port}`);
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
