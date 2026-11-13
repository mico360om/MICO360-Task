import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Requires a running MySQL / MariaDB (TEST_DATABASE_URL) with migrations applied.
// Learning Hub as one course (1.23.30): modules inside a course, recorded module completion, a lesson's
// module, the certificate's completion day and module list, and an assignment batch.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
const TAG = `lhmod-${Date.now()}`;
const ids: { course?: string } = {};

async function code(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
}

describe('training modules schema', () => {
  afterAll(async () => {
    await prisma.trainingCertificate.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.trainingAssignment.deleteMany({ where: { targetId: TAG } });
    await prisma.trainingModuleDone.deleteMany({ where: { userId: TAG } });
    if (ids.course) await prisma.trainingCourse.deleteMany({ where: { id: ids.course } });
    await prisma.$disconnect();
  });

  it('stores modules, completion, lesson module, certificate and batch fields', async () => {
    const course = await prisma.trainingCourse.create({ data: { title: `${TAG} course`, moduleKey: 'general' } });
    ids.course = course.id;

    const m1 = await prisma.trainingModule.create({
      data: { courseId: course.id, position: 1, title: 'Tasks', moduleKey: 'tasks', starterKey: `${TAG}:a` },
    });
    expect(m1.enabled).toBe(true);
    expect(m1.moduleKey).toBe('tasks');
    expect(m1.roleKeys).toBeNull();
    expect(m1.offReason).toBeNull();

    // The same starterKey twice on one course is refused; null twice is fine.
    const dup = await code(prisma.trainingModule.create({ data: { courseId: course.id, title: 'Dup', starterKey: `${TAG}:a` } }));
    expect(dup).toBe('P2002');
    await prisma.trainingModule.create({ data: { courseId: course.id, title: 'Own 1' } });
    await prisma.trainingModule.create({ data: { courseId: course.id, title: 'Own 2' } });
    expect(await prisma.trainingModule.count({ where: { courseId: course.id } })).toBe(3);

    const lesson = await prisma.trainingLesson.create({
      data: { courseId: course.id, kind: 'GUIDE', title: 'L', moduleId: m1.id },
    });
    expect(lesson.moduleId).toBe(m1.id);

    const done = await prisma.trainingModuleDone.create({
      data: { userId: TAG, courseId: course.id, moduleId: m1.id, doneAt: new Date() },
    });
    expect(done.via).toBe('LEARNED');
    const dup2 = await code(
      prisma.trainingModuleDone.create({ data: { userId: TAG, courseId: course.id, moduleId: m1.id, doneAt: new Date(), via: 'CONVERTED' } }),
    );
    expect(dup2).toBe('P2002');

    const cert = await prisma.trainingCertificate.create({
      data: {
        code: `${TAG}-c`,
        userId: TAG,
        courseId: course.id,
        learnerName: 'A',
        courseTitle: 'T',
        completedAt: new Date('2026-11-03T00:00:00Z'),
        moduleIds: ['m1'],
      },
    });
    expect(cert.completedAt?.toISOString()).toBe('2026-11-03T00:00:00.000Z');
    expect(cert.moduleIds).toEqual(['m1']);

    const asg = await prisma.trainingAssignment.create({
      data: { courseId: course.id, targetKind: 'USER', targetId: TAG, batchId: 'batch-1' },
    });
    expect(asg.batchId).toBe('batch-1');

    // Deleting the course deletes its modules.
    await prisma.trainingCertificate.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.trainingAssignment.deleteMany({ where: { targetId: TAG } });
    await prisma.trainingCourse.delete({ where: { id: course.id } });
    expect(await prisma.trainingModule.count({ where: { courseId: course.id } })).toBe(0);
  });
});
