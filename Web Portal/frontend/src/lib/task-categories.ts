/**
 * Task categories (1.24): each project keeps its own list of categories (a name and one of 12 colours);
 * a task in the project can have several. Admins and the project's managers look after the list; a
 * project can ask that every task has one. Tags stay as they are (site-wide free labels). These are the
 * rules every part uses — names, the colours, how many chips a card shows, the Category filter, the
 * "Needs a category" mark and what a move to another project keeps — and the words. Shared byte-for-byte
 * by the website and the server (a copy test fails on drift). No imports: both sides load it on its own.
 */

/** The most characters a category's name can have. */
export const CATEGORY_NAME_MAX = 40;
/** The most categories one project can have (retired ones count). */
export const MAX_PROJECT_CATEGORIES = 60;
/** The most categories one task can have. */
export const MAX_TASK_CATEGORIES = 20;

export interface CategoryTone {
  /** The swatch: at least 3:1 against the page and cards. */
  fill: string;
  /** The name in this colour: at least 4.5:1 on the page, cards and its own tint. */
  text: string;
  /** A tint for the chip. */
  soft: string;
}

/**
 * The 12 colours a category can have — none of them a status, priority, overdue or health colour (those
 * mean something everywhere); a chip has a square swatch, never the round status dot.
 */
export const CATEGORY_TONES = {
  teal: { label: 'Teal', light: { fill: '#0F8A80', text: '#0B6B63', soft: '#E4F3F1' }, dark: { fill: '#36B3A7', text: '#5FCBC0', soft: '#1E3735' } },
  cyan: { label: 'Cyan', light: { fill: '#0A7EA0', text: '#086A87', soft: '#E3F2F7' }, dark: { fill: '#3AACCD', text: '#6BC4DE', soft: '#1E3440' } },
  indigo: { label: 'Indigo', light: { fill: '#5550D0', text: '#4540B8', soft: '#EDEDFB' }, dark: { fill: '#8F8BF0', text: '#ABA8F5', soft: '#2E2D47' } },
  navy: { label: 'Navy', light: { fill: '#2F4D99', text: '#29438A', soft: '#EAEEF8' }, dark: { fill: '#7894D9', text: '#9BB0E6', soft: '#28324A' } },
  pink: { label: 'Pink', light: { fill: '#C93D84', text: '#A8306C', soft: '#FBEAF2' }, dark: { fill: '#E66DAA', text: '#F094C0', soft: '#47293A' } },
  magenta: { label: 'Magenta', light: { fill: '#A83CAD', text: '#93329A', soft: '#F8EAF8' }, dark: { fill: '#D172D6', text: '#DE97E2', soft: '#432C45' } },
  lime: { label: 'Lime', light: { fill: '#5F8F14', text: '#4A700F', soft: '#EEF5E3' }, dark: { fill: '#8CC23C', text: '#A5D35F', soft: '#2F3A22' } },
  olive: { label: 'Olive', light: { fill: '#7D7D21', text: '#61611A', soft: '#F3F3E1' }, dark: { fill: '#B5B544', text: '#C9C96B', soft: '#383823' } },
  gold: { label: 'Gold', light: { fill: '#A8840F', text: '#7C610B', soft: '#FAF4DD' }, dark: { fill: '#D9B23A', text: '#E3C463', soft: '#423A20' } },
  brown: { label: 'Brown', light: { fill: '#91603A', text: '#7A4F2D', soft: '#F6EDE5' }, dark: { fill: '#C99568', text: '#D8AD87', soft: '#40332A' } },
  sand: { label: 'Sand', light: { fill: '#9B8464', text: '#6C5C46', soft: '#F5F0E9' }, dark: { fill: '#C4AE8E', text: '#D3C2A7', soft: '#3D372F' } },
  plum: { label: 'Plum', light: { fill: '#863272', text: '#752A63', soft: '#F6EAF2' }, dark: { fill: '#C77BB6', text: '#D79CC9', soft: '#422C3D' } },
} as const satisfies Record<string, { label: string; light: CategoryTone; dark: CategoryTone }>;

export type CategoryColor = keyof typeof CATEGORY_TONES;
export const CATEGORY_COLOR_KEYS = Object.keys(CATEGORY_TONES) as CategoryColor[];
/** A new category's colour when none is picked: the first one the project hasn't used yet. */
export function nextCategoryColor(used: string[]): CategoryColor {
  return CATEGORY_COLOR_KEYS.find((k) => !used.includes(k)) ?? CATEGORY_COLOR_KEYS[used.length % CATEGORY_COLOR_KEYS.length]!;
}

export function isCategoryColor(value: unknown): value is CategoryColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CATEGORY_TONES, value);
}

/** A colour's tones (an unknown key reads as the first colour). */
export function categoryTones(color: string | null | undefined): (typeof CATEGORY_TONES)[CategoryColor] {
  return isCategoryColor(color) ? CATEGORY_TONES[color] : CATEGORY_TONES.teal;
}

/** A name as compared: no accents or Arabic marks, lower case, no spaces ("Civil Works" = "civilworks"). */
export function categoryNameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ًͯ-ٰٟـ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

/** Check and clean a name: trimmed, single spaces, required, at most 40 characters. */
export function checkCategoryName(name: string | null | undefined): { ok: true; name: string } | { ok: false; problem: string } {
  const clean = (name ?? '').trim().replace(/\s+/g, ' ');
  if (!clean) return { ok: false, problem: 'Enter a name for the category.' };
  if (clean.length > CATEGORY_NAME_MAX) return { ok: false, problem: `A category name can have at most ${CATEGORY_NAME_MAX} characters.` };
  return { ok: true, name: clean };
}

export type RowDensity = 'compact' | 'comfortable' | 'detailed';

/** The chips a card or row shows: Compact 1, Comfortable up to 2, Detailed all — and how many more ("+1"). */
export function categoryChips<C>(categories: C[] | null | undefined, density: RowDensity): { shown: C[]; more: number } {
  const all = categories ?? [];
  const room = density === 'detailed' ? all.length : density === 'compact' ? 1 : 2;
  return { shown: all.slice(0, room), more: Math.max(0, all.length - room) };
}

/** The Category filter: does the task have any of the picked categories (none picked = every task)? */
export function hasAnyCategory(categories: { id: string }[] | null | undefined, picked: string[]): boolean {
  if (picked.length === 0) return true;
  return (categories ?? []).some((c) => picked.includes(c.id));
}

/** "Needs a category": its project asks every task for one and it has none (an app's save, or an older task). */
export function needsCategory(task: { categories?: unknown[] | null }, project: { requireCategory?: boolean } | null | undefined): boolean {
  return Boolean(project?.requireCategory) && (task.categories ?? []).length === 0;
}

/** Moving a task to another project: the categories the new project has by name are kept (theirs), the rest dropped. */
export function categoryMovePlan(
  from: { id: string; name: string }[],
  to: { id: string; name: string }[],
): { keep: { fromId: string; toId: string; name: string }[]; drop: string[] } {
  const byKey = new Map(to.map((c) => [categoryNameKey(c.name), c]));
  const keep: { fromId: string; toId: string; name: string }[] = [];
  const drop: string[] = [];
  for (const c of from) {
    const match = byKey.get(categoryNameKey(c.name));
    if (match) keep.push({ fromId: c.id, toId: match.id, name: c.name });
    else drop.push(c.name);
  }
  return { keep, drop };
}

/** The words every part of the website uses for categories (the server's refusals use the same). */
export const CATEGORY_WORDS = {
  heading: 'Categories',
  one: 'Category',
  settingsHint: 'This project’s own labels for its tasks. A task can have several. Admins and the project’s managers look after the list.',
  add: 'Add a category',
  name: 'Name',
  colour: 'Colour',
  rename: 'Rename',
  retire: 'Retire',
  unretire: 'Use again',
  retired: 'retired',
  remove: 'Delete',
  moveUp: 'Move up',
  moveDown: 'Move down',
  none: 'No categories yet.',
  noneOnTask: 'No category',
  pick: 'Pick categories',
  require: 'Every task needs a category',
  requireHint: 'New tasks, and tasks whose categories are changed, must have at least one.',
  pickOne: 'Pick at least one category.',
  needs: 'Needs a category',
  duplicate: 'This project already has a category with that name.',
  inUse: 'Tasks use this category (some may be in the Recycle Bin), so it can’t be deleted. Retire it instead.',
  notManager: 'Only admins and the project’s managers can change its categories.',
  retiredPick: 'A retired category can’t be added to a task.',
  wrongProject: 'That category belongs to another project.',
  filter: 'Category',
  anyCategory: 'Any category',
  byCategory: 'By category',
  full: `A task can have at most ${MAX_TASK_CATEGORIES} categories.`,
  projectFull: `A project can have at most ${MAX_PROJECT_CATEGORIES} categories.`,
} as const;
