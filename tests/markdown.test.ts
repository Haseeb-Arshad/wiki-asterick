import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isMarkdownText, markdownToHtml, withoutExaCard } from "../server/web/markdown.js";

describe("markdown from Exa's crawler", () => {
  test("tells markdown from HTML", () => {
    assert.equal(isMarkdownText("# Title\n\nSome text."), true);
    assert.equal(isMarkdownText("<p>Some text.</p>"), false);
    assert.equal(isMarkdownText("Plain text with 3 < 4 in it."), true);
  });

  test("turns blocks into HTML", () => {
    const html = markdownToHtml(
      [
        "# Results",
        "",
        "First line of a paragraph",
        "that carries on.",
        "",
        "- one",
        "- **two**",
        "",
        "1. first",
        "2. second",
        "",
        "> quoted",
        "",
        "| Group | n |",
        "| --- | --- |",
        "| Treated | 31 |",
        "",
        "---",
        "",
        "```",
        "a < b",
        "```",
      ].join("\n")
    );
    assert.match(html, /<h2>Results<\/h2>/);
    assert.match(html, /<p>First line of a paragraph that carries on\.<\/p>/);
    assert.match(html, /<ul><li>one<\/li><li><strong>two<\/strong><\/li><\/ul>/);
    assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
    assert.match(html, /<blockquote><p>quoted<\/p><\/blockquote>/);
    assert.match(html, /<th>Group<\/th>.*<td>Treated<\/td><td>31<\/td>/);
    assert.match(html, /<hr>/);
    assert.match(html, /<pre><code>a &lt; b<\/code><\/pre>/);
  });

  test("escapes HTML and keeps only web links", () => {
    const html = markdownToHtml("<script>x</script> [safe](https://example.org/a?b=1&c=2) [bad](javascript:alert(1)) *em* `<b>`");
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /<a href="https:\/\/example\.org\/a\?b=1&amp;c=2">safe<\/a>/);
    assert.doesNotMatch(html, /javascript:/);
    assert.match(html, /<em>em<\/em>/);
    assert.match(html, /<code>&lt;b&gt;<\/code>/);
  });

  test("drops the card Exa puts before a paper", () => {
    const markdown = "# A Paper\n\nJournal. 40 citations.\n\n## Authors\n\n- Someone\n\n---\n\n# A Paper\n\nThe body starts here.";
    assert.equal(withoutExaCard(markdown, "A paper").trim(), "The body starts here.");
    assert.equal(withoutExaCard("# A Paper\n\nOnly once.", "A Paper"), "# A Paper\n\nOnly once.");
  });
});
