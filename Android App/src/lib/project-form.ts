/**
 * New project and Edit project on the phone (5b, administrators), with the website's form rules
 * (frontend components/project-form/ProjectFormDialog.tsx): the code is suggested from the name
 * until it is typed in, checked as it is typed and can't change once the project exists; an edit
 * sends only what changed; the picture is saved after the details, and when only it fails the
 * project stays open to try again. All of it needs a connection, as on the website. Pure
 * TypeScript: the screen supplies the requests and the picker.
 */
import { ApiError, isNetworkError } from './api-client';
import { uploadMimeType } from './attachments';
import { DEFAULT_PROJECT_COLOR, PROJECT_STATUSES, codeProblem, projectPriorityLabel, projectStatusLabel, suggestCode } from './project-identity';
import type { ApiProject } from './types';

/** The server keeps up to 191 characters of a name or client, 20 000 of a description, 40 of a number. */
export const NAME_MAX = 191;
export const DESCRIPTION_MAX = 20_000;
export const PROJECT_NUMBER_MAX = 40;
export const CODE_MAX = 10;

export interface ProjectDraft {
  name: string;
  code: string;
  number: string;
  clientName: string;
  description: string;
  status: string;
  priority: string;
  /** '' for no owner. */
  ownerId: string;
  color: string;
  icon: string | null;
}

/** What the server takes for a new project (and, partly, for an edit). */
export interface ProjectInput {
  code: string;
  name: string;
  number?: string | null;
  description?: string;
  clientName?: string;
  status?: string;
  priority?: string;
  ownerId?: string | null;
  color?: string;
  icon?: string | null;
}

export type ProjectPatch = Partial<Omit<ProjectInput, 'code'>>;

/** Is a code well formed and free? (GET /projects/code-check) */
export interface CodeCheck {
  code: string;
  valid: boolean;
  available: boolean;
  /** A free variant when it is taken (MICO → MICO2). */
  suggestion?: string;
}

export type PicturePart = { uri: string; name: string; type: string };
/** The picture: as it is, removed, or a newly picked one (sent after the details). */
export type PictureChoice = { kind: 'keep' } | { kind: 'remove' } | { kind: 'new'; part: PicturePart };

export function draftOf(p?: ApiProject | null): ProjectDraft {
  return {
    name: p?.name ?? '',
    code: p?.code ?? '',
    number: p?.number ?? '',
    clientName: p?.clientName ?? '',
    description: p?.description ?? '',
    status: p?.status ?? 'PLANNING',
    priority: p?.priority ?? 'NORMAL',
    ownerId: p?.ownerId ?? '',
    color: p?.color ?? DEFAULT_PROJECT_COLOR,
    icon: p?.icon ?? null,
  };
}

/** Statuses to choose from; Archived only for a project that already is (archiving is its own action). */
export function statusOptions(initialStatus: string): { value: string; label: string }[] {
  return PROJECT_STATUSES.filter((s) => s !== 'ARCHIVED' || initialStatus === 'ARCHIVED').map((s) => ({ value: s, label: projectStatusLabel(s) }));
}

export function priorityOptions(): { value: string; label: string }[] {
  return ['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => ({ value: p, label: projectPriorityLabel(p) }));
}

/** A new name; a new project's code follows it until the code is typed in. */
export function nameChanged(d: ProjectDraft, name: string, opts: { codeTouched: boolean; editing: boolean }): ProjectDraft {
  return { ...d, name, ...(!opts.codeTouched && !opts.editing ? { code: suggestCode(name) } : {}) };
}

/** A typed code: capitals, no spaces. */
export function typedCode(text: string): string {
  return text.toUpperCase().replace(/\s+/g, '');
}

/** What's wrong with the code as it stands (null: nothing, or an existing project's code). */
export function codeError(code: string, opts: { editing: boolean; check: CodeCheck | null; serverError?: string | null }): string | null {
  if (opts.editing) return null;
  if (opts.serverError) return opts.serverError;
  if (!code) return null;
  const problem = codeProblem(code);
  if (problem) return problem;
  const check = opts.check && opts.check.code === code ? opts.check : null;
  return check && !check.available ? `${code} is already used by another project.` : null;
}

/** The line under the code: why it can't change, what is wrong, that it is free, or what task keys look like. */
export function codeNote(o: { editing: boolean; code: string; error: string | null; check: CodeCheck | null }): { text: string; tone: 'note' | 'success' | 'error'; suggestion?: string } {
  if (o.editing) return { text: 'Task keys use this code, so it can’t be changed.', tone: 'note' };
  const check = o.check && o.check.code === o.code ? o.check : null;
  if (o.error) return { text: o.error, tone: 'error', ...(check?.suggestion ? { suggestion: check.suggestion } : {}) };
  if (check?.available) return { text: `${o.code} is free.`, tone: 'success' };
  if (o.code) return { text: `Task keys look like ${o.code}-12.`, tone: 'note' };
  return { text: 'Suggested from the name — you can change it.', tone: 'note' };
}

/** Problems that stop a save (the name, and a new project's code). */
export function checkDraft(d: ProjectDraft, opts: { editing: boolean; check: CodeCheck | null }): { name?: string; code?: string } {
  const problems: { name?: string; code?: string } = {};
  if (!d.name.trim()) problems.name = 'Give the project a name.';
  if (!opts.editing) {
    const code = codeProblem(d.code) ?? codeError(d.code, { editing: false, check: opts.check });
    if (code) problems.code = code;
  }
  return problems;
}

/** A new project's details; what is empty is left out. */
export function createBody(d: ProjectDraft): ProjectInput {
  return {
    code: d.code,
    name: d.name.trim(),
    ...(d.number.trim() ? { number: d.number.trim() } : {}),
    ...(d.clientName.trim() ? { clientName: d.clientName.trim() } : {}),
    ...(d.description.trim() ? { description: d.description.trim() } : {}),
    status: d.status,
    priority: d.priority,
    ownerId: d.ownerId || null,
    icon: d.icon,
    color: d.color,
  };
}

/** The changes worth sending for an existing project (the code never changes). */
export function projectChanges(before: ProjectDraft, after: ProjectDraft): ProjectPatch {
  const patch: ProjectPatch = {};
  if (after.name.trim() !== before.name.trim()) patch.name = after.name.trim();
  if (after.number.trim() !== before.number.trim()) patch.number = after.number.trim() || null;
  if (after.clientName.trim() !== before.clientName.trim()) patch.clientName = after.clientName.trim();
  if (after.description.trim() !== before.description.trim()) patch.description = after.description.trim();
  if (after.status !== before.status) patch.status = after.status;
  if (after.priority !== before.priority) patch.priority = after.priority;
  if (after.ownerId !== before.ownerId) patch.ownerId = after.ownerId || null;
  if (after.color.toUpperCase() !== before.color.toUpperCase()) patch.color = after.color;
  if (after.icon !== before.icon) patch.icon = after.icon;
  return patch;
}

/**
 * The clients other projects already have (the website's list of them), the same name once,
 * matching what is typed (and not the one typed exactly) — at most six.
 */
export function clientSuggestions(projects: { clientName?: string | null }[], typed: string): string[] {
  const seen = new Map<string, string>();
  for (const p of projects) {
    const name = p.clientName?.trim();
    if (name && !seen.has(name.toLocaleLowerCase())) seen.set(name.toLocaleLowerCase(), name);
  }
  const t = typed.trim().toLocaleLowerCase();
  return [...seen.values()]
    .filter((n) => !t || (n.toLocaleLowerCase().includes(t) && n.toLocaleLowerCase() !== t))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 6);
}

/** Is there something typed or picked that leaving would lose? */
export function isDirty(initial: ProjectDraft, draft: ProjectDraft, picture: PictureChoice): boolean {
  return picture.kind !== 'keep' || JSON.stringify(initial) !== JSON.stringify(draft);
}

// ── The picture ──────────────────────────────────────────────────────────────
/** The pictures a project takes, and the largest (the server's limit: the phone can't crop or shrink one first). */
export const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const PICTURE_MAX_BYTES = 2 * 1024 * 1024;

const EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Why a picked file can't be the project's picture (null when it can), before anything is sent. */
export function pictureProblem(asset: { name?: string | null; mimeType?: string | null; size?: number | null }): string | null {
  const name = asset.name?.trim() || 'This picture';
  const type = uploadMimeType(name, asset.mimeType);
  if (!PICTURE_TYPES.includes(type)) return `“${name}” can’t be used — use a PNG, JPG or WebP image.`;
  if (asset.size === 0) return `“${name}” is empty.`;
  if (typeof asset.size === 'number' && asset.size > PICTURE_MAX_BYTES) return `“${name}” is ${(asset.size / 1024 / 1024).toFixed(1)} MB — project pictures can be up to 2 MB.`;
  return null;
}

/** A picked picture as the multipart part; a nameless pick gets "project.<ext>". */
export function picturePart(asset: { uri: string; name?: string | null; mimeType?: string | null }): PicturePart {
  const picked = (asset.mimeType ?? '').trim().toLowerCase();
  const name = asset.name?.trim() || `project.${EXTENSION[picked] ?? 'jpg'}`;
  return { uri: asset.uri, name, type: uploadMimeType(name, asset.mimeType) };
}

/** The next picture choice: removing one picked but not yet saved (with none saved) just forgets it. */
export function pictureChoiceFor(next: PictureChoice, current: PictureChoice, savedImageUrl: string | null | undefined): PictureChoice {
  if (next.kind === 'remove' && current.kind === 'new' && !savedImageUrl) return { kind: 'keep' };
  return next;
}

// ── Saving ───────────────────────────────────────────────────────────────────
export interface ProjectSaveApi {
  create(input: ProjectInput, idempotencyKey: string): Promise<ApiProject>;
  update(id: string, patch: ProjectPatch): Promise<ApiProject>;
  uploadImage(id: string, part: PicturePart): Promise<ApiProject>;
  removeImage(id: string): Promise<ApiProject>;
  /** The project that has this code now (null: none you can see). */
  findByCode?(code: string): Promise<ApiProject | null>;
}

/** The New project form's words for a try whose answer was lost (5b review). */
export const PROJECT_FORM_TEXT = {
  locked:
    'Until the project is created, its details can’t change — if the first try reached the server, a change made now would be lost. You can still change its picture, or start over.',
  changedSinceTry: 'Your last try may have been saved, so the changed details weren’t sent. Tap Create project to finish that try, or start over.',
} as const;

/** "Start over" on a locked New project form: a new try (a new key), after a warning. */
export const PROJECT_START_OVER = {
  label: 'Start over',
  title: 'Start over?',
  message: 'If the first try reached the server, the project may already be created — check the Projects list first. Starting over lets you change the form and create it as a new try.',
  confirm: 'Start over',
} as const;

/** What a create's key carried: a try kept under it is sent again only with exactly this (5b review). */
export function tryBody(d: ProjectDraft): string {
  return JSON.stringify(createBody(d));
}

/**
 * After a create try: keep its key (and lock the form, as the meeting and task forms do) while it
 * may have been saved — no answer, or still being saved; a refusal or a taken code starts a new try.
 */
export function afterCreateTry(out: { kind: 'failed'; message: string; retryable: boolean } | { kind: 'code-taken'; message: string; retryable: false }): { keepKey: boolean; lock: boolean } {
  const kept = out.kind === 'failed' && out.retryable;
  return { keepKey: kept, lock: kept };
}

export type SaveOutcome =
  | { kind: 'done'; project: ApiProject }
  /** The server says the code is taken: shown under the code. */
  | { kind: 'code-taken'; message: string; retryable: false }
  /** Nothing was saved. `retryable`: no answer came (keep the create's key for the next try). */
  | { kind: 'failed'; message: string; retryable: boolean }
  /** The project (and any other changes) are saved, but not the picture: keep editing it. */
  | { kind: 'partly'; project: ApiProject; detailsSaved: boolean; message: string };

const ownReason = (e: ApiError) => e.status < 500 && !!e.message && !/^Request failed/.test(e.message);

/** Why a step didn't happen, in a few plain words. */
function reason(err: unknown, creating = false): string {
  if (isNetworkError(err)) {
    if ((err as { timedOut?: unknown }).timedOut !== true) return 'You’re offline — try again when you’re connected.';
    return creating ? 'The server didn’t answer in time — try again; it won’t be created twice.' : 'The server didn’t answer in time — try again.';
  }
  if (err instanceof ApiError) {
    if (err.code === 'IDEMPOTENCY_IN_PROGRESS') return 'It is still being saved — wait a moment, then try again.';
    if (err.status === 413) return 'That picture is too large. Choose a smaller one.';
    if (ownReason(err)) return err.message;
  }
  return 'Please try again.';
}

/** No answer (or one still being worked on): the same try may be sent again with its key. */
const retryable = (err: unknown) => isNetworkError(err) || (err instanceof ApiError && err.code === 'IDEMPOTENCY_IN_PROGRESS');

const codeTaken = (err: unknown) => err instanceof ApiError && err.status === 409 && err.code !== 'IDEMPOTENCY_IN_PROGRESS' && err.code !== 'IDEMPOTENCY_KEY_REUSED';

async function sendPicture(api: ProjectSaveApi, id: string, picture: PictureChoice): Promise<ApiProject | null> {
  if (picture.kind === 'new') return api.uploadImage(id, picture.part);
  if (picture.kind === 'remove') return api.removeImage(id);
  return null;
}

/**
 * Save the form as the website does: create (with this try's key, so a lost answer never makes
 * two) or send the changes, then the picture. Says exactly what was and wasn't saved.
 */
export async function saveProject(
  api: ProjectSaveApi,
  o: {
    saved: ApiProject | null;
    initial: ProjectDraft;
    draft: ProjectDraft;
    picture: PictureChoice;
    idempotencyKey: string;
    /** What the kept key carried (tryBody) when a try under it may have been saved: anything else isn't sent. */
    keptBody?: string | null;
    /** A try in this form got no answer: a taken code may be that try's project. */
    afterLostAnswer?: boolean;
  },
): Promise<SaveOutcome> {
  if (!o.saved) {
    // The server's store matches the key, not the body: a changed form under a kept key would get
    // the first try's answer back and be lost without a word (5b review).
    if (o.keptBody && o.keptBody !== tryBody(o.draft)) return { kind: 'failed', message: PROJECT_FORM_TEXT.changedSinceTry, retryable: true };
    let created: ApiProject;
    try {
      created = await api.create(createBody(o.draft), o.idempotencyKey);
    } catch (err) {
      if (!codeTaken(err)) return { kind: 'failed', message: `Couldn’t create the project. ${reason(err, true)}`, retryable: retryable(err) };
      // After a lost answer, the project with this code may be the one that try made: carry on with it.
      const made = o.afterLostAnswer && api.findByCode ? await api.findByCode(o.draft.code).catch(() => null) : null;
      if (!made || made.code !== o.draft.code || made.name !== o.draft.name.trim()) {
        return { kind: 'code-taken', message: (err as ApiError).message || `${o.draft.code} is already used by another project.`, retryable: false };
      }
      created = made;
    }
    try {
      return { kind: 'done', project: (await sendPicture(api, created.id, o.picture)) ?? created };
    } catch (err) {
      return { kind: 'partly', project: created, detailsSaved: true, message: `The project was created, but its picture wasn’t saved: ${reason(err)} Try again, or remove the picture and save.` };
    }
  }

  const patch = projectChanges(o.initial, o.draft);
  const detailsSaved = Object.keys(patch).length > 0;
  let result: ApiProject;
  try {
    result = detailsSaved ? await api.update(o.saved.id, patch) : o.saved;
  } catch (err) {
    return { kind: 'failed', message: `Couldn’t save the changes. ${reason(err)}`, retryable: retryable(err) };
  }
  try {
    return { kind: 'done', project: (await sendPicture(api, o.saved.id, o.picture)) ?? result };
  } catch (err) {
    return {
      kind: 'partly',
      project: result,
      detailsSaved,
      message: detailsSaved ? `The other changes were saved, but the picture wasn’t: ${reason(err)}` : `Couldn’t save the picture. ${reason(err)}`,
    };
  }
}
