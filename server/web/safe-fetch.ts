import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";
import { HttpError } from "../http.js";

/*
 * Fetching pages from links that visitors paste is a classic SSRF risk: a link
 * could point at localhost, the private network or a cloud metadata endpoint.
 * Every hop (including redirects) is checked, and the check happens inside the
 * socket's DNS lookup so a hostname can't resolve to a public address for the
 * check and a private one for the connection.
 */

function ipv4ToNumber(address: string): number {
  return address.split(".").reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;
}

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isPublicV4(address: string): boolean {
  const value = ipv4ToNumber(address);
  return !BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToNumber(base) & mask);
  });
}

export function isPublicAddress(address: string): boolean {
  if (net.isIPv4(address)) return isPublicV4(address);
  if (!net.isIPv6(address)) return false;

  const normalized = address.toLowerCase();
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicV4(mapped[1]);
  if (normalized === "::" || normalized === "::1") return false;

  const firstGroup = parseInt(normalized.split(":")[0] || "0", 16);
  if ((firstGroup & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((firstGroup & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
  if ((firstGroup & 0xff00) === 0xff00) return false; // multicast
  if (normalized.startsWith("64:ff9b:")) return false; // NAT64 can reach IPv4 space
  if (normalized.startsWith("2001:db8:")) return false; // documentation
  return true;
}

export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "That doesn't look like a link.", "bad_url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new HttpError(400, "Only http and https links can be opened.", "bad_url");
  if (url.username || url.password) throw new HttpError(400, "Links with credentials can't be opened.", "bad_url");
  if (url.port && url.port !== "80" && url.port !== "443") throw new HttpError(400, "Links on unusual ports can't be opened.", "bad_url");

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new HttpError(400, "That address can't be opened.", "blocked_host");
  }
  if (net.isIP(host) && !isPublicAddress(host)) throw new HttpError(400, "That address can't be opened.", "blocked_host");
  return url;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

function guardedLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback) {
  dnsLookup(hostname, { all: true }, (error, addresses) => {
    if (error) {
      callback(error, "");
      return;
    }
    if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
      callback(Object.assign(new Error("Blocked address"), { code: "EBLOCKED" }), "");
      return;
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

export interface FetchedPage {
  url: string;
  contentType: string;
  body: string;
}

const USER_AGENT = "Mozilla/5.0 (compatible; WikiAsterisk/2.0; +https://github.com/Haseeb-Arshad/wiki-asterick)";

function requestOnce(url: URL, timeoutMs: number): Promise<http.IncomingMessage> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup as unknown as typeof dnsLookup,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "en;q=0.9,*;q=0.5",
        },
        timeout: timeoutMs,
      },
      resolve
    );
    request.on("timeout", () => request.destroy(new HttpError(504, "The site took too long to respond.", "upstream_timeout")));
    request.on("error", (error: NodeJS.ErrnoException) => {
      if (error instanceof HttpError) reject(error);
      else if (error.code === "EBLOCKED") reject(new HttpError(400, "That address can't be opened.", "blocked_host"));
      else reject(new HttpError(502, "Couldn't reach that site.", "upstream_unreachable"));
    });
    request.end();
  });
}

function decoded(response: http.IncomingMessage): Readable {
  const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
  if (encoding === "gzip") return response.pipe(createGunzip());
  if (encoding === "deflate") return response.pipe(createInflate());
  if (encoding === "br") return response.pipe(createBrotliDecompress());
  return response;
}

async function readBody(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) {
      stream.destroy();
      throw new HttpError(413, "That page is too large to read here.", "too_large");
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function charsetOf(contentType: string, head: Buffer): string {
  const fromHeader = contentType.match(/charset=([\w-]+)/i)?.[1];
  const fromMeta = head.toString("latin1").match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  const charset = (fromHeader || fromMeta || "utf-8").toLowerCase();
  try {
    new TextDecoder(charset);
    return charset;
  } catch {
    return "utf-8";
  }
}

/** Fetches an HTML page from the public internet, following up to 4 checked redirects. */
export async function fetchPublicPage(raw: string, { timeoutMs = 12_000, maxBytes = 4 * 1024 * 1024 } = {}): Promise<FetchedPage> {
  let url = assertFetchableUrl(raw);

  for (let hop = 0; hop <= 4; hop++) {
    const response = await requestOnce(url, timeoutMs);
    const status = response.statusCode ?? 0;

    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      url = assertFetchableUrl(new URL(response.headers.location, url).toString());
      continue;
    }

    if (status === 404 || status === 410) {
      response.resume();
      throw new HttpError(404, "That page doesn't exist anymore.", "not_found");
    }
    if (status >= 400) {
      response.resume();
      throw new HttpError(502, `The site refused the request (${status}).`, "upstream_error");
    }

    const contentType = String(response.headers["content-type"] ?? "");
    if (contentType && !/html|xml/i.test(contentType)) {
      response.resume();
      throw new HttpError(415, "That link isn't a web page (it might be a PDF or a file).", "not_html");
    }

    const buffer = await readBody(decoded(response), maxBytes);
    const body = new TextDecoder(charsetOf(contentType, buffer.subarray(0, 2048))).decode(buffer);
    return { url: url.toString(), contentType, body };
  }

  throw new HttpError(502, "That link redirects too many times.", "too_many_redirects");
}
