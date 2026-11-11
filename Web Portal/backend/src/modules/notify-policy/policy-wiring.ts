import { Prisma, type PrismaClient } from '@prisma/client';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { holidaysInRange, isWorkingDay, shiftDay, zonedDay, zonedInstant } from '../../lib/working-days';
import type { Viewer } from '../companies/company-access';
import { STAFF_ONLY_WHERE } from '../clients/client-kind';
import { normalizePreferences, type NotificationPreferences, type PreferenceStore } from '../notifications/notification-preferences';
import type { CreateNotificationData } from '../notifications/notification-repository';
import type { HeldNotice, NotificationDelivery } from '../notifications/notification-service';
import { decideDelivery, quietSpecFor, type DeliveryContext } from './delivery';
import type { HoldRow, HoldStore } from './holds';
import { planReminders } from './planner';
import { loadPlannerFacts, type PlannerSweepDeps } from './planner-sweep';
import { KIND_TYPES, NO_EMAIL_CHANNEL, POLICY_KINDS, REMINDER_KINDS, channelsFor } from './policy';
import type { CompanyRules, NotifyPolicyService } from './policy-service';
import type { NotifyPolicyRouteDeps, WorkingTimeView } from './policy-routes';

/**
 * The Notification & Scheduling centre wired to the database and the rest of the server: who a
 * person's company is, the working time a page asks for, a project's and a task's reminder settings,
 * the panel's preview, and delivery (each notice's bell / push / email for its person).
 */

type WorkingHours = { days: number[]; start: string; end: string };

export interface PolicyWiringDeps {
  prisma: PrismaClient;
  service: NotifyPolicyService;
  timeZone: string;
  /** The company a person belongs to for their rules (primary, else oldest active; null: the site's). */
  personCompany(userId: string): Promise<string | null>;
  /** A project's main company. */
  projectCompany(projectId: string): Promise<string | null>;
  canViewProject(userId: string, roles: string[], projectId: string): Promise<boolean>;
  canViewTask(userId: string, roles: string[], taskId: string): Promise<boolean>;
  canManageProject(userId: string, roles: string[], projectId: string): Promise<boolean>;
  /** The site's week start and working hours (System Settings). */
  site: { weekStart(): Promise<0 | 1 | 6>; workingHours(): Promise<WorkingHours>; save(weekStart: 0 | 1 | 6, hours: WorkingHours, actor: Viewer, ip: string | null): Promise<void> };
  /** A company's own values (null: follows the site) and saving them (the Companies page's rules and audit). */
  companyOwn(companyId: string): Promise<{ weekStart: number | null; workingHours: unknown } | null>;
  saveCompany(companyId: string, patch: { weekStart: 0 | 1 | 6 | null; workingHours: WorkingHours | null }, actor: Viewer, ip: string | null): Promise<void>;
  meetingReminders(): Promise<unknown>;
  audit?(entry: { userId: string | null; action: string; entityId: string; oldValue?: unknown; newValue?: unknown; ip?: string | null }): Promise<void>;
  /** The planner's data sources (for the preview). */
  planner: Pick<PlannerSweepDeps, 'prisma' | 'audience' | 'runners' | 'approvers' | 'checklistItems' | 'leadDays'>;
  preferences: PreferenceStore;
}

const nameOf = (u: { firstName: string | null; lastName: string | null; username: string }) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username;

export function createPolicyWiring(deps: PolicyWiringDeps) {
  const { prisma, service } = deps;

  async function activeCompanyCount(): Promise<number> {
    return prisma.company.count({ where: { status: 'ACTIVE' } });
  }

  async function workingTimeOf(companyId: string): Promise<WorkingTimeView> {
    const own = await deps.companyOwn(companyId);
    if (!own) throw new NotFoundError('Company not found.');
    const [siteWeek, siteHours] = await Promise.all([deps.site.weekStart(), deps.site.workingHours()]);
    const hours = own.workingHours && typeof own.workingHours === 'object' ? (own.workingHours as WorkingHours) : null;
    const week = own.weekStart === 0 || own.weekStart === 1 || own.weekStart === 6 ? own.weekStart : null;
    return { weekStart: week ?? siteWeek, workingHours: hours ?? siteHours, own: week !== null || hours !== null };
  }

  const routes: Omit<NotifyPolicyRouteDeps, 'guard' | 'service' | 'pickOf' | 'timeZone'> = {
    async companies() {
      return prisma.company.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    },
    workingTimeOf,
    /**
     * A company that follows the site's working time, on a site with one active company: the site's
     * values change (what follows them stays the same). Otherwise the company gets its own.
     */
    async saveWorkingTime(companyId, value, actor, ip) {
      const current = await workingTimeOf(companyId);
      if (!current.own && (await activeCompanyCount()) <= 1) await deps.site.save(value.weekStart, value.workingHours, actor, ip);
      else await deps.saveCompany(companyId, { weekStart: value.weekStart, workingHours: value.workingHours }, actor, ip);
      return workingTimeOf(companyId);
    },
    async resetWorkingTime(companyId, actor, ip) {
      await deps.saveCompany(companyId, { weekStart: null, workingHours: null }, actor, ip);
      return workingTimeOf(companyId);
    },
    async people(companyId) {
      const users = await prisma.user.findMany({
        where: { deletedAt: null, status: 'ACTIVE', ...STAFF_ONLY_WHERE, OR: [{ companies: { some: { companyId } } }, { roles: { some: { role: { name: 'ADMIN' } } } }] },
        select: { id: true, firstName: true, lastName: true, username: true, email: true, roles: { select: { role: { select: { name: true } } } } },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
        take: 2000,
      });
      return users.map((u) => ({ id: u.id, name: nameOf(u), email: u.email, admin: u.roles.some((r) => r.role.name === 'ADMIN') }));
    },
    meetingReminders: () => deps.meetingReminders(),
    preview: (companyId, userId) => preview(companyId, userId),
    personPolicy: (userId) => personPolicy(userId),
    async workingTime(viewer, target, range) {
      let companyId: string | null = null;
      if (target.projectId && (await deps.canViewProject(viewer.id, viewer.roles, target.projectId))) companyId = await deps.projectCompany(target.projectId);
      else if (target.companyId && (viewer.roles.includes('ADMIN') || (await myCompanies(viewer.id)).includes(target.companyId))) companyId = target.companyId;
      else companyId = target.pick ?? (await deps.personCompany(viewer.id));
      const r = await service.rules(companyId);
      return {
        companyId,
        timeZone: deps.timeZone,
        weekStart: r.weekStart,
        workingDays: [...r.calendar.workingDays],
        hours: r.hours,
        from: range.from,
        to: range.to,
        daysOff: holidaysInRange(range.from, range.to, r.calendar),
      };
    },
    projectReminders: {
      async get(viewer, projectId) {
        if (!(await deps.canViewProject(viewer.id, viewer.roles, projectId))) throw new NotFoundError('Project not found.');
        const p = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { reminderScheduleId: true, escalationDays: true } });
        if (!p) throw new NotFoundError('Project not found.');
        const companyId = await deps.projectCompany(projectId);
        const r = await service.rules(companyId);
        const schedules = companyId ? await service.schedules(companyId) : [];
        return {
          scheduleId: p.reminderScheduleId && r.schedules.has(p.reminderScheduleId) ? p.reminderScheduleId : null,
          escalationDays: p.escalationDays ?? null,
          schedules: schedules.map((s) => ({ id: s.id, name: s.name, isDefault: s.isDefault, steps: s.steps })),
          companyEscalation: { step1Days: r.policy.escalation.step1Days, step2Days: r.policy.escalation.step2Days },
          canEdit: await deps.canManageProject(viewer.id, viewer.roles, projectId),
        };
      },
      async set(viewer, projectId, body, ip) {
        if (!(await deps.canViewProject(viewer.id, viewer.roles, projectId))) throw new NotFoundError('Project not found.');
        if (!(await deps.canManageProject(viewer.id, viewer.roles, projectId))) throw new ForbiddenError('Only whoever runs the project (or an admin) can change its reminders.');
        const companyId = await deps.projectCompany(projectId);
        const r = await service.rules(companyId);
        if (body.scheduleId && !r.schedules.has(body.scheduleId)) throw new ValidationError('Choose one of the company’s schedules.');
        const before = await prisma.project.findUnique({ where: { id: projectId }, select: { reminderScheduleId: true, escalationDays: true } });
        await prisma.project.update({
          where: { id: projectId },
          data: {
            ...(body.scheduleId !== undefined ? { reminderScheduleId: body.scheduleId } : {}),
            ...(body.escalationDays !== undefined ? { escalationDays: body.escalationDays === null ? Prisma.DbNull : body.escalationDays } : {}),
          },
        });
        await deps.audit?.({ userId: viewer.id, action: 'project.reminders.update', entityId: projectId, oldValue: before, newValue: body, ip }).catch(() => {});
        return routes.projectReminders.get(viewer, projectId);
      },
    },
    taskSchedule: {
      async get(viewer, taskId) {
        if (!(await deps.canViewTask(viewer.id, viewer.roles, taskId))) throw new NotFoundError('Task not found.');
        const t = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null }, select: { reminderScheduleId: true, projectId: true, createdById: true, project: { select: { reminderScheduleId: true } } } });
        if (!t) throw new NotFoundError('Task not found.');
        const companyId = await deps.projectCompany(t.projectId);
        const r = await service.rules(companyId);
        const schedules = companyId ? await service.schedules(companyId) : [];
        const projectScheduleId = t.project.reminderScheduleId && r.schedules.has(t.project.reminderScheduleId) ? t.project.reminderScheduleId : null;
        return {
          scheduleId: t.reminderScheduleId && r.schedules.has(t.reminderScheduleId) ? t.reminderScheduleId : null,
          projectScheduleId,
          inUseId: (t.reminderScheduleId && r.schedules.has(t.reminderScheduleId) ? t.reminderScheduleId : null) ?? projectScheduleId ?? r.defaultScheduleId,
          schedules: schedules.map((s) => ({ id: s.id, name: s.name, isDefault: s.isDefault, steps: s.steps })),
          canEdit: t.createdById === viewer.id || (await deps.canManageProject(viewer.id, viewer.roles, t.projectId)),
        };
      },
      async set(viewer, taskId, scheduleId, ip) {
        if (!(await deps.canViewTask(viewer.id, viewer.roles, taskId))) throw new NotFoundError('Task not found.');
        const t = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null }, select: { reminderScheduleId: true, projectId: true, createdById: true } });
        if (!t) throw new NotFoundError('Task not found.');
        if (t.createdById !== viewer.id && !(await deps.canManageProject(viewer.id, viewer.roles, t.projectId))) throw new ForbiddenError('Only whoever made the task or runs its project can change its reminders.');
        const r = await service.rules(await deps.projectCompany(t.projectId));
        if (scheduleId && !r.schedules.has(scheduleId)) throw new ValidationError('Choose one of the company’s schedules.');
        await prisma.task.update({ where: { id: taskId }, data: { reminderScheduleId: scheduleId } });
        await deps.audit?.({ userId: viewer.id, action: 'task.reminders.update', entityId: taskId, oldValue: { scheduleId: t.reminderScheduleId }, newValue: { scheduleId }, ip }).catch(() => {});
        return routes.taskSchedule.get(viewer, taskId);
      },
    },
  };

  async function myCompanies(userId: string): Promise<string[]> {
    return (await prisma.companyMember.findMany({ where: { userId, company: { status: 'ACTIVE' } }, select: { companyId: true } })).map((c) => c.companyId);
  }

  // ── A person: their company's rules and their own zone ──────────────────
  const personCache = new Map<string, { at: number; value: Promise<{ companyId: string | null; zone: string }> }>();
  function person(userId: string): Promise<{ companyId: string | null; zone: string }> {
    const hit = personCache.get(userId);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;
    const value = (async () => {
      const [companyId, u] = await Promise.all([deps.personCompany(userId), prisma.user.findUnique({ where: { id: userId }, select: { preferredTimeZone: true } })]);
      return { companyId, zone: validZone(u?.preferredTimeZone) ?? deps.timeZone };
    })();
    personCache.set(userId, { at: Date.now(), value });
    if (personCache.size > 5000) personCache.clear();
    value.catch(() => personCache.delete(userId));
    return value;
  }

  async function contextFor(userId: string, at: Date): Promise<{ ctx: DeliveryContext; rules: CompanyRules }> {
    const p = await person(userId);
    const rules = await service.rules(p.companyId);
    return { rules, ctx: { now: at, policy: rules.policy, calendar: rules.calendar, hours: rules.hours, companyZone: deps.timeZone, personZone: p.zone } };
  }

  /** Settings → Notifications: the person's company rules beside their own choices. */
  async function personPolicy(userId: string) {
    const p = await person(userId);
    const { rules } = await contextFor(userId, new Date());
    const prefs = await deps.preferences.get(userId);
    const company = p.companyId ? await prisma.company.findUnique({ where: { id: p.companyId }, select: { name: true } }) : null;
    return {
      companyId: p.companyId,
      companyName: company?.name ?? null,
      timeZone: deps.timeZone,
      personZone: p.zone,
      weekStart: rules.weekStart,
      workingDays: [...rules.calendar.workingDays],
      hours: rules.hours,
      quietHours: rules.policy.quietHours,
      kinds: POLICY_KINDS.map((k) => ({
        key: k,
        types: [...KIND_TYPES[k]],
        required: rules.policy.required.includes(k),
        defaults: rules.policy.channels[k],
        emailChannel: !NO_EMAIL_CHANNEL.includes(k),
        /** Planner reminders the company turned off never come. */
        on: (REMINDER_KINDS as readonly string[]).includes(k) ? rules.policy.remindersOn[k as (typeof REMINDER_KINDS)[number]] : true,
        current: channelsFor(prefs, k, rules.policy),
      })),
    };
  }

  /** "Preview for a person": what they would get each day of the coming week, and how. */
  async function preview(companyId: string, userId: string) {
    const u = await prisma.user.findFirst({ where: { id: userId, deletedAt: null, ...STAFF_ONLY_WHERE }, select: { id: true, firstName: true, lastName: true, username: true, status: true } });
    if (!u) throw new NotFoundError('Person not found.');
    const prefs: NotificationPreferences = await deps.preferences.get(userId);
    const now = new Date();
    const facts = await loadPlannerFacts({ ...deps.planner, rules: (c) => service.rules(c) }, now);
    const { rules: theirs } = await contextFor(userId, now);
    const today = zonedDay(now, deps.timeZone);
    const seen = new Set<string>();
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = shiftDay(today, i);
      // Mid-morning of each day (company time): the sweep runs hourly.
      const at = i === 0 ? now : zonedInstant(day, '10:00', deps.timeZone);
      const planned = planReminders({ now: at, timeZone: deps.timeZone, tasks: facts.tasks, items: facts.items, rules: facts.rules, leadDaysFor: facts.leadDaysFor }).filter((n) => n.userId === userId && !seen.has(n.dedupeKey));
      const { ctx } = await contextFor(userId, at);
      const items = planned.map((n) => {
        seen.add(n.dedupeKey);
        const d = decideDelivery(n.type, prefs, ctx);
        return { kind: n.kind, type: n.type, title: n.title, body: n.body, taskId: n.entityId, bell: d.bell, push: d.push, email: d.email, releaseAt: d.releaseAt?.toISOString() ?? null };
      });
      const holiday = theirs.calendar.holidays.length ? holidaysInRange(day, day, theirs.calendar)[0]?.name ?? null : null;
      days.push({ day, working: isWorkingDay(day, theirs.calendar), holiday, items });
    }
    const spec = quietSpecFor(prefs, (await contextFor(userId, now)).ctx);
    return {
      person: { id: u.id, name: nameOf(u), active: u.status === 'ACTIVE' },
      companyId,
      quietHours: spec.off ? { mode: 'off' } : { zone: spec.zone, start: spec.start, end: spec.end, daysOff: spec.daysOff },
      paused: prefs.pauseUntil ?? null,
      days,
    };
  }

  // ── Delivery ─────────────────────────────────────────────────────────────
  function delivery(io: { holds: HoldStore; sendEmail(userId: string, input: CreateNotificationData): Promise<void>; now?: () => Date }): NotificationDelivery {
    return {
      async decide(userId, type, opts) {
        const at = io.now ? io.now() : new Date();
        const [prefs, { ctx }] = await Promise.all([deps.preferences.get(userId), contextFor(userId, at)]);
        return decideDelivery(type, normalizePreferences(prefs), ctx, opts);
      },
      hold: (entry: HeldNotice) => io.holds.add(entry),
      email: (userId, input) => io.sendEmail(userId, input),
    };
  }

  return { routes, delivery, personPolicy, preview, contextFor, clearPeople: () => personCache.clear() };
}

function validZone(z: string | null | undefined): string | null {
  if (!z) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return z;
  } catch {
    return null;
  }
}

/** One email for a notice (the email channel), and one listing a person's held notices. */
export function createNoticeEmails(deps: {
  prisma: PrismaClient;
  appUrl: string;
  isConfigured(): boolean;
  send(email: string, params: { heading: string; message: string; items?: string[]; actionLabel?: string; actionLink?: string }, userId: string): Promise<unknown>;
}) {
  const base = deps.appUrl.replace(/\/$/, '');
  const linkOf = (entityType: string | null | undefined, entityId: string | null | undefined): string => {
    if (entityType === 'task' && entityId) return `${base}/my-tasks?task=${encodeURIComponent(entityId)}`;
    if (entityType === 'meeting' && entityId) return `${base}/meetings/${encodeURIComponent(entityId)}`;
    if (entityType === 'project' && entityId) return `${base}/projects/${encodeURIComponent(entityId)}`;
    if (entityType === 'my-tasks') return `${base}/my-tasks`;
    if (entityType === 'management') return `${base}/management`;
    if (entityType === 'approvals') return `${base}/my-tasks#to-approve`;
    return `${base}/notifications`;
  };
  async function addressOf(userId: string): Promise<string | null> {
    if (!deps.isConfigured()) return null;
    const u = await deps.prisma.user.findFirst({ where: { id: userId, deletedAt: null, status: 'ACTIVE' }, select: { email: true } });
    return u?.email ?? null;
  }
  return {
    async sendNotice(userId: string, input: CreateNotificationData): Promise<void> {
      const to = await addressOf(userId);
      if (!to) return;
      const lines = (input.body ?? '').split('\n').filter(Boolean);
      await deps.send(to, { heading: input.title, message: lines.length > 1 ? 'These need your attention:' : (lines[0] ?? input.title), ...(lines.length > 1 ? { items: lines } : {}), actionLabel: 'Open', actionLink: linkOf(input.entityType, input.entityId) }, userId);
    },
    async sendBundle(userId: string, items: HoldRow[]): Promise<void> {
      const to = await addressOf(userId);
      if (!to || items.length === 0) return;
      await deps.send(
        to,
        {
          heading: items.length === 1 ? items[0]!.title : `${items.length} notices while you were away`,
          message: 'These came in outside your working hours:',
          items: items.map((i) => (i.body ? `${i.title} — ${i.body.split('\n')[0]}` : i.title)),
          actionLabel: 'Open notifications',
          actionLink: `${base}/notifications`,
        },
        userId,
      );
    },
  };
}
