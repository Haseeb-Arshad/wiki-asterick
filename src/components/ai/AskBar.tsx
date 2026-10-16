import { useQuery } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../../lib/auth";
import {
  aiStatusQuery,
  answerModeStore,
  ask,
  clearFollowUp,
  clearQuote,
  noteKey,
  registerAskHost,
  stopAsk,
  toggleNotes,
  useAsk,
  webPreferenceStore,
  type AnswerMode,
  type WebPreference,
} from "../../lib/assistant";
import { setBarSlot } from "../../lib/bar-slot";
import { useDictation } from "../../lib/dictation";
import { useOutsidePress } from "../../lib/hooks";
import { notesFor, useLibrary } from "../../lib/library";
import { toast } from "../../lib/toast";
import { Icon } from "../Icon";
import { ThinkingCard } from "./ThinkingCard";

const HIDDEN_ON = ["/signin", "/signup", "/account"];

const MODES: { value: AnswerMode; label: string; detail: string; icon: "sparkle" | "bolt" | "brain" }[] = [
  { value: "auto", label: "Auto", detail: "Picks the model for each question", icon: "sparkle" },
  { value: "quick", label: "Fast", detail: "Claude Haiku 5.5", icon: "bolt" },
  { value: "deep", label: "Deep", detail: "GPT-6 Luna, high reasoning", icon: "brain" },
];

const WEB_OPTIONS: { value: WebPreference; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const QUOTE_PROMPTS = ["Explain this", "Say it more simply", "Why does it matter?", "Is this accurate?"];
const PAGE_PROMPTS = ["Summarize the key points", "What should I know first?", "What's the latest on this?"];

/**
 * The floating ask bar at the bottom of every page. It holds the question
 * box, voice input, the model and web-search choice, and, while a question
 * runs, the live "thinking" card above it.
 */
export function AskBar() {
  const status = useQuery(aiStatusQuery);
  const pathname = useLocation({ select: (location) => location.pathname });
  const enabled = status.data?.enabled === true && !HIDDEN_ON.some((path) => pathname.startsWith(path));
  if (!enabled) return null;
  return <AskBarInner webSearch={status.data?.webSearch === true} />;
}

function AskBarInner({ webSearch }: { webSearch: boolean }) {
  const { user } = useSession();
  const library = useLibrary(user);
  const { context, quote, followUp, run, focusTick, suggestions } = useAsk();
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dictationBase = useRef("");

  const { wiki, title } = noteKey(context);
  const pageNotes = useMemo(() => notesFor(library.snapshot, wiki, title), [library.snapshot, wiki, title]);
  const running = run?.phase === "running";

  // Give the ask logic a way to save notes and read a page's earlier notes.
  const snapshot = useRef(library.snapshot);
  useEffect(() => {
    snapshot.current = library.snapshot;
  }, [library.snapshot]);
  useEffect(() => {
    registerAskHost({
      saveNote: library.addNote,
      notesFor: (target) => {
        const key = noteKey(target);
        return notesFor(snapshot.current, key.wiki, key.title);
      },
    });
    return () => registerAskHost(null);
  }, [library.addNote]);

  // Leave room under the page for the bar.
  useEffect(() => {
    document.body.classList.add("has-askbar");
    return () => document.body.classList.remove("has-askbar");
  }, []);

  // ---- focus requests (the A key, "Ask" on a selection, follow-ups) ---------------------
  useEffect(() => {
    if (focusTick) inputRef.current?.focus({ preventScroll: true });
  }, [focusTick]);

  // ---- grow with the text -------------------------------------------------------------
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    const height = draft ? input.scrollHeight : 40;
    input.style.height = `${Math.min(height, 148)}px`;
    input.style.overflowY = height > 148 ? "auto" : "hidden";
  }, [draft]);

  // ---- tuck the bar away while reading down the page --------------------------------------
  const [scrolledDown, setScrolledDown] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = window.scrollY;
        const nearBottom = window.innerHeight + y > document.documentElement.scrollHeight - 160;
        if (nearBottom) setScrolledDown(false);
        else if (Math.abs(y - last) > 8) setScrolledDown(y > last && y > 240);
        last = y;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  const compact = scrolledDown && !focused && !draft && !run && !quote && !followUp && !menuOpen;

  // ---- voice input ------------------------------------------------------------------------
  const onSpoken = useCallback((text: string) => {
    const base = dictationBase.current;
    setDraft(base ? `${base}${/\s$/.test(base) ? "" : " "}${text}` : text);
  }, []);
  const onVoiceError = useCallback((message: string) => toast(message, { tone: "error" }), []);
  const dictation = useDictation({ onText: onSpoken, onError: onVoiceError });

  function toggleDictation() {
    if (!dictation.listening) dictationBase.current = draft.trim();
    dictation.toggle();
    inputRef.current?.focus({ preventScroll: true });
  }

  // ---- model menu --------------------------------------------------------------------------
  const mode = answerModeStore.use();
  const web = webPreferenceStore.use();
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useOutsidePress([menuRef], closeMenu, menuOpen);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  const currentMode = MODES.find((item) => item.value === mode) ?? MODES[0];

  // ---- send ---------------------------------------------------------------------------------
  function submit(text = draft) {
    const question = text.trim();
    if (!question || running) return;
    if (dictation.listening) dictation.stop();
    void ask(question);
    setDraft("");
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (dictation.listening) dictation.stop();
      else if (quote || followUp) clearFollowUp();
      else inputRef.current?.blur();
    }
  }

  const placeholder = dictation.listening
    ? "Listening…"
    : followUp
      ? "Ask a follow-up…"
      : quote
        ? "Ask about this passage…"
        : context
          ? `Ask about ${context.title.length > 34 ? `${context.title.slice(0, 32)}…` : context.title}`
          : "Ask anything";

  const prompts = !draft && focused && !run ? (quote ? QUOTE_PROMPTS : context && !followUp && pageNotes.length === 0 ? (suggestions.length ? suggestions : PAGE_PROMPTS) : []) : [];

  return (
    <div className={`askbar-wrap ${compact ? "is-compact" : ""}`}>
      {run && <ThinkingCard key={run.id} run={run} />}

      {prompts.length > 0 && (
        <div className="ask-prompts" role="list">
          {prompts.map((prompt, index) => (
            <button
              key={prompt}
              type="button"
              role="listitem"
              className="ask-prompt"
              style={{ animationDelay: `${index * 40}ms` }}
              // Keep the box focused so the prompts don't vanish before the click lands.
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => submit(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      <div
        ref={barRef}
        className={`askbar ${focused ? "is-focused" : ""} ${focused || draft ? "is-composing" : ""} ${dictation.listening ? "is-listening" : ""} ${running ? "is-running" : ""}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) inputRef.current?.focus();
        }}
      >
        {(quote || followUp) && (
          <div className="ask-attachment">
            <Icon name={followUp ? "reply" : "quote"} size={15} />
            <span className="ask-attachment-text">
              {followUp ? (
                <>
                  Following up on <strong>{followUp.question}</strong>
                </>
              ) : (
                <>“{quote!.text}”</>
              )}
            </span>
            <button type="button" className="ask-attachment-x" onClick={followUp ? clearFollowUp : clearQuote} aria-label="Remove">
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        <div className="askbar-row">
          <div className="askbar-tools" ref={setBarSlot} />

          {pageNotes.length > 0 && (
            <button type="button" className="ask-icon ask-notes" onClick={toggleNotes} title="AI notes on this page" aria-label={`AI notes on this page (${pageNotes.length})`}>
              <Icon name="notes" size={19} />
              <span className="ask-badge">{pageNotes.length}</span>
            </button>
          )}

          <label className="askbar-field">
            <Icon name="sparkle" size={18} className="askbar-spark" />
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              placeholder={placeholder}
              aria-label="Ask AI"
              maxLength={2000}
              enterKeyHint="send"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            />
          </label>

          <div className="askbar-actions">
            <div className="menu-anchor" ref={menuRef}>
              <button
                type="button"
                className="ask-mode"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
                title="Model and web search"
              >
                <Icon name={currentMode.icon} size={15} />
                <span className="ask-mode-label">{currentMode.label}</span>
                {web === "on" && <Icon name="globe" size={14} className="ask-mode-web" />}
                <Icon name="chevronUp" size={13} className="ask-mode-caret" />
              </button>
              {menuOpen && (
                <div className="ask-menu" role="menu">
                  <p className="ask-menu-label">Answer with</p>
                  {MODES.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={mode === item.value}
                      className="ask-menu-item"
                      onClick={() => {
                        answerModeStore.set(item.value);
                        setMenuOpen(false);
                      }}
                    >
                      <span className="ask-menu-icon">
                        <Icon name={item.icon} size={17} />
                      </span>
                      <span className="ask-menu-text">
                        <strong>{item.label}</strong>
                        <span>{item.detail}</span>
                      </span>
                      {mode === item.value && <Icon name="check" size={17} className="ask-menu-check" />}
                    </button>
                  ))}
                  {webSearch && (
                    <>
                      <p className="ask-menu-label">Search the web</p>
                      <div className="ask-seg" role="radiogroup" aria-label="Search the web">
                        {WEB_OPTIONS.map((option) => (
                          <button key={option.value} type="button" role="radio" aria-checked={web === option.value} onClick={() => webPreferenceStore.set(option.value)}>
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <p className="ask-menu-hint">Auto searches when there's no article open or you ask about recent events.</p>
                    </>
                  )}
                </div>
              )}
            </div>

            {dictation.supported && (
              <button
                type="button"
                className={`ask-icon ask-mic ${dictation.listening ? "is-on" : ""}`}
                onClick={toggleDictation}
                aria-pressed={dictation.listening}
                aria-label={dictation.listening ? "Stop voice input" : "Speak your question"}
                title={dictation.listening ? "Stop" : "Speak"}
              >
                <Icon name="mic" size={18} />
              </button>
            )}

            {running ? (
              <button type="button" className="ask-send is-stop" onClick={stopAsk} aria-label="Stop answering">
                <Icon name="stop" size={14} />
              </button>
            ) : (
              <button type="button" className="ask-send" onClick={() => submit()} disabled={!draft.trim()} aria-label="Ask">
                <Icon name="send" size={18} strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
