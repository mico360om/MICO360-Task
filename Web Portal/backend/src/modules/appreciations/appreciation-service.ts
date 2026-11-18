import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ConflictError, ForbiddenError, HttpError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { shiftDayKey } from '../../lib/due-date';
import { CLIENT_ROLE } from '../clients/client-kind';
import {
  APPRECIATION_WORDS as W,
  BUILT_IN_TEMPLATES,
  LIMITS,
  canManageAppreciations,
  cleanNote,
  companyToday,
  noteNoticeTitle,
  dayWindow,
  fillPlaceholders,
  isLiveNow,
  isRealDay,
  scopeOfManager,
  statusOf,
  type AppreciationAnimation,
  type AppreciationIcon,
  type AppreciationStatus,
  type AppreciationTheme,
  type ManagerFacts,
  type TemplateContent,
} from './appreciation-rules';

/**
 * Employee Appreciation (1.24.0) on the database. Every rule is checked here, not in the routes:
 *   - managing (templates, people, send, history, edit, cancel, export): administrators (not in Manager View)
 *     and Appreciation managers; managers only for active staff of their own companies;
 *   - the person's own side (today's appreciations, accept, close the popup, My appreciations): themselves only;
 *   - status comes from the clock (company time zone day), never from a job; the sweep only sends the bell
 *     notice when a day starts and writes the activated / expired audit entries.
 * Writes that a double click or two devices can race are single-statement updateMany calls with their
 * condition in the WHERE (no read-then-write), so the second one simply changes nothing.
 */

export interface AppreciationDeps {
  prisma: PrismaClient;
  timeZone: string;
  now?: () => Date;
  /** The bell notice (through the notification service: push and email follow the person's settings). */
  notify(n: { userId: string; type: string; title: string; body: string | null; entityType: string | null; entityId: string | null; projectId: string | null }): Promise<unknown>;
  audit(e: { userId: string | null; action: string; entityId: string | null; oldValue?: unknown; newValue?: unknown; ip?: string | null }): Promise<void>;
  /** A company's name and logo for the popup and banner (null: the site's brand). */
  brand(companyId: string | null): Promise<{ name: string; logoUrl: string | null }>;
}

export const NOTICE_TYPE = 'APPRECIATION';

export interface AppreciationView {
  id: string;
  batchId: string;
  title: string;
  message: string;
  theme: AppreciationTheme;
  icon: AppreciationIcon;
  animation: AppreciationAnimation;
  day: string;
  startsAt: string;
  endsAt: string;
  status: AppreciationStatus;
  acceptedAt: string | null;
  /** 1.24.1: the note for the manager left with the accept (the person themselves, the sender, managers in scope). */
  acceptNote: string | null;
  popupClosedAt: string | null;
  sender: { id: string; name: string };
  company: { name: string; logoUrl: string | null };
}

export interface ManagedRow extends AppreciationView {
  recipient: { id: string; name: string };
  companyId: string | null;
  templateId: string | null;
  templateName: string | null;
  createdAt: string;
  cancelledAt: string | null;
  /** The message as written (placeholders kept), for Edit. */
  rawMessage: string;
}

export interface TemplateView extends TemplateContent {
  id: string;
  builtIn: boolean;
  archived: boolean;
  updatedAt: string;
}

export interface ScheduleInput {
  recipientIds: string[];
  templateId?: string | null;
  title: string;
  message: string;
  theme: AppreciationTheme;
  icon: AppreciationIcon;
  animation: AppreciationAnimation;
  day: string;
}
export type EditInput = Partial<Omit<ScheduleInput, 'recipientIds' | 'templateId'>>;

export interface ListFilters {
  /** 1.24.1: one record (the sender's bell notice opens it); still within the manager's scope. */
  id?: string;
  personId?: string;
  status?: AppreciationStatus;
  templateId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

type Row = Prisma.AppreciationGetPayload<object>;
type Facts = ManagerFacts & { id: string; companyIds: string[]; primaryCompanyId: string | null };

const nameOf = (u: { firstName: string; lastName: string; username: string } | null | undefined): string =>
  u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username : 'Someone';
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const PERSON = { id: true, firstName: true, lastName: true, username: true } as const;

export function createAppreciationService(d: AppreciationDeps) {
  const { prisma, timeZone } = d;
  const now = d.now ?? (() => new Date());

  async function factsOf(userId: string): Promise<Facts | null> {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        appreciationManager: true,
        managerView: true,
        primaryCompanyId: true,
        roles: { select: { role: { select: { name: true } } } },
        companies: { where: { company: { status: 'ACTIVE' } }, select: { companyId: true } },
      },
    });
    if (!u) return null;
    const roles = u.roles.map((r) => r.role.name);
    return {
      id: u.id,
      active: u.status === 'ACTIVE' && !u.deletedAt,
      client: roles.includes(CLIENT_ROLE),
      admin: roles.includes('ADMIN'),
      managerView: u.managerView,
      appreciationManager: u.appreciationManager,
      companyIds: u.companies.map((c) => c.companyId),
      primaryCompanyId: u.primaryCompanyId,
    };
  }

  async function manager(userId: string): Promise<{ f: Facts; scope: string[] | null }> {
    const f = await factsOf(userId);
    if (!f || !canManageAppreciations(f)) throw new ForbiddenError(W.notAllowed);
    return { f, scope: scopeOfManager(f) };
  }

  /** Records a manager may see: in their companies (an administrator: all, the site's own too). */
  const scopeWhere = (scope: string[] | null): Prisma.AppreciationWhereInput => (scope === null ? {} : { companyId: { in: scope } });

  const brands = new Map<string, Promise<{ name: string; logoUrl: string | null }>>();
  const brandOf = (companyId: string | null) => {
    // Cached for one request burst only (a few seconds): a renamed company shows soon after.
    const key = companyId ?? '';
    let p = brands.get(key);
    if (!p) {
      p = d.brand(companyId);
      brands.set(key, p);
      setTimeout(() => brands.delete(key), 5000).unref?.();
    }
    return p;
  };

  async function views<R extends Row>(rows: R[], at: Date): Promise<Array<AppreciationView & { row: R }>> {
    if (rows.length === 0) return [];
    const ids = [...new Set(rows.flatMap((r) => [r.recipientId, r.senderId]))];
    const people = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: PERSON })).map((u) => [u.id, u]));
    const out: Array<AppreciationView & { row: R }> = [];
    for (const r of rows) {
      const brand = await brandOf(r.companyId);
      out.push({
        row: r,
        id: r.id,
        batchId: r.batchId,
        title: r.title,
        message: fillPlaceholders(r.message, { name: nameOf(people.get(r.recipientId)), company: brand.name, day: r.day }),
        theme: r.theme as AppreciationTheme,
        icon: r.icon as AppreciationIcon,
        animation: r.animation as AppreciationAnimation,
        day: r.day,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        status: statusOf(r, at),
        acceptedAt: iso(r.acceptedAt),
        acceptNote: r.acceptNote,
        popupClosedAt: iso(r.popupClosedAt),
        sender: { id: r.senderId, name: nameOf(people.get(r.senderId)) },
        company: brand,
      });
    }
    return out;
  }
  const strip = <T extends { row: unknown }>({ row: _row, ...v }: T): Omit<T, 'row'> => v;

  // ── The person's own side ───────────────────────────────────────────────────────────────────────
  /** Today's appreciations (newest first), whether they may manage, and the server's clock. */
  async function me(userId: string) {
    const at = now();
    const f = await factsOf(userId);
    if (!f || !f.active || f.client) throw new ForbiddenError();
    const rows = await prisma.appreciation.findMany({
      where: { recipientId: userId, cancelledAt: null, startsAt: { lte: at }, endsAt: { gt: at } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
    });
    const live = (await views(rows, at)).filter((v) => isLiveNow(v.row, at)).map(strip);
    return { canManage: canManageAppreciations(f), today: companyToday(at, timeZone), serverNow: at.toISOString(), live };
  }

  async function ownRow(userId: string, id: string): Promise<Row> {
    const r = await prisma.appreciation.findUnique({ where: { id } });
    if (!r || r.recipientId !== userId) throw new NotFoundError(W.notFound);
    return r;
  }

  /**
   * 1.24.1: the sender's bell notice when a note is left (it opens the record in Scheduled & history). None when
   * someone appreciated themselves, or the sender is no longer active staff. A failing notice never fails the accept.
   */
  async function tellSender(r: Row, note: string): Promise<void> {
    if (r.senderId === r.recipientId) return;
    try {
      if ((await prisma.user.count({ where: { AND: [{ id: r.senderId }, STAFF_ACTIVE] } })) === 0) return;
      const who = await prisma.user.findUnique({ where: { id: r.recipientId }, select: PERSON });
      await d.notify({ userId: r.senderId, type: NOTICE_TYPE, title: noteNoticeTitle(nameOf(who), note), body: r.title, entityType: 'appreciation-note', entityId: r.id, projectId: null });
    } catch {
      /* the accept and its note are saved; the notice is a courtesy */
    }
  }

  /**
   * Accept: once, on its day, with an optional note for the manager (1.24.1). A second accept (another device, an
   * offline replay) answers the first one's time and never changes the note (noteSaved: false). The note is saved in
   * the same single write as the accept, so a note after the day ends is refused like the accept.
   */
  async function accept(userId: string, id: string, rawNote: string | null = null, ip: string | null = null): Promise<{ acceptedAt: string; already: boolean; noteSaved: boolean }> {
    const at = now();
    const note = cleanNote(rawNote);
    if (note && note.length > LIMITS.note) throw new ValidationError(W.noteTooLong, { field: 'note' });
    const done = await prisma.appreciation.updateMany({
      where: { id, recipientId: userId, acceptedAt: null, cancelledAt: null, startsAt: { lte: at }, endsAt: { gt: at } },
      data: { acceptedAt: at, acceptNote: note },
    });
    const r = await ownRow(userId, id);
    if (done.count === 1) {
      // The audit says whether a note was left, never its words.
      await d.audit({ userId, action: 'APPRECIATION_ACCEPTED', entityId: id, newValue: { acceptedAt: at.toISOString(), title: r.title, noteLeft: !!note }, ip });
      if (note) await tellSender(r, note);
      return { acceptedAt: at.toISOString(), already: false, noteSaved: !!note };
    }
    if (r.acceptedAt) return { acceptedAt: r.acceptedAt.toISOString(), already: true, noteSaved: false };
    if (r.cancelledAt) throw new ConflictError(W.cancelled);
    if (at.getTime() >= r.endsAt.getTime()) throw new HttpError(W.expired, 'APPRECIATION_EXPIRED', 409);
    throw new ConflictError(W.notYet);
  }

  /** The popup was closed without accepting: it never comes back (any device). */
  async function closePopup(userId: string, id: string): Promise<{ popupClosedAt: string }> {
    const at = now();
    await prisma.appreciation.updateMany({ where: { id, recipientId: userId, popupClosedAt: null }, data: { popupClosedAt: at } });
    const r = await ownRow(userId, id);
    return { popupClosedAt: (r.popupClosedAt ?? at).toISOString() };
  }

  /** My appreciations: every one whose day has started (not cancelled), newest first. */
  async function mine(userId: string) {
    const at = now();
    const f = await factsOf(userId);
    if (!f || !f.active || f.client) throw new ForbiddenError();
    const rows = await prisma.appreciation.findMany({
      where: { recipientId: userId, cancelledAt: null, startsAt: { lte: at } },
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return (await views(rows, at)).map(strip);
  }

  // ── Templates ───────────────────────────────────────────────────────────────────────────────────
  const templateView = (t: Prisma.AppreciationTemplateGetPayload<object>): TemplateView => ({
    id: t.id,
    name: t.name,
    title: t.title,
    message: t.message,
    theme: t.theme as AppreciationTheme,
    icon: t.icon as AppreciationIcon,
    animation: t.animation as AppreciationAnimation,
    builtIn: !!t.builtInKey,
    archived: !!t.archivedAt,
    updatedAt: t.updatedAt.toISOString(),
  });

  /** The six built-ins, added once (a second server starting at the same time adds nothing twice). */
  async function ensureBuiltIns(): Promise<number> {
    const made = await prisma.appreciationTemplate.createMany({
      data: BUILT_IN_TEMPLATES.map(({ key, ...t }) => ({ builtInKey: key, ...t })),
      skipDuplicates: true,
    });
    return made.count;
  }

  async function templates(userId: string, opts: { archived?: boolean } = {}): Promise<TemplateView[]> {
    await manager(userId);
    const rows = await prisma.appreciationTemplate.findMany({
      where: opts.archived ? {} : { archivedAt: null },
      orderBy: [{ builtInKey: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    });
    // Built-ins first, in their own order; then the others by name.
    const order = new Map(BUILT_IN_TEMPLATES.map((t, i) => [t.key, i]));
    return rows
      .sort((a, b) => (a.builtInKey ? order.get(a.builtInKey) ?? 99 : 100) - (b.builtInKey ? order.get(b.builtInKey) ?? 99 : 100) || a.name.localeCompare(b.name))
      .map(templateView);
  }

  async function createTemplate(userId: string, t: TemplateContent, ip: string | null = null): Promise<TemplateView> {
    await manager(userId);
    const row = await prisma.appreciationTemplate.create({ data: { ...t, createdById: userId } });
    await d.audit({ userId, action: 'APPRECIATION_TEMPLATE_SAVED', entityId: row.id, newValue: { name: row.name, made: true }, ip });
    return templateView(row);
  }

  async function templateRow(id: string) {
    const t = await prisma.appreciationTemplate.findUnique({ where: { id } });
    if (!t) throw new NotFoundError(W.templateGone);
    return t;
  }

  async function updateTemplate(userId: string, id: string, patch: Partial<TemplateContent>, ip: string | null = null): Promise<TemplateView> {
    await manager(userId);
    const before = await templateRow(id);
    if (before.builtInKey) throw new HttpError(W.builtIn, 'BUILT_IN_TEMPLATE', 409);
    const row = await prisma.appreciationTemplate.update({ where: { id }, data: patch });
    await d.audit({ userId, action: 'APPRECIATION_TEMPLATE_SAVED', entityId: id, oldValue: { name: before.name }, newValue: { name: row.name, changed: Object.keys(patch) }, ip });
    return templateView(row);
  }

  async function duplicateTemplate(userId: string, id: string, ip: string | null = null): Promise<TemplateView> {
    await manager(userId);
    const src = await templateRow(id);
    const name = `${src.name} (copy)`.slice(0, LIMITS.name);
    const row = await prisma.appreciationTemplate.create({
      data: { name, title: src.title, message: src.message, theme: src.theme, icon: src.icon, animation: src.animation, createdById: userId },
    });
    await d.audit({ userId, action: 'APPRECIATION_TEMPLATE_SAVED', entityId: row.id, newValue: { name, copiedFrom: id }, ip });
    return templateView(row);
  }

  async function archiveTemplate(userId: string, id: string, archived: boolean, ip: string | null = null): Promise<TemplateView> {
    await manager(userId);
    const t = await templateRow(id);
    if (t.builtInKey) throw new HttpError(W.builtIn, 'BUILT_IN_TEMPLATE', 409);
    const row = await prisma.appreciationTemplate.update({ where: { id }, data: { archivedAt: archived ? now() : null } });
    await d.audit({ userId, action: 'APPRECIATION_TEMPLATE_SAVED', entityId: id, newValue: { name: row.name, archived }, ip });
    return templateView(row);
  }

  // ── People and companies a manager may pick ─────────────────────────────────────────────────────
  const STAFF_ACTIVE: Prisma.UserWhereInput = { deletedAt: null, status: 'ACTIVE', roles: { none: { role: { name: CLIENT_ROLE } } } };

  async function companies(userId: string) {
    const { scope } = await manager(userId);
    return prisma.company.findMany({
      where: { status: 'ACTIVE', ...(scope ? { id: { in: scope } } : {}) },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  async function people(userId: string, q: { search?: string; companyId?: string } = {}) {
    const { scope } = await manager(userId);
    if (q.companyId && scope && !scope.includes(q.companyId)) return [];
    const inCompanies = q.companyId ? [q.companyId] : scope;
    const s = q.search?.trim();
    const rows = await prisma.user.findMany({
      where: {
        AND: [
          STAFF_ACTIVE,
          inCompanies ? { companies: { some: { companyId: { in: inCompanies } } } } : {},
          s ? { OR: [{ firstName: { contains: s } }, { lastName: { contains: s } }, { username: { contains: s } }, { email: { contains: s } }] } : {},
        ],
      },
      select: { ...PERSON, avatarUrl: true, primaryCompanyId: true, companies: { where: { company: { status: 'ACTIVE' } }, select: { company: { select: { id: true, name: true } } } } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
      take: 200,
    });
    return rows.map((u) => {
      const theirs = u.companies.map((c) => c.company).filter((c) => !scope || scope.includes(c.id));
      // The one a record would be sent within comes first (their primary company when it is in scope).
      theirs.sort((a, b) => Number(b.id === u.primaryCompanyId) - Number(a.id === u.primaryCompanyId));
      return { id: u.id, name: nameOf(u), avatarUrl: u.avatarUrl, companies: theirs };
    });
  }

  // ── Send, edit, cancel ──────────────────────────────────────────────────────────────────────────
  function checkDay(day: string, at: Date) {
    if (!isRealDay(day)) throw new ValidationError('Choose a valid day.', { field: 'day' });
    const today = companyToday(at, timeZone);
    if (day < today) throw new ValidationError(W.pastDay, { field: 'day' });
    if (day > shiftDayKey(today, LIMITS.daysAhead)) throw new ValidationError(W.tooFar, { field: 'day' });
  }

  async function schedule(userId: string, input: ScheduleInput, ip: string | null = null): Promise<{ batchId: string; ids: string[] }> {
    const { scope } = await manager(userId);
    const at = now();
    checkDay(input.day, at);
    const ids = [...new Set(input.recipientIds)];
    if (ids.length === 0) throw new ValidationError(W.noPeople, { field: 'recipientIds' });
    const people = await prisma.user.findMany({
      where: { AND: [{ id: { in: ids } }, STAFF_ACTIVE] },
      select: { id: true, primaryCompanyId: true, companies: { where: { company: { status: 'ACTIVE' } }, select: { companyId: true }, orderBy: [{ addedAt: 'asc' }, { companyId: 'asc' }] } },
    });
    const companyOf = new Map<string, string | null>();
    for (const p of people) {
      const theirs = p.companies.map((c) => c.companyId);
      const allowed = scope ? theirs.filter((c) => scope.includes(c)) : theirs;
      if (scope && allowed.length === 0) continue;
      companyOf.set(p.id, p.primaryCompanyId && allowed.includes(p.primaryCompanyId) ? p.primaryCompanyId : allowed[0] ?? null);
    }
    if (ids.some((id) => !companyOf.has(id))) throw new ValidationError(W.personOut, { field: 'recipientIds' });
    if (input.templateId) await templateRow(input.templateId);
    const { startsAt, endsAt } = dayWindow(input.day, timeZone);
    const batchId = randomUUID();
    const made: string[] = [];
    await prisma.$transaction(async (tx) => {
      made.length = 0; // the save-retry layer may run this again after a rolled-back try
      for (const recipientId of ids) {
        const r = await tx.appreciation.create({
          data: {
            batchId,
            recipientId,
            companyId: companyOf.get(recipientId) ?? null,
            templateId: input.templateId ?? null,
            title: input.title,
            message: input.message,
            theme: input.theme,
            icon: input.icon,
            animation: input.animation,
            day: input.day,
            startsAt,
            endsAt,
            senderId: userId,
          },
          select: { id: true },
        });
        made.push(r.id);
      }
    });
    // The records are saved: a failing audit write must not turn into an error (and a second send on retry).
    await d.audit({ userId, action: 'APPRECIATION_CREATED', entityId: batchId, newValue: { title: input.title, day: input.day, recipients: ids.length, ids: made }, ip }).catch(() => undefined);
    // Today's: active at once (the bell notice now, not at the next sweep).
    if (startsAt.getTime() <= at.getTime()) await activate(made);
    return { batchId, ids: made };
  }

  async function managedRow(userId: string, id: string) {
    const { scope } = await manager(userId);
    const r = await prisma.appreciation.findFirst({ where: { id, ...scopeWhere(scope) } });
    if (!r) throw new NotFoundError(W.notFound);
    return r;
  }

  async function update(userId: string, id: string, patch: EditInput, ip: string | null = null): Promise<ManagedRow> {
    const before = await managedRow(userId, id);
    const at = now();
    if (patch.day !== undefined) checkDay(patch.day, at);
    const data: Prisma.AppreciationUpdateManyMutationInput = { ...patch };
    if (patch.day !== undefined) Object.assign(data, dayWindow(patch.day, timeZone));
    // Only before it starts (and not cancelled): the condition is in the write itself.
    const done = await prisma.appreciation.updateMany({ where: { id, cancelledAt: null, acceptedAt: null, startsAt: { gt: at } }, data });
    if (done.count === 0) throw new ConflictError(before.cancelledAt ? W.cancelled : W.started);
    const changed = (Object.keys(patch) as Array<keyof EditInput>).filter((k) => patch[k] !== undefined && patch[k] !== before[k]);
    await d.audit({ userId, action: 'APPRECIATION_EDITED', entityId: id, oldValue: Object.fromEntries(changed.map((k) => [k, before[k]])), newValue: Object.fromEntries(changed.map((k) => [k, patch[k]])), ip });
    const after = await prisma.appreciation.findUniqueOrThrow({ where: { id } });
    if (after.startsAt.getTime() <= at.getTime()) await activate([id]);
    return (await managedViews([after], at))[0]!;
  }

  async function cancel(userId: string, id: string, ip: string | null = null): Promise<ManagedRow> {
    const before = await managedRow(userId, id);
    const at = now();
    const done = await prisma.appreciation.updateMany({ where: { id, cancelledAt: null, acceptedAt: null, startsAt: { gt: at } }, data: { cancelledAt: at, cancelledById: userId } });
    if (done.count === 0) throw new ConflictError(before.cancelledAt ? W.cancelled : W.started);
    await d.audit({ userId, action: 'APPRECIATION_CANCELLED', entityId: id, oldValue: { day: before.day, recipientId: before.recipientId }, ip });
    return (await managedViews([await prisma.appreciation.findUniqueOrThrow({ where: { id } })], at))[0]!;
  }

  // ── History ─────────────────────────────────────────────────────────────────────────────────────
  function statusWhere(s: AppreciationStatus | undefined, at: Date): Prisma.AppreciationWhereInput {
    switch (s) {
      case 'CANCELLED':
        return { cancelledAt: { not: null } };
      case 'ACCEPTED':
        return { cancelledAt: null, acceptedAt: { not: null } };
      case 'SCHEDULED':
        return { cancelledAt: null, acceptedAt: null, startsAt: { gt: at } };
      case 'ACTIVE':
        return { cancelledAt: null, acceptedAt: null, startsAt: { lte: at }, endsAt: { gt: at } };
      case 'EXPIRED':
        return { cancelledAt: null, acceptedAt: null, endsAt: { lte: at } };
      default:
        return {};
    }
  }

  function listWhere(scope: string[] | null, f: ListFilters, at: Date): Prisma.AppreciationWhereInput {
    for (const k of ['from', 'to'] as const) if (f[k] && !isRealDay(f[k]!)) throw new ValidationError('Choose a valid day.', { field: k });
    return {
      AND: [
        scopeWhere(scope),
        statusWhere(f.status, at),
        f.id ? { id: f.id } : {},
        f.personId ? { recipientId: f.personId } : {},
        f.templateId ? { templateId: f.templateId } : {},
        f.from ? { day: { gte: f.from } } : {},
        f.to ? { day: { lte: f.to } } : {},
      ],
    };
  }

  async function managedViews(rows: Row[], at: Date): Promise<ManagedRow[]> {
    const vs = await views(rows, at);
    const names = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.recipientId))] } }, select: PERSON })).map((u) => [u.id, nameOf(u)]));
    const tids = [...new Set(rows.map((r) => r.templateId).filter((x): x is string => !!x))];
    const tnames = new Map(tids.length ? (await prisma.appreciationTemplate.findMany({ where: { id: { in: tids } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]) : []);
    return vs.map(({ row, ...v }) => ({
      ...v,
      recipient: { id: row.recipientId, name: names.get(row.recipientId) ?? 'Someone' },
      companyId: row.companyId,
      templateId: row.templateId,
      templateName: row.templateId ? tnames.get(row.templateId) ?? null : null,
      createdAt: row.createdAt.toISOString(),
      cancelledAt: iso(row.cancelledAt),
      rawMessage: row.message,
    }));
  }

  async function list(userId: string, f: ListFilters = {}) {
    const { scope } = await manager(userId);
    const at = now();
    const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 200);
    const page = Math.max(f.page ?? 1, 1);
    const where = listWhere(scope, f, at);
    const [total, rows] = await Promise.all([
      prisma.appreciation.count({ where }),
      prisma.appreciation.findMany({ where, orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { total, page, pageSize, rows: await managedViews(rows, at) };
  }

  /** Every matching row (up to 5000) for the Excel file. */
  async function exportRows(userId: string, f: ListFilters = {}) {
    const { scope } = await manager(userId);
    const at = now();
    const rows = await prisma.appreciation.findMany({ where: listWhere(scope, f, at), orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take: 5000 });
    return managedViews(rows, at);
  }

  // ── The sweep: the bell notice when a day starts; the expired entry when one ends unaccepted ────────
  async function activate(ids: string[]): Promise<number> {
    const at = now();
    let sent = 0;
    for (const id of ids) {
      const done = await prisma.appreciation.updateMany({ where: { id, activatedAt: null, cancelledAt: null, startsAt: { lte: at }, endsAt: { gt: at } }, data: { activatedAt: at } });
      if (done.count !== 1) continue; // already done (another instance, or it was cancelled or ended)
      const r = await prisma.appreciation.findUniqueOrThrow({ where: { id } });
      // Made inactive (or a client) since it was scheduled: no notice (their Dashboard isn't shown either).
      if ((await prisma.user.count({ where: { AND: [{ id: r.recipientId }, STAFF_ACTIVE] } })) === 0) continue;
      const [v] = await views([r], at);
      await d.notify({ userId: r.recipientId, type: NOTICE_TYPE, title: W.noticeTitle(r.title), body: `From ${v!.sender.name}`, entityType: 'appreciation', entityId: r.id, projectId: null }).catch(() => undefined);
      await d.audit({ userId: null, action: 'APPRECIATION_ACTIVATED', entityId: id, newValue: { recipientId: r.recipientId, day: r.day } });
      sent++;
    }
    return sent;
  }

  async function sweep(): Promise<{ activated: number; expired: number }> {
    const at = now();
    const starting = await prisma.appreciation.findMany({
      where: { activatedAt: null, cancelledAt: null, startsAt: { lte: at }, endsAt: { gt: at } },
      select: { id: true },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    const activated = await activate(starting.map((r) => r.id));
    const ended = await prisma.appreciation.findMany({
      where: { expiredAt: null, acceptedAt: null, cancelledAt: null, endsAt: { lte: at } },
      select: { id: true, recipientId: true, day: true },
      orderBy: [{ endsAt: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    let expired = 0;
    for (const r of ended) {
      const done = await prisma.appreciation.updateMany({ where: { id: r.id, expiredAt: null, acceptedAt: null }, data: { expiredAt: at } });
      if (done.count !== 1) continue;
      await d.audit({ userId: null, action: 'APPRECIATION_EXPIRED', entityId: r.id, newValue: { recipientId: r.recipientId, day: r.day } });
      expired++;
    }
    return { activated, expired };
  }

  /** Today in the company time zone (file names). */
  const today = () => companyToday(now(), timeZone);

  return { today, me, accept, closePopup, mine, ensureBuiltIns, templates, createTemplate, updateTemplate, duplicateTemplate, archiveTemplate, companies, people, schedule, update, cancel, list, exportRows, sweep, activate };
}

export type AppreciationService = ReturnType<typeof createAppreciationService>;
