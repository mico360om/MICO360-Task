import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaCarryForwardRepo } from '../../src/modules/tasks/prisma-task-repository';
import { createCarryForwardService, type CarryForwardRepo } from '../../src/modules/tasks/carry-forward-service';
import { boardDateFromKey, DEFAULT_CARRY_STATUSES } from '../../src/modules/tasks/board-date';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const TZ = 'Asia/Muscat';
const NOW = new Date('2026-10-23T06:00:00Z'); // 10:00 on 23 Oct in Muscat
const PAST = boardDateFromKey('2026-10-20');
const TODAY = boardDateFromKey('2026-10-23');
const CODES = ['CFON', 'CFOFF'];

// The real query, narrowed to this test's tasks: the database is shared, and the sweep must not
// move anyone else's rows.
const mine = new Set<string>();
const real = createPrismaCarryForwardRepo(prisma);
const repo: CarryForwardRepo = {
  listCarryCandidates: async (before) => (await real.listCarryCandidates(before)).filter((t) => mine.has(t.id)),
  applyCarry: (id, to, entry) => real.applyCarry(id, to, entry),
};
let companyOn = true;
const service = createCarryForwardService({ repo, timeZone: TZ, now: () => NOW, config: async () => ({ enabled: companyOn, statuses: DEFAULT_CARRY_STATUSES }) });

let onProject = '';
let offProject = '';
let onTask = '';
let offTask = '';

async function cleanup() {
  const ids = (await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } })).map((p) => p.id);
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: 'carry-projects@mico360.test' } });
}

async function openTask(projectId: string, key: string) {
  const col = await prisma.kanbanColumn.create({ data: { projectId, name: 'To do', category: 'TODO', position: 0 } });
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'carry-projects@mico360.test' } });
  const t = await prisma.task.create({ data: { key, title: 'Open task', projectId, columnId: col.id, createdById: owner.id, boardDate: PAST } });
  mine.add(t.id);
  return t.id;
}

const boardDayOf = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id }, select: { boardDate: true } })).boardDate;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await cleanup();
  mine.clear();
  companyOn = true;
  const owner = await prisma.user.create({ data: { email: 'carry-projects@mico360.test', username: 'carry-projects', passwordHash: 'x', firstName: 'Carry', lastName: 'Projects' } });
  // A project made without the setting carries forward: that is the default for every project.
  onProject = (await prisma.project.create({ data: { code: 'CFON', name: 'Carries on', createdById: owner.id } })).id;
  offProject = (await prisma.project.create({ data: { code: 'CFOFF', name: 'Stays put', createdById: owner.id, carryForward: false } })).id;
  onTask = await openTask(onProject, 'CFON-1');
  offTask = await openTask(offProject, 'CFOFF-1');
});

describe('Carry-forward per project (integration)', () => {
  it('moves the open tasks of a project that carries forward, and leaves those of a project that doesn’t on their day', async () => {
    expect(await service.run()).toEqual({ carried: 1 });
    expect(await boardDayOf(onTask)).toEqual(TODAY);
    expect(await boardDayOf(offTask)).toEqual(PAST);
    const log = (await prisma.task.findUniqueOrThrow({ where: { id: offTask }, select: { carryForwardLog: true } })).carryForwardLog;
    expect(log).toBeNull();
  });

  it('reads the setting at each sweep: switched back on, the project’s tasks move the next night', async () => {
    await service.run();
    expect(await boardDayOf(offTask)).toEqual(PAST);
    await prisma.project.update({ where: { id: offProject }, data: { carryForward: true } });
    expect(await service.run()).toEqual({ carried: 1 });
    expect(await boardDayOf(offTask)).toEqual(TODAY);
  });

  it('moves nothing when carry-forward is off for the whole company, whatever the projects say', async () => {
    companyOn = false;
    expect(await service.run()).toEqual({ carried: 0 });
    expect(await boardDayOf(onTask)).toEqual(PAST);
    expect(await boardDayOf(offTask)).toEqual(PAST);
  });
});
