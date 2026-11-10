import type { PrismaClient } from '@prisma/client';
import { guestFullness, guestTextKey, isSameGuest, GUEST_LIMITS, type GuestFields } from '../tasks/guest-contacts';
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
  const companyCache = new Map<string, string>();
  const companyOf = async (projectId: string) => {
    if (!companyCache.has(projectId)) companyCache.set(projectId, await companyOfProject(prisma, projectId));
    return companyCache.get(projectId)!;
  };
  for (let round = 0; round < 10_000; round++) {
    const rows: Row[] = await prisma.taskExternalContact.findMany({
      where: { guestId: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: batch,
      select: { id: true, taskId: true, name: true, company: true, designation: true, email: true, phone: true, remarks: true, position: true, createdById: true, createdAt: true, task: { select: { projectId: true, key: true } } },
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
      for (const r of list) byName.set(guestTextKey(r.name), [...(byName.get(guestTextKey(r.name)) ?? []), r]);
      const existing = await prisma.guestContact.findMany({ where: { companyId, nameKey: { in: [...byName.keys()] }, mergedIntoId: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
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
          await prisma.$transaction(async (tx) => {
            const guest = target ?? (await tx.guestContact.create({ data: { companyId, ...guestColumns(fullest), nameKey, createdById: fullest.createdById, createdAt: fullest.createdAt } }));
            if (!target) result.guestsMade += 1;
            const extra = alsoRecorded(guest, its);
            if (extra && !(guest.notes ?? '').includes(extra)) {
              await tx.guestContact.update({ where: { id: guest.id }, data: { notes: clipNotes([guest.notes, extra].filter(Boolean).join('\n')) } });
            }
            for (const row of its) {
              const { count } = await tx.taskExternalContact.updateMany({ where: { id: row.id, guestId: null }, data: { guestId: guest.id, ...guestColumns(guest) } });
              if (count) {
                result.rows += 1;
                touched.add(row.taskId);
              }
            }
            // A task with two rows for this guest keeps its first (both remarks).
            for (const taskId of new Set(its.map((r) => r.taskId))) {
              const mine = await tx.taskExternalContact.findMany({ where: { taskId, guestId: guest.id }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
              if (mine.length < 2) continue;
              const remarks = [...new Set(mine.map((m) => m.remarks).filter((x): x is string => Boolean(x)))].join('\n').slice(0, GUEST_LIMITS.note) || null;
              await tx.taskExternalContact.update({ where: { id: mine[0]!.id }, data: { remarks } });
              await tx.taskExternalContact.deleteMany({ where: { id: { in: mine.slice(1).map((m) => m.id) } } });
            }
          });
        }
      }
    }
  }
  result.tasks = [...touched];
  return result;
}

/** Of these tasks, the open ones (live, not done): the switch gives them a person responsible. */
export async function openTasksAmong(prisma: PrismaClient, taskIds: string[]): Promise<string[]> {
  if (taskIds.length === 0) return [];
  const rows = await prisma.task.findMany({
    where: { id: { in: taskIds }, deletedAt: null, completedAt: null, project: { is: { deletedAt: null } }, column: { is: { category: { not: 'DONE' } } } },
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
  let responsible = 0;
  for (const taskId of await openTasksAmong(prisma, result.tasks)) if (await ensureResponsible(taskId, '', { auto: true })) responsible += 1;
  return { ...result, responsible };
}
