import type { ApiClient } from '../lib/api-client';

/** Recycle Bin: a person as the bin names them. */
export interface BinPerson {
  id: string;
  name: string;
}

export interface BinProject {
  id: string;
  name: string;
  code: string;
  color: string;
  icon: string | null;
  imageUrl: string | null;
}

/** One deleted task in the bin. */
export interface BinRow {
  id: string;
  key: string;
  title: string;
  project: BinProject;
  /** Its column when it was deleted. */
  status: { name: string; category: string };
  deletedAt: string;
  /** Null: not recorded (deleted before the Recycle Bin) — "Unknown". */
  deletedBy: BinPerson | null;
  binExpiresAt: string;
  /** 0: erased tonight. */
  daysLeft: number;
  assignees: BinPerson[];
  /** Deleted together with others (a whole series): how many are still in the bin. */
  batch: { id: string; size: number } | null;
}

export interface BinPage {
  rows: BinRow[];
  total: number;
  offset: number;
  limit: number;
  facets: { projects: BinProject[]; deleters: BinPerson[] };
  /** Administrators may delete tasks forever. */
  canErase: boolean;
}

export interface BinQuery {
  q?: string;
  project?: string;
  /** A person's id, or 'unknown'. */
  deletedBy?: string;
  from?: string;
  to?: string;
  soon?: boolean;
  company?: string;
  sort?: 'daysLeft' | 'deleted';
  limit?: number;
  offset?: number;
}

/** A task that wasn't restored or deleted, and why ("not_found" says nothing more about it). */
export interface BinRefusal {
  id: string;
  key?: string;
  title?: string;
  reason: 'not_found' | 'archived';
  message: string;
}

export interface RestoreResult {
  restored: { id: string; key: string; title: string; projectId: string }[];
  notRestored: BinRefusal[];
}

export interface EraseResult {
  erased: { id: string; key: string; title: string }[];
  notErased: BinRefusal[];
}

/** The bin's facts about one deleted task (its banner). */
export interface BinFacts {
  deletedAt: string;
  deletedBy: BinPerson | null;
  binExpiresAt: string;
  daysLeft: number;
  batch: { id: string; size: number } | null;
  canRestore: boolean;
  canErase: boolean;
}

export interface BinComment {
  id: string;
  author: BinPerson | null;
  body: string;
  deleted: boolean;
  fromClient: boolean;
  createdAt: string;
  editedAt: string | null;
  replies?: BinComment[];
}

/** Everything a deleted task had, read-only. */
export interface BinDetail {
  task: {
    id: string;
    key: string;
    title: string;
    description: string | null;
    priority: string;
    startDate: string | null;
    dueDate: string | null;
    isMilestone: boolean;
    repeats: boolean;
    createdAt: string;
    createdBy: BinPerson | null;
    formerKeys: string[];
    project: BinProject;
    status: { name: string; category: string };
  };
  assignees: BinPerson[];
  tags: { name: string; color: string }[];
  contacts: { name: string; company: string | null }[];
  checklists: { title: string; items: { text: string; done: boolean; depth: number }[] }[];
  comments: BinComment[];
  files: { filename: string; sizeBytes: number; createdAt: string; uploadedBy: BinPerson | null }[];
  blockers: { key: string; title: string }[];
  history: { id: string; taskId: string | null; projectId: string | null; userId: string; action: string; meta: Record<string, unknown> | null; createdAt: string; actor: BinPerson | null }[];
  bin: BinFacts;
}

/** Every bin query starts with this (a restore or delete refreshes them all). */
export const BIN_KEY = ['recycle-bin'] as const;

function search(q: BinQuery): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === '' || v === false) continue;
    p.set(k, v === true ? '1' : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const binApi = (client: ApiClient) => ({
  list: (q: BinQuery = {}) =>
    client.get<{ data: BinRow[]; meta: Omit<BinPage, 'rows'> }>(`/recycle-bin${search(q)}`).then((r) => ({ ...r.meta, rows: r.data }) as BinPage),
  detail: (taskId: string) => client.get<{ data: BinDetail }>(`/recycle-bin/tasks/${encodeURIComponent(taskId)}`).then((r) => r.data),
  restore: (taskIds: string[], wholeBatch = false) => client.post<{ data: RestoreResult }>('/recycle-bin/restore', { taskIds, wholeBatch }).then((r) => r.data),
  erase: (taskIds: string[]) => client.post<{ data: EraseResult }>('/recycle-bin/erase', { taskIds }).then((r) => r.data),
});
