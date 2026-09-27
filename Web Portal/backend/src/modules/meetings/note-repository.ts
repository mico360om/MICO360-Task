export type MeetingNoteType = 'DISCUSSION' | 'DECISION' | 'ACTION' | 'ISSUE' | 'QUESTION' | 'INFORMATION';

export interface NoteRecord {
  id: string;
  meetingId: string;
  agendaItemId: string | null;
  authorId: string;
  type: MeetingNoteType;
  body: string;
  highlighted: boolean;
  /** Set when this note has been promoted to a board Task (Phase 4). */
  taskId: string | null;
  actionItemId: string | null;
  decisionId: string | null;
  createdAt: Date;
  editedAt: Date | null;
}

export interface CreateNoteData {
  meetingId: string;
  agendaItemId?: string | null;
  authorId: string;
  type: MeetingNoteType;
  body: string;
  highlighted?: boolean;
}

export interface UpdateNoteData {
  type?: MeetingNoteType;
  body?: string;
  highlighted?: boolean;
  agendaItemId?: string | null;
  taskId?: string | null;
  editedAt?: Date | null;
}

export interface NoteRepository {
  add(data: CreateNoteData): Promise<NoteRecord>;
  findById(id: string): Promise<NoteRecord | null>;
  listByMeeting(meetingId: string): Promise<NoteRecord[]>;
  update(id: string, patch: UpdateNoteData): Promise<NoteRecord>;
  remove(id: string): Promise<void>;
  /**
   * Atomically set `taskId` to a claim marker only if the note has no task yet. False when another
   * request already converted (or is converting) the note — the guard against duplicate tasks.
   */
  claimTask(id: string, marker: string): Promise<boolean>;
  /** Undo a claim that never became a task (only while the marker is still in place). */
  releaseTaskClaim(id: string, marker: string): Promise<void>;
}
