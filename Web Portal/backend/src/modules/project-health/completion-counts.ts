import type { PrismaClient } from '@prisma/client';
import { healthReads } from './prisma-health-source';

/**
 * 1.23.5: a project's completion as finished ÷ total in its own mode — tasks counted (COUNT), or their
 * weights added up (WEIGHT) — for the pages that show a percentage from two numbers (the Client portal,
 * the client page). Live tasks only (merged and deleted ones left out), as the project page counts them.
 */
export function createCompletionCounts(prisma: PrismaClient): (projectId: string) => Promise<{ total: number; done: number }> {
  const reads = healthReads(prisma);
  return async (projectId) => {
    const [project, [f]] = await Promise.all([prisma.project.findUnique({ where: { id: projectId }, select: { completionMode: true } }), reads.figures([projectId])]);
    if (!f) return { total: 0, done: 0 };
    return project?.completionMode === 'WEIGHT' ? { total: Number(f.weightTotal ?? 0), done: Number(f.weightDone ?? 0) } : { total: Number(f.total ?? 0), done: Number(f.done ?? 0) };
  };
}
