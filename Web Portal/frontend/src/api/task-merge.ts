import type { ApiClient } from '../lib/api-client';

/** 1.23.1 Merge tasks: the fields the person chooses between when the tasks differ. */
export type MergeField = 'title' | 'project' | 'status' | 'priority' | 'startDate' | 'dueDate' | 'milestone' | 'clientVisible' | 'repeat' | 'inspectionForm' | 'meeting' | 'needsApproval';

/** What happens to someone assigned who isn't on the main task's project team. */
export type PersonChoice = 'ADD_TO_TEAM' | 'LEAVE_OFF';

export interface MergeCounts {
  comments: number;
  checklist: number;
  files: number;
  assignees: number;
  watchers: number;
  contacts: number;
  tags: number;
  blockers: number;
  actionItems: number;
  inspections: number;
  activity: number;
}

export interface MergePreviewTask {
  id: string;
  /** '' for a task the person can't open (it looks like one that doesn't exist). */
  key: string;
  title: string;
  projectId: string;
  projectName: string;
  status: { name: string; category: string };
  createdAt: string;
  createdByName: string;
  version: number;
  canMerge: boolean;
  reason: string | null;
  counts: MergeCounts;
}

export interface MergeOption {
  /** A task's id (take its value), or 'none' (the repeat only). */
  value: string;
  label: string;
  /** The numbers of the tasks with this value. */
  keys: string[];
}

export interface MergeDifference {
  field: MergeField;
  label: string;
  options: MergeOption[];
}

export interface MergeOutsider {
  id: string;
  name: string;
  canJoin: boolean;
  keys: string[];
}

export interface MergePreview {
  tasks: MergePreviewTask[];
  mainTaskId: string | null;
  canMerge: boolean;
  reason: string | null;
  differences: MergeDifference[];
  project: { id: string; name: string; code: string; changes: boolean; newKey: string | null } | null;
  duplicates: { checklist: number; files: number; contacts: number; assignees: number; watchers: number; tags: number; blockers: number };
  duplicatesText: string | null;
  droppedLinks: { key: string; otherKey: string; otherTitle: string; reason: 'between' | 'loop' }[];
  outsiders: MergeOutsider[];
  watchersLeftOff: number;
  descriptionTooLong: boolean;
}

export type MergeChoices = Partial<Record<MergeField, string>>;

export interface MergeInput {
  taskIds: string[];
  mainTaskId: string;
  choices?: MergeChoices;
  people?: Record<string, PersonChoice>;
  versions?: Record<string, number>;
}

export interface MergeResult {
  mergeId: string;
  mainTaskId: string;
  mainKey: string;
  mainProjectId: string;
  mainProjectBefore: string;
  merged: { id: string; key: string; projectId: string }[];
  addedToTeam: { id: string; name: string }[];
  leftOff: { id: string; name: string }[];
  /** "Merged MICO-14 and MICO-15 into MICO-12". */
  text: string;
}

export interface MergedFromEntry {
  mergeId: string;
  mergedAt: string;
  mergedByName: string | null;
  tasks: { id: string; key: string; title: string; projectId: string; projectName: string; createdByName: string; createdAt: string }[];
  canUndo: boolean;
}

export interface MergedFromPanel {
  merges: MergedFromEntry[];
  /** Which merged task each moved comment, checklist item, history line and file came from. */
  labels: { comments: Record<string, string>; checklist: Record<string, string>; activity: Record<string, string>; files: Record<string, string> };
}

export interface MergedRecord {
  id: string;
  key: string;
  title: string;
  description: string | null;
  project: { id: string; name: string };
  status: { name: string; category: string };
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  isMilestone: boolean;
  createdByName: string;
  createdAt: string;
  mergedAt: string | null;
  mergedByName: string | null;
  main: { id: string; key: string };
  keptOnce: { checklist: number; files: number; contacts: number };
}

export interface UndoPreview {
  mergeId: string;
  mainTaskId: string;
  mainKey: string;
  tasks: { id: string; key: string; title: string }[];
  canUndo: boolean;
  reason: string | null;
  deletedSince: string[];
  mainMoved: { fromProject: string; toProject: string } | null;
}

export interface UndoResult {
  mergeId: string;
  mainTaskId: string;
  mainKey: string;
  restored: { id: string; key: string; projectId: string }[];
  text: string;
}

export function taskMergeApi(client: ApiClient) {
  return {
    /** What merging these tasks would do (nothing is merged). */
    preview: (input: { taskIds: string[]; mainTaskId?: string; choices?: MergeChoices; people?: Record<string, PersonChoice> }) =>
      client.post<{ data: MergePreview }>('/tasks/merge-preview', input).then((r) => r.data),
    merge: (input: MergeInput) => client.post<{ data: MergeResult }>('/tasks/merge', input).then((r) => r.data),
    /** The main task's "Merged from" panel. */
    mergedFrom: (taskId: string) => client.get<{ data: MergedFromPanel }>(`/tasks/${taskId}/merges`).then((r) => r.data),
    record: (mergeId: string, taskId: string) => client.get<{ data: MergedRecord }>(`/task-merges/${mergeId}/tasks/${taskId}`).then((r) => r.data),
    undoPreview: (mergeId: string) => client.get<{ data: UndoPreview }>(`/task-merges/${mergeId}/undo-preview`).then((r) => r.data),
    undo: (mergeId: string) => client.post<{ data: UndoResult }>(`/task-merges/${mergeId}/undo`, {}).then((r) => r.data),
  };
}
