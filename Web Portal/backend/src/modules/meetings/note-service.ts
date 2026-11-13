import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { isRichEmpty, parseRichHtml, renderRichHtml } from '../../lib/rich-text';
import { newRowId } from '../../lib/row-id';
import type { NoteRepository, NoteRecord, MeetingNoteType, NoteBodyFormat } from './note-repository';
import type { CanEditMeeting } from './meeting-access';

const TYPES: MeetingNoteType[] = ['DISCUSSION', 'DECISION', 'ACTION', 'ISSUE', 'QUESTION', 'INFORMATION'];

/**
 * Prefix of the temporary `taskId` a note carries while it is being converted into a task. Review fix #19
 * (batch 4b): the claim is "pending:<ms since 1970>:<the id its task gets>" — so a retry finds the task an
 * earlier try saved (and links it instead of making another), and a claim whose task was never made times
 * out. A claim is never shown as the note's task (see `outward`). Claims from before ("pending:<uuid>")
 * have neither: their requests ended with the restart that brought this version, so they are timed out.
 */
export const TASK_CLAIM_PREFIX = 'pending:';
/** Review fix #19: a claim whose task was never made can be taken over after this long (as a repeat-request key's lease). */
export const TASK_CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

/** A note reserved for conversion: its marker, the id its task gets, and whether that task already exists. */
export interface TaskClaim {
  marker: string;
  taskId: string;
  /** An earlier try already saved this task (then failed before linking it): link it, make nothing new. */
  made: boolean;
}

/** Is this `taskId` value a claim (a conversion under way or interrupted), not a task? */
export function isTaskClaim(taskId: string | null | undefined): boolean {
  return typeof taskId === 'string' && taskId.startsWith(TASK_CLAIM_PREFIX);
}

/** When a claim was made (null: unknown — an old one) and the id it gives its task (null: an old one). */
export function parseTaskClaim(marker: string): { at: number | null; taskId: string | null } {
  const m = /^pending:(\d{1,15}):([\w-]{1,64})$/.exec(marker);
  return m ? { at: Number(m[1]), taskId: m[2]! } : { at: null, taskId: null };
}

/** A note as it goes out: a claim is not a task, so it is never shown as a task link. */
const outward = (rec: NoteRecord): NoteRecord => (isTaskClaim(rec.taskId) ? { ...rec, taskId: null } : rec);

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
  /** The clock (tests). */
  now?: () => Date;
}

export interface NoteService {
  /** May this user moderate the meeting's notes (highlight or delete other people's)? */
  canEditMeeting: CanEditMeeting;
  listNotes(meetingId: string): Promise<NoteRecord[]>;
  getNote(meetingId: string, noteId: string): Promise<NoteRecord>;
  addNote(meetingId: string, authorId: string, input: AddNoteInput): Promise<NoteRecord>;
  /** `editorId`: who is changing it — kept as the note's `editedById` when its words change. */
  updateNote(meetingId: string, noteId: string, patch: UpdateNoteInput, editorId?: string): Promise<NoteRecord>;
  removeNote(meetingId: string, noteId: string): Promise<void>;
  /** A deleted note of this meeting (to check who may restore it). */
  getDeletedNote(meetingId: string, noteId: string): Promise<NoteRecord>;
  /** Undo a delete. */
  restoreNote(meetingId: string, noteId: string): Promise<NoteRecord>;
  /**
   * Reserve a note for conversion into a task; 409 when it already has one, or one is being made right now.
   * Review fix #19: an interrupted conversion's claim comes back as `made` when its task exists (`taskExists`),
   * and is taken over once it is older than TASK_CLAIM_TIMEOUT_MS when its task was never made.
   */
  claimForTask(meetingId: string, noteId: string, opts?: { taskExists?: (taskId: string) => Promise<boolean> }): Promise<TaskClaim>;
  /** Give back a claim (its marker) whose task was never created. */
  releaseTaskClaim(noteId: string, claim: string): Promise<void>;
  /**
   * Point the note at the task made from it (and at the action item tracking it, when there is one). With the
   * claim's marker, only while that claim is in place (another try of the same conversion having linked the
   * same task is fine; a different task is a 409).
   */
  linkTask(meetingId: string, noteId: string, taskId: string, actionItemId?: string, claim?: string): Promise<NoteRecord>;
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
  const now = deps.now ?? (() => new Date());

  async function requireInMeeting(meetingId: string, noteId: string): Promise<NoteRecord> {
    const rec = await notes.findById(noteId);
    if (!rec || rec.meetingId !== meetingId) throw new NotFoundError('Note not found.');
    return rec;
  }

  return {
    canEditMeeting: (userId, roles, meetingId) => (deps.canEditMeeting ? deps.canEditMeeting(userId, roles, meetingId) : Promise.resolve(true)),

    async listNotes(meetingId) {
      return (await notes.listByMeeting(meetingId)).map(outward);
    },

    async getNote(meetingId, noteId) {
      return outward(await requireInMeeting(meetingId, noteId));
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
      return outward(rec);
    },

    async updateNote(meetingId, noteId, patch, editorId) {
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
        ...(contentChanged ? { editedAt: new Date(), ...(editorId ? { editedById: editorId } : {}) } : {}),
      });
      deps.onChanged?.(meetingId);
      return outward(rec);
    },

    async removeNote(meetingId, noteId) {
      await requireInMeeting(meetingId, noteId);
      await notes.remove(noteId);
      deps.onChanged?.(meetingId);
    },

    async getDeletedNote(meetingId, noteId) {
      const rec = await notes.findDeleted(noteId);
      if (!rec || rec.meetingId !== meetingId) throw new NotFoundError('Note not found.');
      return outward(rec);
    },

    async restoreNote(meetingId, noteId) {
      const rec = await notes.findDeleted(noteId);
      if (!rec || rec.meetingId !== meetingId) throw new NotFoundError('Note not found.');
      const restored = await notes.restore(noteId);
      deps.onChanged?.(meetingId);
      return outward(restored);
    },

    async claimForTask(meetingId, noteId, opts) {
      const rec = await requireInMeeting(meetingId, noteId);
      const hasTask = () => new ConflictError('A task has already been created from this note.', 'NOTE_HAS_TASK');
      if (rec.taskId && !isTaskClaim(rec.taskId)) throw hasTask();
      const fresh = (): TaskClaim => {
        const taskId = newRowId();
        return { marker: `${TASK_CLAIM_PREFIX}${now().getTime()}:${taskId}`, taskId, made: false };
      };
      if (!rec.taskId) {
        const claim = fresh();
        if (await notes.claimTask(noteId, claim.marker)) return claim;
        throw hasTask(); // claimed (or converted) at this very moment by another request
      }
      // Review fix #19: an earlier conversion's claim. Its task saved (the link failed after): link that one.
      const old = rec.taskId;
      const { at, taskId } = parseTaskClaim(old);
      if (taskId && opts?.taskExists && (await opts.taskExists(taskId))) return { marker: old, taskId, made: true };
      // Its task not made yet: still under way — unless it has timed out (an old-style claim always has).
      if (at !== null && now().getTime() - at < TASK_CLAIM_TIMEOUT_MS) {
        throw new ConflictError('A task is being created from this note right now. Try again in a moment.', 'NOTE_HAS_TASK');
      }
      const claim = fresh();
      if (await notes.claimTask(noteId, claim.marker, old)) return claim;
      throw hasTask();
    },

    async releaseTaskClaim(noteId, claim) {
      await notes.releaseTaskClaim(noteId, claim);
    },

    async linkTask(meetingId, noteId, taskId, actionItemId, claim) {
      await requireInMeeting(meetingId, noteId);
      let rec: NoteRecord;
      if (claim && notes.linkClaimedTask) {
        // Review fix #19: only while this conversion's claim is in place.
        if (!(await notes.linkClaimedTask(noteId, claim, taskId, actionItemId))) {
          const current = await requireInMeeting(meetingId, noteId);
          // Another try of this same conversion linked it already: done. Anything else: not this task's note.
          if (current.taskId !== taskId) throw new ConflictError('A task has already been created from this note.', 'NOTE_HAS_TASK');
          if (actionItemId && !current.actionItemId) await notes.update(noteId, { actionItemId });
        }
        rec = await requireInMeeting(meetingId, noteId);
      } else {
        rec = await notes.update(noteId, { taskId, ...(actionItemId ? { actionItemId } : {}) });
      }
      deps.onChanged?.(meetingId);
      return outward(rec);
    },
  };
}
