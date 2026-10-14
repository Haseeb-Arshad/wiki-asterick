import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  MODEL_LABELS,
  aiStatusQuery,
  answerModeStore,
  askAssistant,
  clearThread,
  closeAssistant,
  retryLast,
  setAttachedSelection,
  stopAssistant,
  threadFor,
  useAssistant,
  webPreferenceStore,
  type AnswerMode,
  type AssistantMessage,
  type AssistantSource,
  type WebPreference,
} from "../lib/assistant";
import { formatDate } from "../lib/format";
import { toast } from "../lib/toast";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";

const MODES: { value: AnswerMode; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Picks Fast or Deep for each question" },
  { value: "quick", label: "Fast", hint: "Claude Haiku 5.5: quick answers" },
  { value: "deep", label: "Deep", hint: "GPT-6 Luna with high reasoning: slower, more thorough" },
];

const WEB_LABEL: Record<WebPreference, string> = { auto: "Web: auto", on: "Web: on", off: "Web: off" };
const WEB_NEXT: Record<WebPreference, WebPreference> = { auto: "on", on: "off", off: "auto" };

function startersFor(hasArticle: boolean): string[] {
  return hasArticle
    ? [
        "Summarize this in 5 key points",
        "Explain it simply, like I'm 12",
        "Who are the key people, and what are the key dates?",
        "What's the latest on this topic?",
        "What's debated or uncertain about this?",
      ]
    : [
        "What's happening in the news today?",
        "Explain how large language models work",
        "What are the best books on the history of science?",
        "Compare nuclear and solar power",
      ];
}

/** The latest bold title from a reasoning summary, e.g. "Checking the dates". */
function thinkingTitle(reasoning: string | undefined): string {
  if (!reasoning) return "";
  const titles = [...reasoning.matchAll(/\*\*([^*]{3,80})\*\*/g)];
  return titles.length ? titles[titles.length - 1][1] : "";
}

function Sources({ sources }: { sources: AssistantSource[] }) {
  if (!sources.length) return null;
  return (
    <div className="msg-sources" aria-label="Sources">
      {sources.map((source) => (
        <a key={source.n} className="source-card" href={source.url} target="_blank" rel="noopener noreferrer nofollow" title={source.title}>
          <span className="source-top">
            <span className="source-n">{source.n}</span>
            {source.favicon ? <img src={source.favicon} alt="" loading="lazy" /> : <span className="source-letter">{source.site.charAt(0).toUpperCase()}</span>}
            <span className="source-site">{source.kind === "article" ? "This article" : source.site}</span>
          </span>
          <span className="source-title">{source.title}</span>
          {source.date && <span className="source-date">{formatDate(source.date)}</span>}
        </a>
      ))}
    </div>
  );
}

function Message({ message, isLast }: { message: AssistantMessage; isLast: boolean }) {
  if (message.role === "user") {
    return (
      <div className="msg from-user">
        {message.selection && <blockquote>{message.selection}</blockquote>}
        <p>{message.content}</p>
      </div>
    );
  }

  const thinking = message.streaming && !message.content;
  const title = thinkingTitle(message.reasoning);
  const modelName = message.model ? (MODEL_LABELS[message.model] ?? message.model.split("/").pop()) : "";

  return (
    <div className="msg from-ai">
      {thinking && (
        <div className="msg-status" aria-live="polite">
          <span className="thinking-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {message.status ?? "Working"}
          {title && <span className="msg-thought">· {title}</span>}
        </div>
      )}
      {message.sources && message.sources.length > 0 && <Sources sources={message.sources} />}
      {message.content && (
        <div className={`msg-answer ${message.streaming ? "is-streaming" : ""}`}>
          <Markdown text={message.content} sources={message.sources} />
        </div>
      )}
      {message.error && (
        <div className="msg-error" role="alert">
          {message.error}
          {isLast && (
            <button type="button" className="text-link" onClick={retryLast}>
              Try again
            </button>
          )}
        </div>
      )}
      {!message.streaming && message.content && (
        <div className="msg-foot">
          <span>
            {modelName}
            {message.mode === "deep" ? " · Deep" : message.mode === "quick" ? " · Fast" : ""}
            {message.web ? " · Web" : ""}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Copy answer"
            title="Copy answer"
            onClick={async () => {
              await navigator.clipboard.writeText(message.content).catch(() => undefined);
              toast("Answer copied", { tone: "success" });
            }}
          >
            <Icon name="copy" size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

export function AssistantPanel() {
  const assistant = useAssistant();
  const status = useQuery(aiStatusQuery);
  const mode = answerModeStore.use();
  const web = webPreferenceStore.use();
  const [draft, setDraft] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const thread = threadFor(assistant);
  const context = assistant.context;

  // Follow the answer as it streams, unless the reader scrolled up to re-read.
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body && pinned.current) body.scrollTop = body.scrollHeight;
  }, [thread]);

  useEffect(() => {
    if (!assistant.open) return;
    inputRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !assistant.busy) closeAssistant();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assistant.open, assistant.busy, assistant.selection]);

  // Grow the composer with its content, up to a few lines.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [draft]);

  if (!assistant.open) return null;

  const enabled = status.data?.enabled !== false;

  function submit(question = draft) {
    if (!question.trim() || assistant.busy) return;
    pinned.current = true;
    setDraft("");
    void askAssistant(question);
  }

  return (
    <>
      <div className="assistant-scrim" onClick={closeAssistant} />
      <aside className="assistant" aria-label="AI assistant">
        <header className="assistant-head">
          <div className="assistant-title">
            <span className="assistant-mark">
              <Icon name="sparkle" size={16} />
            </span>
            <div>
              <strong>Ask</strong>
              <span>{context ? `About “${context.title}”` : "Anything, with live web search"}</span>
            </div>
          </div>
          <div className="assistant-actions">
            {thread.length > 0 && (
              <button type="button" className="icon-btn" onClick={clearThread} aria-label="New conversation" title="New conversation">
                <Icon name="refresh" size={17} />
              </button>
            )}
            <button type="button" className="icon-btn" onClick={closeAssistant} aria-label="Close assistant" title="Close (Esc)">
              <Icon name="x" size={19} />
            </button>
          </div>
        </header>

        <div className="assistant-controls">
          <div className="segmented mini" role="group" aria-label="Answer mode">
            {MODES.map((option) => (
              <button key={option.value} type="button" aria-pressed={mode === option.value} title={option.hint} onClick={() => answerModeStore.set(option.value)}>
                {option.label}
              </button>
            ))}
          </div>
          {status.data?.webSearch !== false && (
            <button
              type="button"
              className={`web-toggle ${web}`}
              onClick={() => webPreferenceStore.set(WEB_NEXT[web])}
              title="Auto searches when there's no article open or when you ask about recent events"
            >
              <Icon name="globe" size={14} />
              {WEB_LABEL[web]}
            </button>
          )}
        </div>

        <div
          className="assistant-body"
          ref={bodyRef}
          onScroll={(event) => {
            const body = event.currentTarget;
            pinned.current = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
          }}
        >
          {!enabled ? (
            <div className="assistant-empty">
              <p>AI answers aren't set up on this server yet. Add an OpenRouter key to enable them.</p>
            </div>
          ) : thread.length === 0 ? (
            <div className="assistant-empty">
              <h3>{context ? "Ask about this article" : "Ask anything"}</h3>
              <p>
                {context
                  ? "Answers use the article you're reading, and search the web when you ask about recent events."
                  : "Answers search the web in real time and show their sources."}
              </p>
              <div className="starter-list">
                {startersFor(Boolean(context)).map((starter) => (
                  <button key={starter} type="button" className="starter" onClick={() => submit(starter)}>
                    {starter}
                    <Icon name="arrowRight" size={15} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            thread.map((message, index) => <Message key={message.id} message={message} isLast={index === thread.length - 1} />)
          )}
        </div>

        <form
          className="assistant-composer"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {assistant.selection && (
            <div className="quote-chip">
              <Icon name="pen" size={14} />
              <span>“{assistant.selection}”</span>
              <button type="button" aria-label="Remove passage" onClick={() => setAttachedSelection("")}>
                <Icon name="x" size={14} />
              </button>
            </div>
          )}
          <div className="composer-row">
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              disabled={!enabled}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder={assistant.selection ? "Ask about this passage…" : context ? "Ask about this article…" : "Ask anything…"}
              aria-label="Your question"
              maxLength={2000}
            />
            {assistant.busy ? (
              <button type="button" className="composer-send is-stop" onClick={stopAssistant} aria-label="Stop answering">
                <Icon name="stop" size={14} />
              </button>
            ) : (
              <button type="submit" className="composer-send" disabled={!draft.trim() || !enabled} aria-label="Ask">
                <Icon name="send" size={18} strokeWidth={2.2} />
              </button>
            )}
          </div>
          <p className="assistant-note">AI can make mistakes. Check the sources.</p>
        </form>
      </aside>
    </>
  );
}
