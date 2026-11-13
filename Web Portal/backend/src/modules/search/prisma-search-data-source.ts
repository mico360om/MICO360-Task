import type { PrismaClient } from '@prisma/client';
import type { SearchDataSource } from './search-service';
import { STAFF_ONLY_WHERE } from '../clients/client-kind';

/**
 * The top bar's snapshot: projects and people by name (who may see which is applied on every search).
 * Meetings are not read here (review #22/#10, 13 Nov 2026): the top bar finds them in the search index
 * with the person's access as it is now (top-bar-meetings.ts) — no slice of the oldest meetings, no
 * attendees kept between requests.
 */
export function createPrismaSearchDataSource(prisma: PrismaClient): SearchDataSource {
  return {
    async getSearchData() {
      const [projects, users] = await Promise.all([
        prisma.project.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true } }),
        // Email is deliberately not selected — it must never reach search clients.
        // 1.23: client accounts are never found as people.
        prisma.user.findMany({ where: { deletedAt: null, ...STAFF_ONLY_WHERE }, select: { id: true, username: true, firstName: true, lastName: true } }),
      ]);
      // Tasks are searched per request (task-search-engine), not from this snapshot.
      return { tasks: [], projects, users };
    },
  };
}
