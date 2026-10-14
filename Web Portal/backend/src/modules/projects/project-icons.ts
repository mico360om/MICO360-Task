/**
 * A project's identity on the server: the icons a project may use (the web app draws them — see
 * frontend/src/lib/project-icons.tsx; a test keeps the two lists equal), its colour and its code.
 */
export const PROJECT_ICONS = [
  'briefcase', 'rocket', 'building', 'chart', 'code', 'cog', 'globe', 'heart', 'leaf', 'bulb', 'megaphone', 'shield',
  'star', 'truck', 'users', 'wrench', 'flask', 'book', 'camera', 'cart', 'plane', 'ship', 'bolt', 'oil',
] as const;
export type ProjectIcon = (typeof PROJECT_ICONS)[number];

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
