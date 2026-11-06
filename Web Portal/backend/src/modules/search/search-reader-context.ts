import type { PrismaClient } from '@prisma/client';
import { todayKey } from '../../lib/due-date';
import type { ReaderContext, ReaderPerson, ReaderProject } from './search-reader';
import type { SearchScopeAll } from './search-scope';
import type { SearchViewer } from './task-search-scope';

/** A person's projects and people are kept this long (the reader runs on every search typed). */
export const READER_CONTEXT_TTL_MS = 60_000;
const MAX_KEPT = 500;

/**
 * 1.23.6 The built-in reader's context for one person: today and the week's first day of the company,
 * and the projects (their search scope: companies, team, "Show my projects only", the pick) and people
 * (those they may find; never a client account) they may see — so nothing else is ever read as a
 * project or a name. Kept for a minute per person and picked company.
 */
export function createReaderContext({
  prisma,
  timeZone,
  weekStart,
  now = () => new Date(),
  clock = () => Date.now(),
}: {
  prisma: Pick<PrismaClient, 'project' | 'user'>;
  timeZone: string;
  /** The week's first day for this person and pick (their company's). */
  weekStart: (viewer: SearchViewer, pick: string | null) => Promise<number>;
  now?: () => Date;
  clock?: () => number;
}) {
  const kept = new Map<string, { at: number; projects: ReaderProject[]; people: ReaderPerson[] }>();
  return async function contextFor(viewer: SearchViewer, pick: string | null, scope: SearchScopeAll, people: () => Promise<ReadonlySet<string> | null>): Promise<ReaderContext> {
    const key = `${viewer.id}|${pick ?? ''}`;
    let found = kept.get(key);
    if (!found || clock() - found.at > READER_CONTEXT_TTL_MS) {
      const allowed = await people();
      const [projects, users] = await Promise.all([
        prisma.project.findMany({ where: { deletedAt: null, ...(scope.projectIds ? { id: { in: scope.projectIds } } : {}) }, select: { id: true, code: true, name: true } }),
        prisma.user.findMany({ where: { deletedAt: null, ...(allowed ? { id: { in: [...allowed] } } : {}), roles: { none: { role: { name: 'CLIENT' } } } }, select: { id: true, firstName: true, lastName: true, username: true } }),
      ]);
      found = { at: clock(), projects, people: users };
      if (kept.size >= MAX_KEPT) kept.delete(kept.keys().next().value!);
      kept.set(key, found);
    }
    return { today: todayKey(timeZone, now()), weekStart: await weekStart(viewer, pick).catch(() => 0), projects: found.projects, people: found.people };
  };
}
