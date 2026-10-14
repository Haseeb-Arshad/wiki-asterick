import { queryOptions } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { api } from "./api";
import { createPersistedStore } from "./store";

export type AnswerMode = "auto" | "quick" | "deep";
export type WebPreference = "auto" | "on" | "off";

export interface AssistantSource {
  n: number;
  kind: "article" | "web";
  title: string;
  url: string;
  site: string;
  date: string | null;
  favicon: string | null;
}

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  selection?: string;
  sources?: AssistantSource[];
  status?: string;
  reasoning?: string;
  model?: string;
  mode?: "quick" | "deep";
  web?: boolean;
  streaming?: boolean;
  error?: string;
}

/** What the assistant is "looking at": the open article, or nothing (general questions). */
export type AssistantContext = { kind: "wiki"; wiki: string; title: string } | { kind: "web"; url: string; title: string };

interface State {
  open: boolean;
  context: AssistantContext | null;
  threads: Record<string, AssistantMessage[]>;
  busy: boolean;
  /** A passage the reader attached from the article. */
  selection: string;
}

export const answerModeStore = createPersistedStore<AnswerMode>("wa-ai-mode", "auto", (raw) =>
  raw === "quick" || raw === "deep" ? raw : "auto"
);
export const webPreferenceStore = createPersistedStore<WebPreference>("wa-ai-web", "auto", (raw) =>
  raw === "on" || raw === "off" ? raw : "auto"
);

export const aiStatusQuery = queryOptions({
  queryKey: ["ai-status"],
  queryFn: () => api<{ enabled: boolean; webSearch: boolean }>("/api/ai/status"),
  staleTime: Infinity,
});

let state: State = { open: false, context: null, threads: {}, busy: false, selection: "" };
const listeners = new Set<() => void>();
let controller: AbortController | null = null;

function setState(change: Partial<State> | ((current: State) => Partial<State>)) {
  state = { ...state, ...(typeof change === "function" ? change(state) : change) };
  listeners.forEach((listener) => listener());
  document.body.classList.toggle("assistant-open", state.open);
}

export function useAssistant(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state
  );
}

export function contextKey(context: AssistantContext | null): string {
  if (!context) return "general";
  return context.kind === "wiki" ? `wiki:${context.wiki}:${context.title}` : `web:${context.url}`;
}

export function threadFor(current: State): AssistantMessage[] {
  return current.threads[contextKey(current.context)] ?? [];
}

export function setAssistantContext(context: AssistantContext | null) {
  if (contextKey(context) === contextKey(state.context)) return;
  setState({ context, selection: "" });
}

export function openAssistant(options: { question?: string; selection?: string } = {}) {
  setState({ open: true, selection: options.selection ?? state.selection });
  if (options.question) void askAssistant(options.question);
}

export function closeAssistant() {
  setState({ open: false });
}

export function toggleAssistant() {
  setState({ open: !state.open });
}

export function setAttachedSelection(selection: string) {
  setState({ selection });
}

export function clearThread() {
  stopAssistant();
  setState((current) => ({ threads: { ...current.threads, [contextKey(current.context)]: [] }, selection: "" }));
}

export function stopAssistant() {
  controller?.abort();
  controller = null;
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

function updateMessage(key: string, id: string, change: (message: AssistantMessage) => AssistantMessage) {
  setState((current) => ({
    threads: { ...current.threads, [key]: (current.threads[key] ?? []).map((message) => (message.id === id ? change(message) : message)) },
  }));
}

interface StreamEvent {
  type: "meta" | "status" | "sources" | "reasoning" | "delta" | "usage" | "done" | "error";
  [key: string]: unknown;
}

export async function askAssistant(question: string) {
  const trimmed = question.trim();
  if (!trimmed || state.busy) return;

  const key = contextKey(state.context);
  const context = state.context;
  const selection = state.selection;
  const history = (state.threads[key] ?? [])
    .filter((message) => message.content && !message.error)
    .map((message) => ({ role: message.role, content: message.content }));

  const userMessage: AssistantMessage = { id: newId(), role: "user", content: trimmed, selection: selection || undefined };
  const answer: AssistantMessage = { id: newId(), role: "assistant", content: "", streaming: true, status: "Starting" };
  setState((current) => ({
    busy: true,
    selection: "",
    threads: { ...current.threads, [key]: [...(current.threads[key] ?? []), userMessage, answer] },
  }));

  controller = new AbortController();
  // Text arrives in many small pieces; repaint at most once per frame.
  let pending = "";
  let frame = 0;
  const flush = () => {
    frame = 0;
    if (!pending) return;
    const chunk = pending;
    pending = "";
    updateMessage(key, answer.id, (message) => ({ ...message, content: message.content + chunk, status: undefined }));
  };

  try {
    const response = await fetch("/api/ai/ask", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-wa-request": "1" },
      signal: controller.signal,
      body: JSON.stringify({
        messages: [...history, { role: "user", content: trimmed }],
        context: context ? (context.kind === "wiki" ? { kind: "wiki", wiki: context.wiki, title: context.title } : { kind: "web", url: context.url }) : null,
        selection: selection || undefined,
        mode: answerModeStore.get(),
        web: webPreferenceStore.get(),
      }),
    });

    if (!response.ok || !response.body) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? "Couldn't get an answer. Please try again.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const event = JSON.parse(line) as StreamEvent;
        switch (event.type) {
          case "meta":
            updateMessage(key, answer.id, (message) => ({ ...message, model: String(event.model), mode: event.mode as "quick" | "deep", web: Boolean(event.web) }));
            break;
          case "status":
            updateMessage(key, answer.id, (message) => ({ ...message, status: String(event.text) }));
            break;
          case "sources":
            updateMessage(key, answer.id, (message) => ({ ...message, sources: event.sources as AssistantSource[] }));
            break;
          case "reasoning":
            updateMessage(key, answer.id, (message) => ({ ...message, reasoning: (message.reasoning ?? "") + String(event.text) }));
            break;
          case "delta":
            pending += String(event.text);
            frame ||= requestAnimationFrame(flush);
            break;
          case "error":
            throw new Error(String(event.message));
        }
      }
    }
    cancelAnimationFrame(frame);
    flush();
    updateMessage(key, answer.id, (message) => ({
      ...message,
      streaming: false,
      status: undefined,
      error: message.content ? undefined : "No answer came back. Please try again.",
    }));
  } catch (error) {
    cancelAnimationFrame(frame);
    flush();
    const aborted = (error as Error).name === "AbortError";
    updateMessage(key, answer.id, (message) => ({
      ...message,
      streaming: false,
      status: undefined,
      error: aborted ? (message.content ? undefined : "Stopped.") : (error as Error).message,
    }));
  } finally {
    controller = null;
    setState({ busy: false });
  }
}

/** Retry the last question in the current thread. */
export function retryLast() {
  const thread = threadFor(state);
  const lastQuestion = [...thread].reverse().find((message) => message.role === "user");
  if (!lastQuestion) return;
  const key = contextKey(state.context);
  // Drop the failed exchange and ask again.
  const index = thread.lastIndexOf(lastQuestion);
  setState((current) => ({ threads: { ...current.threads, [key]: thread.slice(0, index) }, selection: lastQuestion.selection ?? "" }));
  void askAssistant(lastQuestion.content);
}

export const MODEL_LABELS: Record<string, string> = {
  "anthropic/claude-haiku-5.5": "Claude Haiku 5.5",
  "openai/gpt-6-luna": "GPT-6 Luna",
};
