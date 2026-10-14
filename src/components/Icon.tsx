import type { ReactNode, SVGProps } from "react";

/** 24×24 line icons drawn for this app, stroke-based so they inherit currentColor. */
const PATHS = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.4-4.4" />
    </>
  ),
  x: <path d="M17.5 6.5l-11 11M6.5 6.5l11 11" />,
  bookmark: <path d="M7 3.75h10a1 1 0 0 1 1 1v15.5l-6-3.9-6 3.9V4.75a1 1 0 0 1 1-1Z" />,
  bookmarkFilled: <path d="M7 3.75h10a1 1 0 0 1 1 1v15.5l-6-3.9-6 3.9V4.75a1 1 0 0 1 1-1Z" fill="currentColor" />,
  share: (
    <>
      <path d="M12 14.5V3.75M7.75 8 12 3.75 16.25 8" />
      <path d="M5 12.25v6.25a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6.25" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m20.5 15.5-4.6-4.6L6.5 19.5" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2.5" />
      <path d="m16 10.25 5-2.75v9l-5-2.75" />
    </>
  ),
  play: <path d="M8 5.6v12.8a.6.6 0 0 0 .9.5l10.2-6.4a.6.6 0 0 0 0-1L8.9 5.1a.6.6 0 0 0-.9.5Z" fill="currentColor" stroke="none" />,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" strokeWidth="2.4" />,
  pen: (
    <>
      <path d="M4.5 19.5h4l10.3-10.3a2.83 2.83 0 0 0-4-4L4.5 15.5v4Z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  note: (
    <>
      <path d="M5 4.5h14v9.75l-5.25 5.25H5Z" />
      <path d="M13.75 19.5v-5.25H19" />
    </>
  ),
  list: <path d="M4.25 6.5h.01M4.25 12h.01M4.25 17.5h.01M8.5 6.5h11M8.5 12h11M8.5 17.5h11" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.5 3.4 5.3 3.4 8.5s-1.1 6-3.4 8.5c-2.3-2.5-3.4-5.3-3.4-8.5s1.1-6 3.4-8.5Z" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  arrowRight: <path d="M4.5 12h15M13.5 6l6 6-6 6" />,
  arrowUp: <path d="M12 19.5v-15M6 10.5l6-6 6 6" />,
  external: <path d="M8 16 16.5 7.5M9.5 7.5h7v7" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </>
  ),
  link: (
    <path d="M10 14a4.5 4.5 0 0 0 6.36 0l3-3A4.5 4.5 0 0 0 13 4.64l-1 1M14 10a4.5 4.5 0 0 0-6.36 0l-3 3A4.5 4.5 0 0 0 11 19.36l1-1" />
  ),
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.2a1.5 1.5 0 0 0 1.5 1.3h6.4a1.5 1.5 0 0 0 1.5-1.3L17.5 7" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.75" />
      <path d="M12 2.75v2M12 19.25v2M5.46 5.46l1.41 1.41M17.13 17.13l1.41 1.41M2.75 12h2M19.25 12h2M5.46 18.54l1.41-1.41M17.13 6.87l1.41-1.41" />
    </>
  ),
  moon: <path d="M19.5 14.25A8 8 0 0 1 9.75 4.5a8 8 0 1 0 9.75 9.75Z" />,
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M8.5 20h7M12 16.5V20" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.75" />
      <path d="M4.75 20.25c1.2-3.5 3.9-5.25 7.25-5.25s6.05 1.75 7.25 5.25" />
    </>
  ),
  logOut: <path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M10 16.5 5.5 12 10 7.5M5.5 12h10" />,
  shuffle: (
    <path d="M3.75 7.25h3c4.75 0 5 9.5 9.75 9.5h3.75M3.75 16.75h3c1.5 0 2.6-1 3.4-2.5M17.25 4l3 3.25-3 3.25M17.25 13.5l3 3.25-3 3.25M13.35 9.75c.8-1.5 1.9-2.5 3.15-2.5h3.75" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  book: (
    <>
      <path d="M5 5.5a2 2 0 0 1 2-2h11.5v13.75H7a2 2 0 0 0-2 2V5.5Z" />
      <path d="M5 19.25a2 2 0 0 0 2 2h11.5v-4" />
    </>
  ),
  library: (
    <>
      <rect x="3.5" y="4" width="4.5" height="16" rx="1.2" />
      <rect x="9.75" y="7" width="4.5" height="13" rx="1.2" />
      <path d="m16 8.1 3.3-.85 2.9 11.5-3.3.85Z" />
    </>
  ),
  download: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />,
  keyboard: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 10h.01M11 10h.01M15 10h.01M7.5 14h9" />
    </>
  ),
  headphones: (
    <>
      <path d="M4.5 17v-4.5a7.5 7.5 0 0 1 15 0V17" />
      <rect x="3.5" y="14" width="4" height="6" rx="1.5" />
      <rect x="16.5" y="14" width="4" height="6" rx="1.5" />
    </>
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" />,
  trending: <path d="M3.5 16.5 9 11l4 4 7.5-7.5M15 7.5h5.5V13" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  newspaper: (
    <>
      <path d="M4.5 5.5h12v13a2 2 0 0 0 2 2h-12a2 2 0 0 1-2-2v-13Z" />
      <path d="M16.5 9.5h3v9a2 2 0 0 1-4 0M7.5 9.5h6M7.5 13h6M7.5 16.5h3.5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, strokeWidth = 1.6, ...props }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {PATHS[name]}
    </svg>
  );
}
