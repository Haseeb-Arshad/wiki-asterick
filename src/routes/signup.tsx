import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "../components/AuthPage";

export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: function SignUpRoute() {
    const { redirect } = Route.useSearch();
    return <AuthPage mode="signup" redirect={redirect} />;
  },
});
