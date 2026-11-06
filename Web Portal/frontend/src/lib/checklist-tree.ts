/**
 * Nested checklists (1.23.3), free of React: a task's checklists as cards of nested items (from the
 * server's flat list, in tree order), their counts — of the real to-do items only, the ones without
 * sub-items, so "8/12" is never double-counted — and a parent's tick, which mirrors its sub-items.
 *
 * The same editor also edits checklists that don't exist yet (the New task form, task and project
 * templates): a local "draft" with the same operations, sent to the server as a `ChecklistTree`.
 */
import { dayText } from './day-words';

/** The server keeps up to 191 characters per item or title. */
export const CHECKLIST_TEXT_MAX = 191;
/** Levels 1–20 (depth 0–19). */
export const CHECKLIST_DEPTH_MAX = 20;
export const CHECKLIST_ITEMS_MAX = 500;
export const CHECKLISTS_MAX = 50;
/** The title of a task's first checklist, and of an old flat list. */
export const DEFAULT_CHECKLIST_TITLE = 'Checklist';

/** The create / template shape (POST /tasks `checklists`, templates' `checklists`). */
export interface ChecklistNode {
  text: string;
  children?: ChecklistNode[];
}
export interface ChecklistTreeList {
  title: string;
  items: ChecklistNode[];
}
export type ChecklistTree = ChecklistTreeList[];

export interface CLPerson {
  id: string;
  name: string;
  avatarUrl?: string | null;
}
export interface CLList {
  id: string;
  title: string;
}
/** One item as the editor gets it: flat, in tree order (list by list, each parent before its sub-items). */
export interface CLItem {
  id: string;
  listId: string;
  parentId: string | null;
  text: string;
  done: boolean;
  assignee?: CLPerson | null;
  /** 'YYYY-MM-DD' or null. */
  dueDate?: string | null;
}

export interface CLNode {
  item: CLItem;
  /** 0 = top level. */
  depth: number;
  children: CLNode[];
  /** A leaf: its own tick; a parent: all its sub-items done. */
  done: boolean;
  /** Leaves under a parent, and how many are done (0/0 on a leaf). */
  subDone: number;
  subTotal: number;
  /** Every item under it, at any level. */
  descendants: number;
}
export interface CLCard {
  list: CLList;
  roots: CLNode[];
  /** Leaf counts in this checklist. */
  done: number;
  total: number;
  /** No checklist exists yet: a "Checklist" to add to (the server makes it with the first item). */
  implicit: boolean;
}

/** Where a new item goes: in a list, under a parent (null: the top level), after a sibling (null: last). */
export interface ChecklistAt {
  listId: string;
  parentId: string | null;
  afterId: string | null;
}
export type ChecklistMove = 'indent' | 'outdent' | 'up' | 'down';

/**
 * The checklists as cards of nested items. `ticks` (item id → done) are ticks shown before the server
 * has them; a parent's tick follows its sub-items at once.
 */
export function checklistCards(lists: CLList[], items: CLItem[], ticks: Record<string, boolean> = {}): CLCard[] {
  const implicit = lists.length === 0;
  const shownLists: CLList[] = implicit ? [{ id: '', title: DEFAULT_CHECKLIST_TITLE }] : lists;
  const listIds = new Set(shownLists.map((l) => l.id));
  const firstList = shownLists[0]!.id;
  const listOf = (i: CLItem) => (i.listId !== undefined && listIds.has(i.listId) ? i.listId : firstList);
  const nodes = new Map<string, CLNode>();
  const roots = new Map<string, CLNode[]>(shownLists.map((l) => [l.id, []]));
  for (const raw of items) {
    const it: CLItem = { ...raw, listId: listOf(raw), parentId: raw.parentId ?? null };
    const parent = it.parentId ? nodes.get(it.parentId) : undefined;
    const node: CLNode = { item: it, depth: parent && parent.item.listId === it.listId ? parent.depth + 1 : 0, children: [], done: false, subDone: 0, subTotal: 0, descendants: 0 };
    nodes.set(it.id, node);
    if (parent && parent.item.listId === it.listId) parent.children.push(node);
    else roots.get(it.listId)!.push(node);
  }
  const count = (node: CLNode): { done: number; total: number } => {
    if (node.children.length === 0) {
      node.done = node.item.id in ticks ? ticks[node.item.id]! : node.item.done;
      return { done: node.done ? 1 : 0, total: 1 };
    }
    let done = 0;
    let total = 0;
    let descendants = 0;
    for (const child of node.children) {
      const c = count(child);
      done += c.done;
      total += c.total;
      descendants += 1 + child.descendants;
    }
    Object.assign(node, { subDone: done, subTotal: total, done: total > 0 && done === total, descendants });
    return { done, total };
  };
  return shownLists.map((list) => {
    const rs = roots.get(list.id)!;
    let done = 0;
    let total = 0;
    for (const r of rs) {
      const c = count(r);
      done += c.done;
      total += c.total;
    }
    return { list, roots: rs, done, total, implicit };
  });
}

export function overallCounts(cards: CLCard[]): { done: number; total: number } {
  return cards.reduce((a, c) => ({ done: a.done + c.done, total: a.total + c.total }), { done: 0, total: 0 });
}

export interface Found {
  node: CLNode;
  card: CLCard;
  parent: CLNode | null;
  siblings: CLNode[];
  index: number;
}

export function findNode(cards: CLCard[], id: string): Found | null {
  const walk = (card: CLCard, siblings: CLNode[], parent: CLNode | null): Found | null => {
    for (let i = 0; i < siblings.length; i++) {
      const n = siblings[i]!;
      if (n.item.id === id) return { node: n, card, parent, siblings, index: i };
      const inside = walk(card, n.children, n);
      if (inside) return inside;
    }
    return null;
  };
  for (const card of cards) {
    const f = walk(card, card.roots, null);
    if (f) return f;
  }
  return null;
}

/** The ids of an item's parents, nearest last (top level first). */
export function ancestorsOf(cards: CLCard[], id: string): string[] {
  const path: string[] = [];
  const walk = (nodes: CLNode[]): boolean => {
    for (const n of nodes) {
      if (n.item.id === id) return true;
      path.push(n.item.id);
      if (walk(n.children)) return true;
      path.pop();
    }
    return false;
  };
  for (const card of cards) if (walk(card.roots)) return path;
  return [];
}

/** How many levels a branch has under its top (0 for a single item). */
export function branchHeight(node: CLNode): number {
  return node.children.reduce((h, c) => Math.max(h, 1 + branchHeight(c)), 0);
}

/** Which moves an item can make: indent (under the item before it), outdent, up and down among its siblings. */
export function moveAvailability(cards: CLCard[], id: string): Record<ChecklistMove, boolean> {
  const f = findNode(cards, id);
  if (!f) return { indent: false, outdent: false, up: false, down: false };
  return {
    indent: f.index > 0 && f.node.depth + 1 + branchHeight(f.node) <= CHECKLIST_DEPTH_MAX - 1,
    outdent: f.parent !== null,
    up: f.index > 0,
    down: f.index < f.siblings.length - 1,
  };
}

/** A due day as the site writes it: "3 Nov" this year, "3 Nov 2027" another. */
export function dueWords(day: string | null | undefined, today: string): string {
  if (!day) return '';
  return dayText(day, { year: day.slice(0, 4) !== today.slice(0, 4) });
}

// ── Trees (the create / template shape) ──

const countTree = (nodes: ChecklistNode[] | undefined, leavesOnly: boolean): number =>
  (nodes ?? []).reduce((n, x) => n + (x.children?.length ? (leavesOnly ? 0 : 1) + countTree(x.children, leavesOnly) : 1), 0);
/** The real to-do items in a tree (the ones without sub-items). */
export const treeLeafCount = (tree: ChecklistTree | null | undefined): number => (tree ?? []).reduce((n, l) => n + countTree(l.items, true), 0);
/** Every item in a tree, parents too. */
export const treeItemCount = (tree: ChecklistTree | null | undefined): number => (tree ?? []).reduce((n, l) => n + countTree(l.items, false), 0);
/** Every item's text, in order (the old flat `checklist: string[]`). */
export function treeTexts(tree: ChecklistTree | null | undefined): string[] {
  const out: string[] = [];
  const walk = (nodes: ChecklistNode[] | undefined) => {
    for (const n of nodes ?? []) {
      out.push(n.text);
      walk(n.children);
    }
  };
  for (const l of tree ?? []) walk(l.items);
  return out;
}
/** A template's or form's checklists from what the server sent: the tree, else the old plain list as one "Checklist". */
export function treeOf(checklists: ChecklistTree | null | undefined, checklist?: string[] | null): ChecklistTree {
  if (Array.isArray(checklists)) return checklists;
  const texts = (checklist ?? []).filter((t) => typeof t === 'string' && t.trim());
  return texts.length ? [{ title: DEFAULT_CHECKLIST_TITLE, items: texts.map((text) => ({ text })) }] : [];
}

// ── Local drafts ──

export interface DraftNode {
  id: string;
  text: string;
  children: DraftNode[];
}
export interface DraftList {
  id: string;
  title: string;
  items: DraftNode[];
}
/**
 * Checklists being written before they exist. `typed`: text typed in an add box and not added yet,
 * by the box's place (composerKey) — part of the draft, so Create (or Ctrl+Enter) never loses it and
 * the form counts it as a change.
 */
export interface ChecklistDraft {
  lists: DraftList[];
  typed: Record<string, string>;
}

let seq = 0;
const newId = (kind: 'l' | 'i') => `draft-${kind}${++seq}`;

/** The key of an add box's place. */
export const composerKey = (at: ChecklistAt): string => `${at.listId}|${at.parentId ?? ''}|${at.afterId ?? ''}`;
const parseKey = (key: string): ChecklistAt | null => {
  const [listId, parentId, afterId] = key.split('|');
  return listId === undefined ? null : { listId, parentId: parentId || null, afterId: afterId || null };
};

const clean = (text: string) => text.trim().slice(0, CHECKLIST_TEXT_MAX);
/** One item per line, trimmed, blank lines left out. */
export const linesOf = (text: string): string[] => text.split(/\r?\n/).map(clean).filter(Boolean);

export function emptyDraft(): ChecklistDraft {
  return { lists: [{ id: newId('l'), title: DEFAULT_CHECKLIST_TITLE, items: [] }], typed: {} };
}
const fromNodes = (nodes: ChecklistNode[] | undefined): DraftNode[] =>
  (nodes ?? []).filter((n) => n && typeof n.text === 'string').map((n) => ({ id: newId('i'), text: n.text, children: fromNodes(n.children) }));
export function draftFromTree(tree: ChecklistTree | null | undefined): ChecklistDraft {
  const lists = (tree ?? []).map((l) => ({ id: newId('l'), title: l.title || DEFAULT_CHECKLIST_TITLE, items: fromNodes(l.items) }));
  return lists.length ? { lists, typed: {} } : emptyDraft();
}
export const draftFromTexts = (texts: string[]): ChecklistDraft => draftFromTree(treeOf(null, texts));

/** The draft as flat items in tree order (what the editor shows), never ticked. */
export function draftView(d: ChecklistDraft): { lists: CLList[]; items: CLItem[] } {
  const items: CLItem[] = [];
  const walk = (listId: string, nodes: DraftNode[], parentId: string | null) => {
    for (const n of nodes) {
      items.push({ id: n.id, listId, parentId, text: n.text, done: false });
      walk(listId, n.children, n.id);
    }
  };
  for (const l of d.lists) walk(l.id, l.items, null);
  return { lists: d.lists.map((l) => ({ id: l.id, title: l.title })), items };
}

/** Insert nodes at a place in a list's items (a missing parent or sibling: at the end of the list). */
function insertAt(items: DraftNode[], at: ChecklistAt, added: DraftNode[]): DraftNode[] {
  let placed = false;
  const into = (siblings: DraftNode[], parentId: string | null): DraftNode[] => {
    let out = siblings;
    if (parentId === at.parentId && !placed) {
      const i = at.afterId ? siblings.findIndex((n) => n.id === at.afterId) : -1;
      if (!at.afterId || i >= 0) {
        placed = true;
        out = at.afterId ? [...siblings.slice(0, i + 1), ...added, ...siblings.slice(i + 1)] : [...siblings, ...added];
      }
    }
    return out.map((n) => {
      const children = into(n.children, n.id);
      return children === n.children ? n : { ...n, children };
    });
  };
  const result = into(items, null);
  return placed ? result : [...result, ...added];
}

const mapList = (d: ChecklistDraft, listId: string, fn: (l: DraftList) => DraftList): ChecklistDraft => ({ ...d, lists: d.lists.map((l) => (l.id === listId ? fn(l) : l)) });

/** Add items (one per text) at a place; the new items' ids, in order. */
export function draftAdd(d: ChecklistDraft, at: ChecklistAt, texts: string[]): { draft: ChecklistDraft; ids: string[] } {
  const added = texts.map(clean).filter(Boolean).map((text) => ({ id: newId('i'), text, children: [] }));
  if (!added.length) return { draft: d, ids: [] };
  const listId = d.lists.some((l) => l.id === at.listId) ? at.listId : d.lists[0]!.id;
  return { draft: mapList(d, listId, (l) => ({ ...l, items: insertAt(l.items, { ...at, listId }, added) })), ids: added.map((n) => n.id) };
}

/** Change every node with this id (and, with `remove`, take it out). */
function editNodes(d: ChecklistDraft, id: string, fn: (siblings: DraftNode[], index: number) => DraftNode[]): ChecklistDraft {
  let changed = false;
  const walk = (siblings: DraftNode[]): DraftNode[] => {
    const i = siblings.findIndex((n) => n.id === id);
    if (i >= 0) {
      const next = fn(siblings, i);
      if (next !== siblings) changed = true;
      return next;
    }
    let any = false;
    const out = siblings.map((n) => {
      const children = walk(n.children);
      if (children === n.children) return n;
      any = true;
      return { ...n, children };
    });
    return any ? out : siblings;
  };
  const lists = d.lists.map((l) => {
    const items = walk(l.items);
    return items === l.items ? l : { ...l, items };
  });
  return changed ? { ...d, lists } : d;
}

export const draftRename = (d: ChecklistDraft, id: string, text: string): ChecklistDraft =>
  clean(text) ? editNodes(d, id, (s, i) => s.map((n, j) => (j === i ? { ...n, text: clean(text) } : n))) : d;
export const draftRemove = (d: ChecklistDraft, id: string): ChecklistDraft => editNodes(d, id, (s, i) => [...s.slice(0, i), ...s.slice(i + 1)]);

const copyNode = (n: DraftNode): DraftNode => ({ id: newId('i'), text: n.text, children: n.children.map(copyNode) });
export const draftDuplicate = (d: ChecklistDraft, id: string): ChecklistDraft => editNodes(d, id, (s, i) => [...s.slice(0, i + 1), copyNode(s[i]!), ...s.slice(i + 1)]);

export function draftMove(d: ChecklistDraft, id: string, how: ChecklistMove): ChecklistDraft {
  if (how === 'outdent') {
    // Out of its parent, right after it.
    let moved: DraftNode | null = null;
    const walk = (siblings: DraftNode[]): DraftNode[] | null => {
      for (let p = 0; p < siblings.length; p++) {
        const parent = siblings[p]!;
        const i = parent.children.findIndex((n) => n.id === id);
        if (i >= 0) {
          moved = parent.children[i]!;
          const updated = { ...parent, children: [...parent.children.slice(0, i), ...parent.children.slice(i + 1)] };
          return [...siblings.slice(0, p), updated, moved, ...siblings.slice(p + 1)];
        }
        const inner = walk(parent.children);
        if (inner) return [...siblings.slice(0, p), { ...parent, children: inner }, ...siblings.slice(p + 1)];
      }
      return null;
    };
    for (const l of d.lists) {
      const items = walk(l.items);
      if (items && moved) return mapList(d, l.id, () => ({ ...l, items }));
    }
    return d;
  }
  return editNodes(d, id, (s, i) => {
    if (how === 'up' || how === 'down') {
      const j = how === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= s.length) return s;
      const out = [...s];
      [out[i], out[j]] = [out[j]!, out[i]!];
      return out;
    }
    // Indent: the last sub-item of the one before it.
    if (i === 0) return s;
    const prev = s[i - 1]!;
    return [...s.slice(0, i - 1), { ...prev, children: [...prev.children, s[i]!] }, ...s.slice(i + 1)];
  });
}

export function draftAddList(d: ChecklistDraft, title: string, afterId?: string | null): { draft: ChecklistDraft; id: string } {
  const list: DraftList = { id: newId('l'), title: clean(title) || DEFAULT_CHECKLIST_TITLE, items: [] };
  const i = afterId ? d.lists.findIndex((l) => l.id === afterId) : -1;
  const lists = i >= 0 ? [...d.lists.slice(0, i + 1), list, ...d.lists.slice(i + 1)] : [...d.lists, list];
  return { draft: { ...d, lists }, id: list.id };
}
export const draftRenameList = (d: ChecklistDraft, id: string, title: string): ChecklistDraft => (clean(title) ? mapList(d, id, (l) => ({ ...l, title: clean(title) })) : d);
export function draftDuplicateList(d: ChecklistDraft, id: string): ChecklistDraft {
  const i = d.lists.findIndex((l) => l.id === id);
  if (i < 0) return d;
  const src = d.lists[i]!;
  const copy: DraftList = { id: newId('l'), title: `${src.title} (copy)`.slice(0, CHECKLIST_TEXT_MAX), items: src.items.map(copyNode) };
  return { ...d, lists: [...d.lists.slice(0, i + 1), copy, ...d.lists.slice(i + 1)] };
}
export function draftRemoveList(d: ChecklistDraft, id: string): ChecklistDraft {
  const lists = d.lists.filter((l) => l.id !== id);
  if (lists.length === d.lists.length) return d;
  return lists.length ? { ...d, lists } : { ...d, lists: emptyDraft().lists };
}

/**
 * What is sent: each checklist with items (empty ones left out), texts trimmed, and whatever was
 * typed in an add box and not added yet, where it was typed.
 */
export function draftToTree(d: ChecklistDraft): ChecklistTree {
  let draft: ChecklistDraft = { ...d, typed: {} };
  for (const [key, text] of Object.entries(d.typed ?? {})) {
    const at = parseKey(key);
    if (!at || !text.trim()) continue;
    draft = draftAdd(draft, at, linesOf(text)).draft;
  }
  const toNodes = (nodes: DraftNode[]): ChecklistNode[] =>
    nodes
      .filter((n) => clean(n.text))
      .map((n) => {
        const children = toNodes(n.children);
        return children.length ? { text: clean(n.text), children } : { text: clean(n.text) };
      });
  return draft.lists.map((l) => ({ title: clean(l.title) || DEFAULT_CHECKLIST_TITLE, items: toNodes(l.items) })).filter((l) => l.items.length > 0);
}
