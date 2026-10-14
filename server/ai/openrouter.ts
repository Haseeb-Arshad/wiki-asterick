import { config } from "../config.js";
import { HttpError } from "../http.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "usage"; promptTokens: number; completionTokens: number; cost: number | null };

/**
 * Streams a chat completion from OpenRouter (OpenAI-compatible API), yielding
 * answer text and, for reasoning models, short summaries of their thinking.
 */
export async function* streamChat(options: {
  model: string;
  messages: ChatMessage[];
  reasoningEffort?: "low" | "medium" | "high";
  maxTokens?: number;
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  if (!config.openRouterApiKey) throw new HttpError(503, "AI answers aren't set up on this server yet.", "ai_missing");

  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": config.appUrl,
        "X-Title": "WikiAsterisk",
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: true,
        max_tokens: options.maxTokens ?? 1600,
        ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}),
        usage: { include: true },
      }),
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    throw new HttpError(502, "Couldn't reach the AI service.", "ai_unreachable");
  }

  if (!response.ok || !response.body) {
    const detail = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    console.error("[ai] OpenRouter error", response.status, detail?.error?.message);
    if (response.status === 402) throw new HttpError(503, "The AI account is out of credit.", "ai_credit");
    if (response.status === 429) throw new HttpError(503, "The AI service is busy. Try again in a moment.", "ai_busy");
    throw new HttpError(502, "The AI service returned an error.", "ai_error");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      // Lines starting with ":" are keep-alive comments ("OPENROUTER PROCESSING").
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;

      let json: {
        error?: { message?: string };
        choices?: { delta?: { content?: string | null; reasoning?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      };
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }

      if (json.error) throw new HttpError(502, "The AI service stopped unexpectedly.", "ai_error");
      const delta = json.choices?.[0]?.delta;
      if (delta?.reasoning) yield { type: "reasoning", text: delta.reasoning };
      if (delta?.content) yield { type: "text", text: delta.content };
      if (json.usage) {
        yield {
          type: "usage",
          promptTokens: json.usage.prompt_tokens ?? 0,
          completionTokens: json.usage.completion_tokens ?? 0,
          cost: json.usage.cost ?? null,
        };
      }
    }
  }
}
