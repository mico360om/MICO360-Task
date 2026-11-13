import { describe, it, expect } from 'vitest';
import { createPrismaAiJobStore } from './prisma-ai-job-store';
import { withSaveRetries } from '../../lib/save-retry';

/**
 * 1.23.29 — seen in 1.23.28's battery: the background AI job's finish() (one top-level aiJob.updateMany) was
 * picked as a MySQL deadlock victim (P2034) and the Final MOM draft job failed. On the server's client (the save
 * retry layer, lib/save-retry) that update is simply tried again.
 *
 * The fake runs model calls the way Prisma 5.22's _request does: the middlewares in order with one shared index
 * per request; a `next` past the last one reaches the "engine" (`engine` below).
 */
function fakePrisma(engine: (call: { model: string; action: string; args: unknown }) => Promise<unknown>) {
  type Params = { model?: string; action: string; args: unknown; dataPath: string[]; runInTransaction: boolean };
  type Mw = (p: Params, next: (p: Params) => Promise<unknown>) => Promise<unknown>;
  const middlewares: Mw[] = [];
  const request = (p: Params) => {
    let index = -1;
    const step = async (q: Params): Promise<unknown> => {
      const mw = middlewares[++index];
      return mw ? mw(q, step) : engine({ model: q.model!, action: q.action, args: q.args });
    };
    return step(p);
  };
  const model = (name: string) =>
    new Proxy({}, { get: (_t, action: string) => (args: unknown) => request({ model: name, action, args, dataPath: [], runInTransaction: false }) });
  return {
    $use: (mw: Mw) => void middlewares.push(mw),
    $transaction: async () => {
      throw new Error('not used');
    },
    aiJob: model('AiJob'),
  };
}

describe('the AI job store on the server’s client (save retry layer)', () => {
  it('finish(): a deadlock (P2034) on its update is tried again, and the job is finished', async () => {
    const deadlock = Object.assign(new Error('Transaction failed due to a write conflict or a deadlock. Please retry your transaction'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2034',
      meta: { modelName: 'AiJob' },
    });
    const calls: string[] = [];
    const prisma = fakePrisma(async ({ model, action }) => {
      calls.push(`${model}.${action}`);
      if (calls.length === 1) throw deadlock;
      return { count: 1 };
    });
    const logged: Record<string, unknown>[] = [];
    withSaveRetries(prisma, { pause: async () => {}, logger: { info: (_m, ctx) => void logged.push(ctx ?? {}), warn: (_m, ctx) => void logged.push(ctx ?? {}) } });
    const store = createPrismaAiJobStore(prisma as never);
    await expect(store.finish('job-1', 'srv-1#lease', { status: 'DONE', result: { summary: 'Final MOM draft' } }, new Date())).resolves.toBe(true);
    expect(calls).toEqual(['AiJob.updateMany', 'AiJob.updateMany']);
    expect(logged).toEqual([{ model: 'AiJob', operation: 'updateMany', attempts: 2, conflict: 'P2034', outcome: 'saved' }]);
  });
});
