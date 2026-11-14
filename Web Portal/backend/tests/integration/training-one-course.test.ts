import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { testPrisma } from './test-prisma';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shiftDay } from '../../src/lib/working-days';
import { createOneCourseConversion, type OneCourseDeps, type OneCourseRecord } from '../../src/modules/training/training-one-course';
import { applyStarterLessons, createTrainingStarter, LAUNCHED_KEY, normalizeStarterCourse, STARTER_LOADED_KEY, STARTER_REVISION_KEY, untouchedStarter } from '../../src/modules/training/training-starter';
import { trainingContext } from '../../src/modules/training/training-context';
import { createTrainingFileStore } from '../../src/modules/training/training-files';
import { createTrainingSync } from '../../src/modules/training/training-sync';
import { COURSE, createTrainingFinish } from '../../src/modules/training/training-finish';
import { createTrainingLearner } from '../../src/modules/training/training-learner';
import { createTrainingSweeps, REMINDERS_SINCE_KEY } from '../../src/modules/training/training-sweeps';
import { loadState } from '../../src/modules/training/training-read';
import { stringList } from '../../src/modules/training/prisma-training-store';
import type { StarterCourse, StarterLesson } from '../../src/modules/training/starter/starter-types';

// Requires a running MySQL / MariaDB (TEST_DATABASE_URL) with migrations applied.
// The one-time conversion (1.23.31): the built-in short courses become one course with modules. Untouched short
// courses move in with their lesson ids (progress, attempts, pictures follow) and are archived; an edited one stays
// as it is (its completions up to the change count, its assignments move: C1); a removed one gives a module that is
// switched off (C2); finished short courses are kept as modules done; people with every visible module done are
// finished quietly with a certificate dated their last completion; assignments and rules move with the D2 dates and
// no notice; the client guide gives its certificate (C3); one bell row per enrolled staff member; a second start
// changes nothing and a half-way failure finishes on the next start. Every key is this file's own (tagged).
const url = process.env.TEST_DATABASE_URL!;
const prisma = testPrisma(url);
const TZ = 'Asia/Muscat';
/** The change: 20 Nov 2026, 10:00 in Muscat. */
const NOW = new Date('2026-11-20T06:00:00.000Z');
const TODAY = '2026-11-20';
const day = (n: number) => shiftDay(TODAY, n);
const T = (iso: string) => new Date(iso);

// A tiny WebP (RIFF....WEBP): the loader checks pictures like uploads.
const webp = (fill: number) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(14, fill)]);
const assets = mkdtempSync(join(tmpdir(), 'one-course-assets-'));
const privateDir = join(mkdtempSync(join(tmpdir(), 'one-course-private-')), 'training-files');
const files = createTrainingFileStore(privateDir);

let clockAt = NOW;
type Notice = { userId: string; type: string; title: string; body: string | null; entityType: string | null; entityId: string | null };
const notices: Notice[] = [];
const logs: { level: 'info' | 'warn'; msg: string; meta?: Record<string, unknown> }[] = [];
const ctx = trainingContext({
  prisma,
  files,
  timeZone: TZ,
  appUrl: 'http://localhost:5173',
  now: () => clockAt,
  notify: async (n) => {
    notices.push(n);
  },
  rules: async () => ({ calendar: { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] }, step1Days: 3, step2Days: 5 }),
  logger: {
    info: (msg, meta) => void logs.push({ level: 'info', msg, ...(meta ? { meta } : {}) }),
    warn: (msg, meta) => void logs.push({ level: 'warn', msg, ...(meta ? { meta } : {}) }),
  },
});
const sync = createTrainingSync(ctx);
const finish = createTrainingFinish(ctx);

// ── The tagged content: three short courses (revision 2) and the combined course they become ──

const g = (title: string, steps: string[], module?: string, image?: string): StarterLesson => ({
  kind: 'GUIDE',
  title,
  minutes: 3,
  ...(module ? { module } : {}),
  steps: steps.map((t, i) => ({ title: t, body: `<p>${t}.</p>`, ...(i === 0 && image ? { image, alt: `A picture for ${t}` } : {}) })),
});
const v = (title: string, module?: string): StarterLesson => ({ kind: 'VIDEO', title, minutes: 2, videoUrl: null, ...(module ? { module } : {}) });
const qz = (title: string, prompts: string[], module?: string): StarterLesson => ({
  kind: 'QUIZ',
  title,
  minutes: 2,
  ...(module ? { module } : {}),
  quiz: { passMark: 70, maxAttempts: null, shuffle: true, timeLimitMinutes: null, drawCount: null, questions: prompts.map((p) => ({ kind: 'SINGLE', prompt: p, explanation: 'So.', options: [{ text: 'Yes', correct: true }, { text: 'No', correct: false }] })) },
});
const courseOf = (key: string, title: string, lessons: StarterLesson[], o: Partial<StarterCourse> = {}): StarterCourse => ({
  key,
  title,
  summary: 'Short.',
  moduleKey: 'general',
  audience: 'STAFF',
  difficulty: 'BEGINNER',
  status: 'PUBLISHED',
  completionRule: 'ALL_LESSONS',
  certificateOn: false,
  certificateMonths: null,
  lessons,
  ...o,
});

type ShortName = 'a' | 'b' | 'c';
type ShortState = 'untouched' | 'edited' | 'archived' | 'missing';
type PersonName = 'emp' | 'emp2' | 'admin' | 'client' | 'gone' | 'wd' | 'old';

interface World {
  tag: string;
  keys: { one: string; a: string; b: string; c: string; portal: string; record: string; extra: string };
  content: { a: StarterCourse; b: StarterCourse; c: StarterCourse; one: StarterCourse; portal: StarterCourse };
  company: string;
  dept: string;
  people: Record<PersonName, string>;
  /** Short course ids (null: not on the site). */
  short: Record<ShortName, string | null>;
  portal: string;
  extra: string;
  /** `${short}:${lesson title}` → lesson id, as loaded. */
  lessons: Map<string, string>;
  ruleIds: string[];
}

function contentFor(tag: string) {
  const keys = {
    one: `starter:t1c-${tag}-one`,
    a: `starter:t1c-${tag}-a`,
    b: `starter:t1c-${tag}-b`,
    c: `starter:t1c-${tag}-c`,
    portal: `starter:t1c-${tag}-portal`,
    record: `training.oneCourse.t1c-${tag}`,
    extra: `starter:t1c-${tag}-extra`,
  };
  const a = courseOf(keys.a, `Tasks basics ${tag}`, [v('Video: A'), g('A guide', ['A1', 'A2', 'A3'], undefined, 'pic-a.webp'), g('A duplicate', ['D1']), qz('Quiz: A', ['Where are your tasks?', 'Who sees them?'])], { moduleKey: 'tasks' });
  const b = courseOf(keys.b, `Board basics ${tag}`, [v('Video: B'), g('B guide', ['B1', 'B2'], undefined, 'pic-b.webp')], { moduleKey: 'board' });
  const c = courseOf(keys.c, `Reports basics ${tag}`, [v('Video: C'), g('C guide', ['C1'])], { moduleKey: 'reports' });
  const one = courseOf(
    keys.one,
    `One course ${tag}`,
    [
      v('Video: A', 'module:a'),
      g('A guide', ['A1', 'A2', 'A3'], 'module:a', 'pic-a.webp'),
      g('A new guide', ['N1'], 'module:a', 'pic-new.webp'),
      qz('Quiz: A', ['Where are your tasks?', 'Who sees them?'], 'module:a'),
      v('Video: B', 'module:b'),
      g('B guide', ['B1', 'B2'], 'module:b', 'pic-b.webp'),
      v('Video: C', 'module:c'),
      g('C guide', ['C1'], 'module:c'),
    ],
    {
      summary: 'All of it.',
      position: -1,
      certificateOn: true,
      modules: [
        { key: 'module:a', title: 'Tasks', moduleKey: 'tasks', from: keys.a },
        { key: 'module:b', title: 'Kanban board', moduleKey: 'board', from: keys.b },
        { key: 'module:c', title: 'Reports', moduleKey: 'reports', roleKeys: ['admins'], from: keys.c },
      ],
    },
  );
  const portal = courseOf(keys.portal, `Client guide ${tag}`, [v('Video: Client'), g('Client guide', ['P1'])], { audience: 'CLIENTS', moduleKey: 'portal' });
  return { keys, content: { a, b, c, one, portal } };
}

const PAST = T('2026-09-01T00:00:00.000Z');
const worlds: World[] = [];

/** A built-in course as 1.23.27 loaded it (pictures in the private folder, everything stamped as published). */
async function loadShort(course: StarterCourse, at = PAST): Promise<string> {
  const n = normalizeStarterCourse(course, () => {});
  const c = await prisma.trainingCourse.create({
    data: { title: n.title, summary: n.summary, moduleKey: n.moduleKey, audience: n.audience, difficulty: n.difficulty, status: 'PUBLISHED', completionRule: n.completionRule, certificateOn: n.certificateOn, version: 1, starterKey: n.key, publishedAt: at },
  });
  const fileIds = new Map<string, string>();
  for (const l of n.lessons) {
    if (l.kind !== 'GUIDE') continue;
    for (const st of l.steps) {
      if (!st.image || fileIds.has(st.image)) continue;
      const bytes = webp(st.image === 'pic-a.webp' ? 1 : st.image === 'pic-b.webp' ? 2 : 3);
      const storageKey = await files.save(bytes, 'image/webp');
      fileIds.set(st.image, (await prisma.trainingFile.create({ data: { courseId: c.id, kind: 'IMAGE', name: st.image, mimeType: 'image/webp', sizeBytes: bytes.length, storageKey, starter: true } })).id);
    }
  }
  await prisma.$transaction((tx) => applyStarterLessons(tx, c.id, n, [], fileIds, at));
  await prisma.trainingCourse.update({ where: { id: c.id }, data: { updatedAt: at } });
  return c.id;
}

async function role(name: string): Promise<string> {
  return (await prisma.role.upsert({ where: { name }, update: {}, create: { name } })).id;
}

async function buildWorld(o: { a?: ShortState; b?: ShortState; c?: ShortState; portal?: 'untouched' | 'edited' } = {}): Promise<World> {
  const tag = randomBytes(3).toString('hex');
  const { keys, content } = contentFor(tag);
  const company = (await prisma.company.create({ data: { name: `One course co ${tag}`, code: `OC${tag.toUpperCase()}` } })).id;
  const dept = (await prisma.department.create({ data: { name: `One course dept ${tag}` } })).id;
  const roles = { ADMIN: await role('ADMIN'), EMPLOYEE: await role('EMPLOYEE'), CLIENT: await role('CLIENT') };
  const person = async (name: PersonName, r: keyof typeof roles, extra: { status?: 'ACTIVE' | 'INACTIVE'; createdAt?: Date } = {}) =>
    (
      await prisma.user.create({
        data: {
          email: `${name}.${tag}@one-course.test`,
          username: `${name}_t1c_${tag}`,
          passwordHash: 'x',
          firstName: name,
          lastName: `T1c ${tag}`,
          roles: { create: { roleId: roles[r] } },
          ...(r === 'CLIENT' ? {} : { departmentId: dept, primaryCompanyId: company, companies: { create: [{ companyId: company }] } }),
          ...extra,
        },
      })
    ).id;
  const people: Record<PersonName, string> = {
    emp: await person('emp', 'EMPLOYEE'),
    emp2: await person('emp2', 'EMPLOYEE'),
    admin: await person('admin', 'ADMIN'),
    client: await person('client', 'CLIENT'),
    gone: await person('gone', 'EMPLOYEE', { status: 'INACTIVE' }),
    wd: await person('wd', 'EMPLOYEE'),
    old: await person('old', 'EMPLOYEE', { createdAt: T('2026-08-01T00:00:00.000Z') }),
  };
  const short: Record<ShortName, string | null> = { a: null, b: null, c: null };
  const lessons = new Map<string, string>();
  for (const name of ['a', 'b', 'c'] as const) {
    const state = o[name] ?? 'untouched';
    if (state === 'missing') continue;
    const id = await loadShort(content[name]);
    short[name] = id;
    for (const l of await prisma.trainingLesson.findMany({ where: { courseId: id } })) lessons.set(`${name}:${l.title}`, l.id);
    if (state === 'edited') {
      // An administrator renamed a lesson and published the change.
      const guide = lessons.get(`${name}:${name.toUpperCase()} guide`)!;
      await prisma.trainingLesson.update({ where: { id: guide }, data: { title: `${name.toUpperCase()} guide (ours)`, updatedAt: T('2026-10-15T00:00:00.000Z') } });
      await prisma.trainingCourse.update({ where: { id }, data: { updatedById: people.admin, version: 2, publishedAt: T('2026-10-15T00:00:00.000Z') } });
    }
    if (state === 'archived') await prisma.trainingCourse.update({ where: { id }, data: { status: 'ARCHIVED' } });
  }
  const portal = await loadShort(content.portal);
  if (o.portal === 'edited') await prisma.trainingCourse.update({ where: { id: portal }, data: { updatedById: people.admin, version: 2 } });
  // An administrator's own course (never touched by the conversion).
  const extra = (await prisma.trainingCourse.create({ data: { title: `Acme site safety ${tag}`, moduleKey: 'general', audience: 'STAFF', status: 'PUBLISHED', publishedAt: PAST, starterKey: keys.extra, lessons: { create: [{ kind: 'GUIDE', title: 'Safety', position: 0 }] } } })).id;
  const w: World = { tag, keys, content, company, dept, people, short, portal, extra, lessons, ruleIds: [] };
  worlds.push(w);
  return w;
}

async function dropWorld(w: World): Promise<void> {
  const ids = (await prisma.trainingCourse.findMany({ where: { starterKey: { in: Object.values(w.keys) } }, select: { id: true } })).map((c) => c.id);
  const userIds = Object.values(w.people);
  const where = { OR: [{ courseId: { in: ids } }, { userId: { in: userIds } }] };
  await prisma.trainingModuleDone.deleteMany({ where });
  await prisma.trainingCertificate.deleteMany({ where });
  await prisma.trainingAttempt.deleteMany({ where });
  await prisma.trainingProgress.deleteMany({ where });
  await prisma.trainingEnrolment.deleteMany({ where });
  await prisma.trainingAssignee.deleteMany({ where });
  await prisma.trainingAssignment.deleteMany({ where: { courseId: { in: ids } } });
  await prisma.trainingFeedback.deleteMany({ where });
  await prisma.trainingRule.deleteMany({ where: { id: { in: w.ruleIds } } });
  await prisma.trainingFile.deleteMany({ where: { courseId: { in: ids } } });
  await prisma.trainingCourse.deleteMany({ where: { id: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.companyMember.deleteMany({ where: { companyId: w.company } });
  await prisma.company.deleteMany({ where: { id: w.company } });
  await prisma.department.deleteMany({ where: { id: w.dept } });
  await prisma.systemSetting.deleteMany({ where: { key: w.keys.record } });
}

const conversion = (w: World, o: Partial<OneCourseDeps> = {}) =>
  createOneCourseConversion({
    prisma,
    files,
    ctx,
    finish,
    sync,
    content: w.content.one,
    portalKey: w.keys.portal,
    shortCourses: [
      { courseKey: w.keys.a, module: 'module:a' },
      { courseKey: w.keys.b, module: 'module:b' },
      { courseKey: w.keys.c, module: 'module:c' },
    ],
    assetsDir: assets,
    recordKey: w.keys.record,
    loadedKeys: async () => [w.keys.a, w.keys.b, w.keys.c, w.keys.portal],
    ...o,
  });

// ── History helpers (what people did on 1.23.27) ──

const lessonOf = (w: World, short: ShortName, title: string) => w.lessons.get(`${short}:${title}`)!;
const shortId = (w: World, s: ShortName) => w.short[s]!;
/** The lessons a learner sees on a short course (videos wait for their link). */
const seen = (w: World, s: ShortName) => [...w.lessons.entries()].filter(([k]) => k.startsWith(`${s}:`) && !k.startsWith(`${s}:Video`)).map(([, id]) => id);

async function enrol(w: World, who: PersonName, s: ShortName | 'portal', o: { startedAt?: Date; completedAt?: Date | null; lastLessonId?: string | null; lastActivityAt?: Date | null; selfStarted?: boolean; withdrawnAt?: Date | null } = {}) {
  const courseId = s === 'portal' ? w.portal : shortId(w, s);
  return prisma.trainingEnrolment.create({
    data: {
      userId: w.people[who],
      courseId,
      startedAt: o.startedAt ?? T('2026-09-20T08:00:00.000Z'),
      createdAt: o.startedAt ?? T('2026-09-20T08:00:00.000Z'),
      completedAt: o.completedAt ?? null,
      completedVersion: o.completedAt ? 1 : null,
      progressPct: o.completedAt ? 100 : 0,
      lastLessonId: o.lastLessonId ?? null,
      lastActivityAt: o.lastActivityAt ?? o.completedAt ?? null,
      selfStarted: o.selfStarted ?? true,
      withdrawnAt: o.withdrawnAt ?? null,
    },
  });
}

/** Finished a short course on `at`: every lesson done (the quiz passed after one failed try). */
async function finished(w: World, who: PersonName, s: ShortName, at: Date) {
  const userId = w.people[who];
  const courseId = shortId(w, s);
  await enrol(w, who, s, { completedAt: at, startedAt: new Date(at.getTime() - 86_400_000) });
  for (const lessonId of seen(w, s)) {
    await prisma.trainingProgress.create({ data: { userId, courseId, lessonId, doneAt: new Date(at.getTime() - 60_000), stepIndex: 0 } });
    const quiz = await prisma.trainingQuiz.findUnique({ where: { lessonId } });
    if (quiz) {
      await prisma.trainingAttempt.create({ data: { userId, courseId, lessonId, quizId: quiz.id, paper: { questions: [] }, startedAt: new Date(at.getTime() - 7_200_000), submittedAt: new Date(at.getTime() - 7_000_000), scorePct: 50, passed: false } });
      await prisma.trainingAttempt.create({ data: { userId, courseId, lessonId, quizId: quiz.id, paper: { questions: [] }, startedAt: new Date(at.getTime() - 3_600_000), submittedAt: new Date(at.getTime() - 120_000), scorePct: 100, passed: true } });
    }
  }
}

const combined = (w: World) => prisma.trainingCourse.findUniqueOrThrow({ where: { starterKey: w.keys.one }, include: { modules: { orderBy: { position: 'asc' } }, lessons: { orderBy: { position: 'asc' }, include: { steps: { orderBy: { position: 'asc' } }, quiz: { include: { questions: true } } } } } });
const record = async (w: World) => (await prisma.systemSetting.findUnique({ where: { key: w.keys.record } }))?.value as OneCourseRecord | undefined;
const moduleId = async (w: World, key: string) => (await prisma.trainingModule.findFirstOrThrow({ where: { course: { starterKey: w.keys.one }, starterKey: key } })).id;
const mine = (w: World) => notices.filter((n) => Object.values(w.people).includes(n.userId));

beforeAll(() => {
  writeFileSync(join(assets, 'pic-a.webp'), webp(1));
  writeFileSync(join(assets, 'pic-b.webp'), webp(2));
  writeFileSync(join(assets, 'pic-new.webp'), webp(4));
});

afterAll(async () => {
  for (const w of worlds) await dropWorld(w);
  rmSync(assets, { recursive: true, force: true });
  rmSync(privateDir, { recursive: true, force: true });
  await prisma.$disconnect();
});

// ── The usual site: three untouched short courses, the client guide untouched ──

describe('one-course conversion: an untouched site', () => {
  let w: World;
  let before: { aLessons: { id: string; title: string }[]; aFiles: { id: string; name: string }[]; questions: string[]; emp2Progress: string; empAttempts: string[]; empOldCert: string };
  let out: { courseId: string } | null;

  beforeAll(async () => {
    clockAt = NOW;
    w = await buildWorld();
    // emp finished Tasks (1 Oct) and the board (5 Oct): every module an employee sees.
    await finished(w, 'emp', 'a', T('2026-10-01T08:00:00.000Z'));
    await finished(w, 'emp', 'b', T('2026-10-05T08:00:00.000Z'));
    const empOldCert = (await prisma.trainingCertificate.create({ data: { code: `T1C${w.tag.toUpperCase()}A`, userId: w.people.emp, courseId: shortId(w, 'a'), learnerName: 'emp', courseTitle: 'Tasks basics', issuedAt: T('2026-10-01T08:00:00.000Z') } })).id;
    // emp2 is part-way through the Tasks guide (step 2 of 3).
    await enrol(w, 'emp2', 'a', { lastLessonId: lessonOf(w, 'a', 'A guide'), lastActivityAt: T('2026-11-01T08:00:00.000Z'), selfStarted: false });
    const emp2Progress = (await prisma.trainingProgress.create({ data: { userId: w.people.emp2, courseId: shortId(w, 'a'), lessonId: lessonOf(w, 'a', 'A guide'), stepIndex: 1 } })).id;
    // admin finished Tasks and the board but not Reports (an administrator sees it).
    await finished(w, 'admin', 'a', T('2026-10-02T08:00:00.000Z'));
    await finished(w, 'admin', 'b', T('2026-10-03T08:00:00.000Z'));
    await enrol(w, 'admin', 'c', { startedAt: T('2026-10-04T08:00:00.000Z') });
    // An inactive account part-way; someone whose only enrolment was withdrawn.
    await enrol(w, 'gone', 'a');
    await enrol(w, 'wd', 'b', { withdrawnAt: T('2026-10-20T08:00:00.000Z'), selfStarted: false });
    // The client finished the client guide.
    await enrol(w, 'client', 'portal', { completedAt: T('2026-10-10T08:00:00.000Z') });
    // A question about a Tasks lesson moves with it; a rating stays with the old course.
    await prisma.trainingFeedback.create({ data: { courseId: shortId(w, 'a'), lessonId: lessonOf(w, 'a', 'A guide'), userId: w.people.emp2, kind: 'QUESTION', body: 'How?' } });
    await prisma.trainingFeedback.create({ data: { courseId: shortId(w, 'a'), userId: w.people.emp, kind: 'RATING', rating: 5, status: 'ANSWERED' } });

    before = {
      aLessons: (await prisma.trainingLesson.findMany({ where: { courseId: shortId(w, 'a') }, select: { id: true, title: true } })),
      aFiles: (await prisma.trainingFile.findMany({ where: { courseId: shortId(w, 'a') }, select: { id: true, name: true } })),
      questions: (await prisma.trainingQuestion.findMany({ where: { quiz: { lessonId: lessonOf(w, 'a', 'Quiz: A') } }, select: { id: true } })).map((q) => q.id),
      emp2Progress,
      empAttempts: (await prisma.trainingAttempt.findMany({ where: { userId: w.people.emp }, select: { id: true } })).map((a) => a.id),
      empOldCert,
    };
    notices.length = 0;
    out = await conversion(w).run();
  });

  it('untouched short courses move with their ids: lessons, progress, attempts and pictures follow; the old courses are archived and empty; the record says where everything went', async () => {
    const c = await combined(w);
    expect(out).toEqual({ courseId: c.id });
    expect(c).toMatchObject({ title: `One course ${w.tag}`, status: 'PUBLISHED', version: 1, audience: 'STAFF', certificateOn: true, certificateMonths: null, position: -1, updatedById: null, createdById: null });
    expect(c.publishedAt?.toISOString()).toBe(NOW.toISOString());
    // Published with nothing changed since (the built-in update and Manage both read it so).
    expect(c.updatedAt.toISOString()).toBe(NOW.toISOString());
    expect(untouchedStarter(c, c.lessons)).toBe(true);
    for (const m of c.modules) expect(m.updatedAt.getTime()).toBeLessThanOrEqual(NOW.getTime());

    expect(c.modules.map((m) => [m.starterKey, m.title, m.enabled, m.offReason, m.fromCourseId])).toEqual([
      ['module:a', 'Tasks', true, null, shortId(w, 'a')],
      ['module:b', 'Kanban board', true, null, shortId(w, 'b')],
      ['module:c', 'Reports', true, null, shortId(w, 'c')],
    ]);
    const [ma, mb, mc] = c.modules.map((m) => m.id);
    expect(c.lessons.map((l) => [l.title, l.moduleId])).toEqual([
      ['Video: A', ma],
      ['A guide', ma],
      ['A new guide', ma],
      ['Quiz: A', ma],
      ['Video: B', mb],
      ['B guide', mb],
      ['Video: C', mc],
      ['C guide', mc],
    ]);
    // The same lesson rows (ids), now in the course.
    for (const t of ['Video: A', 'A guide', 'Quiz: A']) expect(c.lessons.find((l) => l.title === t)!.id, t).toBe(lessonOf(w, 'a', t));
    for (const t of ['Video: B', 'B guide']) expect(c.lessons.find((l) => l.title === t)!.id, t).toBe(lessonOf(w, 'b', t));
    expect(c.lessons.find((l) => l.title === 'C guide')!.id).toBe(lessonOf(w, 'c', 'C guide'));
    // The quiz keeps its question rows (attempts keep their own copy anyway).
    expect(c.lessons.find((l) => l.title === 'Quiz: A')!.quiz!.questions.map((q) => q.id).sort()).toEqual([...before.questions].sort());

    // The duplicate lesson is gone; the record sends its old link to its module.
    const dup = before.aLessons.find((l) => l.title === 'A duplicate')!.id;
    expect(await prisma.trainingLesson.count({ where: { id: dup } })).toBe(0);
    const r = (await record(w))!;
    expect(r).toMatchObject({ phase: 'done', courseId: c.id, notMerged: [], at: NOW.toISOString() });
    expect(r.removedLessons).toEqual({ [dup]: { courseId: c.id, moduleId: ma } });
    expect(r.moved).toEqual({ [shortId(w, 'a')]: { courseId: c.id, moduleId: ma }, [shortId(w, 'b')]: { courseId: c.id, moduleId: mb }, [shortId(w, 'c')]: { courseId: c.id, moduleId: mc } });

    // The old courses: archived, nothing left in them, their starter keys kept.
    for (const s of ['a', 'b', 'c'] as const) {
      const old = await prisma.trainingCourse.findUniqueOrThrow({ where: { id: shortId(w, s) }, include: { lessons: true } });
      expect(old.status, s).toBe('ARCHIVED');
      expect(old.lessons, s).toEqual([]);
      expect(old.starterKey).toBe(w.keys[s]);
    }
    // Progress, attempts and the question followed; the rating stays with the old course.
    expect(await prisma.trainingProgress.findUniqueOrThrow({ where: { id: before.emp2Progress } })).toMatchObject({ courseId: c.id, stepIndex: 1, doneAt: null, lessonId: lessonOf(w, 'a', 'A guide') });
    expect(await prisma.trainingProgress.count({ where: { courseId: { in: [shortId(w, 'a'), shortId(w, 'b'), shortId(w, 'c')] } } })).toBe(0);
    expect((await prisma.trainingAttempt.findMany({ where: { id: { in: before.empAttempts } } })).map((a) => a.courseId)).toEqual(before.empAttempts.map(() => c.id));
    expect((await prisma.trainingFeedback.findMany({ where: { userId: { in: [w.people.emp, w.people.emp2] } }, orderBy: { kind: 'asc' } })).map((f) => [f.kind, f.courseId])).toEqual([
      ['QUESTION', c.id],
      ['RATING', shortId(w, 'a')],
    ]);
    // The Tasks picture is the same file row (moved), the new lesson's picture copied in; each step shows its picture.
    const picA = before.aFiles.find((f) => f.name === 'pic-a.webp')!.id;
    expect(c.lessons.find((l) => l.title === 'A guide')!.steps[0]!.imageFileId).toBe(picA);
    expect((await prisma.trainingFile.findUniqueOrThrow({ where: { id: picA } })).courseId).toBe(c.id);
    const fresh = c.lessons.find((l) => l.title === 'A new guide')!.steps[0]!.imageFileId!;
    const freshRow = await prisma.trainingFile.findUniqueOrThrow({ where: { id: fresh } });
    expect(freshRow).toMatchObject({ courseId: c.id, starter: true, name: 'pic-new.webp' });
    expect((await files.read(freshRow.storageKey)).equals(webp(4))).toBe(true);
    expect(c.lessons.find((l) => l.title === 'B guide')!.steps[0]!.imageFileId).not.toBeNull();
  });

  it('finished training is kept: a short course finished is its module done on that day (even with a lesson added), a lesson part-way keeps its step, quiz attempts count under the course', async () => {
    const c = await combined(w);
    const ma = await moduleId(w, 'module:a');
    expect(await prisma.trainingModuleDone.findMany({ where: { userId: w.people.emp, courseId: c.id }, orderBy: { doneAt: 'asc' }, select: { moduleId: true, doneAt: true, via: true } })).toEqual([
      { moduleId: ma, doneAt: T('2026-10-01T08:00:00.000Z'), via: 'CONVERTED' },
      { moduleId: await moduleId(w, 'module:b'), doneAt: T('2026-10-05T08:00:00.000Z'), via: 'CONVERTED' },
    ]);
    const emp = await loadState(ctx, w.people.emp, c.id);
    const unitA = emp.units.find((u) => u.unitId === ma)!;
    // "A new guide" was never done, yet the module stays done.
    expect(unitA).toMatchObject({ status: 'DONE', doneAt: T('2026-10-01T08:00:00.000Z') });
    expect(emp.done.has(c.lessons.find((l) => l.title === 'A new guide')!.id)).toBe(false);
    const quiz = c.lessons.find((l) => l.title === 'Quiz: A')!.id;
    expect(emp.attemptsUsed.get(quiz)).toBe(2);
    expect(emp.best.get(quiz)).toEqual({ scorePct: 100, passed: true });
    // emp2: In progress, Continue at the Tasks guide where they stopped.
    const emp2 = await loadState(ctx, w.people.emp2, c.id);
    expect(emp2.state.status).toBe('IN_PROGRESS');
    expect(emp2.continueAt).toEqual({ unitId: ma, lessonId: lessonOf(w, 'a', 'A guide') });
    expect(emp2.enrolment).toMatchObject({ lastLessonId: lessonOf(w, 'a', 'A guide'), lastActivityAt: T('2026-11-01T08:00:00.000Z'), selfStarted: false, startedAt: T('2026-09-20T08:00:00.000Z'), createdAt: T('2026-09-20T08:00:00.000Z'), withdrawnAt: null });
    // The certificate of the old course stays valid.
    expect(await prisma.trainingCertificate.findUniqueOrThrow({ where: { id: before.empOldCert } })).toMatchObject({ revokedAt: null, courseId: shortId(w, 'a') });
    // The merged courses' enrolments are hidden (rows kept, finished ones too).
    const old = await prisma.trainingEnrolment.findMany({ where: { courseId: { in: [shortId(w, 'a'), shortId(w, 'b'), shortId(w, 'c')] } } });
    expect(old.length).toBeGreaterThan(0);
    for (const e of old) expect(e.withdrawnAt).not.toBeNull();
    expect(old.filter((e) => e.userId === w.people.emp).map((e) => e.completedAt?.toISOString()).sort()).toEqual(['2026-10-01T08:00:00.000Z', '2026-10-05T08:00:00.000Z']);
  });

  it('people whose visible modules are all done are finished, dated their last completion, with a certificate — quietly', async () => {
    const c = await combined(w);
    const emp = await prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId: w.people.emp, courseId: c.id } } });
    expect(emp).toMatchObject({ completedAt: T('2026-10-05T08:00:00.000Z'), progressPct: 100, completedVersion: 1 });
    const certs = await prisma.trainingCertificate.findMany({ where: { userId: w.people.emp, courseId: c.id } });
    expect(certs).toHaveLength(1);
    expect(certs[0]).toMatchObject({ courseTitle: `One course ${w.tag}`, completedAt: T('2026-10-05T08:00:00.000Z'), revokedAt: null, expiresAt: null });
    expect(stringList(certs[0]!.moduleIds).sort()).toEqual([await moduleId(w, 'module:a'), await moduleId(w, 'module:b')].sort());
    // The administrator also sees Reports, which they never finished: not finished, no certificate.
    const admin = await loadState(ctx, w.people.admin, c.id);
    expect(admin.state.status).toBe('IN_PROGRESS');
    expect(admin.units.map((u) => u.status)).toEqual(['DONE', 'DONE', 'NOT_STARTED']);
    expect(admin.enrolment!.progressPct).toBe(66);
    expect(await prisma.trainingCertificate.count({ where: { userId: w.people.admin, courseId: c.id } })).toBe(0);
    // No notice of any kind went through the notification service.
    expect(notices).toEqual([]);
  });

  it('the client guide (C3, untouched): its certificate is switched on without counting as an edit, and a client who finished it gets one dated then, quietly', async () => {
    const p = await prisma.trainingCourse.findUniqueOrThrow({ where: { id: w.portal }, include: { lessons: true } });
    expect(p.certificateOn).toBe(true);
    expect(untouchedStarter(p, p.lessons)).toBe(true);
    expect(p.updatedAt.toISOString()).toBe(PAST.toISOString());
    const certs = await prisma.trainingCertificate.findMany({ where: { userId: w.people.client } });
    expect(certs).toHaveLength(1);
    expect(certs[0]).toMatchObject({ courseId: w.portal, completedAt: T('2026-10-10T08:00:00.000Z'), revokedAt: null });
    expect(notices).toEqual([]);
  });

  it('one bell-only notice per active staff member enrolled on the course, written once', async () => {
    const c = await combined(w);
    const rows = await prisma.notification.findMany({ where: { entityType: 'training-course', entityId: c.id } });
    expect(rows.map((n) => n.userId).sort()).toEqual([w.people.emp, w.people.emp2, w.people.admin].sort());
    for (const n of rows) expect(n).toMatchObject({ type: 'TRAINING_ASSIGNED', title: `Your training is now one course: One course ${w.tag}`, body: 'Open it from My learning in the Learning Hub.', projectId: null, readAt: null });
    // The inactive account and the withdrawn one: enrolled (kept), no notice.
    const gone = await prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId: w.people.gone, courseId: c.id } } });
    expect(gone.withdrawnAt).toBeNull();
    const wd = await prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId: w.people.wd, courseId: c.id } } });
    expect(wd.withdrawnAt).not.toBeNull();
    expect((await record(w))!.noticesAt).not.toBeNull();
  });

  it('a second start changes nothing', async () => {
    const snap = () => rawSnapshot(w);
    const first = await snap();
    clockAt = new Date(NOW.getTime() + 3_600_000);
    try {
      expect(await conversion(w).run()).toEqual(out);
      expect(await conversion(w).run()).toEqual(out);
    } finally {
      clockAt = NOW;
    }
    expect(await snap()).toEqual(first);
    expect(notices).toEqual([]);
  });
});

/** Every row the conversion touches for the world, with its stamps. */
async function rawSnapshot(w: World) {
  const ids = (await prisma.trainingCourse.findMany({ where: { starterKey: { in: Object.values(w.keys) } }, select: { id: true } })).map((c) => c.id);
  const userIds = Object.values(w.people);
  const by = { orderBy: { id: 'asc' as const } };
  return {
    courses: await prisma.trainingCourse.findMany({ where: { id: { in: ids } }, ...by }),
    lessons: await prisma.trainingLesson.findMany({ where: { courseId: { in: ids } }, ...by }),
    steps: await prisma.trainingStep.findMany({ where: { lesson: { courseId: { in: ids } } }, ...by }),
    modules: await prisma.trainingModule.findMany({ where: { courseId: { in: ids } }, ...by }),
    files: await prisma.trainingFile.findMany({ where: { courseId: { in: ids } }, ...by }),
    enrolments: await prisma.trainingEnrolment.findMany({ where: { userId: { in: userIds } }, ...by }),
    progress: await prisma.trainingProgress.findMany({ where: { userId: { in: userIds } }, ...by }),
    done: await prisma.trainingModuleDone.findMany({ where: { userId: { in: userIds } }, ...by }),
    assignments: await prisma.trainingAssignment.findMany({ where: { courseId: { in: ids } }, ...by }),
    assignees: await prisma.trainingAssignee.findMany({ where: { userId: { in: userIds } }, ...by }),
    rules: await prisma.trainingRule.findMany({ where: { id: { in: w.ruleIds } }, ...by }),
    certificates: await prisma.trainingCertificate.findMany({ where: { userId: { in: userIds } }, ...by }),
    notifications: await prisma.notification.findMany({ where: { userId: { in: userIds } }, ...by }),
    record: await record(w),
  };
}

// ── Assignments and rules (D2) ──

describe('one-course conversion: assignments and rules (D2)', () => {
  let w: World;
  let c: { id: string };
  let old: Record<string, string>;
  let rule: { id: string; createdAt: Date };
  const sinceKeyWas = { there: false };

  beforeAll(async () => {
    w = await buildWorld();
    // Assigned on 1 Nov (the sync gave each person their own due day then).
    clockAt = T('2026-11-01T06:00:00.000Z');
    const assign = (s: ShortName | 'extra', data: Record<string, unknown>) =>
      prisma.trainingAssignment.create({ data: { courseId: s === 'extra' ? w.extra : shortId(w, s), createdAt: clockAt, mandatory: false, ...data } as never });
    old = {
      x1: (await assign('a', { targetKind: 'COMPANY', targetId: w.company, dueDay: day(10) })).id,
      x2: (await assign('b', { targetKind: 'COMPANY', targetId: w.company, dueDay: day(5), mandatory: true })).id,
      y: (await assign('a', { targetKind: 'USER', targetId: w.people.emp, dueDay: day(60), mandatory: true })).id,
      z: (await assign('b', { targetKind: 'DEPARTMENT', targetId: w.dept, dueDays: 7 })).id,
      // A Training manager's (scoped to the company) of Reports: only administrators could see it, so it reached the
      // administrator alone — the one course reaches everyone in the company.
      s: (await assign('c', { targetKind: 'COMPANY', targetId: w.company, scopeCompanyIds: [w.company], dueDay: day(20) })).id,
    };
    // A "New staff only" rule for the company (made 1 Oct): Tasks, the board and the administrator's own course, 7 days.
    rule = await prisma.trainingRule.create({ data: { name: `New staff ${w.tag}`, targetKind: 'COMPANY', targetId: w.company, courseIds: [shortId(w, 'a'), shortId(w, 'b'), w.extra], mandatory: true, dueDays: 7, createdAt: T('2026-10-01T00:00:00.000Z') } });
    w.ruleIds.push(rule.id);
    for (const [k, s] of [['ra', 'a'], ['rb', 'b'], ['rx', 'extra']] as const) {
      old[k] = (await assign(s, { targetKind: 'COMPANY', targetId: w.company, ruleId: rule.id, newAccountsOnly: true, mandatory: true, dueDays: 7, createdAt: rule.createdAt })).id;
    }
    await sync.assignments(Object.values(old));
    await sync.idle();
    clockAt = NOW;
    sinceKeyWas.there = (await prisma.systemSetting.count({ where: { key: REMINDERS_SINCE_KEY } })) > 0;
    notices.length = 0;
    await conversion(w).run();
    c = await combined(w);
  });

  afterAll(async () => {
    if (!sinceKeyWas.there) await prisma.systemSetting.deleteMany({ where: { key: REMINDERS_SINCE_KEY } });
  });

  const active = async () =>
    (await prisma.trainingAssignment.findMany({ where: { courseId: c.id, withdrawnAt: null } })).sort((x, y) =>
      JSON.stringify([x.targetKind, x.ruleId ?? '', x.scopeCompanyIds ?? '']).localeCompare(JSON.stringify([y.targetKind, y.ruleId ?? '', y.scopeCompanyIds ?? '']), 'en'),
    );
  const assigneesOf = async (assignmentId: string) =>
    (await prisma.trainingAssignee.findMany({ where: { assignmentId, withdrawnAt: null } })).map((a) => ({ who: Object.entries(w.people).find(([, id]) => id === a.userId)![0], mandatory: a.mandatory, dueDay: a.dueDay })).sort((x, y) => x.who.localeCompare(y.who, 'en'));

  it('one assignment per target: fixed days at least 30 days on, a later day kept, relative days at least 30, mandatory if any; rules point at the course', async () => {
    const list = await active();
    const view = list.map((a) => ({ kind: a.targetKind, target: a.targetId, mandatory: a.mandatory, dueDay: a.dueDay, dueDays: a.dueDays, rule: a.ruleId, newOnly: a.newAccountsOnly, scope: a.scopeCompanyIds }));
    expect(view).toEqual([
      // Tasks (10 days out) and the board (5 days, mandatory) for the company: one, mandatory, due 30 days from the change.
      { kind: 'COMPANY', target: w.company, mandatory: true, dueDay: day(30), dueDays: null, rule: null, newOnly: false, scope: null },
      // The Training manager's Reports (20 days out), still within their companies: due 30 days from the change.
      { kind: 'COMPANY', target: w.company, mandatory: false, dueDay: day(30), dueDays: null, rule: null, newOnly: false, scope: [w.company] },
      // The rule's two: one, still "New staff only", 7 days → 30.
      { kind: 'COMPANY', target: w.company, mandatory: true, dueDay: null, dueDays: 30, rule: rule.id, newOnly: true, scope: null },
      // The department's 7 days → 30.
      { kind: 'DEPARTMENT', target: w.dept, mandatory: false, dueDay: null, dueDays: 30, rule: null, newOnly: false, scope: null },
      // emp's own, due in 60 days: kept.
      { kind: 'USER', target: w.people.emp, mandatory: true, dueDay: day(60), dueDays: null, rule: null, newOnly: false, scope: null },
    ]);
    const [company, scoped, ruled, dept, user] = list;
    expect(company!.createdAt.toISOString()).toBe(NOW.toISOString());
    // New staff only: still from when the rule was made (people who joined since keep it).
    expect(ruled!.createdAt.toISOString()).toBe(rule.createdAt.toISOString());

    // Everyone the old ones reached, with their own day: at least 30 days on, mandatory if any of theirs was.
    expect(await assigneesOf(company!.id)).toEqual(['admin', 'emp', 'emp2', 'old', 'wd'].map((who) => ({ who, mandatory: true, dueDay: day(30) })));
    expect(await assigneesOf(user!.id)).toEqual([{ who: 'emp', mandatory: true, dueDay: day(60) }]);
    expect(await assigneesOf(dept!.id)).toEqual(['admin', 'emp', 'emp2', 'old', 'wd'].map((who) => ({ who, mandatory: false, dueDay: day(30) })));
    // Reports reached the administrator; the one course reaches the company's other people too, written now (with
    // the assignment's own day) so the sync has nobody new to tell.
    expect(await assigneesOf(scoped!.id)).toEqual(['admin', 'emp', 'emp2', 'old', 'wd'].map((who) => ({ who, mandatory: false, dueDay: day(30) })));
    // The rule reached people made after it, not the old account.
    expect(await assigneesOf(ruled!.id)).toEqual(['admin', 'emp', 'emp2', 'wd'].map((who) => ({ who, mandatory: true, dueDay: day(30) })));

    // The old assignments and their people withdrawn; the administrator's own course untouched.
    const olds = await prisma.trainingAssignment.findMany({ where: { id: { in: Object.values(old) } } });
    for (const a of olds) expect(a.withdrawnAt === null, a.id).toBe(a.id === old.rx);
    expect(await prisma.trainingAssignee.count({ where: { assignmentId: { in: [old.x1!, old.x2!, old.y!, old.z!, old.ra!, old.rb!, old.s!] }, withdrawnAt: null } })).toBe(0);
    // Before: Reports had reached the administrator only.
    expect((await prisma.trainingAssignee.findMany({ where: { assignmentId: old.s! } })).map((a) => a.userId)).toEqual([w.people.admin]);
    expect(await prisma.trainingAssignee.count({ where: { assignmentId: old.rx!, withdrawnAt: null } })).toBe(4);

    const r = await prisma.trainingRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(stringList(r.courseIds)).toEqual([c.id, w.extra]);
    expect(r.dueDays).toBe(30);

    // Everyone assigned has the course in My learning (not hidden), with its due day.
    const emp = await loadState(ctx, w.people.emp, c.id);
    expect(emp.enrolment?.withdrawnAt).toBeNull();
    expect(emp.state).toMatchObject({ assigned: true, mandatory: true, dueDay: day(30), overdue: false });
  });

  it('the next membership sync sends no "new training" notice, and the reminders send nothing on the day', async () => {
    notices.length = 0;
    await sync.all();
    await sync.idle();
    expect(mine(w).filter((n) => n.type === 'TRAINING_ASSIGNED')).toEqual([]);
    // Nothing assigned was taken away either.
    expect((await active()).length).toBe(5);
    if (!sinceKeyWas.there) await prisma.systemSetting.create({ data: { key: REMINDERS_SINCE_KEY, value: T('2026-01-01T00:00:00.000Z').toISOString() } });
    const kept = new Set<string>();
    const sweeps = createTrainingSweeps(ctx, sync, { keys: { existing: async (k) => new Set(k.filter((x) => kept.has(x))), addMany: async (k) => void k.forEach((x) => kept.add(x)) } });
    notices.length = 0;
    await sweeps.reminders.run();
    // (The administrator's own course, 7 days after 1 Nov, is overdue as before — not the conversion's.)
    const ours = new Set([c.id, shortId(w, 'a'), shortId(w, 'b'), shortId(w, 'c')]);
    expect(mine(w).filter((n) => n.entityId !== null && ours.has(n.entityId))).toEqual([]);
    expect(mine(w).filter((n) => n.entityId === w.extra).length).toBeGreaterThan(0);
  });
});

// ── An edited short course (C1) and an edited client guide ──

describe('one-course conversion: an edited short course (C1)', () => {
  let w: World;
  let c: Awaited<ReturnType<typeof combined>>;
  let bLessons: string[];
  let x: string;

  beforeAll(async () => {
    clockAt = NOW;
    w = await buildWorld({ b: 'edited', portal: 'edited' });
    bLessons = (await prisma.trainingLesson.findMany({ where: { courseId: shortId(w, 'b') }, select: { id: true } })).map((l) => l.id);
    await finished(w, 'emp', 'b', T('2026-10-20T08:00:00.000Z'));
    await enrol(w, 'client', 'portal', { completedAt: T('2026-10-10T08:00:00.000Z') });
    x = (await prisma.trainingAssignment.create({ data: { courseId: shortId(w, 'b'), targetKind: 'COMPANY', targetId: w.company, mandatory: true, dueDay: day(10), createdAt: T('2026-11-01T06:00:00.000Z') } })).id;
    await sync.assignments([x]);
    await sync.idle();
    notices.length = 0;
    await conversion(w).run();
    c = await combined(w);
  });

  it('stays published with its own lessons; its module gets the built-in lessons; the record lists it as not merged', async () => {
    const b = await prisma.trainingCourse.findUniqueOrThrow({ where: { id: shortId(w, 'b') }, include: { lessons: true } });
    expect(b).toMatchObject({ status: 'PUBLISHED', version: 2, updatedById: w.people.admin });
    expect(b.lessons.map((l) => l.id).sort()).toEqual([...bLessons].sort());
    expect(b.lessons.map((l) => l.title).sort()).toEqual(['B guide (ours)', 'Video: B']);
    const mb = c.modules.find((m) => m.starterKey === 'module:b')!;
    expect(mb).toMatchObject({ enabled: true, offReason: null, fromCourseId: shortId(w, 'b') });
    const fresh = c.lessons.filter((l) => l.moduleId === mb.id);
    expect(fresh.map((l) => l.title)).toEqual(['Video: B', 'B guide']);
    for (const l of fresh) expect(bLessons).not.toContain(l.id);
    // Its picture is a fresh copy (the edited course keeps its own).
    expect(fresh[1]!.steps[0]!.imageFileId).not.toBeNull();
    expect((await prisma.trainingFile.findUniqueOrThrow({ where: { id: fresh[1]!.steps[0]!.imageFileId! } })).courseId).toBe(c.id);
    const r = (await record(w))!;
    expect(r.notMerged).toEqual([shortId(w, 'b')]);
    expect(Object.keys(r.moved).sort()).toEqual([shortId(w, 'a'), shortId(w, 'c')].sort());
    // Its people's enrolments are not hidden (it is still a course of its own).
    expect((await prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId: w.people.emp, courseId: shortId(w, 'b') } } })).withdrawnAt).toBeNull();
  });

  it('its completion up to the change counts as the module done; its assignment moved with the D2 day', async () => {
    const mb = c.modules.find((m) => m.starterKey === 'module:b')!;
    expect(await prisma.trainingModuleDone.findMany({ where: { userId: w.people.emp, courseId: c.id }, select: { moduleId: true, doneAt: true, via: true } })).toEqual([{ moduleId: mb.id, doneAt: T('2026-10-20T08:00:00.000Z'), via: 'CONVERTED' }]);
    expect((await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: x } })).withdrawnAt).not.toBeNull();
    const moved = await prisma.trainingAssignment.findMany({ where: { courseId: c.id, withdrawnAt: null } });
    expect(moved.map((a) => [a.targetKind, a.targetId, a.mandatory, a.dueDay])).toEqual([['COMPANY', w.company, true, day(30)]]);
    expect(await prisma.trainingAssignee.count({ where: { assignmentId: x, withdrawnAt: null } })).toBe(0);
  });

  it('a completion of it after the change does not make the module done', async () => {
    const learner = createTrainingLearner(ctx, sync, { oneCourseKey: w.keys.record });
    clockAt = new Date(NOW.getTime() + 86_400_000);
    try {
      const guide = bLessons.find((id) => id !== lessonOf(w, 'b', 'Video: B'))!;
      await learner.complete(w.people.emp2, 'staff', guide);
      await sync.idle();
    } finally {
      clockAt = NOW;
    }
    expect((await prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId: w.people.emp2, courseId: shortId(w, 'b') } } })).completedAt).not.toBeNull();
    expect(await prisma.trainingModuleDone.count({ where: { userId: w.people.emp2 } })).toBe(0);
    const state = await loadState(ctx, w.people.emp2, c.id);
    expect(state.units.find((u) => u.unitId === c.modules.find((m) => m.starterKey === 'module:b')!.id)!.status).toBe('NOT_STARTED');
  });

  it('an edited client guide is left alone (no certificate switched on, none issued)', async () => {
    expect((await prisma.trainingCourse.findUniqueOrThrow({ where: { id: w.portal } })).certificateOn).toBe(false);
    expect(await prisma.trainingCertificate.count({ where: { userId: w.people.client } })).toBe(0);
  });
});

// ── A removed short course (C2) ──

describe('one-course conversion: a removed short course (C2)', () => {
  it('archived before the change: its module is off ("removed"), its assignments stay where they are, and switching it on counts the earlier completions', async () => {
    clockAt = NOW;
    const w = await buildWorld({ c: 'archived' });
    // The administrator finished Reports in September (then it was archived), Tasks and the board in October.
    // (finished() needs the course published to look like 1.23.27 — it only writes rows.)
    await finished(w, 'admin', 'c', T('2026-09-15T08:00:00.000Z'));
    await finished(w, 'admin', 'a', T('2026-10-02T08:00:00.000Z'));
    await finished(w, 'admin', 'b', T('2026-10-03T08:00:00.000Z'));
    const kept = (await prisma.trainingAssignment.create({ data: { courseId: shortId(w, 'c'), targetKind: 'USER', targetId: w.people.admin, mandatory: true, createdAt: T('2026-09-01T00:00:00.000Z') } })).id;
    await conversion(w).run();
    const c = await combined(w);
    const mc = c.modules.find((m) => m.starterKey === 'module:c')!;
    expect(mc).toMatchObject({ enabled: false, offReason: 'REMOVED', fromCourseId: shortId(w, 'c') });
    expect(c.lessons.filter((l) => l.moduleId === mc.id).map((l) => l.title)).toEqual(['Video: C', 'C guide']);
    // The archived course is left as it was (lessons and all), and not in the record's moved list.
    expect(await prisma.trainingLesson.count({ where: { courseId: shortId(w, 'c') } })).toBe(2);
    expect(Object.keys((await record(w))!.moved).sort()).toEqual([shortId(w, 'a'), shortId(w, 'b')].sort());
    expect((await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: kept } })).withdrawnAt).toBeNull();
    // Its completion is recorded; with the module off, the administrator has every module they see done.
    expect(await prisma.trainingModuleDone.findFirst({ where: { userId: w.people.admin, moduleId: mc.id } })).toMatchObject({ doneAt: T('2026-09-15T08:00:00.000Z'), via: 'CONVERTED' });
    const admin = await prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId: w.people.admin, courseId: c.id } } });
    expect(admin.completedAt).toEqual(T('2026-10-03T08:00:00.000Z'));
    // An administrator switches it on (the module editor's write): the earlier completion counts.
    await prisma.trainingModule.update({ where: { id: mc.id }, data: { enabled: true, offReason: null } });
    const state = await loadState(ctx, w.people.admin, c.id);
    expect(state.units.find((u) => u.unitId === mc.id)).toMatchObject({ status: 'DONE', doneAt: T('2026-09-15T08:00:00.000Z') });
  });

  it('deleted before the change: its module is off with no old course; a short course this site never had gives a module that is on', async () => {
    clockAt = NOW;
    const w = await buildWorld({ b: 'missing', c: 'missing' });
    // The site loaded Tasks and the board (then deleted the board); Reports came later and was never loaded here.
    await conversion(w, { loadedKeys: async () => [w.keys.a, w.keys.b] }).run();
    const c = await combined(w);
    expect(c.modules.map((m) => [m.starterKey, m.enabled, m.offReason, m.fromCourseId])).toEqual([
      ['module:a', true, null, shortId(w, 'a')],
      ['module:b', false, 'REMOVED', null],
      ['module:c', true, null, null],
    ]);
    expect(c.lessons.map((l) => l.title)).toEqual(['Video: A', 'A guide', 'A new guide', 'Quiz: A', 'Video: B', 'B guide', 'Video: C', 'C guide']);
  });

  it('every short course removed before the change: the course is made as a draft (no module on), nobody is told of it; switched on and published, it is taken as usual (final review 7)', async () => {
    clockAt = NOW;
    const w = await buildWorld({ a: 'archived', b: 'archived', c: 'missing' });
    // Someone finished Tasks before it was archived: their enrolment comes over (the module stays recorded done).
    await finished(w, 'emp', 'a', T('2026-09-15T08:00:00.000Z'));
    await conversion(w).run();
    const c = await combined(w);
    expect(c).toMatchObject({ status: 'DRAFT', publishedAt: null, version: 1 });
    expect(c.modules.map((m) => [m.starterKey, m.enabled, m.offReason])).toEqual([
      ['module:a', false, 'REMOVED'],
      ['module:b', false, 'REMOVED'],
      ['module:c', false, 'REMOVED'],
    ]);
    expect((await record(w))!.phase).toBe('done');
    expect(await prisma.trainingEnrolment.count({ where: { courseId: c.id, userId: w.people.emp } })).toBe(1);
    // No bell line points at a course nobody can open.
    expect(await prisma.notification.count({ where: { userId: { in: Object.values(w.people) }, entityId: c.id } })).toBe(0);
    expect(mine(w)).toEqual([]);
    // Not offered to learners while a draft.
    const learner = createTrainingLearner(ctx, sync, { oneCourseKey: w.keys.record });
    expect((await learner.catalogue(w.people.emp2, 'staff', {})).courses.map((x) => x.id)).not.toContain(c.id);
    // An administrator switches Tasks on and publishes: the earlier completion counts.
    const ma = c.modules.find((m) => m.starterKey === 'module:a')!;
    await prisma.trainingModule.update({ where: { id: ma.id }, data: { enabled: true, offReason: null } });
    await prisma.trainingCourse.update({ where: { id: c.id }, data: { status: 'PUBLISHED', publishedAt: NOW } });
    const d = await learner.course(w.people.emp, 'staff', c.id);
    expect(d.modules.map((m) => [m.id, m.status])).toEqual([[ma.id, 'DONE']]);
  });
});

// ── A half-way failure finishes on the next start, the same as one clean run ──

describe('one-course conversion: a half-way failure', () => {
  /** The same history in a world: progress, completions, an assignment, a rule, a client. */
  async function history(w: World) {
    await finished(w, 'emp', 'a', T('2026-10-01T08:00:00.000Z'));
    await finished(w, 'emp', 'b', T('2026-10-05T08:00:00.000Z'));
    await finished(w, 'admin', 'a', T('2026-10-02T08:00:00.000Z'));
    await enrol(w, 'emp2', 'a', { lastLessonId: lessonOf(w, 'a', 'A guide'), lastActivityAt: T('2026-11-01T08:00:00.000Z') });
    await prisma.trainingProgress.create({ data: { userId: w.people.emp2, courseId: shortId(w, 'a'), lessonId: lessonOf(w, 'a', 'A guide'), stepIndex: 2 } });
    await enrol(w, 'client', 'portal', { completedAt: T('2026-10-10T08:00:00.000Z') });
    clockAt = T('2026-11-01T06:00:00.000Z');
    const a = await prisma.trainingAssignment.create({ data: { courseId: shortId(w, 'a'), targetKind: 'COMPANY', targetId: w.company, mandatory: true, dueDay: day(10), createdAt: clockAt } });
    const r = await prisma.trainingRule.create({ data: { name: `New staff ${w.tag}`, targetKind: 'COMPANY', targetId: w.company, courseIds: [shortId(w, 'b')], mandatory: false, dueDays: 14, createdAt: T('2026-10-01T00:00:00.000Z') } });
    w.ruleIds.push(r.id);
    const ra = await prisma.trainingAssignment.create({ data: { courseId: shortId(w, 'b'), targetKind: 'COMPANY', targetId: w.company, mandatory: false, dueDays: 14, ruleId: r.id, newAccountsOnly: true, createdAt: r.createdAt } });
    await sync.assignments([a.id, ra.id]);
    await sync.idle();
    clockAt = NOW;
  }

  /** The end state in names (not ids), so two worlds compare. */
  async function named(w: World) {
    const c = await combined(w);
    const who = (id: string) => Object.entries(w.people).find(([, x]) => x === id)?.[0] ?? id;
    const lessonName = new Map(c.lessons.map((l) => [l.id, l.title]));
    const moduleName = new Map(c.modules.map((m) => [m.id, m.starterKey]));
    const fromName = (id: string | null) => (id ? (id === c.id ? 'one' : id === w.portal ? 'portal' : id === w.extra ? 'extra' : (Object.entries(w.short).find(([, x]) => x === id)?.[0] ?? id)) : null);
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    const r = (await record(w))!;
    return {
      course: { title: c.title.replace(w.tag, ''), status: c.status, version: c.version, publishedAt: iso(c.publishedAt), updatedAt: iso(c.updatedAt) },
      modules: c.modules.map((m) => [m.starterKey, m.enabled, m.offReason, fromName(m.fromCourseId)]),
      lessons: c.lessons.map((l) => [l.title, moduleName.get(l.moduleId!), [...w.lessons.entries()].find(([, id]) => id === l.id)?.[0] ?? 'new', l.steps.length, iso(l.updatedAt)]),
      shorts: await Promise.all((['a', 'b', 'c'] as const).map(async (s) => (await prisma.trainingCourse.findUniqueOrThrow({ where: { id: shortId(w, s) }, select: { status: true, _count: { select: { lessons: true } } } })))),
      enrolments: (await prisma.trainingEnrolment.findMany({ where: { userId: { in: Object.values(w.people) } } }))
        .map((e) => [who(e.userId), fromName(e.courseId), iso(e.startedAt), iso(e.completedAt), e.withdrawnAt ? 'withdrawn' : 'shown', e.selfStarted, e.lastLessonId ? (lessonName.get(e.lastLessonId) ?? 'other') : null, e.progressPct])
        .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y), 'en')),
      progress: (await prisma.trainingProgress.findMany({ where: { userId: { in: Object.values(w.people) } } })).map((p) => [who(p.userId), fromName(p.courseId), lessonName.get(p.lessonId), iso(p.doneAt), p.stepIndex]).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y), 'en')),
      done: (await prisma.trainingModuleDone.findMany({ where: { userId: { in: Object.values(w.people) } } })).map((d) => [who(d.userId), moduleName.get(d.moduleId), iso(d.doneAt), d.via]).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y), 'en')),
      certificates: (await prisma.trainingCertificate.findMany({ where: { userId: { in: Object.values(w.people) } } }))
        .map((x) => [who(x.userId), fromName(x.courseId), iso(x.completedAt), stringList(x.moduleIds).map((m) => moduleName.get(m)).sort(), x.revokedAt ? 'revoked' : 'valid'])
        .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y), 'en')),
      assignments: await Promise.all(
        (await prisma.trainingAssignment.findMany({ where: { courseId: { in: [c.id, ...Object.values(w.short).filter((x): x is string => !!x)] } }, orderBy: [{ courseId: 'asc' }, { targetKind: 'asc' }, { ruleId: 'asc' }] })).map(async (a) => [
          fromName(a.courseId),
          a.targetKind,
          a.mandatory,
          a.dueDay,
          a.dueDays,
          !!a.ruleId,
          a.newAccountsOnly,
          iso(a.createdAt),
          a.withdrawnAt ? 'withdrawn' : 'active',
          (await prisma.trainingAssignee.findMany({ where: { assignmentId: a.id } })).map((x) => [who(x.userId), x.mandatory, x.dueDay, x.withdrawnAt ? 'withdrawn' : 'active']).sort((p, q) => JSON.stringify(p).localeCompare(JSON.stringify(q), 'en')),
        ]),
      ),
      rules: (await prisma.trainingRule.findMany({ where: { id: { in: w.ruleIds } } })).map((x) => [stringList(x.courseIds).map((id) => fromName(id)), x.dueDays]),
      notifications: (await prisma.notification.findMany({ where: { userId: { in: Object.values(w.people) } } })).map((n) => [who(n.userId), n.type, n.title.replace(w.tag, ''), n.entityId === c.id]).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y), 'en')),
      record: { phase: r.phase, at: r.at, moved: Object.values(r.moved).map((m) => moduleName.get(m.moduleId!)).sort(), removed: Object.values(r.removedLessons).map((m) => moduleName.get(m.moduleId!)), notMerged: r.notMerged, notices: !!r.noticesAt },
    };
  }

  it('stopped after the content, then after the people: the site still answers in between, and the next start ends where one clean run does', async () => {
    clockAt = NOW;
    const twin = await buildWorld();
    await history(twin);
    const w = await buildWorld();
    await history(w);
    notices.length = 0;
    await conversion(twin).run();

    const learner = createTrainingLearner(ctx, sync, { oneCourseKey: w.keys.record });
    const answers = async () => {
      const id = (await prisma.trainingCourse.findUniqueOrThrow({ where: { starterKey: w.keys.one } })).id;
      const me = await learner.me(w.people.emp2, 'staff');
      const course = await learner.course(w.people.emp2, 'staff', id);
      await sync.idle();
      return { me, course };
    };
    await expect(conversion(w, { failAfter: 'content' }).run()).rejects.toThrow(/content/);
    expect((await record(w))!.phase).toBe('content');
    const mid1 = await answers();
    expect(mid1.course.lessons.length).toBeGreaterThan(0);
    await expect(conversion(w, { failAfter: 'people' }).run()).rejects.toThrow(/people/);
    expect((await record(w))!.phase).toBe('people');
    const mid2 = await answers();
    // In progress on the course where they stopped (the Tasks guide).
    expect(mid2.me.inProgress.map((x) => x.id)).toContain(mid2.course.id);
    expect(mid2.course.mine.lastLessonId).toBe(lessonOf(w, 'a', 'A guide'));
    await conversion(w).run();
    expect(await named(w)).toEqual(await named(twin));
    // The notices the learner calls may have sent are the sync's ordinary ones (none on the day).
    expect(mine(w).filter((n) => n.type === 'TRAINING_ASSIGNED')).toEqual([]);
  });

  it('someone who opens the course before their enrolment is written keeps what they did, with the start day of their short course', async () => {
    clockAt = NOW;
    const w = await buildWorld();
    await history(w);
    await expect(conversion(w, { failAfter: 'content' }).run()).rejects.toThrow(/content/);
    const id = (await prisma.trainingCourse.findUniqueOrThrow({ where: { starterKey: w.keys.one } })).id;
    const learner = createTrainingLearner(ctx, sync, { oneCourseKey: w.keys.record });
    const opened = new Date(NOW.getTime() + 3_600_000);
    clockAt = opened;
    try {
      await learner.start(w.people.emp2, 'staff', id);
    } finally {
      clockAt = NOW;
    }
    await conversion(w).run();
    const e = await prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId: w.people.emp2, courseId: id } } });
    expect(e).toMatchObject({
      startedAt: T('2026-09-20T08:00:00.000Z'),
      createdAt: T('2026-09-20T08:00:00.000Z'),
      lastActivityAt: opened,
      lastLessonId: lessonOf(w, 'a', 'A guide'),
      selfStarted: true,
      withdrawnAt: null,
    });
  });

  it('two servers starting at once: one course, one assignment per target, one certificate and one bell line each, the record done', async () => {
    clockAt = NOW;
    const twin = await buildWorld();
    await history(twin);
    const w = await buildWorld();
    await history(w);
    await conversion(twin).run();
    notices.length = 0;
    logs.length = 0;
    // Two instances (no shared single-flight), as two servers would run it.
    const [x, y] = await Promise.all([conversion(w).run(), conversion(w).run()]);
    expect(x).toEqual(y);
    expect(logs.filter((l) => l.msg === 'Learning Hub: the built-in courses are now one course')).toHaveLength(1);
    expect(logs.filter((l) => l.level === 'warn')).toEqual([]);
    expect(await prisma.trainingCourse.count({ where: { starterKey: w.keys.one } })).toBe(1);
    expect((await record(w))!.phase).toBe('done');
    const end = await named(w);
    expect(end).toEqual(await named(twin));
    // Not one twice: assignments on the course, certificates, bell lines.
    const c = await combined(w);
    const live = await prisma.trainingAssignment.findMany({ where: { courseId: c.id, withdrawnAt: null } });
    expect(new Set(live.map((a) => `${a.targetKind}|${a.targetId}|${a.ruleId}`)).size).toBe(live.length);
    const certs = await prisma.trainingCertificate.findMany({ where: { userId: { in: Object.values(w.people) } } });
    expect(certs.filter((x2) => x2.revokedAt)).toEqual([]);
    expect(new Set(certs.map((x2) => `${x2.userId}|${x2.courseId}`)).size).toBe(certs.length);
    expect(notices).toEqual([]);
  });

  it('a stop during the assignments, then one during the finish (someone finished, their certificate not yet written): the next start ends where one clean run does', async () => {
    clockAt = NOW;
    const twin = await buildWorld();
    await history(twin);
    const w = await buildWorld();
    await history(w);
    await conversion(twin).run();
    notices.length = 0;
    // 1. The assignments are merged, then it stops before their people's enrolments are settled.
    let settles = 0;
    const stopsSettling = {
      ...sync,
      settleEnrolments: async () => {
        settles++;
        throw new Error('stopped while settling enrolments');
      },
    };
    await expect(conversion(w, { sync: stopsSettling }).run()).rejects.toThrow(/settling/);
    expect(settles).toBe(1);
    expect((await record(w))!.phase).toBe('people');
    const c = await combined(w);
    expect(await prisma.trainingAssignment.count({ where: { courseId: c.id, withdrawnAt: null } })).toBeGreaterThan(0);
    // 2. The finish writes emp finished, then stops before the certificate — as a crash between the two would (nothing
    // more is written in that run: no certificate can be).
    const stopsBeforeCertificate: typeof finish = {
      ...finish,
      completeAt: async (_userId, course, state, completedAt) => {
        await prisma.trainingEnrolment.updateMany({ where: { id: state.enrolment!.id, completedAt: null }, data: { completedAt, completedVersion: course.version, progressPct: 100 } });
        throw new Error('stopped before the certificate');
      },
      issueCertificate: async () => {
        throw new Error('stopped before the certificate');
      },
    };
    await expect(conversion(w, { finish: stopsBeforeCertificate }).run()).rejects.toThrow(/finish/);
    // The finish is not counted as done: the next start does it again.
    expect((await record(w))!.phase).toBe('assignments');
    const emp = { userId_courseId: { userId: w.people.emp, courseId: c.id } };
    expect((await prisma.trainingEnrolment.findUniqueOrThrow({ where: emp })).completedAt).toEqual(T('2026-10-05T08:00:00.000Z'));
    expect(await prisma.trainingCertificate.count({ where: { userId: w.people.emp, courseId: c.id } })).toBe(0);
    // 3. A clean start: the certificate is written, dated the completion, and everything is as one clean run left it.
    await conversion(w).run();
    const cert = await prisma.trainingCertificate.findFirstOrThrow({ where: { userId: w.people.emp, courseId: c.id } });
    expect(cert).toMatchObject({ completedAt: T('2026-10-05T08:00:00.000Z'), revokedAt: null });
    expect(stringList(cert.moduleIds).sort()).toEqual([await moduleId(w, 'module:a'), await moduleId(w, 'module:b')].sort());
    expect(await named(w)).toEqual(await named(twin));
    expect(notices).toEqual([]);
  });
});

// ── Learners elsewhere and the pictures ──

describe('one-course conversion: what it never holds up or loses', () => {
  it('while the content is written, a progress save on another course goes through at once (no whole-table lock)', async () => {
    clockAt = NOW;
    const w = await buildWorld();
    await finished(w, 'emp', 'a', T('2026-10-01T08:00:00.000Z'));
    // emp2 part-way through the Tasks guide (its saved step is checked against the new guide's length).
    await enrol(w, 'emp2', 'a', { lastLessonId: lessonOf(w, 'a', 'A guide') });
    await prisma.trainingProgress.create({ data: { userId: w.people.emp2, courseId: shortId(w, 'a'), lessonId: lessonOf(w, 'a', 'A guide'), stepIndex: 2 } });
    // Someone else's place in the administrator's own course.
    const safety = (await prisma.trainingLesson.findFirstOrThrow({ where: { courseId: w.extra } })).id;
    const elsewhere = (await prisma.trainingProgress.create({ data: { userId: w.people.wd, courseId: w.extra, lessonId: safety, stepIndex: 0 } })).id;
    // A second connection that waits at most 2 s for a row lock.
    // Plain client on purpose: it must NOT retry, so the 2 s lock wait proves the conversion holds no lock.
    const other = new PrismaClient({ datasources: { db: { url: `${url}${url.includes('?') ? '&' : '?'}connection_limit=1` } } });
    let waited = -1;
    try {
      await other.$executeRawUnsafe('SET SESSION innodb_lock_wait_timeout = 2');
      await conversion(w, {
        inContent: async () => {
          const t0 = Date.now();
          await other.trainingProgress.updateMany({ where: { id: elsewhere }, data: { stepIndex: 1 } });
          waited = Date.now() - t0;
        },
      }).run();
    } finally {
      await other.$disconnect();
    }
    expect(waited).toBeGreaterThanOrEqual(0);
    expect(waited).toBeLessThan(1500);
    expect((await prisma.trainingProgress.findUniqueOrThrow({ where: { id: elsewhere } })).stepIndex).toBe(1);
    // The moved progress and the step check still happened.
    const c = await combined(w);
    expect(await prisma.trainingProgress.count({ where: { courseId: shortId(w, 'a') } })).toBe(0);
    expect(await prisma.trainingProgress.findFirstOrThrow({ where: { userId: w.people.emp2, lessonId: lessonOf(w, 'a', 'A guide') } })).toMatchObject({ courseId: c.id, stepIndex: 2 });
  });

  it('a starter picture missing from the assets keeps the moved copy (never removed, the step keeps its picture); with no assets at all every moved picture is kept', async () => {
    clockAt = NOW;
    const partial = mkdtempSync(join(tmpdir(), 'one-course-partial-'));
    writeFileSync(join(partial, 'pic-b.webp'), webp(2));
    writeFileSync(join(partial, 'pic-new.webp'), webp(4));
    try {
      const w = await buildWorld();
      const picA = await prisma.trainingFile.findFirstOrThrow({ where: { courseId: shortId(w, 'a'), name: 'pic-a.webp' } });
      const picB = await prisma.trainingFile.findFirstOrThrow({ where: { courseId: shortId(w, 'b'), name: 'pic-b.webp' } });
      logs.length = 0;
      await conversion(w, { assetsDir: partial }).run();
      const c = await combined(w);
      const stepPicture = (title: string) => c.lessons.find((l) => l.title === title)!.steps[0]!.imageFileId;
      expect(stepPicture('A guide')).toBe(picA.id);
      expect(await prisma.trainingFile.findUniqueOrThrow({ where: { id: picA.id } })).toMatchObject({ courseId: c.id, storageKey: picA.storageKey });
      expect((await files.read(picA.storageKey)).equals(webp(1))).toBe(true);
      expect(stepPicture('B guide')).toBe(picB.id);
      expect(stepPicture('A new guide')).not.toBeNull();
      expect(logs.some((l) => l.level === 'warn' && /pic-a\.webp/.test(l.msg))).toBe(true);

      const w2 = await buildWorld();
      const picA2 = await prisma.trainingFile.findFirstOrThrow({ where: { courseId: shortId(w2, 'a'), name: 'pic-a.webp' } });
      const picB2 = await prisma.trainingFile.findFirstOrThrow({ where: { courseId: shortId(w2, 'b'), name: 'pic-b.webp' } });
      await conversion(w2, { assetsDir: null }).run();
      const c2 = await combined(w2);
      const stepPicture2 = (title: string) => c2.lessons.find((l) => l.title === title)!.steps[0]!.imageFileId;
      expect(stepPicture2('A guide')).toBe(picA2.id);
      expect(stepPicture2('B guide')).toBe(picB2.id);
      // A picture only the new content has can't come from anywhere: that step is text-only (warned).
      expect(stepPicture2('A new guide')).toBeNull();
      expect(await prisma.trainingFile.count({ where: { id: { in: [picA2.id, picB2.id] }, courseId: c2.id } })).toBe(2);
    } finally {
      rmSync(partial, { recursive: true, force: true });
    }
  });
});

// ── Through the starter (the server's path: the update to revision 3 runs the conversion first) ──

describe('one-course conversion: through the starter update', () => {
  const SITE_KEYS = [LAUNCHED_KEY, STARTER_LOADED_KEY, STARTER_REVISION_KEY];
  let saved: { key: string; value: unknown }[] = [];
  beforeAll(async () => {
    saved = (await prisma.systemSetting.findMany({ where: { key: { in: SITE_KEYS } } })).map((r) => ({ key: r.key, value: r.value }));
  });
  afterAll(async () => {
    await prisma.systemSetting.deleteMany({ where: { key: { in: SITE_KEYS } } });
    for (const r of saved) await prisma.systemSetting.create({ data: { key: r.key, value: r.value as never } });
  });

  it('an older site’s next start converts once, notes revision 3, brings the client guide up to date, and logs one line', async () => {
    clockAt = NOW;
    const w = await buildWorld();
    await finished(w, 'emp', 'a', T('2026-10-01T08:00:00.000Z'));
    await enrol(w, 'client', 'portal', { completedAt: T('2026-10-10T08:00:00.000Z') });
    // 1.23.27's site: everything loaded, revision 2 noted.
    await prisma.systemSetting.deleteMany({ where: { key: { in: SITE_KEYS } } });
    await prisma.systemSetting.create({ data: { key: STARTER_LOADED_KEY, value: PAST.toISOString() } });
    await prisma.systemSetting.create({ data: { key: STARTER_REVISION_KEY, value: { revision: 2, keys: [w.keys.a, w.keys.b, w.keys.c, w.keys.portal] } } });
    const one = conversion(w);
    const start = () =>
      createTrainingStarter({ prisma, files, courses: [w.content.one, { ...w.content.portal, certificateOn: true }], assetsDir: assets, now: () => clockAt, revision: 3, retired: [], userTrainingKey: w.keys.one, recheck: (ids) => finish.recheck(ids), convert: () => one.run(), logger: ctx.logger }).run();
    logs.length = 0;
    notices.length = 0;
    const out = await start();
    expect(out.updated).toBe(2);
    expect(await prisma.trainingCourse.count({ where: { starterKey: w.keys.one } })).toBe(1);
    expect((await record(w))!.phase).toBe('done');
    const noted = (await prisma.systemSetting.findUniqueOrThrow({ where: { key: STARTER_REVISION_KEY } })).value as { revision: number; keys: string[] };
    expect(noted.revision).toBe(3);
    expect(noted.keys).toEqual(expect.arrayContaining([w.keys.one, w.keys.portal, w.keys.a]));
    // The client guide: certificate on (the update keeps it so), the client's certificate issued at the change.
    expect((await prisma.trainingCourse.findUniqueOrThrow({ where: { id: w.portal } })).certificateOn).toBe(true);
    expect(await prisma.trainingCertificate.count({ where: { userId: w.people.client, courseId: w.portal } })).toBe(1);
    expect(logs.filter((l) => l.level === 'warn')).toEqual([]);
    const line = logs.filter((l) => l.msg === 'Learning Hub: the built-in courses are now one course');
    expect(line).toHaveLength(1);
    expect(line[0]!.meta).toMatchObject({ merged: 3, notMerged: 0, removedLessons: 1, modulesDone: 1, finished: 0, clientCertificates: 1, notices: 1 });
    expect(notices).toEqual([]);
    // The next start: nothing to do.
    logs.length = 0;
    expect((await start()).updated).toBeUndefined();
    expect(logs.filter((l) => /one course/.test(l.msg))).toEqual([]);
    expect(await prisma.trainingCourse.count({ where: { starterKey: w.keys.one } })).toBe(1);
  });
});

// ── A fresh site, and a retake ──

describe('one-course conversion: nothing to convert', () => {
  it('a site that never had the short courses: run() answers null and writes nothing', async () => {
    clockAt = NOW;
    const w = await buildWorld({ a: 'missing', b: 'missing', c: 'missing' });
    const out = await conversion(w, { loadedKeys: async () => [] }).run();
    expect(out).toBeNull();
    expect(await prisma.trainingCourse.count({ where: { starterKey: w.keys.one } })).toBe(0);
    expect(await record(w)).toBeUndefined();
    expect((await prisma.trainingCourse.findUniqueOrThrow({ where: { id: w.portal } })).certificateOn).toBe(false);
  });
});

describe('finishing for the conversion (completeAt) and a retake', () => {
  it('never finishes someone retaking on a day before their retake started', async () => {
    clockAt = NOW;
    const w = await buildWorld();
    await conversion(w).run();
    const c = await prisma.trainingCourse.findUniqueOrThrow({ where: { starterKey: w.keys.one }, select: COURSE });
    const userId = w.people.emp2;
    const retakeFrom = T('2026-11-10T00:00:00.000Z');
    // Finished once, the certificate expired on 10 Nov: a retake; both of their modules done again since (12 Nov).
    await prisma.trainingEnrolment.create({ data: { userId, courseId: c.id, startedAt: T('2026-05-01T00:00:00.000Z'), completedAt: T('2026-06-01T00:00:00.000Z'), completedVersion: 1, progressPct: 100, retakeFrom } });
    for (const key of ['module:a', 'module:b']) {
      await prisma.trainingModuleDone.create({ data: { userId, courseId: c.id, moduleId: await moduleId(w, key), doneAt: T('2026-11-12T00:00:00.000Z'), via: 'LEARNED' } });
    }
    const person = (await ctx.person(userId))!;
    const state = await loadState(ctx, userId, c.id, person);
    expect(state.state.status).toBe('RETAKE');
    expect(await finish.completeAt(userId, c, state, T('2026-11-09T00:00:00.000Z'), person)).toEqual({ completed: false, certificateId: null });
    expect((await prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId, courseId: c.id } } })).completedAt).toEqual(T('2026-06-01T00:00:00.000Z'));
    expect(await prisma.trainingCertificate.count({ where: { userId, courseId: c.id } })).toBe(0);
    const out = await finish.completeAt(userId, c, state, T('2026-11-12T00:00:00.000Z'), person);
    expect(out.completed).toBe(true);
    expect((await prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId, courseId: c.id } } })).completedAt).toEqual(T('2026-11-12T00:00:00.000Z'));
  });
});

describe('someone who can’t be finished at the change (cleanup batch)', () => {
  it('an error line (a warning where the log has no error level) says how many and that it is tried again; the start still fails', async () => {
    clockAt = NOW;
    const w = await buildWorld();
    await finished(w, 'emp', 'a', T('2026-10-01T08:00:00.000Z'));
    await finished(w, 'emp', 'b', T('2026-10-05T08:00:00.000Z'));
    await enrol(w, 'emp2', 'a', { lastLessonId: lessonOf(w, 'a', 'A guide') });
    const alwaysFails: typeof finish = {
      ...finish,
      completeAt: async () => {
        throw new Error('this person can never be finished');
      },
      settle: async () => {
        throw new Error('this person can never be finished');
      },
    };
    const said = /^Learning Hub: (\d+) (person|people) could not be finished at the change; the finish is tried again at the next start\.$/;
    // A log with an error level.
    const errors: { msg: string; meta?: Record<string, unknown> }[] = [];
    const withErrors = { ...ctx, logger: { ...ctx.logger!, error: (msg: string, meta?: Record<string, unknown>) => void errors.push({ msg, ...(meta ? { meta } : {}) }) } };
    logs.length = 0;
    await expect(conversion(w, { ctx: withErrors, finish: alwaysFails }).run()).rejects.toThrow(said);
    const each = logs.filter((l) => l.level === 'warn' && /could not be (checked|written) .*at the change/.test(l.msg)).length;
    expect(each).toBeGreaterThan(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.msg).toMatch(said);
    expect(Number(said.exec(errors[0]!.msg)![1])).toBe(each);
    expect(errors[0]!.meta).toMatchObject({ failed: each, courseId: (await combined(w)).id });
    expect((await record(w))!.phase).toBe('assignments');
    // A log with only warnings: the same line as a warning.
    logs.length = 0;
    await expect(conversion(w, { finish: alwaysFails }).run()).rejects.toThrow(said);
    expect(logs.filter((l) => l.level === 'warn' && said.test(l.msg))).toHaveLength(1);
    // Once it can be, the next start finishes it.
    await conversion(w).run();
    expect((await record(w))!.phase).toBe('done');
  });
});
