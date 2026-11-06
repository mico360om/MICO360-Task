import type { ItemRow, ListRow } from './checklist-tree';

/** Every checklist and item of one task, deleted ones too (kept 30 days for Undo / Restore). */
export interface ChecklistRows {
  lists: ListRow[];
  items: ItemRow[];
}

/**
 * 1.23.3 Nested checklists: where a task's checklists are kept. Every change goes through `edit`, which
 * holds the task (one checklist change at a time per task, so two people ticking at once can never
 * leave a parent wrong) and saves exactly what the change did to the rows it was given.
 */
export interface ChecklistStore {
  /** The rows of a task, or null when the task is gone (deleted, merged, its project deleted). */
  read(taskId: string): Promise<ChecklistRows | null>;
  /**
   * Runs `change` with the task held: it changes the rows in place and pushes new ones; they are saved
   * (added, changed) before the hold ends. A throw saves nothing. NotFound-style null when the task is
   * gone: `change` isn't run and `edit` resolves to null.
   */
  edit<T>(taskId: string, change: (rows: ChecklistRows) => Promise<T> | T): Promise<{ value: T } | null>;
  /** The live task a live item / checklist is on; null when unknown, deleted, or its task is gone. */
  taskOfItem(itemId: string): Promise<string | null>;
  taskOfList(listId: string): Promise<string | null>;
  /** Removes for good what was deleted before `before`; how many rows went. */
  purge(before: Date): Promise<number>;
}

const clone = <T extends object>(r: T): T => ({ ...r });
export const cloneRows = (rows: ChecklistRows): ChecklistRows => ({ lists: rows.lists.map(clone), items: rows.items.map(clone) });

const FIELDS_LIST = ['taskId', 'title', 'position', 'createdById', 'createdAt', 'updatedAt', 'deletedAt', 'deletedById', 'deletedBatchId'] as const;
const FIELDS_ITEM = [
  'taskId', 'listId', 'parentId', 'text', 'done', 'position', 'createdAt', 'updatedAt', 'assigneeId', 'dueDate',
  'completedAt', 'completedById', 'deletedAt', 'deletedById', 'deletedBatchId',
] as const;

const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);

/** What changed between two copies of the rows: the rows to add and, per row, the fields to change. */
export function diffRows(before: ChecklistRows, after: ChecklistRows) {
  const pick = <R extends object>(rows: R[], beforeRows: R[], fields: readonly string[]) => {
    const old = new Map(beforeRows.map((r) => [(r as unknown as { id: string }).id, r]));
    const added: R[] = [];
    const changed: { id: string; data: Record<string, unknown> }[] = [];
    for (const r of rows) {
      const id = (r as unknown as { id: string }).id;
      const o = old.get(id);
      if (!o) {
        added.push(r);
        continue;
      }
      const data: Record<string, unknown> = {};
      for (const f of fields) {
        const v = (r as Record<string, unknown>)[f];
        if (!same(v, (o as Record<string, unknown>)[f])) data[f] = v;
      }
      if (Object.keys(data).length) changed.push({ id, data });
    }
    return { added, changed };
  };
  return { lists: pick(after.lists, before.lists, FIELDS_LIST), items: pick(after.items, before.items, FIELDS_ITEM) };
}

/** A store in memory (tests): tasks are live while `liveTasks` has them. */
export function createMemoryChecklistStore(opts: { liveTasks: () => Iterable<string> } = { liveTasks: () => ['t1', 't2'] }) {
  const rows: ChecklistRows = { lists: [], items: [] };
  const live = (taskId: string) => new Set(opts.liveTasks()).has(taskId);
  let queue: Promise<unknown> = Promise.resolve();
  const store: ChecklistStore & { rows: ChecklistRows } = {
    rows,
    async read(taskId) {
      if (!live(taskId)) return null;
      return cloneRows({ lists: rows.lists.filter((l) => l.taskId === taskId), items: rows.items.filter((i) => i.taskId === taskId) });
    },
    async edit(taskId, change) {
      const run = async () => {
        if (!live(taskId)) return null;
        const mine = { lists: rows.lists.filter((l) => l.taskId === taskId), items: rows.items.filter((i) => i.taskId === taskId) };
        const draft = cloneRows(mine);
        const value = await change(draft);
        const d = diffRows(mine, draft);
        rows.lists.push(...d.lists.added.map(clone));
        rows.items.push(...d.items.added.map(clone));
        for (const c of d.lists.changed) Object.assign(rows.lists.find((l) => l.id === c.id)!, c.data);
        for (const c of d.items.changed) Object.assign(rows.items.find((i) => i.id === c.id)!, c.data);
        return { value };
      };
      const next = queue.then(run, run);
      queue = next.catch(() => undefined);
      return next;
    },
    async taskOfItem(itemId) {
      const i = rows.items.find((r) => r.id === itemId && r.deletedAt === null);
      return i && live(i.taskId) ? i.taskId : null;
    },
    async taskOfList(listId) {
      const l = rows.lists.find((r) => r.id === listId && r.deletedAt === null);
      return l && live(l.taskId) ? l.taskId : null;
    },
    async purge(before) {
      const n = rows.items.length + rows.lists.length;
      const keepItem = (i: ItemRow) => !(i.deletedAt && i.deletedAt < before);
      const keepList = (l: ListRow) => !(l.deletedAt && l.deletedAt < before);
      const gone = new Set(rows.lists.filter((l) => !keepList(l)).map((l) => l.id));
      // An item kept whose checklist goes (it sits on another task after a merge Undo) loses only the link.
      for (const i of rows.items) if (keepItem(i) && i.listId && gone.has(i.listId)) i.listId = null;
      rows.items.splice(0, rows.items.length, ...rows.items.filter(keepItem));
      rows.lists.splice(0, rows.lists.length, ...rows.lists.filter(keepList));
      return n - rows.items.length - rows.lists.length;
    },
  };
  return store;
}
