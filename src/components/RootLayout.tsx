import { Link, Outlet } from "@tanstack/react-router";
import { AsteriskMark } from "./AsteriskIcon";

export function RootLayout() {
  return (
    <div className="min-h-screen bg-[var(--color-cream)] flex flex-col">
      <header className="border-b border-[var(--color-grey-light)] bg-[var(--color-cream)] sticky top-0 z-50">
        <div className="max-w-[1380px] mx-auto px-5 h-12 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 no-underline">
            <AsteriskMark size={20} className="text-[var(--color-primary)]" />
            <span className="font-serif-display text-lg font-normal italic text-[var(--color-black)] tracking-tight">WikiAsterisk</span>
          </Link>
          <a href="https://en.wikipedia.org" target="_blank" rel="noopener noreferrer" className="font-sans text-[0.7rem] uppercase tracking-[0.12em] text-[var(--color-grey)] hover:text-[var(--color-primary)] no-underline transition-colors font-bold">Wikipedia</a>
        </div>
      </header>
      <main className="flex-1"><Outlet /></main>
    </div>
  );
}
