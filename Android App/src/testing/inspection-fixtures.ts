/**
 * Test data for the inspection work (Stage 4): one inspection, a drawn signature, a fake server that
 * keeps answers, follow-up tasks and finishes the way the real one does (edit times, one task per
 * failed item, one finish per id), and an API client that sends a person's requests only while that
 * person is signed in. Test-only — nothing in the app imports this folder.
 */
import { ApiError, NetworkError, sessionChangedError, type ApiClient } from '../lib/api-client';
import { effectiveResult, itemsOf, resultLabel, summarize, type CheckItem, type ReadingItem } from '../lib/inspection-rules';
import type { InspectionsApi } from '../lib/inspections-api';
import type { AnswerOutcome, AnswerView, AnswerWrite, FinishInput, FollowUpResult, InspectionDetail, InspectionListItem, SignatureInput } from '../lib/inspection-types';

export const GUARD_RAILS: CheckItem = { id: 'a', kind: 'CHECK', label: 'Guard rails fitted', help: null };
export const PRESSURE: ReadingItem = { id: 'p', kind: 'READING', label: 'Pressure', help: null, unit: 'psi', min: 0, max: 150 };

/** An inspection in progress: two items, nothing answered, Ann Lee inspecting, for task RIG-1. */
export const DETAIL: InspectionDetail = {
  id: 'i1',
  projectId: 'pr1',
  title: 'Rig check',
  status: 'IN_PROGRESS',
  place: 'Rig 3',
  startedAt: '2026-10-27T10:05:00.000Z',
  finishedAt: null,
  inspector: { id: 'u1', name: 'Ann Lee' },
  counts: { total: 2, answered: 0, passed: 0, failed: 0, na: 0 },
  result: '0 of 2 answered',
  clientVisible: false,
  task: { id: 't1', key: 'RIG-1', title: 'Weekly rig check', done: false },
  description: null,
  formId: 'f1',
  formVersion: 1,
  structure: { sections: [{ id: 's1', title: 'Safety', items: [GUARD_RAILS, PRESSURE] }], clientSignature: 'NONE', supervisorSignature: 'NONE' },
  startedBy: { id: 'u1', name: 'Ann Lee' },
  answers: [],
  signatures: [],
  followUps: [],
  permissions: { canAnswer: true, canFinish: true, canReopen: false, canTakeOver: false, canDelete: true, canShowToClient: true, canMakeFollowUps: true },
  signatureRoles: { allowed: ['INSPECTOR'], required: ['INSPECTOR'] },
  revision: 0,
  projectArchived: false,
  reopened: null,
  earlierRevisions: [],
  taskOffer: null,
};

export const SIG_DRAWN: SignatureInput = { role: 'INSPECTOR', name: 'Ann Lee', method: 'DRAWN', image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==', signedAt: '2026-10-30T08:00:00.000Z' };

type CallKind = 'answer' | 'follow-ups' | 'finish';

interface Held {
  detail: InspectionDetail;
  answers: Map<string, AnswerView>;
  /** Failed item → its follow-up task. */
  tasks: Map<string, { id: string; key: string; title: string }>;
  finishIds: Set<string>;
  signatures: SignatureInput[];
}

const sameContent = (a: AnswerView, w: AnswerWrite) => a.result === w.result && a.reading === w.reading && a.note === w.note;

/** A server that keeps inspections as the real one does; `offline` and `loseNextReply` make trouble. */
export function fakeInspectionServer(o: { detail?: InspectionDetail } = {}) {
  const base = o.detail ?? DETAIL;
  const held = new Map<string, Held>();
  let taskNo = 8;
  const of = (id: string): Held => {
    let h = held.get(id);
    if (!h) {
      h = { detail: { ...base, id }, answers: new Map(base.answers.map((a) => [a.itemId, a])), tasks: new Map(), finishIds: new Set(), signatures: [] };
      held.set(id, h);
    }
    return h;
  };
  const detailOf = (h: Held): InspectionDetail => {
    const answers = itemsOf(h.detail.structure).flatMap((i) => (h.answers.has(i.id) ? [h.answers.get(i.id)!] : []));
    const s = summarize(h.detail.structure, answers);
    const counts = { total: s.total, answered: s.answered, passed: s.passed, failed: s.failed, na: s.na };
    const followUps = [...h.tasks.entries()].map(([itemId, t]) => ({ itemId, task: { ...t, deleted: false, done: false }, pending: false }));
    return { ...h.detail, answers, counts, result: h.detail.status === 'FINISHED' ? resultLabel(s) : `${s.answered} of ${s.total} answered`, followUps };
  };
  const listItemOf = (h: Held): InspectionListItem => {
    const d = detailOf(h);
    return { id: d.id, projectId: d.projectId, title: d.title, status: d.status, place: d.place, startedAt: d.startedAt, finishedAt: d.finishedAt, inspector: d.inspector, counts: d.counts, result: d.result, clientVisible: d.clientVisible, task: d.task };
  };

  const server = {
    calls: [] as Array<{ kind: CallKind; id: string; body: unknown }>,
    /** No signal: every call fails before it reaches the server. */
    offline: false,
    /** The next call of this kind is done, then its reply is lost (a time-out). */
    loseNextReply: null as CallKind | null,
    answersOf: (id: string): Record<string, AnswerView> => Object.fromEntries(of(id).answers),
    followUpTasks: (id: string): string[] => [...of(id).tasks.keys()],
    signaturesOf: (id: string): SignatureInput[] => of(id).signatures,
    api: {} as Pick<InspectionsApi, 'answer' | 'finish' | 'makeFollowUps' | 'get'>,
  };

  const call = async <T>(kind: CallKind, id: string, body: unknown, work: () => T): Promise<T> => {
    if (server.offline) throw new NetworkError('Network request failed.');
    server.calls.push({ kind, id, body });
    const out = work();
    if (server.loseNextReply === kind) {
      server.loseNextReply = null;
      throw new NetworkError('The server took too long to respond.', { timedOut: true });
    }
    return out;
  };
  const finished = () => new ApiError(409, 'INSPECTION_FINISHED', 'This inspection is already finished.');

  server.api = {
    answer: (id, writes) =>
      call('answer', id, writes, () => {
        const h = of(id);
        if (h.detail.status === 'FINISHED') throw finished();
        const results: AnswerOutcome[] = writes.map((w) => {
          const had = h.answers.get(w.itemId);
          if (had && had.editedAt >= w.editedAt) return { itemId: w.itemId, status: had.editedAt === w.editedAt && sameContent(had, w) ? 'same' : 'stale', answer: had };
          const answer: AnswerView = { itemId: w.itemId, result: w.result, reading: w.reading, note: w.note, editedAt: w.editedAt };
          h.answers.set(w.itemId, answer);
          return { itemId: w.itemId, status: 'applied', answer };
        });
        return { results, inspection: listItemOf(h) };
      }),
    makeFollowUps: (id, input) =>
      call('follow-ups', id, input, () => {
        const h = of(id);
        const items = itemsOf(h.detail.structure);
        return input.itemIds.map((itemId): FollowUpResult => {
          const item = items.find((i) => i.id === itemId);
          const had = h.tasks.get(itemId);
          if (had) return { itemId, status: 'exists', task: had };
          if (!item || effectiveResult(item, h.answers.get(itemId)) !== 'FAIL') return { itemId, status: 'not-failed', task: null };
          taskNo += 1;
          const task = { id: `t${taskNo}`, key: `RIG-${taskNo}`, title: `${item.label} failed` };
          h.tasks.set(itemId, task);
          return { itemId, status: 'created', task };
        });
      }),
    finish: (id, input: FinishInput) =>
      call('finish', id, input, () => {
        const h = of(id);
        if (h.finishIds.has(input.finishId)) return detailOf(h);
        if (h.detail.status === 'FINISHED') throw finished();
        h.finishIds.add(input.finishId);
        h.signatures = input.signatures;
        const task = h.detail.task;
        h.detail = {
          ...h.detail,
          status: 'FINISHED',
          finishedAt: '2026-10-30T08:01:00.000Z',
          signatures: input.signatures.map((s) => ({ role: s.role, name: s.name, method: s.method, image: s.image ?? null, signedAt: s.signedAt })),
          permissions: { ...h.detail.permissions, canAnswer: false, canFinish: false },
          taskOffer: task && !task.done ? { id: task.id, key: task.key, title: task.title, doneColumnId: 'col-done' } : null,
        };
        return detailOf(h);
      }),
    get: async (id) => {
      if (server.offline) throw new NetworkError('Network request failed.');
      return detailOf(of(id));
    },
  };
  return server;
}

export type FakeInspectionServer = ReturnType<typeof fakeInspectionServer>;

/**
 * An API client over the fake server: `forUser(owner)` sends that person's inspection calls only
 * while `signedIn()` is that person (else the app's SESSION_CHANGED refusal, nothing sent).
 */
export function fakeApiClient(server: FakeInspectionServer, signedIn: () => string | null): Pick<ApiClient, 'forUser'> {
  const route = async (owner: string, method: string, path: string, body?: unknown): Promise<unknown> => {
    if (signedIn() !== owner) throw sessionChangedError();
    const m = /^\/inspections\/([^/]+)(\/answers|\/follow-ups|\/finish)?$/.exec(path);
    if (!m) throw new Error(`fake client: no route for ${method} ${path}`);
    const id = decodeURIComponent(m[1]!);
    const b = body as Record<string, unknown>;
    if (method === 'PUT' && m[2] === '/answers') return { data: await server.api.answer(id, b.answers as AnswerWrite[]) };
    if (method === 'POST' && m[2] === '/follow-ups') return { data: await server.api.makeFollowUps(id, b as { itemIds: string[]; assigneeId?: string | null }) };
    if (method === 'POST' && m[2] === '/finish') return { data: await server.api.finish(id, b as unknown as FinishInput) };
    if (method === 'GET' && !m[2]) return { data: await server.api.get(id) };
    throw new Error(`fake client: no route for ${method} ${path}`);
  };
  const forUser = (owner: string): ApiClient =>
    ({
      get: (path: string) => route(owner, 'GET', path),
      put: (path: string, body?: unknown) => route(owner, 'PUT', path, body),
      post: (path: string, body?: unknown) => route(owner, 'POST', path, body),
      del: (path: string) => route(owner, 'DELETE', path),
      forUser,
    }) as unknown as ApiClient;
  return { forUser };
}
