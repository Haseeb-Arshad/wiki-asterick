// A small Chrome DevTools Protocol driver for a headless Chrome or Edge, with no dependencies.
// It is what the smoke test uses to open the real app and check what a person would see.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

/** The first Chrome or Edge found, or null. Set CHROME_PATH to use another. */
export function findBrowser() {
  return CANDIDATES.filter(Boolean).find((candidate) => existsSync(candidate)) ?? null;
}

/** A TCP port nothing is using right now. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("Could not connect to the browser")), { once: true });
  });
  let counter = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    } else if (data.method) {
      events.push(data);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++counter;
      pending.set(id, (data) => (data.error ? reject(new Error(`${method}: ${data.error.message}`)) : resolve(data.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ws, send, events };
}

/**
 * Starts a headless browser with a throwaway profile and opens one tab.
 * `args` are extra browser flags; `profile` is the user-data directory.
 */
export async function launchBrowser({ executable, profile, port, args = [] }) {
  const sandbox = process.env.CI ? ["--no-sandbox"] : [];
  const proc = spawn(
    executable,
    ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-gpu", ...sandbox, ...args, "about:blank"],
    { stdio: "ignore" }
  );

  let page;
  for (let attempt = 0; attempt < 80 && !page; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = targets.find((target) => target.type === "page");
    } catch {
      // not listening yet
    }
    if (!page) await sleep(250);
  }
  if (!page) {
    proc.kill();
    throw new Error(`The browser did not start (${executable})`);
  }

  const tab = await connect(page.webSocketDebuggerUrl);
  await tab.send("Page.enable");
  await tab.send("Runtime.enable");

  const evaluate = async (expression) => {
    const result = await tab.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };

  const waitFor = async (expression, timeoutMs = 20_000, label = expression) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(`Boolean(${expression})`)) return true;
      } catch {
        // The page is navigating; try again.
      }
      await sleep(200);
    }
    throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for: ${label}`);
  };

  const navigate = async (url) => {
    await tab.send("Page.navigate", { url });
    await sleep(300);
    await waitFor("document.readyState === 'complete'", 30_000, "the page to load");
  };

  /** Uncaught errors and console errors from the page so far (failed network loads don't count). */
  const pageErrors = () =>
    tab.events
      .filter((event) => event.method === "Runtime.exceptionThrown" || (event.method === "Runtime.consoleAPICalled" && event.params.type === "error"))
      .map((event) =>
        event.method === "Runtime.exceptionThrown"
          ? (event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text)
          : event.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ")
      )
      .filter((text) => !/Failed to load resource/i.test(text));

  const close = async () => {
    try {
      const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      const browser = await connect(version.webSocketDebuggerUrl);
      await browser.send("Browser.close").catch(() => undefined);
    } catch {
      // already closed
    }
    await sleep(500);
    proc.kill();
  };

  return { send: tab.send, evaluate, waitFor, navigate, pageErrors, close };
}
