import { NotFoundError, ValidationError } from '../../lib/http-errors';
import type { NoteRepository, NoteRecord, MeetingNoteType } from './note-repository';

const TYPES: MeetingNoteType[] = ['DISCUSSION', 'DECISION', 'ACTION', 'ISSUE', 'QUESTION', 'INFORMATION'];

export interface AddNoteInput {
  body: string;
  type?: MeetingNoteType;
  agendaItemId?: string | null;
  highlighted?: boolean;
}

export interface UpdateNoteInput {
  body?: string;
  type?: MeetingNoteType;
  highlighted?: boolean;
  agendaItemId?: string | null;
}

export interface NoteServiceDeps {
  notes: NoteRepository;
  /** Fired after the note stream changes, so the meeting aggregate can broadcast. */
  onChanged?: (meetingId: string) => void;
}

export interface NoteService {
  listNotes(meetingId: string): Promise<NoteRecord[]>;
  getNote(meetingId: string, noteId: string): Promise<NoteRecord>;
  addNote(meetingId: string, authorId: string, input: AddNoteInput): Promise<NoteRecord>;
  updateNote(meetingId: string, noteId: string, patch: UpdateNoteInput): Promise<NoteRecord>;
  removeNote(meetingId: string, noteId: string): Promise<void>;
  /** Record that a note was promoted to a board Task (Phase 4). */
  linkTask(meetingId: string, noteId: string, taskId: string): Promise<NoteRecord>;
}

const trim = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t.length ? t : null;
};

export function createNoteService(deps: NoteServiceDeps): NoteService {
  const { notes } = deps;

  async function requireInMeeting(meetingId: string, noteId: string): Promise<NoteRecord> {
    const rec = await notes.findById(noteId);
    if (!rec || rec.meetingId !== meetingId) throw new NotFoundError('Note not found.');
    return rec;
  }

  return {
    async listNotes(meetingId) {
      return notes.listByMeeting(meetingId);
    },

    async getNote(meetingId, noteId) {
      return requireInMeeting(meetingId, noteId);
    },

    async addNote(meetingId, authorId, input) {
      const body = (input.body ?? '').trim();
      if (!body) throw new ValidationError('A note needs some content.');
      const type = input.type ?? 'DISCUSSION';
      if (!TYPES.includes(type)) throw new ValidationError('Invalid note type.');
      const rec = await notes.add({
        meetingId,
        authorId,
        body,
        type,
        agendaItemId: trim(input.agendaItemId),
        highlighted: input.highlighted ?? false,
      });
      deps.onChanged?.(meetingId);
      return rec;
    },

    async updateNote(meetingId, noteId, patch) {
      if (patch.body !== undefined && !patch.body.trim()) throw new ValidationError('A note needs some content.');
      if (patch.type !== undefined && !TYPES.includes(patch.type)) throw new ValidationError('Invalid note type.');
      await requireInMeeting(meetingId, noteId);
      const rec = await notes.update(noteId, {
        ...(patch.body !== undefined ? { body: patch.body.trim() } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.highlighted !== undefined ? { highlighted: patch.highlighted } : {}),
        ...(patch.agendaItemId !== undefined ? { agendaItemId: trim(patch.agendaItemId) } : {}),
        editedAt: new Date(),
      });
      deps.onChanged?.(meetingId);
      return rec;
    },

    async removeNote(meetingId, noteId) {
      await requireInMeeting(meetingId, noteId);
      await notes.remove(noteId);
      deps.onChanged?.(meetingId);
    },

    async linkTask(meetingId, noteId, taskId) {
      await requireInMeeting(meetingId, noteId);
      const rec = await notes.update(noteId, { taskId });
      deps.onChanged?.(meetingId);
      return rec;
    },
  };
}
