import express from "express";
import cors from "cors";
import { parseWikipediaArticle } from "./wikipedia.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get("/api/article", async (req, res) => {
  try {
    const url = req.query.url as string;
    if (!url) {
      res.status(400).json({ error: "Missing url parameter" });
      return;
    }

    const wikipediaUrlPattern = /^https?:\/\/([a-z]+\.)?wikipedia\.org\/wiki\/(.+)$/i;
    const match = url.match(wikipediaUrlPattern);
    if (!match) {
      res.status(400).json({ error: "Invalid Wikipedia URL" });
      return;
    }

    const article = await parseWikipediaArticle(url);
    res.json(article);
  } catch (error: unknown) {
    console.error("Error fetching article:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`[server] WikiAsterisk server running on http://localhost:${PORT}`);
});