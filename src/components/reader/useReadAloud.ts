import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { languageKey, listenStore } from "../../lib/listen";

export type ReadAloudState = "idle" | "playing" | "paused";

export const readAloudSupported = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

// ---- voices -----------------------------------------------------------------------------
// Browsers load voices late and announce it with "voiceschanged"; keep one shared list.

const NO_VOICES: SpeechSynthesisVoice[] = [];
let voiceCache: SpeechSynthesisVoice[] = NO_VOICES;
const voiceListeners = new Set<() => void>();

function refreshVoices() {
  voiceCache = window.speechSynthesis.getVoices();
  voiceListeners.forEach((listener) => listener());
}

if (readAloudSupported) {
  refreshVoices();
  window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
}

function subscribeVoices(listener: () => void) {
  voiceListeners.add(listener);
  return () => voiceListeners.delete(listener);
}

/** Voices that speak the article's language (or every voice when none match). */
export function useVoices(lang: string): SpeechSynthesisVoice[] {
  const all = useSyncExternalStore(
    subscribeVoices,
    () => voiceCache,
    () => NO_VOICES
  );
  const key = languageKey(lang);
  const matching = all.filter((voice) => languageKey(voice.lang) === key);
  return matching.length ? matching : all;
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const key = languageKey(lang);
  const matching = voiceCache.filter((voice) => languageKey(voice.lang) === key);
  const chosen = listenStore.get().voices[key];
  return matching.find((voice) => voice.voiceURI === chosen) ?? matching.find((voice) => voice.default) ?? matching[0];
}

// ---- sentences --------------------------------------------------------------------------

interface Sentence {
  text: string;
  range: Range;
  block: HTMLElement;
}

const SKIPPED = "sup, style, script, .mw-editsection, [aria-hidden='true']";

function sentenceBounds(text: string, lang: string): [number, number][] {
  const bounds: [number, number][] = [];
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    for (const part of new Intl.Segmenter(lang, { granularity: "sentence" }).segment(text)) bounds.push([part.index, part.index + part.segment.length]);
  } else {
    for (const match of text.matchAll(/[^.!?。！？]+[.!?。！？]*["')\]]*\s*|[^.!?。！？]+$/g)) bounds.push([match.index, match.index + match[0].length]);
  }
  return bounds;
}

/** One block of text split into sentences, each with a live Range over the real text nodes. */
function sentencesOf(block: HTMLElement, lang: string): Sentence[] {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const skipped = node.parentElement?.closest(SKIPPED);
      return skipped && block.contains(skipped) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const parts: { node: Text; start: number }[] = [];
  let full = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    parts.push({ node: node as Text, start: full.length });
    full += (node as Text).data;
  }
  if (!parts.length) return [];

  const locate = (position: number, atEnd: boolean) => {
    let found = parts[0];
    for (const part of parts) {
      if (atEnd ? part.start < position : part.start <= position) found = part;
      else break;
    }
    return { node: found.node, offset: Math.min(found.node.length, Math.max(0, position - found.start)) };
  };

  const sentences: Sentence[] = [];
  for (const [rawStart, rawEnd] of sentenceBounds(full, lang)) {
    let start = rawStart;
    let end = rawEnd;
    while (start < end && /\s/.test(full[start])) start += 1;
    while (end > start && /\s/.test(full[end - 1])) end -= 1;
    const text = full
      .slice(start, end)
      .replace(/\s+/g, " ")
      .replace(/\[\w+\]/g, "")
      .trim();
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    const from = locate(start, false);
    const to = locate(end, true);
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    sentences.push({ text, range, block });
  }
  return sentences;
}

const supportsHighlights = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

/**
 * Reads the article aloud with the browser's built-in speech synthesis, one
 * sentence at a time, starting at the section in view. The sentence being read
 * is highlighted and kept in view; speed and voice come from the saved listening
 * settings, and a change applies from the sentence being read right now.
 */
export function useReadAloud(rootRef: React.RefObject<HTMLElement | null>, lang: string) {
  const [state, setState] = useState<ReadAloudState>("idle");
  const stateRef = useRef<ReadAloudState>("idle");
  const queue = useRef<Sentence[]>([]);
  const position = useRef(0);
  const current = useRef<HTMLElement | null>(null);
  const runId = useRef(0);

  const changeState = useCallback((next: ReadAloudState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const mark = useCallback((sentence: Sentence | null) => {
    current.current?.classList.remove("is-speaking");
    current.current = sentence?.block ?? null;
    sentence?.block.classList.add("is-speaking");
    if (!supportsHighlights()) return;
    if (sentence) CSS.highlights.set("wa-speak", new Highlight(sentence.range));
    else CSS.highlights.delete("wa-speak");
  }, []);

  const stop = useCallback(() => {
    runId.current += 1;
    if (readAloudSupported) window.speechSynthesis.cancel();
    mark(null);
    changeState("idle");
  }, [changeState, mark]);

  const speakAt = useCallback(
    function speak(index: number, run: number) {
      if (run !== runId.current) return;
      const sentence = queue.current[index];
      if (!sentence) {
        stop();
        return;
      }
      position.current = index;
      mark(sentence);

      const rect = sentence.range.getBoundingClientRect();
      if (rect.top < 90 || rect.bottom > window.innerHeight - 140) {
        window.scrollBy({ top: rect.top - window.innerHeight * 0.35, behavior: "smooth" });
      }

      const utterance = new SpeechSynthesisUtterance(sentence.text);
      utterance.lang = lang;
      const voice = pickVoice(lang);
      if (voice) utterance.voice = voice;
      utterance.rate = listenStore.get().rate;
      utterance.onend = () => speak(index + 1, run);
      utterance.onerror = (event) => {
        if (event.error !== "interrupted" && event.error !== "canceled") stop();
      };
      window.speechSynthesis.speak(utterance);
    },
    [lang, mark, stop]
  );

  const start = useCallback(
    (fromSectionId: string) => {
      const root = rootRef.current;
      if (!readAloudSupported || !root) return;
      window.speechSynthesis.cancel();

      const section = document.getElementById(fromSectionId);
      const blocks = Array.from(
        root.querySelectorAll<HTMLElement>(".article-section > .section-body > p, .article-section > .section-body > ul > li, .article-section > .section-body > ol > li")
      ).filter((block) => !section || section.contains(block) || Boolean(section.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING));
      queue.current = blocks.flatMap((block) => sentencesOf(block, lang));

      runId.current += 1;
      changeState("playing");
      speakAt(0, runId.current);
    },
    [rootRef, speakAt, lang, changeState]
  );

  const toggle = useCallback(
    (fromSectionId: string) => {
      if (!readAloudSupported) return;
      if (stateRef.current === "idle") start(fromSectionId);
      else if (stateRef.current === "playing") {
        window.speechSynthesis.pause();
        changeState("paused");
      } else {
        window.speechSynthesis.resume();
        changeState("playing");
      }
    },
    [start, changeState]
  );

  // A new speed or voice applies from the sentence being read right now.
  useEffect(() => {
    let previous = listenStore.get();
    const unsubscribe = listenStore.subscribe(() => {
      const next = listenStore.get();
      if (next === previous) return;
      previous = next;
      if (stateRef.current !== "playing") return;
      window.speechSynthesis.cancel();
      runId.current += 1;
      speakAt(position.current, runId.current);
    });
    return () => {
      unsubscribe();
    };
  }, [speakAt]);

  useEffect(() => stop, [stop]);

  return { supported: readAloudSupported, state, toggle, stop };
}
