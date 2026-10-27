import { z, ZodError, type ZodTypeAny } from 'zod';
import { ConflictError, ForbiddenError, HttpError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { imageDimensions } from '../../lib/image-dimensions';
import type { CreateAuditData } from '../audit/audit-repository';
import type { RecordTaskActivity } from '../activity/task-activity';
import { idsOf, parseFormInput } from './inspection-form-input';
import { clientInspection, type ClientInspection } from './inspection-client-copy';
import {
  allowedSignatures,
  effectiveResult,
  INSPECTION_LIMITS as L,
  itemsOf,
  limitsText,
  parseReading,
  readingText,
  requiredSignatures,
  summarize,
  type FormItem,
  type FormStructure,
  type ItemResult,
  type SignatureRole,
} from './inspection-rules';
import type { AnswerRecord, AnswerWrite, Counts, InspectionRecord, InspectionStore, Refusal, SignatureRecord } from './inspection-store';
import {
  answerView,
  byRole,
  countsOf,
  formView,
  listItem,
  personOf,
  signatureRolesOf,
  signatureView,
  type FormView,
  type InspectionDetail,
  type InspectionListItem,
  type InspectionPermissions,
} from './inspection-views';

/**
 * Inspection checklists: forms (templates), inspections carried out on a project from them, their
 * answers and signatures, and follow-up tasks for failed items.
 *
 * Who may do what:
 * - Forms: everyone signed in reads them; administrators and anyone who runs a project create them;
 *   a form's creator (and any administrator) edits and deletes it.
 * - Inspections: anyone who can see the project (its team, its owner and managers, administrators)
 *   reads them, starts them and makes follow-up tasks; only the inspector — whoever started it, or
 *   took it over — answers, signs and finishes it (one inspector at a time). Those who run the
 *   project take one over, reopen a finished one, delete any, and show finished ones to the client;
 *   the inspector may delete their own while it is in progress. An archived project's inspections
 *   are read-only.
 * - Someone who can't see the project gets "not found", so nobody learns what they can't open.
 *
 * What the server never takes from a device: a reading's result (its limits decide), the counts,
 * who answered, and whether the answers a finish signed are the ones stored.
 */

export interface Actor {
  id: string;
  roles: string[];
}

export interface ProjectInfo {
  name: string;
  code: string;
  number: string | null;
  clientName: string | null;
  color: string;
  icon: string | null;
  imageUrl: string | null;
  status: string;
  ownerId: string | null;
}

export interface InspectionPorts {
  canViewProject(userId: string, roles: string[], projectId: string): Promise<boolean>;
  /** Runs it (owner, named manager, a MANAGER member) or is an administrator. */
  canManageProject(userId: string, roles: string[], projectId: string): Promise<boolean>;
  /** Runs at least one project (so may create forms). */
  runsAnyProject(userId: string): Promise<boolean>;
  /** The project; null when it is gone. */
  project(projectId: string): Promise<ProjectInfo | null>;
  /** A live task. */
  task(taskId: string): Promise<{ id: string; key: string; title: string; projectId: string; done: boolean } | null>;
  /** Tasks by id, deleted ones too (marked), with the project each is in now. */
  taskSummaries(ids: string[]): Promise<Map<string, TaskSummary>>;
  canViewTask(userId: string, roles: string[], taskId: string): Promise<boolean>;
  /** The project's first Done column (where "mark the task done" moves it); null when it has none. */
  doneColumnOf(projectId: string): Promise<string | null>;
  /** Who a new task gets when nobody is picked: the project's owner, if they can be assigned (as the app does). */
  defaultAssignees(projectId: string): Promise<string[]>;
  /** The people, if each may be given a task of the project (else it throws a 400). */
  assertAssignable(projectId: string, ids: string[]): Promise<string[]>;
  /** Makes a task in the project's first open column, assigned (and the assignees told). */
  createTask(input: { projectId: string; title: string; description: string; createdById: string; assigneeIds: string[] }): Promise<{ id: string; key: string; title: string; projectId: string }>;
  userNames(ids: string[]): Promise<Map<string, string>>;
  /** Names of the project's people (highlighted in the client preview's notes). */
  peopleNames(projectId: string): Promise<string[]>;
  recordActivity?: RecordTaskActivity;
  audit?: { record(entry: CreateAuditData): Promise<unknown> };
  /**
   * Re-draws a signature as a clean PNG on white. Null: the picture library isn't there (the PNG is
   * kept as it came, its header checked). Throws: the library couldn't read it (it is refused).
   */
  cleanSignature?: (png: Buffer) => Promise<Buffer | null>;
  logger?: { warn(msg: string, ctx?: Record<string, unknown>): void };
}

export interface TaskSummary {
  key: string;
  title: string;
  /** The project it is in now (a task can be moved to another project). */
  projectId: string;
  deleted: boolean;
  done: boolean;
}

export interface InspectionServiceDeps {
  store: InspectionStore;
  ports: InspectionPorts;
  now?: () => Date;
  /** Ids for new form sections and items (tests pin them). */
  newId?: () => string;
}

const MINUTE = 60_000;
/** A follow-up claimed this long ago that never got its task was abandoned (the server stopped). */
const CLAIM_STALE_MS = 2 * MINUTE;
const SIGNATURE_MAX_BYTES = 512 * 1024;
const SIGNATURE_MAX_SIDE = { width: 3000, height: 1500 };

const iso = z.string().datetime({ offset: true });
const startBody = z.object({
  formId: z.string().min(1).max(191),
  taskId: z.string().min(1).max(191).nullish(),
  place: z.string().trim().max(L.placeMax, `A place can have at most ${L.placeMax} characters.`).nullish(),
});
const answerBody = z
  .array(
    z.object({
      itemId: z.string().min(1).max(40),
      result: z.enum(['PASS', 'FAIL', 'NA']).nullable(),
      reading: z.string().max(L.readingMax).nullable(),
      note: z.string().max(L.noteMax * 2).nullable(),
      editedAt: iso,
    }),
  )
  .min(1)
  .max(L.itemsMax);
const finishBody = z.object({
  finishId: z.string().min(1).max(64),
  /** The inspection's revision the signers saw: a finish signed before a reopen is refused. */
  revision: z.number().int().min(0),
  seen: z.array(z.object({ itemId: z.string().min(1).max(40), editedAt: iso })).max(L.itemsMax),
  signatures: z
    .array(
      z.object({
        role: z.enum(['INSPECTOR', 'CLIENT', 'SUPERVISOR']),
        name: z.string().trim().min(1, 'Type the signer’s name.').max(L.signerNameMax),
        method: z.enum(['DRAWN', 'TYPED']),
        image: z.string().max(Math.ceil((SIGNATURE_MAX_BYTES * 4) / 3) + 64).nullish(),
        signedAt: iso,
      }),
    )
    .min(1)
    .max(3),
});
const followUpBody = z.object({ itemIds: z.array(z.string().min(1).max(40)).min(1).max(L.itemsMax), assigneeId: z.string().min(1).max(191).nullish() });
const updateFormBody = z.object({ expectedVersion: z.number().int().min(1) }).passthrough();

/** Runs a check; a refusal says its first problem in words (400), with every problem in its details. */
function validated<T>(check: () => T): T {
  try {
    return check();
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const words = first && !/^(Required|Invalid|Expected|String must|Array must|Number must)/.test(first.message) ? first.message : 'Invalid input.';
      throw new ValidationError(words, err.flatten());
    }
    throw err;
  }
}
const parse = <S extends ZodTypeAny>(schema: S, body: unknown): z.infer<S> => validated(() => schema.parse(body));

const gone = () => new HttpError('This inspection isn’t there any more: it was deleted, or the link is wrong.', 'INSPECTION_GONE', 404);
const alreadyFinished = () => new ConflictError('This inspection was already finished (on another device, or by another finish).', 'ALREADY_FINISHED');
const reopenedSince = () =>
  new ConflictError('This inspection was reopened after it was signed, so that signing no longer counts. Look at it again and sign again.', 'INSPECTION_REOPENED');
/** Device edit times before this are a clock that was reset: the server's time is used. */
const OLDEST_EDIT = Date.UTC(2001, 0, 1);
const archived = () => new ConflictError('This project is archived, so its inspections are read-only.', 'PROJECT_ARCHIVED');
const notFinished = () => new ConflictError('Finish the inspection first.', 'INSPECTION_NOT_FINISHED');
const MANAGE_REFUSED = 'Only this project’s owner, its managers or an administrator can do that.';

function decodePng(dataUrl: string): Buffer | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const buf = Buffer.from(m[1]!, 'base64');
  if (buf.length === 0 || buf.length > SIGNATURE_MAX_BYTES) return null;
  const size = imageDimensions(buf);
  if (!size || buf[1] !== 0x50) return null; // a PNG header (imageDimensions also reads JPEG and WebP)
  if (size.width < 1 || size.height < 1 || size.width > SIGNATURE_MAX_SIDE.width || size.height > SIGNATURE_MAX_SIDE.height) return null;
  return buf;
}

const clamp = (t: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, t));

/** The counts as worked out from the structure (what lists and the report show). */
const counter = (structure: FormStructure) => (answers: AnswerRecord[]): Counts => {
  const s = summarize(structure, answers);
  return { itemCount: s.total, passed: s.passed, failed: s.failed, na: s.na };
};

type FinishProblem = { code: 'INCOMPLETE'; unanswered: string[]; missingSignatures: SignatureRole[] } | { code: 'CHANGED'; items: string[] };

function followUpDescription(r: InspectionRecord, sectionTitle: string, item: FormItem, answer: AnswerRecord | undefined): string {
  const lines = [`From the inspection “${r.title}”${r.place ? ` at ${r.place}` : ''}.`, '', `Section: ${sectionTitle}`, `Item: ${item.label} — failed`];
  if (item.kind === 'READING') {
    const limits = limitsText(item);
    if (answer?.reading) lines.push(`Reading: ${readingText(item, answer.reading)}${limits ? ` (allowed ${limits})` : ''}`);
    else lines.push(`Reading: not taken${limits ? ` (allowed ${limits})` : ''}`);
  }
  if (answer?.note) lines.push(`Note: ${answer.note}`);
  return lines.join('\n');
}

export function createInspectionService(deps: InspectionServiceDeps) {
  const { store, ports } = deps;
  const now = deps.now ?? (() => new Date());
  const isAdmin = (a: Actor) => a.roles.includes('ADMIN');

  async function audit(actor: Actor, module: 'inspections' | 'client-view', action: string, entityId: string, newValue: unknown): Promise<void> {
    try {
      await ports.audit?.record({ userId: actor.id, ip: null, module, action, entityId, newValue });
    } catch (err) {
      ports.logger?.warn('inspections: an audit line could not be written', { err, action });
    }
  }
  async function activity(taskId: string, userId: string, action: string, meta: Record<string, unknown>): Promise<void> {
    try {
      await ports.recordActivity?.({ taskId, userId, action, meta });
    } catch (err) {
      ports.logger?.warn('inspections: a task history line could not be written', { err, action });
    }
  }

  // ── Access ──────────────────────────────────────────────────────────────────────────────────

  /** The inspection, for someone who can see its project (else 404). */
  async function viewable(actor: Actor, id: string): Promise<InspectionRecord> {
    const r = await store.findInspection(id);
    if (!r) throw gone();
    // The same answer as for one that isn't there: nobody outside learns that an id exists.
    if (!(await ports.canViewProject(actor.id, actor.roles, r.projectId))) throw gone();
    return r;
  }
  /** The project, which must still take changes (404 when gone, 409 when archived). */
  async function writableProject(projectId: string): Promise<ProjectInfo> {
    const p = await ports.project(projectId);
    if (!p) throw new NotFoundError('Project not found.');
    if (p.status === 'ARCHIVED') throw archived();
    return p;
  }
  async function mustManage(actor: Actor, projectId: string): Promise<void> {
    if (!(await ports.canManageProject(actor.id, actor.roles, projectId))) throw new ForbiddenError(MANAGE_REFUSED);
  }
  async function refused(r: Refusal): Promise<never> {
    if (r.kind === 'gone') throw gone();
    if (r.kind === 'finished') throw new ConflictError('This inspection is finished, so it can’t be changed. Someone who runs the project can reopen it.', 'INSPECTION_FINISHED');
    const name = (await ports.userNames([r.inspectorId])).get(r.inspectorId) ?? 'Someone else';
    throw new ConflictError(`${name} is carrying out this inspection now: only they can answer, sign and finish it.`, 'NOT_THE_INSPECTOR');
  }

  // ── Views ───────────────────────────────────────────────────────────────────────────────────

  /**
   * Tasks by id as this reader may see them: one moved to another project is named only to someone
   * who can open it there (anyone else gets `hidden`), as the rest of the app does.
   */
  async function tasksFor(actor: Actor, projectId: string, ids: string[]): Promise<Map<string, TaskSummary & { hidden: boolean }>> {
    const unique = [...new Set(ids)];
    const found = unique.length ? await ports.taskSummaries(unique) : new Map<string, TaskSummary>();
    const out = new Map<string, TaskSummary & { hidden: boolean }>();
    for (const [id, t] of found) {
      const hidden = t.projectId !== projectId && !(await ports.canViewTask(actor.id, actor.roles, id));
      out.set(id, { ...t, hidden });
    }
    return out;
  }

  async function listItems(actor: Actor, records: InspectionRecord[]): Promise<InspectionListItem[]> {
    const names = await ports.userNames([...new Set(records.map((r) => r.inspectorId))]);
    const byProject = new Map<string, string[]>();
    for (const r of records) if (r.taskId) byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r.taskId]);
    const tasks = new Map<string, TaskSummary & { hidden: boolean }>();
    for (const [projectId, ids] of byProject) for (const [id, t] of await tasksFor(actor, projectId, ids)) tasks.set(id, t);
    return records.map((r) => {
      const t = r.taskId ? tasks.get(r.taskId) : undefined;
      return listItem(r, names, t && !t.deleted && !t.hidden ? { id: r.taskId!, key: t.key, title: t.title, done: t.done } : null);
    });
  }

  async function taskOffer(actor: Actor, r: InspectionRecord): Promise<InspectionDetail['taskOffer']> {
    if (!r.taskId) return null;
    const t = await ports.task(r.taskId);
    if (!t || t.done || !(await ports.canViewTask(actor.id, actor.roles, t.id))) return null;
    const doneColumnId = await ports.doneColumnOf(t.projectId);
    return doneColumnId ? { id: t.id, key: t.key, title: t.title, doneColumnId } : null;
  }

  async function detail(actor: Actor, r: InspectionRecord, extra: { offer?: boolean } = {}): Promise<InspectionDetail> {
    const [answers, signatures, followUps, project, manage] = await Promise.all([
      store.answers(r.id),
      store.signatures(r.id),
      store.followUps(r.id),
      ports.project(r.projectId),
      ports.canManageProject(actor.id, actor.roles, r.projectId),
    ]);
    const names = await ports.userNames([...new Set([r.inspectorId, r.startedById])]);
    const followTaskIds = followUps.map((x) => x.taskId).filter((t): t is string => !!t);
    const taskIds = [...new Set([...followTaskIds, ...(r.taskId ? [r.taskId] : [])])];
    const tasks = await tasksFor(actor, r.projectId, taskIds);
    const attached = r.taskId ? tasks.get(r.taskId) : undefined;
    const inProgress = r.status === 'IN_PROGRESS';
    const readOnly = !project || project.status === 'ARCHIVED';
    const mine = r.inspectorId === actor.id;
    const permissions: InspectionPermissions = {
      canAnswer: inProgress && mine && !readOnly,
      canFinish: inProgress && mine && !readOnly,
      canReopen: !inProgress && manage && !readOnly,
      canTakeOver: inProgress && manage && !mine && !readOnly,
      canDelete: (manage || (inProgress && mine)) && !readOnly,
      canShowToClient: !inProgress && manage,
      canMakeFollowUps: !readOnly,
    };
    const base = listItem(r, names, attached && !attached.deleted && !attached.hidden ? { id: r.taskId!, key: attached.key, title: attached.title, done: attached.done } : null, answers);
    return {
      ...base,
      description: r.description,
      formId: r.formId,
      formVersion: r.formVersion,
      structure: r.structure,
      startedBy: personOf(r.startedById, names),
      answers: answers.map(answerView),
      signatures: [...signatures].sort(byRole).map(signatureView),
      followUps: followUps.map((x) => {
        const t = x.taskId ? tasks.get(x.taskId) : undefined;
        if (t?.hidden) return { itemId: x.itemId, task: null, pending: false, moved: true };
        return { itemId: x.itemId, task: x.taskId && t ? { id: x.taskId, key: t.key, title: t.title, deleted: t.deleted, done: t.done } : null, pending: x.taskId === null };
      }),
      revision: r.revision,
      permissions,
      signatureRoles: signatureRolesOf(r.structure, requiredSignatures(r.structure)),
      ...(extra.offer ? { taskOffer: await taskOffer(actor, r) } : {}),
    };
  }

  // ── Forms ───────────────────────────────────────────────────────────────────────────────────

  async function formNames(records: Array<{ createdById: string | null }>) {
    return ports.userNames([...new Set(records.map((f) => f.createdById).filter((id): id is string => !!id))]);
  }
  const mayEdit = (actor: Actor, f: { createdById: string | null }) => isAdmin(actor) || f.createdById === actor.id;
  const mayCreate = async (actor: Actor) => isAdmin(actor) || (await ports.runsAnyProject(actor.id));

  async function editableForm(actor: Actor, id: string) {
    const f = await store.findForm(id);
    if (!f) throw new NotFoundError('Form not found.');
    if (!mayEdit(actor, f)) throw new ForbiddenError('Only the person who made this form, or an administrator, can change it.');
    return f;
  }

  const formAudit = (f: { title: string; version: number; structure: FormStructure }) => ({ title: f.title, version: f.version, sections: f.structure.sections.length, items: itemsOf(f.structure).length });

  return {
    async listForms(actor: Actor): Promise<{ forms: FormView[]; canCreate: boolean }> {
      const forms = await store.listForms();
      const names = await formNames(forms);
      return { forms: forms.map((f) => formView(f, names, mayEdit(actor, f))), canCreate: await mayCreate(actor) };
    },

    async getForm(actor: Actor, id: string): Promise<FormView> {
      const f = await store.findForm(id);
      if (!f) throw new NotFoundError('Form not found.');
      return formView(f, await formNames([f]), mayEdit(actor, f));
    },

    async createForm(actor: Actor, body: unknown): Promise<FormView> {
      if (!(await mayCreate(actor))) throw new ForbiddenError('Only administrators and people who run a project can create inspection forms.');
      const input = validated(() => parseFormInput(body, { newId: deps.newId }));
      const f = await store.createForm({ ...input, createdById: actor.id });
      await audit(actor, 'inspections', 'inspection-form.created', f.id, formAudit(f));
      return formView(f, await formNames([f]), true);
    },

    async updateForm(actor: Actor, id: string, body: unknown): Promise<FormView> {
      const { expectedVersion } = parse(updateFormBody, body);
      const current = await editableForm(actor, id);
      const input = validated(() => parseFormInput(body, { newId: deps.newId, knownIds: idsOf(current.structure) }));
      const saved = await store.updateForm(id, expectedVersion, input);
      if (saved === null) throw new NotFoundError('Form not found.');
      if (saved === 'stale') throw new ConflictError('This form was changed by someone else meanwhile. Reload it and make your change again.', 'VERSION_CONFLICT');
      await audit(actor, 'inspections', 'inspection-form.edited', id, formAudit(saved));
      return formView(saved, await formNames([saved]), true);
    },

    async deleteForm(actor: Actor, id: string): Promise<void> {
      const f = await editableForm(actor, id);
      if (await store.deleteForm(id)) await audit(actor, 'inspections', 'inspection-form.deleted', id, { title: f.title });
    },

    // ── Inspections ─────────────────────────────────────────────────────────────────────────

    async listForProject(actor: Actor, projectId: string): Promise<{ inspections: InspectionListItem[]; canStart: boolean }> {
      if (!(await ports.canViewProject(actor.id, actor.roles, projectId))) throw new NotFoundError('Project not found.');
      const project = await ports.project(projectId);
      if (!project) throw new NotFoundError('Project not found.');
      return { inspections: await listItems(actor, await store.listForProject(projectId)), canStart: project.status !== 'ARCHIVED' };
    },

    async start(actor: Actor, projectId: string, body: unknown): Promise<InspectionDetail> {
      const input = parse(startBody, body);
      if (!(await ports.canViewProject(actor.id, actor.roles, projectId))) throw new NotFoundError('Project not found.');
      await writableProject(projectId);
      const form = await store.findForm(input.formId);
      if (!form) throw new NotFoundError('That form isn’t there any more.');
      let taskId: string | null = null;
      if (input.taskId) {
        const t = await ports.task(input.taskId);
        if (!t || t.projectId !== projectId || !(await ports.canViewTask(actor.id, actor.roles, t.id))) throw new ValidationError('That task isn’t one of this project’s.');
        taskId = t.id;
      }
      const r = await store.createInspection({
        projectId,
        formId: form.id,
        formVersion: form.version,
        title: form.title,
        description: form.description,
        structure: form.structure,
        place: input.place?.trim() || null,
        taskId,
        inspectorId: actor.id,
        itemCount: itemsOf(form.structure).length,
        at: now(),
      });
      await audit(actor, 'inspections', 'inspection.started', r.id, { projectId, formId: form.id, formVersion: form.version, title: r.title, ...(taskId ? { taskId } : {}) });
      if (taskId) await activity(taskId, actor.id, 'INSPECTION_ATTACHED', { inspectionId: r.id, inspection: r.title });
      return detail(actor, r);
    },

    async get(actor: Actor, id: string): Promise<InspectionDetail> {
      return detail(actor, await viewable(actor, id));
    },

    /**
     * Answers from the inspector's device: each kept only when it was edited later than the stored
     * one. A reading's result is worked out here from its limits; whatever came with it is ignored.
     */
    async answer(actor: Actor, id: string, body: unknown) {
      const r = await viewable(actor, id);
      await writableProject(r.projectId);
      const items = new Map(itemsOf(r.structure).map((i) => [i.id, i]));
      const at = now().getTime();
      const writes: AnswerWrite[] = parse(answerBody, body).map((w) => {
        const item = items.get(w.itemId);
        if (!item) throw new ValidationError('That item isn’t on this inspection.');
        let reading: string | null = null;
        if (item.kind === 'READING' && w.reading !== null && w.reading.trim() !== '') {
          reading = parseReading(w.reading);
          if (reading === null) throw new ValidationError(`Enter the reading for “${item.label}” as a number.`);
        }
        const note = w.note?.trim() ? w.note.trim() : null;
        if (note && note.length > L.noteMax) throw new ValidationError(`A note can have at most ${L.noteMax} characters.`);
        const result: ItemResult | null = effectiveResult(item, { result: w.result, reading });
        // A device clock running ahead can't make its edits win every later one; one that was reset
        // (a date before 2001) is held to the server's time too.
        const sent = Date.parse(w.editedAt);
        const editedAt = new Date(sent < OLDEST_EDIT || sent > at ? at : sent);
        return { itemId: item.id, result, reading, note, editedAt };
      });
      const out = await store.writeAnswers(r.id, actor.id, writes, counter(r.structure));
      if (out.kind !== 'ok') return refused(out);
      const [item] = await listItems(actor, [out.inspection]);
      return { results: out.results.map((x) => ({ itemId: x.itemId, status: x.status, answer: answerView(x.answer) })), inspection: item! };
    },

    /**
     * Signs and finishes it. The device says which answers its signers saw (each one's edit time):
     * if the stored answers differ — another device, a send that never arrived — nothing is
     * finished and the signers look again. A repeat of the same finish returns it as finished.
     */
    async finish(actor: Actor, id: string, body: unknown): Promise<InspectionDetail> {
      const r = await viewable(actor, id);
      const input = parse(finishBody, body);
      // A repeat of the finish that was applied (its reply was lost): it is finished, whatever happened since.
      if (r.status === 'FINISHED' && r.finishId === input.finishId) return detail(actor, r, { offer: true });
      await writableProject(r.projectId);
      // Refused before any picture is looked at (the locked step below decides again).
      if (r.status === 'FINISHED') throw alreadyFinished();
      if (r.inspectorId !== actor.id) return refused({ kind: 'not-inspector', inspectorId: r.inspectorId });
      if (r.revision !== input.revision) throw reopenedSince();
      const allowed = new Set(allowedSignatures(r.structure));
      const roles = new Set<SignatureRole>();
      const at = now();
      const signatures: SignatureRecord[] = [];
      for (const s of input.signatures) {
        if (!allowed.has(s.role)) throw new ValidationError(`This form doesn’t take a ${s.role.toLowerCase()} signature.`);
        if (roles.has(s.role)) throw new ValidationError('Each person signs once.');
        roles.add(s.role);
        let image: Buffer | null = null;
        if (s.method === 'DRAWN') {
          const png = s.image ? decodePng(s.image) : null;
          if (!png) throw new ValidationError('The drawn signature couldn’t be read. Clear it and sign again.');
          // Re-drawn on white by the picture library; one it can't read is refused (its bytes are
          // never stored). Without the library, the checked PNG is kept as it came.
          let cleaned: Buffer | null = null;
          try {
            cleaned = (await ports.cleanSignature?.(png)) ?? null;
          } catch {
            throw new ValidationError('The drawn signature couldn’t be read. Clear it and sign again.');
          }
          image = cleaned ?? png;
        }
        const signedAt = new Date(clamp(Date.parse(s.signedAt), r.startedAt.getTime(), at.getTime()));
        signatures.push({ role: s.role, name: s.name, method: s.method, image, signedAt, capturedById: actor.id });
      }
      const seen = new Map(input.seen.map((x) => [x.itemId, Date.parse(x.editedAt)]));
      const required = requiredSignatures(r.structure);
      const itemIds = new Set(itemsOf(r.structure).map((i) => i.id));
      const check = (answers: AnswerRecord[]): FinishProblem | null => {
        const stored = new Map(answers.filter((a) => itemIds.has(a.itemId)).map((a) => [a.itemId, a.editedAt.getTime()]));
        const changed = new Set<string>();
        for (const [itemId, t] of stored) if (seen.get(itemId) !== t) changed.add(itemId);
        for (const itemId of seen.keys()) if (itemIds.has(itemId) && !stored.has(itemId)) changed.add(itemId);
        if (changed.size) return { code: 'CHANGED', items: [...itemIds].filter((i) => changed.has(i)) };
        const unanswered = summarize(r.structure, answers).unanswered;
        const missingSignatures = required.filter((role) => !roles.has(role));
        return unanswered.length || missingSignatures.length ? { code: 'INCOMPLETE', unanswered, missingSignatures } : null;
      };
      const out = await store.finish(r.id, actor.id, { finishId: input.finishId, revision: input.revision, at, signatures, check, count: counter(r.structure) });
      if (out.kind === 'already') return detail(actor, out.inspection, { offer: true });
      if (out.kind === 'finished-other') throw alreadyFinished();
      if (out.kind === 'stale-revision') throw reopenedSince();
      if (out.kind === 'problem') {
        const p = out.problem;
        if (p.code === 'CHANGED') {
          throw new HttpError('Some answers changed after they were signed (on another device, or a change still on its way). Look at them again and sign again.', 'ANSWERS_CHANGED', 409, { items: p.items });
        }
        const parts = [p.unanswered.length ? `${p.unanswered.length} ${p.unanswered.length === 1 ? 'item still needs' : 'items still need'} an answer` : '', p.missingSignatures.length ? `it needs the ${p.missingSignatures.map((x) => x.toLowerCase()).join(' and ')} signature` : ''].filter(Boolean);
        throw new HttpError(`It can’t be finished yet: ${parts.join(', and ')}.`, 'INSPECTION_INCOMPLETE', 409, { unanswered: p.unanswered, missingSignatures: p.missingSignatures });
      }
      if (out.kind !== 'ok') return refused(out);
      const c = out.inspection.counts;
      await audit(actor, 'inspections', 'inspection.finished', r.id, {
        projectId: r.projectId,
        passed: c.passed,
        failed: c.failed,
        na: c.na,
        signedBy: [...signatures].sort(byRole).map((s) => ({ role: s.role, name: s.name })),
      });
      if (r.taskId) await activity(r.taskId, actor.id, 'INSPECTION_FINISHED', { inspectionId: r.id, inspection: r.title, failed: c.failed });
      return detail(actor, out.inspection, { offer: true });
    },

    async reopen(actor: Actor, id: string): Promise<InspectionDetail> {
      const r = await viewable(actor, id);
      await mustManage(actor, r.projectId);
      await writableProject(r.projectId);
      const signatures = await store.signatures(r.id);
      if (!(await store.reopen(r.id))) throw new ConflictError('Only a finished inspection can be reopened.', 'INSPECTION_NOT_FINISHED');
      await audit(actor, 'inspections', 'inspection.reopened', r.id, {
        projectId: r.projectId,
        wasShownToClient: r.clientVisible,
        signedBy: [...signatures].sort(byRole).map((s) => ({ role: s.role, name: s.name })),
      });
      return detail(actor, (await store.findInspection(r.id)) ?? r);
    },

    async takeOver(actor: Actor, id: string): Promise<InspectionDetail> {
      const r = await viewable(actor, id);
      await mustManage(actor, r.projectId);
      await writableProject(r.projectId);
      if (!(await store.takeOver(r.id, actor.id))) throw new ConflictError('Only an inspection in progress can be taken over.', 'INSPECTION_FINISHED');
      if (r.inspectorId !== actor.id) await audit(actor, 'inspections', 'inspection.taken-over', r.id, { projectId: r.projectId, from: r.inspectorId, to: actor.id });
      return detail(actor, (await store.findInspection(r.id)) ?? r);
    },

    async remove(actor: Actor, id: string): Promise<void> {
      const r = await viewable(actor, id);
      const manage = await ports.canManageProject(actor.id, actor.roles, r.projectId);
      const ownInProgress = r.status === 'IN_PROGRESS' && r.inspectorId === actor.id;
      if (!manage && !ownInProgress) throw new ForbiddenError('Only the inspector (while it is in progress), this project’s owner, its managers or an administrator can delete it.');
      await writableProject(r.projectId);
      if (await store.deleteInspection(r.id)) await audit(actor, 'inspections', 'inspection.deleted', r.id, { projectId: r.projectId, title: r.title, status: r.status, ...(r.clientVisible ? { wasShownToClient: true } : {}) });
    },

    /**
     * A task for each failed item asked for, once: a second tap, a second device or a replayed request
     * gets the task already made ('exists'), or hears it is being made ('pending').
     */
    async makeFollowUps(actor: Actor, id: string, body: unknown) {
      const r = await viewable(actor, id);
      await writableProject(r.projectId);
      const input = parse(followUpBody, body);
      const sections = new Map(r.structure.sections.flatMap((s) => s.items.map((i) => [i.id, { item: i, section: s.title }] as const)));
      const itemIds = [...new Set(input.itemIds)];
      for (const itemId of itemIds) if (!sections.has(itemId)) throw new ValidationError('That item isn’t on this inspection.');
      const assigneeIds =
        input.assigneeId === undefined ? await ports.defaultAssignees(r.projectId) : input.assigneeId === null ? [] : await ports.assertAssignable(r.projectId, [input.assigneeId]);
      const answers = new Map((await store.answers(r.id)).map((a) => [a.itemId, a]));
      type Made = { itemId: string; status: 'created' | 'exists' | 'pending' | 'not-failed'; task: { id: string; key: string; title: string } | null };
      const results: Made[] = [];
      const created: Array<{ key: string; item: string }> = [];
      try {
        for (const itemId of itemIds) {
          const { item, section } = sections.get(itemId)!;
          const answer = answers.get(itemId);
          if (effectiveResult(item, answer) !== 'FAIL') {
            results.push({ itemId, status: 'not-failed', task: null });
            continue;
          }
          const at = now();
          const claim = await store.claimFollowUp(r.id, itemId, actor.id, at, new Date(at.getTime() - CLAIM_STALE_MS));
          if (!claim.claimed) {
            const t = claim.existing.taskId ? (await tasksFor(actor, r.projectId, [claim.existing.taskId])).get(claim.existing.taskId) : undefined;
            results.push(
              claim.existing.taskId ? { itemId, status: 'exists', task: t && !t.hidden ? { id: claim.existing.taskId, key: t.key, title: t.title } : null } : { itemId, status: 'pending', task: null },
            );
            continue;
          }
          let task: { id: string; key: string; title: string };
          try {
            const title = `Follow up: ${item.label}`.slice(0, 191);
            task = await ports.createTask({ projectId: r.projectId, title, description: followUpDescription(r, section, item, answer), createdById: actor.id, assigneeIds });
          } catch (err) {
            await store.releaseFollowUp(r.id, itemId).catch(() => undefined);
            throw err;
          }
          // The task exists now: its item must point at it (tried twice; a claim left without its task
          // would be taken over later and a second task made).
          await store.completeFollowUp(r.id, itemId, task.id).catch(() => store.completeFollowUp(r.id, itemId, task.id));
          await activity(task.id, actor.id, 'INSPECTION_FOLLOW_UP', { inspectionId: r.id, inspection: r.title, item: item.label });
          results.push({ itemId, status: 'created', task: { id: task.id, key: task.key, title: task.title } });
          created.push({ key: task.key, item: item.label });
        }
      } finally {
        // Tasks made before a failure are audited too (a retry finds them made and says "exists").
        if (created.length) await audit(actor, 'inspections', 'inspection.follow-ups', r.id, { projectId: r.projectId, tasks: created.map((c) => c.key), items: created.map((c) => c.item) });
      }
      return results;
    },

    /** For a task's panel: the inspections carried out for it, and the inspection it follows up. */
    async forTask(actor: Actor, taskId: string) {
      if (!(await ports.canViewTask(actor.id, actor.roles, taskId))) throw new NotFoundError('Task not found.');
      const attached = await store.listForTask(taskId);
      const visible: InspectionRecord[] = [];
      for (const r of attached) if (await ports.canViewProject(actor.id, actor.roles, r.projectId)) visible.push(r);
      const of = await store.followUpOfTask(taskId);
      let followUpOf: { inspection: InspectionListItem; item: string } | null = null;
      if (of && (await ports.canViewProject(actor.id, actor.roles, of.inspection.projectId))) {
        const label = itemsOf(of.inspection.structure).find((i) => i.id === of.itemId)?.label ?? 'An item';
        followUpOf = { inspection: (await listItems(actor, [of.inspection]))[0]!, item: label };
      }
      return { attached: await listItems(actor, visible), followUpOf };
    },

    // ── Client view ─────────────────────────────────────────────────────────────────────────

    /** Exactly what the client would see, and the names of the project's people (to look for). */
    async clientPreview(actor: Actor, id: string, timeZone = 'Asia/Muscat'): Promise<{ inspection: ClientInspection; names: string[] }> {
      const r = await viewable(actor, id);
      await mustManage(actor, r.projectId);
      if (r.status !== 'FINISHED') throw notFinished();
      const [answers, signatures, names] = await Promise.all([store.answers(r.id), store.signatures(r.id), ports.peopleNames(r.projectId)]);
      return { inspection: clientInspection(r, answers, signatures, timeZone), names };
    },

    async setClientVisible(actor: Actor, id: string, visible: boolean): Promise<{ clientVisible: boolean }> {
      const r = await viewable(actor, id);
      await mustManage(actor, r.projectId);
      if (visible && r.status !== 'FINISHED') throw notFinished();
      if (visible) await writableProject(r.projectId);
      if (!(await store.setClientVisible(r.id, visible))) throw notFinished();
      if (r.clientVisible !== visible) {
        await audit(actor, 'client-view', visible ? 'client-view.inspection.shown' : 'client-view.inspection.hidden', r.id, { projectId: r.projectId, title: r.title });
      }
      return { clientVisible: visible };
    },

    /** The client page's inspections: finished, marked, still this project's. */
    async clientInspections(projectId: string, timeZone = 'Asia/Muscat'): Promise<ClientInspection[]> {
      const rows = await store.clientInspections(projectId);
      return Promise.all(rows.map(async (r) => clientInspection(r, await store.answers(r.id), await store.signatures(r.id), timeZone)));
    },

    async clientInspectionOf(projectId: string, id: string, timeZone = 'Asia/Muscat'): Promise<ClientInspection | null> {
      const r = (await store.clientInspections(projectId)).find((x) => x.id === id);
      return r ? clientInspection(r, await store.answers(r.id), await store.signatures(r.id), timeZone) : null;
    },

    /** Everything the staff report prints (finished inspections only). */
    async reportOf(actor: Actor, id: string, timeZone = 'Asia/Muscat') {
      const r = await viewable(actor, id);
      if (r.status !== 'FINISHED') throw notFinished();
      const [answers, signatures, followUps, project] = await Promise.all([store.answers(r.id), store.signatures(r.id), store.followUps(r.id), ports.project(r.projectId)]);
      if (!project) throw new NotFoundError('Project not found.');
      const names = await ports.userNames([r.inspectorId]);
      const taskIds = [...new Set([...followUps.map((x) => x.taskId).filter((t): t is string => !!t), ...(r.taskId ? [r.taskId] : [])])];
      const tasks = await tasksFor(actor, r.projectId, taskIds);
      const shown = (taskId: string | null) => {
        const t = taskId ? tasks.get(taskId) : undefined;
        return t && !t.deleted && !t.hidden ? t : undefined;
      };
      const followUpKeys = new Map(followUps.flatMap((x) => (shown(x.taskId) ? [[x.itemId, shown(x.taskId)!.key] as const] : [])));
      const attached = shown(r.taskId);
      return {
        project,
        report: clientInspection(r, answers, signatures, timeZone),
        staff: {
          inspector: personOf(r.inspectorId, names).name,
          startedAt: r.startedAt.toISOString(),
          finishedAt: r.finishedAt?.toISOString() ?? null,
          task: attached ? `${attached.key} · ${attached.title}` : null,
          followUps: r.structure.sections.map((s) => s.items.map((i) => followUpKeys.get(i.id) ?? null)),
        },
        counts: countsOf(r, answers),
      };
    },
  };
}

export type InspectionService = ReturnType<typeof createInspectionService>;
