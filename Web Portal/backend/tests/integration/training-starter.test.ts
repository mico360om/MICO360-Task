import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrainingStarter, LAUNCHED_KEY, STARTER_LOADED_KEY, STARTER_REVISION_KEY } from '../../src/modules/training/training-starter';
import { trainingContext } from '../../src/modules/training/training-context';
import { createTrainingFinish } from '../../src/modules/training/training-finish';
import { createTrainingFileStore } from '../../src/modules/training/training-files';
import type { StarterCourse, StarterLesson, StarterQuestion } from '../../src/modules/training/starter/starter-types';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// The Training Center's starter content (R17) on a real database: loaded once (pictures and downloads
// copied into the private training folder, published ones published, drafts left as drafts), never again
// once loaded (a deleted starter course never comes back), skipped by its starter key when the flag is
// missing, text-only when an asset is missing, and one load at a time.
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const tag = randomBytes(3).toString('hex');
const KEYS = { tasks: `starter:test-${tag}-tasks`, video: `starter:test-${tag}-video`, missing: `starter:test-${tag}-missing` };

// A tiny WebP (RIFF....WEBP) and a PDF: the loader checks them like uploads.
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(14, 1)]);
const PDF = Buffer.from('%PDF-1.4\n% starter resource\n%%EOF\n', 'utf8');
/** Another picture (the retaken screenshot of a later revision). */
const WEBP2 = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(14, 2)]);

let assets: string;
let privateDir: string;

const fixture = (): StarterCourse[] => [
  {
    key: KEYS.tasks,
    title: 'Tasks basics',
    summary: 'Make, assign and finish tasks.',
    moduleKey: 'tasks',
    audience: 'STAFF',
    roleKeys: [],
    difficulty: 'BEGINNER',
    status: 'PUBLISHED',
    completionRule: 'ALL_LESSONS',
    certificateOn: true,
    certificateMonths: 12,
    resources: [{ file: 'tasks-guide.pdf', name: 'Tasks guide.pdf', mimeType: 'application/pdf' }],
    lessons: [
      {
        kind: 'GUIDE',
        title: 'Your first task',
        minutes: 4,
        body: '<p>Start <strong>here</strong>.</p>',
        steps: [
          { title: 'Open My Tasks', body: '<p>Choose <em>My Tasks</em> in the side menu.</p>', image: 'tasks-01.webp', alt: 'The My Tasks page' },
          { title: 'Press New task', body: '<p>Type a title and save.</p>' },
        ],
      },
      {
        kind: 'QUIZ',
        title: 'Check yourself',
        minutes: 3,
        quiz: {
          passMark: 70,
          maxAttempts: null,
          shuffle: true,
          timeLimitMinutes: null,
          drawCount: null,
          questions: [
            { kind: 'SINGLE', prompt: 'Where are your tasks?', explanation: 'My Tasks lists them.', options: [{ text: 'My Tasks', correct: true, feedback: 'Yes.' }, { text: 'Chat', correct: false, feedback: 'No.' }] },
            { kind: 'TRUE_FALSE', prompt: 'A task can have a due date.', options: [{ text: 'True', correct: true }, { text: 'False', correct: false }] },
            { kind: 'ORDER', prompt: 'Put the steps in order.', options: [{ text: 'Open', correct: true }, { text: 'Type', correct: true }, { text: 'Save', correct: true }] },
          ],
        },
      },
    ],
  },
  {
    key: KEYS.video,
    title: 'Tasks video',
    summary: 'A short video about tasks.',
    moduleKey: 'tasks',
    audience: 'STAFF',
    difficulty: 'BEGINNER',
    status: 'DRAFT',
    completionRule: 'ALL_LESSONS',
    certificateOn: false,
    certificateMonths: null,
    lessons: [{ kind: 'VIDEO', title: 'Watch', minutes: 2, videoUrl: null }],
  },
];

const ourCourses = () => prisma.trainingCourse.findMany({ where: { starterKey: { in: Object.values(KEYS) } }, select: { id: true, starterKey: true } });

async function clean() {
  const ids = (await ourCourses()).map((c) => c.id);
  await prisma.trainingFile.deleteMany({ where: { courseId: { in: ids } } });
  await prisma.trainingCourse.deleteMany({ where: { id: { in: ids } } });
  await prisma.systemSetting.deleteMany({ where: { key: { in: [LAUNCHED_KEY, STARTER_LOADED_KEY, STARTER_REVISION_KEY] } } });
  rmSync(privateDir, { recursive: true, force: true });
}

function logger() {
  const warnings: { msg: string; meta?: Record<string, unknown> }[] = [];
  return { warnings, info() {}, warn(msg: string, meta?: Record<string, unknown>) { warnings.push({ msg, meta }); } };
}

const starter = (courses: StarterCourse[], log = logger(), now = () => new Date('2026-11-15T08:00:00Z')) =>
  createTrainingStarter({ prisma, files: createTrainingFileStore(privateDir), courses, assetsDir: assets, now, logger: log });

beforeAll(async () => {
  assets = mkdtempSync(join(tmpdir(), 'starter-assets-'));
  writeFileSync(join(assets, 'tasks-01.webp'), WEBP);
  writeFileSync(join(assets, 'tasks-guide.pdf'), PDF);
  writeFileSync(join(assets, 'boom.webp'), Buffer.concat([WEBP, Buffer.from('BOOM')]));
  writeFileSync(join(assets, 'pic-a.webp'), WEBP);
  writeFileSync(join(assets, 'pic-a2.webp'), WEBP2);
  privateDir = join(mkdtempSync(join(tmpdir(), 'starter-private-')), 'training-files');
});

beforeEach(clean);

afterAll(async () => {
  await clean();
  rmSync(assets, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe('Training starter content (R17)', () => {
  it('loads every course once: rows, files copied into the private folder, published vs draft, and both flags', async () => {
    const out = await starter(fixture()).run();
    expect(out).toEqual({ loaded: 2, skipped: 0, already: false });

    const tasks = await prisma.trainingCourse.findUniqueOrThrow({
      where: { starterKey: KEYS.tasks },
      include: { lessons: { orderBy: { position: 'asc' }, include: { steps: { orderBy: { position: 'asc' } }, quiz: { include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } } } } } } },
    });
    expect(tasks).toMatchObject({ title: 'Tasks basics', moduleKey: 'tasks', audience: 'STAFF', status: 'PUBLISHED', certificateOn: true, certificateMonths: 12, version: 1, position: 0, inOrder: false, createdById: null });
    expect(tasks.roleKeys).toBeNull();
    expect(tasks.publishedAt?.toISOString()).toBe('2026-11-15T08:00:00.000Z');
    expect(tasks.lessons.map((l) => [l.position, l.kind, l.title, l.changedVersion])).toEqual([
      [0, 'GUIDE', 'Your first task', 1],
      [1, 'QUIZ', 'Check yourself', 1],
    ]);
    expect(tasks.lessons[0]!.body).toBe('<p>Start <strong>here</strong>.</p>');

    const files = await prisma.trainingFile.findMany({ where: { courseId: tasks.id }, orderBy: { position: 'asc' } });
    expect(files.map((f) => [f.kind, f.name, f.mimeType, f.sizeBytes, f.starter, f.position])).toEqual([
      ['IMAGE', 'tasks-01.webp', 'image/webp', WEBP.length, true, 0],
      ['RESOURCE', 'Tasks guide.pdf', 'application/pdf', PDF.length, true, 1],
    ]);
    // The bytes are in the private folder under their random keys — never the public uploads.
    expect(readFileSync(join(privateDir, files[0]!.storageKey)).equals(WEBP)).toBe(true);
    expect(readFileSync(join(privateDir, files[1]!.storageKey)).equals(PDF)).toBe(true);
    expect(files[0]!.storageKey).toMatch(/\.webp$/);

    const [s1, s2] = tasks.lessons[0]!.steps;
    expect(s1).toMatchObject({ position: 0, title: 'Open My Tasks', imageFileId: files[0]!.id, imageAlt: 'The My Tasks page' });
    expect(s1!.body).toContain('<em>My Tasks</em>');
    expect(s2).toMatchObject({ position: 1, title: 'Press New task', imageFileId: null, imageAlt: null });

    const quiz = tasks.lessons[1]!.quiz!;
    expect(quiz).toMatchObject({ passMark: 70, maxAttempts: null, shuffle: true, timeLimitMinutes: null, drawCount: null });
    expect(quiz.questions.map((q) => [q.position, q.kind, q.prompt])).toEqual([
      [0, 'SINGLE', 'Where are your tasks?'],
      [1, 'TRUE_FALSE', 'A task can have a due date.'],
      [2, 'ORDER', 'Put the steps in order.'],
    ]);
    expect(quiz.questions[0]!.explanation).toBe('My Tasks lists them.');
    expect(quiz.questions[0]!.options.map((o) => [o.position, o.text, o.correct, o.feedback])).toEqual([
      [0, 'My Tasks', true, 'Yes.'],
      [1, 'Chat', false, 'No.'],
    ]);
    expect(quiz.questions[1]!.options.map((o) => [o.text, o.correct])).toEqual([
      ['True', true],
      ['False', false],
    ]);
    expect(quiz.questions[2]!.options.map((o) => [o.position, o.text, o.correct])).toEqual([
      [0, 'Open', true],
      [1, 'Type', true],
      [2, 'Save', true],
    ]);

    const video = await prisma.trainingCourse.findUniqueOrThrow({ where: { starterKey: KEYS.video }, include: { lessons: true } });
    expect(video).toMatchObject({ status: 'DRAFT', publishedAt: null, position: 1 });
    expect(video.lessons.map((l) => [l.kind, l.videoProvider, l.videoId, l.videoUrl])).toEqual([['VIDEO', null, null, null]]);

    const flags = await prisma.systemSetting.findMany({ where: { key: { in: [LAUNCHED_KEY, STARTER_LOADED_KEY] } } });
    expect(flags.map((f) => [f.key, f.value]).sort()).toEqual(
      [
        [LAUNCHED_KEY, '2026-11-15T08:00:00.000Z'],
        [STARTER_LOADED_KEY, '2026-11-15T08:00:00.000Z'],
      ].sort(),
    );
  });

  it('a published starter course reads as published with no changes since (its stamp comes after every write)', async () => {
    // As in real life: the clock is read before the rows are written (here an hour back, to make it plain).
    await starter(fixture(), logger(), () => new Date(Date.now() - 3600_000)).run();
    const c = await prisma.trainingCourse.findUniqueOrThrow({ where: { starterKey: KEYS.tasks }, include: { lessons: true } });
    expect(c.publishedAt).not.toBeNull();
    expect(c.updatedAt.getTime()).toBeLessThanOrEqual(c.publishedAt!.getTime());
    for (const l of c.lessons) expect(l.updatedAt.getTime()).toBeLessThanOrEqual(c.publishedAt!.getTime());
    const draft = await prisma.trainingCourse.findUniqueOrThrow({ where: { starterKey: KEYS.video } });
    expect(draft.publishedAt).toBeNull();
  });

  it('never again once loaded: a second run adds nothing, and a deleted starter course does not come back', async () => {
    await starter(fixture()).run();
    const filesBefore = readdirSync(privateDir).length;
    expect(await starter(fixture()).run()).toEqual({ loaded: 0, skipped: 0, already: true });
    expect((await ourCourses()).length).toBe(2);
    expect(readdirSync(privateDir).length).toBe(filesBefore);

    const tasks = await prisma.trainingCourse.findUniqueOrThrow({ where: { starterKey: KEYS.tasks } });
    await prisma.trainingFile.deleteMany({ where: { courseId: tasks.id } });
    await prisma.trainingCourse.delete({ where: { id: tasks.id } });
    expect(await starter(fixture()).run()).toEqual({ loaded: 0, skipped: 0, already: true });
    expect((await ourCourses()).map((c) => c.starterKey)).toEqual([KEYS.video]);
  });

  it('no starter courses at all (an early build): the launch is stamped but the flag waits for real content', async () => {
    expect(await starter([]).run()).toEqual({ loaded: 0, skipped: 0, already: false });
    expect(await prisma.systemSetting.count({ where: { key: LAUNCHED_KEY } })).toBe(1);
    expect(await prisma.systemSetting.count({ where: { key: STARTER_LOADED_KEY } })).toBe(0);
  });

  it('the launch moment is written once and never moved', async () => {
    await starter(fixture(), logger(), () => new Date('2026-11-15T08:00:00Z')).run();
    await prisma.systemSetting.delete({ where: { key: STARTER_LOADED_KEY } });
    await starter(fixture(), logger(), () => new Date('2027-01-01T00:00:00Z')).run();
    expect((await prisma.systemSetting.findUniqueOrThrow({ where: { key: LAUNCHED_KEY } })).value).toBe('2026-11-15T08:00:00.000Z');
  });

  it('without the flag, courses already there are skipped by their starter key (nothing doubled)', async () => {
    await starter(fixture()).run();
    await prisma.systemSetting.delete({ where: { key: STARTER_LOADED_KEY } });
    const filesBefore = readdirSync(privateDir).length;
    expect(await starter(fixture()).run()).toEqual({ loaded: 0, skipped: 2, already: false });
    expect((await ourCourses()).length).toBe(2);
    expect(readdirSync(privateDir).length).toBe(filesBefore);
    expect(await prisma.systemSetting.count({ where: { key: STARTER_LOADED_KEY } })).toBe(1);
  });

  it('a missing asset leaves the course text-only, with a warning; the course still loads', async () => {
    const courses = fixture();
    const c = courses[0]!;
    c.key = KEYS.missing;
    const g = c.lessons[0]!;
    if (g.kind !== 'GUIDE') throw new Error('guide expected');
    g.steps[0]!.image = 'not-there.webp';
    c.resources = [{ file: 'not-there.pdf', name: 'Gone.pdf', mimeType: 'application/pdf' }];
    const log = logger();
    expect(await starter([c], log).run()).toEqual({ loaded: 1, skipped: 0, already: false });
    const course = await prisma.trainingCourse.findUniqueOrThrow({ where: { starterKey: KEYS.missing }, include: { lessons: { orderBy: { position: 'asc' }, include: { steps: { orderBy: { position: 'asc' } } } } } });
    expect(course.lessons[0]!.steps.map((s) => [s.title, s.imageFileId])).toEqual([
      ['Open My Tasks', null],
      ['Press New task', null],
    ]);
    expect(await prisma.trainingFile.count({ where: { courseId: course.id } })).toBe(0);
    expect(log.warnings.map((w) => w.msg).join('\n')).toMatch(/not-there\.webp is missing[\s\S]*not-there\.pdf is missing/);
  });

  it('one load at a time: two runs at once create each course once', async () => {
    const s = starter(fixture());
    const [a, b] = await Promise.all([s.run(), s.run()]);
    expect(a).toEqual({ loaded: 2, skipped: 0, already: false });
    expect(b).toBe(a);
    expect((await ourCourses()).length).toBe(2);
    expect(await prisma.trainingFile.count({ where: { courseId: { in: (await ourCourses()).map((c) => c.id) } } })).toBe(2);
  });

  it('a course that fails to load is warned about, its copied files removed, and tried again at the next start (the flag waits)', async () => {
    const courses = fixture();
    // The draft gets two pictures; the store fails on the second (a full disk, say).
    const bad: StarterCourse = {
      ...courses[1]!,
      lessons: [{ kind: 'GUIDE', title: 'Pictures', minutes: 1, steps: [{ title: 'One', body: '<p>1</p>', image: 'tasks-01.webp', alt: 'One' }, { title: 'Two', body: '<p>2</p>', image: 'boom.webp', alt: 'Two' }] }],
    };
    const store = createTrainingFileStore(privateDir);
    const failing = { ...store, dir: store.dir, save: async (content: Buffer, mime: string) => (content.includes(Buffer.from('BOOM')) ? Promise.reject(new Error('disk full')) : store.save(content, mime)) };
    const log = logger();
    const out = await createTrainingStarter({ prisma, files: failing, courses: [courses[0]!, bad], assetsDir: assets, logger: log }).run();
    expect(out).toEqual({ loaded: 1, skipped: 1, already: false });
    expect(await prisma.systemSetting.count({ where: { key: STARTER_LOADED_KEY } })).toBe(0);
    expect(log.warnings.some((w) => /could not be loaded/.test(w.msg) && w.meta?.course === KEYS.video)).toBe(true);
    // Only the loaded course's two files stay in the private folder (the failed one's first picture was removed).
    expect(readdirSync(privateDir).length).toBe(2);
    // The next start loads the missing one and sets the flag.
    // (The course loaded on the first try is also brought to this revision — the same words, so nothing changes.)
    expect(await createTrainingStarter({ prisma, files: store, courses: [courses[0]!, bad], assetsDir: assets, logger: logger() }).run()).toMatchObject({ loaded: 1, skipped: 1, already: false });
    expect(await prisma.systemSetting.count({ where: { key: STARTER_LOADED_KEY } })).toBe(1);
    expect((await ourCourses()).length).toBe(2);
  });
});

// ── R1/R4 (12 Nov): a site that loaded an earlier revision gets the new one — only on courses nobody edited ──

describe('Starter update to a new revision (R1, R4, R3)', () => {
  const U = {
    mod: `starter:test-${tag}-mod`,
    edited: `starter:test-${tag}-edited`,
    gone: `starter:test-${tag}-gone`,
    fresh: `starter:test-${tag}-fresh`,
    vMod: `starter:test-${tag}-video-mod`,
    vEdited: `starter:test-${tag}-video-edited`,
    vFresh: `starter:test-${tag}-video-fresh`,
  };
  const people = { x: `ux-${tag}`, y: `uy-${tag}`, w: `uw-${tag}`, z: `uz-${tag}` };
  const allKeys = Object.values(U);
  const guide = (title: string, steps: { title: string; image?: string }[], was?: string[]): StarterLesson => ({
    kind: 'GUIDE',
    title,
    ...(was ? { was } : {}),
    minutes: 4,
    steps: steps.map((s) => ({ title: s.title, body: `<p>${s.title}.</p>`, ...(s.image ? { image: s.image, alt: `A picture for ${s.title}` } : {}) })),
  });
  const quizOf = (questions: StarterQuestion[]): StarterLesson => ({ kind: 'QUIZ', title: 'Quiz: Mod', minutes: 3, quiz: { passMark: 70, maxAttempts: null, shuffle: true, timeLimitMinutes: null, drawCount: null, questions } });
  const q1 = (rightText: string): StarterQuestion => ({ kind: 'SINGLE', prompt: 'Where are your tasks?', explanation: 'My Tasks.', options: [{ text: rightText, correct: true }, { text: 'Chat', correct: false, feedback: 'No.' }] });
  const base = (key: string, title: string, lessons: StarterLesson[], o: Partial<StarterCourse> = {}): StarterCourse => ({
    key,
    title,
    summary: `${title}: what it is about.`,
    moduleKey: 'tasks',
    audience: 'STAFF',
    difficulty: 'BEGINNER',
    status: 'PUBLISHED',
    completionRule: 'ALL_LESSONS',
    certificateOn: false,
    certificateMonths: null,
    lessons,
    ...o,
  });
  const draftVideo = (key: string): StarterCourse => base(key, `Video ${key}`, [{ kind: 'VIDEO', title: 'Watch', minutes: 2, videoUrl: null }], { status: 'DRAFT' });

  /** Revision 1: what the site loaded before (as 1.23.24 did). */
  const rev1 = (): StarterCourse[] => [
    base(U.mod, 'Mod basics', [
      guide('Old guide A', [{ title: 'One', image: 'pic-a.webp' }, { title: 'Two' }, { title: 'Three' }]),
      guide('Old guide B', [{ title: 'Only' }]),
      quizOf([q1('My Tasks'), { kind: 'ORDER', prompt: 'Put in order', explanation: 'So.', options: [{ text: 'Open', correct: true }, { text: 'Save', correct: true }] }]),
    ], { resources: [{ file: 'tasks-guide.pdf', name: 'Mod slides.pdf', mimeType: 'application/pdf' }] }),
    base(U.edited, 'Edited basics', [guide('Edited guide', [{ title: 'One' }])]),
    base(U.gone, 'Gone basics', [guide('Gone guide', [{ title: 'One' }])]),
    draftVideo(U.vMod),
    draftVideo(U.vEdited),
    draftVideo(U.vFresh),
  ];
  /** Revision 2: a video first, guide A rewritten (was “Old guide A”), guide B gone, an ORDER question swapped, a new course. */
  const rev2 = (): StarterCourse[] => [
    base(U.fresh, 'Fresh start', [{ kind: 'VIDEO', title: 'Video: Fresh', minutes: 2, videoUrl: null }, guide('Look around', [{ title: 'Here', image: 'pic-a2.webp' }])], { position: -1, moduleKey: 'general' }),
    base(U.mod, 'Mod basics (new)', [
      { kind: 'VIDEO', title: 'Video: Mod', minutes: 2, videoUrl: null },
      guide('Guide A', [{ title: 'One again', image: 'pic-a2.webp' }, { title: 'Two again' }], ['Old guide A']),
      quizOf([q1('My Tasks page'), { kind: 'SINGLE', prompt: 'Which button adds a task?', explanation: 'New Task.', options: [{ text: 'New Task', correct: true }, { text: 'Chat', correct: false, feedback: 'No.' }] }]),
    ], { resources: [{ file: 'tasks-guide.pdf', name: 'Mod slides.pdf', mimeType: 'application/pdf' }] }),
    base(U.edited, 'Edited basics (new words)', [{ kind: 'VIDEO', title: 'Video: Edited', minutes: 2, videoUrl: null }, guide('Edited guide', [{ title: 'Changed' }])]),
    base(U.gone, 'Gone basics', [guide('Gone guide', [{ title: 'One' }])]),
  ];
  const retired = [
    { key: U.vMod, into: U.mod },
    { key: U.vEdited, into: U.edited },
    { key: U.vFresh, into: U.fresh },
  ];
  const finish = createTrainingFinish(
    trainingContext({ prisma, files: createTrainingFileStore(join(tmpdir(), `unused-${tag}`)), timeZone: 'Asia/Muscat', appUrl: 'http://localhost', notify: async () => {}, rules: async () => ({ calendar: { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] }, step1Days: 3, step2Days: 5 }) }),
  );
  const upgrader = (courses: StarterCourse[], revision: number, log = logger()) =>
    createTrainingStarter({ prisma, files: createTrainingFileStore(privateDir), courses, assetsDir: assets, logger: log, revision, legacyKeys: rev1().map((c) => c.key), retired, recheck: (ids) => finish.recheck(ids) });
  const courseOf = (key: string) =>
    prisma.trainingCourse.findUnique({
      where: { starterKey: key },
      include: { lessons: { orderBy: { position: 'asc' }, include: { steps: { orderBy: { position: 'asc' } }, quiz: { include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } } } } } } },
    });
  const enrolment = (userId: string, courseId: string) => prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId, courseId } } });

  async function cleanUp() {
    const ids = (await prisma.trainingCourse.findMany({ where: { starterKey: { in: allKeys } }, select: { id: true } })).map((c) => c.id);
    await prisma.trainingProgress.deleteMany({ where: { userId: { in: Object.values(people) } } });
    await prisma.trainingAttempt.deleteMany({ where: { userId: { in: Object.values(people) } } });
    await prisma.trainingEnrolment.deleteMany({ where: { userId: { in: Object.values(people) } } });
    await prisma.trainingFile.deleteMany({ where: { courseId: { in: ids } } });
    await prisma.trainingCourse.deleteMany({ where: { id: { in: ids } } });
  }
  beforeEach(cleanUp);
  afterAll(cleanUp);

  /** Revision 1 as a live site has it: loaded, people part-way and finished, one course edited, one deleted, one draft video linked. */
  async function liveSite() {
    // Loaded by the earlier release: no revision noted (R1: it is revision 1).
    await starter(rev1(), logger(), () => new Date(Date.now() - 86_400_000)).run();
    await prisma.systemSetting.deleteMany({ where: { key: STARTER_REVISION_KEY } });
    const mod = (await courseOf(U.mod))!;
    const [a, b, q] = mod.lessons;
    const at = new Date(Date.now() - 3_600_000);
    const done = async (userId: string, lessonId: string, stepIndex = 0) => prisma.trainingProgress.create({ data: { userId, courseId: mod.id, lessonId, doneAt: at, stepIndex } });
    const enrol = async (userId: string, completed = false) =>
      prisma.trainingEnrolment.create({ data: { userId, courseId: mod.id, startedAt: at, lastActivityAt: at, ...(completed ? { completedAt: at, completedVersion: 1, progressPct: 100 } : { progressPct: 33 }) } });
    // X finished everything; Y did guide A; W did A and passed the quiz but not B; Z is on step 3 of A.
    await enrol(people.x, true);
    for (const l of [a!, b!, q!]) await done(people.x, l.id);
    await enrol(people.y);
    await done(people.y, a!.id, 2);
    await enrol(people.w);
    await done(people.w, a!.id, 2);
    await done(people.w, q!.id);
    await prisma.trainingAttempt.create({ data: { userId: people.w, courseId: mod.id, lessonId: q!.id, quizId: q!.quiz!.id, paper: { questions: [] }, answers: {}, submittedAt: at, scorePct: 100, passed: true } });
    await enrol(people.z);
    await prisma.trainingProgress.create({ data: { userId: people.z, courseId: mod.id, lessonId: a!.id, stepIndex: 2 } });
    // An administrator edited one course and deleted another; the owner pasted a link into one draft video course.
    const edited = (await courseOf(U.edited))!;
    await prisma.trainingCourse.update({ where: { id: edited.id }, data: { updatedById: people.x, version: 2 } });
    const gone = (await courseOf(U.gone))!;
    await prisma.trainingCourse.delete({ where: { id: gone.id } });
    const vFresh = (await courseOf(U.vFresh))!;
    await prisma.trainingLesson.update({ where: { id: vFresh.lessons[0]!.id }, data: { videoProvider: 'YOUTUBE', videoId: 'dQw4w9WgXcQ', videoUrl: 'https://youtu.be/dQw4w9WgXcQ' } });
    const vEdited = (await courseOf(U.vEdited))!;
    return { mod, a: a!, b: b!, q: q!, edited, vEdited };
  }

  it('updates only the untouched courses, keeps every person’s progress, and finishes people who now have done every lesson', async () => {
    const before = await liveSite();
    const oldFile = await prisma.trainingFile.findFirstOrThrow({ where: { courseId: before.mod.id, kind: 'IMAGE' } });
    const oldResource = await prisma.trainingFile.findFirstOrThrow({ where: { courseId: before.mod.id, kind: 'RESOURCE' } });
    const progressBefore = await prisma.trainingProgress.count({ where: { userId: { in: Object.values(people) } } });
    const xBefore = await enrolment(people.x, before.mod.id);

    const out = await upgrader(rev2(), 2).run();
    expect(out.already).toBe(true);
    expect(out.updated).toBe(2);

    // The untouched course: same row and lesson ids where the lesson is the same; new words and order; still published, version 1, not edited.
    const mod = (await courseOf(U.mod))!;
    expect(mod.id).toBe(before.mod.id);
    expect(mod).toMatchObject({ title: 'Mod basics (new)', status: 'PUBLISHED', version: 1, updatedById: null });
    expect(mod.lessons.map((l) => [l.position, l.kind, l.title])).toEqual([
      [0, 'VIDEO', 'Video: Mod'],
      [1, 'GUIDE', 'Guide A'],
      [2, 'QUIZ', 'Quiz: Mod'],
    ]);
    expect(mod.lessons[1]!.id).toBe(before.a.id);
    expect(mod.lessons[2]!.id).toBe(before.q.id);
    expect(await prisma.trainingLesson.count({ where: { id: before.b.id } })).toBe(0);
    // It still reads as published with nothing changed since (the next update reaches it too).
    for (const l of mod.lessons) expect(l.updatedAt.getTime()).toBeLessThanOrEqual(mod.publishedAt!.getTime());
    expect(mod.updatedAt.getTime()).toBeLessThanOrEqual(mod.publishedAt!.getTime());
    expect(mod.lessons[0]!.videoId).toBeNull();

    // Pictures: the new one in the private folder, the step pointing at it; the old one gone (row and file). The unchanged PDF kept.
    const pics = await prisma.trainingFile.findMany({ where: { courseId: mod.id, kind: 'IMAGE' } });
    expect(pics.map((f) => f.name)).toEqual(['pic-a2.webp']);
    expect(mod.lessons[1]!.steps.map((s) => [s.title, s.imageFileId])).toEqual([
      ['One again', pics[0]!.id],
      ['Two again', null],
    ]);
    expect(readFileSync(join(privateDir, pics[0]!.storageKey)).equals(WEBP2)).toBe(true);
    expect(existsSync(join(privateDir, oldFile.storageKey))).toBe(false);
    expect((await prisma.trainingFile.findMany({ where: { courseId: mod.id, kind: 'RESOURCE' } })).map((f) => f.id)).toEqual([oldResource.id]);

    // The quiz: the same question keeps its id; the ORDER question swapped for a single choice.
    const qs = mod.lessons[2]!.quiz!.questions;
    expect(qs.map((x) => [x.kind, x.prompt])).toEqual([
      ['SINGLE', 'Where are your tasks?'],
      ['SINGLE', 'Which button adds a task?'],
    ]);
    expect(qs[0]!.options.map((o) => [o.text, o.correct])).toEqual([
      ['My Tasks page', true],
      ['Chat', false],
    ]);

    // Nobody's data lost: every progress row stays (the removed lesson's are ignored), attempts untouched.
    expect(await prisma.trainingProgress.count({ where: { userId: { in: Object.values(people) } } })).toBe(progressBefore);
    expect(await prisma.trainingAttempt.count({ where: { userId: people.w } })).toBe(1);
    // Finished stays finished (never recalculated); W had done every lesson left → finished now (R3);
    // Y is half way (the hidden video doesn't count); Z's place is on the guide's last step.
    expect((await enrolment(people.x, mod.id)).completedAt!.getTime()).toBe(xBefore.completedAt!.getTime());
    expect((await enrolment(people.w, mod.id)).completedAt).not.toBeNull();
    expect((await enrolment(people.y, mod.id)).completedAt).toBeNull();
    expect((await enrolment(people.y, mod.id)).progressPct).toBe(50);
    expect((await prisma.trainingProgress.findFirstOrThrow({ where: { userId: people.z, lessonId: before.a.id } })).stepIndex).toBe(1);

    // The edited course is left alone; the deleted one stays deleted; the new course is there, first.
    const edited = (await courseOf(U.edited))!;
    expect(edited.title).toBe('Edited basics');
    expect(edited.lessons.map((l) => l.id)).toEqual(before.edited.lessons.map((l) => l.id));
    expect(await courseOf(U.gone)).toBeNull();
    const fresh = (await courseOf(U.fresh))!;
    expect(fresh).toMatchObject({ status: 'PUBLISHED', position: -1, moduleKey: 'general' });

    // R4: the untouched draft video course without a link is removed; the one whose module course was edited stays;
    // the linked one gives its link to its course's video lesson (shown at once) and stays.
    expect(await courseOf(U.vMod)).toBeNull();
    expect((await courseOf(U.vEdited))?.id).toBe(before.vEdited.id);
    expect((await courseOf(U.vFresh))).not.toBeNull();
    expect(fresh.lessons[0]).toMatchObject({ kind: 'VIDEO', videoId: 'dQw4w9WgXcQ', videoProvider: 'YOUTUBE' });
    expect(fresh.lessons[0]!.updatedAt.getTime()).toBeLessThanOrEqual(fresh.publishedAt!.getTime());

    // The revision is noted, with every key loaded so far.
    const noted = (await prisma.systemSetting.findUniqueOrThrow({ where: { key: STARTER_REVISION_KEY } })).value as { revision: number; keys: string[] };
    expect(noted.revision).toBe(2);
    expect([...noted.keys].sort()).toEqual([...allKeys].sort());
  });

  it('runs once per revision: a second start changes nothing', async () => {
    await liveSite();
    await upgrader(rev2(), 2).run();
    const snapshot = async () => {
      const c = (await courseOf(U.mod))!;
      return { lessons: c.lessons.map((l) => [l.id, l.updatedAt.getTime()]), files: (await prisma.trainingFile.findMany({ where: { courseId: c.id }, orderBy: { id: 'asc' } })).map((f) => f.id) };
    };
    const first = await snapshot();
    const filesOnDisk = readdirSync(privateDir).length;
    const out = await upgrader(rev2(), 2).run();
    expect(out.updated).toBeUndefined();
    expect(await snapshot()).toEqual(first);
    expect(readdirSync(privateDir).length).toBe(filesOnDisk);
  });

  it('a pasted video link is not an edit: the next revision still reaches the course, and keeps the link', async () => {
    await liveSite();
    await upgrader(rev2(), 2).run();
    const mod = (await courseOf(U.mod))!;
    // As the Learning Hub's Save lesson does it (a link-only change keeps the lesson's stamp).
    await prisma.trainingLesson.update({ where: { id: mod.lessons[0]!.id }, data: { videoProvider: 'VIMEO', videoId: '76979871', videoUrl: 'https://vimeo.com/76979871', updatedAt: mod.lessons[0]!.updatedAt } });
    const rev3 = rev2();
    const m = rev3.find((c) => c.key === U.mod)!;
    m.title = 'Mod basics (third)';
    m.lessons[1] = { ...(m.lessons[1] as Extract<StarterLesson, { kind: 'GUIDE' }>), title: 'Guide A, again', was: ['Old guide A', 'Guide A'] };
    expect((await upgrader(rev3, 3).run()).updated).toBeGreaterThanOrEqual(1);
    const after = (await courseOf(U.mod))!;
    expect(after.title).toBe('Mod basics (third)');
    expect(after.lessons.map((l) => l.title)).toEqual(['Video: Mod', 'Guide A, again', 'Quiz: Mod']);
    expect(after.lessons[0]).toMatchObject({ id: mod.lessons[0]!.id, videoProvider: 'VIMEO', videoId: '76979871' });
  });

  it('an administrator’s lesson edit (even with nobody named on the course) keeps the course out of the update', async () => {
    const before = await liveSite();
    await prisma.trainingLesson.update({ where: { id: before.b.id }, data: { title: 'Old guide B (edited)', updatedAt: new Date() } });
    await upgrader(rev2(), 2).run();
    const mod = (await courseOf(U.mod))!;
    expect(mod.title).toBe('Mod basics');
    expect(mod.lessons.map((l) => l.title)).toEqual(['Old guide A', 'Old guide B (edited)', 'Quiz: Mod']);
    // Its module course left alone: the draft video course without a link has nowhere to go and stays.
    expect(await courseOf(U.vMod)).not.toBeNull();
  });

  it('review M2: a draft video course whose lesson an administrator changed is kept (even without a link)', async () => {
    await liveSite();
    const v = (await courseOf(U.vMod))!;
    await prisma.trainingLesson.update({ where: { id: v.lessons[0]!.id }, data: { title: 'Watch this', updatedAt: new Date(Date.now() + 60_000) } });
    await upgrader(rev2(), 2).run();
    expect(await courseOf(U.vMod)).not.toBeNull();
  });

  it('review M3: a video lesson with a link is never removed, even if a later revision forgot its old title', async () => {
    await liveSite();
    await upgrader(rev2(), 2).run();
    const mod = (await courseOf(U.mod))!;
    await prisma.trainingLesson.update({ where: { id: mod.lessons[0]!.id }, data: { videoProvider: 'YOUTUBE', videoId: 'dQw4w9WgXcQ', videoUrl: 'https://youtu.be/dQw4w9WgXcQ', updatedAt: mod.lessons[0]!.updatedAt } });
    const rev3 = rev2();
    const m = rev3.find((c) => c.key === U.mod)!;
    m.lessons[0] = { kind: 'VIDEO', title: 'Video: Mod, renamed', minutes: 2, videoUrl: null };
    await upgrader(rev3, 3).run();
    const after = (await courseOf(U.mod))!;
    const linked = after.lessons.filter((l) => l.videoId === 'dQw4w9WgXcQ');
    expect(linked.map((l) => l.id)).toEqual([mod.lessons[0]!.id]);
  });

  it('a new site: the first load is the newest revision (nothing to update afterwards)', async () => {
    const out = await upgrader(rev2(), 2).run();
    expect(out).toEqual({ loaded: 4, skipped: 0, already: false });
    expect(((await prisma.systemSetting.findUniqueOrThrow({ where: { key: STARTER_REVISION_KEY } })).value as { revision: number }).revision).toBe(2);
    expect((await upgrader(rev2(), 2).run()).updated).toBeUndefined();
  });
});
