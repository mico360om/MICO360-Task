import type { PrismaClient } from '@prisma/client';
import { alignTaskGuests, storedNameKey } from './guest-store';
import { categoryPlanFor, setTaskCategories, taskCategoryNames } from '../categories/category-store';
import { guestFullness, isSameGuest, GUEST_LIMITS, type GuestFields } from '../tasks/guest-contacts';
import { alsoRecorded, clipNotes, companyOfProject, guestColumns } from './guest-store';

export { alsoRecorded };

/**
 * 1.24: today's external contacts become guests. Every task row with no guest yet (made before 1.24, or by
 * an older server after a rollback) is linked to a guest of its task's project's company: the rows that are
 * the same person (guest-contacts.ts's rule — always the same name, then the same email, phone digits or
 * company) share one guest, an existing guest on the list first. A new guest gets the fullest row's
 * details; any other details found on the person's rows are listed in the guest's notes ("Also
 * recorded: …"), and each row then shows the guest's details. A task left with two rows for one guest
 * keeps the first (both remarks). Open tasks with guests and no team member get the person responsible
 * (`ensureResponsible`). Safe to run again: only rows with no guest are read.
 */
export interface ConversionResult {
  rows: number;
  guestsMade: number;
  tasks: string[];
  /** Rows that couldn't be converted this run (each group is its own write: one bad group stops nothing else). */
  failed?: { rows: number; message: string };
}

interface Row {
  id: string;
  taskId: string;
  name: string;
  company: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
  remarks: string | null;
  position: number;
  createdById: string | null;
  createdAt: Date;
  task: { projectId: string; key: string };
}

/** Union-find over indices. */
function groups(n: number, same: (a: number, b: number) => boolean): number[][] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (same(a, b)) parent[find(a)] = find(b);
  const out = new Map<number, number[]>();
  for (let i = 0; i < n; i++) out.set(find(i), [...(out.get(find(i)) ?? []), i]);
  return [...out.values()];
}

export async function convertExternalContacts(prisma: PrismaClient, opts: { batch?: number } = {}): Promise<ConversionResult> {
  const batch = opts.batch ?? 500;
  const result: ConversionResult = { rows: 0, guestsMade: 0, tasks: [] };
  const touched = new Set<string>();
  const failed = new Set<string>();
  const companyCache = new Map<string, string>();
  const companyOf = async (projectId: string) => {
    if (!companyCache.has(projectId)) companyCache.set(projectId, await companyOfProject(prisma, projectId));
    return companyCache.get(projectId)!;
  };
  for (let round = 0; round < 10_000; round++) {
    const rows: Row[] = await prisma.taskExternalContact.findMany({
      where: { guestId: null, ...(failed.size ? { id: { notIn: [...failed] } } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: batch,
      select: {
        id: true,
        taskId: true,
        name: true,
        company: true,
        designation: true,
        email: true,
        phone: true,
        remarks: true,
        position: true,
        createdById: true,
        createdAt: true,
        task: { select: { projectId: true, key: true } },
      },
    });
    if (rows.length === 0) break;
    const byCompany = new Map<string, Row[]>();
    for (const r of rows) {
      const c = await companyOf(r.task.projectId);
      byCompany.set(c, [...(byCompany.get(c) ?? []), r]);
    }
    for (const [companyId, list] of byCompany) {
      // Only rows of one name can be one person: each name's rows (and the list's guests of that name) apart.
      const byName = new Map<string, Row[]>();
      for (const r of list) byName.set(storedNameKey(r.name), [...(byName.get(storedNameKey(r.name)) ?? []), r]);
      const existing = await prisma.guestContact.findMany({
        where: { companyId, nameKey: { in: [...byName.keys()] }, mergedIntoId: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      for (const [nameKey, named] of byName) {
        const guests = existing.filter((g) => g.nameKey === nameKey);
        // Nodes: the list's guests first, then the rows. Guests are never joined to each other (an admin kept them apart).
        const nodes: GuestFields[] = [...guests, ...named];
        const sets = groups(nodes.length, (a, b) => !(a < guests.length && b < guests.length) && isSameGuest(nodes[a]!, nodes[b]!));
        for (const set of sets) {
          const rowIdx = set.filter((i) => i >= guests.length).map((i) => i - guests.length);
          if (rowIdx.length === 0) continue;
          const its = rowIdx.map((i) => named[i]!);
          const onList = set.filter((i) => i < guests.length).map((i) => guests[i]!);
          const target = onList.find((g) => !g.retiredAt) ?? onList[0];
          const fullest = [...its].sort((a, b) => guestFullness(b) - guestFullness(a) || a.createdAt.getTime() - b.createdAt.getTime())[0]!;
          try {
            // 1.23.29: a save conflict runs the transaction again from the start (lib/save-retry), so what it
            // did is counted from its answer, once it has committed — never from inside a try.
            const done = await prisma.$transaction(async (tx) => {
              const linked: string[] = [];
              const guest =
                target ??
                (await tx.guestContact.create({ data: { companyId, ...guestColumns(fullest), nameKey, createdById: fullest.createdById, createdAt: fullest.createdAt } }));
              const extra = alsoRecorded(guest, its);
              if (extra && !(guest.notes ?? '').includes(extra)) {
                await tx.guestContact.update({ where: { id: guest.id }, data: { notes: clipNotes([guest.notes, extra].filter(Boolean).join('\n')) } });
              }
              for (const row of its) {
                const { count } = await tx.taskExternalContact.updateMany({ where: { id: row.id, guestId: null }, data: { guestId: guest.id, ...guestColumns(guest) } });
                if (count) linked.push(row.taskId);
              }
              // A task with two rows for this guest keeps its first (both remarks).
              for (const taskId of new Set(its.map((r) => r.taskId))) {
                const mine = await tx.taskExternalContact.findMany({ where: { taskId, guestId: guest.id }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
                if (mine.length < 2) continue;
                const remarks = [...new Set(mine.map((m) => m.remarks).filter((x): x is string => Boolean(x)))].join('\n').slice(0, GUEST_LIMITS.note) || null;
                await tx.taskExternalContact.update({ where: { id: mine[0]!.id }, data: { remarks } });
                await tx.taskExternalContact.deleteMany({ where: { id: { in: mine.slice(1).map((m) => m.id) } } });
              }
              return { made: !target, linked };
            });
            if (done.made) result.guestsMade += 1;
            result.rows += done.linked.length;
            for (const taskId of done.linked) touched.add(taskId);
          } catch (err) {
            // This person's rows wait for the next run; the others go on.
            for (const row of its) failed.add(row.id);
            result.failed = { rows: failed.size, message: err instanceof Error ? err.message.slice(0, 300) : String(err) };
          }
        }
      }
    }
  }
  result.tasks = [...touched];
  return result;
}

/** Of these tasks, the open ones (live, not done, not archived): the switch gives them a person responsible. */
export async function openTasksAmong(prisma: PrismaClient, taskIds: string[]): Promise<string[]> {
  if (taskIds.length === 0) return [];
  const rows = await prisma.task.findMany({
    where: { id: { in: taskIds }, deletedAt: null, archivedAt: null, completedAt: null, project: { is: { deletedAt: null } }, column: { is: { category: { not: 'DONE' } } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Convert, then give each open task that now has guests and no team member its person responsible (a
 * history line in their name: "became the person responsible for the guests").
 */
export async function runGuestConversion(
  prisma: PrismaClient,
  ensureResponsible: (taskId: string, actorId: string, opts: { auto: boolean }) => Promise<unknown>,
): Promise<ConversionResult & { responsible: number }> {
  const result = await convertExternalContacts(prisma);
  // And any open task left with guests and nobody from the team since (its person left the project's team, a
  // repeat copy's people couldn't be assigned, a run stopped half-way).
  const alone = await prisma.task.findMany({
    where: {
      deletedAt: null,
      // Task archive: an archived task is read-only — nobody is made responsible for it.
      archivedAt: null,
      completedAt: null,
      project: { is: { deletedAt: null } },
      column: { is: { category: { not: 'DONE' } } },
      externalContacts: { some: {} },
      assignees: { none: {} },
    },
    select: { id: true },
    take: 500,
  });
  let responsible = 0;
  for (const taskId of await openTasksAmong(prisma, [...new Set([...result.tasks, ...alone.map((t) => t.id)])]))
    if (await ensureResponsible(taskId, '', { auto: true })) responsible += 1;
  return { ...result, responsible };
}

/**
 * 1.24 heals, run with the conversion every minute (nothing to do on most runs; plain joins — MariaDB-safe):
 *  - a task row showing other details than its guest (an older server's edit after a rollback) shows the guest's;
 *  - a guest of another company than its task's project's (the project's main company changed, an older server
 *    moved the task) is copied onto the right company's list and linked there;
 *  - a category of another project than its task's (an older server moved the task) becomes the task's
 *    project's category of the same name, or is dropped.
 */
export async function healGuestsAndCategories(prisma: PrismaClient): Promise<{ rows: number; guestTasks: number; categoryTasks: number }> {
  const rows = await prisma.$executeRaw`UPDATE task_external_contacts x INNER JOIN guest_contacts g ON g.id = x.guestId
    SET x.name = g.name, x.company = g.company, x.designation = g.designation, x.email = g.email, x.phone = g.phone
    WHERE NOT (BINARY x.name <=> BINARY g.name AND BINARY x.company <=> BINARY g.company AND BINARY x.designation <=> BINARY g.designation AND BINARY x.email <=> BINARY g.email AND BINARY x.phone <=> BINARY g.phone)`;
  const wrongCompany = await prisma.$queryRaw<{ taskId: string }[]>`SELECT DISTINCT x.taskId AS taskId FROM task_external_contacts x
    INNER JOIN guest_contacts g ON g.id = x.guestId
    INNER JOIN tasks t ON t.id = x.taskId
    INNER JOIN projects p ON p.id = t.projectId
    WHERE t.deletedAt IS NULL AND p.mainCompanyId IS NOT NULL AND g.companyId <> p.mainCompanyId`;
  if (wrongCompany.length)
    await alignTaskGuests(
      prisma,
      wrongCompany.map((r) => r.taskId),
      null,
    );
  const wrongProject = await prisma.$queryRaw<{ taskId: string; projectId: string }[]>`SELECT DISTINCT tc.taskId AS taskId, t.projectId AS projectId FROM task_categories tc
    INNER JOIN project_categories pc ON pc.id = tc.categoryId
    INNER JOIN tasks t ON t.id = tc.taskId
    WHERE pc.projectId <> t.projectId AND t.mergedIntoId IS NULL`;
  for (const t of wrongProject) {
    const plan = await categoryPlanFor(prisma, await taskCategoryNames(prisma, t.taskId), t.projectId);
    await setTaskCategories(prisma, t.taskId, plan.keep, null);
  }
  return { rows: Number(rows), guestTasks: wrongCompany.length, categoryTasks: wrongProject.length };
}

/** For a log line: the heals' numbers when any is above zero. */
export const healedSomething = (h: { rows: number; guestTasks: number; categoryTasks: number }): boolean => h.rows + h.guestTasks + h.categoryTasks > 0;
