import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

// Isolate this run: throwaway data directory and an in-memory database.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "wiki-asterisk-test-"));
process.env.DATABASE_FILE = ":memory:";

const { createApp } = await import("../server/app.ts");
const { hashPassword, verifyPassword } = await import("../server/auth/passwords.ts");
const { issueRefreshToken, rotateRefreshToken, signAccessToken, verifyAccessToken } = await import("../server/auth/tokens.ts");
const { db } = await import("../server/db.ts");

let server: Server;
let baseUrl = "";

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

interface StoredCookie {
  value: string;
  path: string;
  attributes: string;
}

/** A browser-ish client: keeps cookies per path and sends our CSRF header. */
class Client {
  readonly cookies = new Map<string, StoredCookie>();

  async send(method: string, url: string, body?: unknown, { csrf = true } = {}) {
    const cookie = [...this.cookies]
      .filter(([, stored]) => url.startsWith(stored.path))
      .map(([name, stored]) => `${name}=${stored.value}`)
      .join("; ");

    const response = await fetch(baseUrl + url, {
      method,
      headers: {
        "content-type": "application/json",
        ...(csrf ? { "x-wa-request": "1" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(";").map((part) => part.trim());
      const [name, value] = pair.split("=");
      const pathAttribute = attributes.find((attr) => attr.toLowerCase().startsWith("path="));
      const expired = attributes.some((attr) => /^expires=Thu, 01 Jan 1970/i.test(attr));
      if (!value || expired) this.cookies.delete(name);
      else this.cookies.set(name, { value, path: pathAttribute?.slice(5) ?? "/", attributes: attributes.join("; ") });
    }

    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }
}

describe("passwords", () => {
  test("hashes with a salt and verifies", async () => {
    const hash = await hashPassword("correct horse battery");
    assert.match(hash, /^scrypt\$16384\$8\$1\$/);
    assert.notEqual(hash, await hashPassword("correct horse battery"));
    assert.equal(await verifyPassword("correct horse battery", hash), true);
    assert.equal(await verifyPassword("wrong horse battery", hash), false);
  });
});

describe("tokens", () => {
  test("access tokens verify, and tampered ones do not", async () => {
    const token = await signAccessToken({ id: "user-1", name: "Ada" });
    assert.deepEqual(await verifyAccessToken(token), { userId: "user-1", name: "Ada" });

    const [header, payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), sub: "admin" })).toString("base64url");
    assert.equal(await verifyAccessToken(`${header}.${forged}.${signature}`), null);
  });

  test("refresh tokens rotate, tolerate a concurrent retry, and detect reuse", () => {
    db.prepare(`INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u-rot', 'rot@example.com', 'Rot', 'x', 0)`).run();
    const first = issueRefreshToken("u-rot", "test");

    const rotated = rotateRefreshToken(first, "test");
    assert.equal(rotated.ok, true);

    // A second tab presenting the same token moments later is honoured.
    const concurrent = rotateRefreshToken(first, "test");
    assert.equal(concurrent.ok, true);

    // Long after rotation, presenting it again means it was stolen: revoke the family.
    db.prepare(`UPDATE refresh_tokens SET revoked_at = revoked_at - 60000 WHERE revoked_reason = 'rotated'`).run();
    assert.deepEqual(rotateRefreshToken(first, "test"), { ok: false, reason: "reused" });
    if (rotated.ok) assert.equal(rotateRefreshToken(rotated.token, "test").ok, false);
  });
});

describe("auth API", () => {
  const client = new Client();
  const credentials = { name: "Ayesha", email: "reader@example.com", password: "a long passphrase" };

  test("rejects state-changing requests without the CSRF header", async () => {
    const response = await client.send("POST", "/api/auth/login", credentials, { csrf: false });
    assert.equal(response.status, 403);
  });

  test("registers and sets httpOnly session cookies", async () => {
    const response = await client.send("POST", "/api/auth/register", credentials);
    assert.equal(response.status, 201);
    assert.equal(response.body.user.email, "reader@example.com");
    assert.equal(response.body.user.password_hash, undefined);

    const access = client.cookies.get("wa_at");
    const refresh = client.cookies.get("wa_rt");
    assert.ok(access && refresh);
    assert.equal(access.path, "/api");
    assert.equal(refresh.path, "/api/auth");
    assert.match(access.attributes, /HttpOnly/);
    assert.match(refresh.attributes, /SameSite=Strict/);
  });

  test("validates input and refuses duplicate emails", async () => {
    assert.equal((await new Client().send("POST", "/api/auth/register", { ...credentials, password: "short" })).status, 400);
    assert.equal((await new Client().send("POST", "/api/auth/register", { ...credentials, email: "nope" })).status, 400);
    assert.equal((await new Client().send("POST", "/api/auth/register", { ...credentials, email: "READER@example.com" })).status, 409);
  });

  test("returns the current user only with a valid access token", async () => {
    assert.equal((await client.send("GET", "/api/auth/me")).body.user.name, "Ayesha");
    assert.equal((await new Client().send("GET", "/api/auth/me")).status, 401);

    const forged = new Client();
    forged.cookies.set("wa_at", { value: `${client.cookies.get("wa_at")!.value}x`, path: "/api", attributes: "" });
    assert.equal((await forged.send("GET", "/api/auth/me")).status, 401);
  });

  test("logs in with the right password only", async () => {
    const other = new Client();
    const wrong = await other.send("POST", "/api/auth/login", { email: credentials.email, password: "not my password" });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error, "Email or password is incorrect.");

    const unknown = await other.send("POST", "/api/auth/login", { email: "ghost@example.com", password: "whatever123" });
    assert.equal(unknown.body.error, wrong.body.error);

    const right = await other.send("POST", "/api/auth/login", { email: credentials.email, password: credentials.password });
    assert.equal(right.status, 200);
  });

  test("refresh issues a new token pair", async () => {
    const before = client.cookies.get("wa_rt")!.value;
    const response = await client.send("POST", "/api/auth/refresh");
    assert.equal(response.status, 200);
    assert.notEqual(client.cookies.get("wa_rt")!.value, before);
  });

  test("logout clears cookies and ends the session", async () => {
    const refreshToken = client.cookies.get("wa_rt")!.value;
    assert.equal((await client.send("POST", "/api/auth/logout")).status, 204);
    assert.equal(client.cookies.has("wa_at"), false);

    const replay = new Client();
    replay.cookies.set("wa_rt", { value: refreshToken, path: "/api/auth", attributes: "" });
    assert.equal((await replay.send("POST", "/api/auth/refresh")).status, 401);
  });
});

describe("library API", () => {
  const client = new Client();

  before(async () => {
    await client.send("POST", "/api/auth/register", { name: "Lib", email: "lib@example.com", password: "library pass 1" });
  });

  test("requires a session", async () => {
    assert.equal((await new Client().send("GET", "/api/library")).status, 401);
  });

  test("saves bookmarks, history and highlights", async () => {
    const ref = { wiki: "en", title: "Moon", description: "Natural satellite", thumbnail: "https://evil.example/pixel.gif" };
    const bookmark = await client.send("PUT", "/api/library/bookmarks", ref);
    assert.equal(bookmark.status, 200);
    assert.equal(bookmark.body.wiki, "en.wikipedia.org");
    assert.equal(bookmark.body.thumbnail, null, "non-Wikimedia images are dropped");

    await client.send("PUT", "/api/library/history", { ...ref, progress: 1.7, sectionId: "Orbit" });

    const created = await client.send("POST", "/api/library/highlights", {
      wiki: "en.wikipedia.org",
      articleTitle: "Moon",
      sectionId: "Orbit",
      sectionTitle: "Orbit",
      text: "The Moon is Earth's only natural satellite.",
      color: "green",
    });
    assert.equal(created.status, 201);

    const patched = await client.send("PATCH", `/api/library/highlights/${created.body.id}`, { note: "Check this" });
    assert.equal(patched.body.note, "Check this");
    assert.equal(patched.body.color, "green");

    const snapshot = (await client.send("GET", "/api/library")).body;
    assert.equal(snapshot.bookmarks.length, 1);
    assert.equal(snapshot.history[0].progress, 1, "progress is clamped");
    assert.equal(snapshot.highlights.length, 1);
  });

  test("keeps users' data apart", async () => {
    const stranger = new Client();
    await stranger.send("POST", "/api/auth/register", { name: "S", email: "s@example.com", password: "stranger pass" });
    const theirs = (await client.send("GET", "/api/library")).body.highlights[0];

    assert.equal((await stranger.send("PATCH", `/api/library/highlights/${theirs.id}`, { note: "mine now" })).status, 404);
    assert.equal((await stranger.send("GET", "/api/library")).body.highlights.length, 0);
  });

  test("imports guest data and skips malformed entries", async () => {
    const response = await client.send("POST", "/api/library/import", {
      bookmarks: [{ wiki: "de", title: "Mond", description: "", thumbnail: null, createdAt: 1 }, { wiki: "evil.com", title: "x" }],
      history: [{ wiki: "en", title: "Sun", progress: 0.4, readAt: Date.now() - 1000 }],
      highlights: [{ wiki: "en", articleTitle: "Sun", text: "A star.", color: "pink" }],
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.bookmarks.map((b: { title: string }) => b.title).sort(), ["Mond", "Moon"]);
    assert.equal(response.body.history.length, 2);
    assert.equal(response.body.highlights.length, 2);
  });
});
