import { randomUUID } from 'node:crypto';
import type { FormStructure, InspectionStatus, ItemResult, SignatureRole } from './inspection-rules';

/**
 * Where forms, inspections, their answers, signatures and follow-ups are kept. Everything that has
 * to hold even when two requests arrive together — last-write-wins answers, finishing, the one
 * follow-up per item — is decided here, in one locked step per inspection (the Prisma store) or in
 * one synchronous step (the in-memory one). What the rules are is the service's: it hands in the
 * checks and the counts.
 */

export interface FormRecord {
  id: string;
  title: string;
  description: string | null;
  structure: FormStructure;
  version: number;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Counts {
  itemCount: number;
  passed: number;
  failed: number;
  na: number;
}

export interface InspectionRecord {
  id: string;
  projectId: string;
  formId: string | null;
  formVersion: number;
  title: string;
  description: string | null;
  structure: FormStructure;
  place: string | null;
  taskId: string | null;
  status: InspectionStatus;
  inspectorId: string;
  startedById: string;
  startedAt: Date;
  finishedAt: Date | null;
  finishId: string | null;
  /** Goes up with each reopen (a finish says which revision it signed). */
  revision: number;
  counts: Counts;
  clientVisible: boolean;
  clientVisibleProjectId: string | null;
  updatedAt: Date;
}

export interface AnswerRecord {
  itemId: string;
  result: ItemResult | null;
  reading: string | null;
  note: string | null;
  /** When it was changed on the device that sent it. */
  editedAt: Date;
  answeredById: string;
}

export type AnswerWrite = Omit<AnswerRecord, 'answeredById'>;

export interface SignatureRecord {
  role: SignatureRole;
  name: string;
  method: 'DRAWN' | 'TYPED';
  /** A PNG (drawn); null when typed. */
  image: Buffer | null;
  signedAt: Date;
  capturedById: string;
}

export interface FollowUpRecord {
  itemId: string;
  /** Null while its task is being made. */
  taskId: string | null;
  createdById: string;
  createdAt: Date;
}

/** Why the inspection can't take a change. */
export type Refusal = { kind: 'gone' } | { kind: 'finished' } | { kind: 'not-inspector'; inspectorId: string };

export interface AnswerOutcome {
  itemId: string;
  /** applied: stored; stale: the stored one was edited later (kept); same: this very edit was already stored. */
  status: 'applied' | 'stale' | 'same';
  /** The answer as stored now. */
  answer: AnswerRecord;
}

export type WriteResult = Refusal | { kind: 'ok'; results: AnswerOutcome[]; inspection: InspectionRecord };

export type FinishResult<P> =
  | Refusal
  /** Finished already by this same finish (a repeat): nothing changes. */
  | { kind: 'already'; inspection: InspectionRecord }
  /** Finished already by another finish. */
  | { kind: 'finished-other'; inspection: InspectionRecord }
  /** Reopened since it was signed (a finish signed for an earlier revision). */
  | { kind: 'stale-revision'; revision: number }
  | { kind: 'problem'; problem: P }
  | { kind: 'ok'; inspection: InspectionRecord };

export interface NewInspection {
  projectId: string;
  formId: string;
  formVersion: number;
  title: string;
  description: string | null;
  structure: FormStructure;
  place: string | null;
  taskId: string | null;
  inspectorId: string;
  itemCount: number;
  at: Date;
}

export interface InspectionStore {
  createForm(data: { title: string; description: string | null; structure: FormStructure; createdById: string }): Promise<FormRecord>;
  /** A form that isn't deleted. */
  findForm(id: string): Promise<FormRecord | null>;
  /** Every form that isn't deleted, by title. */
  listForms(): Promise<FormRecord[]>;
  /** Saves an edit made from version `expectedVersion` (the version then goes up); 'stale' when it has moved on, null when gone. */
  updateForm(id: string, expectedVersion: number, data: { title: string; description: string | null; structure: FormStructure }): Promise<FormRecord | 'stale' | null>;
  /** False when it was already gone. */
  deleteForm(id: string): Promise<boolean>;

  createInspection(data: NewInspection): Promise<InspectionRecord>;
  /** An inspection that isn't deleted. */
  findInspection(id: string): Promise<InspectionRecord | null>;
  /** A project's inspections, newest first. */
  listForProject(projectId: string): Promise<InspectionRecord[]>;
  /** The inspections carried out for a task, newest first. */
  listForTask(taskId: string): Promise<InspectionRecord[]>;
  answers(inspectionId: string): Promise<AnswerRecord[]>;
  signatures(inspectionId: string): Promise<SignatureRecord[]>;
  followUps(inspectionId: string): Promise<FollowUpRecord[]>;

  /**
   * Applies answers while the inspection is in progress and `actorId` is its inspector: each one only
   * when it was edited later than the one stored. The counts are then worked out again (`count`).
   */
  writeAnswers(inspectionId: string, actorId: string, writes: AnswerWrite[], count: (answers: AnswerRecord[]) => Counts): Promise<WriteResult>;
  /**
   * Finishes it, with these signatures, if it is still at the revision it was signed at and `check`
   * (given every stored answer) finds no problem. A repeat of the finish that was applied
   * (`finishId`) is 'already'.
   */
  finish<P>(
    inspectionId: string,
    actorId: string,
    input: { finishId: string; revision: number; at: Date; signatures: SignatureRecord[]; check: (answers: AnswerRecord[]) => P | null; count: (answers: AnswerRecord[]) => Counts },
  ): Promise<FinishResult<P>>;
  /** Back in progress (a new revision), without its signatures and off the client page. False unless it was finished. */
  reopen(inspectionId: string): Promise<boolean>;
  /** A new inspector, while in progress (false otherwise). */
  takeOver(inspectionId: string, userId: string): Promise<boolean>;
  /** False when it was already gone. */
  deleteInspection(inspectionId: string): Promise<boolean>;
  /** On (only while finished; recorded for its project now) or off. False when it couldn't be turned on. */
  setClientVisible(inspectionId: string, visible: boolean): Promise<boolean>;

  /**
   * Reserves the item's follow-up for `createdById`. Someone else's reservation stands — unless its
   * task was deleted, or it never got a task and is older than `staleBefore`: then it is taken over.
   */
  claimFollowUp(inspectionId: string, itemId: string, createdById: string, at: Date, staleBefore: Date): Promise<{ claimed: true } | { claimed: false; existing: FollowUpRecord }>;
  completeFollowUp(inspectionId: string, itemId: string, taskId: string): Promise<void>;
  /** Gives the reservation up (making its task failed). */
  releaseFollowUp(inspectionId: string, itemId: string): Promise<void>;
  /** The inspection and item a task follows up (null when none, or the inspection is deleted). */
  followUpOfTask(taskId: string): Promise<{ inspection: InspectionRecord; itemId: string } | null>;

  /** The finished inspections shown to the client of this project (recorded for it, still filed under it). */
  clientInspections(projectId: string): Promise<InspectionRecord[]>;
}

// ── In memory (unit tests) ──────────────────────────────────────────────────────────────────────

export interface MemoryInspectionStore extends InspectionStore {
  /** Tests: a task id the store treats as deleted. */
  deleteTask(taskId: string): void;
  /** Tests: moves an inspection to another project (as if its row changed). */
  setProject(inspectionId: string, projectId: string): void;
}

const copy = <T>(v: T): T => structuredClone(v);
/** structuredClone turns a Buffer into a plain Uint8Array. */
const copySignature = (s: SignatureRecord): SignatureRecord => ({ ...s, signedAt: new Date(s.signedAt), image: s.image ? Buffer.from(s.image) : null });

export function createMemoryInspectionStore(opts: { now?: () => Date } = {}): MemoryInspectionStore {
  const now = opts.now ?? (() => new Date());
  const forms = new Map<string, FormRecord & { deleted: boolean }>();
  const inspections = new Map<string, InspectionRecord & { deleted: boolean }>();
  const answers = new Map<string, Map<string, AnswerRecord>>();
  const signatures = new Map<string, SignatureRecord[]>();
  const followUps = new Map<string, Map<string, FollowUpRecord>>();
  const deletedTasks = new Set<string>();

  const live = (id: string) => {
    const r = inspections.get(id);
    return r && !r.deleted ? r : null;
  };
  const strip = <T extends { deleted: boolean }>({ deleted: _d, ...rest }: T): Omit<T, 'deleted'> => copy(rest);
  const answersOf = (id: string) => {
    let m = answers.get(id);
    if (!m) answers.set(id, (m = new Map()));
    return m;
  };
  const refusal = (r: (InspectionRecord & { deleted: boolean }) | null, actorId: string): Refusal | null => {
    if (!r) return { kind: 'gone' };
    if (r.status !== 'IN_PROGRESS') return { kind: 'finished' };
    if (r.inspectorId !== actorId) return { kind: 'not-inspector', inspectorId: r.inspectorId };
    return null;
  };
  const newestFirst = (a: InspectionRecord, b: InspectionRecord) => b.startedAt.getTime() - a.startedAt.getTime() || b.id.localeCompare(a.id);

  return {
    deleteTask: (taskId) => void deletedTasks.add(taskId),
    setProject: (id, projectId) => void (inspections.get(id)!.projectId = projectId),

    async createForm(data) {
      const at = now();
      const f = { id: randomUUID(), ...copy(data), version: 1, createdAt: at, updatedAt: at, deleted: false };
      forms.set(f.id, f);
      return strip(f);
    },
    async findForm(id) {
      const f = forms.get(id);
      return f && !f.deleted ? strip(f) : null;
    },
    async listForms() {
      return [...forms.values()].filter((f) => !f.deleted).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)).map(strip);
    },
    async updateForm(id, expectedVersion, data) {
      const f = forms.get(id);
      if (!f || f.deleted) return null;
      if (f.version !== expectedVersion) return 'stale';
      Object.assign(f, copy(data), { version: f.version + 1, updatedAt: now() });
      return strip(f);
    },
    async deleteForm(id) {
      const f = forms.get(id);
      if (!f || f.deleted) return false;
      f.deleted = true;
      return true;
    },

    async createInspection(d) {
      const r: InspectionRecord & { deleted: boolean } = {
        id: randomUUID(),
        projectId: d.projectId,
        formId: d.formId,
        formVersion: d.formVersion,
        title: d.title,
        description: d.description,
        structure: copy(d.structure),
        place: d.place,
        taskId: d.taskId,
        status: 'IN_PROGRESS',
        inspectorId: d.inspectorId,
        startedById: d.inspectorId,
        startedAt: d.at,
        finishedAt: null,
        finishId: null,
        revision: 0,
        counts: { itemCount: d.itemCount, passed: 0, failed: 0, na: 0 },
        clientVisible: false,
        clientVisibleProjectId: null,
        updatedAt: d.at,
        deleted: false,
      };
      inspections.set(r.id, r);
      return strip(r);
    },
    async findInspection(id) {
      const r = live(id);
      return r ? strip(r) : null;
    },
    async listForProject(projectId) {
      return [...inspections.values()].filter((r) => !r.deleted && r.projectId === projectId).sort(newestFirst).map(strip);
    },
    async listForTask(taskId) {
      return [...inspections.values()].filter((r) => !r.deleted && r.taskId === taskId).sort(newestFirst).map(strip);
    },
    async answers(id) {
      return [...(answers.get(id)?.values() ?? [])].map(copy);
    },
    async signatures(id) {
      return (signatures.get(id) ?? []).map(copySignature);
    },
    async followUps(id) {
      return [...(followUps.get(id)?.values() ?? [])].map(copy);
    },

    async writeAnswers(id, actorId, writes, count) {
      const r = live(id);
      const refused = refusal(r, actorId);
      if (refused) return refused;
      const stored = answersOf(id);
      const results: AnswerOutcome[] = writes.map((w) => {
        const current = stored.get(w.itemId);
        if (current && current.editedAt.getTime() > w.editedAt.getTime()) return { itemId: w.itemId, status: 'stale', answer: copy(current) };
        if (current && current.editedAt.getTime() === w.editedAt.getTime()) return { itemId: w.itemId, status: 'same', answer: copy(current) };
        const next: AnswerRecord = { ...copy(w), answeredById: actorId };
        stored.set(w.itemId, next);
        return { itemId: w.itemId, status: 'applied', answer: copy(next) };
      });
      if (results.some((x) => x.status === 'applied')) {
        r!.counts = count([...stored.values()].map(copy));
        r!.updatedAt = now();
      }
      return { kind: 'ok', results, inspection: strip(r!) };
    },

    async finish(id, actorId, input) {
      const r = live(id);
      if (r && r.status === 'FINISHED') return r.finishId === input.finishId ? { kind: 'already', inspection: strip(r) } : { kind: 'finished-other', inspection: strip(r) };
      const refused = refusal(r, actorId);
      if (refused) return refused;
      if (r!.revision !== input.revision) return { kind: 'stale-revision', revision: r!.revision };
      const all = [...answersOf(id).values()].map(copy);
      const problem = input.check(all);
      if (problem !== null) return { kind: 'problem', problem };
      signatures.set(id, input.signatures.map(copySignature));
      Object.assign(r!, { status: 'FINISHED', finishedAt: input.at, finishId: input.finishId, counts: input.count(all), updatedAt: now() });
      return { kind: 'ok', inspection: strip(r!) };
    },
    async reopen(id) {
      const r = live(id);
      if (!r || r.status !== 'FINISHED') return false;
      signatures.delete(id);
      Object.assign(r, { status: 'IN_PROGRESS', finishedAt: null, finishId: null, revision: r.revision + 1, clientVisible: false, clientVisibleProjectId: null, updatedAt: now() });
      return true;
    },
    async takeOver(id, userId) {
      const r = live(id);
      if (!r || r.status !== 'IN_PROGRESS') return false;
      r.inspectorId = userId;
      r.updatedAt = now();
      return true;
    },
    async deleteInspection(id) {
      const r = live(id);
      if (!r) return false;
      r.deleted = true;
      return true;
    },
    async setClientVisible(id, visible) {
      const r = live(id);
      if (!r) return false;
      if (!visible) {
        Object.assign(r, { clientVisible: false, clientVisibleProjectId: null });
        return true;
      }
      if (r.status !== 'FINISHED') return false;
      Object.assign(r, { clientVisible: true, clientVisibleProjectId: r.projectId });
      return true;
    },

    async claimFollowUp(id, itemId, createdById, at, staleBefore) {
      let m = followUps.get(id);
      if (!m) followUps.set(id, (m = new Map()));
      const existing = m.get(itemId);
      const takeable = existing && ((existing.taskId !== null && deletedTasks.has(existing.taskId)) || (existing.taskId === null && existing.createdAt.getTime() < staleBefore.getTime()));
      if (existing && !takeable) return { claimed: false, existing: copy(existing) };
      m.set(itemId, { itemId, taskId: null, createdById, createdAt: at });
      return { claimed: true };
    },
    async completeFollowUp(id, itemId, taskId) {
      const f = followUps.get(id)?.get(itemId);
      if (f) f.taskId = taskId;
    },
    async releaseFollowUp(id, itemId) {
      const m = followUps.get(id);
      if (m?.get(itemId)?.taskId === null) m.delete(itemId);
    },
    async followUpOfTask(taskId) {
      for (const [id, m] of followUps) {
        for (const f of m.values()) {
          if (f.taskId !== taskId) continue;
          const r = live(id);
          return r ? { inspection: strip(r), itemId: f.itemId } : null;
        }
      }
      return null;
    },

    async clientInspections(projectId) {
      return [...inspections.values()]
        .filter((r) => !r.deleted && r.status === 'FINISHED' && r.clientVisible && r.clientVisibleProjectId === projectId && r.projectId === projectId)
        .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0) || b.id.localeCompare(a.id))
        .map(strip);
    },
  };
}
