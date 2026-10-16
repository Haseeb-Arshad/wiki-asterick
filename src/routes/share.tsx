import { createFileRoute, redirect } from "@tanstack/react-router";
import { extractLink } from "../../shared/wiki";

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * Where the installed app receives links shared from other apps (Android's Share menu).
 * Apps send a title, some text and/or a url; the first address found opens in the reader.
 */
export const Route = createFileRoute("/share")({
  validateSearch: (search: Record<string, unknown>) => ({ url: text(search.url), text: text(search.text), title: text(search.title) }),
  beforeLoad: ({ search }) => {
    const link = extractLink(search.url) ?? extractLink(search.text) ?? extractLink(search.title);
    // /web reads wiki links in the wiki reader, and explains itself when there is no link.
    throw redirect({ to: "/web", search: { url: link ?? "" }, replace: true });
  },
});
