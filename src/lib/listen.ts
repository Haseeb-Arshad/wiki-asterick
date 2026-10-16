import { createPersistedStore } from "./store";

export const LISTEN_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

export interface ListenPrefs {
  /** Speaking speed, one of LISTEN_RATES. */
  rate: number;
  /** Chosen voice (its voiceURI) per language, e.g. { en: "Google UK English Female" }. */
  voices: Record<string, string>;
}

export const LISTEN_DEFAULTS: ListenPrefs = { rate: 1, voices: {} };

export const listenStore = createPersistedStore<ListenPrefs>("wa-listen", LISTEN_DEFAULTS, (raw) => {
  const value = (raw ?? {}) as Partial<ListenPrefs>;
  const voices: Record<string, string> = {};
  if (value.voices && typeof value.voices === "object") {
    for (const [lang, uri] of Object.entries(value.voices)) if (typeof uri === "string") voices[lang] = uri;
  }
  return { rate: LISTEN_RATES.includes(value.rate as (typeof LISTEN_RATES)[number]) ? (value.rate as number) : 1, voices };
});

/** "en-GB" and "en_us" both become "en". */
export const languageKey = (lang: string) => lang.toLowerCase().split(/[-_]/)[0];

export const formatRate = (rate: number) => `${rate}×`;

/** The next speed in the cycle 1× → 1.25× → 1.5× → 2× → 0.75× → 1×. */
export function nextRate(rate: number): number {
  const index = LISTEN_RATES.indexOf(rate as (typeof LISTEN_RATES)[number]);
  return LISTEN_RATES[(index + 1) % LISTEN_RATES.length];
}
