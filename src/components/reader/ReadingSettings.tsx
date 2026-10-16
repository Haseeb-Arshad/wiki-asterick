import type { ReactNode } from "react";
import { LISTEN_DEFAULTS, LISTEN_RATES, formatRate, languageKey, listenStore } from "../../lib/listen";
import { READING_DEFAULTS, READING_SIZES, readingStore, type LineWidth, type Paper, type ReadingPrefs, type Spacing, type TypeFace } from "../../lib/reading";
import { Sheet } from "../Sheet";
import { Icon } from "../Icon";
import { readAloudSupported, useVoices } from "./useReadAloud";

/** Text size, line width, typeface, spacing and paper for the article column, plus listening speed and voice. Applies everywhere. */
export function ReadingSettings({ lang, onClose }: { lang: string; onClose: () => void }) {
  const prefs = readingStore.use();
  const listen = listenStore.use();
  const voices = useVoices(lang);
  const voiceKey = languageKey(lang);
  const update = (patch: Partial<ReadingPrefs>) => readingStore.set((previous) => ({ ...previous, ...patch }));
  const sizeLabel = READING_SIZES[prefs.size].label;
  const changed = JSON.stringify(prefs) !== JSON.stringify(READING_DEFAULTS) || JSON.stringify(listen) !== JSON.stringify(LISTEN_DEFAULTS);

  return (
    <Sheet title="Reading" subtitle="Applies to every article you open" onClose={onClose}>
      <div className="reading-settings">
        <SettingRow label="Text size">
          <div className="stepper" role="group" aria-label="Text size">
            <button
              type="button"
              onClick={() => update({ size: Math.max(0, prefs.size - 1) })}
              disabled={prefs.size === 0}
              aria-label="Smaller text"
            >
              <span className="stepper-aa small" aria-hidden="true">A</span>
            </button>
            <output aria-live="polite">{sizeLabel}</output>
            <button
              type="button"
              onClick={() => update({ size: Math.min(READING_SIZES.length - 1, prefs.size + 1) })}
              disabled={prefs.size === READING_SIZES.length - 1}
              aria-label="Larger text"
            >
              <span className="stepper-aa" aria-hidden="true">A</span>
            </button>
          </div>
        </SettingRow>

        <SettingRow label="Line width">
          <Segmented<LineWidth>
            label="Line width"
            value={prefs.width}
            options={[
              ["narrow", "Narrow"],
              ["standard", "Standard"],
              ["wide", "Wide"],
            ]}
            onChange={(width) => update({ width })}
          />
        </SettingRow>

        <SettingRow label="Typeface">
          <Segmented<TypeFace>
            label="Typeface"
            value={prefs.face}
            options={[
              ["serif", "Serif"],
              ["sans", "Sans"],
            ]}
            onChange={(face) => update({ face })}
          />
        </SettingRow>

        <SettingRow label="Spacing">
          <Segmented<Spacing>
            label="Spacing"
            value={prefs.spacing}
            options={[
              ["standard", "Standard"],
              ["relaxed", "Relaxed"],
            ]}
            onChange={(spacing) => update({ spacing })}
          />
        </SettingRow>

        <SettingRow label="Paper">
          <Segmented<Paper>
            label="Paper"
            value={prefs.paper}
            options={[
              ["theme", "Match theme"],
              ["sepia", "Sepia"],
            ]}
            onChange={(paper) => update({ paper })}
          />
        </SettingRow>

        {readAloudSupported && (
          <>
            <SettingRow label="Listening speed">
              <Segmented<string>
                label="Listening speed"
                value={String(listen.rate)}
                options={LISTEN_RATES.map((rate): [string, string] => [String(rate), formatRate(rate)])}
                onChange={(rate) => listenStore.set((previous) => ({ ...previous, rate: Number(rate) }))}
              />
            </SettingRow>

            {voices.length > 0 && (
              <SettingRow label="Voice">
                <select
                  className="setting-select"
                  aria-label="Voice"
                  value={listen.voices[voiceKey] ?? ""}
                  onChange={(event) =>
                    listenStore.set((previous) => {
                      const next = { ...previous.voices };
                      if (event.target.value) next[voiceKey] = event.target.value;
                      else delete next[voiceKey];
                      return { ...previous, voices: next };
                    })
                  }
                >
                  <option value="">Browser default</option>
                  {voices.map((voice) => (
                    <option key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name}
                    </option>
                  ))}
                </select>
              </SettingRow>
            )}
          </>
        )}

        <div className="reading-settings-foot">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              readingStore.set(READING_DEFAULTS);
              listenStore.set(LISTEN_DEFAULTS);
            }}
            disabled={!changed}
          >
            <Icon name="refresh" size={15} /> Reset to defaults
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="setting-row">
      <h3>{label}</h3>
      {children}
    </section>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented setting-segmented" role="group" aria-label={label}>
      {options.map(([option, text]) => (
        <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}>
          {text}
        </button>
      ))}
    </div>
  );
}
