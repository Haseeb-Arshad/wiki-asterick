import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import type {
  ArticleRef,
  Bookmark,
  Highlight,
  HighlightColor,
  HistoryEntry,
  LibrarySnapshot,
  User,
} from "../../shared/types";
import { api } from "./api";
import { createPersistedStore } from "./store";
import { toast } from "./toast";

const EMPTY: LibrarySnapshot = { bookmarks: [], highlights: [], history: [] };
const GUEST_HISTORY_LIMIT = 100;

// ---- guest storage (this browser only) -------------------------------------

interface LegacyHighlight {
  id: string;
  articleTitle: string;
  text: string;
  sectionId: string;
  sectionTitle: string;
  createdAt: number;
}

/** Brings highlights saved by the previous version of the app into the new format. */
function migrateLegacyHighlights(): Highlight[] {
  try {
    const raw = localStorage.getItem("wiki-asterisk-highlights");
    if (!raw) return [];
    localStorage.removeItem("wiki-asterisk-highlights");
    return (JSON.parse(raw) as LegacyHighlight[]).map((item) => ({
      id: item.id.replace(/[^\w-]/g, "-").padEnd(8, "0"),
      wiki: "en.wikipedia.org",
      articleTitle: item.articleTitle,
      sectionId: item.sectionId,
      sectionTitle: item.sectionTitle,
      text: item.text,
      prefix: "",
      suffix: "",
      note: "",
      color: "yellow",
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
    }));
  } catch {
    return [];
  }
}

const guestLibrary = createPersistedStore<LibrarySnapshot>("wa-library", EMPTY, (raw) => {
  const value = (raw ?? {}) as Partial<LibrarySnapshot>;
  return {
    bookmarks: Array.isArray(value.bookmarks) ? value.bookmarks : [],
    highlights: Array.isArray(value.highlights) ? value.highlights : [],
    history: Array.isArray(value.history) ? value.history : [],
  };
});

const legacy = typeof window !== "undefined" ? migrateLegacyHighlights() : [];
if (legacy.length) guestLibrary.set((library) => ({ ...library, highlights: [...legacy, ...library.highlights] }));

// ---- server storage ---------------------------------------------------------

export const libraryQuery = (userId: string) =>
  queryOptions({
    queryKey: ["library", userId],
    queryFn: () => api<LibrarySnapshot>("/api/library"),
    staleTime: 60_000,
  });

let importInFlight: Promise<number> | null = null;

/** After sign-in, move what the guest saved in this browser into the account. */
export function importGuestLibrary(queryClient: QueryClient, userId: string): Promise<number> {
  importInFlight ??= (async () => {
    const guest = guestLibrary.get();
    const count = guest.bookmarks.length + guest.highlights.length + guest.history.length;
    if (count === 0) {
      await queryClient.prefetchQuery(libraryQuery(userId));
      return 0;
    }

    const merged = await api<LibrarySnapshot>("/api/library/import", { method: "POST", body: guest });
    queryClient.setQueryData(libraryQuery(userId).queryKey, merged);
    // Keep anything saved locally while the request was in flight.
    guestLibrary.set((current) => ({
      bookmarks: current.bookmarks.filter((item) => !guest.bookmarks.includes(item)),
      highlights: current.highlights.filter((item) => !guest.highlights.includes(item)),
      history: current.history.filter((item) => !guest.history.includes(item)),
    }));
    return guest.bookmarks.length + guest.highlights.length;
  })().finally(() => {
    importInFlight = null;
  });
  return importInFlight;
}

/**
 * Anything written to this browser's guest storage while signed in (for
 * example in the moment before the session check finishes) is merged into the
 * account automatically.
 */
export function useGuestLibrarySync(user: User | null) {
  const queryClient = useQueryClient();
  const guest = guestLibrary.use();
  const pending = guest.bookmarks.length + guest.highlights.length + guest.history.length > 0;

  useEffect(() => {
    if (!user || !pending) return;
    importGuestLibrary(queryClient, user.id).catch(() => undefined);
  }, [user, pending, queryClient]);
}

// ---- unified hook -----------------------------------------------------------

const sameArticle = (a: { wiki: string; title: string }, wiki: string, title: string) => a.wiki === wiki && a.title === title;

export interface NewHighlight {
  wiki: string;
  articleTitle: string;
  sectionId: string;
  sectionTitle: string;
  text: string;
  prefix: string;
  suffix: string;
  color: HighlightColor;
  note?: string;
}

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `hl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * One API for the reader's library. Guests write to localStorage; signed-in
 * readers write to the server with optimistic updates.
 */
export function useLibrary(user: User | null) {
  const queryClient = useQueryClient();
  const guest = guestLibrary.use();
  const remote = useQuery({ ...libraryQuery(user?.id ?? ""), enabled: Boolean(user) });
  const snapshot = user ? (remote.data ?? EMPTY) : guest;

  const update = useCallback(
    (change: (library: LibrarySnapshot) => LibrarySnapshot, request?: () => Promise<unknown>) => {
      if (!user) {
        guestLibrary.set(change);
        return;
      }
      const key = libraryQuery(user.id).queryKey;
      const previous = queryClient.getQueryData<LibrarySnapshot>(key) ?? EMPTY;
      queryClient.setQueryData(key, change(previous));
      request?.().catch((error: Error) => {
        queryClient.setQueryData(key, previous);
        toast(error.message || "Couldn't save that change.", { tone: "error" });
      });
    },
    [queryClient, user]
  );

  const isBookmarked = useCallback(
    (wiki: string, title: string) => snapshot.bookmarks.some((item) => sameArticle(item, wiki, title)),
    [snapshot.bookmarks]
  );

  /** Explicit save/unsave; safe to call later (e.g. from an Undo toast). */
  const setBookmark = useCallback(
    (ref: ArticleRef, save: boolean) => {
      const { wiki, title, description, thumbnail } = ref;
      if (!save) {
        update(
          (library) => ({ ...library, bookmarks: library.bookmarks.filter((item) => !sameArticle(item, wiki, title)) }),
          () => api(`/api/library/bookmarks?${new URLSearchParams({ wiki, title })}`, { method: "DELETE" })
        );
        return;
      }
      const bookmark: Bookmark = { wiki, title, description, thumbnail, createdAt: Date.now() };
      update(
        (library) => ({
          ...library,
          bookmarks: [bookmark, ...library.bookmarks.filter((item) => !sameArticle(item, wiki, title))],
        }),
        () => api("/api/library/bookmarks", { method: "PUT", body: { wiki, title, description, thumbnail } })
      );
    },
    [update]
  );

  const toggleBookmark = useCallback(
    (ref: ArticleRef): boolean => {
      const saved = snapshot.bookmarks.some((item) => sameArticle(item, ref.wiki, ref.title));
      setBookmark(ref, !saved);
      return !saved;
    },
    [snapshot.bookmarks, setBookmark]
  );

  const recordVisit = useCallback(
    (ref: ArticleRef, progress: number, sectionId: string | null, { sync = true } = {}) => {
      const entry: HistoryEntry = { ...ref, progress, sectionId, readAt: Date.now() };
      update(
        (library) => ({
          ...library,
          history: [entry, ...library.history.filter((item) => !sameArticle(item, ref.wiki, ref.title))].slice(0, GUEST_HISTORY_LIMIT),
        }),
        sync ? () => api("/api/library/history", { method: "PUT", body: { ...ref, progress, sectionId } }) : undefined
      );
    },
    [update]
  );

  const removeHistory = useCallback(
    (wiki: string, title: string) => {
      update(
        (library) => ({ ...library, history: library.history.filter((item) => !sameArticle(item, wiki, title)) }),
        () => api(`/api/library/history?${new URLSearchParams({ wiki, title })}`, { method: "DELETE" })
      );
    },
    [update]
  );

  const clearHistory = useCallback(() => {
    update((library) => ({ ...library, history: [] }), () => api("/api/library/history", { method: "DELETE" }));
  }, [update]);

  const addHighlight = useCallback(
    (input: NewHighlight): Highlight => {
      const now = Date.now();
      const highlight: Highlight = { id: makeId(), note: "", ...input, createdAt: now, updatedAt: now };
      update(
        (library) => ({ ...library, highlights: [highlight, ...library.highlights] }),
        () => api("/api/library/highlights", { method: "POST", body: highlight })
      );
      return highlight;
    },
    [update]
  );

  const updateHighlight = useCallback(
    (id: string, patch: { note?: string; color?: HighlightColor }) => {
      update(
        (library) => ({
          ...library,
          highlights: library.highlights.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item)),
        }),
        () => api(`/api/library/highlights/${encodeURIComponent(id)}`, { method: "PATCH", body: patch })
      );
    },
    [update]
  );

  const removeHighlight = useCallback(
    (id: string) => {
      update(
        (library) => ({ ...library, highlights: library.highlights.filter((item) => item.id !== id) }),
        () => api(`/api/library/highlights/${encodeURIComponent(id)}`, { method: "DELETE" })
      );
    },
    [update]
  );

  return useMemo(
    () => ({
      snapshot,
      isLoading: Boolean(user) && remote.isPending,
      isBookmarked,
      setBookmark,
      toggleBookmark,
      recordVisit,
      removeHistory,
      clearHistory,
      addHighlight,
      updateHighlight,
      removeHighlight,
    }),
    [snapshot, user, remote.isPending, isBookmarked, setBookmark, toggleBookmark, recordVisit, removeHistory, clearHistory, addHighlight, updateHighlight, removeHighlight]
  );
}

export type Library = ReturnType<typeof useLibrary>;

export function highlightsFor(snapshot: LibrarySnapshot, wiki: string, title: string): Highlight[] {
  return snapshot.highlights.filter((item) => item.wiki === wiki && item.articleTitle === title);
}
