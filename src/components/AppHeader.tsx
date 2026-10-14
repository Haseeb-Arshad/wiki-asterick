import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuthActions, useSession } from "../lib/auth";
import { useHideOnScroll, useOutsidePress } from "../lib/hooks";
import { themeStore, type ThemePreference } from "../lib/preferences";
import { modKey, setPaletteOpen } from "../lib/search";
import { toast } from "../lib/toast";
import { AsteriskMark } from "./AsteriskIcon";
import { Icon, type IconName } from "./Icon";

const THEMES: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: "system", label: "Auto", icon: "monitor" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];

const SECTIONS = [
  { to: "/", label: "Discover", isActive: (path: string) => path === "/" || path === "/search" },
  { to: "/library", label: "Library", isActive: (path: string) => path.startsWith("/library") },
] as const;

/**
 * Floating navigation: a brand pill and section switcher on the left, round
 * icon buttons on the right. In the reader it slides away while scrolling down.
 */
export function AppHeader() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const hidden = useHideOnScroll(160);
  const isReader = pathname.startsWith("/read/");

  return (
    <header className={`app-header ${isReader && hidden ? "is-hidden" : ""}`}>
      <div className="header-inner">
        <div className="nav-cluster">
          <Link to="/" className="nav-pill brand-pill" aria-label="WikiAsterisk home">
            <AsteriskMark size={18} />
            <span className="brand-word">WikiAsterisk</span>
          </Link>
          <nav className="nav-pill segmented-nav" aria-label="Main">
            {SECTIONS.map((section) => (
              <Link key={section.to} to={section.to} className="seg-link" aria-current={section.isActive(pathname) ? "page" : undefined}>
                {section.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="nav-cluster">
          <button
            type="button"
            className="nav-circle"
            onClick={() => setPaletteOpen(true)}
            aria-label={`Search articles (${modKey}+K)`}
            data-hint={`Search · ${modKey} K`}
          >
            <Icon name="search" size={18} />
          </button>
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

function ThemeSwitcher() {
  const theme = themeStore.use();
  return (
    <div className="segmented" role="group" aria-label="Theme">
      {THEMES.map((option) => (
        <button key={option.value} type="button" aria-pressed={theme === option.value} onClick={() => themeStore.set(option.value)}>
          <Icon name={option.icon} size={14} />
          {option.label}
        </button>
      ))}
    </div>
  );
}

function AccountMenu() {
  const { user, isLoading } = useSession();
  const { signOut } = useAuthActions();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useOutsidePress([anchorRef], () => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (isLoading) return <span className="nav-circle" aria-hidden="true" />;

  const initials = user?.name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="menu-anchor" ref={anchorRef}>
      <button
        type="button"
        className={`nav-circle ${user ? "is-avatar" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={user ? `Account menu for ${user.name}` : "Menu"}
        onClick={() => setOpen((value) => !value)}
      >
        {user ? initials : <Icon name="user" size={18} />}
      </button>

      {open && (
        <div className="menu" role="menu">
          {user ? (
            <>
              <div className="menu-header">
                <strong>{user.name}</strong>
                <span>{user.email}</span>
              </div>
              <Link to="/library" className="menu-item" role="menuitem" onClick={() => setOpen(false)}>
                <Icon name="library" size={17} /> Library
              </Link>
              <Link to="/account" className="menu-item" role="menuitem" onClick={() => setOpen(false)}>
                <Icon name="user" size={17} /> Account settings
              </Link>
              <div className="menu-separator" />
              <ThemeSwitcher />
              <div className="menu-separator" />
              <button
                type="button"
                className="menu-item"
                role="menuitem"
                onClick={async () => {
                  setOpen(false);
                  await signOut();
                  toast("Signed out. Your library stays safe in your account.");
                  if (pathname === "/account") navigate({ to: "/" });
                }}
              >
                <Icon name="logOut" size={17} /> Sign out
              </button>
            </>
          ) : (
            <>
              <div className="menu-header">
                <strong>Reading as a guest</strong>
                <span>Sign in to sync highlights across devices.</span>
              </div>
              <Link to="/signin" search={{ redirect: pathname }} className="menu-item" role="menuitem" onClick={() => setOpen(false)}>
                <Icon name="user" size={17} /> Sign in
              </Link>
              <Link to="/signup" search={{ redirect: pathname }} className="menu-item" role="menuitem" onClick={() => setOpen(false)}>
                <Icon name="check" size={17} /> Create a free account
              </Link>
              <div className="menu-separator" />
              <ThemeSwitcher />
            </>
          )}
        </div>
      )}
    </div>
  );
}
