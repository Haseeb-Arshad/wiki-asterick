// Smoke test: starts the built app on a spare port with a throwaway database, then checks it
// the way a person would, in a real headless Chrome or Edge.
//
//   npm run build && npm run smoke            checks that need no internet
//   npm run smoke -- --live                   also reads real Wikipedia articles
//
// Set CHROME_PATH to use a browser that isn't found automatically.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findBrowser, freePort, launchBrowser, sleep } from "./lib/browser.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const live = process.argv.includes("--live");
const DEFAULT_TITLE = "WikiAsterisk — Wikipedia, without the clutter";

const results = [];

async function step(name, run, { needsLive = false } = {}) {
  if (needsLive && !live) return;
  const started = Date.now();
  try {
    await run();
    results.push({ name, ok: true });
    console.log(`  ✔ ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    results.push({ name, ok: false, message: error.message });
    console.log(`  ✖ ${name}\n      ${String(error.message).split("\n")[0]}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

// ---- start the app -------------------------------------------------------------------------

if (!fs.existsSync(path.join(root, "dist", "index.html"))) {
  console.error("There is no build to test. Run `npm run build` first.");
  process.exit(2);
}
const executable = findBrowser();
if (!executable) {
  console.error("No Chrome or Edge found. Install one, or set CHROME_PATH to its location.");
  process.exit(2);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-asterisk-smoke-"));
const appPort = await freePort();
const base = `http://127.0.0.1:${appPort}`;

const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts", "--production"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    JWT_SECRET: randomBytes(36).toString("base64url"),
    PORT: String(appPort),
    DATA_DIR: path.join(scratch, "data"),
    COOKIE_SECURE: "false",
    // The smoke test never asks the AI anything.
    OPENROUTER_API_KEY: "",
    EXA_API_KEY: "",
  },
});
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk));
server.stderr.on("data", (chunk) => (serverLog += chunk));

let browser;

async function finish(code) {
  await browser?.close().catch(() => undefined);
  server.kill();
  await sleep(300);
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  process.exit(code);
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 120 && !ready; attempt++) {
    ready = await fetch(`${base}/api/health`).then((response) => response.ok, () => false);
    if (!ready) await sleep(250);
  }
  if (!ready) throw new Error(`The server did not start.\n${serverLog}`);

  console.log(`Smoke test of ${base}${live ? " (live: uses Wikipedia)" : ""} in ${path.basename(executable)}\n`);

  // ---- over HTTP ---------------------------------------------------------------------------
  console.log("Server");
  await step("is healthy", async () => {
    const response = await fetch(`${base}/api/health`);
    expect((await response.json()).status === "ok", "health check failed");
  });

  await step("serves the app with its manifest link and a title", async () => {
    const response = await fetch(`${base}/`);
    const html = await response.text();
    expect(response.status === 200, `status ${response.status}`);
    expect(/text\/html/.test(response.headers.get("content-type") ?? ""), "not HTML");
    expect(html.includes('rel="manifest"'), "no manifest link");
    expect(html.includes(`<title>${DEFAULT_TITLE}</title>`), "unexpected title");
    expect((response.headers.get("content-security-policy") ?? "").includes("default-src 'self'"), "no content security policy");
  });

  await step("answers 404 for unknown pages and missing files", async () => {
    for (const missing of ["/nope", "/assets/missing.js", "/read/en"]) {
      const response = await fetch(`${base}${missing}`);
      expect(response.status === 404, `${missing} answered ${response.status}`);
    }
  });

  await step("serves the manifest and the service worker", async () => {
    const manifest = await fetch(`${base}/manifest.webmanifest`);
    expect(manifest.status === 200 && (await manifest.json()).name === "WikiAsterisk", "manifest missing or wrong");
    const worker = await fetch(`${base}/sw.js`);
    expect(worker.status === 200 && /javascript/.test(worker.headers.get("content-type") ?? ""), "service worker missing");
  });

  await step("rejects writes without the request header", async () => {
    const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(response.status === 403, `answered ${response.status}`);
  });

  // ---- in a browser ------------------------------------------------------------------------
  console.log("\nBrowser");
  browser = await launchBrowser({ executable, profile: path.join(scratch, "profile"), port: await freePort() });

  await step("home page shows the search", async () => {
    await browser.navigate(`${base}/`);
    await browser.waitFor("document.querySelector('h1')?.innerText.includes('without the clutter')", 20_000, "the home heading");
    await browser.waitFor("document.querySelector('.search-box input')", 5_000, "the search box");
    expect((await browser.evaluate("document.title")) === DEFAULT_TITLE, "wrong tab title");
  });

  await step("an unknown page shows the not-found page", async () => {
    await browser.navigate(`${base}/nope`);
    await browser.waitFor("document.querySelector('h1')?.innerText.includes('wandered off')", 10_000, "the not-found heading");
    expect((await browser.evaluate("document.title")).startsWith("Page not found"), "tab not named");
  });

  await step("a link shared to the app opens in the reader", async () => {
    await browser.navigate(`${base}/share?text=${encodeURIComponent("Worth a read https://example.com/post.")}`);
    await browser.waitFor("location.pathname === '/web'", 10_000, "the redirect to /web");
    expect((await browser.evaluate("new URLSearchParams(location.search).get('url')")) === "https://example.com/post", "wrong link");
  });

  await step("the service worker takes control of the app", async () => {
    await browser.navigate(`${base}/`);
    await browser.evaluate("navigator.serviceWorker.ready.then(() => true)");
    if (!(await browser.evaluate("Boolean(navigator.serviceWorker.controller)"))) await browser.navigate(`${base}/`);
    await browser.waitFor("navigator.serviceWorker.controller", 10_000, "the worker to control the page");
  });

  await step("the app is installable", async () => {
    const manifest = await browser.send("Page.getAppManifest");
    expect(manifest.errors.length === 0, `manifest problems: ${manifest.errors.map((error) => error.message).join("; ")}`);
    const installability = await browser.send("Page.getInstallabilityErrors");
    expect(installability.installabilityErrors.length === 0, `not installable: ${installability.installabilityErrors.map((error) => error.errorId).join(", ")}`);
  });

  const email = `smoke-${randomBytes(4).toString("hex")}@example.test`;
  const password = randomBytes(12).toString("base64url");
  await step("signing up works and the account page shows who is signed in", async () => {
    await browser.navigate(`${base}/signup`);
    await browser.waitFor("document.getElementById('auth-email')", 10_000, "the sign-up form");
    const fill = (id, value) =>
      browser.evaluate(`(() => {
        const input = document.getElementById(${JSON.stringify(id)});
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
    await fill("auth-name", "Smoke Test");
    await fill("auth-email", email);
    await fill("auth-password", password);
    await browser.evaluate("document.querySelector('form.auth-form button[type=submit]').click()");
    await browser.waitFor("location.pathname !== '/signup'", 15_000, "the redirect after signing up");
    await browser.navigate(`${base}/account`);
    await browser.waitFor(`document.body.innerText.includes(${JSON.stringify(email)})`, 10_000, "the account page to show the email");
    expect((await browser.evaluate("document.title")).startsWith("Account"), "tab not named");
  });

  await step("the library opens for the signed-in reader", async () => {
    await browser.navigate(`${base}/library`);
    await browser.waitFor("document.querySelector('h1')?.innerText.includes('Your library')", 10_000, "the library heading");
    await browser.waitFor(`document.body.innerText.includes(${JSON.stringify(email)})`, 10_000, "the library to mention the account");
  });

  await step("no uncaught errors so far", async () => {
    const errors = browser.pageErrors();
    expect(errors.length === 0, `${errors.length} error(s): ${errors[0]}`);
  });

  // ---- real articles (needs the internet) ----------------------------------------------------
  if (live) {
    console.log("\nLive (Wikipedia)");

    await step("an article's address carries its own preview tags", async () => {
      const response = await fetch(`${base}/read/en/Moon`);
      const html = await response.text();
      expect(response.status === 200, `status ${response.status}`);
      expect(html.includes("<title>Moon — WikiAsterisk</title>"), "title not set");
      expect(/property="og:image" content="https:\/\//.test(html), "no preview image");
      expect(/rel="canonical"/.test(html), "no canonical link");
    });

    await step("a missing article answers 404", async () => {
      const response = await fetch(`${base}/read/en/Zzzxqy_not_a_real_article_12345`);
      expect(response.status === 404, `status ${response.status}`);
    });

    await step("an article opens, and shows its summary first", async () => {
      await browser.navigate(`${base}/read/en/Moon`);
      await browser.waitFor("document.querySelector('h1.article-title') && !document.querySelector('[aria-busy=\"true\"]') && document.querySelector('.prose')", 45_000, "the article");
      const words = await browser.evaluate("document.querySelector('.prose').innerText.split(/\\s+/).length");
      expect(words > 500, `only ${words} words`);
      expect((await browser.evaluate("document.title")) === "Moon — WikiAsterisk", "tab not named");
    });

    await step("reading settings change the text and the paper", async () => {
      await browser.evaluate("document.querySelector('.action-aa').click()");
      await browser.waitFor("document.querySelector('.reading-settings')", 5_000, "the reading settings");
      const size = () => browser.evaluate("parseFloat(getComputedStyle(document.querySelector('.prose p')).fontSize)");
      const before = await size();
      await browser.evaluate("document.querySelector('.reading-settings [aria-label=\"Larger text\"]').click()");
      await browser.evaluate("document.querySelector('.reading-settings [aria-label=\"Larger text\"]').click()");
      await sleep(200);
      expect((await size()) > before, "text did not get larger");
      await browser.evaluate("[...document.querySelectorAll('.reading-settings button')].find((button) => button.textContent.trim() === 'Sepia').click()");
      await sleep(200);
      expect((await browser.evaluate("getComputedStyle(document.querySelector('.reader')).backgroundColor")) === "rgb(244, 236, 216)", "paper did not turn sepia");
    });

    await step("saving an article keeps it for offline reading", async () => {
      await browser.evaluate("document.querySelector('.sheet [aria-label=\"Close panel\"]').click()");
      await browser.evaluate("document.querySelector('button[title^=\"Save\"]').click()");
      await browser.waitFor("document.querySelector('.toaster')?.innerText.includes('Available offline')", 30_000, "the offline confirmation");
      await browser.navigate(`${base}/library?tab=saved`);
      await browser.waitFor("document.querySelector('.offline-tag')", 15_000, "the Offline tag in the library");
    });

    await step("search finds an article and offers to ask", async () => {
      await browser.navigate(`${base}/`);
      await browser.waitFor("document.querySelector('.search-box input')", 10_000, "the search box");
      await browser.evaluate("document.querySelector('.search-box input').focus()");
      await browser.send("Input.insertText", { text: "photosynth" });
      await browser.waitFor("[...document.querySelectorAll('.search-suggestions .result-title')].some((title) => title.textContent === 'Photosynthesis')", 15_000, "Photosynthesis in the suggestions");
    });

    await step("no uncaught errors during the live checks", async () => {
      const errors = browser.pageErrors();
      expect(errors.length === 0, `${errors.length} error(s): ${errors[0]}`);
    });
  }
} catch (error) {
  console.error(`\n${error.message}`);
  results.push({ name: "setup", ok: false, message: error.message });
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
await finish(failed.length ? 1 : 0);
