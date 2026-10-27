import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiError } from './api-client';
import {
  createInspectionOutbox,
  memoryDraftStorage,
  removeOwnerRecords,
  type InspectionOutbox,
  type OutboxApi,
} from './inspection-outbox';
import type { AnswerOutcome, AnswerWrite, InspectionDetail } from '../api/inspections';

const OWNER = 'u-ivan';

function detail(over: Partial<InspectionDetail> = {}): InspectionDetail {
  return {
    id: 'i1',
    projectId: 'p1',
    title: 'Rig daily check',
    status: 'IN_PROGRESS',
    place: 'Rig 3',
    startedAt: '2026-10-27T08:00:00.000Z',
    finishedAt: null,
    inspector: { id: OWNER, name: 'Ivan Inspector' },
    counts: { total: 3, answered: 0, passed: 0, failed: 0, na: 0 },
    result: '0 of 3 answered',
    clientVisible: false,
    task: null,
    description: null,
    formId: 'f1',
    formVersion: 1,
    structure: {
      sections: [
        {
          id: 's1',
          title: 'Well head',
          items: [
            { id: 'p', kind: 'READING', label: 'Pressure', help: null, unit: 'psi', min: 0, max: 150 },
            { id: 'v', kind: 'CHECK', label: 'Valves closed', help: null },
            { id: 'r', kind: 'CHECK', label: 'Guard rails', help: null },
          ],
        },
      ],
      clientSignature: 'NONE',
      supervisorSignature: 'NONE',
    },
    startedBy: { id: OWNER, name: 'Ivan Inspector' },
    answers: [],
    signatures: [],
    followUps: [],
    permissions: { canAnswer: true, canFinish: true, canReopen: false, canTakeOver: false, canDelete: true, canShowToClient: false, canMakeFollowUps: true },
    signatureRoles: { allowed: ['INSPECTOR'], required: ['INSPECTOR'] },
    revision: 0,
    ...over,
  };
}

/** A fake server: stores answers last-write-wins as the real one does (no clamping unless told). */
function fakeServer() {
  const stored = new Map<string, AnswerWrite>();
  const calls: Array<{ kind: string; body: unknown }> = [];
  let fail: ((kind: string) => unknown) | null = null;
  let clampTo: string | null = null;
  const api: OutboxApi = {
    async answer(_id, writes) {
      calls.push({ kind: 'answer', body: writes });
      const e = fail?.('answer');
      if (e) throw e;
      const results: AnswerOutcome[] = writes.map((w) => {
        const cur = stored.get(w.itemId);
        const editedAt = clampTo && w.editedAt > clampTo ? clampTo : w.editedAt;
        if (cur && cur.editedAt > editedAt) return { itemId: w.itemId, status: 'stale', answer: cur };
        if (cur && cur.editedAt === editedAt) return { itemId: w.itemId, status: 'same', answer: cur };
        const next = { ...w, editedAt };
        stored.set(w.itemId, next);
        return { itemId: w.itemId, status: 'applied', answer: next };
      });
      return { results, inspection: { ...detail(), counts: { total: 3, answered: stored.size, passed: 0, failed: 0, na: 0 } } };
    },
    async finish(_id, input) {
      calls.push({ kind: 'finish', body: input });
      const e = fail?.('finish');
      if (e) throw e;
      const seen = new Map(input.seen.map((s) => [s.itemId, s.editedAt]));
      for (const [itemId, a] of stored) if (seen.get(itemId) !== a.editedAt) throw new ApiError(409, 'ANSWERS_CHANGED', 'Some answers changed after they were signed.');
      return detail({ status: 'FINISHED', finishedAt: '2026-10-27T09:00:00.000Z', answers: [...stored.values()], taskOffer: null });
    },
    async makeFollowUps(_id, input) {
      calls.push({ kind: 'follow-ups', body: input });
      const e = fail?.('follow-ups');
      if (e) throw e;
      return input.itemIds.map((itemId) => ({ itemId, status: 'created' as const, task: { id: `t-${itemId}`, key: `RIG-${itemId}`, title: `Follow up: ${itemId}` } }));
    },
  };
  return {
    api,
    calls,
    stored,
    failWith: (f: ((kind: string) => unknown) | null) => void (fail = f),
    clampTo: (iso: string | null) => void (clampTo = iso),
  };
}

let storage: ReturnType<typeof memoryDraftStorage>;
let server: ReturnType<typeof fakeServer>;
let outbox: InspectionOutbox;
let clock: number;

beforeEach(() => {
  storage = memoryDraftStorage();
  server = fakeServer();
  clock = Date.parse('2026-10-27T08:10:00.000Z');
  outbox = createInspectionOutbox({ storage, api: server.api, now: () => new Date(clock), newId: () => 'finish-1' });
});

const tick = (ms = 1000) => (clock += ms);
const offline = () => new TypeError('Failed to fetch');

describe('saving on the device', () => {
  it('keeps each answer under its person and inspection, and reads it back', () => {
    outbox.remember(OWNER, detail());
    const r = outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: '  ok  ' });
    expect(r).toEqual({ persisted: true });
    const fresh = createInspectionOutbox({ storage, api: server.api, now: () => new Date(clock) });
    expect(fresh.draft(OWNER, 'i1')!.answers.v).toEqual({ itemId: 'v', result: 'PASS', reading: null, note: 'ok', editedAt: '2026-10-27T08:10:00.000Z' });
    expect(fresh.draft('u-someone-else', 'i1')).toBeNull();
    expect([...storage.raw.keys()]).toEqual(['mico360.inspection.u-ivan.i1']);
  });

  it('works a reading out as the server will: outside its limits it fails, typed digits are read', () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'p', result: 'PASS', reading: '١٦٢٫٥', note: null });
    expect(outbox.draft(OWNER, 'i1')!.answers.p).toMatchObject({ result: 'FAIL', reading: '162.5' });
    expect(outbox.view(OWNER, 'i1')!.counts).toMatchObject({ answered: 1, failed: 1 });
  });

  it('shows the inspection as last read, with this device’s changes over it', () => {
    outbox.remember(OWNER, detail({ answers: [{ itemId: 'v', result: 'FAIL', reading: null, note: 'Leak', editedAt: '2026-10-27T08:01:00.000Z' }] }));
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'r', result: 'PASS', reading: null, note: null });
    const v = outbox.view(OWNER, 'i1')!;
    expect(v.answers.map((a) => [a.itemId, a.result])).toEqual([
      ['v', 'FAIL'],
      ['r', 'PASS'],
    ]);
    expect(v.pending).toEqual({ answers: 1, finish: false, followUps: 0 });
  });

  it('when the phone’s storage is full, keeps the change in the page and says so', () => {
    outbox.remember(OWNER, detail());
    storage.full = true;
    expect(outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null })).toEqual({ persisted: false });
    expect(outbox.view(OWNER, 'i1')!.persisted).toBe(false);
    expect(outbox.draft(OWNER, 'i1')!.answers.v).toBeTruthy();
    storage.full = false;
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'r', result: 'PASS', reading: null, note: null });
    expect(outbox.view(OWNER, 'i1')!.persisted).toBe(true);
    expect(JSON.parse(storage.raw.get('mico360.inspection.u-ivan.i1')!).answers.v).toBeTruthy();
  });

  it('makes room by dropping other inspections’ copies that have nothing waiting', () => {
    outbox.remember(OWNER, detail({ id: 'old' })); // a copy kept for opening without signal, nothing waiting
    outbox.remember(OWNER, detail());
    storage.limit = (storage.raw.get('mico360.inspection.u-ivan.i1')!.length ?? 0) + 400;
    expect(outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: 'x'.repeat(100) })).toEqual({ persisted: true });
    expect(storage.raw.has('mico360.inspection.u-ivan.old')).toBe(false);
  });
});

describe('sending', () => {
  it('sends every waiting answer in one go, and forgets those the server took', async () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    tick();
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'r', result: 'FAIL', reading: null, note: 'Loose' });
    expect(await outbox.flush(OWNER, 'i1')).toEqual({ state: 'sent' });
    expect(server.calls.map((c) => c.kind)).toEqual(['answer']);
    expect((server.calls[0]!.body as AnswerWrite[]).map((w) => w.itemId)).toEqual(['v', 'r']);
    expect(outbox.view(OWNER, 'i1')!.pending.answers).toBe(0);
    expect(outbox.view(OWNER, 'i1')!.answers.map((a) => a.itemId)).toEqual(['v', 'r']);
  });

  it('keeps an answer changed again while the first send was on its way', async () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    const answer = server.api.answer;
    server.api.answer = async (id, writes) => {
      tick();
      outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'FAIL', reading: null, note: 'changed my mind' });
      return answer(id, writes);
    };
    await outbox.flush(OWNER, 'i1');
    expect(outbox.draft(OWNER, 'i1')!.answers.v).toMatchObject({ result: 'FAIL', note: 'changed my mind' });
    server.api.answer = answer;
    await outbox.flush(OWNER, 'i1');
    expect(server.stored.get('v')).toMatchObject({ result: 'FAIL' });
    expect(outbox.draft(OWNER, 'i1')!.answers.v).toBeUndefined();
  });

  it('a newer edit from another device wins: this device’s older one is dropped and the newer shown', async () => {
    server.stored.set('v', { itemId: 'v', result: 'FAIL', reading: null, note: 'From the tablet', editedAt: '2026-10-27T08:30:00.000Z' });
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    await outbox.flush(OWNER, 'i1');
    expect(outbox.view(OWNER, 'i1')!.answers.find((a) => a.itemId === 'v')).toMatchObject({ result: 'FAIL', note: 'From the tablet' });
    expect(outbox.view(OWNER, 'i1')!.pending.answers).toBe(0);
  });

  it('sending the same thing twice is harmless (a replay after a lost response)', async () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    const answer = server.api.answer;
    server.api.answer = async (id, writes) => {
      await answer(id, writes);
      throw offline(); // stored, but the answer never came back
    };
    expect(await outbox.flush(OWNER, 'i1')).toEqual({ state: 'offline' });
    server.api.answer = answer;
    expect(await outbox.flush(OWNER, 'i1', { force: true })).toEqual({ state: 'sent' });
    expect(server.stored.size).toBe(1);
  });

  it('with no signal, keeps everything and says it is offline', async () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    server.failWith(() => offline());
    expect(await outbox.flush(OWNER, 'i1')).toEqual({ state: 'offline' });
    expect(outbox.view(OWNER, 'i1')!.pending.answers).toBe(1);
  });

  it('signed out (the session expired while offline): keeps everything until they sign in again', async () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    server.failWith(() => new ApiError(401, 'UNAUTHORIZED', 'Signed out'));
    expect(await outbox.flush(OWNER, 'i1')).toEqual({ state: 'signed-out' });
    server.failWith(null);
    expect(await outbox.flush(OWNER, 'i1')).toEqual({ state: 'sent' });
  });

  it('a server it can’t reach (502, 503, 504) is like no signal: everything is kept and tried again later', async () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    for (const status of [502, 503, 504]) {
      server.failWith(() => new ApiError(status, 'BAD_GATEWAY', 'Bad gateway'));
      expect(await outbox.flush(OWNER, 'i1', { force: true })).toEqual({ state: 'unreachable' });
    }
    expect(outbox.view(OWNER, 'i1')!.pending.answers).toBe(1);
    expect(outbox.view(OWNER, 'i1')!.problem).toBeNull();
    server.failWith(() => new ApiError(500, 'INTERNAL', 'Something went wrong.'));
    expect(await outbox.flush(OWNER, 'i1', { force: true })).toEqual({ state: 'retry' });
    expect(outbox.view(OWNER, 'i1')!.problem).toBeNull();
  });

  it('the inspection was deleted meanwhile: the answers stay on the device with a plain reason, until thrown away', async () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    server.failWith(() => new ApiError(404, 'INSPECTION_GONE', 'This inspection isn’t there any more.'));
    expect(await outbox.flush(OWNER, 'i1')).toEqual({ state: 'problem' });
    const v = outbox.view(OWNER, 'i1')!;
    expect(v.problem).toMatchObject({ code: 'INSPECTION_GONE' });
    expect(v.problem!.message).toMatch(/deleted/);
    expect(v.pending.answers).toBe(1);
    // Nothing more is tried until the person decides.
    server.failWith(null);
    expect(await outbox.flush(OWNER, 'i1')).toEqual({ state: 'problem' });
    expect(server.calls).toHaveLength(1);
    outbox.discard(OWNER, 'i1');
    expect(outbox.draft(OWNER, 'i1')).toBeNull();
  });

  it('someone took it over: says who, keeps the answers to look at', async () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    server.failWith(() => new ApiError(409, 'NOT_THE_INSPECTOR', 'Olivia Owner is carrying out this inspection now: only they can answer, sign and finish it.'));
    await outbox.flush(OWNER, 'i1');
    expect(outbox.view(OWNER, 'i1')!.problem).toMatchObject({ code: 'NOT_THE_INSPECTOR', message: expect.stringContaining('Olivia Owner') });
  });

  it('two sends at once go out once', async () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    const [a, b] = await Promise.all([outbox.flush(OWNER, 'i1'), outbox.flush(OWNER, 'i1')]);
    expect([a, b]).toEqual([{ state: 'sent' }, { state: 'sent' }]);
    expect(server.calls).toHaveLength(1);
  });

  it('sends only the signed-in person’s changes', async () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    await outbox.flushAll('u-someone-else');
    expect(server.calls).toHaveLength(0);
    await outbox.flushAll(OWNER);
    expect(server.calls).toHaveLength(1);
  });
});

describe('finishing without signal', () => {
  const sign = () => ({ role: 'INSPECTOR' as const, name: 'Ivan Inspector', method: 'TYPED' as const, signedAt: '2026-10-27T08:20:00.000Z' });

  it('waits for its answers, then finishes with the edit times the server stored', async () => {
    outbox.remember(OWNER, detail());
    for (const itemId of ['p', 'v', 'r']) {
      outbox.saveAnswer(OWNER, 'i1', { itemId, result: itemId === 'p' ? null : 'PASS', reading: itemId === 'p' ? '120' : null, note: null });
      tick();
    }
    // The server holds a phone clock running ahead to its own time.
    server.clampTo('2026-10-27T08:10:01.000Z');
    outbox.queueFinish(OWNER, 'i1', [sign()]);
    expect(outbox.view(OWNER, 'i1')!.pending.finish).toBe(true);
    expect(outbox.view(OWNER, 'i1')!.locked).toBe(true);
    expect(await outbox.flush(OWNER, 'i1')).toEqual({ state: 'sent' });
    expect(server.calls.map((c) => c.kind)).toEqual(['answer', 'finish']);
    const fin = server.calls[1]!.body as { finishId: string; seen: Array<{ itemId: string; editedAt: string }> };
    expect(fin.finishId).toBe('finish-1');
    expect(fin.seen).toEqual(expect.arrayContaining([{ itemId: 'r', editedAt: '2026-10-27T08:10:01.000Z' }]));
    // Finished and nothing left waiting: nothing of it stays on the phone.
    expect(outbox.view(OWNER, 'i1')).toBeNull();
    expect(outbox.waiting(OWNER)).toEqual([]);
  });

  it('keeps the attached task’s "mark it done?" offer until the person answers it', async () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    outbox.queueFinish(OWNER, 'i1', [sign()]);
    const finish = server.api.finish;
    server.api.finish = async (id, input) => ({ ...(await finish(id, input)), taskOffer: { id: 't1', key: 'RIG-1', title: 'Inspect rig 3', doneColumnId: 'c-done' } });
    await outbox.flush(OWNER, 'i1');
    expect(outbox.view(OWNER, 'i1')).toMatchObject({ status: 'FINISHED', finishedOffer: { key: 'RIG-1' }, pending: { answers: 0, finish: false, followUps: 0 } });
    outbox.ackFinished(OWNER, 'i1');
    expect(outbox.view(OWNER, 'i1')).toBeNull();
  });

  it('a finish that went through but whose answer was lost is sent again with the same id', async () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    outbox.queueFinish(OWNER, 'i1', [sign()]);
    server.failWith((kind) => (kind === 'finish' ? offline() : null));
    expect(await outbox.flush(OWNER, 'i1')).toEqual({ state: 'offline' });
    server.failWith(null);
    await outbox.flush(OWNER, 'i1', { force: true });
    const ids = server.calls.filter((c) => c.kind === 'finish').map((c) => (c.body as { finishId: string }).finishId);
    expect(ids).toEqual(['finish-1', 'finish-1']);
  });

  it('when another device’s edit won meanwhile, it doesn’t finish: the signers look again', async () => {
    server.stored.set('v', { itemId: 'v', result: 'FAIL', reading: null, note: 'From the tablet', editedAt: '2026-10-27T08:30:00.000Z' });
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    outbox.queueFinish(OWNER, 'i1', [sign()]);
    expect(await outbox.flush(OWNER, 'i1')).toEqual({ state: 'problem' });
    expect(server.calls.map((c) => c.kind)).toEqual(['answer']);
    const v = outbox.view(OWNER, 'i1')!;
    expect(v.problem).toMatchObject({ code: 'ANSWERS_CHANGED' });
    expect(v.pending.finish).toBe(false);
    expect(v.locked).toBe(false);
  });

  it('the server refusing the finish (answers changed there) drops it and says why', async () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    outbox.queueFinish(OWNER, 'i1', [sign()]);
    server.failWith((kind) => (kind === 'finish' ? new ApiError(409, 'INSPECTION_INCOMPLETE', 'It can’t be finished yet: 2 items still need an answer.') : null));
    expect(await outbox.flush(OWNER, 'i1')).toEqual({ state: 'problem' });
    expect(outbox.view(OWNER, 'i1')!.problem).toMatchObject({ code: 'INSPECTION_INCOMPLETE', message: 'It can’t be finished yet: 2 items still need an answer.' });
    expect(outbox.view(OWNER, 'i1')!.pending.finish).toBe(false);
    outbox.clearProblem(OWNER, 'i1');
    expect(outbox.view(OWNER, 'i1')!.problem).toBeNull();
  });

  it('a waiting finish can be taken back to change an answer', () => {
    outbox.remember(OWNER, detail());
    outbox.queueFinish(OWNER, 'i1', [sign()]);
    outbox.cancelFinish(OWNER, 'i1');
    expect(outbox.view(OWNER, 'i1')!.locked).toBe(false);
  });
});

describe('follow-up tasks without signal', () => {
  it('asks for them after the answers, once, and forgets them when made', async () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'r', result: 'FAIL', reading: null, note: null });
    outbox.queueFollowUps(OWNER, 'i1', ['r'], undefined);
    outbox.queueFollowUps(OWNER, 'i1', ['r'], undefined);
    expect(outbox.view(OWNER, 'i1')!.pending.followUps).toBe(1);
    await outbox.flush(OWNER, 'i1');
    expect(server.calls.map((c) => c.kind)).toEqual(['answer', 'follow-ups']);
    expect(server.calls[1]!.body).toEqual({ itemIds: ['r'] });
    expect(outbox.view(OWNER, 'i1')!.pending.followUps).toBe(0);
  });

  it('keeps the chosen person (or nobody) with each request', async () => {
    outbox.remember(OWNER, detail());
    outbox.queueFollowUps(OWNER, 'i1', ['r'], 'u-sam');
    outbox.queueFollowUps(OWNER, 'i1', ['v'], null);
    await outbox.flush(OWNER, 'i1');
    expect(server.calls.map((c) => c.body)).toEqual([{ itemIds: ['r'], assigneeId: 'u-sam' }, { itemIds: ['v'], assigneeId: null }]);
  });
});

describe('what waits on this phone', () => {
  it('lists the person’s inspections with changes waiting, and forgets finished ones once sent', async () => {
    outbox.remember(OWNER, detail());
    outbox.remember(OWNER, detail({ id: 'i2', title: 'Deck check' }));
    outbox.saveAnswer(OWNER, 'i2', { itemId: 'v', result: 'PASS', reading: null, note: null });
    expect(outbox.waiting(OWNER).map((w) => [w.inspectionId, w.title, w.pending.answers])).toEqual([['i2', 'Deck check', 1]]);
    expect(outbox.waiting('u-other')).toEqual([]);
    outbox.remember(OWNER, detail({ id: 'i2', title: 'Deck check', status: 'FINISHED' }));
    expect(outbox.waiting(OWNER)).toHaveLength(1);
  });

  it('tells listeners when something changes', () => {
    const seen = vi.fn();
    const off = outbox.subscribe(seen);
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    expect(seen).toHaveBeenCalled();
    off();
  });
});

describe('detailView', () => {
  it('shows server data with nothing waiting', async () => {
    const { detailView } = await import('./inspection-outbox');
    const v = detailView(detail({ answers: [{ itemId: 'p', result: 'FAIL', reading: '170', note: null, editedAt: '2026-10-27T08:01:00.000Z' }] }));
    expect(v).toMatchObject({ inspectionId: 'i1', counts: { answered: 1, failed: 1 }, pending: { answers: 0, finish: false, followUps: 0 }, persisted: true, locked: false });
  });
});

describe('follow-ups on a finished inspection (no record kept on the phone)', () => {
  it('starts a record from the inspection as shown, and sends the request', async () => {
    const finished = detail({ status: 'FINISHED', answers: [{ itemId: 'r', result: 'FAIL', reading: null, note: null, editedAt: '2026-10-27T08:01:00.000Z' }] });
    outbox.remember(OWNER, finished);
    expect(outbox.draft(OWNER, 'i1')).toBeNull();
    outbox.queueFollowUps(OWNER, 'i1', ['r'], undefined, finished);
    expect(outbox.view(OWNER, 'i1')!.pending.followUps).toBe(1);
    await outbox.flush(OWNER, 'i1');
    expect(server.calls.map((c) => c.kind)).toEqual(['follow-ups']);
    expect(outbox.view(OWNER, 'i1')!.pending.followUps).toBe(0);
    // Read again from the server: nothing waits, so nothing is kept.
    outbox.remember(OWNER, finished);
    expect(outbox.draft(OWNER, 'i1')).toBeNull();
  });
});

describe('review fixes', () => {
  const sign = () => ({ role: 'INSPECTOR' as const, name: 'Ivan Inspector', method: 'TYPED' as const, signedAt: '2026-10-27T08:20:00.000Z' });

  it('a finish carries the revision its signers saw', async () => {
    outbox.remember(OWNER, detail({ revision: 2 }));
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    outbox.queueFinish(OWNER, 'i1', [sign()]);
    await outbox.flush(OWNER, 'i1');
    expect((server.calls.find((c) => c.kind === 'finish')!.body as { revision: number }).revision).toBe(2);
  });

  it('a refused follow-up request is dropped with a note, and doesn’t hold the answers or the finish back', async () => {
    outbox.remember(OWNER, detail());
    outbox.queueFollowUps(OWNER, 'i1', ['r'], 'u-gone');
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    server.failWith((kind) => (kind === 'follow-ups' ? new ApiError(400, 'VALIDATION', 'Only active members of the project can be assigned.') : null));
    await outbox.flush(OWNER, 'i1');
    const v = outbox.view(OWNER, 'i1')!;
    expect(v.problem).toMatchObject({ stage: 'follow-ups', message: 'Only active members of the project can be assigned.' });
    expect(v.pending).toEqual({ answers: 0, finish: false, followUps: 0 });
    // A later answer still goes, the note stays until it is read.
    server.failWith(null);
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'r', result: 'FAIL', reading: null, note: null });
    expect(await outbox.flush(OWNER, 'i1')).toEqual({ state: 'sent' });
    expect(server.stored.get('r')).toMatchObject({ result: 'FAIL' });
    expect(outbox.view(OWNER, 'i1')!.problem).toMatchObject({ stage: 'follow-ups' });
  });

  it('a refused finish doesn’t hold later answers back either', async () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    outbox.queueFinish(OWNER, 'i1', [sign()]);
    server.failWith((kind) => (kind === 'finish' ? new ApiError(409, 'INSPECTION_REOPENED', 'This inspection was reopened after it was signed.') : null));
    expect(await outbox.flush(OWNER, 'i1')).toEqual({ state: 'problem' });
    server.failWith(null);
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'r', result: 'PASS', reading: null, note: null });
    expect(await outbox.flush(OWNER, 'i1')).toEqual({ state: 'sent' });
    expect(server.stored.get('r')).toBeTruthy();
  });

  it('an older copy read from the server doesn’t take back answers it already confirmed', async () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'FAIL', reading: null, note: 'Leak' });
    await outbox.flush(OWNER, 'i1');
    // A read that left before that send came back after it.
    outbox.remember(OWNER, detail({ answers: [] }));
    expect(outbox.view(OWNER, 'i1')!.answers).toEqual([expect.objectContaining({ itemId: 'v', result: 'FAIL', note: 'Leak' })]);
    // A newer one from the server wins.
    outbox.remember(OWNER, detail({ answers: [{ itemId: 'v', result: 'PASS', reading: null, note: null, editedAt: '2027-01-01T00:00:00.000Z' }] }));
    expect(outbox.view(OWNER, 'i1')!.answers[0]).toMatchObject({ result: 'PASS' });
  });

  it('six 502s in a row: answering still works, the sends wait longer each time (up to 5 minutes), then it all goes', async () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    server.failWith(() => new ApiError(502, 'BAD_GATEWAY', 'Bad gateway'));
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      expect(await outbox.flush(OWNER, 'i1')).toEqual({ state: 'unreachable' });
      const v = outbox.view(OWNER, 'i1')!;
      expect(v.problem).toBeNull();
      waits.push(Date.parse(v.retryAt!) - clock);
      // Answering is never locked by server trouble.
      expect(outbox.saveAnswer(OWNER, 'i1', { itemId: 'r', result: i % 2 ? 'PASS' : 'FAIL', reading: null, note: null })).toEqual({ persisted: true });
      // Before its time, a send doesn't go (no hammering)…
      expect(await outbox.flush(OWNER, 'i1')).toEqual({ state: 'unreachable' });
      tick(waits.at(-1)! + 1);
    }
    expect(waits).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 160_000]);
    expect(server.calls.filter((c) => c.kind === 'answer')).toHaveLength(6);
    server.failWith(null);
    expect(await outbox.flush(OWNER, 'i1')).toEqual({ state: 'sent' });
    expect(server.stored.get('v')).toBeTruthy();
    expect(server.stored.get('r')).toMatchObject({ result: 'PASS' });
    expect(outbox.view(OWNER, 'i1')!.retryAt).toBeNull();
  });

  it('waits at most 5 minutes between tries, and coming back online tries at once', async () => {
    outbox.remember(OWNER, detail());
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    server.failWith(() => offline());
    for (let i = 0; i < 9; i++) {
      await outbox.flush(OWNER, 'i1', { force: true });
    }
    expect(Date.parse(outbox.view(OWNER, 'i1')!.retryAt!) - clock).toBe(300_000);
    server.failWith(null);
    expect(await outbox.flush(OWNER, 'i1', { force: true })).toEqual({ state: 'sent' });
  });

  it('a real refusal after server trouble is a problem of its own stage', async () => {
    outbox.remember(OWNER, detail());
    outbox.queueFollowUps(OWNER, 'i1', ['r'], 'u-gone');
    server.failWith(() => new ApiError(503, 'UNAVAILABLE', 'Down'));
    await outbox.flush(OWNER, 'i1');
    server.failWith((kind) => (kind === 'follow-ups' ? new ApiError(400, 'VALIDATION', 'Only active members of the project can be assigned.') : null));
    await outbox.flush(OWNER, 'i1', { force: true });
    expect(outbox.view(OWNER, 'i1')!.problem).toMatchObject({ stage: 'follow-ups', code: 'VALIDATION' });
  });

  it('signing out on purpose removes that person’s records (and only theirs)', () => {
    outbox.remember(OWNER, detail());
    outbox.remember('u-other', detail({ id: 'i9' }));
    outbox.saveAnswer(OWNER, 'i1', { itemId: 'v', result: 'PASS', reading: null, note: null });
    expect(removeOwnerRecords(storage, OWNER)).toBe(1);
    expect(outbox.draft(OWNER, 'i1')).toBeNull();
    expect(outbox.draft('u-other', 'i9')).not.toBeNull();
  });
});
