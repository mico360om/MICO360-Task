/**
 * 1.23.3 Nested checklists — the rules of a task's checklists, as plain functions over its rows (no
 * database): the order things are shown in, the counts, the parent rule, moves and the trees that
 * templates and the New task form send.
 *
 * - A task has several checklists (lists); each item is in one and may sit under another item
 *   (`parentId`), to any depth up to MAX_DEPTH levels.
 * - Owner, 6 Nov: "a parent follows its sub-items" — a parent is done exactly when all its live
 *   sub-items are; nobody ticks or unticks it by hand. A parent whose last sub-item goes keeps its tick.
 * - Counts use the real to-do items only — the ones without sub-items — so 8/12 is never double-counted.
 * - Deleted rows (deletedAt) are kept 30 days for Undo / Restore and count nowhere.
 */

/** A checklist (task_checklist_lists). */
export interface ListRow {
  id: string;
  taskId: string;
  title: string;
  position: number;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedById: string | null;
  deletedBatchId: string | null;
}

/** A checklist item (task_checklists). */
export interface ItemRow {
  id: string;
  taskId: string;
  listId: string | null;
  parentId: string | null;
  text: string;
  done: boolean;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  assigneeId: string | null;
  dueDate: Date | null;
  completedAt: Date | null;
  completedById: string | null;
  deletedAt: Date | null;
  deletedById: string | null;
  deletedBatchId: string | null;
}

/** Levels an item may be nested to (0 = top level … MAX_DEPTH - 1). */
export const MAX_DEPTH = 20;
/** Live items one task may have. */
export const MAX_ITEMS = 500;
/** Live checklists one task may have. */
export const MAX_LISTS = 50;
/** Checklist titles and item text fit the database's VARCHAR(191) columns. */
export const TEXT_MAX = 191;
/** The title of the checklist made for items given without one (older apps, older templates). */
export const DEFAULT_LIST_TITLE = 'Checklist';

export interface ArrangedItem extends ItemRow {
  listId: string;
  depth: number;
  /** Live direct sub-items. */
  childCount: number;
  /** Leaves under a parent, and how many of them are done (0/0 on a leaf). */
  subDone: number;
  subTotal: number;
}

export interface ArrangedList extends ListRow {
  /** Its leaves: done of total. */
  done: number;
  total: number;
}

export interface Arranged {
  lists: ArrangedList[];
  /** Every live item, list by list, depth-first in order. */
  items: ArrangedItem[];
  /** Leaves over every live checklist. */
  done: number;
  total: number;
  /** 0–100 (0 without leaves). */
  percent: number;
}

const byOrder = <T extends { position: number; createdAt: Date; id: string }>(a: T, b: T) =>
  a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const isLive = (r: { deletedAt: Date | null }) => r.deletedAt === null;

/** The live lists in order. */
export function liveLists(lists: readonly ListRow[]): ListRow[] {
  return lists.filter(isLive).sort(byOrder);
}

/**
 * The live items as a tree: a live item is in a live list; its parent is live and in the same list,
 * else it is shown at the top level of its list (a parent deleted on its own, an older app's write).
 */
function liveTree(lists: readonly ListRow[], items: readonly ItemRow[]) {
  const listIds = new Set(liveLists(lists).map((l) => l.id));
  const live = items.filter((i) => isLive(i) && i.listId !== null && listIds.has(i.listId));
  const byId = new Map(live.map((i) => [i.id, i]));
  const parentOf = (i: ItemRow): string | null => {
    const p = i.parentId ? byId.get(i.parentId) : undefined;
    return p && p.listId === i.listId && p.id !== i.id ? p.id : null;
  };
  // A loop (never written by this server; defensive) is broken at the item that closes it.
  const effectiveParent = new Map<string, string | null>();
  for (const i of live) {
    const seen = new Set<string>([i.id]);
    let ok = true;
    for (let cur = parentOf(i); cur; cur = parentOf(byId.get(cur)!)) {
      if (seen.has(cur)) {
        ok = false;
        break;
      }
      seen.add(cur);
    }
    effectiveParent.set(i.id, ok ? parentOf(i) : null);
  }
  const children = new Map<string, ItemRow[]>();
  for (const i of live) {
    const key = effectiveParent.get(i.id) ?? `list:${i.listId}`;
    const group = children.get(key) ?? [];
    group.push(i);
    children.set(key, group);
  }
  for (const group of children.values()) group.sort(byOrder);
  return { live, byId, children, parentOf: (id: string) => effectiveParent.get(id) ?? null };
}

/** The id of the stand-in checklist for items in none when a task has no live checklist (never stored). */
export const STAND_IN_LIST_ID = '~checklist';

/**
 * Items in no live checklist of their task (data from before 1.23.3, or rows written another way) read
 * as at the top of the task's first checklist — or of a "Checklist" of their own when it has none (a
 * stand-in, never stored; the task panel stores one when it first opens the task).
 */
function withHome(lists: readonly ListRow[], items: readonly ItemRow[]): { lists: readonly ListRow[]; items: readonly ItemRow[] } {
  const live = liveLists(lists);
  const ids = new Set(live.map((l) => l.id));
  const lost = items.filter((i) => isLive(i) && (!i.listId || !ids.has(i.listId)));
  if (!lost.length) return { lists, items };
  let home = live[0];
  const out = [...lists];
  if (!home) {
    const first = lost[0]!;
    home = { id: STAND_IN_LIST_ID, taskId: first.taskId, title: DEFAULT_LIST_TITLE, position: 0, createdById: null, createdAt: first.createdAt, updatedAt: first.updatedAt, deletedAt: null, deletedById: null, deletedBatchId: null };
    out.push(home);
  }
  const homeId = home.id;
  const lostIds = new Set(lost.map((i) => i.id));
  return { lists: out, items: items.map((i) => (lostIds.has(i.id) ? { ...i, listId: homeId } : i)) };
}

/** Lists, items in order and every count, from a task's rows (deleted ones left out). */
export function arrange(allLists: readonly ListRow[], allItems: readonly ItemRow[]): Arranged {
  const { lists, items } = withHome(allLists, allItems);
  const ordered = liveLists(lists);
  const { children } = liveTree(lists, items);
  const out: ArrangedItem[] = [];
  const outLists: ArrangedList[] = [];
  let done = 0;
  let total = 0;
  const walk = (row: ItemRow, depth: number): { done: number; total: number } => {
    const kids = children.get(row.id) ?? [];
    const entry: ArrangedItem = { ...row, listId: row.listId!, parentId: depth === 0 ? null : row.parentId, depth, childCount: kids.length, subDone: 0, subTotal: 0 };
    out.push(entry);
    if (kids.length === 0) return { done: row.done ? 1 : 0, total: 1 };
    let d = 0;
    let t = 0;
    for (const k of kids) {
      const c = walk(k, depth + 1);
      d += c.done;
      t += c.total;
    }
    entry.subDone = d;
    entry.subTotal = t;
    return { done: d, total: t };
  };
  for (const l of ordered) {
    let d = 0;
    let t = 0;
    for (const top of children.get(`list:${l.id}`) ?? []) {
      const c = walk(top, 0);
      d += c.done;
      t += c.total;
    }
    outLists.push({ ...l, done: d, total: t });
    done += d;
    total += t;
  }
  return { lists: outLists, items: out, done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** Leaves (items without live sub-items) among these live items: done of total. */
export function leafCounts(items: readonly Pick<ItemRow, 'id' | 'parentId' | 'done'>[]): { done: number; total: number } {
  const parents = new Set(items.map((i) => i.parentId).filter((p): p is string => p !== null));
  let done = 0;
  let total = 0;
  for (const i of items) {
    if (parents.has(i.id)) continue;
    total += 1;
    if (i.done) done += 1;
  }
  return { done, total };
}

/** A task's checklist progress (0–100) from its live items: the leaves' share done. */
export function leafPercent(items: readonly Pick<ItemRow, 'id' | 'parentId' | 'done'>[]): number {
  const { done, total } = leafCounts(items);
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

/**
 * The parent rule: every live parent (an item with live sub-items) is done exactly when all its live
 * sub-items are, from the deepest level up. Changes the rows in place (done, completedAt,
 * completedById) and returns the ids it changed. Leaves are never changed here.
 */
export function settleParents(items: ItemRow[], opts: { now: Date; actorId: string | null }): string[] {
  const live = items.filter(isLive);
  const kids = new Map<string, ItemRow[]>();
  for (const i of live) {
    if (!i.parentId) continue;
    const g = kids.get(i.parentId) ?? [];
    g.push(i);
    kids.set(i.parentId, g);
  }
  const byId = new Map(live.map((i) => [i.id, i]));
  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const doneOf = (row: ItemRow): boolean => {
    const known = memo.get(row.id);
    if (known !== undefined) return known;
    const children = (kids.get(row.id) ?? []).filter((c) => c.listId === row.listId);
    if (children.length === 0 || visiting.has(row.id)) {
      memo.set(row.id, row.done);
      return row.done;
    }
    visiting.add(row.id);
    const all = children.every((c) => doneOf(c));
    visiting.delete(row.id);
    memo.set(row.id, all);
    return all;
  };
  const changed: string[] = [];
  for (const row of live) {
    if (!kids.has(row.id)) continue;
    const want = doneOf(row);
    if (want === row.done || !byId.has(row.id)) continue;
    row.done = want;
    row.completedAt = want ? opts.now : null;
    row.completedById = want ? opts.actorId : null;
    row.updatedAt = opts.now;
    changed.push(row.id);
  }
  return changed;
}

/** Every live item under this one, at any depth (with `withDeleted`, deleted ones too). */
export function descendantIds(items: readonly ItemRow[], id: string, opts: { withDeleted?: boolean } = {}): string[] {
  const live = opts.withDeleted ? items : items.filter(isLive);
  const out: string[] = [];
  const queue = [id];
  const seen = new Set<string>([id]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const i of live) {
      if (i.parentId === cur && !seen.has(i.id)) {
        seen.add(i.id);
        out.push(i.id);
        queue.push(i.id);
      }
    }
  }
  return out;
}

/** Would putting `itemId` under `newParentId` make a loop (under itself or one of its sub-items)? */
export function wouldCycle(items: readonly ItemRow[], itemId: string, newParentId: string | null): boolean {
  if (newParentId === null) return false;
  if (newParentId === itemId) return true;
  return descendantIds(items, itemId).includes(newParentId);
}

/** How many levels an item's sub-tree has (1 = no sub-items). */
export function subtreeHeight(items: readonly ItemRow[], id: string): number {
  const live = items.filter(isLive);
  const height = (cur: string, guard: number): number => {
    if (guard > MAX_DEPTH + 5) return guard;
    const kids = live.filter((i) => i.parentId === cur);
    return 1 + (kids.length ? Math.max(...kids.map((k) => height(k.id, guard + 1))) : 0);
  };
  return height(id, 0);
}

/** An item's level (0 = top), following live parents. */
export function depthOf(items: readonly ItemRow[], id: string | null): number {
  if (!id) return -1;
  const byId = new Map(items.filter(isLive).map((i) => [i.id, i]));
  let depth = 0;
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur?.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    depth += 1;
    cur = byId.get(cur.parentId);
  }
  return depth;
}

export type MoveAction = 'indent' | 'outdent' | 'up' | 'down';
export interface MoveTarget {
  listId: string;
  parentId: string | null;
  /** The sibling it goes right after; null = first. */
  afterId: string | null;
}

/** The live siblings of an item (same list, same parent), in order. */
export function siblingsOf(items: readonly ItemRow[], listId: string, parentId: string | null): ItemRow[] {
  return items.filter((i) => isLive(i) && i.listId === listId && (i.parentId ?? null) === parentId).sort(byOrder);
}

/** Where Indent, Outdent, Move up and Move down put an item; null when it can't go that way. */
export function planMove(items: readonly ItemRow[], itemId: string, action: MoveAction): MoveTarget | null {
  const row = items.find((i) => i.id === itemId && isLive(i));
  if (!row || !row.listId) return null;
  const sibs = siblingsOf(items, row.listId, row.parentId ?? null);
  const index = sibs.findIndex((s) => s.id === row.id);
  switch (action) {
    case 'indent': {
      const before = sibs[index - 1];
      if (!before) return null;
      const kids = siblingsOf(items, row.listId, before.id);
      return { listId: row.listId, parentId: before.id, afterId: kids.length ? kids[kids.length - 1]!.id : null };
    }
    case 'outdent': {
      if (!row.parentId) return null;
      const parent = items.find((i) => i.id === row.parentId);
      if (!parent) return null;
      return { listId: row.listId, parentId: parent.parentId ?? null, afterId: parent.id };
    }
    case 'up': {
      if (index <= 0) return null;
      return { listId: row.listId, parentId: row.parentId ?? null, afterId: index >= 2 ? sibs[index - 2]!.id : null };
    }
    case 'down': {
      if (index < 0 || index >= sibs.length - 1) return null;
      return { listId: row.listId, parentId: row.parentId ?? null, afterId: sibs[index + 1]!.id };
    }
  }
}

/**
 * Put `ids` (in this order) into a sibling group right after `afterId` (null = first), renumbering the
 * whole group 0…n−1. Changes the rows in place; returns the ids whose position changed.
 */
export function placeInGroup(items: ItemRow[], listId: string, parentId: string | null, ids: string[], afterId: string | null, now: Date): string[] {
  const moving = new Set(ids);
  const rest = siblingsOf(items, listId, parentId).filter((s) => !moving.has(s.id));
  const cut = afterId === null ? 0 : rest.findIndex((s) => s.id === afterId) + 1 || rest.length;
  const order = [...rest.slice(0, cut).map((s) => s.id), ...ids, ...rest.slice(cut).map((s) => s.id)];
  const changed: string[] = [];
  const byId = new Map(items.map((i) => [i.id, i]));
  order.forEach((id, position) => {
    const r = byId.get(id);
    if (r && r.position !== position) {
      r.position = position;
      r.updatedAt = now;
      changed.push(id);
    }
  });
  return changed;
}

// ---- Trees: what templates keep and the New task form sends ------------------------------------

export interface ChecklistNode {
  text: string;
  children?: ChecklistNode[];
}
export interface ChecklistTreeList {
  title: string;
  items: ChecklistNode[];
}
export type ChecklistTree = ChecklistTreeList[];

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, TEXT_MAX) : '');

function nodesOf(raw: unknown, depth: number): ChecklistNode[] {
  if (!Array.isArray(raw) || depth > MAX_DEPTH + 5) return [];
  const out: ChecklistNode[] = [];
  for (const n of raw) {
    const text = typeof n === 'string' ? clean(n) : n && typeof n === 'object' ? clean((n as { text?: unknown }).text) : '';
    if (!text) continue;
    const kids = n && typeof n === 'object' ? nodesOf((n as { children?: unknown }).children, depth + 1) : [];
    out.push(kids.length ? { text, children: kids } : { text });
  }
  return out;
}

/**
 * A stored or sent checklist tree, cleaned: titles and texts trimmed (blank items dropped, a blank title
 * becomes "Checklist"). An old flat list of texts (templates before 1.23.3, older apps) is one
 * "Checklist"; nothing usable is an empty tree.
 */
export function checklistTreeOf(raw: unknown): ChecklistTree {
  if (!Array.isArray(raw)) return [];
  if (raw.every((x) => typeof x === 'string')) {
    const items = nodesOf(raw, 0);
    return items.length ? [{ title: DEFAULT_LIST_TITLE, items }] : [];
  }
  const out: ChecklistTree = [];
  for (const l of raw) {
    if (!l || typeof l !== 'object' || Array.isArray(l)) continue;
    out.push({ title: clean((l as { title?: unknown }).title) || DEFAULT_LIST_TITLE, items: nodesOf((l as { items?: unknown }).items, 0) });
  }
  return out;
}

/** Every item's text, list by list, depth-first: the flat checklist older apps read. */
export function flatTexts(tree: ChecklistTree): string[] {
  const out: string[] = [];
  const walk = (nodes: ChecklistNode[]) => {
    for (const n of nodes) {
      out.push(n.text);
      if (n.children) walk(n.children);
    }
  };
  for (const l of tree) walk(l.items);
  return out;
}

/** How many items a tree has. */
export function treeItemCount(tree: ChecklistTree): number {
  return flatTexts(tree).length;
}

/** The plain reason a tree is over the limits, or null. */
export function treeLimits(tree: ChecklistTree): string | null {
  if (tree.length > MAX_LISTS) return `A task can have at most ${MAX_LISTS} checklists.`;
  if (treeItemCount(tree) > MAX_ITEMS) return `A task can have at most ${MAX_ITEMS} checklist items.`;
  const deepest = (nodes: ChecklistNode[] | undefined, level: number): number =>
    !nodes || nodes.length === 0 ? level - 1 : Math.max(...nodes.map((n) => deepest(n.children, level + 1)));
  if (tree.some((l) => deepest(l.items, 0) >= MAX_DEPTH)) return `A checklist can have at most ${MAX_DEPTH} levels.`;
  return null;
}

/** A task's live checklists as a tree (templates keep titles and nesting, never people or dates). */
export function treeFromRows(lists: readonly ListRow[], items: readonly ItemRow[]): ChecklistTree {
  const { items: ordered, lists: ls } = arrange(lists, items);
  const nodes = new Map<string, ChecklistNode>();
  const out: ChecklistTree = ls.map((l) => ({ title: l.title, items: [] }));
  const listIndex = new Map(ls.map((l, i) => [l.id, i]));
  for (const i of ordered) {
    const node: ChecklistNode = { text: i.text };
    nodes.set(i.id, node);
    const parent = i.parentId ? nodes.get(i.parentId) : undefined;
    if (parent) (parent.children ??= []).push(node);
    else out[listIndex.get(i.listId)!]!.items.push(node);
  }
  return out;
}
