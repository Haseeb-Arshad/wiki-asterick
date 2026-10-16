import { useEffect, useRef, useState } from "react";
import { dismissRun, modelLabel, retryRun, revealNotes, stopAsk, type AskRun, type RunStep } from "../../lib/assistant";
import { Icon } from "../Icon";
import { Markdown } from "../Markdown";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Seconds since the question was sent, ticking while it runs. */
function useElapsed(run: AskRun): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (run.phase !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [run.phase]);
  const end = run.finishedAt ?? Math.max(now, run.startedAt);
  return `${((end - run.startedAt) / 1000).toFixed(1)}s`;
}

/** Reasoning text without the Markdown markers, ending at the newest thought. */
function reasoningTail(reasoning: string): string {
  return reasoning
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-420);
}

/**
 * The live view of a question being answered: what the AI is doing right now
 * (reading, searching, thinking, writing), the sources it found, a glimpse of
 * its reasoning and the answer as it's written. When the answer is complete
 * it is saved as a note and the card flies over to where notes are shown.
 */
export function ThinkingCard({ run }: { run: AskRun }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const reasoningRef = useRef<HTMLDivElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  // False once the reader scrolls up in the answer to read it; the stream stops pulling them down.
  const followAnswer = useRef(true);
  const [showReasoning, setShowReasoning] = useState(false);
  const elapsed = useElapsed(run);

  const active = [...run.steps].reverse().find((step) => step.state === "active") ?? run.steps[run.steps.length - 1];
  const webSources = run.sources.filter((source) => source.kind === "web");
  const thinking = active?.id === "think";
  const headline =
    run.phase === "done" ? "Answer saved to your notes" : run.phase === "error" ? (run.error ?? "Something went wrong") : (active?.label ?? "Starting");

  // Keep the newest reasoning and answer text in view as they stream.
  useEffect(() => {
    const element = reasoningRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [run.reasoning]);
  useEffect(() => {
    const element = answerRef.current;
    if (element && followAnswer.current) element.scrollTop = element.scrollHeight;
  }, [run.answer]);
  // Once it's complete, show the answer from its first line, where the direct answer is.
  useEffect(() => {
    const element = answerRef.current;
    if (run.phase === "done" && element && followAnswer.current) element.scrollTop = 0;
  }, [run.phase]);

  // ---- done: open the note where it lives, then fly the card into it ----------------------
  useEffect(() => {
    if (run.phase !== "done") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      revealNotes(run.id);
      // Wait for the rail or drawer to render the new note.
      window.setTimeout(() => {
        if (cancelled) return;
        const card = cardRef.current;
        const target = document.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(run.id)}"]`);
        if (!card || !target || reducedMotion()) {
          dismissRun();
          return;
        }
        const from = card.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        const scale = Math.max(0.25, Math.min(1, to.width / from.width));
        const dx = to.left + to.width / 2 - (from.left + from.width / 2);
        const dy = to.top + Math.min(to.height, 160) / 2 - (from.top + from.height / 2);
        card.style.pointerEvents = "none";
        const flight = card.animate(
          [
            { transform: "none", opacity: 1, filter: "blur(0px)" },
            { transform: `translate(${dx * 0.6}px, ${dy * 0.6}px) scale(${(1 + scale) / 2})`, opacity: 0.75, filter: "blur(0px)", offset: 0.6 },
            { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0, filter: "blur(3px)" },
          ],
          { duration: 620, easing: "cubic-bezier(0.55, 0, 0.2, 1)", fill: "forwards" }
        );
        flight.finished
          .catch(() => undefined)
          .then(() => {
            target.classList.remove("ai-note-arrive");
            void target.offsetWidth;
            target.classList.add("ai-note-arrive");
            dismissRun();
          });
      }, 140);
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [run.phase, run.id]);

  return (
    <div ref={cardRef} className="think-card" data-phase={run.phase} data-mode={run.mode}>
      {/* Screen readers hear each step and the finish, not every streamed word. */}
      <p className="visually-hidden" role="status">
        {run.phase === "done" ? "Answer ready and saved to your notes." : headline}
      </p>
      <div className="think-head">
        <Orb phase={run.phase} thinking={thinking} />
        <div className="think-title">
          <span className={run.phase === "running" ? "shimmer-text" : ""}>{headline}</span>
          {run.phase === "running" && active?.id === "think" && active.detail && <span className="think-detail">{active.detail}</span>}
        </div>
        <span className="think-time">{elapsed}</span>
        {run.phase === "running" ? (
          <button type="button" className="think-x" onClick={stopAsk} aria-label="Stop">
            <Icon name="stop" size={12} />
          </button>
        ) : (
          <button type="button" className="think-x" onClick={dismissRun} aria-label="Close">
            <Icon name="x" size={15} />
          </button>
        )}
      </div>

      <p className="think-question">
        <span>{run.question}</span>
        {run.quote && <span className="think-quote">“{run.quote.text}”</span>}
      </p>

      <ol className="think-steps">
        {run.steps.map((step) => (
          <StepRow key={step.id} step={step}>
            {step.id === "search" && webSources.length > 0 && (
              <span className="think-favicons">
                {webSources.map((source, index) => (
                  <a
                    key={source.url}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="think-favicon"
                    style={{ animationDelay: `${index * 70}ms` }}
                    title={`${source.title} — ${source.site}`}
                  >
                    {source.favicon ? <img src={source.favicon} alt="" width={16} height={16} loading="lazy" /> : <span>{source.site.slice(0, 1).toUpperCase()}</span>}
                  </a>
                ))}
                <span className="think-count">{webSources.length} sources</span>
              </span>
            )}
          </StepRow>
        ))}
      </ol>

      {run.reasoning && (
        <div className={`think-reasoning ${showReasoning ? "is-open" : ""}`}>
          <button type="button" className="think-reasoning-toggle" onClick={() => setShowReasoning((open) => !open)} aria-expanded={showReasoning}>
            <Icon name="brain" size={14} />
            {showReasoning ? "Hide thinking" : "Show thinking"}
            <Icon name="chevronDown" size={14} className="think-caret" />
          </button>
          {/* Once the answer is being written, the reasoning steps back unless asked for. */}
          {(showReasoning || !run.answer) && (
            <div ref={reasoningRef} className="think-reasoning-text">
              {showReasoning ? run.reasoning.replace(/\*\*([^*]+)\*\*/g, "$1") : reasoningTail(run.reasoning)}
            </div>
          )}
        </div>
      )}

      {run.answer && (
        <div
          ref={answerRef}
          className="think-answer markdown"
          onScroll={(event) => {
            if (run.phase !== "running") return;
            const element = event.currentTarget;
            followAnswer.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
          }}
        >
          <Markdown text={run.answer} sources={run.sources} page={run.context ?? undefined} />
          {run.phase === "running" && <span className="caret" aria-hidden="true" />}
        </div>
      )}

      <div className="think-foot">
        {run.model && (
          <span className="think-model">
            <Icon name={run.mode === "deep" ? "brain" : "bolt"} size={13} />
            {modelLabel(run.model)}
            {run.mode === "deep" ? " · deep" : ""}
            {run.web ? " · web" : ""}
          </span>
        )}
        {run.phase === "error" && (
          <span className="think-error-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={retryRun}>
              <Icon name="refresh" size={15} /> Try again
            </button>
          </span>
        )}
        {run.phase === "done" && (
          <span className="think-saved">
            <Icon name="check" size={14} /> Saved
          </span>
        )}
      </div>
    </div>
  );
}

function StepRow({ step, children }: { step: RunStep; children?: React.ReactNode }) {
  return (
    <li className="think-step" data-state={step.state}>
      <span className="think-step-mark" aria-hidden="true">
        {step.state === "done" ? <Icon name="check" size={12} strokeWidth={2.4} /> : step.state === "failed" ? <Icon name="x" size={12} strokeWidth={2.4} /> : <i />}
      </span>
      <span className="think-step-body">
        <span className="think-step-label">{step.label}</span>
        {step.detail && step.id === "search" && <span className="think-step-detail">“{step.detail}”</span>}
        {children}
      </span>
    </li>
  );
}

/** A soft, slowly turning orb: faster while thinking, a check when done. */
function Orb({ phase, thinking }: { phase: AskRun["phase"]; thinking: boolean }) {
  return (
    <span className={`orb ${thinking ? "is-thinking" : ""}`} data-phase={phase} aria-hidden="true">
      <span className="orb-glow" />
      <span className="orb-core" />
      {phase === "done" && <Icon name="check" size={14} strokeWidth={2.6} className="orb-check" />}
      {phase === "error" && <Icon name="x" size={14} strokeWidth={2.6} className="orb-check" />}
    </span>
  );
}
