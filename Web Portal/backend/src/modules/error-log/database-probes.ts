import type { PrismaClient } from '@prisma/client';
import type { TaskSearchEngine } from '../search/task-search-engine';
import type { SearchEngine } from '../search/search-engine';
import type { SearchScopeAll } from '../search/search-scope';
import { createPrismaManagementSource } from '../management/prisma-management-source';
import type { TaskMergeService } from '../task-merge/merge-service';
import { priorityProbe } from '../dashboard/prisma-priority-sources';

/** An id no row has: every probe below looks only there (nothing found, nothing written). */
export const NOWHERE = '~database-check~';

/**
 * 1.23.1 — the database check's raw-SQL families (database-check.ts), each once in a harmless form: the
 * task search as the top bar sends it (two words — the live failure, "Unknown column '0' in 'ORDER
 * BY'" on MariaDB — a task number and a bare number), search everything (its exact, spelling and
 * some-words passes, its counts, the vocabulary) and the Management page's figures and lists.
 */
export function databaseProbes({
  prisma,
  taskSearch,
  searchEngine,
  timeZone,
  taskMerge,
  checklists,
  searchIndex,
}: {
  prisma: PrismaClient;
  taskSearch: Pick<TaskSearchEngine, 'search'>;
  searchEngine?: Pick<SearchEngine, 'search'> & Partial<Pick<SearchEngine, 'count' | 'describe'>>;
  /** 1.23.6: the search index's own SQL for every kind (read only: its heal and fingerprint reads). */
  searchIndex?: { probe(): Promise<void> };
  timeZone: string;
  /** 1.23.2 Merge tasks: its transaction, row locks and late-writes look (merge-service selfCheck). */
  taskMerge?: Pick<TaskMergeService, 'selfCheck'>;
  /** 1.23.3 Nested checklists: the task hold every checklist change takes (SELECT … FOR UPDATE). */
  checklists?: { selfCheck(taskId: string): Promise<void> };
}): { name: string; run: () => Promise<unknown> }[] {
  const scope = { projectIds: [NOWHERE] };
  const nowhere: SearchScopeAll = { projectIds: [NOWHERE], meetings: { full: [NOWHERE], fullProjects: [NOWHERE], invitee: [NOWHERE], editable: [NOWHERE], editableProjects: [NOWHERE], editor: NOWHERE } };
  const tasks = (q: string) => () => taskSearch.search({ q, scope, limit: 1, withTotal: true });
  const probes: { name: string; run: () => Promise<unknown> }[] = [
    { name: 'the task search (two words)', run: tasks('zzcheck probe') },
    { name: 'the task search (a task number)', run: tasks('ZZCHECK-1') },
    { name: 'the task search (a bare number)', run: tasks('1') },
  ];
  if (searchEngine) {
    probes.push(
      { name: 'search everything', run: () => searchEngine.search({ q: 'zzcheck probe', scope: nowhere, viewerId: NOWHERE, limit: 1, withCounts: true }) },
      { name: 'search everything (the top bar’s notes and files)', run: () => searchEngine.search({ q: 'zzcheck', scope: nowhere, viewerId: NOWHERE, kinds: ['note', 'minutes', 'file', 'inspection'], limit: 1, exactOnly: true }) },
      { name: 'search everything (filters)', run: () => searchEngine.search({ q: 'zzcheck', scope: nowhere, viewerId: NOWHERE, limit: 1, withCounts: true, kinds: ['task'], taskStatuses: ['TODO'], done: false, personId: NOWHERE, projectId: NOWHERE, from: new Date(0), to: new Date(), includeArchived: true }) },
    );
    // 1.23.6 Advanced search: the reader's filters, filters with no words, the new kinds and a saved search's count.
    const admin: SearchScopeAll = { ...nowhere, clientAccounts: true };
    const day = new Date(Date.UTC(2026, 0, 5));
    probes.push(
      { name: 'search everything (filters and no words: due, assignee)', run: () => searchEngine.search({ q: '', browse: true, scope: admin, viewerId: NOWHERE, limit: 1, withCounts: true, kinds: ['task', 'checklist'], due: { before: day, open: true }, assigneeIds: [NOWHERE] }) },
      { name: 'search everything (priority, approval, unassigned, made by)', run: () => searchEngine.search({ q: 'zzcheck', scope: admin, viewerId: NOWHERE, limit: 1, withCounts: true, priorities: ['HIGH'], approval: true, unassigned: true, creatorIds: [NOWHERE], due: { from: day, before: day, none: true } }) },
      { name: 'search everything (clients and contacts, checklist items, organised by)', run: async () => {
        await searchEngine.search({ q: 'zzcheck', scope: admin, viewerId: NOWHERE, limit: 1, withCounts: true, kinds: ['contact', 'checklist'], projectId: NOWHERE, done: false, creatorIds: [NOWHERE] });
        await searchEngine.search({ q: '', browse: true, scope: admin, viewerId: NOWHERE, limit: 1, withCounts: true, organizerIds: [NOWHERE], personId: NOWHERE, from: day, to: day });
      } },
    );
    if (searchEngine.count) {
      const count = searchEngine.count;
      probes.push({ name: 'a saved search’s count', run: () => count({ q: '', browse: true, scope: admin, viewerId: NOWHERE, limit: 1, kinds: ['task'], due: { none: true } }) });
    }
    if (searchEngine.describe) {
      const describe = searchEngine.describe;
      probes.push({
        name: 'search results: clients, accounts, contacts and checklist items',
        run: () => describe([{ kind: 'contact', id: `client:${NOWHERE}` }, { kind: 'contact', id: `account:${NOWHERE}` }, { kind: 'contact', id: `contact:${NOWHERE}` }, { kind: 'checklist', id: NOWHERE }], [], () => true, { q: '', scope: admin, viewerId: NOWHERE, limit: 1, projectId: NOWHERE }),
      });
    }
  }
  if (searchIndex) probes.push({ name: 'the search index (every kind’s heal and fingerprint)', run: () => searchIndex.probe() });
  const source = createPrismaManagementSource(prisma, timeZone);
  probes.push({
    name: 'the Management page',
    run: async () => {
      const ids = [NOWHERE];
      const day = '2026-01-05';
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-01-08T00:00:00Z');
      // 1.23.2: one after another (never a burst of connections at start-up), and every raw form the page
      // can send — a person's late tasks, late milestones, overdue action items, one form's failures.
      const reads: (() => Promise<unknown>)[] = [
        () => source.projects(NOWHERE),
        () => source.runCount(NOWHERE),
        () => source.people(ids),
        () => source.taskFigures(ids, day),
        () => source.openMilestones(ids),
        () => source.checks(ids, { dueFrom: from, dueTo: to, openBefore: to, doneFrom: from, doneTo: to }),
        () => source.finishedInspections(ids, from, to),
        () => source.failedItems(ids, from, to, 1),
        () => source.structures(ids),
        () => source.openFollowUps(ids),
        () => source.lateByPerson(ids, day),
        () => source.actionItems(ids, day),
        () => source.trend(ids, [{ from, to, lateDay: day, lateAt: to }]),
        () => source.lateTasks({ projectIds: ids, today: day, limit: 1 }),
        () => source.lateTasks({ projectIds: ids, today: day, personId: NOWHERE, milestonesOnly: true, limit: 1 }),
        () => source.tasksByIds(ids),
        () => source.followUpTasks({ projectIds: ids, limit: 1 }),
        () => source.awaitingApproval(ids),
        () => source.awaitingApprovalTasks({ projectIds: ids, limit: 1 }),
        () => source.failedOccurrences({ projectIds: ids, from, to, formId: null, itemId: NOWHERE, limit: 1 }),
        () => source.failedOccurrences({ projectIds: ids, from, to, formId: NOWHERE, itemId: NOWHERE, limit: 1 }),
        () => source.actionItemList({ projectIds: ids, limit: 1 }),
        () => source.actionItemList({ projectIds: ids, personId: NOWHERE, overdueOn: day, limit: 1 }),
        () => source.failedAnswers({ projectIds: ids, from, to, formId: null, limit: 1 }),
        () => source.failedAnswers({ projectIds: ids, from, to, formId: NOWHERE, limit: 1 }),
        () => source.formTitles(ids),
      ];
      for (const read of reads) await read();
    },
  });
  if (taskMerge) probes.push({ name: 'merging tasks (locks, late writes, undo)', run: () => taskMerge.selfCheck(NOWHERE) });
  // 1.23.4 Smarter Dashboard: every statement "My Priorities Today" sends (its own tasks, team rows, dependencies, Done columns, approvals' and action items' projects, meetings).
  probes.push({ name: 'the Dashboard priorities', run: () => priorityProbe(prisma, NOWHERE, timeZone) });
  if (checklists) probes.push({ name: 'checklists (holding a task while it changes)', run: () => checklists.selfCheck(NOWHERE) });
  // Onboarding: the sign-in codes' table and the new account columns (no raw SQL: Prisma's own, checked
  // here so a missed migration shows at start-up, not at someone's sign-in).
  probes.push({
    name: 'sign-in codes and invitations',
    run: async () => {
      const since = new Date(0);
      await prisma.signInChallenge.aggregate({ where: { userId: NOWHERE, lastSentAt: { gte: since } }, _sum: { sends: true } });
      await prisma.signInChallenge.aggregate({ where: { userId: NOWHERE, createdAt: { gte: since } }, _sum: { attempts: true } });
      await prisma.user.findFirst({ where: { id: NOWHERE }, select: { emailVerifiedAt: true, invitedAt: true, activatedAt: true, loginOtps: { where: { purpose: 'WELCOME', consumedAt: null, expiresAt: { gt: since } }, select: { expiresAt: true }, take: 1 } } });
    },
  });
  return probes;
}
