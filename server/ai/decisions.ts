import { config } from "../config.js";

/*
 * A decision model reads some text (the "state") and answers fixed questions about it with
 * calibrated probabilities. It writes no text, answers in well under a second and costs about
 * $0.04 per million input tokens, so the app can afford to ask it small questions everywhere:
 * how to route a question, whether an answer matches its sources, which blocks of a web page
 * are clutter. Every caller treats a failure as "no opinion" and falls back to simple rules.
 */

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  /** Ordered, lowest first; the answer's score is a position on this list. */
  criteria: string[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer {
  type: "noul";
  /** Probability that the answer is "true". */
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface ScoreAnswer {
  type: "score";
  /** Probability-weighted position on the criteria list (0 = first). */
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
}

export type AnswerFor<Q extends Question> = Q extends NoulQuestion ? NoulAnswer : Q extends ChoiceQuestion ? ChoiceAnswer : ScoreAnswer;
export type Answers<Q extends Record<string, Question>> = { [K in keyof Q]: AnswerFor<Q[K]> };

export interface DecideOptions {
  /** Give up after this long; callers fall back to rules. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Ask the decision model. Rejects on any failure; callers decide what "no opinion" means. */
export type Decide = <Q extends Record<string, Question>>(task: string, state: string, questions: Q, options?: DecideOptions) => Promise<Answers<Q>>;

/** True when there is a key and the decision model hasn't been switched off. */
export function decisionsEnabled(): boolean {
  return Boolean(config.openRouterApiKey) && config.decisionModel !== "off" && config.decisionModel !== "";
}

// The model reads at most 32,768 tokens (state and questions together). Keep the state well under.
const MAX_STATE_CHARS = 60_000;

export const decide: Decide = async (task, state, questions, { timeoutMs = 2500, signal } = {}) => {
  if (!decisionsEnabled()) throw new Error("Decisions are turned off.");
  const started = performance.now();
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": config.appUrl,
      "X-Title": "WikiAsterisk",
    },
    body: JSON.stringify({ model: config.decisionModel, state: state.slice(0, MAX_STATE_CHARS), questions }),
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
  });
  const body = (await response.json().catch(() => null)) as {
    answers?: Record<string, { type?: string }>;
    usage?: { input_tokens?: number; cost?: number };
    error?: { message?: string };
  } | null;
  if (!response.ok || !body?.answers) {
    throw new Error(`Decision "${task}" failed: ${response.status} ${body?.error?.message ?? ""}`.trim());
  }
  for (const [name, question] of Object.entries(questions)) {
    if (body.answers[name]?.type !== question.type) throw new Error(`Decision "${task}" returned no ${question.type} answer for "${name}".`);
  }
  const ms = Math.round(performance.now() - started);
  console.log(`[decide] ${task}: ${ms} ms, ${body.usage?.input_tokens ?? "?"} tokens, $${(body.usage?.cost ?? 0).toFixed(7)}`);
  return body.answers as Answers<typeof questions>;
};

/**
 * One yes/no question asked about each of many short items, in a single request: the items are
 * numbered in the state and each gets its own question. Measured as accurate as one request per
 * item, at a fraction of the round trips. Returns the probability of "true" for each item, in order.
 */
export async function decideEach(
  task: string,
  intro: string,
  items: string[],
  question: { instructions: (n: number) => string; criteria: { true: string; false: string } },
  { decide: ask = decide, ...options }: DecideOptions & { decide?: Decide } = {}
): Promise<number[]> {
  if (!items.length) return [];
  const CHUNK = 20;
  const chunks: string[][] = [];
  for (let start = 0; start < items.length; start += CHUNK) chunks.push(items.slice(start, start + CHUNK));
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const state = [intro, ...chunk.map((item, index) => `[${index + 1}] ${item}`)].join("\n");
      const questions: Record<string, NoulQuestion> = {};
      chunk.forEach((_, index) => {
        questions[`item_${index + 1}`] = { type: "noul", instructions: question.instructions(index + 1), criteria: question.criteria };
      });
      const answers = await ask(task, state, questions, options);
      return chunk.map((_, index) => answers[`item_${index + 1}`].noul);
    })
  );
  return results.flat();
}
