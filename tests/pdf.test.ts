import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "wiki-asterisk-pdf-test-"));
process.env.DATABASE_FILE = ":memory:";

const { structurePdf } = await import("../server/web/pdf.ts");
type PdfItem = import("../server/web/pdf.ts").PdfItem;

/** A page laid out top to bottom: [text, size, gap above] per line. */
function page(lines: [string, number, number?][], extra: PdfItem[] = []): PdfItem[] {
  let y = 760;
  const items: PdfItem[] = [];
  for (const [text, size, gap = size * 1.2] of lines) {
    y -= gap;
    items.push({ str: text, height: size, x: 72, y, hasEOL: true });
  }
  return [...items, ...extra];
}

// Distinct body lines (by words: digits are ignored when spotting running heads, which repeat on most pages).
const WORDS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"];
let lineNumber = 0;
const body = () => `The ${WORDS[lineNumber++ % WORDS.length]} line: plants turn light into chemical energy in their chloroplasts.`;

describe("structurePdf", () => {
  const pages = [
    page(
      [
        ["Light Harvesting in", 18],
        ["Green Plants", 18],
        ["Abstract", 11, 30],
        ["We study how leaves capture light across a day and how that shapes growth.", 10],
        ["1 Introduction", 12, 24],
        [body(), 10],
        ["The study of photosyn-", 10],
        ["thesis began in the eighteenth century with simple jars.", 10],
        ["A second paragraph starts after a larger gap and carries on.", 10, 22],
        ["Journal of Leaves 12", 8, 40],
      ],
      [{ str: "arXiv:1234.5678v1 [q-bio]", height: 20, x: 20, y: 400, hasEOL: true, rotated: true }]
    ),
    page([
      ["2.1 Methods in the field", 12],
      [body(), 10],
      [body(), 10],
      ["Journal of Leaves 13", 8, 40],
    ]),
    page([
      ["3 Results", 12],
      [body(), 10],
      ["References", 12, 24],
      ["[1] A. Author. A paper about leaves. 2020.", 9],
      ["Journal of Leaves 14", 8, 40],
    ]),
  ];
  const result = structurePdf(pages, "fallback")!;
  const titles = result.sections.map((section) => section.title);
  const html = result.sections.map((section) => section.html).join("\n");

  test("takes the title from the largest type on the first page", () => {
    assert.equal(result.title, "Light Harvesting in Green Plants");
  });

  test("finds headings by size, numbering and common names, with numbered depth", () => {
    assert.deepEqual(titles, ["", "Abstract", "1 Introduction", "2.1 Methods in the field", "3 Results"]);
    assert.equal(result.sections.find((section) => section.title === "2.1 Methods in the field")!.level, 3);
  });

  test("joins lines into paragraphs and splits them at larger gaps", () => {
    const intro = result.sections.find((section) => section.title === "1 Introduction")!.html;
    assert.equal(intro.match(/<p>/g)!.length, 2);
  });

  test("rejoins words split across lines", () => {
    assert.match(html, /The study of photosynthesis began/);
  });

  test("drops running footers, sideways stamps and the references", () => {
    assert.doesNotMatch(html, /Journal of Leaves|arXiv:1234|A paper about leaves/);
  });

  test("uses the abstract as the summary", () => {
    assert.match(result.abstract, /^We study how leaves capture light/);
  });

  test("treats a run of large lines as a notice, not headings", () => {
    const notice = structurePdf(
      [
        page([
          ["Permission is granted to reproduce the tables and", 12],
          ["figures in this paper for scholarly works only", 12],
          ["1 Introduction", 12, 24],
          [body(), 10],
          [body(), 10],
          [body(), 10],
          [body(), 10],
        ]),
      ],
      "fallback"
    )!;
    assert.deepEqual(
      notice.sections.map((section) => section.title),
      ["", "1 Introduction"]
    );
  });

  test("returns null for a scan with no text to read", () => {
    assert.equal(structurePdf([page([["Figure 1", 10]])], "scan"), null);
  });
});
