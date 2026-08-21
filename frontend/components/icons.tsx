// Minimal geometric line icons (1.6px stroke) — the interface icon system.
// No emoji as UI. Each takes an optional size; color inherits currentColor.

import type { JSX } from "react";

interface IconProps {
  size?: number;
}

function svg(size: number, children: JSX.Element): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const IconPlus = ({ size = 17 }: IconProps): JSX.Element =>
  svg(size, <><path d="M12 5v14" /><path d="M5 12h14" /></>);

export const IconImage = ({ size = 17 }: IconProps): JSX.Element =>
  svg(
    size,
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5-5-9 9" />
    </>,
  );

export const IconFile = ({ size = 17 }: IconProps): JSX.Element =>
  svg(
    size,
    <>
      <path d="M14 3v5h5" />
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    </>,
  );

export const IconCamera = ({ size = 17 }: IconProps): JSX.Element =>
  svg(
    size,
    <>
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.2" />
    </>,
  );

export const IconMonitor = ({ size = 17 }: IconProps): JSX.Element =>
  svg(
    size,
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M9 20h6M12 16v4" />
    </>,
  );

export const IconWave = ({ size = 16 }: IconProps): JSX.Element =>
  svg(
    size,
    <>
      <path d="M4 12v0" />
      <path d="M8 8v8" />
      <path d="M12 5v14" />
      <path d="M16 8v8" />
      <path d="M20 11v2" />
    </>,
  );

export const IconArrowUp = ({ size = 17 }: IconProps): JSX.Element =>
  svg(size, <><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></>);

export const IconSliders = ({ size = 17 }: IconProps): JSX.Element =>
  svg(
    size,
    <>
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
      <circle cx="16" cy="8" r="2" />
      <circle cx="10" cy="16" r="2" />
    </>,
  );

export const IconChevron = ({ size = 14 }: IconProps): JSX.Element =>
  svg(size, <path d="M6 9l6 6 6-6" />);

export const IconClose = ({ size = 16 }: IconProps): JSX.Element =>
  svg(size, <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>);

export const IconDot = ({ size = 8 }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 8 8" fill="currentColor">
    <circle cx="4" cy="4" r="4" />
  </svg>
);

export const IconSearch = ({ size = 16 }: IconProps): JSX.Element =>
  svg(size, <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>);

export const IconEllipsis = ({ size = 16 }: IconProps): JSX.Element =>
  svg(size, <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>);

export const IconPencil = ({ size = 15 }: IconProps): JSX.Element =>
  svg(size, <><path d="M4 20h4L18.5 9.5a2 2 0 0 0-3-3L5 17v3z" /><path d="M13.5 6.5l3 3" /></>);

export const IconPin = ({ size = 15 }: IconProps): JSX.Element =>
  svg(size, <><path d="M12 17v5" /><path d="M9 3h6l-1 7 3 3H7l3-3-1-7z" /></>);

export const IconArchive = ({ size = 15 }: IconProps): JSX.Element =>
  svg(size, <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></>);

export const IconTrash = ({ size = 15 }: IconProps): JSX.Element =>
  svg(size, <><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /></>);

export const IconMessage = ({ size = 16 }: IconProps): JSX.Element =>
  svg(size, <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />);

export const IconPanelLeft = ({ size = 17 }: IconProps): JSX.Element =>
  svg(size, <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>);

export const IconEdit = ({ size = 17 }: IconProps): JSX.Element =>
  svg(size, <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>);

export const IconGlobe = ({ size = 16 }: IconProps): JSX.Element =>
  svg(
    size,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
    </>,
  );

export const IconFolder = ({ size = 16 }: IconProps): JSX.Element =>
  svg(size, <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />);

export const IconChevronRight = ({ size = 14 }: IconProps): JSX.Element =>
  svg(size, <path d="M9 6l6 6-6 6" />);

export const IconCode = ({ size = 17 }: IconProps): JSX.Element =>
  svg(size, <><path d="M8 9l-3 3 3 3" /><path d="M16 9l3 3-3 3" /><path d="M13 6l-2 12" /></>);

export const IconBolt = ({ size = 17 }: IconProps): JSX.Element =>
  svg(size, <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />);

export const IconSparkles = ({ size = 16 }: IconProps): JSX.Element =>
  svg(
    size,
    <>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
      <path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" />
    </>,
  );

export const IconMoon = ({ size = 17 }: IconProps): JSX.Element =>
  svg(size, <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />);

export const IconSun = ({ size = 17 }: IconProps): JSX.Element =>
  svg(
    size,
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
    </>,
  );

// Solid square = Stop (matches the filled Send button's weight).
export const IconStop = ({ size = 15 }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2.5" />
  </svg>
);
