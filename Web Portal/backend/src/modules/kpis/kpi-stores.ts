/**
 * Project KPIs and User KPIs — what is stored: targets (site / company / project), a project's own KPIs
 * and their monthly values, and the snapshot slices. Prisma versions and in-memory ones (tests).
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { TargetRow } from './kpi-defs';

// ── Targets ──────────────────────────────────────────────────────────────────

export interface TargetStore {
  rows(scopeKeys: string[]): Promise<TargetRow[]>;
  /** Set these metrics' rows at a scope; `clear` removes rows (the level up decides again). */
  save(scopeKey: string, set: { metric: string; target: number | null; amberBand: number | null }[], clear: string[], by: string): Promise<void>;
}

export function createPrismaTargetStore(prisma: PrismaClient): TargetStore {
  return {
    async rows(scopeKeys) {
      if (scopeKeys.length === 0) return [];
      return prisma.kpiTarget.findMany({ where: { scopeKey: { in: scopeKeys } }, select: { scopeKey: true, metric: true, target: true, amberBand: true } });
    },
    async save(scopeKey, set, clear, by) {
      await prisma.$transaction(async (tx) => {
        if (clear.length) await tx.kpiTarget.deleteMany({ where: { scopeKey, metric: { in: clear } } });
        for (const s of set) {
          await tx.kpiTarget.upsert({
            where: { scopeKey_metric: { scopeKey, metric: s.metric } },
            create: { scopeKey, metric: s.metric, target: s.target, amberBand: s.amberBand, updatedById: by },
            update: { target: s.target, amberBand: s.amberBand, updatedById: by },
          });
        }
      });
    },
  };
}

export function createMemoryTargetStore(initial: TargetRow[] = []): TargetStore & { all: TargetRow[] } {
  const all = [...initial];
  return {
    all,
    async rows(keys) {
      return all.filter((r) => keys.includes(r.scopeKey));
    },
    async save(scopeKey, set, clear) {
      for (let i = all.length - 1; i >= 0; i--) if (all[i]!.scopeKey === scopeKey && (clear.includes(all[i]!.metric) || set.some((s) => s.metric === all[i]!.metric))) all.splice(i, 1);
      for (const s of set) all.push({ scopeKey, metric: s.metric, target: s.target, amberBand: s.amberBand });
    },
  };
}

// ── A project's own KPIs ─────────────────────────────────────────────────────

export type CustomDirection = 'HIGHER' | 'LOWER';

export interface CustomKpiValue {
  month: string;
  value: number;
  note: string | null;
  enteredById: string | null;
  updatedAt: Date;
}

export interface CustomKpi {
  id: string;
  projectId: string;
  name: string;
  unit: string;
  direction: CustomDirection;
  target: number | null;
  amberBand: number | null;
  position: number;
  values: CustomKpiValue[];
}

export interface CustomKpiInput {
  name: string;
  unit: string;
  direction: CustomDirection;
  target: number | null;
  amberBand: number | null;
}

export interface CustomKpiStore {
  /** These projects' KPIs with their values from `fromMonth` on (all when null), in order. */
  list(projectIds: string[], fromMonth: string | null): Promise<CustomKpi[]>;
  get(id: string): Promise<CustomKpi | null>;
  create(projectId: string, input: CustomKpiInput, by: string): Promise<CustomKpi>;
  update(id: string, input: Partial<CustomKpiInput>): Promise<void>;
  remove(id: string): Promise<void>;
  setValue(id: string, month: string, value: number, note: string | null, by: string): Promise<void>;
  clearValue(id: string, month: string): Promise<void>;
  count(projectId: string): Promise<number>;
  /** Live projects with own KPIs (the monthly reminder). */
  projectsWithKpis(): Promise<string[]>;
}

const customSelect = {
  id: true,
  projectId: true,
  name: true,
  unit: true,
  direction: true,
  target: true,
  amberBand: true,
  position: true,
} as const satisfies Prisma.ProjectKpiSelect;

export function createPrismaCustomKpiStore(prisma: PrismaClient): CustomKpiStore {
  const shape = (k: Prisma.ProjectKpiGetPayload<{ select: typeof customSelect & { values: { select: { month: true; value: true; note: true; enteredById: true; updatedAt: true } } } }>): CustomKpi => ({
    ...k,
    direction: k.direction === 'LOWER' ? 'LOWER' : 'HIGHER',
    values: k.values,
  });
  const valuesSelect = (fromMonth: string | null) => ({
    where: fromMonth ? { month: { gte: fromMonth } } : {},
    select: { month: true, value: true, note: true, enteredById: true, updatedAt: true },
    orderBy: [{ month: 'asc' as const }],
  });
  return {
    async list(projectIds, fromMonth) {
      if (projectIds.length === 0) return [];
      const rows = await prisma.projectKpi.findMany({
        where: { projectId: { in: projectIds } },
        select: { ...customSelect, values: valuesSelect(fromMonth) },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map(shape);
    },
    async get(id) {
      const k = await prisma.projectKpi.findUnique({ where: { id }, select: { ...customSelect, values: valuesSelect(null) } });
      return k ? shape(k) : null;
    },
    async create(projectId, input, by) {
      const last = await prisma.projectKpi.aggregate({ where: { projectId }, _max: { position: true } });
      const k = await prisma.projectKpi.create({
        data: { projectId, ...input, position: (last._max.position ?? -1) + 1, createdById: by },
        select: { ...customSelect, values: valuesSelect(null) },
      });
      return shape(k);
    },
    async update(id, input) {
      await prisma.projectKpi.update({ where: { id }, data: input });
    },
    async remove(id) {
      await prisma.projectKpi.deleteMany({ where: { id } });
    },
    async setValue(id, month, value, note, by) {
      await prisma.projectKpiValue.upsert({
        where: { kpiId_month: { kpiId: id, month } },
        create: { kpiId: id, month, value, note, enteredById: by },
        update: { value, note, enteredById: by },
      });
    },
    async clearValue(id, month) {
      await prisma.projectKpiValue.deleteMany({ where: { kpiId: id, month } });
    },
    count(projectId) {
      return prisma.projectKpi.count({ where: { projectId } });
    },
    async projectsWithKpis() {
      const rows = await prisma.projectKpi.groupBy({ by: ['projectId'], where: { project: { deletedAt: null } } });
      return rows.map((r) => r.projectId);
    },
  };
}

export function createMemoryCustomKpiStore(): CustomKpiStore & { all: CustomKpi[] } {
  const all: CustomKpi[] = [];
  let n = 0;
  const copy = (k: CustomKpi, fromMonth: string | null): CustomKpi => ({ ...k, values: k.values.filter((v) => !fromMonth || v.month >= fromMonth).sort((a, b) => a.month.localeCompare(b.month)) });
  return {
    all,
    async list(projectIds, fromMonth) {
      return all.filter((k) => projectIds.includes(k.projectId)).sort((a, b) => a.position - b.position).map((k) => copy(k, fromMonth));
    },
    async get(id) {
      const k = all.find((x) => x.id === id);
      return k ? copy(k, null) : null;
    },
    async create(projectId, input) {
      n += 1;
      const k: CustomKpi = { id: `k${n}`, projectId, ...input, position: all.filter((x) => x.projectId === projectId).length, values: [] };
      all.push(k);
      return copy(k, null);
    },
    async update(id, input) {
      const k = all.find((x) => x.id === id);
      if (k) Object.assign(k, input);
    },
    async remove(id) {
      const i = all.findIndex((x) => x.id === id);
      if (i >= 0) all.splice(i, 1);
    },
    async setValue(id, month, value, note, by) {
      const k = all.find((x) => x.id === id);
      if (!k) return;
      k.values = [...k.values.filter((v) => v.month !== month), { month, value, note, enteredById: by, updatedAt: new Date() }];
    },
    async clearValue(id, month) {
      const k = all.find((x) => x.id === id);
      if (k) k.values = k.values.filter((v) => v.month !== month);
    },
    async count(projectId) {
      return all.filter((k) => k.projectId === projectId).length;
    },
    async projectsWithKpis() {
      return [...new Set(all.map((k) => k.projectId))];
    },
  };
}

// ── Snapshots ────────────────────────────────────────────────────────────────

export interface SnapshotRow {
  projectId: string;
  /** '' for the project's own row. */
  userId: string;
  day: string;
  endDay: string;
  weekStart: string;
  month: string;
  metrics: Record<string, unknown>;
  rebuilt: boolean;
}

export interface SnapshotStore {
  /** Project rows ('' user) or people's rows, of these projects, in these months (or weeks). */
  read(q: { projectIds: string[] | null; userId: string; months?: string[]; weekStarts?: string[] }): Promise<SnapshotRow[]>;
  /** Replace these projects' rows of these whole months (review I5: whatever weeks they were cut into before). */
  replace(projectIds: string[], months: string[], rows: SnapshotRow[]): Promise<void>;
  count(): Promise<number>;
}

const SNAP_CHUNK = 500;

export function createPrismaSnapshotStore(prisma: PrismaClient): SnapshotStore {
  return {
    async read(q) {
      if (q.projectIds && q.projectIds.length === 0) return [];
      const where: Prisma.KpiSnapshotWhereInput = {
        userId: q.userId,
        ...(q.projectIds ? { projectId: { in: q.projectIds } } : {}),
        ...(q.months ? { month: { in: q.months } } : {}),
        ...(q.weekStarts ? { weekStart: { in: q.weekStarts } } : {}),
      };
      const rows = await prisma.kpiSnapshot.findMany({ where, select: { projectId: true, userId: true, day: true, endDay: true, weekStart: true, month: true, metrics: true, rebuilt: true } });
      return rows.map((r) => ({ ...r, metrics: (r.metrics ?? {}) as Record<string, unknown> }));
    },
    async replace(projectIds, months, rows) {
      if (projectIds.length === 0 || months.length === 0) return;
      await prisma.$transaction(async (tx) => {
        await tx.kpiSnapshot.deleteMany({ where: { projectId: { in: projectIds }, month: { in: months } } });
        for (let i = 0; i < rows.length; i += SNAP_CHUNK) {
          await tx.kpiSnapshot.createMany({
            data: rows.slice(i, i + SNAP_CHUNK).map((r) => ({ ...r, metrics: r.metrics as Prisma.InputJsonValue })),
          });
        }
      }, { timeout: 60_000 });
    },
    count() {
      return prisma.kpiSnapshot.count();
    },
  };
}

export function createMemorySnapshotStore(): SnapshotStore & { all: SnapshotRow[] } {
  const all: SnapshotRow[] = [];
  return {
    all,
    async read(q) {
      return all.filter(
        (r) => r.userId === q.userId && (!q.projectIds || q.projectIds.includes(r.projectId)) && (!q.months || q.months.includes(r.month)) && (!q.weekStarts || q.weekStarts.includes(r.weekStart)),
      );
    },
    async replace(projectIds, months, rows) {
      for (let i = all.length - 1; i >= 0; i--) if (projectIds.includes(all[i]!.projectId) && months.includes(all[i]!.month)) all.splice(i, 1);
      all.push(...rows);
    },
    async count() {
      return all.length;
    },
  };
}
