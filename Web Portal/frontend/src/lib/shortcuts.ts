/**
 * Keyboard shortcuts: which key does what, and how each is shown. One set for the whole app.
 *
 * - Ctrl (⌘ on a Mac) shortcuts work anywhere, even while typing: Save, Submit, Search, the list of
 *   shortcuts. None of them takes a shortcut the browser keeps for itself (Ctrl+N, T, W, R, F, P…).
 * - Single keys (N, E, Delete, R, /, ?) work only when you're not typing, and can be switched off
 *   (a screen reader's own single-key navigation, or simply personal taste).
 * - Keys are matched by their place on the keyboard (`code`), so they work with the Arabic layout
 *   too, where the N key types "ى".
 */

export type ShortcutAction = 'save' | 'submit' | 'search' | 'find' | 'new' | 'edit' | 'delete' | 'cancel' | 'refresh' | 'help';
export type Platform = 'mac' | 'other';
export type ShortcutGroup = 'Anywhere' | 'Forms and dialogs' | 'On a page';

export interface ShortcutDef {
  action: ShortcutAction;
  label: string;
  description: string;
  group: ShortcutGroup;
  /** A single key: only when not typing, and only while single-key shortcuts are on. */
  single?: boolean;
}

/** Every shortcut, in the order the list of shortcuts shows them. */
export const SHORTCUTS: ShortcutDef[] = [
  { action: 'search', label: 'Search', description: 'Search tasks, projects and people, or jump to a page', group: 'Anywhere' },
  { action: 'help', label: 'Keyboard shortcuts', description: 'Show this list', group: 'Anywhere' },
  { action: 'save', label: 'Save', description: 'Save the form or dialog you’re in', group: 'Forms and dialogs' },
  { action: 'submit', label: 'Submit', description: 'Create, send or save the form you’re in', group: 'Forms and dialogs' },
  { action: 'cancel', label: 'Cancel', description: 'Close the dialog or panel, or drop an edit', group: 'Forms and dialogs' },
  { action: 'new', label: 'Add new', description: 'Add a task — or a project, meeting or user on those pages', group: 'On a page', single: true },
  { action: 'edit', label: 'Edit', description: 'Edit the open task, meeting or project', group: 'On a page', single: true },
  { action: 'delete', label: 'Delete', description: 'Delete the open task or meeting (you’re asked first)', group: 'On a page', single: true },
  { action: 'refresh', label: 'Refresh', description: 'Load the latest data on this page', group: 'On a page', single: true },
  { action: 'find', label: 'Search this page', description: 'Jump to the page’s search box (or the main search)', group: 'On a page', single: true },
];

/** The keys of each shortcut, as shown. `mod` is Ctrl, or ⌘ on a Mac. */
const KEYS: Record<ShortcutAction, { mod?: true; key: string; macKey?: string; alt?: string }> = {
  save: { mod: true, key: 'S' },
  submit: { mod: true, key: 'Enter', macKey: '↩' },
  search: { mod: true, key: 'K' },
  help: { mod: true, key: '/', alt: '?' },
  cancel: { key: 'Esc' },
  new: { key: 'N' },
  edit: { key: 'E' },
  delete: { key: 'Delete' },
  refresh: { key: 'R' },
  find: { key: '/' },
};

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

/** What a key press does, or null. `typing`: focus is in a field; `singleKeys`: single keys are on. */
export function matchShortcut(e: KeyLike, platform: Platform, opts: { typing: boolean; singleKeys: boolean }): ShortcutAction | null {
  if (e.isComposing) return null;
  if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey) return 'cancel';
  const mod = platform === 'mac' ? e.metaKey : e.ctrlKey;
  const otherMod = platform === 'mac' ? e.ctrlKey : e.metaKey;
  if (mod) {
    // Ctrl+Alt is AltGr on many keyboards (it types characters); Shift and the other modifier are
    // left to the browser and the system.
    if (otherMod || e.altKey || e.shiftKey) return null;
    switch (e.code) {
      case 'KeyS':
        return 'save';
      case 'Enter':
      case 'NumpadEnter':
        return 'submit';
      case 'KeyK':
        return 'search';
      case 'Slash':
        return 'help';
      default:
        return null;
    }
  }
  if (e.ctrlKey || e.metaKey || e.altKey || opts.typing || !opts.singleKeys || e.repeat) return null;
  if (e.code === 'Slash') return e.shiftKey ? 'help' : 'find';
  if (e.shiftKey) return null;
  switch (e.code) {
    case 'KeyN':
      return 'new';
    case 'KeyE':
      return 'edit';
    case 'KeyR':
      return 'refresh';
    case 'Delete':
      return 'delete';
    default:
      return null;
  }
}

const NOT_TYPED = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden']);

/** Is focus somewhere that takes typed letters (a field, a list you type into, editable text)? */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NOT_TYPED.has(((el as HTMLInputElement).type || 'text').toLowerCase());
  if ((el as HTMLElement).isContentEditable || el.getAttribute('contenteditable') === 'true') return true;
  const role = el.getAttribute('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}

/** The keys as this keyboard has them: "Ctrl+S" or "⌘S"; "N"; "Esc". */
export function shortcutLabel(action: ShortcutAction, platform: Platform): string {
  const k = KEYS[action];
  if (!k.mod) return k.key;
  return platform === 'mac' ? `⌘${k.macKey ?? k.key}` : `Ctrl+${k.key}`;
}

/** The keys, one entry per key, for drawing them as key caps. */
export function shortcutKeys(action: ShortcutAction, platform: Platform): string[][] {
  const k = KEYS[action];
  const main = k.mod ? [platform === 'mac' ? '⌘' : 'Ctrl', platform === 'mac' ? k.macKey ?? k.key : k.key] : [k.key];
  return k.alt ? [main, [k.alt]] : [main];
}

/** A button's tooltip with its shortcut: "Save task (Ctrl+S)". */
export function withShortcut(text: string, action: ShortcutAction, platform: Platform): string {
  return `${text} (${shortcutLabel(action, platform)})`;
}

/** The `aria-keyshortcuts` value: "Control+S" / "Meta+S", "N", "Delete". */
export function ariaKeyshortcuts(action: ShortcutAction, platform: Platform): string {
  const k = KEYS[action];
  const name = (key: string) => (key === 'Esc' ? 'Escape' : key);
  const main = k.mod ? `${platform === 'mac' ? 'Meta' : 'Control'}+${name(k.key)}` : name(k.key);
  return k.alt ? `${main} Shift+${k.alt}` : main;
}

/** Apple devices use ⌘; everyone else uses Ctrl. */
export function detectPlatform(nav: { platform?: string; userAgent?: string } | undefined = typeof navigator === 'undefined' ? undefined : navigator): Platform {
  const text = `${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`;
  return /mac|iphone|ipad|ipod/i.test(text) ? 'mac' : 'other';
}
