import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { normalizeWikipediaUrl, isWikipediaUrl } from "../lib/utils";
import { AsteriskMark } from "./AsteriskIcon";

export function HomePage() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault(); setError("");
    if (!url.trim()) { setError("Please enter a Wikipedia URL"); return; }
    const normalized = normalizeWikipediaUrl(url.trim());
    if (!isWikipediaUrl(normalized)) { setError("Enter a valid Wikipedia URL"); return; }
    navigate({ to: "/article", search: { url: normalized } });
  };

  const examples = [
    { title: "Adolf Hitler", url: "https://en.wikipedia.org/wiki/Adolf_Hitler" },
    { title: "Quantum mechanics", url: "https://en.wikipedia.org/wiki/Quantum_mechanics" },
    { title: "Byzantine Empire", url: "https://en.wikipedia.org/wiki/Byzantine_Empire" },
    { title: "Rome", url: "https://en.wikipedia.org/wiki/Rome" },
    { title: "Artificial intelligence", url: "https://en.wikipedia.org/wiki/Artificial_intelligence" },
    { title: "Otto von Bismarck", url: "https://en.wikipedia.org/wiki/Otto_von_Bismarck" },
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-20">
      <div className="max-w-2xl w-full text-center animate-fade-in">
        <AsteriskMark size={64} className="text-[var(--color-primary)] mx-auto mb-8" />
        <h1 className="font-serif-display text-5xl md:text-6xl font-normal italic leading-[1.05] tracking-tight mb-4">WikiAsterisk</h1>
        <p className="text-[var(--color-grey-dark)] text-lg italic leading-relaxed max-w-md mx-auto font-serif mb-10">
          Read Wikipedia with the depth and care of a magazine. Beautiful typography, highlights, and references.
        </p>
        <form onSubmit={handleSubmit} className="mb-8">
          <div className="flex gap-3 max-w-lg mx-auto">
            <input type="text" value={url} onChange={e => { setUrl(e.target.value); setError(""); }} placeholder="https://en.wikipedia.org/wiki/..."
              className="flex-1 px-4 py-3 border border-[var(--color-grey-light)] bg-[var(--color-cream)] text-[var(--color-black)] font-sans text-sm focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary-bg)] transition-all placeholder:text-[var(--color-grey)]" autoFocus />
            <button type="submit" className="px-6 py-3 border border-[var(--color-black)] bg-[var(--color-black)] text-[var(--color-cream)] font-sans text-sm font-bold tracking-wider hover:bg-[var(--color-grey-dark)] transition-colors active:scale-[0.98]">Read</button>
          </div>
          {error && <p className="text-[var(--color-red)] text-sm mt-3 font-sans">{error}</p>}
        </form>
        <div className="border-t border-[var(--color-grey-light)] pt-8">
          <p className="font-sans text-[10px] uppercase tracking-[0.15em] text-[var(--color-grey)] font-bold mb-4">Try an example</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {examples.map(ex => (
              <button key={ex.url} onClick={() => { setUrl(ex.url); navigate({ to: "/article", search: { url: ex.url } }); }} className="px-3 py-1.5 font-serif italic text-sm text-[var(--color-grey-dark)] bg-[var(--color-cream-dark)] hover:bg-[var(--color-grey-light)] transition-colors">
                {ex.title}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}