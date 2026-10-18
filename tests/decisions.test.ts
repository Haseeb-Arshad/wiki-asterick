import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "wiki-asterisk-decisions-test-"));
process.env.DATABASE_FILE = ":memory:";

const { decideEach } = await import("../server/ai/decisions.ts");
const { planAnswer, checkGrounded, readSearchIntent, withoutExplicit } = await import("../server/ai/judgements.ts");
const { refineWebArticle } = await import("../server/web/refine.ts");
const { assemble } = await import("../server/web/extract.ts");

type Decide = import("../server/ai/decisions.ts").Decide;

/** A stand-in decision model: `answer(task, state, questions)` returns the answers object. */
function fake(answer: (task: string, state: string, questions: Record<string, { type: string }>) => Record<string, unknown>) {
  const calls: { task: string; state: string; questions: Record<string, { type: string }> }[] = [];
  const decide = (async (task: string, state: string, questions: Record<string, { type: string }>) => {
    calls.push({ task, state, questions });
    return answer(task, state, questions);
  }) as unknown as Decide;
  return { decide, calls };
}

const failing = (async () => {
  throw new Error("model unavailable");
}) as unknown as Decide;

/** Answers each numbered item of a decideEach request with `p(itemText)`. */
function perItem(p: (text: string) => number) {
  return (_task: string, state: string) => {
    const lines = state.split("\n").filter((line) => /^\[\d+\] /.test(line));
    return Object.fromEntries(lines.map((line, index) => [`item_${index + 1}`, { type: "noul", noul: p(line.replace(/^\[\d+\] /, "")) }]));
  };
}

describe("planAnswer", () => {
  const rules = { mode: "quick" as const, web: false };
  const base = { hasArticle: true, requestedMode: "auto" as const, requestedWeb: "auto" as const, webAvailable: true, rules };
  const routing = (deep: number, fresh: number) =>
    fake(() => ({ depth: { type: "score", score: deep * 2, confidence: 0.8, probabilities: { "0": 0, "1": 1 - deep, "2": deep } }, fresh: { type: "noul", noul: fresh } }));

  test("uses the model's reading of the question", async () => {
    const { decide } = routing(0.8, 0.9);
    assert.deepEqual(await planAnswer("¿Por qué cayó el Imperio romano y qué cambió después?", { ...base, decide }), { mode: "deep", web: true, by: "model" });
    const quick = routing(0.2, 0.1);
    assert.deepEqual(await planAnswer("How tall is Everest?", { ...base, decide: quick.decide }), { mode: "quick", web: false, by: "model" });
  });

  test("keeps the reasoning model for questions it is sure need it", async () => {
    // Live tests: news round-ups and summaries scored at most 0.51 (Microsoft) or 0.22 (Jev);
    // real analysis questions 0.81 and up.
    for (const [p, mode] of [
      [0.22, "quick"],
      [0.51, "quick"],
      [0.59, "quick"],
      [0.6, "deep"],
      [0.81, "deep"],
    ] as const) {
      const { decide } = routing(p, 0);
      assert.equal((await planAnswer("A question", { ...base, decide })).mode, mode, `P=${p}`);
    }
  });

  test("the reader's own settings always win", async () => {
    const { decide } = routing(0.9, 0.9);
    const plan = await planAnswer("Compare these in depth", { ...base, requestedMode: "quick", decide });
    assert.equal(plan.mode, "quick");
    assert.equal(plan.web, true);
  });

  test("doesn't ask the model when nothing is left to decide", async () => {
    const { decide, calls } = routing(0.9, 0.9);
    const plan = await planAnswer("Anything", { ...base, requestedMode: "deep", requestedWeb: "off", rules: { mode: "deep", web: false }, decide });
    assert.equal(calls.length, 0);
    assert.equal(plan.by, "rules");
  });

  test("without an article, web search follows the rules (always on when available)", async () => {
    const { decide } = routing(0.1, 0.0);
    const plan = await planAnswer("Who is Ada Lovelace?", { ...base, hasArticle: false, rules: { mode: "quick", web: true }, decide });
    assert.equal(plan.web, true);
  });

  test("falls back to the keyword rules when the model fails", async () => {
    assert.deepEqual(await planAnswer("Why did it fall?", { ...base, rules: { mode: "deep", web: false }, decide: failing }), { mode: "deep", web: false, by: "rules" });
  });
});

describe("checkGrounded", () => {
  test("returns the model's probability, having shown it the sources and the answer", async () => {
    const { decide, calls } = fake(() => ({ grounded: { type: "noul", noul: 0.91 } }));
    assert.equal(await checkGrounded("[1] Apollo 11 landed in 1969.", "It landed in 1969 [1].", { decide }), 0.91);
    assert.match(calls[0].state, /Apollo 11 landed in 1969\.[\s\S]*It landed in 1969 \[1\]\./);
  });

  test("returns null when there is nothing to check or the model fails", async () => {
    const { decide, calls } = fake(() => ({ grounded: { type: "noul", noul: 1 } }));
    assert.equal(await checkGrounded("", "An answer", { decide }), null);
    assert.equal(await checkGrounded("[1] Sources", "  ", { decide }), null);
    assert.equal(calls.length, 0);
    assert.equal(await checkGrounded("[1] Sources", "An answer", { decide: failing }), null);
  });
});

describe("readSearchIntent", () => {
  test("reads the intent and the language", async () => {
    const { decide } = fake(() => ({
      intent: { type: "choice", choice: "definition", confidence: 0.9, probabilities: { definition: 0.93, article: 0.07 } },
      language: { type: "choice", choice: "en", confidence: 0.99, probabilities: { en: 0.99 } },
    }));
    assert.deepEqual(await readSearchIntent("define serendipity", { decide }), { intent: "definition", intentConfidence: 0.93, language: "en", languageConfidence: 0.99 });
  });

  test("a language outside the list is null, and a failure is null", async () => {
    const { decide } = fake(() => ({
      intent: { type: "choice", choice: "article", confidence: 0.9, probabilities: { article: 0.9 } },
      language: { type: "choice", choice: "other", confidence: 0.8, probabilities: { other: 0.8 } },
    }));
    assert.equal((await readSearchIntent("Ἀθῆναι", { decide }))?.language, null);
    assert.equal(await readSearchIntent("anything", { decide: failing }), null);
  });
});

describe("withoutExplicit", () => {
  const items = [
    { title: "Mathematics", description: "Field of knowledge" },
    { title: "List of sex positions", description: "" },
    { title: "The Holocaust", description: "Genocide during World War II" },
  ];

  test("drops explicit entries and keeps serious ones", async () => {
    const { decide } = fake(perItem((text) => (/sex/i.test(text) ? 0.97 : 0.02)));
    assert.deepEqual(
      (await withoutExplicit(items, { decide })).map((item) => item.title),
      ["Mathematics", "The Holocaust"]
    );
  });

  test("keeps everything when the model fails, and skips empty lists", async () => {
    assert.equal(await withoutExplicit(items, { decide: failing }), items);
    const { decide, calls } = fake(() => ({}));
    assert.deepEqual(await withoutExplicit([], { decide }), []);
    assert.equal(calls.length, 0);
  });
});

describe("decideEach", () => {
  test("splits long lists into requests of 20 and keeps the order", async () => {
    const { decide, calls } = fake(perItem((text) => Number(text) / 100));
    const items = Array.from({ length: 45 }, (_, index) => String(index));
    const result = await decideEach("numbers", "Numbers:", items, { instructions: (n) => `Is ${n} big?`, criteria: { true: "big", false: "small" } }, { decide });
    assert.equal(calls.length, 3);
    assert.deepEqual(result, items.map((item) => Number(item) / 100));
  });
});

describe("refineWebArticle", () => {
  const page = () =>
    assemble({
      title: "What really happened at Chernobyl",
      url: "https://news.example.com/chernobyl",
      description: "",
      image: null,
      site: "News",
      byline: "",
      published: null,
      lang: "en",
      contentHtml: `
        <p>Share this article: Twitter · Facebook · Copy link</p>
        <p>The reactor's cooling system failed at 1:23 a.m., and within seconds the power output surged to ten times its normal level.</p>
        <figure><img src="/img/reactor-4.jpg" width="1200" height="800" alt="Reactor 4 after the explosion"><figcaption>The destroyed reactor</figcaption></figure>
        <p><img src="/img/jane-avatar.jpg" width="64" height="64" alt="Jane Smith"></p>
        <p>Engineers later traced the surge to a design flaw in the control rods, which briefly increased reactivity when inserted.</p>
        <p>Most of the 116,000 residents evacuated in the following days never returned to their homes.</p>
        <p>Subscribe to our newsletter for the best stories every week.</p>
        <p>Notes: <a id="note-1"></a>The plant had four reactors.</p>`,
    });

  const verdicts = fake((task, state) => {
    if (task === "page clean-up") return perItem((text) => (/Share this|Subscribe/.test(text) ? 0.03 : 0.95))(task, state);
    if (task === "page images") return perItem((text) => (/avatar/.test(text) ? 0.05 : 0.97))(task, state);
    if (task === "paywall check") return { preview: { type: "noul", noul: 0.1 } };
    return {};
  });

  test("removes the clutter blocks and junk images, keeps the article", async () => {
    const before = page();
    const after = await refineWebArticle(before, { decide: verdicts.decide });
    const html = after.sections.map((section) => section.html).join("\n");
    assert.doesNotMatch(html, /Share this article|Subscribe to our newsletter|jane-avatar/);
    assert.match(html, /cooling system failed/);
    assert.match(html, /never returned to their homes/);
    assert.match(html, /reactor-4\.jpg/);
    // Empty in-page anchors stay: footnote links jump to them.
    assert.match(html, /id="wa-note-1"/);
    assert.equal(before.media.length, 2);
    assert.deepEqual(after.media.map((item) => item.caption || item.file), ["The destroyed reactor"]);
    assert.equal(after.notice, undefined);
  });

  test("shows the model only the blocks at the edges, plus every image", async () => {
    const pageCalls = verdicts.calls.filter((call) => call.task === "page clean-up");
    assert.ok(pageCalls.length >= 1);
    assert.match(pageCalls[0].state, /Share this article/);
    assert.match(verdicts.calls.find((call) => call.task === "page images")!.state, /file reactor-4\.jpg, 1200x800 pixels, alt text "Reactor 4 after the explosion", caption "The destroyed reactor"/);
  });

  test("marks a paywalled preview", async () => {
    const { decide } = fake((task, state) => (task === "paywall check" ? { preview: { type: "noul", noul: 0.86 } } : perItem(() => 0.9)(task, state)));
    assert.equal((await refineWebArticle(page(), { decide })).notice, "preview");
  });

  test("leaves the page as it was when the model fails", async () => {
    const before = page();
    const after = await refineWebArticle(before, { decide: failing });
    assert.equal(after.media.length, before.media.length);
    assert.match(after.sections.map((section) => section.html).join(""), /Share this article/);
  });

  test("never touches wiki articles", async () => {
    const wiki = { ...page(), kind: "wiki" as const };
    const { decide, calls } = fake(() => ({}));
    assert.equal(await refineWebArticle(wiki, { decide }), wiki);
    assert.equal(calls.length, 0);
  });
});
