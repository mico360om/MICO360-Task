/**
 * A project’s identity on the server: the icons a project may use and their shapes (the web app
 * draws the same — see frontend/src/lib/project-icons.tsx; a test keeps them equal), its colour and its code.
 */
/** 24×24 outline paths for each icon (drawn by the minutes PDF; the web app has the same). */
export const PROJECT_ICON_PATHS = {
  briefcase: ['M3 8h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z', 'M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M3 13h18'],
  rocket: ['M5 15c-1.5 1-2 4-2 4s3-.5 4-2', 'M9 15l-3-3c1-5 5-9 12-9 0 7-4 11-9 12z', 'M14 7.5a1.5 1.5 0 1 0 0 .01'],
  building: ['M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16', 'M15 9h4a1 1 0 0 1 1 1v11', 'M8 8h3M8 12h3M8 16h3', 'M3 21h18'],
  chart: ['M4 20V4', 'M4 20h16', 'M8 16v-4M12 16V8M16 16v-6'],
  code: ['M8 8l-4 4 4 4', 'M16 8l4 4-4 4', 'M13.5 5l-3 14'],
  cog: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1'],
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z'],
  heart: ['M12 20s-7-4.4-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.6-9 9-9 9z'],
  leaf: ['M5 19c0-8 5-14 15-15-1 10-7 15-15 15z', 'M5 19c3-4 6-7 10-9'],
  bulb: ['M9 18h6', 'M10 21h4', 'M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z'],
  megaphone: ['M3 10v4a1 1 0 0 0 1 1h3l9 5V4L7 9H4a1 1 0 0 0-1 1z', 'M7 15l1 5h3l-1-4.4', 'M19 9.5a3 3 0 0 1 0 5'],
  shield: ['M12 3l8 3v6c0 5-3.4 8.3-8 9-4.6-.7-8-4-8-9V6z', 'M9 12l2 2 4-4'],
  star: ['M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z'],
  truck: ['M3 6h11v10H3z', 'M14 10h4l3 3v3h-7z', 'M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  users: ['M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M2 21a7 7 0 0 1 14 0', 'M16 3.5a4 4 0 0 1 0 7', 'M18 14a6 6 0 0 1 4 7'],
  wrench: ['M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z'],
  flask: ['M9 3h6', 'M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3', 'M7 15h10'],
  book: ['M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z', 'M4 19a2 2 0 0 1 2-2h13', 'M9 7h6'],
  camera: ['M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z', 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  cart: ['M3 4h2l2.4 11h11l2-8H6.2', 'M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
  plane: ['M21 15l-8-4V5a1.5 1.5 0 0 0-3 0v6l-8 4v2l8-2v4l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-4l8 2z'],
  ship: ['M3 17l2 4h14l2-4z', 'M5 17V11h14v6', 'M8 11V7h8v4', 'M12 3v4'],
  bolt: ['M13 2L4 14h7l-1 8 9-12h-7z'],
  oil: ['M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z', 'M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5'],
} as const;

export type ProjectIcon = keyof typeof PROJECT_ICON_PATHS;
export const PROJECT_ICONS = Object.keys(PROJECT_ICON_PATHS) as [ProjectIcon, ...ProjectIcon[]];

/** A colour as #RRGGBB (the project's tile and accents). */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Task keys are "<code>-<number>": 2–10 capital letters or digits, starting with a letter. */
export const CODE_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
export const CODE_RULE = 'Use 2–10 letters or digits, starting with a letter (for example MICO or HR2).';

export const normalizeCode = (code: string) => code.trim().toUpperCase();

/** The first free variant of a code: MICO → MICO2, MICO3 … (kept within 10 characters). */
export async function suggestFreeCode(code: string, inUse: (code: string) => Promise<boolean>): Promise<string | null> {
  const base = normalizeCode(code).replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]/.test(base)) return null;
  for (let n = 2; n < 1000; n++) {
    const suffix = String(n);
    const candidate = `${base.slice(0, 10 - suffix.length)}${suffix}`;
    if (CODE_PATTERN.test(candidate) && !(await inUse(candidate))) return candidate;
  }
  return null;
}
