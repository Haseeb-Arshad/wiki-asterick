import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Voice input for the ask bar, using the browser's speech recognition
 * (Chrome, Edge and Safari). Words appear in the box as they're spoken;
 * nothing is sent until the reader presses Enter.
 */

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}

interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it in the browser's site settings.",
  "service-not-allowed": "Voice input isn't available in this browser.",
  "audio-capture": "No microphone was found.",
  network: "Voice input needs an internet connection.",
};

export function useDictation({ onText, onError }: { onText: (text: string, final: boolean) => void; onError: (message: string) => void }) {
  const supported = recognitionConstructor() !== null;
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const handlers = useRef({ onText, onError });

  useEffect(() => {
    handlers.current = { onText, onError };
  }, [onText, onError]);

  const stop = useCallback(() => {
    recognition.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Constructor = recognitionConstructor();
    if (!Constructor || recognition.current) return;
    const instance = new Constructor();
    instance.lang = document.documentElement.lang || navigator.language || "en-US";
    instance.continuous = true;
    instance.interimResults = true;

    let finalText = "";
    instance.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      handlers.current.onText((finalText + interim).replace(/\s+/g, " ").trimStart(), !interim);
    };
    instance.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        handlers.current.onError(MESSAGES[event.error] ?? "Voice input stopped unexpectedly.");
      }
    };
    instance.onend = () => {
      recognition.current = null;
      setListening(false);
    };

    try {
      instance.start();
      recognition.current = instance;
      setListening(true);
    } catch {
      handlers.current.onError("Voice input isn't available right now.");
    }
  }, []);

  useEffect(() => () => recognition.current?.abort(), []);

  return { supported, listening, start, stop, toggle: listening ? stop : start };
}
