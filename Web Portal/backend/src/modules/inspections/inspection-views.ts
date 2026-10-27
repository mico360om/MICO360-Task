import { allowedSignatures, resultLabel, summarize, type FormStructure, type InspectionStatus, type ItemResult, type SignatureRole } from './inspection-rules';
import type { AnswerRecord, FormRecord, InspectionRecord, SignatureRecord } from './inspection-store';

/** What the website gets: forms, inspections in a list, and one inspection with everything on it. */

export interface Person {
  id: string;
  name: string;
}

export interface FormView {
  id: string;
  title: string;
  description: string | null;
  structure: FormStructure;
  version: number;
  sectionCount: number;
  itemCount: number;
  createdBy: Person | null;
  updatedAt: string;
  /** The person asking may edit and delete it (its creator, or an administrator). */
  canEdit: boolean;
}

export interface InspectionCounts {
  total: number;
  answered: number;
  passed: number;
  failed: number;
  na: number;
}

export interface InspectionListItem {
  id: string;
  projectId: string;
  title: string;
  status: InspectionStatus;
  place: string | null;
  startedAt: string;
  finishedAt: string | null;
  inspector: Person;
  counts: InspectionCounts;
  /** "Passed", "2 failed", "All N/A"; while in progress "12 of 40 answered". */
  result: string;
  clientVisible: boolean;
  /**
   * The task it was carried out for. `lateDays` (a check — a task that carries a form — only): how many
   * days after its due day the task was finished (0 on time); null when it isn't a finished check.
   */
  task: { id: string; key: string; title: string; done: boolean; lateDays?: number | null } | null;
}

export interface AnswerView {
  itemId: string;
  result: ItemResult | null;
  reading: string | null;
  note: string | null;
  /** The edit time it was stored with (a finish says which answers it signed by these). */
  editedAt: string;
}

export interface SignatureView {
  role: SignatureRole;
  name: string;
  method: 'DRAWN' | 'TYPED';
  /** A data URL (PNG) for a drawn signature; null when typed. */
  image: string | null;
  signedAt: string;
}

export interface FollowUpView {
  itemId: string;
  task: { id: string; key: string; title: string; deleted: boolean; done: boolean } | null;
  /** Its task is being made right now. */
  pending: boolean;
  /** Its task was moved to a project the reader can't see (so it isn't named). */
  moved?: boolean;
}

export interface EarlierRevision {
  /** The revision as people count them (the first signing is 1). */
  number: number;
  /** When a reopen took these signatures off. */
  reopenedAt: string;
  signatures: Array<{ role: SignatureRole; name: string; method: 'DRAWN' | 'TYPED'; signedAt: string }>;
}

/** Earlier revisions' signatures grouped by revision, oldest first. */
export function earlierRevisionsOf(rows: Array<{ revision: number; role: SignatureRole; name: string; method: 'DRAWN' | 'TYPED'; signedAt: Date; supersededAt: Date }>): EarlierRevision[] {
  const by = new Map<number, EarlierRevision>();
  for (const r of rows) {
    const e = by.get(r.revision) ?? { number: r.revision + 1, reopenedAt: r.supersededAt.toISOString(), signatures: [] };
    e.signatures.push({ role: r.role, name: r.name, method: r.method, signedAt: r.signedAt.toISOString() });
    by.set(r.revision, e);
  }
  return [...by.values()].sort((a, b) => a.number - b.number).map((e) => ({ ...e, signatures: [...e.signatures].sort(byRole) }));
}

export interface InspectionPermissions {
  canAnswer: boolean;
  canFinish: boolean;
  canReopen: boolean;
  canTakeOver: boolean;
  canDelete: boolean;
  canShowToClient: boolean;
  canMakeFollowUps: boolean;
}

export interface InspectionDetail extends InspectionListItem {
  description: string | null;
  formId: string | null;
  formVersion: number;
  structure: FormStructure;
  startedBy: Person;
  answers: AnswerView[];
  signatures: SignatureView[];
  followUps: FollowUpView[];
  permissions: InspectionPermissions;
  /** Signatures this form takes, and the ones finishing needs. */
  signatureRoles: { allowed: SignatureRole[]; required: SignatureRole[] };
  /** Goes up with each reopen: a finish sends the revision its signers saw. */
  revision: number;
  /** Its project is archived: read-only (a report shown to the client can still be taken off). */
  projectArchived: boolean;
  /** The last reopen (null: never reopened). */
  reopened: { at: string; by: Person } | null;
  /** Earlier signed revisions (a reopen took their signatures off), oldest first; numbered from 1. */
  earlierRevisions: EarlierRevision[];
  /** After finishing: the attached task, offered to be marked done (null when there is none, or it is done). */
  taskOffer?: { id: string; key: string; title: string; doneColumnId: string } | null;
  /**
   * After a finish (or a repeat of it): the check this inspection was for, completed by finishing it
   * (a task that carries a form is completed automatically). Null otherwise.
   */
  taskCompleted?: { id: string; key: string; title: string } | null;
}

export const personOf = (id: string, names: Map<string, string>): Person => ({ id, name: names.get(id) ?? 'Former staff member' });

export function countsOf(r: InspectionRecord, answers?: AnswerRecord[]): InspectionCounts {
  if (answers) {
    const s = summarize(r.structure, answers);
    return { total: s.total, answered: s.answered, passed: s.passed, failed: s.failed, na: s.na };
  }
  const c = r.counts;
  return { total: c.itemCount, answered: c.passed + c.failed + c.na, passed: c.passed, failed: c.failed, na: c.na };
}

export function resultText(status: InspectionStatus, c: InspectionCounts): string {
  if (status === 'FINISHED') return resultLabel(c);
  return `${c.answered} of ${c.total} answered${c.failed ? ` · ${c.failed} failed` : ''}`;
}

export const dataUrl = (png: Buffer | null): string | null => (png ? `data:image/png;base64,${png.toString('base64')}` : null);

export function signatureView(s: SignatureRecord): SignatureView {
  return { role: s.role, name: s.name, method: s.method, image: s.method === 'DRAWN' ? dataUrl(s.image) : null, signedAt: s.signedAt.toISOString() };
}

const ROLE_ORDER: Record<SignatureRole, number> = { INSPECTOR: 0, CLIENT: 1, SUPERVISOR: 2 };
export const byRole = (a: { role: SignatureRole }, b: { role: SignatureRole }) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role];

export function formView(f: FormRecord, names: Map<string, string>, canEdit: boolean): FormView {
  return {
    id: f.id,
    title: f.title,
    description: f.description,
    structure: f.structure,
    version: f.version,
    sectionCount: f.structure.sections.length,
    itemCount: f.structure.sections.reduce((n, s) => n + s.items.length, 0),
    createdBy: f.createdById ? personOf(f.createdById, names) : null,
    updatedAt: f.updatedAt.toISOString(),
    canEdit,
  };
}

export function listItem(r: InspectionRecord, names: Map<string, string>, task: InspectionListItem['task'], answers?: AnswerRecord[]): InspectionListItem {
  const counts = countsOf(r, answers);
  return {
    id: r.id,
    projectId: r.projectId,
    title: r.title,
    status: r.status,
    place: r.place,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    inspector: personOf(r.inspectorId, names),
    counts,
    result: resultText(r.status, counts),
    clientVisible: r.clientVisible,
    task,
  };
}

export function answerView(a: AnswerRecord): AnswerView {
  return { itemId: a.itemId, result: a.result, reading: a.reading, note: a.note, editedAt: a.editedAt.toISOString() };
}

export const signatureRolesOf = (structure: FormStructure, required: SignatureRole[]) => ({ allowed: allowedSignatures(structure), required });
