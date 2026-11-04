import { describe, it, expect } from 'vitest';
import { createFinalMinutesAi } from './final-minutes-ai';
import { createMemoryFinalMinutesRepository } from './final-minutes-repository';
import { createMemoryAiJobStore, type AiJobRecord } from '../ai-jobs/ai-job-store';
import { createAiJobRunner, KEEP_GRACE_MS } from '../ai-jobs/ai-job-runner';

// 1.22 (§10) review fixes: the moment between finishing and keeping, "Use it" against a change at the
// same moment, and an older app's waiting request (only the requester's waiting silences the bell).

const aiContent = { summary: 'Drafted by the AI.', discussion: [], decisions: [], risks: [], nextSteps: [] };
const theirs = { summary: 'Theirs.', discussion: [], decisions: [], risks: [], nextSteps: [] };
const draft = (content = theirs) => ({ content, status: 'DRAFT' as const, approvedById: null, approvedAt: null });

function setup(opts: { hold?: Promise<void> } = {}) {
  const store = createMemoryAiJobStore();
  const runner = createAiJobRunner({ store, owner: 'srv-1' });
  const finalMinutes = createMemoryFinalMinutesRepository();
  const told: string[] = [];
  const ai = createFinalMinutesAi({
    jobs: runner,
    store,
    finalMinutes,
    draftMinutesWithAi: async () => {
      if (opts.hold) await opts.hold;
      return aiContent;
    },
    notify: async (n) => void told.push(`${n.userId}:${n.type}`),
    pollMs: 5,
  });
  runner.register('final-minutes', ai.handler);
  return { store, runner, finalMinutes, ai, told };
}
/** A job that finished with the AI's draft, its result not kept yet (`ago` ms ago). */
async function finished(store: ReturnType<typeof createMemoryAiJobStore>, ago: number, outcome: string | null = null) {
  const { job } = await store.create({ kind: 'final-minutes', subjectId: 'm1', meetingId: 'm1', requestedById: 'u1', input: {} }, new Date());
  Object.assign(store.rows.get(job.id)!, { status: 'DONE', activeKey: null, result: aiContent, outcome, finishedAt: new Date(Date.now() - ago) } satisfies Partial<AiJobRecord>);
  return job.id;
}

describe('Final MOM AI draft: the moment between finishing and keeping', () => {
  it('reads as still drafting, and Use it / Discard wait for it', async () => {
    const s = setup();
    await s.finalMinutes.save('m1', draft());
    const id = await finished(s.store, 1000);
    expect(await s.ai.view('m1', await s.finalMinutes.get('m1'), 'u1')).toMatchObject({ id, status: 'running' });
    await expect(s.ai.use('m1', id)).rejects.toMatchObject({ status: 409, code: 'AI_DRAFT_RUNNING' });
    await expect(s.ai.discard('m1', id)).rejects.toMatchObject({ status: 409, code: 'AI_DRAFT_RUNNING' });
    s.store.rows.get(id)!.outcome = 'SAVING';
    expect(await s.ai.view('m1', await s.finalMinutes.get('m1'), 'u1')).toMatchObject({ status: 'running' });
  });

  it('long after (never kept, no sweep): offered; kept and lost: said as a failure', async () => {
    const s = setup();
    const id = await finished(s.store, KEEP_GRACE_MS + 60_000);
    expect(await s.ai.view('m1', await s.finalMinutes.get('m1'), 'u1')).toMatchObject({ status: 'ready', content: aiContent });
    s.store.rows.get(id)!.outcome = 'LOST';
    s.store.rows.get(id)!.error = { message: 'Something went wrong while keeping the AI’s work. Try again.', code: null, status: 500 };
    expect(await s.ai.view('m1', await s.finalMinutes.get('m1'), 'u1')).toMatchObject({ status: 'failed', error: 'Something went wrong while keeping the AI’s work. Try again.' });
    await s.ai.discard('m1', id);
    expect(await s.ai.view('m1', await s.finalMinutes.get('m1'), 'u1')).toBeNull();
  });
});

describe('Final MOM AI draft: Use it', () => {
  it('never goes over a change or an approval made at the same moment; the offer stays', async () => {
    const s = setup();
    await s.finalMinutes.save('m1', draft());
    const id = await finished(s.store, KEEP_GRACE_MS + 60_000, 'OFFERED');
    // Someone marks the minutes final just after "Use it" read them.
    const get = s.finalMinutes.get.bind(s.finalMinutes);
    let once = true;
    s.finalMinutes.get = async (m) => {
      const read = await get(m);
      if (once) {
        once = false;
        await new Promise((r) => setTimeout(r, 2));
        await s.finalMinutes.save(m, { content: theirs, status: 'APPROVED', approvedById: 'u2', approvedAt: new Date() });
      }
      return read;
    };
    await expect(s.ai.use('m1', id)).rejects.toMatchObject({ status: 409, code: 'FINAL_MINUTES_CHANGED' });
    expect((await get('m1'))!.status).toBe('APPROVED');
    expect((await s.store.get(id))!.outcome).toBe('OFFERED');
  });
});

describe('Final MOM AI draft: an older app waiting for the text', () => {
  it('only the requester’s own waiting counts as watching: someone else’s doesn’t silence the bell', async () => {
    let release!: () => void;
    const s = setup({ hold: new Promise<void>((r) => (release = r)) });
    const { job } = await s.ai.start({ userId: 'u1', roles: [] }, 'm1', { title: 'Weekly', facts: async () => 'x' }, null);
    // u2 (another editor, on the older app) joins and waits.
    const joined = await s.ai.start({ userId: 'u2', roles: [] }, 'm1', { title: 'Weekly', facts: async () => 'x', waiting: true }, null);
    expect(joined).toMatchObject({ joined: true, job: { id: job.id } });
    const waited = s.ai.waitForContent(job.id, 'm1', 'u2');
    await new Promise((r) => setTimeout(r, 30));
    release();
    await expect(waited).resolves.toEqual(aiContent);
    await s.runner.idle();
    expect(s.told).toEqual(['u1:AI_DRAFT_READY']);
  });

  it('the requester waiting on the older app is shown it in the answer: no bell', async () => {
    const s = setup();
    const { job } = await s.ai.start({ userId: 'u1', roles: [] }, 'm1', { title: 'Weekly', facts: async () => 'x', waiting: true }, null);
    await expect(s.ai.waitForContent(job.id, 'm1', 'u1')).resolves.toEqual(aiContent);
    await s.runner.idle();
    expect(s.told).toEqual([]);
  });

  it('stops following once the app has gone (the job carries on and keeps the draft)', async () => {
    let release!: () => void;
    const s = setup({ hold: new Promise<void>((r) => (release = r)) });
    const { job } = await s.ai.start({ userId: 'u1', roles: [] }, 'm1', { title: 'Weekly', facts: async () => 'x', waiting: true }, null);
    const gone = new AbortController();
    const waited = s.ai.waitForContent(job.id, 'm1', 'u1', gone.signal);
    gone.abort();
    await expect(waited).rejects.toMatchObject({ code: 'AI_DRAFT_RUNNING' });
    release();
    await s.runner.idle();
    expect((await s.finalMinutes.get('m1'))!.content).toEqual(aiContent);
  });
});
