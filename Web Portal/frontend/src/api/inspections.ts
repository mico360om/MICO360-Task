import type { ApiClient } from '../lib/api-client';
import type { FormStructure, InspectionStatus, ItemResult, SignatureRole, SignatureRule } from '../lib/inspection-rules';

/** Inspection checklists: forms (templates), a project's inspections, answers, signing, follow-ups. */

export interface Person {
  id: string;
  name: string;
}

export interface InspectionForm {
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

/** A form as the forms manager sends it (new sections and items have no id yet). */
export interface FormInput {
  title: string;
  description: string | null;
  clientSignature: SignatureRule;
  supervisorSignature: SignatureRule;
  sections: Array<{
    id?: string;
    title: string;
    items: Array<
      | { id?: string; kind: 'CHECK'; label: string; help?: string | null }
      | { id?: string; kind: 'READING'; label: string; help?: string | null; unit?: string | null; min?: number | null; max?: number | null }
    >;
  }>;
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
  task: { id: string; key: string; title: string; done: boolean } | null;
}

export interface AnswerView {
  itemId: string;
  result: ItemResult | null;
  reading: string | null;
  note: string | null;
  editedAt: string;
}

export interface SignatureView {
  role: SignatureRole;
  name: string;
  method: 'DRAWN' | 'TYPED';
  image: string | null;
  signedAt: string;
}

export interface FollowUpView {
  itemId: string;
  task: { id: string; key: string; title: string; deleted: boolean; done: boolean } | null;
  pending: boolean;
  /** Its task was moved to a project the reader can't see (so it isn't named). */
  moved?: boolean;
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
  signatureRoles: { allowed: SignatureRole[]; required: SignatureRole[] };
  /** Goes up with each reopen: a finish sends the revision its signers saw. */
  revision: number;
  /** Its project is archived: read-only (a report shown to the client can still be taken off). */
  projectArchived?: boolean;
  /** The last reopen (null: never reopened). */
  reopened?: { at: string; by: Person } | null;
  /** Earlier signed revisions (a reopen took their signatures off), oldest first; numbered from 1. */
  earlierRevisions?: EarlierRevision[];
  taskOffer?: { id: string; key: string; title: string; doneColumnId: string } | null;
}

export interface EarlierRevision {
  /** As people count them: the first signing is 1. */
  number: number;
  /** When a reopen took these signatures off. */
  reopenedAt: string;
  signatures: Array<{ role: SignatureRole; name: string; method: 'DRAWN' | 'TYPED'; signedAt: string }>;
}

/** One answer as a device sends it: the time it was changed there decides which edit wins. */
export interface AnswerWrite {
  itemId: string;
  result: ItemResult | null;
  reading: string | null;
  note: string | null;
  editedAt: string;
}

export interface AnswerOutcome {
  itemId: string;
  status: 'applied' | 'stale' | 'same';
  answer: AnswerView;
}

export interface SignatureInput {
  role: SignatureRole;
  name: string;
  method: 'DRAWN' | 'TYPED';
  /** A PNG data URL, for a drawn signature. */
  image?: string | null;
  signedAt: string;
}

export interface FinishInput {
  /** The device's id for this finish: sending it again is a no-op. */
  finishId: string;
  /** The inspection's revision when it was signed: a reopen since then makes the server refuse it. */
  revision: number;
  /** The answers the signers saw (each one's edit time). */
  seen: Array<{ itemId: string; editedAt: string }>;
  signatures: SignatureInput[];
}

export interface FollowUpResult {
  itemId: string;
  status: 'created' | 'exists' | 'pending' | 'not-failed';
  task: { id: string; key: string; title: string } | null;
}

/** A shown report as the client's page lists it (the rest is read when it is opened). */
export interface ClientInspectionSummary {
  id: string;
  title: string;
  /** The day it was finished ('YYYY-MM-DD', company time zone). */
  date: string;
  place: string | null;
  counts: { total: number; passed: number; failed: number; na: number };
  result: string;
  /** Which signing this is, counted from 1 (a reopen and a new signing make it 2). */
  revisionNumber: number;
  /** The day it was last reopened ('YYYY-MM-DD'); null if never. */
  reopenedOn: string | null;
}

export interface ClientInspection extends ClientInspectionSummary {
  sections: Array<{ title: string; items: Array<{ label: string; kind: 'CHECK' | 'READING'; result: string | null; reading: string | null; limits: string | null; note: string | null }> }>;
  /** `signedOn`: when, in words, in the company's time zone (as the PDF says it). */
  signatures: Array<{ role: string; name: string; signedAt: string; signedOn: string; image: string | null; typed: boolean }>;
  unsigned: string[];
}

const seg = encodeURIComponent;

export function inspectionsApi(client: ApiClient) {
  return {
    // Forms
    listForms: () => client.get<{ data: { forms: InspectionForm[]; canCreate: boolean } }>('/inspection-forms').then((r) => r.data),
    getForm: (id: string) => client.get<{ data: InspectionForm }>(`/inspection-forms/${seg(id)}`).then((r) => r.data),
    createForm: (input: FormInput) => client.post<{ data: InspectionForm }>('/inspection-forms', input).then((r) => r.data),
    updateForm: (id: string, input: FormInput & { expectedVersion: number }) => client.put<{ data: InspectionForm }>(`/inspection-forms/${seg(id)}`, input).then((r) => r.data),
    deleteForm: (id: string) => client.del<void>(`/inspection-forms/${seg(id)}`),

    // Inspections
    listForProject: (projectId: string) =>
      client.get<{ data: { inspections: InspectionListItem[]; canStart: boolean } }>(`/projects/${seg(projectId)}/inspections`).then((r) => r.data),
    start: (projectId: string, input: { formId: string; taskId?: string | null; place?: string | null }) =>
      client.post<{ data: InspectionDetail }>(`/projects/${seg(projectId)}/inspections`, input).then((r) => r.data),
    get: (id: string) => client.get<{ data: InspectionDetail }>(`/inspections/${seg(id)}`).then((r) => r.data),
    answer: (id: string, answers: AnswerWrite[]) =>
      client.put<{ data: { results: AnswerOutcome[]; inspection: InspectionListItem } }>(`/inspections/${seg(id)}/answers`, { answers }).then((r) => r.data),
    finish: (id: string, input: FinishInput) => client.post<{ data: InspectionDetail }>(`/inspections/${seg(id)}/finish`, input).then((r) => r.data),
    reopen: (id: string) => client.post<{ data: InspectionDetail }>(`/inspections/${seg(id)}/reopen`, {}).then((r) => r.data),
    takeOver: (id: string) => client.post<{ data: InspectionDetail }>(`/inspections/${seg(id)}/take-over`, {}).then((r) => r.data),
    remove: (id: string) => client.del<void>(`/inspections/${seg(id)}`),
    makeFollowUps: (id: string, input: { itemIds: string[]; assigneeId?: string | null }) =>
      client.post<{ data: FollowUpResult[] }>(`/inspections/${seg(id)}/follow-ups`, input).then((r) => r.data),
    forTask: (taskId: string) =>
      client.get<{ data: { attached: InspectionListItem[]; followUpOf: { inspection: InspectionListItem; item: string } | null } }>(`/tasks/${seg(taskId)}/inspections`).then((r) => r.data),
    reportPdf: (id: string) => client.getBlob(`/inspections/${seg(id)}/report.pdf`),

    // Show to client
    clientPreview: (id: string) => client.get<{ data: { inspection: ClientInspection; names: string[] } }>(`/inspections/${seg(id)}/client-visibility/preview`).then((r) => r.data),
    setClientVisible: (id: string, visible: boolean) => client.put<{ data: { clientVisible: boolean } }>(`/inspections/${seg(id)}/client-visibility`, { visible }).then((r) => r.data),
  };
}

export type InspectionsApi = ReturnType<typeof inspectionsApi>;
