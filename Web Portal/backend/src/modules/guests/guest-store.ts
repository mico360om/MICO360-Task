import type { GuestContact, Prisma, PrismaClient, TaskExternalContact } from '@prisma/client';
import { DEFAULT_COMPANY } from '../companies/default-company';
import { projectAudienceIds } from '../tasks/prisma-assignee-repository';
import { guestEmailKey, guestPhoneKey, guestTextKey, isSameGuest, GUEST_LIMITS, type GuestFields } from '../tasks/guest-contacts';

/**
 * 1.24 Guests over the database: the pieces every guest change shares — which company's list a task
 * uses, finding (never changing) or making the guest for some details by the duplicate rule, keeping a
 * guest's task rows equal to it, and who looks after a task's guests when it has no team member.
 *
 * A task's guests are its `task_external_contacts` rows that carry a `guestId`; each row keeps a copy of
 * the guest's name, company, designation, email and phone (so the Android app, the extension and an older
 * server read them as before) and the task's own note (`remarks`).
 */
export type Db = PrismaClient | Prisma.TransactionClient;

/** A guest on a company's list. */
export interface GuestRecord extends GuestFields {
  id: string;
  companyId: string;
  notes: string | null;
  retiredAt: Date | null;
  mergedIntoId: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One of a task's guests: the guest's details, and the task's own note. */
export interface TaskGuestRecord extends GuestFields {
  /** The task's row for it (the old external-contact id — the Android app and the extension use it). */
  linkId: string;
  guestId: string;
  taskId: string;
  /** What this task needs from them (the old "remarks"). */
  note: string | null;
  position: number;
  addedById: string | null;
  addedAt: Date;
  /** Retired from the company's list (kept on this task). */
  retired: boolean;
}

export const toGuestRecord = (g: GuestContact): GuestRecord => ({
  id: g.id,
  companyId: g.companyId,
  name: g.name,
  company: g.company,
  designation: g.designation,
  email: g.email,
  phone: g.phone,
  notes: g.notes,
  retiredAt: g.retiredAt,
  mergedIntoId: g.mergedIntoId,
  createdById: g.createdById,
  createdAt: g.createdAt,
  updatedAt: g.updatedAt,
});

export const toTaskGuestRecord = (row: TaskExternalContact & { guest?: { retiredAt: Date | null } | null }): TaskGuestRecord => ({
  linkId: row.id,
  guestId: row.guestId ?? '',
  taskId: row.taskId,
  name: row.name,
  company: row.company,
  designation: row.designation,
  email: row.email,
  phone: row.phone,
  note: row.remarks,
  position: row.position,
  addedById: row.createdById,
  addedAt: row.createdAt,
  retired: Boolean(row.guest?.retiredAt),
});

/** The details a task row copies from its guest. */
export const guestColumns = (g: GuestFields) => ({ name: g.name, company: g.company, designation: g.designation, email: g.email, phone: g.phone });

/** A project's guest list: its main company's (else its first company's, else the site's first company). */
export async function companyOfProject(db: Db, projectId: string): Promise<string> {
  const p = await db.project.findUnique({
    where: { id: projectId },
    select: { mainCompanyId: true, companies: { select: { companyId: true }, orderBy: [{ addedAt: 'asc' }, { companyId: 'asc' }], take: 1 } },
  });
  return p?.mainCompanyId ?? p?.companies[0]?.companyId ?? DEFAULT_COMPANY.id;
}

/** A task's guest list (its project's company), or null when there is no such task. */
export async function companyOfTask(db: Db, taskId: string): Promise<string | null> {
  const t = await db.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
  return t ? companyOfProject(db, t.projectId) : null;
}

/**
 * The company's guest for these details by the duplicate rule — an active one first, else a retired one
 * (never a merged one) — or a new guest. A guest found is never changed (editing the list is admins').
 */
export async function findOrCreateGuest(db: Db, companyId: string, fields: GuestFields, createdById: string | null, opts: { taskKey?: string } = {}): Promise<GuestContact> {
  const candidates = await db.guestContact.findMany({ where: { companyId, nameKey: guestTextKey(fields.name), mergedIntoId: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const same = candidates.filter((g) => isSameGuest(fields, g));
  const found = same.find((g) => !g.retiredAt) ?? same[0];
  if (!found) return db.guestContact.create({ data: { companyId, ...guestColumns(fields), nameKey: guestTextKey(fields.name), createdById } });
  // Details typed that the guest doesn't show are kept in its notes ("Also recorded: …"), never lost — its
  // shown details stay as they are (an admin tidies the list).
  const extra = opts.taskKey ? alsoRecorded(found, [{ ...fields, task: { key: opts.taskKey } }]) : null;
  if (extra && !(found.notes ?? '').includes(extra.replace(/^Also recorded: /, ''))) {
    return db.guestContact.update({ where: { id: found.id }, data: { notes: clipNotes([found.notes, extra].filter(Boolean).join('\n')) } });
  }
  return found;
}

/** Make every task row of the guest show its details as they are now. */
export async function syncGuestRows(db: Db, guest: GuestContact | GuestRecord): Promise<number> {
  const { count } = await db.taskExternalContact.updateMany({ where: { guestId: guest.id }, data: guestColumns(guest) });
  return count;
}

/** How many team members (internal assignees) the task has. */
export async function teamCountOf(db: Db, taskId: string): Promise<number> {
  return db.taskAssignee.count({ where: { taskId } });
}

/** How many guests the task has. */
export async function guestCountOf(db: Db, taskId: string): Promise<number> {
  return db.taskExternalContact.count({ where: { taskId } });
}

/**
 * Who looks after a task's guests when it has no team member: its creator while they may be assigned in
 * the project (active, on its team or an admin), else the project's first manager, its manager, then its
 * owner — the first who may be assigned. Null when nobody may.
 */
export async function responsiblePersonFor(db: Db, taskId: string): Promise<{ id: string; name: string } | null> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      createdById: true,
      projectId: true,
      project: { select: { managerId: true, ownerId: true, members: { where: { role: 'MANAGER' }, select: { userId: true }, orderBy: [{ addedAt: 'asc' }, { userId: 'asc' }] } } },
    },
  });
  if (!task) return null;
  const order = [task.createdById, ...task.project.members.map((m) => m.userId), task.project.managerId, task.project.ownerId].filter((id): id is string => Boolean(id));
  const eligible = new Set(await projectAudienceIds(db as PrismaClient, task.projectId, [...new Set(order)]));
  const id = order.find((u) => eligible.has(u));
  if (!id) return null;
  const u = await db.user.findUnique({ where: { id }, select: { firstName: true, lastName: true, username: true } });
  return { id, name: [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.username || 'a teammate' };
}

/** Notes text, kept within the limit (the newest words lost first). */
export function clipNotes(text: string): string {
  return text.length > GUEST_LIMITS.notes ? `${text.slice(0, GUEST_LIMITS.notes - 1)}…` : text;
}

const DETAIL_WORDS: [keyof GuestFields, string][] = [
  ['company', 'company'],
  ['designation', 'designation'],
  ['email', 'email'],
  ['phone', 'phone'],
];
const keyOf = (field: keyof GuestFields, v: string | null) => (field === 'email' ? guestEmailKey(v) : field === 'phone' ? guestPhoneKey(v) : guestTextKey(v));

/** "Also recorded: email a@b.com (RIG-4); phone 9912 3456 (RIG-7)" — details on rows that the guest doesn't show. */
export function alsoRecorded(guest: GuestFields, rows: (GuestFields & { task: { key: string } })[]): string | null {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const row of rows) {
    for (const [field, word] of DETAIL_WORDS) {
      const value = row[field];
      if (!value || !value.trim()) continue;
      const key = keyOf(field, value);
      if (key === keyOf(field, guest[field])) continue;
      if (seen.has(`${field}|${key}`)) continue;
      seen.add(`${field}|${key}`);
      parts.push(`${word} ${value.trim()} (${row.task.key})`);
    }
  }
  return parts.length ? `Also recorded: ${parts.join('; ')}` : null;
}
