import { queryOptions } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { AiNote, AiNoteSource } from "../../shared/types";
import { api } from "./api";
import { createPersistedStore } from "./store";

/*
 * Ask AI: one question at a time, asked from the bar at the bottom of the
 * screen. While it runs, the bar shows the steps (reading, searching,
 * thinking, writing); when it finishes the answer is saved as a note on the
 * page it was asked from, and those notes go back to the model as context
 * the next time the reader asks there.
 */

export type AnswerMode = "auto" | "quick" | "deep";
export type WebPreference = "auto" | "on" | "off";
export type AssistantSource = AiNoteSource;

/** The page the question is about. `null` means a general question. */
export interface AskContext {
  kind: "wiki" | "web";
  wiki: string;
  title: string;
  url?: string | null;
}

/** A passage the reader attached from the article. */
export interface AskQuote {
  text: string;
  prefix: string;
  suffix: string;
  sectionId: string;
}

export interface RunStep {
  id: string;
  label: string;
  detail?: string;
  state: "active" | "done" | "failed";
}

export interface AskRun {
  id: string;
  question: string;
  quote: AskQuote | null;
  context: AskContext | null;
  steps: RunStep[];
  sources: AssistantSource[];
  reasoning: string;
  answer: string;
  model: string;
  mode: "quick" | "deep";
  web: boolean;
  phase: "running" | "done" | "error";
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

interface AskState {
  context: AskContext | null;
  quote: AskQuote | null;
  followUp: AiNote | null;
  run: AskRun | null;
  /** Bumped to ask the bar to take focus. */
  focusTick: number;
  /** The notes drawer (narrow screens, and pages without a rail). */
  drawerOpen: boolean;
  /** The note to scroll to and open, wherever notes are shown. */
  activeNoteId: string | null;
  revealTick: number;
  /** Set by the reader while its left rail is on screen. */
  railAvailable: boolean;
  railTab: "contents" | "notes";
  /** Questions drawn from the open article, offered above the bar when it is focused. */
  suggestions: string[];
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

export const MODEL_LABELS: Record<string, string> = {
  "anthropic/claude-haiku-5.5": "Claude Haiku 5.5",
  "openai/gpt-6-luna": "GPT-6 Luna",
};

export const modelLabel = (model: string) => MODEL_LABELS[model] ?? model.split("/").pop() ?? model;

let state: AskState = {
  context: null,
  quote: null,
  followUp: null,
  run: null,
  focusTick: 0,
  drawerOpen: false,
  activeNoteId: null,
  revealTick: 0,
  railAvailable: false,
  railTab: "contents",
  suggestions: [],
};
const listeners = new Set<() => void>();
let controller: AbortController | null = null;

function setState(change: Partial<AskState> | ((current: AskState) => Partial<AskState>)) {
  state = { ...state, ...(typeof change === "function" ? change(state) : change) };
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useAsk(): AskState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function getAskState(): AskState {
  return state;
}

// ---- where notes live --------------------------------------------------------------

export function noteKey(context: AskContext | null): { wiki: string; title: string } {
  return context ? { wiki: context.wiki, title: context.title } : { wiki: "general", title: "" };
}

const sameContext = (a: AskContext | null, b: AskContext | null) =>
  a === b || (a !== null && b !== null && a.wiki === b.wiki && a.title === b.title && (a.url ?? null) === (b.url ?? null));

export function setSuggestions(suggestions: string[]) {
  if (suggestions.length === state.suggestions.length && suggestions.every((item, index) => item === state.suggestions[index])) return;
  setState({ suggestions });
}

export function setAssistantContext(context: AskContext | null) {
  if (sameContext(context, state.context)) return;
  setState((current) => ({
    context,
    quote: null,
    followUp: null,
    railTab: "contents",
    activeNoteId: null,
    // A finished answer belongs to the page it was asked on.
    run: current.run?.phase === "running" ? current.run : null,
  }));
}

/**
 * The bar is rendered once for the whole app and has the reader's library;
 * it hands over how to save notes and which notes belong to a page.
 */
interface AskHost {
  saveNote: (note: AiNote) => void;
  notesFor: (context: AskContext | null) => AiNote[];
}
let host: AskHost | null = null;

export function registerAskHost(next: AskHost | null) {
  host = next;
}

// ---- bar controls -------------------------------------------------------------------

export function focusAskBar() {
  setState((current) => ({ focusTick: current.focusTick + 1 }));
}

export function attachQuote(quote: AskQuote) {
  setState({ quote, followUp: null });
  focusAskBar();
}

export function clearQuote() {
  setState({ quote: null });
}

export function followUpOn(note: AiNote) {
  setState({ followUp: note, quote: note.quote ? { text: note.quote, prefix: note.quotePrefix, suffix: note.quoteSuffix, sectionId: note.sectionId } : null });
  focusAskBar();
}

export function clearFollowUp() {
  setState({ followUp: null, quote: null });
}

// ---- showing notes --------------------------------------------------------------------

export function setRailAvailable(available: boolean) {
  if (state.railAvailable !== available) setState({ railAvailable: available });
}

export function setRailTab(railTab: AskState["railTab"]) {
  setState({ railTab });
}

/** Shows a page's notes: in the reader's rail when it's on screen, otherwise in the drawer. */
export function revealNotes(noteId: string | null = null) {
  setState((current) =>
    current.railAvailable
      ? { railTab: "notes", activeNoteId: noteId, revealTick: current.revealTick + 1 }
      : { drawerOpen: true, activeNoteId: noteId, revealTick: current.revealTick + 1 }
  );
}

export function openNotesDrawer(noteId: string | null = null) {
  setState((current) => ({ drawerOpen: true, activeNoteId: noteId, revealTick: current.revealTick + 1 }));
}

export function closeNotesDrawer() {
  setState({ drawerOpen: false });
}

export function toggleNotes() {
  if (state.drawerOpen) closeNotesDrawer();
  else if (state.railAvailable && state.railTab === "notes") setRailTab("contents");
  else revealNotes();
}

// ---- asking ---------------------------------------------------------------------------

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const stripCitations = (text: string) => text.replace(/\s*\[\d+\]/g, "");

function updateRun(id: string, change: (run: AskRun) => Partial<AskRun>) {
  setState((current) => (current.run?.id === id ? { run: { ...current.run, ...change(current.run) } } : {}));
}

/** Starts a step, finishing the one before it. A repeated id updates that step instead. */
function advance(steps: RunStep[], next: Omit<RunStep, "state"> & { state?: RunStep["state"] }): RunStep[] {
  const existing = steps.findIndex((step) => step.id === next.id);
  if (existing !== -1) return steps.map((step, index) => (index === existing ? { ...step, ...next, state: next.state ?? step.state } : step));
  return [...steps.map((step) => (step.state === "active" ? { ...step, state: "done" as const } : step)), { ...next, state: next.state ?? "active" }];
}

/** GPT-style reasoning summaries start each thought with a bold title; show the latest one. */
export function reasoningHeadline(reasoning: string): string {
  const titles = [...reasoning.matchAll(/\*\*([^*\n]{3,90})\*\*/g)];
  return titles.length ? titles[titles.length - 1][1].trim() : "";
}

interface StreamEvent {
  type: "meta" | "step" | "sources" | "reasoning" | "delta" | "usage" | "done" | "error";
  [key: string]: unknown;
}

export async function ask(question: string) {
  const trimmed = question.trim().slice(0, 2000);
  if (!trimmed || state.run?.phase === "running") return;

  const { context, quote, followUp } = state;
  const pageNotes = host?.notesFor(context) ?? [];
  // Earlier questions on this page, oldest first; a follow-up goes in as the conversation itself.
  const priorNotes = pageNotes
    .filter((note) => note.id !== followUp?.id)
    .slice(0, 5)
    .reverse()
    .map((note) => ({ question: note.question, quote: note.quote, answer: note.answer }));
  const messages = [
    ...(followUp
      ? [
          { role: "user", content: followUp.question },
          { role: "assistant", content: stripCitations(followUp.answer).slice(0, 6000) },
        ]
      : []),
    { role: "user", content: trimmed },
  ];

  const run: AskRun = {
    id: newId(),
    question: trimmed,
    quote,
    context,
    steps: [{ id: "start", label: "Understanding the question", state: "active" }],
    sources: [],
    reasoning: "",
    answer: "",
    model: "",
    mode: "quick",
    web: false,
    phase: "running",
    startedAt: Date.now(),
  };
  setState({ run, quote: null, followUp: null });

  controller?.abort();
  const abort = new AbortController();
  controller = abort;

  // Text arrives in many small pieces; repaint at most once per frame.
  let pendingText = "";
  let pendingReasoning = "";
  let frame = 0;
  const flush = () => {
    frame = 0;
    if (!pendingText && !pendingReasoning) return;
    const text = pendingText;
    const reasoning = pendingReasoning;
    pendingText = "";
    pendingReasoning = "";
    updateRun(run.id, (current) => {
      let steps = current.steps;
      if (reasoning) {
        const headline = reasoningHeadline(current.reasoning + reasoning);
        if (headline) steps = advance(steps, { id: "think", label: "Thinking", detail: headline });
      }
      // The first words of the answer end the thinking.
      if (text && !current.answer) steps = advance(steps, { id: "write", label: "Writing the answer" });
      return { answer: current.answer + text, reasoning: current.reasoning + reasoning, steps };
    });
  };
  const schedule = () => {
    frame ||= requestAnimationFrame(flush);
  };

  try {
    const response = await fetch("/api/ai/ask", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-wa-request": "1" },
      signal: abort.signal,
      body: JSON.stringify({
        messages,
        notes: priorNotes,
        context: context ? (context.kind === "web" ? { kind: "web", url: context.url } : { kind: "wiki", wiki: context.wiki, title: context.title }) : null,
        selection: quote?.text || undefined,
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
            updateRun(run.id, () => ({ model: String(event.model), mode: event.mode === "deep" ? "deep" : "quick", web: Boolean(event.web) }));
            break;
          case "step":
            updateRun(run.id, (current) => ({
              steps: advance(current.steps, {
                id: String(event.id),
                label: String(event.label),
                detail: typeof event.detail === "string" ? event.detail : undefined,
                state: event.state === "failed" ? "failed" : undefined,
              }),
            }));
            break;
          case "sources":
            updateRun(run.id, () => ({ sources: event.sources as AssistantSource[] }));
            break;
          case "reasoning":
            pendingReasoning += String(event.text);
            schedule();
            break;
          case "delta":
            pendingText += String(event.text);
            schedule();
            break;
          case "error":
            throw new Error(String(event.message));
        }
      }
    }
    cancelAnimationFrame(frame);
    flush();
    finish(run.id);
  } catch (error) {
    cancelAnimationFrame(frame);
    flush();
    const aborted = (error as Error).name === "AbortError";
    if (aborted && state.run?.id === run.id && state.run.answer.trim()) {
      // Keep what was written before Stop.
      finish(run.id);
    } else {
      updateRun(run.id, (current) => ({
        phase: "error",
        finishedAt: Date.now(),
        error: aborted ? "Stopped." : (error as Error).message,
        steps: current.steps.map((step) => (step.state === "active" ? { ...step, state: "failed" } : step)),
      }));
    }
  } finally {
    if (controller === abort) controller = null;
  }
}

function finish(id: string) {
  const current = state.run;
  if (!current || current.id !== id) return;
  if (!current.answer.trim()) {
    updateRun(id, () => ({ phase: "error", finishedAt: Date.now(), error: "No answer came back. Please try again." }));
    return;
  }

  const { wiki, title } = noteKey(current.context);
  const note: AiNote = {
    id: current.id,
    wiki,
    articleTitle: title,
    url: current.context?.url ?? null,
    question: current.question,
    quote: current.quote?.text ?? "",
    quotePrefix: current.quote?.prefix ?? "",
    quoteSuffix: current.quote?.suffix ?? "",
    sectionId: current.quote?.sectionId ?? "",
    answer: current.answer.trim(),
    sources: current.sources,
    model: current.model,
    mode: current.mode,
    web: current.web,
    createdAt: Date.now(),
  };
  host?.saveNote(note);
  updateRun(id, (run) => ({ phase: "done", finishedAt: Date.now(), steps: run.steps.map((step) => (step.state === "active" ? { ...step, state: "done" } : step)) }));
}

export function stopAsk() {
  controller?.abort();
}

/** Clears the finished (or failed) run from the bar. */
export function dismissRun() {
  if (state.run?.phase !== "running") setState({ run: null });
}

export function retryRun() {
  const run = state.run;
  if (!run || run.phase !== "error") return;
  setState({ run: null, quote: run.quote });
  void ask(run.question);
}
