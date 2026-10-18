import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { ResearchExpert, ResearchLink, ResearchPaper } from "../shared/types.ts";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "wiki-asterisk-research-test-"));
process.env.DATABASE_FILE = ":memory:";

const { buildResearch, uniquePapers } = await import("../server/research/research.ts");
const { abstractFrom, dominantField } = await import("../server/research/sources.ts");
type Decide = import("../server/ai/decisions.ts").Decide;
type ImageCandidate = import("../server/research/sources.ts").ImageCandidate;

const paper = (id: string, title: string, citedBy = 0, pdfUrl: string | null = null): ResearchPaper => ({
  id,
  title,
  year: 2024,
  venue: null,
  citedBy,
  authors: [],
  abstract: "",
  url: `https://doi.org/${id}`,
  pdfUrl,
  openAccess: Boolean(pdfUrl),
});

const image = (title: string): ImageCandidate => ({
  title,
  description: "",
  credit: "",
  license: "CC BY-SA 4.0",
  filePage: `https://commons.wikimedia.org/wiki/File:${title}`,
  width: 800,
  height: 600,
  src: `https://thumb.example/${title}.png`,
  judgeSrc: `https://thumb.example/${title}-judge.png`,
});

const expert = (name: string, topPaper: string): ResearchExpert => ({
  id: name,
  name,
  institution: null,
  worksOnTopic: 10,
  hIndex: 50,
  citedBy: 1000,
  orcid: null,
  topPaper: { title: topPaper, year: 2020, url: "https://doi.org/x", pdfUrl: null },
  collaborators: [],
});

const link = (title: string): ResearchLink => ({ title, url: `https://example.com/${encodeURIComponent(title)}`, site: "example.com", description: "", image: null, publishedDate: null });

const sources = {
  articles: async () => [
    { title: "CRISPR", description: "Family of DNA sequences", excerpt: "", thumbnail: null },
    { title: "Cricket", description: "Bat-and-ball game", excerpt: "", thumbnail: null },
  ],
  summary: async (_wiki: string, title: string) => ({
    summary: { wiki: "en.wikipedia.org", title, description: "Family of DNA sequences", extract: "CRISPR is ...", thumbnail: null, image: null, lang: "en", dir: "ltr" as const },
    lastEdited: null,
  }),
  papers: async () => ({
    papers: [paper("W1", "CRISPR editing of HBG promoters", 50, "https://arxiv.org/pdf/1"), paper("W2", "Crop yields in Kansas", 10), paper("W3", "CRISPR Editing of HBG Promoters", 5)],
    count: 1234,
    fields: new Map([
      ["W1", { id: "T1", name: "CRISPR and Genetic Engineering" }],
      ["W2", { id: "T2", name: "Agronomy" }],
      ["W3", { id: "T1", name: "CRISPR and Genetic Engineering" }],
    ]),
  }),
  experts: async () => [expert("Jennifer Doudna", "A programmable dual-RNA-guided DNA endonuclease"), expert("Wrong Person", "Bridge loads in Iowa")],
  images: async () => [image("CRISPR Cas9"), image("CRISPR Cas9 02"), image("Football stadium")],
  imageData: async (url: string) => `data:image/png;base64,${Buffer.from(url).toString("base64")}`,
  web: async () => [link("How CRISPR works"), link("Buy cheap shoes")],
  discussions: async () => [link("Show HN: a CRISPR guide designer"), link("Ask HN: favourite keyboard?")],
};

/** A stand-in model: "on topic" for anything mentioning CRISPR, HBG, DNA or Doudna's paper. */
const onTopic = (text: string) => /crispr|hbg|dna|endonuclease|programmable/i.test(text);
const calls: string[] = [];
const decide = (async (task: string, state: unknown, questions: Record<string, { type: string }>) => {
  calls.push(task);
  if (task === "research field") return { field: { type: "choice", choice: "T1", confidence: 0.9, probabilities: { T1: 0.9, T2: 0.1 } } };
  const parts = Array.isArray(state) ? (state as unknown[]).filter((part): part is string => typeof part === "string") : String(state).split("\n");
  const items = parts.filter((line) => /^\[\d+\] /.test(line)).map((line) => line.replace(/^\[\d+\] /, ""));
  return Object.fromEntries(Object.keys(questions).map((name, index) => [name, { type: "noul", noul: onTopic(items[index] ?? "") ? 0.9 : 0.05 }]));
}) as unknown as Decide;

const failing = (async () => {
  throw new Error("model unavailable");
}) as unknown as Decide;

describe("buildResearch", () => {
  test("keeps only what the model finds on topic, across every source", async () => {
    const page = await buildResearch("CRISPR for sickle cell disease", "en.wikipedia.org", { decide, check: true, sources });
    assert.equal(page.checked, "model");
    assert.equal(page.overview?.title, "CRISPR");
    assert.deepEqual(page.articles, []);
    assert.deepEqual(
      page.papers.map((item) => item.id),
      ["W1"]
    );
    assert.equal(page.paperCount, 1234);
    assert.deepEqual(
      page.web.map((item) => item.title),
      ["How CRISPR works"]
    );
    assert.deepEqual(
      page.discussions.map((item) => item.title),
      ["Show HN: a CRISPR guide designer"]
    );
  });

  test("names the field the model chose and its leaders whose papers are in it", async () => {
    const page = await buildResearch("CRISPR for sickle cell disease", "en.wikipedia.org", { decide, check: true, sources });
    assert.equal(page.field, "CRISPR and Genetic Engineering");
    assert.deepEqual(
      page.experts.map((person) => person.name),
      ["Jennifer Doudna"]
    );
  });

  test("looks at the images and shows each subject once", async () => {
    const page = await buildResearch("CRISPR for sickle cell disease", "en.wikipedia.org", { decide, check: true, sources });
    assert.deepEqual(
      page.images.map((item) => item.title),
      ["CRISPR Cas9"]
    );
    assert.ok(calls.includes("research images"));
  });

  test("shows everything unfiltered (and says so) when the model is unavailable", async () => {
    const page = await buildResearch("CRISPR for sickle cell disease", "en.wikipedia.org", { decide: failing, check: true, sources });
    assert.equal(page.checked, "none");
    assert.equal(page.web.length, 2);
    assert.equal(page.images.length, 3);
    // Without the model the field falls back to the one most relevant papers share (2 of 3 here, under the 3 needed).
    assert.equal(page.field, null);
  });

  test("still builds when a source fails", async () => {
    const page = await buildResearch("CRISPR", "en.wikipedia.org", {
      decide,
      check: true,
      sources: {
        ...sources,
        papers: async () => {
          throw new Error("OpenAlex is down");
        },
      },
    });
    assert.deepEqual(page.papers, []);
    assert.equal(page.web.length, 1);
  });
});

describe("research helpers", () => {
  test("uniquePapers keeps the most cited copy of the same title", () => {
    assert.deepEqual(
      uniquePapers([paper("A", "The Age of Sinan", 79), paper("B", "THE AGE OF SINAN:", 206), paper("C", "Another book", 1)]).map((item) => item.id),
      ["B", "C"]
    );
  });

  test("abstractFrom puts an inverted index back in order", () => {
    assert.equal(abstractFrom({ editing: [1], Gene: [0], works: [2], well: [3] }), "Gene editing works well");
    assert.equal(abstractFrom(null), "");
  });

  test("dominantField needs enough papers to agree", () => {
    const fields = new Map([
      ["A", { id: "T1", name: "One" }],
      ["B", { id: "T1", name: "One" }],
      ["C", { id: "T2", name: "Two" }],
    ]);
    assert.equal(dominantField(["A", "B", "C"], fields, 2)?.name, "One");
    assert.equal(dominantField(["A", "B", "C"], fields, 3), null);
  });
});
