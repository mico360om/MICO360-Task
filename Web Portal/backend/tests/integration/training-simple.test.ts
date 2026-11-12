import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ZodError } from 'zod';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { HttpError } from '../../src/lib/http-errors';
import { trainingContext } from '../../src/modules/training/training-context';
import { createTrainingFileStore } from '../../src/modules/training/training-files';
import { createTrainingSync } from '../../src/modules/training/training-sync';
import { createTrainingLearner } from '../../src/modules/training/training-learner';
import { createTrainingManage } from '../../src/modules/training/training-manage';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// The Learning Hub made simple (12 Nov design, rulings R2, R3; owner answers 2 and 4): a video lesson without its
// link is hidden everywhere a learner looks (and isn't needed to finish); pasting a link shows it at once without
// "Changes not published" or counting as an edit; clearing a link or removing a lesson finishes anyone who has done
// every lesson left; a guide's saved step never points past its last step; "New staff only" when assigning (an
// onboarding rule underneath; switching it off freezes it); a project runner gets team Reports only when the team
// has assigned courses; each card says which lesson Start / Continue opens.
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const TZ = 'Asia/Muscat';

let w: CompanyWorld;
const courseIds: string[] = [];
const extraUsers: string[] = [];
const filesDir = join(mkdtempSync(join(tmpdir(), 'tsimple-')), 'training-files');
const ctx = trainingContext({
  prisma,
  files: createTrainingFileStore(filesDir),
  timeZone: TZ,
  appUrl: 'http://localhost:5173',
  notify: async () => {},
  rules: async () => ({ calendar: { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] }, step1Days: 3, step2Days: 5 }),
});
const sync = createTrainingSync(ctx);
const learner = createTrainingLearner(ctx, sync);
const manage = createTrainingManage(ctx, sync);

interface Made {
  id: string;
  lessons: Record<string, string>;
}
/** A published course made directly in the database, as an administrator would have published it. */
async function makeCourse(title: string, lessons: { key: string; kind: 'GUIDE' | 'VIDEO'; steps?: number; videoId?: string; minutes?: number }[], o: Record<string, unknown> = {}): Promise<Made> {
  const publishedAt = new Date(Date.now() - 60_000);
  const c = await prisma.trainingCourse.create({ data: { title: `${title} ${w.tag}`, moduleKey: 'general', audience: 'STAFF', difficulty: 'BEGINNER', status: 'PUBLISHED', publishedAt, ...o } as never });
  courseIds.push(c.id);
  const made: Made = { id: c.id, lessons: {} };
  for (const [i, l] of lessons.entries()) {
    const row = await prisma.trainingLesson.create({
      data: {
        courseId: c.id,
        position: i,
        kind: l.kind,
        title: l.key,
        minutes: l.minutes ?? 4,
        ...(l.videoId ? { videoProvider: 'YOUTUBE', videoId: l.videoId, videoUrl: `https://youtu.be/${l.videoId}` } : {}),
        ...(l.kind === 'GUIDE' ? { steps: { create: Array.from({ length: l.steps ?? 1 }, (_, k) => ({ position: k, title: `Step ${k + 1}`, body: `<p>${k + 1}</p>` })) } } : {}),
      },
    });
    made.lessons[l.key] = row.id;
  }
  // Published with nothing changed since (as Publish leaves it).
  await prisma.trainingLesson.updateMany({ where: { courseId: c.id }, data: { updatedAt: publishedAt } });
  await prisma.trainingCourse.update({ where: { id: c.id }, data: { updatedAt: publishedAt } });
  return made;
}
const status = async (who: keyof CompanyWorld['people'], courseId: string) => (await learner.course(w.people[who], 'staff', courseId)).mine;
const finish = async (who: keyof CompanyWorld['people'], lessonId: string) => learner.complete(w.people[who], 'staff', lessonId);
const newPerson = async (name: string) => {
  await new Promise((r) => setTimeout(r, 30));
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } });
  const u = await prisma.user.create({
    data: { email: `${name}.${w.tag}@world.test`, username: `${name}_${w.tag}`, passwordHash: 'x', firstName: name, lastName: w.tag, roles: { create: { roleId: role.id } }, primaryCompanyId: w.companies.A, companies: { create: { companyId: w.companies.A } } },
  });
  extraUsers.push(u.id);
  return u.id;
};
const isCode = (code: string) => (err: unknown) => err instanceof HttpError && err.code === code;

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
});

afterAll(async () => {
  const users = [...Object.values(w.people), ...extraUsers];
  await prisma.trainingAssignee.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingAssignment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.trainingRule.deleteMany({ where: { createdById: { in: users } } });
  await prisma.trainingProgress.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingAttempt.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingEnrolment.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingCertificate.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingCourse.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
  rmSync(filesDir, { recursive: true, force: true });
});

describe('a video lesson waiting for its link (R2)', () => {
  let c: Made;
  beforeAll(async () => {
    c = await makeCourse('Video first', [
      { key: 'Watch', kind: 'VIDEO', minutes: 2 },
      { key: 'Read one', kind: 'GUIDE', steps: 2, minutes: 5 },
      { key: 'Read two', kind: 'GUIDE', minutes: 3 },
    ]);
  });

  it('is left out of the course, its minutes and its card, and can’t be opened', async () => {
    const detail = await learner.course(w.people.ana, 'staff', c.id);
    expect(detail.lessons.map((l) => l.title)).toEqual(['Read one', 'Read two']);
    expect(detail.lessonCount).toBe(2);
    expect(detail.minutes).toBe(8);
    const card = (await learner.catalogue(w.people.ana, 'staff', {})).courses.find((x) => x.id === c.id)!;
    expect(card).toMatchObject({ lessonCount: 2, minutes: 8 });
    await expect(learner.lesson(w.people.ana, 'staff', c.lessons.Watch!)).rejects.toMatchObject({ status: 404 });
    // The first lesson opened is the first one people can see; Previous is none.
    const first = await learner.lesson(w.people.ana, 'staff', c.lessons['Read one']!);
    expect(first.prevLessonId).toBeNull();
    expect(first.lessonCount).toBe(2);
  });

  it('isn’t needed to finish', async () => {
    await finish('ana', c.lessons['Read one']!);
    const done = await finish('ana', c.lessons['Read two']!);
    expect(done.courseCompleted).toBe(true);
    expect(await status('ana', c.id)).toMatchObject({ status: 'COMPLETED', progressPct: 100 });
  });

  it('pasting the link shows it at once: no publish step, no “Changes not published”, not an edit', async () => {
    await finish('bob', c.lessons['Read one']!);
    expect(await status('bob', c.id)).toMatchObject({ status: 'IN_PROGRESS', progressPct: 50 });
    const before = await prisma.trainingLesson.findUniqueOrThrow({ where: { id: c.lessons.Watch! } });
    const lesson = await manage.updateLesson(w.people.admin, c.lessons.Watch!, { title: 'Watch', minutes: 2, body: null, videoUrl: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(lesson.video?.videoId).toBe('dQw4w9WgXcQ');
    const after = await prisma.trainingLesson.findUniqueOrThrow({ where: { id: c.lessons.Watch! } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    const course = await manage.getCourse(w.people.admin, c.id);
    expect(course.unpublishedChanges).toBe(false);
    expect((await prisma.trainingCourse.findUniqueOrThrow({ where: { id: c.id } })).updatedById).toBeNull();
    // Part-way: one more lesson (the % drops); finished: stays finished (owner answer 4).
    expect(await status('bob', c.id)).toMatchObject({ status: 'IN_PROGRESS', progressPct: 33, nextLessonId: c.lessons.Watch });
    expect((await learner.course(w.people.bob, 'staff', c.id)).lessons.map((l) => l.title)).toEqual(['Watch', 'Read one', 'Read two']);
    expect(await status('ana', c.id)).toMatchObject({ status: 'COMPLETED', progressPct: 100 });
    expect((await learner.lesson(w.people.bob, 'staff', c.lessons.Watch!)).video?.videoId).toBe('dQw4w9WgXcQ');
  });

  it('changing the title with the link is an ordinary edit (it shows as a change to publish)', async () => {
    await manage.updateLesson(w.people.admin, c.lessons.Watch!, { title: 'Watch this first' });
    expect((await manage.getCourse(w.people.admin, c.id)).unpublishedChanges).toBe(true);
    await manage.publish(w.people.admin, c.id, { change: 'MINOR' });
  });

  it('clearing the link: anyone with every other lesson done is finished (R3)', async () => {
    await finish('bob', c.lessons['Read two']!);
    expect(await status('bob', c.id)).toMatchObject({ status: 'IN_PROGRESS', progressPct: 66 });
    await manage.updateLesson(w.people.admin, c.lessons.Watch!, { videoUrl: null });
    expect(await status('bob', c.id)).toMatchObject({ status: 'COMPLETED', progressPct: 100 });
    const e = await prisma.trainingEnrolment.findFirstOrThrow({ where: { userId: w.people.bob, courseId: c.id } });
    expect(e.completedAt).not.toBeNull();
    expect(e.progressPct).toBe(100);
  });

  it('publishing needs a lesson people can see (an unlinked video alone isn’t one); an unlinked video beside a guide is fine', async () => {
    const draft = await manage.createCourse(w.people.admin, { title: `Only a video ${w.tag}`, moduleKey: 'general', audience: 'STAFF', difficulty: 'BEGINNER' });
    courseIds.push(draft.id);
    await manage.addLesson(w.people.admin, draft.id, { kind: 'VIDEO', title: 'Soon' });
    const problems = (await manage.getCourse(w.people.admin, draft.id)).publishProblems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/a lesson people can see/i);
    expect(problems.join(' ')).not.toMatch(/YouTube or Vimeo link/);
    const guide = await manage.addLesson(w.people.admin, draft.id, { kind: 'GUIDE', title: 'Read' });
    await manage.saveSteps(w.people.admin, guide.id, { steps: [{ title: 'One', body: '<p>1</p>' }] });
    expect((await manage.publish(w.people.admin, draft.id, {})).status).toBe('PUBLISHED');
  });
});

describe('finishing re-checked when a lesson goes (R3) and a guide’s step kept in range', () => {
  it('removing the last lesson someone hadn’t done finishes them', async () => {
    const c = await makeCourse('Two guides', [
      { key: 'First', kind: 'GUIDE', steps: 3 },
      { key: 'Second', kind: 'GUIDE' },
    ]);
    await finish('cat', c.lessons.First!);
    expect(await status('cat', c.id)).toMatchObject({ status: 'IN_PROGRESS', progressPct: 50 });
    await manage.deleteLesson(w.people.admin, c.lessons.Second!);
    expect(await status('cat', c.id)).toMatchObject({ status: 'COMPLETED', progressPct: 100 });
  });

  it('a guide with fewer steps: the saved step is never past the last one', async () => {
    const c = await makeCourse('Shrinking guide', [{ key: 'Long', kind: 'GUIDE', steps: 4 }]);
    await learner.saveProgress(w.people.ben, 'staff', c.lessons.Long!, { stepIndex: 3 });
    await manage.saveSteps(w.people.admin, c.lessons.Long!, { steps: [{ title: 'One', body: '<p>1</p>' }, { title: 'Two', body: '<p>2</p>' }] });
    expect((await prisma.trainingProgress.findFirstOrThrow({ where: { userId: w.people.ben, lessonId: c.lessons.Long! } })).stepIndex).toBe(1);
    // And when a row is past the end anyway (written before), the lesson opens on the last step.
    await prisma.trainingProgress.updateMany({ where: { userId: w.people.ben, lessonId: c.lessons.Long! }, data: { stepIndex: 9 } });
    expect((await learner.lesson(w.people.ben, 'staff', c.lessons.Long!)).progress.stepIndex).toBe(1);
  });
});

describe('cards say which lesson Start / Continue opens', () => {
  it('nextLessonId: the first lesson not done (the first lesson when finished or not started)', async () => {
    const c = await makeCourse('Three steps', [
      { key: 'A', kind: 'GUIDE' },
      { key: 'B', kind: 'GUIDE' },
      { key: 'C', kind: 'GUIDE' },
    ]);
    expect((await status('gus', c.id)).nextLessonId).toBe(c.lessons.A);
    await finish('gus', c.lessons.A!);
    const mine = await learner.me(w.people.gus, 'staff');
    expect([...mine.assigned, ...mine.inProgress].find((x) => x.id === c.id)!.mine.nextLessonId).toBe(c.lessons.B);
  });
});

describe('“New staff only” when assigning (owner answer 2)', () => {
  let course: Made;
  beforeAll(async () => {
    course = await makeCourse('Welcome aboard', [{ key: 'Hello', kind: 'GUIDE' }]);
  });
  const input = (o: Record<string, unknown> = {}) => ({ courseIds: [course.id], targetKind: 'COMPANY', targetId: w.companies.A, mandatory: true, dueDays: 10, newStaffOnly: true, ...o });

  it('the preview reaches nobody yet', async () => {
    expect(await manage.previewAssignment(w.people.admin, input())).toEqual({ reach: 0, already: 0, skipped: [] });
  });

  it('only for a group, a department or a company, and never with a fixed due day', async () => {
    await expect(manage.assign(w.people.admin, input({ targetKind: 'USER', targetId: w.people.ana }))).rejects.toBeInstanceOf(Error);
    await expect(manage.assign(w.people.admin, input({ targetKind: 'PROJECT', targetId: w.projects.PA }))).rejects.toBeInstanceOf(Error);
    await expect(manage.assign(w.people.admin, input({ dueDays: null, dueDay: '2099-01-01' }))).rejects.toSatisfy((e: unknown) => e instanceof ZodError || (e instanceof HttpError && e.status === 400) || (e as { status?: number }).status === 400);
  });

  it('makes an onboarding rule: nobody there now gets it, a new account does; switching it off freezes it', async () => {
    const out = await manage.assign(w.people.admin, input());
    expect(out.assignments).toHaveLength(1);
    const row = out.assignments[0]!;
    expect(row).toMatchObject({ courseId: course.id, targetKind: 'COMPANY', targetId: w.companies.A, mandatory: true, dueDays: 10, people: 0, frozen: false });
    expect(row.ruleId).toBeTruthy();
    const rule = await prisma.trainingRule.findUniqueOrThrow({ where: { id: row.ruleId! } });
    expect(rule).toMatchObject({ targetKind: 'COMPANY', targetId: w.companies.A, active: true, mandatory: true, dueDays: 10 });
    expect(rule.courseIds).toEqual([course.id]);
    expect(await prisma.trainingAssignee.count({ where: { courseId: course.id } })).toBe(0);

    // Listed in Assigned as the rule's row.
    const listed = (await manage.listAssignments(w.people.admin, { courseId: course.id })).assignments;
    expect(listed.map((a) => [a.ruleId, a.frozen])).toEqual([[row.ruleId, false]]);

    const nia = { id: await newPerson('nia') };
    await sync.all();
    expect(await prisma.trainingAssignee.count({ where: { courseId: course.id, userId: nia.id, withdrawnAt: null } })).toBe(1);

    // Switch off: the whole rule freezes; nobody new gets it, nobody loses it; it is never deleted.
    await manage.updateRule(w.people.admin, row.ruleId!, { active: false });
    expect((await manage.listAssignments(w.people.admin, { courseId: course.id })).assignments.map((a) => a.frozen)).toEqual([true]);
    const omar = { id: await newPerson('omar') };
    await sync.all();
    expect(await prisma.trainingAssignee.count({ where: { courseId: course.id, userId: omar.id } })).toBe(0);
    expect(await prisma.trainingAssignee.count({ where: { courseId: course.id, userId: nia.id, withdrawnAt: null } })).toBe(1);
    expect(await prisma.trainingRule.count({ where: { id: row.ruleId! } })).toBe(1);
    // A New staff only row is switched off, never withdrawn by itself.
    await expect(manage.withdrawAssignment(w.people.admin, row.id)).rejects.toSatisfy(isCode('RULE_ASSIGNMENT'));
  });
});

describe('Reports for a project runner (only with assigned courses in the team)', () => {
  it('no Reports tab until someone in the team has an assigned course', async () => {
    // Ben runs PB (owner); its team: Ben and Cat.
    expect((await learner.access(w.people.ben)).teamReports).toBe(false);
    const c = await makeCourse('Team course', [{ key: 'Read', kind: 'GUIDE' }]);
    await manage.assign(w.people.admin, { courseIds: [c.id], targetKind: 'USER', targetId: w.people.cat, mandatory: false });
    expect((await learner.access(w.people.ben)).teamReports).toBe(true);
  });
});
