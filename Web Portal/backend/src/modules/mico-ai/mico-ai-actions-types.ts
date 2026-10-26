import type { FinalMinutesContent } from '../meetings/final-minutes';

/**
 * What MICO AI proposes when the person asks it to make or change something: a card of changes,
 * each one checked by the server for that person (names resolved to records, days worked out in
 * company time, permissions applied) and stored with the answer. Nothing happens until the person
 * confirms the card; Confirm acts on this stored version, with only the person's own edits (checked
 * again) on top. After it, each change can be undone for 15 minutes.
 */

export type ChangeType = 'create_task' | 'update_task' | 'draft_minutes' | 'schedule_meeting';
export const CHANGE_TYPES: readonly ChangeType[] = ['create_task', 'update_task', 'draft_minutes', 'schedule_meeting'];
export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export const PRIORITIES: readonly Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

/** At most this many changes on one card. */
export const MAX_CHANGES = 50;
/** At most this many minutes drafts on one card (each is an AI call); more are asked for separately. */
export const MAX_MINUTES_DRAFTS = 3;
/** How long Undo stays available after Confirm. */
export const UNDO_WINDOW_MS = 15 * 60_000;

export interface Named {
  id: string;
  name: string;
}

/**
 * Something to put right before a change can go ahead: a part MICO AI's suggestion that couldn't be
 * read ("no one matches Bilaal") or that the checks refused ("Layla isn't on Rig Inspection"). An edit
 * to any of `fields` (the edit's own names) clears it — the server then checks the change again;
 * until then Confirm refuses the change rather than make part of it. No fields: editing can't fix it.
 */
export interface ItemNeed {
  fields: string[];
  message: string;
}

interface ItemBase {
  /** c1, c2 … within the card. */
  id: string;
  type: ChangeType;
  /** What has to be put right first (the change can't be ticked until each is edited). */
  needs: ItemNeed[];
  /** In words: the needs' messages, or why a locked change can't go ahead. */
  problem: string | null;
  /** It can't go ahead at all (no permission, nothing to change): no tick box. */
  locked: boolean;
  /** Worth a look but fine ("This replaces the draft saved on …"). */
  warning: string | null;
}

export interface CreateTaskFields {
  title: string;
  projectId: string | null;
  assigneeIds: string[];
  /** 'YYYY-MM-DD' or none. */
  due: string | null;
  priority: Priority;
  description: string;
}

export interface CreateTaskItem extends ItemBase {
  type: 'create_task';
  fields: CreateTaskFields;
  labels: { project: string | null; assignees: Named[] };
  /** No one was named, so it goes to the project's owner (as any new task does). */
  ownerDefault?: boolean;
}

/** A task's fields MICO AI can change. */
export interface TaskChangeFields {
  /** 'YYYY-MM-DD'; null removes the due date. */
  due?: string | null;
  priority?: Priority;
  /** The column (status) it moves to, in its own project. */
  columnId?: string;
  /** Who it is assigned to afterwards. */
  assigneeIds?: string[];
}

export interface UpdateTaskItem extends ItemBase {
  type: 'update_task';
  task: { id: string; key: string; title: string; projectId: string; project: string; url: string };
  /** The task as it was when proposed: Confirm refuses if it changed since (its version, people or history). */
  base: { version: number; assigneeIds: string[]; activity: number };
  /** Its fields before the change (each changed field, shown "before → after"). */
  before: { due: string | null; priority: Priority; columnId: string; column: string; assignees: Named[] };
  /** Only the fields that change. */
  fields: TaskChangeFields;
  labels: { column?: string; assignees?: Named[] };
}

export interface MinutesItem extends ItemBase {
  type: 'draft_minutes';
  meeting: { id: string; title: string; startAt: string; url: string };
  fields: { content: FinalMinutesContent };
  /** The final minutes as they were when proposed: Confirm refuses if they changed since. */
  base: { status: 'NONE' | 'DRAFT' | 'APPROVED'; savedAt: string | null };
}

export interface MeetingFields {
  title: string;
  projectId: string | null;
  /** 'YYYY-MM-DD' and 'HH:MM' in the company time zone. */
  date: string | null;
  time: string | null;
  /** How long, in minutes. */
  minutes: number;
  /** Who is invited (the person is the organizer). */
  attendeeIds: string[];
  agenda: string[];
  description: string;
}

export interface MeetingItem extends ItemBase {
  type: 'schedule_meeting';
  fields: MeetingFields;
  labels: { project: string | null; attendees: Named[] };
}

export type ProposalItem = CreateTaskItem | UpdateTaskItem | MinutesItem | MeetingItem;

/** A card as the checks made it, before it is stored. */
export interface ProposalDraft {
  items: ProposalItem[];
  /** A note for the whole card ("Only the first 50 changes are here"). */
  note: string | null;
}

/**
 * Everything about a task that says whether anyone touched it: its version (any edit), its history
 * lines (moves, comments, files, checklist, people), its tags, watchers and blockers, and its people.
 */
export interface TaskTouch {
  version: number;
  activity: number;
  tags: number;
  watchers: number;
  links: number;
  assigneeIds: string[];
}

/** What Undo needs to put a change back (kept on the server only). */
export type UndoData =
  | { kind: 'task-created'; taskId: string; projectId: string; touch: TaskTouch }
  | {
      kind: 'task-updated';
      taskId: string;
      projectId: string;
      touch: TaskTouch;
      /** The changed fields as they were before. */
      before: TaskChangeFields;
      /** The next copy a repeating task made when this change completed it (it stays on Undo). */
      nextCopy?: string | null;
    }
  | { kind: 'meeting-created'; meetingId: string; stamp: string; invited: boolean }
  | {
      kind: 'minutes-saved';
      meetingId: string;
      savedAt: string;
      previous: { content: FinalMinutesContent; status: 'DRAFT' | 'APPROVED'; approvedById: string | null; approvedAt: string | null } | null;
    };

/** 'started': being made right now (a confirm cut off part-way reads "may have been made — check it"). */
export type ResultStatus = 'done' | 'refused' | 'failed' | 'skipped' | 'started';
export interface ItemResult {
  status: ResultStatus;
  message: string | null;
  /** Where to see it ("Open RIG-31"). */
  link: { label: string; url: string } | null;
  undo?: UndoData;
}

export interface ItemUndo {
  /** 'started': being put back right now. */
  status: 'undone' | 'refused' | 'failed' | 'started';
  message: string | null;
  /** What the change made no longer exists (a new task or meeting Undo deleted): nothing to open. */
  gone?: boolean;
}

/** SUPERSEDED: the person asked the same again (Retry), so this unconfirmed card was replaced. */
export type ProposalStatus = 'PROPOSED' | 'CONFIRMING' | 'DONE' | 'CANCELLED' | 'UNDOING' | 'UNDONE' | 'SUPERSEDED';

/** A card as stored with its answer. */
export interface ProposalRecord {
  id: string;
  messageId: string;
  userId: string;
  status: ProposalStatus;
  items: ProposalItem[];
  note: string | null;
  /** The card's "Email the invitations" tick box (on by default), as confirmed. */
  sendInvites: boolean;
  /** Per change, once confirmed. */
  results: Record<string, ItemResult> | null;
  /** Per change, once undone. */
  undo: Record<string, ItemUndo> | null;
  confirmedAt: Date | null;
  undoUntil: Date | null;
  undoneAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The person's own changes to the card, sent with Confirm (checked again on the server). */
export interface ItemChoice {
  id: string;
  include: boolean;
  edits?: Record<string, unknown>;
}

/** A card as the page shows it. */
export interface ProposalView {
  id: string;
  status: 'proposed' | 'confirming' | 'done' | 'cancelled' | 'undoing' | 'undone' | 'superseded';
  note: string | null;
  sendInvites: boolean;
  /** The card schedules a meeting (so "Email the invitations" applies). */
  hasMeetings: boolean;
  items: Array<ProposalItem & { result: Omit<ItemResult, 'undo'> | null; undo: ItemUndo | null }>;
  confirmedAt: string | null;
  undoUntil: string | null;
  /** Undo is open: confirmed, within 15 minutes, and something was done. */
  canUndo: boolean;
  /** The server's clock when this was read (ISO), so a countdown isn't thrown off by the device's clock. */
  serverNow: string;
}

/** What the checks made of a "propose" reply. */
export type ProposeOutcome =
  | { kind: 'card'; card: ProposalDraft }
  /** A name or project could mean several: ask, with the candidates as quick replies. */
  | { kind: 'clarify'; question: string; options: string[] }
  /** Names nothing matched: told to the model once, so it can look them up or ask. */
  | { kind: 'retry'; problems: string[] }
  /** Nothing on it could be done: said plainly instead of an empty card. */
  | { kind: 'answer'; text: string };
