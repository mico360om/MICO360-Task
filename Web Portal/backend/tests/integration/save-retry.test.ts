import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { withPoolDefaults } from '../../src/lib/db-pool';
import { saveConflict, withSaveRetries } from '../../src/lib/save-retry';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';

// Requires a running MySQL 8 or MariaDB 11.8 (TEST_DATABASE_URL) with migrations applied.
// 1.23.29 — saving the same thing twice at once. Live runs MariaDB 11.8.9 with innodb_snapshot_isolation ON:
// Prisma's update()/upsert() run BEGIN, SELECT, UPDATE, and when another request changed the row in between,
// MariaDB refuses the write (error 1020) — a 500 for a double click or two people saving together. The
// server's client (lib/prisma.ts) now tries such a save again (lib/save-retry). Here: bursts of the same save
// on a real database, through a client with the layer (pool as on live: connection_limit=10), and the same
// bursts on a plain client to show the scenario really conflicts on this engine.
const url = process.env.TEST_DATABASE_URL!;
const logged: { level: string; msg: string; ctx: Record<string, unknown> }[] = [];
const logger = {
  info: (msg: string, ctx?: Record<string, unknown>) => void logged.push({ level: 'info', msg, ctx: ctx ?? {} }),
  warn: (msg: string, ctx?: Record<string, unknown>) => void logged.push({ level: 'warn', msg, ctx: ctx ?? {} }),
};
const prisma = withSaveRetries(new PrismaClient({ datasources: { db: { url: withPoolDefaults(url)! } } }), { logger });
const plain = new PrismaClient({ datasources: { db: { url: withPoolDefaults(url)! } } });

let w: CompanyWorld;
let mariadb = false;
const BURST = 20;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settingKey = (name: string) => `rt.save-retry.${w.tag}.${name}`;

/** Runs `n` copies of one save at the same moment; the failures, by kind. */
async function burst(n: number, save: (i: number) => Promise<unknown>) {
  const results = await Promise.allSettled(Array.from({ length: n }, (_, i) => save(i)));
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => r.reason as { code?: string; message?: string });
  return { results, failures, kinds: [...new Set(failures.map((f) => saveConflict(f) ?? f.code ?? String(f.message).slice(0, 80)))] };
}

beforeAll(async () => {
  const [row] = await prisma.$queryRaw<{ v: string }[]>`SELECT VERSION() AS v`;
  mariadb = /mariadb/i.test(row?.v ?? '');
  w = await buildCompanyWorld(prisma);
});

afterAll(async () => {
  await prisma.systemSetting.deleteMany({ where: { key: { startsWith: `rt.save-retry.${w.tag}.` } } });
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
  await plain.$disconnect();
});

describe('the scenario really conflicts on this engine (a plain client, as before 1.23.29)', () => {
  it(`${BURST} saves of one task at once: MariaDB refuses all but a few (1020); MySQL 8 takes them all`, async () => {
    const { failures, kinds } = await burst(BURST, (i) => plain.task.update({ where: { id: w.tasks.TA2 }, data: { title: `plain ${i}` } }));
    if (mariadb) {
      expect(failures.length).toBeGreaterThan(0);
      expect(kinds).toEqual(['1020']);
    } else {
      expect(failures).toEqual([]);
    }
  });

  it(`${BURST} upserts of one new key at once: the losers fail (1020 on MariaDB, a unique clash P2002 on MySQL 8)`, async () => {
    const key = settingKey('plain-upsert');
    const { failures, kinds } = await burst(BURST, (i) => plain.systemSetting.upsert({ where: { key }, create: { key, value: i }, update: { value: i } }));
    expect(failures.length).toBeGreaterThan(0);
    expect(kinds).toEqual([mariadb ? '1020' : 'P2002']);
  });
});

describe('with the save retry layer (the server’s client)', () => {
  it(`${BURST} saves of one task’s title at once all succeed, and the task keeps one of the titles`, async () => {
    logged.length = 0;
    const titles = Array.from({ length: BURST }, (_, i) => `Burst title ${i}`);
    const { failures } = await burst(BURST, (i) => prisma.task.update({ where: { id: w.tasks.TA1 }, data: { title: titles[i] } }));
    expect(failures).toEqual([]);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: w.tasks.TA1 } });
    expect(titles).toContain(row.title);
    if (mariadb) {
      expect(logged.length).toBeGreaterThan(0); // the conflicts happened and were tried again…
      expect(logged.every((l) => l.level === 'info' && l.ctx.outcome === 'saved' && l.ctx.model === 'Task' && l.ctx.operation === 'update')).toBe(true);
    }
    expect(JSON.stringify(logged)).not.toMatch(/Burst title/); // …and the log never holds the saved values
  });

  it(`${BURST} saves of one task’s status (column) at once all succeed`, async () => {
    const done = await prisma.kanbanColumn.create({ data: { projectId: w.projects.PA, name: 'Done', category: 'DONE', position: 1 } });
    const todo = (await prisma.task.findUniqueOrThrow({ where: { id: w.tasks.TA1 } })).columnId;
    const { failures } = await burst(BURST, (i) => prisma.task.update({ where: { id: w.tasks.TA1 }, data: { columnId: i % 2 ? done.id : todo } }));
    expect(failures).toEqual([]);
    expect([done.id, todo]).toContain((await prisma.task.findUniqueOrThrow({ where: { id: w.tasks.TA1 } })).columnId);
    await prisma.task.update({ where: { id: w.tasks.TA1 }, data: { columnId: todo } });
    await prisma.kanbanColumn.delete({ where: { id: done.id } });
  });

  it(`${BURST} upserts of one key at once all succeed — a new key, then the same key again`, async () => {
    const key = settingKey('upsert');
    for (const round of ['new', 'again']) {
      const { failures } = await burst(BURST, (i) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: `${round} ${i}` }, update: { value: `${round} ${i}` } }));
      expect(failures).toEqual([]);
      const row = await prisma.systemSetting.findUniqueOrThrow({ where: { key } });
      expect(String(row.value)).toMatch(new RegExp(`^${round} \\d+$`));
    }
    expect(await prisma.systemSetting.count({ where: { key } })).toBe(1);
  });

  it('two transactions that read a row, pause, then write it, both succeed (the loser runs again whole)', async () => {
    const key = settingKey('tx');
    await prisma.systemSetting.create({ data: { key, value: 'start' } });
    let runs = 0;
    // Review #5: both first tries have read before either writes, however busy the machine (a later try finds
    // these already settled and goes straight on).
    const signal = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => (resolve = r));
      return { promise, resolve };
    };
    const hasRead = { A: signal(), B: signal() };
    const save = (who: 'A' | 'B') =>
      prisma.$transaction(async (tx) => {
        runs++;
        const row = await tx.systemSetting.findUniqueOrThrow({ where: { key } });
        hasRead[who].resolve();
        await Promise.all([hasRead.A.promise, hasRead.B.promise]);
        await sleep(30);
        await tx.systemSetting.update({ where: { key }, data: { value: `${String(row.value)} + ${who}` } });
        return who;
      });
    const { results, failures } = await burst(2, (i) => save(i === 0 ? 'A' : 'B'));
    expect(failures).toEqual([]);
    expect(results.map((r) => (r as PromiseFulfilledResult<string>).value).sort()).toEqual(['A', 'B']);
    const value = String((await prisma.systemSetting.findUniqueOrThrow({ where: { key } })).value);
    if (mariadb) {
      // The loser's first try was refused (1020) and ran again from a fresh read: no update is lost.
      expect(runs).toBe(3);
      expect(['start + A + B', 'start + B + A']).toContain(value);
    } else {
      // MySQL 8 takes both writes as they come (no snapshot refusal): the value is one of the writes.
      expect(['start + A', 'start + B', 'start + A + B', 'start + B + A']).toContain(value);
    }
  });

  it('five such transactions at once all succeed', async () => {
    const key = settingKey('tx5');
    await prisma.systemSetting.create({ data: { key, value: 0 } });
    const { failures } = await burst(5, () =>
      prisma.$transaction(async (tx) => {
        const row = await tx.systemSetting.findUniqueOrThrow({ where: { key } });
        await sleep(20);
        await tx.systemSetting.update({ where: { key }, data: { value: Number(row.value) + 1 } });
      }),
    );
    expect(failures).toEqual([]);
    const value = Number((await prisma.systemSetting.findUniqueOrThrow({ where: { key } })).value);
    if (mariadb) expect(value).toBe(5); // every one ran on what the one before it saved
    else expect(value).toBeGreaterThanOrEqual(1);
  });

  it(`${BURST} batch transactions ($transaction([…])) on one row at once all succeed`, async () => {
    const { failures } = await burst(BURST, (i) =>
      prisma.$transaction([prisma.task.update({ where: { id: w.tasks.TA2 }, data: { title: `Batch ${i}` } }), prisma.task.findUnique({ where: { id: w.tasks.TA2 } })]),
    );
    expect(failures).toEqual([]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: w.tasks.TA2 } })).title).toMatch(/^Batch \d+$/);
  });

  it('a save that really fails is not tried again (a task that isn’t there: not found, once)', async () => {
    logged.length = 0;
    await expect(prisma.task.update({ where: { id: 'no-such-task' }, data: { title: 'x' } })).rejects.toMatchObject({ code: 'P2025' });
    expect(logged).toEqual([]);
  });
});

describe('everyday saves hit at once through the real routes (no 500s)', () => {
  let app: CompanyApp;
  beforeAll(async () => {
    app = await buildCompanyApp(prisma);
  });
  afterAll(async () => {
    await app.close();
  });

  const statuses = async (n: number, send: (i: number) => Promise<{ statusCode: number; body: string }>) => {
    const res = await Promise.all(Array.from({ length: n }, (_, i) => send(i)));
    // Every answer that isn't a success, with its body (a 500 says which error; anything else shows a wrong setup).
    return { codes: res.map((r) => r.statusCode), bodies: res.filter((r) => r.statusCode >= 300).map((r) => `${r.statusCode} ${r.body.slice(0, 300)}`) };
  };

  it('a task’s title saved 10 times at once (a double click, many times over): every answer is 200', async () => {
    const { codes, bodies } = await statuses(10, (i) => app.put(w.as.ana, `/tasks/${w.tasks.TA1}`, { title: `Clicked title ${i}` }));
    expect(bodies).toEqual([]);
    expect(codes).toEqual(Array(10).fill(200));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: w.tasks.TA1 } })).title).toMatch(/^Clicked title \d$/);
  });

  it('a project’s description saved 10 times at once: every answer is 200', async () => {
    const { codes, bodies } = await statuses(10, (i) => app.put(w.as.admin, `/projects/${w.projects.PA}`, { description: `Saved together ${i}` }));
    expect(bodies).toEqual([]);
    expect(codes).toEqual(Array(10).fill(200));
  });

  it('a company setting saved 10 times at once (an upsert): every answer is 200', async () => {
    const before = await prisma.systemSetting.findUnique({ where: { key: 'workload.dailyLimit' } });
    await prisma.systemSetting.deleteMany({ where: { key: 'workload.dailyLimit' } }); // the first save makes the row
    try {
      const { codes, bodies } = await statuses(10, (i) => app.put(w.as.admin, '/system-settings/workload.dailyLimit', { value: 5 + i }));
      expect(bodies).toEqual([]);
      expect(codes).toEqual(Array(10).fill(200));
      expect(await prisma.systemSetting.count({ where: { key: 'workload.dailyLimit' } })).toBe(1);
    } finally {
      await prisma.systemSetting.deleteMany({ where: { key: 'workload.dailyLimit' } });
      if (before) await prisma.systemSetting.create({ data: { key: before.key, value: before.value ?? 0 } });
    }
  });

  it('the same chat reaction added 10 times at once (an upsert of one new row): every answer is 201, one reaction kept', async () => {
    const message = await prisma.chatMessage.findFirstOrThrow({ where: { conversationId: w.chats.anaAmy } });
    const { codes, bodies } = await statuses(10, () => app.post(w.as.amy, `/messages/${message.id}/reactions`, { emoji: '👍' }));
    expect(bodies).toEqual([]);
    expect(codes).toEqual(Array(10).fill(201));
    expect(await prisma.chatReaction.count({ where: { messageId: message.id, userId: w.people.amy, emoji: '👍' } })).toBe(1);
  });
});
