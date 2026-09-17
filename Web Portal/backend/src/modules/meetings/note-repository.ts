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
}
