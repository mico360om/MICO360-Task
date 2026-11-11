import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { shiftDayKey, todayKey } from '../../src/lib/due-date';
import { trainingContext } from '../../src/modules/training/training-context';
import { createTrainingFileStore } from '../../src/modules/training/training-files';
import { createTrainingSync } from '../../src/modules/training/training-sync';
import { createTrainingSweeps, REMINDERS_SINCE_KEY } from '../../src/modules/training/training-sweeps';
import { newCertificateCode } from '../../src/modules/training/training-certificates';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// Training reminders through the engine (R13) on a real database: the first run after the upgrade records
// what is due and sends nothing; then due soon once (deduped), overdue for the learner, escalation step 1
// to Reports to (else the Training managers of their companies, else administrators) and step 2 to the
// Training managers — mandatory training only; clients get nothing; certificates expiring and expired (a
// retake starts); a key is recorded before its notice goes, so a failed send is not retried and never stops
// the others; and the 15-minute membership sync (a later joiner gets it, a leaver's unfinished training is
// withdrawn, a finished course kept).
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const TZ = 'Asia/Muscat';
const T0 = todayKey(TZ);
const at = (days: number, hhmm = '10:00') => new Date(`${shiftDayKey(T0, days)}T${hhmm}:00+04:00`);
const DAY = 86_400_000;

type Notice = { userId: string; type: string; title: string; body: string | null; entityType: string | null; entityId: string | null };
const sent: Notice[] = [];
const failFor = new Set<string>();
let clockAt = at(0);

const ctx = trainingContext({
  prisma,
  files: createTrainingFileStore(join(mkdtempSync(join(tmpdir(), 'tr-')), 'training-files')),
  timeZone: TZ,
  appUrl: 'http://localhost:5173',
  now: () => clockAt,
  notify: async (n) => {
    if (failFor.has(n.userId)) throw new Error('this person’s rules could not be read');
    sent.push(n);
  },
  rules: async () => ({ calendar: { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] }, step1Days: 3, step2Days: 5 }),
});
const sync = createTrainingSync(ctx);
const sweeps = createTrainingSweeps(ctx, sync);

let w: CompanyWorld;
let clientId: string;
const courseIds: string[] = [];

const clearKeys = async () => {
  await prisma.reminderLog.deleteMany({ where: { dedupeKey: { startsWith: 'np:tr:' } } });
  await prisma.systemSetting.deleteMany({ where: { key: REMINDERS_SINCE_KEY } });
};
const run = async () => {
  sent.length = 0;
  return sweeps.reminders.run();
};
const of = (courseId: string) => sent.filter((n) => n.entityId === courseId);
const escalations = (courseId: string) => of(courseId).filter((n) => n.entityType === 'training-overdue');
const learnerNotices = (courseId: string) => of(courseId).filter((n) => n.entityType === 'training-course');

async function course(title: string, o: { audience?: 'STAFF' | 'CLIENTS'; moduleKey?: string } = {}): Promise<string> {
  const c = await prisma.trainingCourse.create({
    data: {
      title: `${title} ${w.tag}`,
      moduleKey: o.moduleKey ?? 'tasks',
      audience: o.audience ?? 'STAFF',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      lessons: { create: [{ kind: 'GUIDE', title: 'Read this', position: 0 }] },
    },
  });
  courseIds.push(c.id);
  return c.id;
}

/** A person given a course (one assignment to them), with its enrolment: the enrolment's id. */
async function assign(userId: string, courseId: string, o: { mandatory?: boolean; dueDay: string | null }): Promise<string> {
  const mandatory = o.mandatory ?? true;
  const a = await prisma.trainingAssignment.create({ data: { courseId, targetKind: 'USER', targetId: userId, mandatory, dueDay: o.dueDay, createdById: w.people.admin } });
  await prisma.trainingAssignee.create({ data: { assignmentId: a.id, userId, courseId, mandatory, dueDay: o.dueDay } });
  return (await prisma.trainingEnrolment.upsert({ where: { userId_courseId: { userId, courseId } }, create: { userId, courseId }, update: {} })).id;
}

const keyRecorded = async (key: string) => (await prisma.reminderLog.count({ where: { dedupeKey: key } })) === 1;

beforeAll(async () => {
  await clearKeys();
  w = await buildCompanyWorld(prisma);
  await prisma.user.update({ where: { id: w.people.ana }, data: { reportsToId: w.people.amy } });
  await prisma.user.update({ where: { id: w.people.cat }, data: { trainingManager: true } });
  const role = await prisma.role.upsert({ where: { name: 'CLIENT' }, create: { name: 'CLIENT' }, update: {} });
  clientId = (await prisma.user.create({ data: { email: `client.${w.tag}@world.test`, username: `client_${w.tag}`, passwordHash: 'x', firstName: 'Client', lastName: w.tag, roles: { create: { roleId: role.id } } } })).id;
});

afterAll(async () => {
  const users = [...Object.values(w.people), clientId];
  await prisma.trainingAssignee.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingAssignment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.trainingEnrolment.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingProgress.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingCertificate.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingCourse.deleteMany({ where: { id: { in: courseIds } } });
  await clearKeys();
  await prisma.user.deleteMany({ where: { id: clientId } });
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

describe('training reminders through the engine (R13)', () => {
  it('the first run after the upgrade records what is due and sends nothing', async () => {
    clockAt = at(0);
    const cBase = await course('Base');
    const e = await assign(w.people.ana, cBase, { dueDay: T0 });
    const first = await run();
    expect(first.recordedOnly).toBe(true);
    expect(first.planned).toBeGreaterThan(0);
    expect(sent).toEqual([]);
    expect(await keyRecorded(`np:tr:TRAINING_DUE_SOON:${e}:d-${T0}`)).toBe(true);
    expect(await prisma.systemSetting.count({ where: { key: REMINDERS_SINCE_KEY } })).toBe(1);
    // The next run sends nothing that was due already.
    const second = await run();
    expect(second.recordedOnly).toBe(false);
    expect(of(cBase)).toEqual([]);
  });

  it('due soon: sent once, then never again', async () => {
    const cDue = await course('Due soon');
    await assign(w.people.ana, cDue, { dueDay: shiftDayKey(T0, 1) });
    await run();
    expect(of(cDue)).toEqual([expect.objectContaining({ userId: w.people.ana, type: 'TRAINING_DUE_SOON', title: `Training due soon: Due soon ${w.tag}`, entityType: 'training-course', entityId: cDue })]);
    await run();
    expect(of(cDue)).toEqual([]);
  });

  it('overdue: the learner, then step 1 → Reports to (else the Training managers, else administrators), step 2 → the Training managers; optional never escalates', async () => {
    const due = shiftDayKey(T0, -1);
    const cAna = await course('Over Ana');
    const cAmy = await course('Over Amy');
    const cGus = await course('Over Gus');
    const cOpt = await course('Optional');
    await assign(w.people.ana, cAna, { dueDay: due });
    await assign(w.people.amy, cAmy, { dueDay: due });
    await assign(w.people.gus, cGus, { dueDay: due });
    await assign(w.people.ben, cOpt, { dueDay: due, mandatory: false });

    // 1 working day late: the learners only.
    await run();
    for (const [c, who] of [[cAna, w.people.ana], [cAmy, w.people.amy], [cGus, w.people.gus], [cOpt, w.people.ben]] as const) {
      expect(of(c)).toEqual([expect.objectContaining({ userId: who, type: 'TRAINING_OVERDUE', entityType: 'training-course', title: expect.stringMatching(/^Training overdue: /) })]);
    }

    // 3 working days late: step 1.
    clockAt = at(2);
    await run();
    expect(learnerNotices(cAna).map((n) => n.userId)).toEqual([w.people.ana]);
    // M11: Amy (Reports to, a plain employee) can't open the Learning Hub's Reports for Ana — no link on hers.
    expect(sent.filter((n) => n.userId === w.people.amy && n.title === `Overdue training: Ana Alpha ${w.tag} — Over Ana ${w.tag}`)).toEqual([
      expect.objectContaining({ type: 'TRAINING_OVERDUE', entityType: null, entityId: null }),
    ]);
    expect(escalations(cAna)).toEqual([]);
    // Amy reports to nobody: the Training manager of her company (cat, in A and B).
    expect(escalations(cAmy).map((n) => n.userId)).toEqual([w.people.cat]);
    // Gus's only company is archived: no Training manager shares one with him → administrators.
    const gusTo = escalations(cGus).map((n) => n.userId);
    expect(gusTo).toContain(w.people.admin);
    expect(await prisma.user.count({ where: { id: { in: gusTo }, roles: { some: { role: { name: 'ADMIN' } } } } })).toBe(gusTo.length);
    expect(of(cOpt).map((n) => [n.userId, n.entityType])).toEqual([[w.people.ben, 'training-course']]);

    // 8 working days late: step 2 to the Training managers (step 1 already went).
    clockAt = at(7);
    await run();
    expect(escalations(cAna).map((n) => n.userId)).toEqual([w.people.cat]);
    expect(escalations(cAmy).map((n) => n.userId)).toEqual([w.people.cat]);
    expect(escalations(cGus).map((n) => n.userId)).toContain(w.people.admin);
    expect(escalations(cOpt)).toEqual([]);
    expect(learnerNotices(cOpt)).toHaveLength(1);
    // Nothing is sent twice.
    await run();
    expect(escalations(cAna)).toEqual([]);
    expect(learnerNotices(cAna)).toEqual([]);
  });

  it('a client’s overdue training sends nothing (badges only)', async () => {
    const cClient = await course('Client', { audience: 'CLIENTS', moduleKey: 'portal' });
    await assign(clientId, cClient, { dueDay: shiftDayKey(T0, 2) });
    await run();
    expect(of(cClient)).toEqual([]);
    expect(sent.filter((n) => n.userId === clientId)).toEqual([]);
  });

  it('certificates: 7 days before expiry, and expired → the retake starts and the learner is told', async () => {
    const now = clockAt;
    const cCert = await course('Cert');
    const cOld = await course('Old cert');
    const cert = async (userId: string, courseId: string, issuedAt: Date, expiresAt: Date) => {
      await prisma.trainingEnrolment.create({ data: { userId, courseId, startedAt: issuedAt, completedAt: issuedAt, completedVersion: 1, progressPct: 100 } });
      return prisma.trainingCertificate.create({ data: { code: newCertificateCode(), userId, courseId, learnerName: 'Learner', courseTitle: 'Course', issuedAt, expiresAt } });
    };
    await cert(w.people.bob, cCert, new Date(now.getTime() - 30 * DAY), new Date(now.getTime() + 7 * DAY));
    const old = await cert(w.people.ben, cOld, new Date(now.getTime() - 400 * DAY), new Date(now.getTime() - 3_600_000));
    await run();
    expect(of(cCert)).toEqual([expect.objectContaining({ userId: w.people.bob, type: 'TRAINING_EXPIRING', title: `Certificate expires soon: Cert ${w.tag}` })]);
    expect(of(cOld)).toEqual([expect.objectContaining({ userId: w.people.ben, type: 'TRAINING_EXPIRING', title: `Certificate expired: Old cert ${w.tag}` })]);
    const e = await prisma.trainingEnrolment.findUnique({ where: { userId_courseId: { userId: w.people.ben, courseId: cOld } } });
    expect(e?.retakeFrom?.toISOString()).toBe(old.expiresAt!.toISOString());
    await run();
    expect(of(cCert)).toEqual([]);
    expect(of(cOld)).toEqual([]);
  });

  it('a key is recorded before its notice goes: a failed send is not retried and never stops the others', async () => {
    const due = shiftDayKey(ctx.today(), 1);
    const cFail = await course('Fail');
    const eAna = await assign(w.people.ana, cFail, { dueDay: due });
    await assign(w.people.amy, cFail, { dueDay: due });
    failFor.add(w.people.ana);
    try {
      await run();
    } finally {
      failFor.clear();
    }
    expect(of(cFail).map((n) => n.userId)).toEqual([w.people.amy]);
    expect(await keyRecorded(`np:tr:TRAINING_DUE_SOON:${eAna}:b2-${due}`)).toBe(true);
    await run();
    expect(of(cFail)).toEqual([]);
  });
});

describe('the 15-minute membership sync (R7)', () => {
  it('a later joiner gets a company assignment with their own due day; a leaver’s unfinished training is withdrawn, a finished one kept', async () => {
    const cMem = await course('Members');
    const a = await prisma.trainingAssignment.create({ data: { courseId: cMem, targetKind: 'COMPANY', targetId: w.companies.A, mandatory: true, dueDays: 14, createdById: w.people.admin } });
    const today = ctx.today();
    await sweeps.membership.run();
    const active = async () => (await prisma.trainingAssignee.findMany({ where: { assignmentId: a.id, withdrawnAt: null }, select: { userId: true, dueDay: true } })).sort((x, y) => x.userId.localeCompare(y.userId));
    expect((await active()).map((r) => r.userId).sort()).toEqual([w.people.ana, w.people.amy, w.people.cat].sort());
    expect((await active()).every((r) => r.dueDay === shiftDayKey(today, 14))).toBe(true);

    // Bob joins company A; Amy and Cat leave it — Cat had finished the course.
    await prisma.companyMember.create({ data: { companyId: w.companies.A, userId: w.people.bob } });
    await prisma.trainingEnrolment.update({ where: { userId_courseId: { userId: w.people.cat, courseId: cMem } }, data: { startedAt: clockAt, completedAt: clockAt, completedVersion: 1, progressPct: 100 } });
    await prisma.companyMember.delete({ where: { companyId_userId: { companyId: w.companies.A, userId: w.people.amy } } });
    await prisma.companyMember.delete({ where: { companyId_userId: { companyId: w.companies.A, userId: w.people.cat } } });
    clockAt = new Date(clockAt.getTime() + 2 * DAY);
    const res = await sweeps.membership.run();
    expect(res.added).toBeGreaterThanOrEqual(1);
    expect((await active()).map((r) => r.userId).sort()).toEqual([w.people.ana, w.people.bob].sort());
    expect((await active()).find((r) => r.userId === w.people.bob)?.dueDay).toBe(shiftDayKey(ctx.today(), 14));
    const enrolment = (userId: string) => prisma.trainingEnrolment.findUnique({ where: { userId_courseId: { userId, courseId: cMem } } });
    expect((await enrolment(w.people.bob))?.withdrawnAt).toBeNull();
    expect((await enrolment(w.people.amy))?.withdrawnAt).not.toBeNull();
    expect((await enrolment(w.people.cat))?.withdrawnAt).toBeNull();
    expect((await enrolment(w.people.cat))?.completedAt).not.toBeNull();
    expect(sent.filter((n) => n.type === 'TRAINING_ASSIGNED' && n.userId === w.people.bob)).toHaveLength(1);
  });
});
