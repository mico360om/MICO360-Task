import type { PrismaClient, Prisma } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';
import type { RecordTaskActivity } from '../activity/task-activity';
import { noteActivity } from '../activity/task-activity';
import {
  checkGuest,
  cleanNote,
  guestEmailKey,
  guestMatches,
  guestPhoneKey,
  guestTextKey,
  noteProblem,
  GUEST_LIMITS,
  GUEST_WORDS,
  MAX_TASK_GUESTS,
  type GuestDraft,
  type GuestFields,
} from '../tasks/guest-contacts';
import {
  clipNotes,
  companyOfProject,
  companyOfTask,
  guestColumns,
  guestCountOf,
  responsiblePersonFor,
  guestIdsOnProject,
  seesWholeList,
  storedNameKey,
  syncGuestRows,
  teamCountOf,
  toGuestRecord,
  toPickerGuest,
  toTaskGuestRecord,
  type GuestRecord,
  type GuestViewer,
  type PickerGuest,
  type TaskGuestRecord,
} from './guest-store';

/** Refusal codes the website and the app read. */
export const GUEST_CODES = {
  duplicate: 'GUEST_DUPLICATE',
  needsTeam: 'NEEDS_TEAM_MEMBER',
  inUse: 'GUEST_IN_USE',
  onTask: 'GUEST_ON_TASK',
  tooMany: 'TOO_MANY_GUESTS',
} as const;

/** Refused because the task would have guests and no team member. */
export class NeedsTeamMemberError extends ValidationError {
  constructor(message: string = GUEST_WORDS.needsTeam) {
    super(message, { code: GUEST_CODES.needsTeam });
  }
}

/** The most guests a picking list returns. */
const PICK_LIMIT = 50;

export interface GuestServiceDeps {
  prisma: PrismaClient;
  /** A line in a task's history. */
  recordActivity?: RecordTaskActivity;
  /** After a task's guests changed (search index, open boards). */
  onTaskChanged?: (taskId: string) => void | Promise<void>;
  /** Someone was put on a task as the person responsible (their "assigned to you" notice); never for the switch to guests. */
  onAssigned?: (taskId: string, userIds: string[], actorId: string) => void | Promise<void>;
}

export interface AdminGuestRow extends GuestRecord {
  companyName: string;
  /** Tasks it is on — live and in the Recycle Bin. */
  taskCount: number;
}

/** A guest's details or refuse them, the first problem in words and every field's in `details.fields`. */
function cleanOrRefuse(draft: GuestDraft): GuestFields {
  const check = checkGuest(draft);
  if (check.ok) return check.guest;
  throw new ValidationError(Object.values(check.problems)[0] ?? 'Check the guest’s details.', { fields: check.problems });
}

function noteOrRefuse(note: string | null | undefined): string | null {
  const problem = noteProblem(note);
  if (problem) throw new ValidationError(problem, { fields: { note: problem } });
  return cleanNote(note);
}

/** Does any of the guest's searchable words contain the typed text (case, spaces and accents aside; phone by digits)? */
function matchesQuery(g: GuestFields, q: string): boolean {
  const key = guestTextKey(q);
  if (!key) return true;
  const digits = q.replace(/\D/g, '');
  return (
    guestTextKey(g.name).includes(key) ||
    guestTextKey(g.company).includes(key) ||
    guestEmailKey(g.email).includes(q.trim().toLowerCase()) ||
    (digits.length >= 3 && guestPhoneKey(g.phone).includes(digits))
  );
}

export function createGuestService(deps: GuestServiceDeps) {
  const { prisma } = deps;
  const changed = async (taskId: string) => {
    try {
      await deps.onTaskChanged?.(taskId);
    } catch {
      /* the change itself is saved */
    }
  };
  const history = (taskId: string, userId: string, action: string, meta: Record<string, unknown>) => noteActivity(deps.recordActivity, { taskId, userId, action, meta });

  async function liveTaskOrThrow(db: PrismaClient | Prisma.TransactionClient, taskId: string) {
    const t = await db.task.findFirst({ where: { id: taskId, deletedAt: null, project: { is: { deletedAt: null } } }, select: { id: true, projectId: true } });
    if (!t) throw new NotFoundError('Task not found.');
    return t;
  }

  /** The part of the project's company list this person may see: all of it, or (another company's person) the guests on this project's tasks. */
  async function visiblePart(projectId: string, companyId: string, viewer?: GuestViewer | null): Promise<Set<string> | null> {
    return (await seesWholeList(prisma, viewer, companyId)) ? null : guestIdsOnProject(prisma, projectId);
  }

  /** The project's guest list for picking: active guests, by the typed words (name, company, email, phone), A to Z. */
  async function listForProject(projectId: string, q = '', limit = PICK_LIMIT, viewer?: GuestViewer | null): Promise<PickerGuest[]> {
    const companyId = await companyOfProject(prisma, projectId);
    const part = await visiblePart(projectId, companyId, viewer);
    const rows = await prisma.guestContact.findMany({ where: { companyId, retiredAt: null, mergedIntoId: null }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return rows.filter((g) => (!part || part.has(g.id)) && matchesQuery(g, q)).slice(0, limit).map(toPickerGuest);
  }

  /** The New guest form's live check against the project's list (the part the person may see): the same person, and same-name others. */
  async function duplicatesFor(projectId: string, draft: GuestDraft, viewer?: GuestViewer | null): Promise<{ same: PickerGuest[]; similar: PickerGuest[] }> {
    const companyId = await companyOfProject(prisma, projectId);
    const name = storedNameKey(draft.name);
    if (!name) return { same: [], similar: [] };
    const part = await visiblePart(projectId, companyId, viewer);
    const rows = (await prisma.guestContact.findMany({ where: { companyId, nameKey: name, mergedIntoId: null }, orderBy: [{ createdAt: 'asc' }] })).filter((g) => !part || part.has(g.id)).map(toPickerGuest);
    return guestMatches({ name: draft.name ?? '', company: draft.company, email: draft.email, phone: draft.phone }, rows);
  }

  /**
   * A new guest on the project's company list. The same person already there is refused (409
   * GUEST_DUPLICATE, with them) unless `confirmNew` — the form asks "… is already on the list — use them?".
   */
  async function createForProject(projectId: string, draft: GuestDraft, actorId: string, opts: { confirmNew?: boolean; viewer?: GuestViewer | null } = {}): Promise<PickerGuest> {
    const fields = cleanOrRefuse(draft);
    const companyId = await companyOfProject(prisma, projectId);
    if (!opts.confirmNew) {
      const { same } = await duplicatesFor(projectId, fields, opts.viewer ?? { id: actorId });
      if (same.length) throw new ConflictError(GUEST_WORDS.useExisting(same[0]!.company ? `${same[0]!.name} (${same[0]!.company})` : same[0]!.name), GUEST_CODES.duplicate, { matches: same });
    }
    const g = await prisma.guestContact.create({ data: { companyId, ...guestColumns(fields), nameKey: storedNameKey(fields.name), createdById: actorId } });
    return toPickerGuest(g);
  }

  /**
   * A new task's guests as the website sends them: each the project's company's, not retired (a guest twice
   * is once), at most 20, notes checked. Refused before anything is written.
   */
  async function checkNewTaskGuests(projectId: string, picks: { guestId: string; note?: string | null }[]): Promise<{ guestId: string; note: string | null }[]> {
    const byId = new Map<string, string | null>();
    for (const p of picks) if (!byId.has(p.guestId)) byId.set(p.guestId, noteOrRefuse(p.note));
    if (byId.size > MAX_TASK_GUESTS) throw new ValidationError(GUEST_WORDS.full);
    const companyId = await companyOfProject(prisma, projectId);
    const rows = await prisma.guestContact.findMany({ where: { id: { in: [...byId.keys()] }, mergedIntoId: null } });
    if (rows.length !== byId.size) throw new NotFoundError('One of those guests isn’t on the list any more.');
    if (rows.some((g) => g.companyId !== companyId)) throw new ValidationError(GUEST_WORDS.wrongCompany);
    if (rows.some((g) => g.retiredAt)) throw new ValidationError('A retired guest can’t be added to a task.');
    return [...byId].map(([guestId, note]) => ({ guestId, note }));
  }

  /** A task's guests, in order. */
  async function taskGuests(taskId: string): Promise<TaskGuestRecord[]> {
    const rows = await prisma.taskExternalContact.findMany({ where: { taskId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], include: { guest: { select: { retiredAt: true } } } });
    return rows.map(toTaskGuestRecord);
  }

  /**
   * Put a guest on a task (a guest of the task's project's company, not retired). The task must keep at
   * least one team member (400 NEEDS_TEAM_MEMBER); a guest already on it is refused (409 GUEST_ON_TASK).
   */
  async function addToTask(taskId: string, guestId: string, note: string | null | undefined, actorId: string): Promise<TaskGuestRecord> {
    const cleanNoteText = noteOrRefuse(note);
    const row = await prisma.$transaction(async (tx) => {
      const task = await liveTaskOrThrow(tx, taskId);
      await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${taskId} FOR UPDATE`;
      const guest = await tx.guestContact.findFirst({ where: { id: guestId, mergedIntoId: null } });
      if (!guest) throw new NotFoundError('That guest isn’t on the list any more.');
      if (guest.companyId !== (await companyOfProject(tx, task.projectId))) throw new ValidationError(GUEST_WORDS.wrongCompany);
      if (guest.retiredAt) throw new ValidationError('This guest is retired. An admin can use them again on Guest contacts.');
      if ((await teamCountOf(tx, taskId)) === 0) throw new NeedsTeamMemberError();
      const rows = await tx.taskExternalContact.findMany({ where: { taskId }, select: { guestId: true, position: true } });
      if (rows.some((r) => r.guestId === guestId)) throw new ConflictError('This guest is already on the task.', GUEST_CODES.onTask);
      if (rows.length >= MAX_TASK_GUESTS) throw new ConflictError(GUEST_WORDS.full, GUEST_CODES.tooMany);
      const position = rows.reduce((top, r) => Math.max(top, r.position + 1), 0);
      return tx.taskExternalContact.create({
        data: { taskId, guestId, position, createdById: actorId, remarks: cleanNoteText, ...guestColumns(guest) },
        include: { guest: { select: { retiredAt: true } } },
      });
    });
    await history(taskId, actorId, 'EXTERNAL_CONTACT_ADDED', { name: row.name, company: row.company, guestId });
    await changed(taskId);
    return toTaskGuestRecord(row);
  }

  /** Change what this task needs from a guest (its own note). */
  async function setNote(taskId: string, guestId: string, note: string | null | undefined): Promise<TaskGuestRecord> {
    const text = noteOrRefuse(note);
    await liveTaskOrThrow(prisma, taskId);
    const { count } = await prisma.taskExternalContact.updateMany({ where: { taskId, guestId }, data: { remarks: text } });
    if (count === 0) throw new NotFoundError('This guest isn’t on the task any more.');
    const row = await prisma.taskExternalContact.findFirst({ where: { taskId, guestId }, include: { guest: { select: { retiredAt: true } } } });
    return toTaskGuestRecord(row!);
  }

  /** Take a guest off a task (the guest stays on the company's list). */
  async function removeFromTask(taskId: string, guestId: string, actorId: string): Promise<void> {
    await liveTaskOrThrow(prisma, taskId);
    const rows = await prisma.taskExternalContact.findMany({ where: { taskId, guestId } });
    if (rows.length === 0) throw new NotFoundError('This guest isn’t on the task any more.');
    await prisma.taskExternalContact.deleteMany({ where: { taskId, guestId } });
    await history(taskId, actorId, 'EXTERNAL_CONTACT_REMOVED', { name: rows[0]!.name, company: rows[0]!.company, guestId });
    await changed(taskId);
  }

  /** Refuse taking the task's last team member off while it has guests (400 NEEDS_TEAM_MEMBER). */
  async function assertTeamStays(taskId: string, leavingUserIds: string[]): Promise<void> {
    if (leavingUserIds.length === 0) return;
    if ((await guestCountOf(prisma, taskId)) === 0) return;
    const remaining = await prisma.taskAssignee.count({ where: { taskId, userId: { notIn: leavingUserIds } } });
    if (remaining === 0) throw new NeedsTeamMemberError(GUEST_WORDS.lastTeamMember);
  }

  /**
   * The old external-contact way in (the Android app and the extension) may leave a task with guests and no
   * team member: add the person responsible (its creator, else its project's first manager…), with a history
   * line. Returns who was added, or null.
   */
  async function ensureResponsible(taskId: string, actorId: string, opts: { auto?: boolean } = {}): Promise<{ id: string; name: string } | null> {
    if ((await guestCountOf(prisma, taskId)) === 0 || (await teamCountOf(prisma, taskId)) > 0) return null;
    const person = await responsiblePersonFor(prisma, taskId);
    if (!person) return null;
    await prisma.taskAssignee.upsert({ where: { taskId_userId: { taskId, userId: person.id } }, update: {}, create: { taskId, userId: person.id } });
    await history(taskId, opts.auto ? person.id : actorId, 'ASSIGNED', { assigneeId: person.id, assignee: person.name, reason: 'guests', ...(opts.auto ? { auto: true } : {}) });
    // Told like anyone assigned — except by the switch to guests (it would tell people about old tasks all at once).
    if (!opts.auto) {
      try {
        await deps.onAssigned?.(taskId, [person.id], actorId);
      } catch {
        /* the assignment stands */
      }
    }
    await changed(taskId);
    return person;
  }

  // ---- Admins: the Guest contacts page ------------------------------------------------------------

  /** A company's guests (every company's when none is given) with how many tasks each is on, A to Z. */
  async function adminList(opts: { companyId?: string | null; q?: string; status?: 'active' | 'retired' | 'all' } = {}): Promise<AdminGuestRow[]> {
    const status = opts.status ?? 'active';
    const rows = await prisma.guestContact.findMany({
      where: {
        mergedIntoId: null,
        ...(opts.companyId ? { companyId: opts.companyId } : {}),
        ...(status === 'active' ? { retiredAt: null } : status === 'retired' ? { retiredAt: { not: null } } : {}),
      },
      include: { owner: { select: { name: true } }, _count: { select: { links: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows
      .filter((g) => matchesQuery(g, opts.q ?? ''))
      .map((g) => ({ ...toGuestRecord(g), companyName: g.owner.name, taskCount: g._count.links }));
  }

  async function guestOrThrow(guestId: string) {
    const g = await prisma.guestContact.findFirst({ where: { id: guestId, mergedIntoId: null } });
    if (!g) throw new NotFoundError('That guest isn’t on the list any more.');
    return g;
  }

  /** Change a guest's details (and notes); every task that has them shows the new details. */
  async function adminUpdate(guestId: string, draft: GuestDraft & { notes?: string | null }): Promise<GuestRecord> {
    const before = await guestOrThrow(guestId);
    const merged: GuestDraft = { name: before.name, company: before.company, designation: before.designation, email: before.email, phone: before.phone };
    for (const k of ['name', 'company', 'designation', 'email', 'phone'] as const) if (draft[k] !== undefined) merged[k] = draft[k];
    const fields = cleanOrRefuse(merged);
    let notes = before.notes;
    if (draft.notes !== undefined) {
      const text = (draft.notes ?? '').trim();
      if (text.length > GUEST_LIMITS.notes) throw new ValidationError(`Notes can have at most ${GUEST_LIMITS.notes} characters.`, { fields: { notes: 'too long' } });
      notes = text || null;
    }
    const taskIds = (await prisma.taskExternalContact.findMany({ where: { guestId }, select: { taskId: true }, distinct: ['taskId'] })).map((r) => r.taskId);
    const after = await prisma.$transaction(async (tx) => {
      const g = await tx.guestContact.update({ where: { id: guestId }, data: { ...guestColumns(fields), nameKey: storedNameKey(fields.name), notes } });
      await syncGuestRows(tx, g);
      return g;
    });
    for (const t of taskIds) await changed(t);
    return toGuestRecord(after);
  }

  /** Retire (hidden from picking, kept on its tasks) or use again. */
  async function setRetired(guestId: string, retired: boolean): Promise<GuestRecord> {
    await guestOrThrow(guestId);
    return toGuestRecord(await prisma.guestContact.update({ where: { id: guestId }, data: { retiredAt: retired ? new Date() : null } }));
  }

  /**
   * Merge duplicates into the kept guest (one company): every task link moves to it (a task that had both
   * keeps one, its notes joined), with a history line on those tasks; the others are hidden (merged).
   */
  async function merge(keepId: string, mergeIds: string[], actorId: string): Promise<{ guest: GuestRecord; tasks: number }> {
    const ids = [...new Set(mergeIds)].filter((id) => id !== keepId);
    if (ids.length === 0) throw new ValidationError('Pick the guests to merge into this one.');
    const keep = await guestOrThrow(keepId);
    const others = await prisma.guestContact.findMany({ where: { id: { in: ids }, mergedIntoId: null } });
    if (others.length !== ids.length) throw new NotFoundError('One of those guests isn’t on the list any more.');
    if (others.some((g) => g.companyId !== keep.companyId)) throw new ValidationError('Only guests on the same company’s list can be merged.');
    const moved: { taskId: string; from: { name: string; company: string | null } }[] = [];
    const notesBefore = keep.notes;
    await prisma.$transaction(async (tx) => {
      // 1.23.29: a save conflict runs this again from the start (lib/save-retry): each try begins afresh.
      moved.length = 0;
      keep.notes = notesBefore;
      for (const other of others) {
        const rows = await tx.taskExternalContact.findMany({ where: { guestId: other.id } });
        for (const row of rows) {
          const kept = await tx.taskExternalContact.findFirst({ where: { taskId: row.taskId, guestId: keepId } });
          if (kept) {
            // The task already has the kept guest: one row stays, with both notes.
            const note = [kept.remarks, row.remarks].filter(Boolean).join('\n');
            await tx.taskExternalContact.update({ where: { id: kept.id }, data: { remarks: note ? note.slice(0, GUEST_LIMITS.note) : null } });
            await tx.taskExternalContact.delete({ where: { id: row.id } });
          } else {
            await tx.taskExternalContact.update({ where: { id: row.id }, data: { guestId: keepId, ...guestColumns(keep) } });
          }
          moved.push({ taskId: row.taskId, from: { name: row.name, company: row.company } });
        }
        const extra = [other.notes].filter(Boolean).join('\n');
        if (extra) {
          const notes = clipNotes([keep.notes, extra].filter(Boolean).join('\n'));
          await tx.guestContact.update({ where: { id: keepId }, data: { notes } });
          keep.notes = notes;
        }
        await tx.guestContact.update({ where: { id: other.id }, data: { mergedIntoId: keepId, retiredAt: other.retiredAt ?? new Date() } });
      }
    });
    for (const m of moved) {
      await history(m.taskId, actorId, 'EXTERNAL_CONTACT_CHANGED', { name: keep.name, company: keep.company, guestId: keepId, from: m.from, merged: true });
      await changed(m.taskId);
    }
    return { guest: toGuestRecord(await prisma.guestContact.findUniqueOrThrow({ where: { id: keepId } })), tasks: new Set(moved.map((m) => m.taskId)).size };
  }

  /** Remove a guest from the list — only when no task has them (Recycle Bin tasks count): 409 GUEST_IN_USE otherwise. */
  async function remove(guestId: string): Promise<void> {
    await guestOrThrow(guestId);
    await prisma.$transaction(async (tx) => {
      if ((await tx.taskExternalContact.count({ where: { guestId } })) > 0) throw new ConflictError(GUEST_WORDS.inUse, GUEST_CODES.inUse);
      // Guests merged into this one point at it: they go with it.
      await tx.guestContact.deleteMany({ where: { mergedIntoId: guestId } });
      await tx.guestContact.delete({ where: { id: guestId } });
    });
  }

  return {
    listForProject,
    duplicatesFor,
    createForProject,
    checkNewTaskGuests,
    taskGuests,
    addToTask,
    setNote,
    removeFromTask,
    assertTeamStays,
    ensureResponsible,
    adminList,
    adminUpdate,
    setRetired,
    merge,
    remove,
    companyOfTask: (taskId: string) => companyOfTask(prisma, taskId),
  };
}

export type GuestService = ReturnType<typeof createGuestService>;
