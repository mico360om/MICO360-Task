import type { PrismaClient } from '@prisma/client';
import type { WorkCalendar, WorkHours } from '../../lib/working-days';
import { LIVE_PROJECT_WHERE } from '../companies/company-access';
import { zonedStartOfDay } from '../../lib/due-date';
import { managedVisibleWhere } from '../projects/project-managers';
import { nextMonth } from './kpi-defs';
import { STAFF_ONLY_WHERE } from '../clients/client-kind';
import { createPrismaManagementSource } from '../management/prisma-management-source';
import type { ProjectAccess } from '../projects/project-access';
import type { ProjectAuthz } from '../projects/project-authz';
import { createKpiEngine } from './kpi-engine';
import { createKpiService, type KpiViewer } from './kpi-service';
import { createKpiValuesReminder, type DueProject } from './kpi-reminder';
import { createSnapshotJob, SNAPSHOT_STATE_KEY, type SnapshotState } from './kpi-snapshots';
import { NO_PLANNED_HOURS, type PlannedHoursSource } from './kpi-source';
import { createPrismaKpiAccess } from './prisma-kpi-access';
import { createPrismaKpiSource } from './prisma-kpi-source';
import { createPrismaCustomKpiStore, createPrismaSnapshotStore, createPrismaTargetStore } from './kpi-stores';

export interface KpiWiringDeps {
  timeZone: string;
  projectAccess: ProjectAccess;
  projectAuthz: ProjectAuthz;
  /** A company's working days, holidays and hours — the Notification & Scheduling rules (null: the site's). */
  rules(companyId: string | null): Promise<{ calendar: WorkCalendar; hours: WorkHours }>;
  /** The site's week start (KPI weeks and trend weeks). */
  weekStart(): Promise<number>;
  myProjectsOnly?(viewer: KpiViewer): Promise<boolean>;
  /** The Calendar's work blocks (planned hours); absent: none yet. */
  planned?: PlannedHoursSource;
  /** A notice through the notification service (Notification & Scheduling delivery). */
  notify(n: { userId: string; type: string; title: string; body: string | null; entityType: string | null; entityId: string | null; projectId: string | null }): Promise<unknown>;
  logger?: { info(msg: string, meta?: Record<string, unknown>): void };
  now?: () => Date;
}

/** Project KPIs and User KPIs wired to the database: the service, the snapshot job and the monthly reminder. */
export function createKpisFromPrisma(prisma: PrismaClient, d: KpiWiringDeps) {
  const source = createPrismaKpiSource(prisma, d.timeZone);
  const engine = createKpiEngine({ source, timeZone: d.timeZone, rules: d.rules, ...(d.now ? { now: d.now } : {}) });
  const snapshots = createPrismaSnapshotStore(prisma);
  const management = createPrismaManagementSource(prisma, d.timeZone);
  const service = createKpiService({
    engine,
    source,
    snapshots,
    targets: createPrismaTargetStore(prisma),
    custom: createPrismaCustomKpiStore(prisma),
    planned: d.planned ?? NO_PLANNED_HOURS,
    access: createPrismaKpiAccess(prisma, { projectAccess: d.projectAccess, projectAuthz: d.projectAuthz }),
    management: { projects: (runBy, pick, opts) => management.projects(runBy, pick, opts), runCount: (u) => management.runCount(u) },
    ...(d.myProjectsOnly ? { myProjectsOnly: d.myProjectsOnly } : {}),
    rules: d.rules,
    weekStart: d.weekStart,
    companies: () => prisma.company.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
    timeZone: d.timeZone,
    ...(d.now ? { now: d.now } : {}),
  });

  const job = createSnapshotJob({
    engine,
    source,
    store: snapshots,
    state: {
      async get(): Promise<SnapshotState> {
        const row = await prisma.systemSetting.findUnique({ where: { key: SNAPSHOT_STATE_KEY } });
        const v = (row?.value ?? {}) as Partial<SnapshotState>;
        return { launchDay: v.launchDay ?? null, rebuiltAt: v.rebuiltAt ?? null, lastNightlyDay: v.lastNightlyDay ?? null, ...(v.rebuildMs !== undefined ? { rebuildMs: v.rebuildMs } : {}), ...(v.rebuildProjects !== undefined ? { rebuildProjects: v.rebuildProjects } : {}) };
      },
      async set(s) {
        const value = JSON.parse(JSON.stringify(s));
        await prisma.systemSetting.upsert({ where: { key: SNAPSHOT_STATE_KEY }, create: { key: SNAPSHOT_STATE_KEY, value }, update: { value } });
      },
    },
    projectIds: async () => (await prisma.project.findMany({ where: { deletedAt: null }, select: { id: true }, orderBy: [{ id: 'asc' }] })).map((p) => p.id),
    weekStart: d.weekStart,
    timeZone: d.timeZone,
    ...(d.now ? { now: d.now } : {}),
    ...(d.logger ? { logger: d.logger } : {}),
  });

  const reminder = createKpiValuesReminder({
    async projectsDue(month): Promise<DueProject[]> {
      const kpis = await prisma.projectKpi.findMany({
        // A KPI added this month isn't asked about last month (review minor).
        where: { createdAt: { lt: zonedStartOfDay(`${nextMonth(month)}-01`, d.timeZone) }, project: { deletedAt: null, AND: [LIVE_PROJECT_WHERE, { status: { in: ['PLANNING', 'ACTIVE', 'ON_HOLD'] } }] } },
        select: {
          name: true,
          projectId: true,
          values: { where: { month }, select: { id: true } },
          project: {
            select: {
              name: true,
              ownerId: true,
              managerId: true,
              mainCompanyId: true,
              members: { where: { role: 'MANAGER' }, select: { userId: true } },
              companies: { select: { companyId: true }, orderBy: [{ addedAt: 'asc' }, { companyId: 'asc' }], take: 1 },
            },
          },
        },
        orderBy: [{ projectId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
      });
      const byProject = new Map<string, DueProject & { candidates: string[] }>();
      for (const k of kpis) {
        let p = byProject.get(k.projectId);
        if (!p) {
          const candidates = [k.project.ownerId, k.project.managerId, ...k.project.members.map((m) => m.userId)].filter((x): x is string => !!x);
          byProject.set(k.projectId, (p = { projectId: k.projectId, name: k.project.name, companyId: k.project.mainCompanyId ?? k.project.companies[0]?.companyId ?? null, missing: [], runnerIds: [], candidates: [...new Set(candidates)] }));
        }
        if (k.values.length === 0) p.missing.push(k.name);
      }
      const due = [...byProject.values()].filter((p) => p.missing.length > 0);
      const everyone = [...new Set(due.flatMap((p) => p.candidates))];
      const people = everyone.length
        ? await prisma.user.findMany({ where: { id: { in: everyone }, deletedAt: null, status: 'ACTIVE', ...STAFF_ONLY_WHERE }, select: { id: true, roles: { select: { role: { select: { name: true } } } } } })
        : [];
      const admins = new Set(people.filter((u) => u.roles.some((r) => r.role.name === 'ADMIN')).map((u) => u.id));
      const active = new Set(people.map((u) => u.id));
      // Only people who still run AND can see the project (a shared active company), or administrators.
      const out: DueProject[] = [];
      for (const { candidates, ...p } of due) {
        const runners: string[] = [];
        for (const u of candidates) {
          if (!active.has(u)) continue;
          if (admins.has(u) || (await prisma.project.count({ where: { id: p.projectId, ...managedVisibleWhere(u) } })) > 0) runners.push(u);
        }
        out.push({ ...p, runnerIds: runners });
      }
      return out;
    },
    rules: d.rules,
    keys: {
      async existing(keys) {
        if (keys.length === 0) return new Set();
        return new Set((await prisma.reminderLog.findMany({ where: { dedupeKey: { in: keys } }, select: { dedupeKey: true } })).map((r) => r.dedupeKey));
      },
      async addMany(keys) {
        if (keys.length) await prisma.reminderLog.createMany({ data: keys.map((dedupeKey) => ({ dedupeKey })), skipDuplicates: true });
      },
    },
    notify: d.notify,
    timeZone: d.timeZone,
    ...(d.now ? { now: d.now } : {}),
  });

  return { service, job, reminder, source };
}
