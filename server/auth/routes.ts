import { randomUUID } from "node:crypto";
import { Router, type CookieOptions, type Request, type RequestHandler, type Response } from "express";
import type { User } from "../../shared/types.js";
import { config } from "../config.js";
import { db } from "../db.js";
import { HttpError, asyncHandler, rateLimit, readString } from "../http.js";
import { burnPasswordCheck, hashPassword, verifyPassword } from "./passwords.js";
import {
  issueRefreshToken,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  verifyAccessToken,
  type AccessClaims,
} from "./tokens.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AccessClaims;
    }
  }
}

const ACCESS_COOKIE = "wa_at";
const REFRESH_COOKIE = "wa_rt";
// Readable by JavaScript and carries no secret: it only tells the client a
// session probably exists, so guests skip a pointless /me + /refresh round trip.
const HINT_COOKIE = "wa_s";

const baseCookie: CookieOptions = {
  httpOnly: true,
  secure: config.cookieSecure,
};

function setSessionCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...baseCookie,
    sameSite: "lax",
    path: "/api",
    maxAge: config.accessTokenTtlSeconds * 1000,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseCookie,
    sameSite: "strict",
    path: "/api/auth",
    maxAge: config.refreshTokenTtlSeconds * 1000,
  });
  res.cookie(HINT_COOKIE, "1", {
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: config.refreshTokenTtlSeconds * 1000,
  });
}

function clearSessionCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...baseCookie, sameSite: "lax", path: "/api" });
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie, sameSite: "strict", path: "/api/auth" });
  res.clearCookie(HINT_COOKIE, { secure: config.cookieSecure, sameSite: "lax", path: "/" });
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: number;
}

const findUserByEmail = db.prepare(`SELECT * FROM users WHERE email = ?`);
const findUserById = db.prepare(`SELECT * FROM users WHERE id = ?`);
const insertUser = db.prepare(
  `INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`
);
const updateUserName = db.prepare(`UPDATE users SET name = ? WHERE id = ?`);
const deleteUser = db.prepare(`DELETE FROM users WHERE id = ?`);

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readEmail(value: unknown): string {
  const email = readString(value, "Email", { max: 254 }).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, "Enter a valid email address.");
  return email;
}

function readPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 8) {
    throw new HttpError(400, "Use a password with at least 8 characters.");
  }
  if (value.length > 128) throw new HttpError(400, "Use a password with at most 128 characters.");
  return value;
}

async function startSession(req: Request, res: Response, user: UserRow) {
  const accessToken = await signAccessToken(user);
  const refreshToken = issueRefreshToken(user.id, req.get("user-agent") ?? "");
  setSessionCookies(res, accessToken, refreshToken);
}

/** Attaches req.auth when a valid access token cookie is present. */
export const readSession: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (typeof token !== "string") {
    next();
    return;
  }
  verifyAccessToken(token)
    .then((claims) => {
      if (claims) req.auth = claims;
      next();
    })
    .catch(next);
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (req.auth) next();
  else next(new HttpError(401, "Sign in to continue.", "unauthenticated"));
};

export function currentUserId(req: Request): string {
  if (!req.auth) throw new HttpError(401, "Sign in to continue.", "unauthenticated");
  return req.auth.userId;
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many attempts. Wait a few minutes and try again.",
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  key: (req) => `${req.ip}:${String(req.body?.email ?? "").toLowerCase()}`,
  message: "Too many sign-in attempts for this account. Wait a few minutes and try again.",
});

export const authRouter = Router();

authRouter.post(
  "/register",
  authLimiter,
  asyncHandler(async (req, res) => {
    const name = readString(req.body?.name, "Name", { max: 60 });
    const email = readEmail(req.body?.email);
    const password = readPassword(req.body?.password);

    if (findUserByEmail.get(email)) {
      throw new HttpError(409, "An account with this email already exists. Try signing in.", "email_taken");
    }

    const row: UserRow = {
      id: randomUUID(),
      email,
      name,
      password_hash: await hashPassword(password),
      created_at: Date.now(),
    };
    insertUser.run(row.id, row.email, row.name, row.password_hash, row.created_at);

    await startSession(req, res, row);
    res.status(201).json({ user: toUser(row) });
  })
);

authRouter.post(
  "/login",
  authLimiter,
  loginLimiter,
  asyncHandler(async (req, res) => {
    const email = readEmail(req.body?.email);
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    const row = findUserByEmail.get(email) as UserRow | undefined;
    if (!row) {
      await burnPasswordCheck(password);
      throw new HttpError(401, "Email or password is incorrect.", "invalid_credentials");
    }
    if (!(await verifyPassword(password, row.password_hash))) {
      throw new HttpError(401, "Email or password is incorrect.", "invalid_credentials");
    }

    await startSession(req, res, row);
    res.json({ user: toUser(row) });
  })
);

authRouter.post(
  "/refresh",
  authLimiter,
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (typeof token !== "string") {
      throw new HttpError(401, "Your session has ended. Please sign in again.", "no_session");
    }

    const result = rotateRefreshToken(token, req.get("user-agent") ?? "");
    const row = result.ok ? (findUserById.get(result.userId) as UserRow | undefined) : undefined;

    if (!result.ok || !row) {
      clearSessionCookies(res);
      throw new HttpError(401, "Your session has ended. Please sign in again.", "session_ended");
    }

    setSessionCookies(res, await signAccessToken(row), result.token);
    res.json({ user: toUser(row) });
  })
);

authRouter.post("/logout", (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (typeof token === "string") revokeRefreshToken(token);
  clearSessionCookies(res);
  res.status(204).end();
});

authRouter.post("/logout-all", requireAuth, (req, res) => {
  revokeAllRefreshTokens(currentUserId(req));
  clearSessionCookies(res);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, (req, res) => {
  const row = findUserById.get(currentUserId(req)) as UserRow | undefined;
  if (!row) {
    clearSessionCookies(res);
    throw new HttpError(401, "This account no longer exists.", "unauthenticated");
  }
  res.json({ user: toUser(row) });
});

authRouter.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const name = readString(req.body?.name, "Name", { max: 60 });
    const userId = currentUserId(req);
    updateUserName.run(name, userId);
    const row = findUserById.get(userId) as unknown as UserRow;

    // The name is a token claim, so issue a fresh access token.
    res.cookie(ACCESS_COOKIE, await signAccessToken(row), {
      ...baseCookie,
      sameSite: "lax",
      path: "/api",
      maxAge: config.accessTokenTtlSeconds * 1000,
    });
    res.json({ user: toUser(row) });
  })
);

authRouter.delete(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = findUserById.get(currentUserId(req)) as UserRow | undefined;
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      throw new HttpError(403, "Password is incorrect.", "invalid_credentials");
    }
    deleteUser.run(row.id);
    clearSessionCookies(res);
    res.status(204).end();
  })
);
