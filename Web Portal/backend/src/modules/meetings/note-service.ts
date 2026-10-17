import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { isRichEmpty, parseRichHtml, renderRichHtml } from '../../lib/rich-text';
import type { NoteRepository, NoteRecord, MeetingNoteType, NoteBodyFormat } from './note-repository';
import type { CanEditMeeting } from './meeting-access';

const TYPES: MeetingNoteType[] = ['DISCUSSION', 'DECISION', 'ACTION', 'ISSUE', 'QUESTION', 'INFORMATION'];

/** Prefix of the temporary `taskId` a note carries while it is being converted into a task. */
export const TASK_CLAIM_PREFIX = 'pending:';

export interface AddNoteInput {
  body: string;
  /** RICH: `body` is formatted (HTML from the editor); it is cleaned before it is kept. */
  format?: NoteBodyFormat;
  type?: MeetingNoteType;
  agendaItemId?: string | null;
  highlighted?: boolean;
}

export interface UpdateNoteInput {
  body?: string;
  /** The format of `body`; when left out, the note keeps the format it has. */
  format?: NoteBodyFormat;
  type?: MeetingNoteType;
  highlighted?: boolean;
  agendaItemId?: string | null;
}

export interface NoteServiceDeps {
  notes: NoteRepository;
  /** Fired after the note stream changes, so the meeting aggregate can broadcast. */
  onChanged?: (meetingId: string) => void;
  /** Meeting editors (organizer / creator / project manager / admin) moderate notes. Open when not wired. */
  canEditMeeting?: CanEditMeeting;
}

export interface NoteService {
  /** May this user moderate the meeting's notes (highlight or delete other people's)? */
  canEditMeeting: CanEditMeeting;
  listNotes(meetingId: string): Promise<NoteRecord[]>;
  getNote(meetingId: string, noteId: string): Promise<NoteRecord>;
  addNote(meetingId: string, authorId: string, input: AddNoteInput): Promise<NoteRecord>;
  updateNote(meetingId: string, noteId: string, patch: UpdateNoteInput): Promise<NoteRecord>;
  removeNote(meetingId: string, noteId: string): Promise<void>;
  /** A deleted note of this meeting (to check who may restore it). */
  getDeletedNote(meetingId: string, noteId: string): Promise<NoteRecord>;
  /** Undo a delete. */
  restoreNote(meetingId: string, noteId: string): Promise<NoteRecord>;
  /** Reserve a note for conversion into a task; 409 when it already has (or is getting) one. */
  claimForTask(meetingId: string, noteId: string): Promise<string>;
  /** Give back a claim whose task was never created. */
  releaseTaskClaim(noteId: string, claim: string): Promise<void>;
  /** Record that a note was promoted to a board Task (Phase 4). */
  /** Point the note at the task made from it (and at the action item tracking it, when there is one). */
  linkTask(meetingId: string, noteId: string, taskId: string, actionItemId?: string): Promise<NoteRecord>;
}

/** The most a note may hold (the column keeps 64 KB; formatting takes some of it). */
const MAX_BODY_BYTES = 60_000;

/**
 * A note's body as it is kept: plain text trimmed; formatted text cleaned into its one safe form
 * (see lib/rich-text.ts). Refuses a note with no words and one too long to keep.
 */
function prepareBody(raw: string, format: NoteBodyFormat): string {
  let body: string;
  if (format === 'RICH') {
    const blocks = parseRichHtml(raw);
    if (isRichEmpty(blocks)) throw new ValidationError('A note needs some content.');
    body = renderRichHtml(blocks);
  } else {
    body = raw.trim();
    if (!body) throw new ValidationError('A note needs some content.');
  }
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw new ValidationError('This note is too long. Split it into two notes.');
  return body;
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
    canEditMeeting: (userId, roles, meetingId) => (deps.canEditMeeting ? deps.canEditMeeting(userId, roles, meetingId) : Promise.resolve(true)),

    async listNotes(meetingId) {
      return notes.listByMeeting(meetingId);
    },

    async getNote(meetingId, noteId) {
      return requireInMeeting(meetingId, noteId);
    },

    async addNote(meetingId, authorId, input) {
      const format = input.format ?? 'PLAIN';
      const body = prepareBody(input.body ?? '', format);
      const type = input.type ?? 'DISCUSSION';
      if (!TYPES.includes(type)) throw new ValidationError('Invalid note type.');
      const rec = await notes.add({
        meetingId,
        authorId,
        body,
        bodyFormat: format,
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
      const current = await requireInMeeting(meetingId, noteId);
      const currentFormat = current.bodyFormat ?? 'PLAIN';
      // A new format comes with the text in that format.
      if (patch.format !== undefined && patch.format !== currentFormat && patch.body === undefined) {
        throw new ValidationError('Send the note’s text along with its new format.');
      }
      const format = patch.format ?? currentFormat;
      const body = patch.body !== undefined ? prepareBody(patch.body, format) : undefined;
      const agendaItemId = patch.agendaItemId !== undefined ? trim(patch.agendaItemId) : undefined;
      // Only a change to what the note says marks it "edited" — highlighting it doesn't.
      const contentChanged =
        (body !== undefined && (body !== current.body || format !== currentFormat)) ||
        (patch.type !== undefined && patch.type !== current.type) ||
        (agendaItemId !== undefined && agendaItemId !== current.agendaItemId);
      const rec = await notes.update(noteId, {
        ...(body !== undefined ? { body, bodyFormat: format } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.highlighted !== undefined ? { highlighted: patch.highlighted } : {}),
        ...(agendaItemId !== undefined ? { agendaItemId } : {}),
        ...(contentChanged ? { editedAt: new Date() } : {}),
      });
      deps.onChanged?.(meetingId);
      return rec;
    },

    async removeNote(meetingId, noteId) {
      await requireInMeeting(meetingId, noteId);
      await notes.remove(noteId);
      deps.onChanged?.(meetingId);
    },

    async getDeletedNote(meetingId, noteId) {
      const rec = await notes.findDeleted(noteId);
      if (!rec || rec.meetingId !== meetingId) throw new NotFoundError('Note not found.');
      return rec;
    },

    async restoreNote(meetingId, noteId) {
      const rec = await notes.findDeleted(noteId);
      if (!rec || rec.meetingId !== meetingId) throw new NotFoundError('Note not found.');
      const restored = await notes.restore(noteId);
      deps.onChanged?.(meetingId);
      return restored;
    },

    async claimForTask(meetingId, noteId) {
      const rec = await requireInMeeting(meetingId, noteId);
      const claim = `${TASK_CLAIM_PREFIX}${randomUUID()}`;
      if (rec.taskId || !(await notes.claimTask(noteId, claim))) {
        throw new ConflictError('A task has already been created from this note.', 'NOTE_HAS_TASK');
      }
      return claim;
    },

    async releaseTaskClaim(noteId, claim) {
      await notes.releaseTaskClaim(noteId, claim);
    },

    async linkTask(meetingId, noteId, taskId, actionItemId) {
      await requireInMeeting(meetingId, noteId);
      const rec = await notes.update(noteId, { taskId, ...(actionItemId ? { actionItemId } : {}) });
      deps.onChanged?.(meetingId);
      return rec;
    },
  };
}
