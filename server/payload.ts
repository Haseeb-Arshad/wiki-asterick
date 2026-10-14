import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib";
import type { Request, Response } from "express";

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

/** A JSON response compressed once and served many times. */
export interface Payload {
  json: Buffer;
  gzip: Buffer;
  br: Buffer;
  etag: string;
}

export async function toPayload(value: unknown): Promise<Payload> {
  const json = Buffer.from(JSON.stringify(value));
  const [gz, br] = await Promise.all([
    gzipAsync(json, { level: 6 }),
    brotliAsync(json, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } }),
  ]);
  return { json, gzip: gz, br, etag: `"${createHash("sha1").update(json).digest("base64url")}"` };
}

export function readPayload<T>(payload: Payload): T {
  return JSON.parse(payload.json.toString("utf8")) as T;
}

export function sendPayload(req: Request, res: Response, payload: Payload, maxAgeSeconds: number) {
  res.setHeader("Cache-Control", `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds * 10}`);
  res.setHeader("ETag", payload.etag);
  res.setHeader("Vary", "Accept-Encoding");
  res.type("application/json");

  if (req.get("if-none-match") === payload.etag) {
    res.status(304).end();
    return;
  }

  const accepts = req.get("accept-encoding") ?? "";
  if (/\bbr\b/.test(accepts)) {
    res.setHeader("Content-Encoding", "br");
    res.send(payload.br);
  } else if (/\bgzip\b/.test(accepts)) {
    res.setHeader("Content-Encoding", "gzip");
    res.send(payload.gzip);
  } else {
    res.send(payload.json);
  }
}
