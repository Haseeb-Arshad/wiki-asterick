import type { ApiError as ApiErrorBody } from "../../shared/types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type SessionListener = () => void;
const sessionEndedListeners = new Set<SessionListener>();

/** Called when the refresh token is rejected, so the UI can drop the user. */
export function onSessionEnded(listener: SessionListener): () => void {
  sessionEndedListeners.add(listener);
  return () => sessionEndedListeners.delete(listener);
}

// Every caller that hits a 401 at the same moment shares one refresh request.
let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshInFlight ??= fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "x-wa-request": "1" },
    credentials: "same-origin",
  })
    .then((response) => {
      if (!response.ok) sessionEndedListeners.forEach((listener) => listener());
      return response.ok;
    })
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, { method = "GET", body, signal }: RequestOptions = {}): Promise<T> {
  const send = () =>
    fetch(path, {
      method,
      signal,
      credentials: "same-origin",
      headers: {
        "x-wa-request": "1",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let response: Response;
  try {
    response = await send();
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "You appear to be offline. Check your connection and try again.", "offline");
  }

  // Access tokens live 15 minutes. On expiry, refresh once and replay the request.
  if (response.status === 401 && !path.startsWith("/api/auth/refresh")) {
    const payload = (await response.clone().json().catch(() => null)) as ApiErrorBody | null;
    if (payload?.code === "unauthenticated" && (await refreshSession())) {
      response = await send();
    }
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload as ApiErrorBody | null;
    throw new ApiError(response.status, error?.error ?? "Something went wrong. Please try again.", error?.code);
  }
  return payload as T;
}

/** The server sets a readable `wa_s` cookie alongside the httpOnly session cookies. */
export function hasSessionHint(): boolean {
  return typeof document !== "undefined" && /(?:^|;\s*)wa_s=1/.test(document.cookie);
}
