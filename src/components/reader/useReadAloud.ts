import { useCallback, useEffect, useRef, useState } from "react";

export type ReadAloudState = "idle" | "playing" | "paused";

const supported = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

/**
 * Reads the article aloud with the browser's built-in speech synthesis,
 * paragraph by paragraph, starting at the section in view. The paragraph
 * being read is marked and kept in view.
 */
export function useReadAloud(rootRef: React.RefObject<HTMLElement | null>, lang: string) {
  const [state, setState] = useState<ReadAloudState>("idle");
  const queue = useRef<HTMLElement[]>([]);
  const position = useRef(0);
  const current = useRef<HTMLElement | null>(null);
  const runId = useRef(0);

  const mark = (element: HTMLElement | null) => {
    current.current?.classList.remove("is-speaking");
    current.current = element;
    element?.classList.add("is-speaking");
  };

  const stop = useCallback(() => {
    runId.current += 1;
    if (supported) window.speechSynthesis.cancel();
    mark(null);
    setState("idle");
  }, []);

  const speakAt = useCallback(
    function speak(index: number, run: number) {
      if (run !== runId.current) return;
      const element = queue.current[index];
      if (!element) {
        stop();
        return;
      }
      position.current = index;
      mark(element);

      const rect = element.getBoundingClientRect();
      if (rect.top < 80 || rect.bottom > window.innerHeight - 80) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }

      const utterance = new SpeechSynthesisUtterance(element.innerText.replace(/\[\w+\]/g, ""));
      utterance.lang = lang;
      const voice = window.speechSynthesis.getVoices().find((candidate) => candidate.lang.toLowerCase().startsWith(lang.toLowerCase()));
      if (voice) utterance.voice = voice;
      utterance.rate = 1.02;
      utterance.onend = () => speak(index + 1, run);
      utterance.onerror = (event) => {
        if (event.error !== "interrupted" && event.error !== "canceled") stop();
      };
      window.speechSynthesis.speak(utterance);
    },
    [lang, stop]
  );

  const start = useCallback(
    (fromSectionId: string) => {
      const root = rootRef.current;
      if (!supported || !root) return;
      window.speechSynthesis.cancel();

      const section = document.getElementById(fromSectionId);
      const blocks = Array.from(root.querySelectorAll<HTMLElement>(".article-section > .section-body > p, .article-section > .section-body > ul > li, .article-section > .section-body > ol > li"));
      queue.current = blocks.filter((block) => {
        if (block.innerText.trim().length < 20) return false;
        return !section || section.contains(block) || Boolean(section.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING);
      });

      runId.current += 1;
      setState("playing");
      speakAt(0, runId.current);
    },
    [rootRef, speakAt]
  );

  const toggle = useCallback(
    (fromSectionId: string) => {
      if (!supported) return;
      if (state === "idle") start(fromSectionId);
      else if (state === "playing") {
        window.speechSynthesis.pause();
        setState("paused");
      } else {
        window.speechSynthesis.resume();
        setState("playing");
      }
    },
    [start, state]
  );

  useEffect(() => stop, [stop]);

  return { supported, state, toggle, stop };
}
