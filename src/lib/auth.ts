import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { User } from "../../shared/types";
import { ApiError, api, hasSessionHint } from "./api";
import { importGuestLibrary } from "./library";

async function fetchSession(): Promise<User | null> {
  // No hint cookie means no session; skip the /me → /refresh round trip.
  if (!hasSessionHint()) return null;
  try {
    const { user } = await api<{ user: User }>("/api/auth/me");
    return user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: fetchSession,
  staleTime: Infinity,
  retry: false,
});

export function useSession() {
  const query = useQuery(sessionQuery);
  return { user: query.data ?? null, isLoading: query.isPending };
}

export function useAuthActions() {
  const queryClient = useQueryClient();

  const finishSignIn = useCallback(
    async (user: User) => {
      queryClient.setQueryData(sessionQuery.queryKey, user);
      return importGuestLibrary(queryClient, user.id);
    },
    [queryClient]
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { user } = await api<{ user: User }>("/api/auth/login", { method: "POST", body: { email, password } });
      return { user, imported: await finishSignIn(user) };
    },
    [finishSignIn]
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      const { user } = await api<{ user: User }>("/api/auth/register", { method: "POST", body: { name, email, password } });
      return { user, imported: await finishSignIn(user) };
    },
    [finishSignIn]
  );

  const clearSession = useCallback(() => {
    queryClient.setQueryData(sessionQuery.queryKey, null);
    queryClient.removeQueries({ queryKey: ["library"] });
  }, [queryClient]);

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    clearSession();
  }, [clearSession]);

  const signOutEverywhere = useCallback(async () => {
    await api("/api/auth/logout-all", { method: "POST" });
    clearSession();
  }, [clearSession]);

  const updateName = useCallback(
    async (name: string) => {
      const { user } = await api<{ user: User }>("/api/auth/me", { method: "PATCH", body: { name } });
      queryClient.setQueryData(sessionQuery.queryKey, user);
      return user;
    },
    [queryClient]
  );

  const deleteAccount = useCallback(
    async (password: string) => {
      await api("/api/auth/me", { method: "DELETE", body: { password } });
      clearSession();
    },
    [clearSession]
  );

  return { signIn, signUp, signOut, signOutEverywhere, updateName, deleteAccount, clearSession };
}
