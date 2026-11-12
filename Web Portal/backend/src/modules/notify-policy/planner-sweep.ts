import type { PrismaClient } from '@prisma/client';
import { filterTaskRecipients } from '../notifications/recipient-access';
import { taskAudienceSelect, toAudienceFacts } from '../notifications/prisma-task-audience';
import { isTaskDone } from '../tasks/task-status';
import { LIVE_PROJECT_WHERE } from '../companies/company-access';
import { NOT_ARCHIVED } from '../tasks/task-archive-where';
import { notWaitingWhere } from '../tasks/scheduled-start';
import { bundleNotices, planReminders, type PlannedNotice, type PlannerItem, type PlannerTask } from './planner';
import type { CompanyRules } from './policy-service';

/**
 * The reminder sweep of the Notification & Scheduling centre (replaces the old deadline-reminder and
 * escalation sweeps): reads the open tasks and what the planner needs about them, plans, sends each
 * reminder once (its key in reminder_logs, prefixed `np:`), and — the first time it runs after the
 * upgrade — only records what is due without sending it, so nobody gets a burst of notices.
 */

/** Keys of planner reminders in reminder_logs: kept a year (a once-only step must stay once). */
export const PLANNER_KEY_PREFIX = 'np:';
export const PLANNER_KEY_DAYS = 400;
/** system_settings: when the planner first ran (its first run only records). */
export const PLANNER_SINCE_KEY = 'notifications.plannerSince';

/** The actions that count as work on a task (inactivity): a comment, a status change, a tick, a file. */
export const ACTIVITY_ACTIONS = [
  'CREATED',
  'COMMENTED',
  'MOVED',
  'COMPLETED',
  'REOPENED',
  'APPROVAL_REQUESTED',
  'APPROVED',
  'APPROVAL_WITHDRAWN',
  'SENT_BACK',
  'CHECKLIST_DONE',
  'CHECKLIST_REOPENED',
  'ATTACHED',
  'PROJECT_CHANGED',
  'CLIENT_SENT_BACK',
  // Rows written before 1.18.
  'task.created',
  'task.moved',
  'task.completed',
  'task.reopened',
  'comment.added',
  'attachment.added',
] as const;
/** The actions that put a task into its current column. */
export const COLUMN_ACTIONS = ['CREATED', 'MOVED', 'REOPENED', 'SENT_BACK', 'APPROVAL_WITHDRAWN', 'PROJECT_CHANGED', 'COMPLETED', 'task.created', 'task.moved', 'task.reopened'] as const;

export interface SweepAudience {
  users: { id: string; notificationPrefs: unknown }[];
  activeIds: string[];
  adminIds: string[];
  companiesOf: Map<string, string[]>;
}

export interface ReminderKeyStore {
  /** Which of these keys are already recorded. */
  existing(keys: string[]): Promise<Set<string>>;
  addMany(keys: string[]): Promise<void>;
}

export interface PlannerSweepDeps {
  prisma: PrismaClient;
  timeZone: string;
  rules(companyId: string | null): Promise<CompanyRules>;
  audience(): Promise<SweepAudience>;
  /** Who runs each project (escalation step 1, Blocked, inactivity step 2). */
  runners(projectIds: string[]): Promise<Map<string, string[]>>;
  /** Who approves a project's tasks (its runners, else the admins), never the one who asked. */
  approvers(projectId: string, exceptId: string | null): Promise<string[]>;
  /** Open dated checklist items of open tasks, with their task's assignees. */
  checklistItems(): Promise<{ id: string; text: string; dueDate: Date; assigneeId: string | null; taskId: string; taskKey: string; taskAssigneeIds: string[] }[]>;
  keys: ReminderKeyStore;
  notify(n: { userId: string; type: string; title: string; body: string; entityType: string | null; entityId: string | null }): Promise<unknown>;
  /** A person's own "remind me before due" lead, in calendar days (from their preferences). */
  leadDays(prefs: unknown): number | undefined;
  now?: () => Date;
  logger?: { info(msg: string, meta?: Record<string, unknown>): void; error?(msg: string, meta?: Record<string, unknown>): void };
}

const chunk = <T>(list: T[], size = 1000): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/** The latest of each task's log lines with these actions. */
async function latestActivity(prisma: PrismaClient, taskIds: string[], actions: readonly string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  for (const ids of chunk(taskIds)) {
    const rows = await prisma.activity.groupBy({ by: ['taskId'], where: { taskId: { in: ids }, action: { in: [...actions] } }, _max: { createdAt: true } });
    for (const r of rows) if (r.taskId && r._max.createdAt) out.set(r.taskId, r._max.createdAt);
  }
  return out;
}

/** The latest due-date change of each task (an edit that moves its time counts as work). */
async function latestDueChange(prisma: PrismaClient, taskIds: string[], since: Date): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  for (const ids of chunk(taskIds)) {
    const rows = await prisma.activity.findMany({ where: { taskId: { in: ids }, action: 'UPDATED', createdAt: { gte: since } }, select: { taskId: true, meta: true, createdAt: true } });
    for (const r of rows) {
      const changes = (r.meta as { changes?: { field?: string }[] } | null)?.changes;
      if (!r.taskId || !Array.isArray(changes) || !changes.some((c) => c?.field === 'dueDate')) continue;
      const prev = out.get(r.taskId);
      if (!prev || prev < r.createdAt) out.set(r.taskId, r.createdAt);
    }
  }
  return out;
}

const later = (...ds: (Date | null | undefined)[]): Date | null => ds.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);

/** Everything the planner needs, read from the database (also for the panel's "Preview for a person"). */
export async function loadPlannerFacts(deps: Pick<PlannerSweepDeps, 'prisma' | 'timeZone' | 'audience' | 'runners' | 'approvers' | 'checklistItems' | 'rules' | 'leadDays'>, now: Date) {
  const { prisma } = deps;
  // Archived projects (their own status, or all their companies archived) are locked: nothing about them.
  // Release B: never an archived task (task archive), nor one waiting for its start day — a later day's board
  // (tasks for the future: no reminders before that day, owner 10 Nov).
  const rows = await prisma.task.findMany({
    where: { deletedAt: null, completedAt: null, ...NOT_ARCHIVED, ...notWaitingWhere(deps.timeZone, now), project: { is: { deletedAt: null, ...LIVE_PROJECT_WHERE } } },
    select: {
      id: true,
      key: true,
      title: true,
      projectId: true,
      dueDate: true,
      startDate: true,
      completedAt: true,
      approvalRequestedAt: true,
      approvalRequestedById: true,
      reminderScheduleId: true,
      createdAt: true,
      column: { select: { category: true } },
      watchers: { select: { userId: true } },
      dependencies: { select: { dependsOn: { select: { deletedAt: true, archivedAt: true, completedAt: true, column: { select: { category: true } } } } } },
      ...taskAudienceSelect,
    },
  });
  const open = rows.filter((t) => !isTaskDone({ columnCategory: t.column?.category ?? null, completedAt: t.completedAt }));
  const projectIds = [...new Set(open.map((t) => t.projectId))];
  const projects = new Map(
    (projectIds.length
      ? await prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, status: true, mainCompanyId: true, reminderScheduleId: true, escalationDays: true, companies: { select: { companyId: true }, orderBy: [{ addedAt: 'asc' }, { companyId: 'asc' }], take: 1 } },
        })
      : []
    ).map((p) => [p.id, p]),
  );
  const companyOf = (projectId: string) => {
    const p = projects.get(projectId);
    return p?.mainCompanyId ?? p?.companies[0]?.companyId ?? null;
  };
  const companyIds = [...new Set(projectIds.map(companyOf))];
  const rules = new Map(await Promise.all(companyIds.map(async (c) => [c ?? '', await deps.rules(c)] as const)));
  const audience = await deps.audience();
  const opts = { activeIds: audience.activeIds, adminIds: audience.adminIds, companiesOf: audience.companiesOf };
  const runners = await deps.runners(projectIds);

  const blocked = open.filter((t) => t.column?.category === 'BLOCKED').map((t) => t.id);
  const started = open.filter((t) => t.column?.category === 'IN_PROGRESS' || t.column?.category === 'REVIEW').map((t) => t.id);
  const [entered, worked, dueMoved] = await Promise.all([
    latestActivity(prisma, blocked, COLUMN_ACTIONS),
    latestActivity(prisma, started, ACTIVITY_ACTIONS),
    latestDueChange(prisma, started, new Date(now.getTime() - 120 * 86_400_000)),
  ]);
  const approverCache = new Map<string, Promise<string[]>>();
  const approversOf = (projectId: string, except: string | null) => {
    const k = `${projectId}|${except ?? ''}`;
    if (!approverCache.has(k)) approverCache.set(k, deps.approvers(projectId, except));
    return approverCache.get(k)!;
  };

  /** Step 2: the company's admins (those in it, else every admin) or its chosen people, active. */
  const step2Of = (companyId: string | null): string[] => {
    const p = rules.get(companyId ?? '')!.policy.escalation;
    const inCompany = companyId ? audience.adminIds.filter((a) => audience.companiesOf.get(a)?.includes(companyId)) : [];
    const admins = p.admins ? (inCompany.length ? inCompany : audience.adminIds) : [];
    return [...new Set([...admins, ...p.userIds.filter((u) => audience.activeIds.includes(u))])];
  };

  const tasks: PlannerTask[] = [];
  for (const t of open) {
    const facts = toAudienceFacts(t);
    const companyId = companyOf(t.projectId);
    const project = projects.get(t.projectId);
    const esc = project?.escalationDays as { step1Days?: unknown; step2Days?: unknown } | null | undefined;
    const assignees = t.assignees.map((a) => a.userId);
    tasks.push({
      id: t.id,
      key: t.key,
      title: t.title,
      companyId,
      dueDate: t.dueDate,
      startDate: t.startDate,
      columnCategory: t.column?.category ?? null,
      completedAt: t.completedAt,
      approvalRequestedAt: t.approvalRequestedAt,
      scheduleId: t.reminderScheduleId,
      projectScheduleId: project?.reminderScheduleId ?? null,
      escalation: esc && typeof esc.step1Days === 'number' && typeof esc.step2Days === 'number' ? { step1Days: esc.step1Days, step2Days: esc.step2Days } : null,
      // Watchers get due/overdue reminders too, while they can still open the task.
      remindIds: filterTaskRecipients([...assignees, ...t.watchers.map((w) => w.userId)], facts, opts),
      assigneeIds: filterTaskRecipients(assignees, facts, opts),
      runnerIds: runners.get(t.projectId) ?? [],
      approverIds: t.approvalRequestedAt ? filterTaskRecipients(await approversOf(t.projectId, t.approvalRequestedById), facts, opts) : [],
      step2Ids: filterTaskRecipients(step2Of(companyId), facts, opts),
      enteredColumnAt: entered.get(t.id) ?? t.createdAt,
      lastActivityAt: later(worked.get(t.id), dueMoved.get(t.id), t.createdAt),
      // An archived blocker is out of the way (as Release A's daily email reads it: an archived task no longer blocks).
      hasOpenBlocker: t.dependencies.some((d) => !d.dependsOn.deletedAt && !d.dependsOn.archivedAt && !isTaskDone({ columnCategory: d.dependsOn.column?.category ?? null, completedAt: d.dependsOn.completedAt })),
      projectPaused: project?.status === 'ON_HOLD' || project?.status === 'COMPLETED',
    });
  }

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const facts = new Map(open.map((t) => [t.id, toAudienceFacts(t)]));
  const items: PlannerItem[] = [];
  for (const i of await deps.checklistItems()) {
    const t = byId.get(i.taskId);
    const f = facts.get(i.taskId);
    if (!t || !f || t.approvalRequestedAt) continue;
    items.push({
      id: i.id,
      text: i.text,
      dueDate: i.dueDate,
      taskId: i.taskId,
      taskKey: i.taskKey,
      companyId: t.companyId,
      scheduleId: t.scheduleId,
      projectScheduleId: t.projectScheduleId,
      // An item given to someone reminds them; else the task's assignees (those who may still open it).
      recipientIds: filterTaskRecipients(i.assigneeId ? [i.assigneeId] : i.taskAssigneeIds, f, opts),
    });
  }
  const lead = new Map<string, number>();
  for (const u of audience.users) {
    const d = deps.leadDays(u.notificationPrefs);
    if (d !== undefined) lead.set(u.id, d);
  }
  return { tasks, items, rules: (c: string | null) => rules.get(c ?? '') ?? rules.values().next().value!, leadDaysFor: (u: string) => lead.get(u) };
}

export function createPlannerSweep(deps: PlannerSweepDeps & { firstRun: { done(): Promise<boolean>; mark(at: Date): Promise<void> } }) {
  const now = () => (deps.now ? deps.now() : new Date());

  /** Plan now; send what is new (recording it), or — the first time — only record. */
  async function run(): Promise<{ planned: number; sent: number; recordedOnly: boolean }> {
    const at = now();
    const facts = await loadPlannerFacts(deps, at);
    const planned = planReminders({ now: at, timeZone: deps.timeZone, tasks: facts.tasks, items: facts.items, rules: facts.rules, leadDaysFor: facts.leadDaysFor });
    const key = (n: PlannedNotice) => `${PLANNER_KEY_PREFIX}${n.dedupeKey}`;
    const known = await deps.keys.existing(planned.map(key));
    const fresh = planned.filter((n) => !known.has(key(n)));
    if (!(await deps.firstRun.done())) {
      // The upgrade: what is already due was sent by the old sweeps (or would be a burst) — record only.
      await deps.keys.addMany(fresh.map(key));
      await deps.firstRun.mark(at);
      deps.logger?.info('notification planner: first run recorded what is due without sending', { recorded: fresh.length });
      return { planned: planned.length, sent: 0, recordedOnly: true };
    }
    let sent = 0;
    for (const out of bundleNotices(fresh)) {
      // One person's notice failing (their rules can't be read) never stops everyone else's: it is tried next hour.
      try {
        await deps.notify(out.notice);
      } catch (err) {
        deps.logger?.error?.('a reminder could not be sent', { err, userId: out.userId, kind: out.kind });
        continue;
      }
      await deps.keys.addMany(out.dedupeKeys.map((k) => `${PLANNER_KEY_PREFIX}${k}`));
      sent++;
    }
    return { planned: planned.length, sent, recordedOnly: false };
  }
  return { run };
}

/** reminder_logs for the planner's keys (batched reads and writes). */
export function createPrismaReminderKeys(prisma: PrismaClient): ReminderKeyStore {
  return {
    async existing(keys) {
      const out = new Set<string>();
      for (const ids of chunk([...new Set(keys)])) {
        for (const r of await prisma.reminderLog.findMany({ where: { dedupeKey: { in: ids } }, select: { dedupeKey: true } })) out.add(r.dedupeKey);
      }
      return out;
    },
    async addMany(keys) {
      for (const ids of chunk([...new Set(keys)])) if (ids.length) await prisma.reminderLog.createMany({ data: ids.map((dedupeKey) => ({ dedupeKey })), skipDuplicates: true });
    },
  };
}

/** The planner's first-run mark in system_settings. */
export function createPrismaFirstRun(prisma: PrismaClient) {
  return {
    async done() {
      return (await prisma.systemSetting.count({ where: { key: PLANNER_SINCE_KEY } })) > 0;
    },
    async mark(at: Date) {
      await prisma.systemSetting.upsert({ where: { key: PLANNER_SINCE_KEY }, create: { key: PLANNER_SINCE_KEY, value: at.toISOString() }, update: {} });
    },
  };
}

/** A person's lead time in whole calendar days, from their stored preferences (as before: minutes rounded up). */
export function leadDaysOf(prefs: unknown): number | undefined {
  const lead = (prefs as { reminderLeadMinutes?: unknown } | null)?.reminderLeadMinutes;
  return typeof lead === 'number' && Number.isInteger(lead) && lead >= 0 ? Math.max(0, Math.ceil((lead * 60_000) / 86_400_000)) : undefined;
}

