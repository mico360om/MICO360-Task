import { HttpError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { newRowId } from '../../lib/row-id';
import type { TaskLookup } from './assignee-repository';
import type { ChecklistRows, ChecklistStore } from './checklist-store';
import {
  arrange,
  depthOf,
  descendantIds,
  isLive,
  leafPercent,
  liveLists,
  placeInGroup,
  planMove,
  settleParents,
  siblingsOf,
  subtreeHeight,
  wouldCycle,
  DEFAULT_LIST_TITLE,
  MAX_DEPTH,
  MAX_ITEMS,
  MAX_LISTS,
  TEXT_MAX,
  type Arranged,
  type ArrangedItem,
  type ArrangedList,
  type ChecklistTree,
  type ChecklistNode,
  type ItemRow,
  type ListRow,
  type MoveAction,
} from './checklist-tree';

/** Completion percentage of a checklist (0 when empty), rounded to the nearest percent. */
export function progressFromItems(items: { done: boolean }[]): number {
  if (items.length === 0) return 0;
  const done = items.filter((i) => i.done).length;
  return Math.round((done / items.length) * 100);
}

/** Full progress summary: X of Y done + percentage. */
export function summaryFromItems(items: { done: boolean }[]): { done: number; total: number; percent: number } {
  const done = items.filter((i) => i.done).length;
  return { done, total: items.length, percent: progressFromItems(items) };
}

/** How long a deleted checklist or item can be restored (then the daily sweep removes it for good). */
export const RESTORE_DAYS = 30;
const DAY_MS = 86_400_000;

/** A refused change to a parent's tick (it follows its sub-items). */
export class ChecklistParentError extends HttpError {
  constructor(message: string) {
    super(message, 'CHECKLIST_PARENT', 400);
  }
}
/** A move that would put an item under itself or one of its sub-items. */
export class ChecklistCircularError extends HttpError {
  constructor() {
    super('An item can’t go under itself or one of its sub-items.', 'CHECKLIST_CIRCULAR', 400);
  }
}
/** Over a limit (levels, items, checklists). */
export class ChecklistLimitError extends HttpError {
  constructor(message: string) {
    super(message, 'CHECKLIST_LIMIT', 400);
  }
}

/** One item as the apps get it (the old fields first; 1.23.3 adds the rest). */
export interface ChecklistItemView {
  id: string;
  taskId: string;
  text: string;
  done: boolean;
  position: number;
  listId: string;
  parentId: string | null;
  depth: number;
  assigneeId: string | null;
  assignee: { id: string; name: string } | null;
  dueDate: string | null;
  completedAt: string | null;
  completedById: string | null;
  childCount: number;
  subDone: number;
  subTotal: number;
}
export interface ChecklistListView {
  id: string;
  taskId: string;
  title: string;
  position: number;
  done: number;
  total: number;
}
export interface ChecklistView {
  items: ChecklistItemView[];
  lists: ChecklistListView[];
  done: number;
  total: number;
  percent: number;
}
export interface DeletedBatch {
  batchId: string;
  kind: 'item' | 'list';
  title: string;
  count: number;
  deletedAt: Date;
  deletedById: string | null;
  until: Date;
}

/** Where a new item goes: a checklist, under a parent, after a sibling (`afterId`; absent = last). */
export interface ChecklistPlace {
  listId?: string;
  parentId?: string | null;
  afterId?: string | null;
}
export type ChecklistMoveInput = { action: MoveAction } | { listId?: string; parentId: string | null; afterId: string | null };
export interface ItemPatch {
  done?: boolean;
  text?: string;
  assigneeId?: string | null;
  dueDate?: Date | null;
}

export interface ChecklistServiceDeps {
  store: ChecklistStore;
  taskLookup?: TaskLookup;
  now?: () => Date;
  /** Of these people, who may be given work on this task (its project's team; never clients). */
  eligibleAssignees?: (taskId: string, userIds: string[]) => Promise<string[]>;
  /** People's names, for an item's face. */
  namesOf?: (userIds: string[]) => Promise<Map<string, string>>;
  /** Told the checklist's new percentage after every change, so the task's own progress can follow it. */
  onProgress?: (taskId: string, percent: number) => void | Promise<void>;
  /** After a change to the words of a task (the task search index re-reads it). */
  onChanged?: (taskId: string) => void | Promise<void>;
}

const dayKey = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const withCopy = (text: string) => {
  const suffix = ' (copy)';
  return text.length + suffix.length <= TEXT_MAX ? `${text}${suffix}` : `${text.slice(0, TEXT_MAX - suffix.length)}${suffix}`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function cleanText(text: string, what = 'Checklist item text'): string {
  const t = text.trim();
  if (!t) throw new ValidationError(`${what} cannot be empty.`);
  if (t.length > TEXT_MAX) throw new ValidationError(`${what} can have at most ${TEXT_MAX} characters.`);
  return t;
}

/** A new item row. */
export function newItemRow(taskId: string, listId: string, data: Partial<ItemRow> & { text: string }, now: Date): ItemRow {
  return {
    id: newRowId(),
    taskId,
    listId,
    parentId: null,
    done: false,
    position: 0,
    createdAt: now,
    updatedAt: now,
    assigneeId: null,
    dueDate: null,
    completedAt: null,
    completedById: null,
    deletedAt: null,
    deletedById: null,
    deletedBatchId: null,
    ...data,
  };
}
export function newListRow(taskId: string, title: string, position: number, createdById: string | null, now: Date): ListRow {
  return { id: newRowId(), taskId, title, position, createdById, createdAt: now, updatedAt: now, deletedAt: null, deletedById: null, deletedBatchId: null };
}

/**
 * The rows a checklist tree makes on a task (the New task form, a template): lists in order, each
 * item's sub-items under it, nothing ticked. No people or dates (templates never keep them).
 */
export function rowsFromTree(taskId: string, tree: ChecklistTree, createdById: string | null, now: Date): ChecklistRows {
  const lists: ListRow[] = [];
  const items: ItemRow[] = [];
  tree.forEach((l, li) => {
    const list = newListRow(taskId, l.title.trim().slice(0, TEXT_MAX) || DEFAULT_LIST_TITLE, li, createdById, now);
    lists.push(list);
    const walk = (nodes: ChecklistNode[], parentId: string | null) =>
      nodes.forEach((n, position) => {
        const row = newItemRow(taskId, list.id, { text: n.text.trim().slice(0, TEXT_MAX), parentId, position }, now);
        items.push(row);
        if (n.children?.length) walk(n.children, row.id);
      });
    walk(l.items, null);
  });
  return { lists, items };
}

/**
 * A copy of a task's live checklists for its next repeat (design call 2): ticks cleared, each item's
 * person kept, its due date moved by `shiftMs` (the task's due date's move) — cleared when the new task
 * has no due date (`shiftMs` null).
 */
export function copyRowsForRepeat(source: ChecklistRows, taskId: string, shiftMs: number | null, now: Date): ChecklistRows {
  const { lists: ls, items: its } = arrange(source.lists, source.items);
  const listIds = new Map<string, string>();
  const lists = ls.map((l, i) => {
    const row = newListRow(taskId, l.title, i, l.createdById, now);
    listIds.set(l.id, row.id);
    return row;
  });
  const itemIds = new Map<string, string>();
  const items = its.map((i) => {
    const row = newItemRow(
      taskId,
      listIds.get(i.listId)!,
      { text: i.text, position: i.position, assigneeId: i.assigneeId, dueDate: i.dueDate && shiftMs !== null ? new Date(i.dueDate.getTime() + shiftMs) : null },
      now,
    );
    itemIds.set(i.id, row.id);
    return row;
  });
  its.forEach((i, n) => {
    items[n]!.parentId = i.parentId ? (itemIds.get(i.parentId) ?? null) : null;
  });
  return { lists, items };
}

export function createChecklistService(deps: ChecklistServiceDeps) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());

  // ---- reading -------------------------------------------------------------------------------

  async function rowsOrThrow(taskId: string): Promise<ChecklistRows> {
    const rows = await store.read(taskId);
    if (!rows) throw new NotFoundError('Task not found.');
    return rows;
  }

  /** Items in no live checklist of their task (older apps, data from before 1.23.3) need one. */
  const needsHome = (rows: ChecklistRows) => {
    const ids = new Set(rows.lists.filter(isLive).map((l) => l.id));
    return rows.items.some((i) => isLive(i) && (!i.listId || !ids.has(i.listId)));
  };
  /** Puts such items at the top level of the first live checklist ("Checklist" made if none). */
  function home(taskId: string, rows: ChecklistRows, at: Date, actorId: string | null): void {
    if (!needsHome(rows)) return;
    let first = liveLists(rows.lists)[0];
    if (!first) {
      first = newListRow(taskId, DEFAULT_LIST_TITLE, 0, actorId, at);
      rows.lists.push(first);
    }
    const ids = new Set(rows.lists.filter(isLive).map((l) => l.id));
    for (const i of rows.items) {
      if (!isLive(i) || (i.listId && ids.has(i.listId))) continue;
      i.listId = first.id;
      i.parentId = null;
      i.updatedAt = at;
    }
  }

  async function namesFor(items: { assigneeId: string | null }[]): Promise<Map<string, string>> {
    const ids = [...new Set(items.map((i) => i.assigneeId).filter((x): x is string => !!x))];
    if (!ids.length || !deps.namesOf) return new Map();
    return deps.namesOf(ids);
  }
  const itemView = (i: ArrangedItem, names: Map<string, string>): ChecklistItemView => ({
    id: i.id,
    taskId: i.taskId,
    text: i.text,
    done: i.done,
    position: i.position,
    listId: i.listId,
    parentId: i.parentId,
    depth: i.depth,
    assigneeId: i.assigneeId,
    assignee: i.assigneeId ? { id: i.assigneeId, name: names.get(i.assigneeId) ?? 'Someone' } : null,
    dueDate: dayKey(i.dueDate),
    completedAt: i.completedAt ? i.completedAt.toISOString() : null,
    completedById: i.completedById,
    childCount: i.childCount,
    subDone: i.subDone,
    subTotal: i.subTotal,
  });
  const listView = (l: ArrangedList): ChecklistListView => ({ id: l.id, taskId: l.taskId, title: l.title, position: l.position, done: l.done, total: l.total });

  async function viewOf(arranged: Arranged): Promise<ChecklistView> {
    const names = await namesFor(arranged.items);
    return { items: arranged.items.map((i) => itemView(i, names)), lists: arranged.lists.map(listView), done: arranged.done, total: arranged.total, percent: arranged.percent };
  }

  /** A task's checklists as the apps get them (items with no checklist are given one first). */
  async function view(taskId: string): Promise<ChecklistView> {
    let rows = await rowsOrThrow(taskId);
    if (needsHome(rows)) {
      await store.edit(taskId, (r) => home(taskId, r, now(), null));
      rows = await rowsOrThrow(taskId);
    }
    return viewOf(arrange(rows.lists, rows.items));
  }

  /** One item, arranged, from rows. */
  async function itemFrom(rows: ChecklistRows, id: string): Promise<ChecklistItemView> {
    const a = arrange(rows.lists, rows.items).items.find((i) => i.id === id);
    if (!a) throw new NotFoundError('Checklist item not found.');
    return itemView(a, await namesFor([a]));
  }

  // ---- changing --------------------------------------------------------------------------------

  /** Best effort: a checklist change is never undone because the progress could not be passed on. */
  async function report(taskId: string, rows: ChecklistRows): Promise<void> {
    if (!deps.onProgress) return;
    try {
      await deps.onProgress(taskId, leafPercent(rows.items.filter(isLive)));
    } catch {
      /* the checklist itself was saved */
    }
  }

  /** Runs a change with the task held; afterwards the parents follow their sub-items. */
  async function edit<T>(taskId: string, actorId: string | null, change: (rows: ChecklistRows, at: Date) => Promise<T> | T, opts: { words?: boolean } = {}): Promise<{ value: T; rows: ChecklistRows }> {
    const at = now();
    const box: { rows?: ChecklistRows } = {};
    const res = await store.edit(taskId, async (rows) => {
      home(taskId, rows, at, actorId);
      const value = await change(rows, at);
      settleParents(rows.items, { now: at, actorId });
      box.rows = rows;
      return value;
    });
    const after = box.rows;
    if (!res || !after) throw new NotFoundError('Task not found.');
    await report(taskId, after);
    if (opts.words) {
      try {
        await deps.onChanged?.(taskId);
      } catch {
        /* the search index catches up on its own */
      }
    }
    return { value: res.value, rows: after };
  }

  async function ensureTask(taskId: string): Promise<void> {
    if (deps.taskLookup && !(await deps.taskLookup.exists(taskId))) throw new NotFoundError('Task not found.');
  }

  async function taskOfItem(itemId: string): Promise<string> {
    const taskId = await store.taskOfItem(itemId);
    if (!taskId) throw new NotFoundError('Checklist item not found.');
    return taskId;
  }
  async function taskOfList(listId: string): Promise<string> {
    const taskId = await store.taskOfList(listId);
    if (!taskId) throw new NotFoundError('Checklist not found.');
    return taskId;
  }

  const liveItem = (rows: ChecklistRows, id: string): ItemRow => {
    const i = rows.items.find((r) => r.id === id && isLive(r));
    if (!i) throw new NotFoundError('Checklist item not found.');
    return i;
  };
  const liveList = (rows: ChecklistRows, id: string): ListRow => {
    const l = rows.lists.find((r) => r.id === id && isLive(r));
    if (!l) throw new NotFoundError('Checklist not found.');
    return l;
  };
  const roomFor = (rows: ChecklistRows, adding: number) => {
    if (rows.items.filter(isLive).length + adding > MAX_ITEMS) throw new ChecklistLimitError(`A task can have at most ${MAX_ITEMS} checklist items.`);
  };
  const roomForList = (rows: ChecklistRows) => {
    if (liveLists(rows.lists).length + 1 > MAX_LISTS) throw new ChecklistLimitError(`A task can have at most ${MAX_LISTS} checklists.`);
  };
  const tooDeep = () => new ChecklistLimitError(`A checklist can have at most ${MAX_DEPTH} levels.`);
  /** Renumber the live lists in this order. */
  const orderLists = (ordered: ListRow[], at: Date) =>
    ordered.forEach((l, position) => {
      if (l.position !== position) {
        l.position = position;
        l.updatedAt = at;
      }
    });

  async function assertAssignable(taskId: string, assigneeId: string | null | undefined): Promise<void> {
    if (!assigneeId || !deps.eligibleAssignees) return;
    const ok = await deps.eligibleAssignees(taskId, [assigneeId]);
    if (!ok.includes(assigneeId)) throw new ValidationError('Only active members of this project can be given a checklist item.');
  }

  /** Where new items go: their checklist and parent, checked. */
  function placeFor(taskId: string, rows: ChecklistRows, at: Date, actorId: string | null, place: ChecklistPlace): { list: ListRow; parent: ItemRow | null } {
    let parent: ItemRow | null = null;
    if (place.parentId) parent = liveItem(rows, place.parentId);
    else if (place.afterId) {
      const after = liveItem(rows, place.afterId);
      parent = after.parentId ? (rows.items.find((i) => i.id === after.parentId && isLive(i)) ?? null) : null;
    }
    let list: ListRow;
    if (parent) {
      list = liveList(rows, parent.listId!);
      if (place.listId && place.listId !== list.id) throw new ValidationError('That item is in another checklist.');
    } else if (place.listId) list = liveList(rows, place.listId);
    else if (place.afterId) list = liveList(rows, liveItem(rows, place.afterId).listId!);
    else {
      const first = liveLists(rows.lists)[0];
      if (first) list = first;
      else {
        list = newListRow(taskId, DEFAULT_LIST_TITLE, 0, actorId, at);
        rows.lists.push(list);
      }
    }
    if (parent && depthOf(rows.items, parent.id) + 1 >= MAX_DEPTH) throw tooDeep();
    return { list, parent };
  }

  /** Adds items (one or several) at a place; the first lands right after `afterId`, the rest after it. */
  async function addItems(
    taskId: string,
    actorId: string | null,
    input: { texts: string[]; assigneeId?: string | null; dueDate?: Date | null } & ChecklistPlace,
  ): Promise<{ items: ChecklistItemView[]; listTitle: string; parentText: string | null }> {
    await ensureTask(taskId);
    const texts = input.texts.map((t) => cleanText(t));
    if (texts.length === 0) throw new ValidationError('Add at least one item.');
    await assertAssignable(taskId, input.assigneeId);
    const { value, rows } = await edit(
      taskId,
      actorId,
      (rows, at) => {
        roomFor(rows, texts.length);
        const { list, parent } = placeFor(taskId, rows, at, actorId, input);
        const group = siblingsOf(rows.items, list.id, parent?.id ?? null);
        const made = texts.map((text) => newItemRow(taskId, list.id, { text, parentId: parent?.id ?? null, assigneeId: input.assigneeId ?? null, dueDate: input.dueDate ?? null }, at));
        rows.items.push(...made);
        const afterId = input.afterId === undefined ? (group.length ? group[group.length - 1]!.id : null) : input.afterId;
        placeInGroup(rows.items, list.id, parent?.id ?? null, made.map((m) => m.id), afterId, at);
        return { ids: made.map((m) => m.id), listTitle: list.title, parentText: parent?.text ?? null };
      },
      { words: true },
    );
    const arranged = arrange(rows.lists, rows.items);
    const names = await namesFor(arranged.items.filter((i) => value.ids.includes(i.id)));
    const items = value.ids.map((id) => itemView(arranged.items.find((i) => i.id === id)!, names));
    return { items, listTitle: value.listTitle, parentText: value.parentText };
  }

  /** The old one-item add (older apps): top level of the first checklist. */
  async function addItem(taskId: string, text: string, actorId: string | null = null, place: ChecklistPlace = {}): Promise<ChecklistItemView> {
    return (await addItems(taskId, actorId, { texts: [text], ...place })).items[0]!;
  }

  /** An item of a live task, as the apps get it; NotFound for an unknown id (callers check access to `taskId`). */
  async function getItem(itemId: string): Promise<ChecklistItemView> {
    const taskId = await taskOfItem(itemId);
    return itemFrom(await rowsOrThrow(taskId), itemId);
  }

  /**
   * Changes an item: its words, its tick (a leaf only — a parent follows its sub-items), who it's for and
   * by when. Returns it before and after.
   */
  async function updateItem(itemId: string, actorId: string | null, patch: ItemPatch): Promise<{ before: ChecklistItemView; item: ChecklistItemView }> {
    const taskId = await taskOfItem(itemId);
    const text = patch.text !== undefined ? cleanText(patch.text) : undefined;
    if (patch.assigneeId !== undefined) await assertAssignable(taskId, patch.assigneeId);
    const { value: was, rows } = await edit(
      taskId,
      actorId,
      (rows, at) => {
        // Read from the rows only: nothing else is asked of the database while the task is held (a
        // second connection inside the hold could wait on a pool the holds have filled).
        const was = arrange(rows.lists, rows.items).items.find((i) => i.id === itemId);
        if (!was) throw new NotFoundError('Checklist item not found.');
        const row = liveItem(rows, itemId);
        if (patch.done !== undefined && patch.done !== row.done) {
          if (was.childCount > 0) {
            const open = was.subTotal - was.subDone;
            throw new ChecklistParentError(patch.done ? `${plural(open, 'sub-item')} still open.` : 'Its sub-items are all done — reopen one of them instead.');
          }
          row.done = patch.done;
          row.completedAt = patch.done ? at : null;
          row.completedById = patch.done ? actorId : null;
          row.updatedAt = at;
        }
        if (text !== undefined && text !== row.text) {
          row.text = text;
          row.updatedAt = at;
        }
        if (patch.assigneeId !== undefined && patch.assigneeId !== row.assigneeId) {
          row.assigneeId = patch.assigneeId;
          row.updatedAt = at;
        }
        if (patch.dueDate !== undefined && dayKey(patch.dueDate) !== dayKey(row.dueDate)) {
          row.dueDate = patch.dueDate;
          row.updatedAt = at;
        }
        return was;
      },
      { words: text !== undefined },
    );
    const item = await itemFrom(rows, itemId);
    const names = await namesFor([was]);
    return { before: itemView(was, names), item };
  }

  async function toggleItem(itemId: string, done: boolean, actorId: string | null = null): Promise<ChecklistItemView> {
    return (await updateItem(itemId, actorId, { done })).item;
  }
  async function editItem(itemId: string, text: string, actorId: string | null = null): Promise<ChecklistItemView> {
    return (await updateItem(itemId, actorId, { text })).item;
  }

  /** Deletes an item and its sub-items (kept 30 days): the batch Undo and Restore bring back. */
  async function removeItem(itemId: string, actorId: string | null = null): Promise<{ taskId: string; batchId: string; count: number; text: string }> {
    const taskId = await taskOfItem(itemId);
    const batchId = newRowId();
    const { value } = await edit(
      taskId,
      actorId,
      (rows, at) => {
        const row = liveItem(rows, itemId);
        const ids = new Set([row.id, ...descendantIds(rows.items, row.id)]);
        for (const i of rows.items) {
          if (!ids.has(i.id) || !isLive(i)) continue;
          i.deletedAt = at;
          i.deletedById = actorId;
          i.deletedBatchId = batchId;
          i.updatedAt = at;
        }
        return { count: ids.size, text: row.text };
      },
      { words: true },
    );
    return { taskId, batchId, ...value };
  }

  /** Copies of these sub-trees with new ids into `listId`, ticks cleared, people and dates kept. */
  function copySubtree(rows: ChecklistRows, rootIds: string[], listId: string, at: Date): { roots: ItemRow[]; all: ItemRow[] } {
    const ids = new Map<string, string>();
    const all: ItemRow[] = [];
    const roots: ItemRow[] = [];
    const wanted = new Set(rootIds.flatMap((r) => [r, ...descendantIds(rows.items, r)]));
    for (const i of arrange(rows.lists, rows.items).items) {
      if (!wanted.has(i.id)) continue;
      const isRoot = rootIds.includes(i.id);
      const copy = newItemRow(
        i.taskId,
        listId,
        { text: i.text, position: i.position, assigneeId: i.assigneeId, dueDate: i.dueDate, parentId: isRoot ? i.parentId : (ids.get(i.parentId ?? '') ?? null) },
        at,
      );
      ids.set(i.id, copy.id);
      all.push(copy);
      if (isRoot) roots.push(copy);
    }
    return { roots, all };
  }

  /** A copy of an item and its sub-items right after it ("… (copy)"), ticks cleared. */
  async function duplicateItem(itemId: string, actorId: string | null = null): Promise<{ taskId: string; item: ChecklistItemView; count: number; text: string }> {
    const taskId = await taskOfItem(itemId);
    const { value, rows } = await edit(
      taskId,
      actorId,
      (rows, at) => {
        const row = liveItem(rows, itemId);
        const { roots, all } = copySubtree(rows, [row.id], row.listId!, at);
        roomFor(rows, all.length);
        roots[0]!.text = withCopy(row.text);
        rows.items.push(...all);
        placeInGroup(rows.items, row.listId!, row.parentId ?? null, [roots[0]!.id], row.id, at);
        return { id: roots[0]!.id, count: all.length, text: row.text };
      },
      { words: true },
    );
    return { taskId, item: await itemFrom(rows, value.id), count: value.count, text: value.text };
  }

  /** Indent, outdent, up, down — or to a place (a checklist, a parent, after a sibling). */
  async function moveItem(itemId: string, actorId: string | null, move: ChecklistMoveInput): Promise<{ taskId: string; item: ChecklistItemView; how: MoveAction | 'move'; text: string }> {
    const taskId = await taskOfItem(itemId);
    const how = 'action' in move ? move.action : 'move';
    const { value, rows } = await edit(taskId, actorId, (rows, at) => {
      const row = liveItem(rows, itemId);
      let target: { listId: string; parentId: string | null; afterId: string | null };
      if ('action' in move) {
        const planned = planMove(rows.items, itemId, move.action);
        if (!planned) throw new ValidationError('This item can’t move that way.');
        target = planned;
      } else {
        if (move.parentId && wouldCycle(rows.items, itemId, move.parentId)) throw new ChecklistCircularError();
        const parent = move.parentId ? liveItem(rows, move.parentId) : null;
        const listId = parent ? parent.listId! : (move.listId ?? row.listId!);
        liveList(rows, listId);
        if (parent && move.listId && move.listId !== parent.listId) throw new ValidationError('That item is in another checklist.');
        if (move.afterId && move.afterId !== itemId) {
          const after = liveItem(rows, move.afterId);
          if ((after.parentId ?? null) !== (parent?.id ?? null) || after.listId !== listId) throw new ValidationError('Put it after an item at the same level.');
        }
        target = { listId, parentId: parent?.id ?? null, afterId: move.afterId };
      }
      if (wouldCycle(rows.items, itemId, target.parentId)) throw new ChecklistCircularError();
      const newDepth = target.parentId ? depthOf(rows.items, target.parentId) + 1 : 0;
      if (newDepth + subtreeHeight(rows.items, itemId) - 1 >= MAX_DEPTH) throw tooDeep();
      if (target.afterId === itemId) return row.text;
      const old = { listId: row.listId!, parentId: row.parentId ?? null };
      if (target.listId !== row.listId) {
        for (const id of [row.id, ...descendantIds(rows.items, row.id, { withDeleted: true })]) {
          const r = rows.items.find((i) => i.id === id)!;
          r.listId = target.listId;
          r.updatedAt = at;
        }
      }
      row.parentId = target.parentId;
      row.updatedAt = at;
      placeInGroup(rows.items, target.listId, target.parentId, [row.id], target.afterId, at);
      if (old.parentId !== target.parentId || old.listId !== target.listId) {
        siblingsOf(rows.items, old.listId, old.parentId).forEach((s, position) => {
          if (s.position !== position) {
            s.position = position;
            s.updatedAt = at;
          }
        });
      }
      return row.text;
    });
    return { taskId, item: await itemFrom(rows, itemId), how, text: value };
  }

  /** The old reorder (older apps send every item id): each sibling group keeps the order given; the tree stays. */
  async function reorderItems(taskId: string, orderedIds: string[], actorId: string | null = null): Promise<ChecklistItemView[]> {
    await ensureTask(taskId);
    const { rows } = await edit(taskId, actorId, (rows, at) => {
      const rank = new Map(orderedIds.map((id, i) => [id, i]));
      const groups = new Set(rows.items.filter(isLive).map((i) => `${i.listId}|${i.parentId ?? ''}`));
      for (const key of groups) {
        const [listId, parentId] = key.split('|');
        const current = siblingsOf(rows.items, listId!, parentId || null);
        const named = current.filter((s) => rank.has(s.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
        const rest = current.filter((s) => !rank.has(s.id));
        [...named, ...rest].forEach((s, position) => {
          if (s.position !== position) {
            s.position = position;
            s.updatedAt = at;
          }
        });
      }
    });
    return (await viewOf(arrange(rows.lists, rows.items))).items;
  }

  // ---- checklists ----------------------------------------------------------------------------

  async function addList(taskId: string, actorId: string | null, title: string, afterId?: string | null): Promise<ChecklistListView> {
    await ensureTask(taskId);
    const clean = cleanText(title, 'A checklist title');
    const { value, rows } = await edit(
      taskId,
      actorId,
      (rows, at) => {
        roomForList(rows);
        const ordered = liveLists(rows.lists);
        const list = newListRow(taskId, clean, ordered.length, actorId, at);
        rows.lists.push(list);
        const cut = afterId ? ordered.findIndex((l) => l.id === afterId) + 1 || ordered.length : ordered.length;
        orderLists([...ordered.slice(0, cut), list, ...ordered.slice(cut)], at);
        return list.id;
      },
      { words: true },
    );
    return listView(arrange(rows.lists, rows.items).lists.find((l) => l.id === value)!);
  }

  async function renameList(listId: string, actorId: string | null, title: string): Promise<{ taskId: string; from: string; list: ChecklistListView }> {
    const taskId = await taskOfList(listId);
    const clean = cleanText(title, 'A checklist title');
    const { value, rows } = await edit(
      taskId,
      actorId,
      (rows, at) => {
        const l = liveList(rows, listId);
        const from = l.title;
        if (l.title !== clean) {
          l.title = clean;
          l.updatedAt = at;
        }
        return from;
      },
      { words: true },
    );
    return { taskId, from: value, list: listView(arrange(rows.lists, rows.items).lists.find((l) => l.id === listId)!) };
  }

  /** A copy of a checklist ("… (copy)") right after it: every item, ticks cleared, people and dates kept. */
  async function duplicateList(listId: string, actorId: string | null = null): Promise<{ taskId: string; list: ChecklistListView; count: number; title: string }> {
    const taskId = await taskOfList(listId);
    const { value, rows } = await edit(
      taskId,
      actorId,
      (rows, at) => {
        const source = liveList(rows, listId);
        roomForList(rows);
        const ordered = liveLists(rows.lists);
        const copy = newListRow(taskId, withCopy(source.title), ordered.length, actorId, at);
        const { all } = copySubtree(rows, siblingsOf(rows.items, listId, null).map((i) => i.id), copy.id, at);
        roomFor(rows, all.length);
        rows.lists.push(copy);
        rows.items.push(...all);
        const cut = ordered.findIndex((l) => l.id === listId) + 1;
        orderLists([...ordered.slice(0, cut), copy, ...ordered.slice(cut)], at);
        return { id: copy.id, count: all.length, title: source.title };
      },
      { words: true },
    );
    return { taskId, list: listView(arrange(rows.lists, rows.items).lists.find((l) => l.id === value.id)!), count: value.count, title: value.title };
  }

  /** Deletes a checklist and its items (kept 30 days). */
  async function removeList(listId: string, actorId: string | null = null): Promise<{ taskId: string; batchId: string; count: number; title: string }> {
    const taskId = await taskOfList(listId);
    const batchId = newRowId();
    const { value } = await edit(
      taskId,
      actorId,
      (rows, at) => {
        const l = liveList(rows, listId);
        l.deletedAt = at;
        l.deletedById = actorId;
        l.deletedBatchId = batchId;
        l.updatedAt = at;
        let count = 0;
        for (const i of rows.items) {
          if (i.listId !== listId || !isLive(i)) continue;
          i.deletedAt = at;
          i.deletedById = actorId;
          i.deletedBatchId = batchId;
          i.updatedAt = at;
          count += 1;
        }
        return { count, title: l.title };
      },
      { words: true },
    );
    return { taskId, batchId, ...value };
  }

  // ---- deleted: Undo, Restore ------------------------------------------------------------------

  /** What was deleted from a task and can still be restored (newest first). Counts include the item itself. */
  async function deletedBatches(taskId: string): Promise<DeletedBatch[]> {
    await ensureTask(taskId);
    const rows = await rowsOrThrow(taskId);
    const since = new Date(now().getTime() - RESTORE_DAYS * DAY_MS);
    const until = (d: Date) => new Date(d.getTime() + RESTORE_DAYS * DAY_MS);
    const out = new Map<string, DeletedBatch>();
    for (const l of rows.lists) {
      if (!l.deletedAt || !l.deletedBatchId || l.deletedAt < since) continue;
      out.set(l.deletedBatchId, { batchId: l.deletedBatchId, kind: 'list', title: l.title, count: 0, deletedAt: l.deletedAt, deletedById: l.deletedById, until: until(l.deletedAt) });
    }
    const byBatch = new Map<string, ItemRow[]>();
    for (const i of rows.items) {
      if (!i.deletedAt || !i.deletedBatchId || i.deletedAt < since) continue;
      byBatch.set(i.deletedBatchId, [...(byBatch.get(i.deletedBatchId) ?? []), i]);
    }
    for (const [batchId, items] of byBatch) {
      const listBatch = out.get(batchId);
      if (listBatch) {
        listBatch.count += items.length;
        continue;
      }
      const ids = new Set(items.map((i) => i.id));
      const root = items.find((i) => !i.parentId || !ids.has(i.parentId)) ?? items[0]!;
      out.set(batchId, { batchId, kind: 'item', title: root.text, count: items.length, deletedAt: root.deletedAt!, deletedById: root.deletedById, until: until(root.deletedAt!) });
    }
    return [...out.values()].sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
  }

  /**
   * Brings a deleted item (with its sub-items) or checklist back, while it can be restored. An item whose
   * parent or checklist is gone goes to the top level of its checklist, or of the first one.
   */
  async function restore(taskId: string, actorId: string | null, batchId: string): Promise<{ taskId: string; restored: number; count: number; kind: 'item' | 'list'; title: string }> {
    await ensureTask(taskId);
    const since = new Date(now().getTime() - RESTORE_DAYS * DAY_MS);
    const { value } = await edit(
      taskId,
      actorId,
      (rows, at) => {
        const lists = rows.lists.filter((l) => l.deletedBatchId === batchId && l.deletedAt && l.deletedAt >= since);
        const items = rows.items.filter((i) => i.deletedBatchId === batchId && i.deletedAt && i.deletedAt >= since);
        if (!lists.length && !items.length) throw new NotFoundError('That can no longer be restored.');
        if (lists.length) roomForList(rows);
        roomFor(rows, items.length);
        const ids = new Set(items.map((i) => i.id));
        const root = items.find((i) => !i.parentId || !ids.has(i.parentId));
        for (const r of [...lists, ...items]) {
          r.deletedAt = null;
          r.deletedById = null;
          r.deletedBatchId = null;
          r.updatedAt = at;
        }
        const liveListIds = new Set(rows.lists.filter(isLive).map((l) => l.id));
        const liveIds = new Set(rows.items.filter(isLive).map((x) => x.id));
        for (const i of items) {
          if (ids.has(i.parentId ?? '')) continue;
          if (!i.listId || !liveListIds.has(i.listId)) {
            let first = liveLists(rows.lists)[0];
            if (!first) {
              first = newListRow(taskId, DEFAULT_LIST_TITLE, 0, actorId, at);
              rows.lists.push(first);
              liveListIds.add(first.id);
            }
            for (const id of [i.id, ...descendantIds(rows.items, i.id)]) rows.items.find((x) => x.id === id)!.listId = first.id;
            i.parentId = null;
          } else if (i.parentId && !liveIds.has(i.parentId)) i.parentId = null;
          else if (i.parentId) {
            // Its parent is live but moved to another checklist since: it goes with its parent.
            const parent = rows.items.find((x) => x.id === i.parentId)!;
            if (parent.listId !== i.listId) for (const id of [i.id, ...descendantIds(rows.items, i.id)]) rows.items.find((x) => x.id === id)!.listId = parent.listId;
          }
          // Never past 20 levels (its old parent may sit deeper now): it comes back as far up as needed.
          while (i.parentId && depthOf(rows.items, i.parentId) + subtreeHeight(rows.items, i.id) >= MAX_DEPTH) {
            i.parentId = rows.items.find((x) => x.id === i.parentId)?.parentId ?? null;
          }
        }
        if (root && !lists.length) {
          // Back where it was in its group (its old position), the rest shifted after it.
          const group = siblingsOf(rows.items, root.listId!, root.parentId ?? null).filter((s) => s.id !== root.id);
          const before = group.filter((s) => s.position < root.position);
          placeInGroup(rows.items, root.listId!, root.parentId ?? null, [root.id], before.length ? before[before.length - 1]!.id : null, at);
        }
        return { restored: items.length + lists.length, count: items.length, kind: (lists.length ? 'list' : 'item') as 'item' | 'list', title: lists[0]?.title ?? root?.text ?? '' };
      },
      { words: true },
    );
    return { taskId, ...value };
  }

  /** Removes for good what was deleted more than 30 days ago (the daily sweep). */
  async function purge(): Promise<number> {
    return store.purge(new Date(now().getTime() - RESTORE_DAYS * DAY_MS));
  }

  // ---- old reads ---------------------------------------------------------------------------------

  async function listItems(taskId: string): Promise<ChecklistItemView[]> {
    await ensureTask(taskId);
    return (await view(taskId)).items;
  }
  async function summary(taskId: string): Promise<{ done: number; total: number; percent: number }> {
    const rows = await store.read(taskId);
    if (!rows) return { done: 0, total: 0, percent: 0 };
    const a = arrange(rows.lists, rows.items);
    return { done: a.done, total: a.total, percent: a.percent };
  }
  async function progress(taskId: string): Promise<number> {
    return (await summary(taskId)).percent;
  }

  return {
    view,
    listItems,
    summary,
    progress,
    getItem,
    addItem,
    addItems,
    updateItem,
    toggleItem,
    editItem,
    removeItem,
    duplicateItem,
    moveItem,
    reorderItems,
    addList,
    renameList,
    duplicateList,
    removeList,
    deletedBatches,
    restore,
    purge,
    taskOfItem,
    taskOfList,
  };
}

export type ChecklistService = ReturnType<typeof createChecklistService>;
