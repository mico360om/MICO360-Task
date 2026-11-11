import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrainingStarter, LAUNCHED_KEY, STARTER_LOADED_KEY } from '../../src/modules/training/training-starter';
import { createTrainingFileStore } from '../../src/modules/training/training-files';
import type { StarterCourse } from '../../src/modules/training/starter/starter-types';

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
  await prisma.systemSetting.deleteMany({ where: { key: { in: [LAUNCHED_KEY, STARTER_LOADED_KEY] } } });
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
    expect(await createTrainingStarter({ prisma, files: store, courses: [courses[0]!, bad], assetsDir: assets, logger: logger() }).run()).toEqual({ loaded: 1, skipped: 1, already: false });
    expect(await prisma.systemSetting.count({ where: { key: STARTER_LOADED_KEY } })).toBe(1);
    expect((await ourCourses()).length).toBe(2);
  });
});
