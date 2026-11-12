import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrainingStarter, LAUNCHED_KEY, STARTER_LOADED_KEY } from '../../src/modules/training/training-starter';
import { createStarterPdfRemoval, OLD_STARTER_PDFS, REMOVED_STARTER_PDFS_KEY } from '../../src/modules/training/training-starter-pdfs';
import { createTrainingFileStore } from '../../src/modules/training/training-files';
import type { StarterCourse } from '../../src/modules/training/starter/starter-types';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// 1.23.25: the two how-to slide PDFs that 1.23.22–1.23.24 attached to the Tasks and Meetings starter courses
// are removed once from a site that has them — the two download rows and their stored files, found by their
// starter identity — and nothing else: other downloads, pictures, lessons, progress, enrolments,
// certificates and every course's edit stamps (updatedAt, updatedById, version, publishedAt) stay as they are.
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const KEYS = ['starter:tasks', 'starter:meetings', 'starter:board'];

const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(14, 1)]);
const pdf = (label: string) => Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`, 'utf8');

let assets: string;
let privateDir: string;

const guide = (image: string) => ({
  kind: 'GUIDE' as const,
  title: 'Find and add',
  minutes: 5,
  steps: [{ title: 'Open it', body: '<p>Open the page.</p>', image, alt: 'The page' }],
});
const quiz = {
  kind: 'QUIZ' as const,
  title: 'Check yourself',
  minutes: 3,
  quiz: { passMark: 70, maxAttempts: null, shuffle: true, timeLimitMinutes: null, drawCount: null, questions: [{ kind: 'TRUE_FALSE' as const, prompt: 'Is it easy?', options: [{ text: 'True', correct: true }, { text: 'False', correct: false }] }] },
};
const course = (key: string, title: string, over: Partial<StarterCourse> = {}): StarterCourse => ({
  key,
  title,
  summary: `${title} in short.`,
  moduleKey: 'tasks',
  audience: 'STAFF',
  difficulty: 'BEGINNER',
  status: 'PUBLISHED',
  completionRule: 'ALL_LESSONS',
  certificateOn: false,
  certificateMonths: null,
  lessons: [guide('shot.webp'), quiz],
  ...over,
});

/** The starter content as 1.23.22–1.23.24 shipped it: the Tasks and Meetings courses carry the slides. */
const asShipped = (): StarterCourse[] => [
  course('starter:tasks', 'Tasks basics', { resources: [{ file: 'tasks-how-to.pdf', name: 'Tasks how-to slides (PDF)', mimeType: 'application/pdf' }] }),
  course('starter:meetings', 'Meetings & minutes', { moduleKey: 'meetings', resources: [{ file: 'meetings-how-to.pdf', name: 'Meetings how-to slides (PDF)', mimeType: 'application/pdf' }] }),
  course('starter:board', 'Kanban board', { moduleKey: 'board' }),
];

const loadedAt = new Date('2026-11-12T08:00:00.000Z');

async function loadAsShipped(): Promise<void> {
  const out = await createTrainingStarter({ prisma, files: createTrainingFileStore(privateDir), courses: asShipped(), assetsDir: assets, now: () => loadedAt }).run();
  expect(out.loaded).toBe(3);
}

const removal = (now = () => new Date('2026-11-13T05:00:00.000Z')) => {
  const log = { infos: [] as { msg: string; meta?: Record<string, unknown> }[], warnings: [] as { msg: string; meta?: Record<string, unknown> }[] };
  const r = createStarterPdfRemoval({
    prisma,
    files: createTrainingFileStore(privateDir),
    now,
    logger: { info: (msg, meta) => log.infos.push({ msg, meta }), warn: (msg, meta) => log.warnings.push({ msg, meta }) },
  });
  return Object.assign(r, { log });
};

const courseIds = async () => (await prisma.trainingCourse.findMany({ where: { starterKey: { in: KEYS } }, select: { id: true } })).map((c) => c.id);
const byKey = (key: string) => prisma.trainingCourse.findUniqueOrThrow({ where: { starterKey: key } });

/** Everything the step must not change, keyed so two snapshots compare whole. */
async function snapshot() {
  const ids = await courseIds();
  const where = { courseId: { in: ids } };
  return {
    courses: await prisma.trainingCourse.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } }),
    lessons: await prisma.trainingLesson.findMany({ where, orderBy: { id: 'asc' } }),
    steps: await prisma.trainingStep.findMany({ where: { lesson: { courseId: { in: ids } } }, orderBy: { id: 'asc' } }),
    files: await prisma.trainingFile.findMany({ where, orderBy: { id: 'asc' } }),
    progress: await prisma.trainingProgress.findMany({ where, orderBy: { id: 'asc' } }),
    enrolments: await prisma.trainingEnrolment.findMany({ where, orderBy: { id: 'asc' } }),
    certificates: await prisma.trainingCertificate.findMany({ where, orderBy: { id: 'asc' } }),
    settings: await prisma.systemSetting.findMany({ where: { key: { in: [LAUNCHED_KEY, STARTER_LOADED_KEY] } }, orderBy: { key: 'asc' } }),
  };
}

const theSlides = () => prisma.trainingFile.findMany({ where: { starter: true, kind: 'RESOURCE' }, orderBy: { name: 'asc' } });

async function clean() {
  const ids = await courseIds();
  const where = { courseId: { in: ids } };
  await prisma.trainingProgress.deleteMany({ where });
  await prisma.trainingEnrolment.deleteMany({ where });
  await prisma.trainingCertificate.deleteMany({ where });
  await prisma.trainingFile.deleteMany({ where });
  await prisma.trainingCourse.deleteMany({ where: { id: { in: ids } } });
  await prisma.systemSetting.deleteMany({ where: { key: { in: [LAUNCHED_KEY, STARTER_LOADED_KEY, REMOVED_STARTER_PDFS_KEY] } } });
  rmSync(privateDir, { recursive: true, force: true });
}

beforeAll(async () => {
  assets = mkdtempSync(join(tmpdir(), 'starter-pdfs-assets-'));
  writeFileSync(join(assets, 'shot.webp'), WEBP);
  writeFileSync(join(assets, 'tasks-how-to.pdf'), pdf('tasks slides'));
  writeFileSync(join(assets, 'meetings-how-to.pdf'), pdf('meetings slides'));
  privateDir = join(mkdtempSync(join(tmpdir(), 'starter-pdfs-private-')), 'training-files');
});

beforeEach(clean);

afterAll(async () => {
  await clean();
  rmSync(assets, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe('1.23.25: the old starter how-to PDFs are removed once', () => {
  it('knows the two downloads by the names and starter courses 1.23.24 gave them', () => {
    expect(OLD_STARTER_PDFS).toEqual([
      { courseKey: 'starter:tasks', name: 'Tasks how-to slides (PDF)' },
      { courseKey: 'starter:meetings', name: 'Meetings how-to slides (PDF)' },
    ]);
  });

  it('removes both downloads and their stored files; everything else is exactly as it was; the step is recorded', async () => {
    await loadAsShipped();
    const slides = await theSlides();
    expect(slides.map((f) => f.name)).toEqual(['Meetings how-to slides (PDF)', 'Tasks how-to slides (PDF)']);
    for (const f of slides) expect(existsSync(join(privateDir, f.storageKey))).toBe(true);
    const before = await snapshot();
    const filesOnDisk = readdirSync(privateDir).length;

    const r = removal();
    expect(await r.run()).toEqual({ already: false, removed: 2, filesLeft: 0, lessonsUnlinked: 0, restored: 0 });

    expect(await theSlides()).toEqual([]);
    for (const f of slides) expect(existsSync(join(privateDir, f.storageKey))).toBe(false);
    expect(readdirSync(privateDir).length).toBe(filesOnDisk - 2);
    const after = await snapshot();
    const gone = new Set(slides.map((f) => f.id));
    expect(after).toEqual({ ...before, files: before.files.filter((f) => !gone.has(f.id)) });
    expect((await prisma.systemSetting.findUniqueOrThrow({ where: { key: REMOVED_STARTER_PDFS_KEY } })).value).toBe('2026-11-13T05:00:00.000Z');
    expect(r.log.infos.map((i) => i.msg).join('\n')).toMatch(/how-to/i);
    expect(r.log.warnings).toEqual([]);
  });

  it('an edited course keeps its own downloads and its edit stamps; an untouched course stays untouched', async () => {
    await loadAsShipped();
    const tasks = await byKey('starter:tasks');
    // An administrator edited the Tasks course: a new version, an extra download, changes not yet published.
    await prisma.trainingCourse.update({ where: { id: tasks.id }, data: { version: 2, updatedById: 'admin-1', publishedAt: new Date('2026-11-12T09:00:00.000Z'), updatedAt: new Date('2026-11-12T10:00:00.000Z') } });
    const lesson = await prisma.trainingLesson.findFirstOrThrow({ where: { courseId: tasks.id, position: 0 } });
    await prisma.trainingLesson.update({ where: { id: lesson.id }, data: { title: 'Find and add tasks (edited)', updatedAt: new Date('2026-11-12T10:00:00.000Z') } });
    const store = createTrainingFileStore(privateDir);
    const extraKey = await store.save(pdf('site rules'), 'application/pdf');
    const extra = await prisma.trainingFile.create({ data: { courseId: tasks.id, kind: 'RESOURCE', name: 'Site rules.pdf', mimeType: 'application/pdf', sizeBytes: 30, storageKey: extraKey, position: 9, uploadedById: 'admin-1' } });
    // Even an upload that happens to carry the same name is the administrator's own: it stays.
    const sameNameKey = await store.save(pdf('own copy'), 'application/pdf');
    const sameName = await prisma.trainingFile.create({ data: { courseId: tasks.id, kind: 'RESOURCE', name: 'Tasks how-to slides (PDF)', mimeType: 'application/pdf', sizeBytes: 30, storageKey: sameNameKey, position: 10, uploadedById: 'admin-1' } });
    const before = await snapshot();

    expect((await removal().run()).removed).toBe(2);

    const after = await snapshot();
    expect(after.courses).toEqual(before.courses);
    expect(after.lessons).toEqual(before.lessons);
    const editedNow = after.courses.find((c) => c.id === tasks.id)!;
    expect(editedNow).toMatchObject({ version: 2, updatedById: 'admin-1' });
    expect(editedNow.updatedAt.toISOString()).toBe('2026-11-12T10:00:00.000Z');
    const untouched = await byKey('starter:meetings');
    expect(untouched).toMatchObject({ version: 1, updatedById: null });
    expect(untouched.updatedAt.toISOString()).toBe(loadedAt.toISOString());
    expect((await prisma.trainingLesson.findMany({ where: { courseId: untouched.id } })).every((l) => l.updatedAt.getTime() === loadedAt.getTime())).toBe(true);

    const left = await prisma.trainingFile.findMany({ where: { courseId: tasks.id, kind: 'RESOURCE' }, orderBy: { position: 'asc' } });
    expect(left.map((f) => f.id)).toEqual([extra.id, sameName.id]);
    expect(existsSync(join(privateDir, extraKey))).toBe(true);
    expect(existsSync(join(privateDir, sameNameKey))).toBe(true);
  });

  it('learners are untouched: progress, enrolments and certificates stay exactly as they were', async () => {
    await loadAsShipped();
    const tasks = await byKey('starter:tasks');
    const [l1, l2] = await prisma.trainingLesson.findMany({ where: { courseId: tasks.id }, orderBy: { position: 'asc' } });
    await prisma.trainingEnrolment.create({ data: { userId: 'learner-1', courseId: tasks.id, startedAt: new Date('2026-11-12T11:00:00Z'), progressPct: 50, lastLessonId: l1!.id, lastActivityAt: new Date('2026-11-12T11:05:00Z') } });
    await prisma.trainingProgress.create({ data: { userId: 'learner-1', courseId: tasks.id, lessonId: l1!.id, doneAt: new Date('2026-11-12T11:05:00Z'), stepIndex: 1 } });
    await prisma.trainingProgress.create({ data: { userId: 'learner-1', courseId: tasks.id, lessonId: l2!.id } });
    const meetings = await byKey('starter:meetings');
    await prisma.trainingEnrolment.create({ data: { userId: 'learner-2', courseId: meetings.id, startedAt: new Date('2026-11-12T11:00:00Z'), completedAt: new Date('2026-11-12T12:00:00Z'), completedVersion: 1, progressPct: 100 } });
    await prisma.trainingCertificate.create({ data: { code: `NOX-${Date.now().toString(36).toUpperCase()}`, userId: 'learner-2', courseId: meetings.id, learnerName: 'Learner Two', courseTitle: 'Meetings & minutes', scorePct: 100 } });
    const before = await snapshot();

    await removal().run();

    const after = await snapshot();
    expect(after.progress).toEqual(before.progress);
    expect(after.enrolments).toEqual(before.enrolments);
    expect(after.certificates).toEqual(before.certificates);
  });

  it('runs once: a second run does nothing, and a run without the record finds nothing more to do', async () => {
    await loadAsShipped();
    expect((await removal().run()).removed).toBe(2);
    const before = await snapshot();
    const onDisk = readdirSync(privateDir).sort();

    expect(await removal().run()).toEqual({ already: true, removed: 0, filesLeft: 0, lessonsUnlinked: 0, restored: 0 });
    // Safe to re-run even if the record were lost: nothing else is touched, and the record is written again.
    await prisma.systemSetting.delete({ where: { key: REMOVED_STARTER_PDFS_KEY } });
    expect(await removal(() => new Date('2026-11-14T05:00:00.000Z')).run()).toEqual({ already: false, removed: 0, filesLeft: 0, lessonsUnlinked: 0, restored: 0 });
    expect(await snapshot()).toEqual(before);
    expect(readdirSync(privateDir).sort()).toEqual(onDisk);
    expect((await prisma.systemSetting.findUniqueOrThrow({ where: { key: REMOVED_STARTER_PDFS_KEY } })).value).toBe('2026-11-14T05:00:00.000Z');
  });

  it('a site without the slides (new, or never loaded) only records the step', async () => {
    expect(await removal().run()).toEqual({ already: false, removed: 0, filesLeft: 0, lessonsUnlinked: 0, restored: 0 });
    expect(await prisma.systemSetting.count({ where: { key: REMOVED_STARTER_PDFS_KEY } })).toBe(1);
  });

  it('stored files already missing are no problem: the downloads still go', async () => {
    await loadAsShipped();
    for (const f of await theSlides()) rmSync(join(privateDir, f.storageKey));
    const r = removal();
    expect(await r.run()).toMatchObject({ removed: 2, filesLeft: 0 });
    expect(await theSlides()).toEqual([]);
    expect(r.log.warnings).toEqual([]);
  });

  it('a file that cannot be deleted is warned about (with its key); the download still goes', async () => {
    await loadAsShipped();
    const store = createTrainingFileStore(privateDir);
    const stuck = (await theSlides()).find((f) => f.name.startsWith('Meetings'))!;
    const r = createStarterPdfRemoval({
      prisma,
      files: { ...store, dir: store.dir, remove: async (key: string) => (key === stuck.storageKey ? Promise.reject(Object.assign(new Error('busy'), { code: 'EBUSY' })) : store.remove(key)) },
      now: () => new Date('2026-11-13T05:00:00.000Z'),
      logger: { info() {}, warn: (msg: string, meta?: Record<string, unknown>) => warnings.push({ msg, meta }) },
    });
    const warnings: { msg: string; meta?: Record<string, unknown> }[] = [];
    expect(await r.run()).toMatchObject({ removed: 2, filesLeft: 1 });
    expect(await theSlides()).toEqual([]);
    expect(warnings.some((w) => w.meta?.storageKey === stuck.storageKey)).toBe(true);
  });

  it('found by its starter course even if the name were different; other starter files (pictures) stay', async () => {
    await loadAsShipped();
    const tasks = await byKey('starter:tasks');
    const slide = (await theSlides()).find((f) => f.courseId === tasks.id)!;
    await prisma.trainingFile.update({ where: { id: slide.id }, data: { name: 'Tasks how-to slides (PDF).pdf' } });
    const pictures = await prisma.trainingFile.findMany({ where: { starter: true, kind: 'IMAGE', courseId: { in: await courseIds() } } });
    expect(pictures.length).toBe(3);

    expect((await removal().run()).removed).toBe(2);
    expect(await prisma.trainingFile.count({ where: { id: slide.id } })).toBe(0);
    expect(await prisma.trainingFile.count({ where: { id: { in: pictures.map((p) => p.id) } } })).toBe(3);
  });

  it('a document lesson an administrator pointed at a slide PDF loses only that link (its own stamp kept)', async () => {
    await loadAsShipped();
    const tasks = await byKey('starter:tasks');
    const slide = (await theSlides()).find((f) => f.courseId === tasks.id)!;
    const doc = await prisma.trainingLesson.create({ data: { courseId: tasks.id, position: 2, kind: 'DOCUMENT', title: 'Read the slides', minutes: 5, fileId: slide.id } });
    await prisma.trainingLesson.update({ where: { id: doc.id }, data: { updatedAt: new Date('2026-11-12T09:30:00.000Z') } });

    expect(await removal().run()).toMatchObject({ removed: 2, lessonsUnlinked: 1 });
    const now = await prisma.trainingLesson.findUniqueOrThrow({ where: { id: doc.id } });
    expect(now.fileId).toBeNull();
    expect(now.updatedAt.toISOString()).toBe('2026-11-12T09:30:00.000Z');
    expect(now.title).toBe('Read the slides');
  });

  it('if anything re-stamps a course or lesson while the downloads go, the stamps are put back', async () => {
    await loadAsShipped();
    const before = await snapshot();
    // A stand-in for anything that would mark the course edited when a download goes (a trigger, say).
    const meddling = new Proxy(prisma, {
      get(target, prop) {
        if (prop !== '$transaction') return Reflect.get(target, prop);
        return (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, opts?: object) =>
          target.$transaction(
            (tx) =>
              fn(
                new Proxy(tx, {
                  get(t, p) {
                    if (p !== 'trainingFile') return Reflect.get(t, p);
                    const files = Reflect.get(t, p) as Prisma.TransactionClient['trainingFile'];
                    return new Proxy(files, {
                      get(ft, fp) {
                        if (fp !== 'deleteMany') return Reflect.get(ft, fp);
                        return async (args: Prisma.TrainingFileDeleteManyArgs) => {
                          const out = await ft.deleteMany(args);
                          const ids = (await t.trainingCourse.findMany({ where: { starterKey: { in: ['starter:tasks', 'starter:meetings'] } }, select: { id: true } })).map((c) => c.id);
                          await t.trainingCourse.updateMany({ where: { id: { in: ids } }, data: { updatedById: 'system', version: { increment: 1 }, updatedAt: new Date() } });
                          await t.trainingLesson.updateMany({ where: { courseId: { in: ids } }, data: { updatedAt: new Date() } });
                          return out;
                        };
                      },
                    });
                  },
                }),
              ),
            opts,
          );
      },
    });
    const r = createStarterPdfRemoval({ prisma: meddling, files: createTrainingFileStore(privateDir), now: () => new Date('2026-11-13T05:00:00.000Z') });
    const out = await r.run();
    expect(out).toMatchObject({ removed: 2 });
    expect(out.restored).toBeGreaterThan(0);
    const after = await snapshot();
    expect(after.courses).toEqual(before.courses);
    expect(after.lessons).toEqual(before.lessons);
  });

  it('two runs at once remove each download once', async () => {
    await loadAsShipped();
    const r = removal();
    const [a, b] = await Promise.all([r.run(), r.run()]);
    expect(a).toEqual({ already: false, removed: 2, filesLeft: 0, lessonsUnlinked: 0, restored: 0 });
    expect(b).toBe(a);
    expect(await theSlides()).toEqual([]);
  });
});
