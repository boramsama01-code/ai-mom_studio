import type { CSSProperties } from "react";

const paths = {
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  undo: "M9 4 4 9l5 5 M4 9h10a6 6 0 0 1 0 12h-3",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  sun: "M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6l1.4 1.4 M17 17l1.4 1.4 M5.6 18.4 7 17 M17 7l1.4-1.4 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  inbox: "M4 4h16l2 12v4H2v-4L4 4z M2 14h6l2 3h4l2-3h6",
  pen: "m15 4 5 5 M4 15 15.5 3.5a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3L9 20l-6 1z",
  send: "m21 3-7 18-4-7-7-4 18-7z M10 14 21 3",
  search: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0 M15 15l6 6",
  sliders: "M4 5h7 M15 5h5 M4 12h2 M10 12h10 M4 19h11 M19 19h1 M11 2v6 M6 9v6 M15 16v6",
  design: "M3 3h18v18H3z M3 9h18 M9 9v12",
  link: "m9 15 6-6 M7 14l-2 2a3.5 3.5 0 0 0 5 5l4-4a3.5 3.5 0 0 0 0-5 M17 10l2-2a3.5 3.5 0 0 0-5-5l-4 4a3.5 3.5 0 0 0 0 5",
  channels: "M4 4h16v5H4z M4 15h16v5H4z M8 6.5h0 M8 17.5h0",
  refresh: "M20 7V3l-3 3 M4 17v4l3-3 M20 7a9 9 0 0 0-16 3 M4 17a9 9 0 0 0 16-3",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  close: "m6 6 12 12 M6 18 18 6",
  arrow: "M4 12h16 M14 6l6 6-6 6",
  plus: "M12 4v16 M4 12h16",
  board: "M3 4h5v16H3z M10 4h5v12h-5z M17 4h4v9h-4z",
  chevron: "m9 5 7 7-7 7",
  check: "m5 12 4 4L19 6",
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg className="ui-icon" aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={style}><path d={paths[name]} /></svg>;
}
