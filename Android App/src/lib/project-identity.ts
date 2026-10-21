/**
 * A project's identity on the phone (5b), as the website shows it everywhere: its picture (only
 * one stored on this server, '/uploads/…'), else its icon on its colour, else its initials; and its
 * status and priority in words. The icon names are the server's (backend
 * modules/projects/project-icons.ts) and the labels, colours and code rules the website's
 * (frontend lib/project-icons.tsx); a test keeps them equal. The phone has no vector drawing, so
 * each icon is drawn as a matching symbol on the project's colour. Pure TypeScript.
 */
import { serverUploadHref } from './attachments';
import type { Tone } from './tone';

/** The icons a project may use, in the server's order (it refuses any other name). */
export const PROJECT_ICON_KEYS = [
  'briefcase',
  'rocket',
  'building',
  'chart',
  'code',
  'cog',
  'globe',
  'heart',
  'leaf',
  'bulb',
  'megaphone',
  'shield',
  'star',
  'truck',
  'users',
  'wrench',
  'flask',
  'book',
  'camera',
  'cart',
  'plane',
  'ship',
  'bolt',
  'oil',
] as const;

export type ProjectIconKey = (typeof PROJECT_ICON_KEYS)[number];

export const isProjectIcon = (v: unknown): v is ProjectIconKey => typeof v === 'string' && (PROJECT_ICON_KEYS as readonly string[]).includes(v);

/** Words people would call each icon (its accessible name), as on the website. */
export const PROJECT_ICON_LABEL: Record<ProjectIconKey, string> = {
  briefcase: 'Briefcase', rocket: 'Rocket', building: 'Building', chart: 'Chart', code: 'Code', cog: 'Gear', globe: 'Globe', heart: 'Heart',
  leaf: 'Leaf', bulb: 'Light bulb', megaphone: 'Megaphone', shield: 'Shield', star: 'Star', truck: 'Truck', users: 'People', wrench: 'Wrench',
  flask: 'Flask', book: 'Book', camera: 'Camera', cart: 'Cart', plane: 'Plane', ship: 'Ship', bolt: 'Lightning', oil: 'Oil drop',
};

/** The symbol the phone draws for each icon (one each, so no two look alike). */
export const PROJECT_ICON_GLYPH: Record<ProjectIconKey, string> = {
  briefcase: '💼', rocket: '🚀', building: '🏢', chart: '📊', code: '💻', cog: '⚙️', globe: '🌐', heart: '❤️',
  leaf: '🍃', bulb: '💡', megaphone: '📣', shield: '🛡️', star: '⭐', truck: '🚚', users: '👥', wrench: '🔧',
  flask: '🧪', book: '📖', camera: '📷', cart: '🛒', plane: '✈️', ship: '🚢', bolt: '⚡', oil: '🛢️',
};

/** The colours on offer, as on the website (each readable with the text colour readableOn picks). */
export const PROJECT_COLORS = ['#8B1E1E', '#B5432E', '#C2410C', '#B7791F', '#4D7C0F', '#2E7D53', '#0F766E', '#0E7490', '#1E5A8B', '#4338CA', '#7A5AA8', '#9D174D', '#475569', '#1F2937'];

/** What people call the colours on offer (each swatch's accessible name), as on the website. */
export const COLOR_NAMES: Record<string, string> = {
  '#8B1E1E': 'Maroon', '#B5432E': 'Brick', '#C2410C': 'Orange', '#B7791F': 'Amber', '#4D7C0F': 'Olive', '#2E7D53': 'Green', '#0F766E': 'Teal',
  '#0E7490': 'Cyan', '#1E5A8B': 'Blue', '#4338CA': 'Indigo', '#7A5AA8': 'Violet', '#9D174D': 'Berry', '#475569': 'Slate', '#1F2937': 'Charcoal',
};

/** A new project's colour, and the one shown when a project has none. */
export const DEFAULT_PROJECT_COLOR = '#8B1E1E';

/** A colour as #RRGGBB (the server's rule). */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Task keys are "<code>-<number>": 2–10 capital letters or digits, starting with a letter. */
export const CODE_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

/** A colour's name: one on offer by its name, any other by its code. */
export function colorName(hex: string): string {
  const key = hex.trim().toUpperCase();
  return COLOR_NAMES[key] ?? `Custom colour ${key}`;
}

/** A typed colour code ("#1e5a8b" or "1e5a8b") as #RRGGBB, or null when it isn't one. */
export function customColor(text: string): string | null {
  const t = text.trim();
  const hex = t.startsWith('#') ? t : `#${t}`;
  return HEX_COLOR.test(hex) ? hex.toUpperCase() : null;
}

/** White or near-black, whichever reads better on the colour (the website's rule). */
export function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1]!, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  return lum > 0.45 ? '#1f1a17' : '#ffffff';
}

/** Two letters for the tile: the first letters of the first two words (any script). */
export function projectInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const pick = words.length > 1 ? `${[...words[0]!][0]}${[...words[1]!][0]}` : [...words[0]!].slice(0, 2).join('');
  return pick.toLocaleUpperCase();
}

/** Why a code can't be used (null when it can), in the website's words. */
export function codeProblem(code: string): string | null {
  const c = code.trim();
  if (!c) return 'A project needs a code.';
  if (!/^[A-Za-z0-9]+$/.test(c)) return 'Use letters and digits only (no spaces or symbols).';
  if (!/^[A-Za-z]/.test(c)) return 'Codes start with a letter.';
  if (c.length < 2 || c.length > 10) return 'Use 2–10 letters or digits.';
  return null;
}

/** Accents taken off ("Café" → "Cafe"), where the phone can; the name as it is otherwise. */
function withoutAccents(name: string): string {
  try {
    return name.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  } catch {
    return name;
  }
}

/**
 * A code from the name, as the website suggests it: the first letters of up to four words ("Rig
 * Inspection Portal" → RIP), topped up to three from the last word ("Mobile App" → MAP), or the
 * first four letters of a single word. A name without Latin letters gets PRJ — the code can
 * always be edited.
 */
export function suggestCode(name: string): string {
  if (!name.trim()) return '';
  const words = withoutAccents(name).match(/[A-Za-z0-9]+/g) ?? [];
  if (!words.some((w) => /[A-Za-z]/.test(w))) return 'PRJ';
  let code = (words.length === 1 ? words[0]!.slice(0, 4) : words.slice(0, 4).map((w) => w[0]).join('')).toUpperCase().replace(/^[0-9]+/, '');
  if (code.length < 3) {
    const last = [...words].reverse().find((w) => /^[A-Za-z]/.test(w));
    if (last) code += last.slice(1, 1 + 3 - code.length).toUpperCase();
  }
  return code.slice(0, 10) || 'PRJ';
}

/** Where to load a project's picture from: only a file stored on this server ('/uploads/…'). */
export function projectPictureHref(apiBase: string, imageUrl: string | null | undefined): string | null {
  return serverUploadHref(apiBase, imageUrl);
}

/** What a project's tile shows: its picture (falling back to the rest if it doesn't load), its icon or its initials, on its colour. */
export interface ProjectLook {
  picture: string | null;
  glyph: string | null;
  initials: string;
  background: string;
  foreground: string;
  /** The project's name (the tile's accessible name when it stands alone). */
  label: string;
}

export function projectLook(project: { name: string; color?: string | null; icon?: string | null; imageUrl?: string | null }, apiBase: string): ProjectLook {
  const background = project.color && HEX_COLOR.test(project.color) ? project.color : DEFAULT_PROJECT_COLOR;
  return {
    picture: projectPictureHref(apiBase, project.imageUrl),
    glyph: isProjectIcon(project.icon) ? PROJECT_ICON_GLYPH[project.icon] : null,
    initials: projectInitials(project.name),
    background,
    foreground: readableOn(background),
    label: project.name,
  };
}

// ── Status and priority in words ─────────────────────────────────────────────
export const PROJECT_STATUSES = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

const STATUS_LABEL: Record<string, string> = { PLANNING: 'Planning', ACTIVE: 'Active', ON_HOLD: 'On hold', COMPLETED: 'Completed', ARCHIVED: 'Archived' };
const STATUS_TONE: Record<string, Tone> = { PLANNING: 'info', ACTIVE: 'success', ON_HOLD: 'warning', COMPLETED: 'brand', ARCHIVED: 'neutral' };
const PRIORITY_LABEL: Record<string, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

/** A code in words ("SOMETHING_NEW" → "Something new"), for a value this app doesn't know yet. */
const words = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

export function projectStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? words(status);
}

export function projectStatusTone(status: string): Tone {
  return STATUS_TONE[status] ?? 'neutral';
}

export function projectPriorityLabel(priority: string | null | undefined): string {
  if (!priority) return 'Normal';
  return PRIORITY_LABEL[priority] ?? words(priority);
}
