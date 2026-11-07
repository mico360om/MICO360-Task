import type { ApiClient } from '../lib/api-client';
import { noteMergedWrite } from '../lib/merged-write';
import type { ChecklistMove } from '../lib/checklist-tree';

/** 1.23.3: a task has several checklists; done/total count the real to-do items (no sub-items) in it. */
export interface ApiChecklistList {
  id: string;
  taskId: string;
  title: string;
  position: number;
  done: number;
  total: number;
}

export interface ApiChecklistItem {
  id: string;
  taskId: string;
  text: string;
  done: boolean;
  position: number;
  // 1.23.3 nested checklists (an older server leaves them out: one flat list).
  listId?: string;
  parentId?: string | null;
  /** 0 = top level. */
  depth?: number;
  assigneeId?: string | null;
  assignee?: { id: string; name: string } | null;
  /** 'YYYY-MM-DD'. */
  dueDate?: string | null;
  completedAt?: string | null;
  completedById?: string | null;
  /** Live direct sub-items. */
  childCount?: number;
  /** Leaves under a parent, and how many are done (0/0 on a leaf). */
  subDone?: number;
  subTotal?: number;
}

export interface ApiChecklist {
  /** Every item, list by list in tree order. */
  items: ApiChecklistItem[];
  progress: number;
  done?: number;
  total?: number;
  lists?: ApiChecklistList[];
}

/** A deleted item (with its sub-items) or checklist that can still be restored (30 days). */
export interface ChecklistDeletedBatch {
  batchId: string;
  kind: 'item' | 'list';
  title: string;
  count: number;
  deletedAt: string;
  deletedBy: { id: string; name: string } | null;
  until: string;
}

/** What a delete answers: the batch to restore with Undo. */
export interface ChecklistRemoved {
  batchId: string;
  count: number;
  taskId: string;
}

/** An open item assigned to me (My Tasks → "Checklist items for me"). */
export interface MyChecklistItem {
  id: string;
  text: string;
  done: boolean;
  dueDate: string | null;
  /** Has sub-items: it ticks itself when they are done. */
  isParent: boolean;
  openSubItems: number;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  projectId: string;
  listId: string;
  listTitle: string;
}

/** Where a new item goes: a checklist, under a parent, after a sibling (each optional). */
export interface ChecklistPlace {
  listId?: string;
  parentId?: string | null;
  afterId?: string | null;
}

/** Leave out what isn't set (the server's "top level of the first checklist" when nothing is). */
const placeBody = (at?: ChecklistPlace) => ({
  ...(at?.listId ? { listId: at.listId } : {}),
  ...(at?.parentId ? { parentId: at.parentId } : {}),
  ...(at?.afterId ? { afterId: at.afterId } : {}),
});

export function checklistApi(client: ApiClient) {
  return {
    list: (taskId: string) => client.get<{ data: ApiChecklist }>(`/tasks/${taskId}/checklist`).then((r) => r.data),
    add: (taskId: string, text: string, at?: ChecklistPlace) =>
      client.post<{ data: ApiChecklistItem }>(`/tasks/${taskId}/checklist`, { text, ...placeBody(at) }).then((r) => (noteMergedWrite(r), r.data)),
    /** Several items at once (pasted lines, AI steps): one "added N items" line in the history. */
    addMany: (taskId: string, texts: string[], at?: ChecklistPlace) =>
      client.post<{ data: { items: ApiChecklistItem[] } }>(`/tasks/${taskId}/checklist/batch`, { texts, ...placeBody(at) }).then((r) => (noteMergedWrite(r), r.data)),
    toggle: (itemId: string, done: boolean) => client.put<{ data: ApiChecklistItem }>(`/checklist/${itemId}`, { done }).then((r) => r.data),
    /** Change an item's text. */
    rename: (itemId: string, text: string) => client.put<{ data: ApiChecklistItem }>(`/checklist/${itemId}`, { text }).then((r) => r.data),
    /** Give an item to a person of the task's team, or to no one (null). */
    assign: (itemId: string, assigneeId: string | null) => client.put<{ data: ApiChecklistItem }>(`/checklist/${itemId}`, { assigneeId }).then((r) => r.data),
    /** An item's due day ('YYYY-MM-DD'), or none. */
    setDue: (itemId: string, dueDate: string | null) => client.put<{ data: ApiChecklistItem }>(`/checklist/${itemId}`, { dueDate }).then((r) => r.data),
    /** Put the task's items in this order (every item id, first to last) — older apps; within each sibling group. */
    reorder: (taskId: string, orderedIds: string[]) =>
      client.put<{ data: ApiChecklistItem[] }>(`/tasks/${taskId}/checklist/reorder`, { orderedIds }).then((r) => r.data),
    /** Delete an item and its sub-items (kept 30 days): the batch to restore. An older server answers nothing. */
    remove: (itemId: string) => client.del<{ data?: ChecklistRemoved } | undefined>(`/checklist/${itemId}`).then((r) => r?.data),
    /** A copy of the item and its sub-items right after it, ticks cleared. */
    duplicate: (itemId: string) => client.post<{ data: { item: ApiChecklistItem; count: number } }>(`/checklist/${itemId}/duplicate`, {}).then((r) => r.data),
    move: (itemId: string, action: ChecklistMove) => client.post<{ data: ApiChecklistItem }>(`/checklist/${itemId}/move`, { action }).then((r) => r.data),
    addList: (taskId: string, title: string, afterId?: string | null) =>
      client.post<{ data: ApiChecklistList }>(`/tasks/${taskId}/checklists`, { title, ...(afterId ? { afterId } : {}) }).then((r) => (noteMergedWrite(r), r.data)),
    renameList: (listId: string, title: string) => client.put<{ data: ApiChecklistList }>(`/checklists/${listId}`, { title }).then((r) => r.data),
    duplicateList: (listId: string) => client.post<{ data: ApiChecklistList }>(`/checklists/${listId}/duplicate`, {}).then((r) => r.data),
    removeList: (listId: string) => client.del<{ data?: ChecklistRemoved } | undefined>(`/checklists/${listId}`).then((r) => r?.data),
    /** What was deleted from the task and can still be restored. */
    deleted: (taskId: string) => client.get<{ data: ChecklistDeletedBatch[] }>(`/tasks/${taskId}/checklist/deleted`).then((r) => r.data),
    restore: (taskId: string, batchId: string) =>
      client.post<{ data: { restored: number; taskId: string } }>(`/tasks/${taskId}/checklist/restore`, { batchId }).then((r) => r.data),
    /** Open checklist items assigned to me, across my tasks. */
    mine: () => client.get<{ data: MyChecklistItem[] }>('/me/checklist-items').then((r) => r.data),
  };
}
