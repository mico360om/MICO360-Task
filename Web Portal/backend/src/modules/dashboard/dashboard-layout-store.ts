import { Prisma, type PrismaClient } from '@prisma/client';
import type { DashboardLayout, LayoutGroup } from './dashboard-layout';

/** Where the two defaults are kept (system_settings; never shown or written by the generic settings API). */
export const DEFAULTS_KEY = 'dashboard.defaultLayouts';

/**
 * 1.23.4 — where Dashboard arrangements are kept: each person's own (null: they follow their group's
 * default) and the two defaults an administrator saves. Read back raw: dashboard-layout.ts decides what
 * applies now.
 */
export interface DashboardLayoutStore {
  getOwn(userId: string): Promise<unknown>;
  setOwn(userId: string, layout: DashboardLayout | null): Promise<void>;
  getDefaults(): Promise<Partial<Record<LayoutGroup, unknown>>>;
  setDefault(group: LayoutGroup, layout: DashboardLayout | null): Promise<void>;
}

export function createMemoryDashboardLayoutStore(): DashboardLayoutStore {
  const own = new Map<string, DashboardLayout>();
  const defaults: Partial<Record<LayoutGroup, DashboardLayout>> = {};
  const copy = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  return {
    async getOwn(userId) {
      return copy(own.get(userId) ?? null);
    },
    async setOwn(userId, layout) {
      if (layout) own.set(userId, copy(layout));
      else own.delete(userId);
    },
    async getDefaults() {
      return copy(defaults);
    },
    async setDefault(group, layout) {
      if (layout) defaults[group] = copy(layout);
      else delete defaults[group];
    },
  };
}

export function createPrismaDashboardLayoutStore(prisma: PrismaClient): DashboardLayoutStore {
  const readDefaults = async (): Promise<Partial<Record<LayoutGroup, unknown>>> => {
    const row = await prisma.systemSetting.findUnique({ where: { key: DEFAULTS_KEY } });
    const v = row?.value;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Partial<Record<LayoutGroup, unknown>>) : {};
  };
  return {
    async getOwn(userId) {
      return (await prisma.user.findUnique({ where: { id: userId }, select: { dashboardLayout: true } }))?.dashboardLayout ?? null;
    },
    async setOwn(userId, layout) {
      await prisma.user.update({ where: { id: userId }, data: { dashboardLayout: layout ? (layout as unknown as Prisma.InputJsonValue) : Prisma.DbNull }, select: { id: true } });
    },
    getDefaults: readDefaults,
    async setDefault(group, layout) {
      const next = { ...(await readDefaults()) };
      if (layout) next[group] = layout;
      else delete next[group];
      const value = next as unknown as Prisma.InputJsonValue;
      await prisma.systemSetting.upsert({ where: { key: DEFAULTS_KEY }, update: { value }, create: { key: DEFAULTS_KEY, value } });
    },
  };
}
