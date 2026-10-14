import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";
import { db, transaction } from "../db.js";

export interface AccessClaims {
  userId: string;
  name: string;
}

/** Short-lived, stateless JWT. Verified on every API request without a DB lookup. */
export async function signAccessToken(user: { id: string; name: string }): Promise<string> {
  return new SignJWT({ name: user.name })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuer(config.jwtIssuer)
    .setAudience(config.jwtAudience)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(`${config.accessTokenTtlSeconds}s`)
    .sign(config.jwtSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, config.jwtSecret, {
      algorithms: ["HS256"],
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
    });
    if (typeof payload.sub !== "string") return null;
    return { userId: payload.sub, name: typeof payload.name === "string" ? payload.name : "" };
  } catch {
    return null;
  }
}

/*
 * Refresh tokens are opaque random strings, stored only as SHA-256 hashes.
 * Each use rotates the token. Tokens issued from one sign-in share a family_id:
 * if an already-rotated token is presented again (a sign of theft), the whole
 * family is revoked and that device has to sign in again.
 *
 * Two tabs refreshing at the same instant both present the same token, so a
 * token rotated within the last few seconds is still honoured once more.
 */
const ROTATION_GRACE_MS = 10_000;

interface RefreshRow {
  id: string;
  user_id: string;
  family_id: string;
  expires_at: number;
  revoked_at: number | null;
  revoked_reason: "rotated" | "signed_out" | "reused" | "expired" | null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

const insertRefresh = db.prepare(`
  INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, created_at, expires_at, user_agent)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const findRefresh = db.prepare(`
  SELECT id, user_id, family_id, expires_at, revoked_at, revoked_reason
  FROM refresh_tokens WHERE token_hash = ?
`);
const revokeRefresh = db.prepare(`
  UPDATE refresh_tokens SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL
`);
const revokeFamily = db.prepare(`
  UPDATE refresh_tokens SET revoked_at = ?, revoked_reason = ? WHERE family_id = ? AND revoked_at IS NULL
`);
const revokeUser = db.prepare(`
  UPDATE refresh_tokens SET revoked_at = ?, revoked_reason = 'signed_out' WHERE user_id = ? AND revoked_at IS NULL
`);
const pruneExpired = db.prepare(`DELETE FROM refresh_tokens WHERE expires_at < ?`);

export function issueRefreshToken(userId: string, userAgent: string, familyId: string = randomUUID()): string {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  insertRefresh.run(
    randomUUID(),
    userId,
    familyId,
    hashToken(token),
    now,
    now + config.refreshTokenTtlSeconds * 1000,
    userAgent.slice(0, 200)
  );
  return token;
}

export type RotationResult =
  | { ok: true; userId: string; token: string }
  | { ok: false; reason: "unknown" | "expired" | "reused" | "signed_out" };

export function rotateRefreshToken(token: string, userAgent: string): RotationResult {
  return transaction((): RotationResult => {
    const row = findRefresh.get(hashToken(token)) as RefreshRow | undefined;
    const now = Date.now();

    if (!row) return { ok: false, reason: "unknown" };

    if (row.revoked_at !== null) {
      const withinGrace = row.revoked_reason === "rotated" && now - row.revoked_at < ROTATION_GRACE_MS;
      if (withinGrace) {
        return { ok: true, userId: row.user_id, token: issueRefreshToken(row.user_id, userAgent, row.family_id) };
      }
      if (row.revoked_reason === "rotated") {
        revokeFamily.run(now, "reused", row.family_id);
        return { ok: false, reason: "reused" };
      }
      return { ok: false, reason: row.revoked_reason === "expired" ? "expired" : "signed_out" };
    }

    if (row.expires_at <= now) {
      revokeRefresh.run(now, "expired", row.id);
      return { ok: false, reason: "expired" };
    }

    revokeRefresh.run(now, "rotated", row.id);
    return { ok: true, userId: row.user_id, token: issueRefreshToken(row.user_id, userAgent, row.family_id) };
  });
}

/** Signs out one device: every token from that sign-in stops working. */
export function revokeRefreshToken(token: string): void {
  const row = findRefresh.get(hashToken(token)) as RefreshRow | undefined;
  if (row) revokeFamily.run(Date.now(), "signed_out", row.family_id);
}

export function revokeAllRefreshTokens(userId: string): void {
  revokeUser.run(Date.now(), userId);
}

export function pruneExpiredRefreshTokens(): void {
  pruneExpired.run(Date.now() - 24 * 60 * 60 * 1000);
}
