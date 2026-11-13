export type MeetingNoteType = 'DISCUSSION' | 'DECISION' | 'ACTION' | 'ISSUE' | 'QUESTION' | 'INFORMATION';

/** PLAIN text, or RICH: formatted text in the fixed HTML form of lib/rich-text.ts. */
export type NoteBodyFormat = 'PLAIN' | 'RICH';

export interface NoteRecord {
  id: string;
  meetingId: string;
  agendaItemId: string | null;
  authorId: string;
  type: MeetingNoteType;
  body: string;
  /** How `body` is written (PLAIN when not given). */
  bodyFormat?: NoteBodyFormat;
  highlighted: boolean;
  /** Set when this note has been promoted to a board Task (Phase 4). */
  taskId: string | null;
  actionItemId: string | null;
  decisionId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  /** 1.22.1: who last changed what the note says (the author, the organizer or an administrator). */
  editedById?: string | null;
}

export interface CreateNoteData {
  meetingId: string;
  agendaItemId?: string | null;
  authorId: string;
  type: MeetingNoteType;
  body: string;
  bodyFormat?: NoteBodyFormat;
  highlighted?: boolean;
}

export interface UpdateNoteData {
  type?: MeetingNoteType;
  body?: string;
  bodyFormat?: NoteBodyFormat;
  highlighted?: boolean;
  agendaItemId?: string | null;
  taskId?: string | null;
  actionItemId?: string | null;
  editedAt?: Date | null;
  editedById?: string | null;
}

export interface NoteRepository {
  add(data: CreateNoteData): Promise<NoteRecord>;
  findById(id: string): Promise<NoteRecord | null>;
  listByMeeting(meetingId: string): Promise<NoteRecord[]>;
  update(id: string, patch: UpdateNoteData): Promise<NoteRecord>;
  /** Soft delete (MTG-07): the note leaves lists, minutes and search but can be restored. */
  remove(id: string): Promise<void>;
  /** A soft-deleted note, or null (also null for a live note). */
  findDeleted(id: string): Promise<NoteRecord | null>;
  /** Bring a soft-deleted note back. */
  restore(id: string): Promise<NoteRecord>;
  /**
   * Atomically set `taskId` to a claim marker only if the note has no task yet. False when another
   * request already converted (or is converting) the note — the guard against duplicate tasks.
   * `replacing` (review fix #19): take over that exact old claim instead (one that timed out).
   */
  claimTask(id: string, marker: string, replacing?: string | null): Promise<boolean>;
  /** Undo a claim that never became a task (only while the marker is still in place). */
  releaseTaskClaim(id: string, marker: string): Promise<void>;
  /**
   * Review fix #19: point the note at its task (and action item) only while this claim is still in place —
   * false when it isn't (another try linked it, or took the claim over). Absent: a plain update.
   */
  linkClaimedTask?(id: string, marker: string, taskId: string, actionItemId?: string): Promise<boolean>;
}
