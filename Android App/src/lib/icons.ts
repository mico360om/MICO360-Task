/**
 * The website's own icons as data, drawn by components/Icon.tsx with react-native-svg — no emoji.
 * Each group is copied from one website file (lib/icons.test.ts fails when the website changes it):
 *   nav     — components/Sidebar.tsx `I` (the menu; stroke 1.8, its NavIcon)
 *   kit     — components/meeting/kit.tsx `Icon` (stroke 1.9 unless the icon sets its own)
 *   ui      — components/chat/icons.tsx (each its own stroke; the ticks are `Ticks`)
 *   project — lib/project-icons.tsx PROJECT_ICON_PATHS (stroke 1.9)
 *   misc    — single icons from the files named in `source`
 *   cal     — components/calendar/calendar-ui.tsx STATUS_META (each calendar status; stroke 2.2)
 * Names are `<group>.<key>` (`nav.dashboard`, `project.rocket`, `misc.waiting`).
 */
import type { ProjectIconKey } from './project-identity';

export type { ProjectIconKey };

export type Shape =
  | { el: 'path'; d: string; fill?: boolean; fillOpacity?: number }
  | { el: 'circle'; cx: number; cy: number; r: number; fill?: boolean }
  | { el: 'rect'; x: number; y: number; width: number; height: number; rx?: number };

export interface IconDef {
  shapes: readonly Shape[];
  strokeWidth: number;
  /** '0 0 24 24' when absent. */
  viewBox?: string;
  /** Painted in the icon colour (a stroke of 0 draws no outline). */
  filled?: boolean;
}

const p = (d: string, paint?: { fill?: boolean; fillOpacity?: number }): Shape => ({ el: 'path', d, ...paint });
const c = (cx: number, cy: number, r: number): Shape => ({ el: 'circle', cx, cy, r });
const r = (x: number, y: number, width: number, height: number, rx?: number): Shape =>
  rx === undefined ? { el: 'rect', x, y, width, height } : { el: 'rect', x, y, width, height, rx };

/** The menu icons — Sidebar.tsx `I`, in its order. */
const NAV_DATA = {
  chat: { strokeWidth: 1.8, shapes: [p('M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z')] },
  dashboard: { strokeWidth: 1.8, shapes: [r(3, 3, 7, 7, 1.5), r(14, 3, 7, 7, 1.5), r(3, 14, 7, 7, 1.5), r(14, 14, 7, 7, 1.5)] },
  tasks: { strokeWidth: 1.8, shapes: [r(3, 3, 18, 18, 2.5), p('M8 12l2.5 2.5L16 9')] },
  board: { strokeWidth: 1.8, shapes: [r(3, 3, 18, 18, 2.5), p('M9 3v18M15 3v18')] },
  projects: { strokeWidth: 1.8, shapes: [p('M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z')] },
  calendar: { strokeWidth: 1.8, shapes: [r(3, 4.5, 18, 16.5, 2.5), p('M3 9.5h18M8 2.5v4M16 2.5v4')] },
  timeline: { strokeWidth: 1.8, shapes: [p('M3 4v16'), r(6, 5, 9, 3.5, 1.2), r(9, 10.25, 11, 3.5, 1.2), r(6, 15.5, 6, 3.5, 1.2)] },
  workload: { strokeWidth: 1.8, shapes: [c(8, 7, 2.6), p('M3.5 16a4.5 4.5 0 0 1 9 0'), p('M15 20v-4M18 20v-7M21 20v-10')] },
  reports: { strokeWidth: 1.8, shapes: [p('M3 21h18'), p('M6 21v-6M11 21V8M16 21v-9')] },
  management: { strokeWidth: 1.8, shapes: [c(12, 12, 8.5), p('M12 12l4.5-4.5'), p('M12 3.5V6M20.5 12H18M3.5 12H6')] },
  notifications: { strokeWidth: 1.8, shapes: [p('M18 8.5a6 6 0 1 0-12 0c0 6.5-2.5 7.5-2.5 7.5h17S18 15 18 8.5'), p('M10.3 20a2 2 0 0 0 3.4 0')] },
  activity: { strokeWidth: 1.8, shapes: [p('M3 12h4l2.5 7 5-14 2.5 7H21')] },
  meetings: { strokeWidth: 1.8, shapes: [c(8, 6.5, 2.4), c(16, 6.5, 2.4), p('M4 13.5a4 4 0 0 1 8 0M12 13.5a4 4 0 0 1 8 0'), p('M2.5 15.5h19M5 15.5V21M19 15.5V21')] },
  actionItems: { strokeWidth: 1.8, shapes: [p('M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5L7.5 17'), p('M11 6.5h9.5M11 12.5h9.5M11 18.5h9.5')] },
  settings: { strokeWidth: 1.8, shapes: [p('M4 7h16M4 12h16M4 17h16'), c(9, 7, 2), c(15, 12, 2), c(8, 17, 2)] },
  users: { strokeWidth: 1.8, shapes: [c(10, 8, 3.2), p('M4 20a6 6 0 0 1 12 0'), c(18.5, 15.5, 2.2)] },
  sliders: { strokeWidth: 1.8, shapes: [c(12, 12, 3), p('M12 2v3M12 19v3M20 12h-3M7 12H4M17.7 6.3l-2 2M8.3 15.7l-2 2M17.7 17.7l-2-2M8.3 8.3l-2-2')] },
  audit: { strokeWidth: 1.8, shapes: [p('M12 3l7 3v5c0 5-3 8-7 9.5C8 19 5 16 5 11V6z'), p('M9 11.5l2 2 4-4')] },
  templates: { strokeWidth: 1.8, shapes: [r(8, 8, 13, 13, 2), p('M4 16V6a2 2 0 0 1 2-2h10'), p('M11.5 12.5h6M11.5 16.5h3.5')] },
  ai: { strokeWidth: 1.8, shapes: [p('M12 3l1.6 4.2L18 8.8l-4.4 1.6L12 15l-1.6-4.6L6 8.8l4.4-1.6z'), p('M18 14l.7 1.9L21 16.6l-2.3.7L18 20l-.7-2.3-2.3-.8 2.3-.9z')] },
  aiManagement: { strokeWidth: 1.8, shapes: [r(5.5, 5.5, 13, 13, 2.5), p('M9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3'), p('M12 8.6l.9 2.5 2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9z')] },
} satisfies Record<string, IconDef>;
export type NavKey = keyof typeof NAV_DATA;
export const NAV_ICONS: Record<NavKey, IconDef> = NAV_DATA;

/** Meeting icons — meeting/kit.tsx `Icon`. */
const KIT_DATA = {
  calendar: { strokeWidth: 1.9, shapes: [r(3, 4.5, 18, 16, 2), p('M3 9.5h18M8 3v3M16 3v3')] },
  clock: { strokeWidth: 1.9, shapes: [c(12, 12, 9), p('M12 7v5l3 2')] },
  globe: { strokeWidth: 1.9, shapes: [c(12, 12, 9), p('M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18')] },
  pin: { strokeWidth: 1.9, shapes: [p('M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z'), c(12, 9.5, 2.5)] },
  video: { strokeWidth: 1.9, shapes: [r(3, 6, 13, 12, 2), p('m16 10 5-3v10l-5-3')] },
  user: { strokeWidth: 1.9, shapes: [c(12, 8, 4), p('M4 21a8 8 0 0 1 16 0')] },
  folder: { strokeWidth: 1.9, shapes: [p('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z')] },
  mail: { strokeWidth: 1.9, shapes: [r(3, 5, 18, 14, 2), p('m3 7 9 6 9-6')] },
  up: { strokeWidth: 1.9, shapes: [p('m6 15 6-6 6 6')] },
  down: { strokeWidth: 1.9, shapes: [p('m6 9 6 6 6-6')] },
  edit: { strokeWidth: 1.9, shapes: [p('M4 20h4L19 9l-4-4L4 16z'), p('m13 7 4 4')] },
  star: { strokeWidth: 1.9, shapes: [p('m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z')] },
  task: { strokeWidth: 1.9, shapes: [r(4, 4, 16, 16, 3), p('m8.5 12 2.5 2.5 4.5-5')] },
  repeat: { strokeWidth: 1.9, shapes: [p('M17 2l4 4-4 4'), p('M3 11V9a3 3 0 0 1 3-3h15'), p('M7 22l-4-4 4-4'), p('M21 13v2a3 3 0 0 1-3 3H3')] },
  lock: { strokeWidth: 1.9, shapes: [r(4.5, 10.5, 15, 10, 2), p('M8 10.5V7.5a4 4 0 0 1 8 0v3')] },
  checkCircle: { strokeWidth: 1.9, shapes: [c(12, 12, 9), p('m8 12.5 2.8 2.8L16.5 9.5')] },
  chat: { strokeWidth: 1.7, shapes: [p('M20.5 11.5a8 8 0 0 1-11.7 7.1L3.5 20l1.4-5.1A8 8 0 1 1 20.5 11.5z')] },
  pause: { strokeWidth: 2.4, shapes: [p('M9 5v14M15 5v14')] },
  play: { strokeWidth: 2.2, shapes: [p('M7 4.5v15l12-7.5z')] },
} satisfies Record<string, IconDef>;
export type KitKey = keyof typeof KIT_DATA;
export const KIT_ICONS: Record<KitKey, IconDef> = KIT_DATA;

/** Everyday line icons — chat/icons.tsx (StarIcon filled → starFilled; Ticks → tick, tickDouble). */
const UI_DATA = {
  back: { strokeWidth: 2, shapes: [p('M15 18l-6-6 6-6')] },
  search: { strokeWidth: 1.8, shapes: [c(11, 11, 7), p('m20 20-3.5-3.5')] },
  plus: { strokeWidth: 2, shapes: [p('M12 5v14M5 12h14')] },
  close: { strokeWidth: 2, shapes: [p('M18 6 6 18M6 6l12 12')] },
  chevron: { strokeWidth: 2, shapes: [p('m6 9 6 6 6-6')] },
  more: { strokeWidth: 2.4, shapes: [p('M5 12h.01M12 12h.01M19 12h.01')] },
  send: { strokeWidth: 1.8, shapes: [p('M22 2 11 13'), p('M22 2 15 22l-4-9-9-4 20-7z')] },
  paperclip: { strokeWidth: 1.8, shapes: [p('M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48')] },
  smile: { strokeWidth: 1.8, shapes: [c(12, 12, 9), p('M8 14s1.5 2 4 2 4-2 4-2'), p('M9 9h.01M15 9h.01')] },
  reply: { strokeWidth: 1.8, shapes: [p('M9 17 4 12l5-5'), p('M20 18v-2a4 4 0 0 0-4-4H4')] },
  copy: { strokeWidth: 1.8, shapes: [r(9, 9, 13, 13, 2), p('M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1')] },
  edit: { strokeWidth: 1.8, shapes: [p('M12 20h9'), p('M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z')] },
  trash: { strokeWidth: 1.8, shapes: [p('M3 6h18'), p('M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'), p('M10 11v6M14 11v6'), p('M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2')] },
  users: { strokeWidth: 1.8, shapes: [p('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'), c(9, 7, 4), p('M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75')] },
  bell: { strokeWidth: 1.8, shapes: [p('M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9'), p('M13.73 21a2 2 0 0 1-3.46 0')] },
  bellOff: { strokeWidth: 1.8, shapes: [p('M13.73 21a2 2 0 0 1-3.46 0'), p('M18.63 13A17.9 17.9 0 0 1 18 8'), p('M6.26 6.26A5.9 5.9 0 0 0 6 8c0 7-3 9-3 9h14'), p('M18 8a6 6 0 0 0-9.33-5'), p('m1 1 22 22')] },
  star: { strokeWidth: 1.8, shapes: [p('m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z')] },
  starFilled: { strokeWidth: 1.8, filled: true, shapes: [p('m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z')] },
  archive: { strokeWidth: 1.8, shapes: [r(2, 3, 20, 5, 1), p('M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8'), p('M10 12h4')] },
  volume: { strokeWidth: 1.8, shapes: [p('M11 5 6 9H2v6h4l5 4V5z'), p('M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14')] },
  volumeOff: { strokeWidth: 1.8, shapes: [p('M11 5 6 9H2v6h4l5 4V5z'), p('m23 9-6 6M17 9l6 6')] },
  file: { strokeWidth: 1.8, shapes: [p('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'), p('M14 2v6h6')] },
  download: { strokeWidth: 1.8, shapes: [p('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), p('m7 10 5 5 5-5'), p('M12 15V3')] },
  clock: { strokeWidth: 1.8, shapes: [c(12, 12, 9), p('M12 7v5l3 2')] },
  alert: { strokeWidth: 1.8, shapes: [c(12, 12, 9), p('M12 8v4M12 16h.01')] },
  hash: { strokeWidth: 2.2, shapes: [p('M4 9h16M4 15h16M10 3 8 21M16 3l-2 18')] },
  arrowDown: { strokeWidth: 2, shapes: [p('M12 5v14M19 12l-7 7-7-7')] },
  message: { strokeWidth: 1.8, shapes: [p('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z')] },
  wifiOff: { strokeWidth: 1.8, shapes: [p('m1 1 22 22'), p('M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01')] },
  tick: { strokeWidth: 2, viewBox: '0 0 20 12', shapes: [p('M1 6.5 5 10.5 15 1.5')] },
  tickDouble: { strokeWidth: 2, viewBox: '0 0 20 12', shapes: [p('M1 6.5 5 10.5 15 1.5'), p('M5 6.5 9 10.5 19 1.5')] },
} satisfies Record<string, IconDef>;
export type UiKey = keyof typeof UI_DATA;
export const UI_ICONS: Record<UiKey, IconDef> = UI_DATA;

/** Project pictures — project-icons.tsx PROJECT_ICON_PATHS, in PROJECT_ICON_KEYS order. */
export const PROJECT_ICONS: Record<ProjectIconKey, IconDef> = {
  briefcase: { strokeWidth: 1.9, shapes: [p('M3 8h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z'), p('M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'), p('M3 13h18')] },
  rocket: { strokeWidth: 1.9, shapes: [p('M5 15c-1.5 1-2 4-2 4s3-.5 4-2'), p('M9 15l-3-3c1-5 5-9 12-9 0 7-4 11-9 12z'), p('M14 7.5a1.5 1.5 0 1 0 0 .01')] },
  building: { strokeWidth: 1.9, shapes: [p('M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16'), p('M15 9h4a1 1 0 0 1 1 1v11'), p('M8 8h3M8 12h3M8 16h3'), p('M3 21h18')] },
  chart: { strokeWidth: 1.9, shapes: [p('M4 20V4'), p('M4 20h16'), p('M8 16v-4M12 16V8M16 16v-6')] },
  code: { strokeWidth: 1.9, shapes: [p('M8 8l-4 4 4 4'), p('M16 8l4 4-4 4'), p('M13.5 5l-3 14')] },
  cog: { strokeWidth: 1.9, shapes: [p('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'), p('M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1')] },
  globe: { strokeWidth: 1.9, shapes: [p('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z'), p('M3 12h18'), p('M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z')] },
  heart: { strokeWidth: 1.9, shapes: [p('M12 20s-7-4.4-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.6-9 9-9 9z')] },
  leaf: { strokeWidth: 1.9, shapes: [p('M5 19c0-8 5-14 15-15-1 10-7 15-15 15z'), p('M5 19c3-4 6-7 10-9')] },
  bulb: { strokeWidth: 1.9, shapes: [p('M9 18h6'), p('M10 21h4'), p('M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z')] },
  megaphone: { strokeWidth: 1.9, shapes: [p('M3 10v4a1 1 0 0 0 1 1h3l9 5V4L7 9H4a1 1 0 0 0-1 1z'), p('M7 15l1 5h3l-1-4.4'), p('M19 9.5a3 3 0 0 1 0 5')] },
  shield: { strokeWidth: 1.9, shapes: [p('M12 3l8 3v6c0 5-3.4 8.3-8 9-4.6-.7-8-4-8-9V6z'), p('M9 12l2 2 4-4')] },
  star: { strokeWidth: 1.9, shapes: [p('M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z')] },
  truck: { strokeWidth: 1.9, shapes: [p('M3 6h11v10H3z'), p('M14 10h4l3 3v3h-7z'), p('M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z')] },
  users: { strokeWidth: 1.9, shapes: [p('M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'), p('M2 21a7 7 0 0 1 14 0'), p('M16 3.5a4 4 0 0 1 0 7'), p('M18 14a6 6 0 0 1 4 7')] },
  wrench: { strokeWidth: 1.9, shapes: [p('M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z')] },
  flask: { strokeWidth: 1.9, shapes: [p('M9 3h6'), p('M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3'), p('M7 15h10')] },
  book: { strokeWidth: 1.9, shapes: [p('M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z'), p('M4 19a2 2 0 0 1 2-2h13'), p('M9 7h6')] },
  camera: { strokeWidth: 1.9, shapes: [p('M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z'), p('M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z')] },
  cart: { strokeWidth: 1.9, shapes: [p('M3 4h2l2.4 11h11l2-8H6.2'), p('M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z')] },
  plane: { strokeWidth: 1.9, shapes: [p('M21 15l-8-4V5a1.5 1.5 0 0 0-3 0v6l-8 4v2l8-2v4l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-4l8 2z')] },
  ship: { strokeWidth: 1.9, shapes: [p('M3 17l2 4h14l2-4z'), p('M5 17V11h14v6'), p('M8 11V7h8v4'), p('M12 3v4')] },
  bolt: { strokeWidth: 1.9, shapes: [p('M13 2L4 14h7l-1 8 9-12h-7z')] },
  oil: { strokeWidth: 1.9, shapes: [p('M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z'), p('M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5')] },
};

/** Single icons, each copied from the website file named in `source` (under frontend/src). */
const MISC_DATA = {
  waiting: { source: 'components/approvals/ApprovalChip.tsx', strokeWidth: 2.2, shapes: [p('M6 3h12M6 21h12M7 3v3a5 5 0 0 0 10 0V3M7 21v-3a5 5 0 0 1 10 0v3')] },
  milestone: { source: 'components/TaskCard.tsx', strokeWidth: 2, shapes: [p('M5 21V4'), p('M5 4h11l-2 4 2 4H5', { fill: true, fillOpacity: 0.18 })] },
  eye: { source: 'components/TaskCard.tsx', strokeWidth: 2, shapes: [p('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z'), c(12, 12, 3)] },
  menu: { source: 'components/AppShell.tsx', strokeWidth: 2, shapes: [p('M4 7h16M4 12h16M4 17h16')] },
  check: { source: 'components/BulkActionBar.tsx', strokeWidth: 2.2, shapes: [p('M20 6 9 17l-5-5')] },
  dots: { source: 'components/board/CardMenu.tsx', strokeWidth: 0, filled: true, shapes: [c(5, 12, 1.8), c(12, 12, 1.8), c(19, 12, 1.8)] },
  info: { source: 'components/ProfileMenu.tsx', strokeWidth: 1.8, shapes: [c(12, 12, 9), p('M12 11v5M12 7.5v.01')] },
  signOut: { source: 'components/ProfileMenu.tsx', strokeWidth: 1.8, shapes: [p('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9')] },
  inbox: { source: 'components/ui/EmptyState.tsx', strokeWidth: 1.8, shapes: [p('M22 12h-6l-2 3h-4l-2-3H2'), p('M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z')] },
  inspection: { source: 'components/inspections/inspection-ui.tsx', strokeWidth: 2.2, shapes: [r(5, 4, 14, 17, 2), p('M9 4V3h6v1M9 12l2 2 4-4')] },
} satisfies Record<string, IconDef & { source: string }>;
export type MiscKey = keyof typeof MISC_DATA;
export const MISC_ICONS: Record<MiscKey, IconDef & { source: string }> = MISC_DATA;

/** The calendar's status signs — calendar-ui.tsx STATUS_META, keyed by the calendar status (lib/calendar-model CalStatus). */
const CAL_DATA = {
  overdue: { strokeWidth: 2.2, shapes: [c(12, 12, 9), p('M12 7v6M12 16.5h.01')] },
  blocked: { strokeWidth: 2.2, shapes: [c(12, 12, 9), p('m5.6 5.6 12.8 12.8')] },
  'in-progress': { strokeWidth: 2.2, shapes: [c(12, 12, 9), p('M12 3a9 9 0 0 1 0 18z', { fill: true })] },
  todo: { strokeWidth: 2.2, shapes: [c(12, 12, 9)] },
  done: { strokeWidth: 2.2, shapes: [c(12, 12, 9), p('m8 12.5 2.5 2.5L16 9.5')] },
  projected: { strokeWidth: 2.2, shapes: [p('M17 2l4 4-4 4'), p('M3 11v-1a4 4 0 0 1 4-4h14'), p('M7 22l-4-4 4-4'), p('M21 13v1a4 4 0 0 1-4 4H3')] },
} satisfies Record<string, IconDef>;
export type CalKey = keyof typeof CAL_DATA;
export const CAL_ICONS: Record<CalKey, IconDef> = CAL_DATA;

export type IconName = `nav.${NavKey}` | `kit.${KitKey}` | `ui.${UiKey}` | `project.${ProjectIconKey}` | `misc.${MiscKey}` | `cal.${CalKey}`;

const GROUPS: Record<string, Record<string, IconDef>> = { nav: NAV_ICONS, kit: KIT_ICONS, ui: UI_ICONS, project: PROJECT_ICONS, misc: MISC_ICONS, cal: CAL_ICONS };

/** Every icon name, group by group. */
export const ICON_NAMES: readonly IconName[] = Object.entries(GROUPS).flatMap(([group, icons]) => Object.keys(icons).map((key) => `${group}.${key}` as IconName));

const NAMES = new Set<string>(ICON_NAMES);

export function isIconName(v: unknown): v is IconName {
  return typeof v === 'string' && NAMES.has(v);
}

export function iconDef(name: IconName): IconDef {
  const dot = name.indexOf('.');
  return GROUPS[name.slice(0, dot)]![name.slice(dot + 1)]!;
}
