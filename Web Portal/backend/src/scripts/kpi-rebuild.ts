import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { defaultCompanyTimeZone } from '../modules/tasks/task-status';
import { createSettingsService } from '../modules/settings/settings-service';
import { createPrismaSettingsRepository } from '../modules/settings/prisma-settings-repository';
import { createKpiEngine } from '../modules/kpis/kpi-engine';
import { createPrismaKpiSource } from '../modules/kpis/prisma-kpi-source';
import { createPrismaSnapshotStore } from '../modules/kpis/kpi-stores';
import { createSnapshotJob, SNAPSHOT_STATE_KEY, type SnapshotState } from '../modules/kpis/kpi-snapshots';
import type { Holiday } from '../lib/working-days';

/**
 * Rebuild the KPIs' snapshots of the past six closed months from task dates and history (what the server
 * does once after the upgrade, and the rehearsal times). Safe while the server runs: each slice is rewritten.
 * Each company's working days and hours (its own, else System Settings') and its holidays are used.
 *
 *   npm run kpi:rebuild             (after `npm run build`)
 *   npx tsx src/scripts/kpi-rebuild.ts
 */
async function main(): Promise<void> {
  const timeZone = process.env.COMPANY_TIMEZONE || defaultCompanyTimeZone();
  const settings = createSettingsService({ settings: createPrismaSettingsRepository(prisma) });
  const site = await settings.workingHours();
  const rules = async (companyId: string | null) => {
    const c = companyId ? await prisma.company.findUnique({ where: { id: companyId }, select: { workingHours: true } }) : null;
    const own = c?.workingHours as { days?: number[]; start?: string; end?: string } | null | undefined;
    const hours = own && Array.isArray(own.days) && own.start && own.end ? { days: own.days, start: own.start, end: own.end } : site;
    const holidays: Holiday[] = companyId ? await prisma.companyHoliday.findMany({ where: { companyId }, select: { day: true, name: true, recurring: true } }) : [];
    return { calendar: { workingDays: hours.days, holidays }, hours: { start: hours.start, end: hours.end } };
  };
  const source = createPrismaKpiSource(prisma);
  const engine = createKpiEngine({ source, timeZone, rules });
  const job = createSnapshotJob({
    engine,
    source,
    store: createPrismaSnapshotStore(prisma),
    state: {
      async get(): Promise<SnapshotState> {
        const v = ((await prisma.systemSetting.findUnique({ where: { key: SNAPSHOT_STATE_KEY } }))?.value ?? {}) as Partial<SnapshotState>;
        return { launchDay: v.launchDay ?? null, rebuiltAt: v.rebuiltAt ?? null, lastNightlyDay: v.lastNightlyDay ?? null };
      },
      async set(s) {
        const value = JSON.parse(JSON.stringify(s));
        await prisma.systemSetting.upsert({ where: { key: SNAPSHOT_STATE_KEY }, create: { key: SNAPSHOT_STATE_KEY, value }, update: { value } });
      },
    },
    projectIds: async () => (await prisma.project.findMany({ where: { deletedAt: null }, select: { id: true }, orderBy: [{ id: 'asc' }] })).map((p) => p.id),
    weekStart: () => settings.companyWeekStart(),
    timeZone,
  });
  const r = await job.rebuild();
  const rows = await prisma.kpiSnapshot.count();
  console.log(JSON.stringify({ projects: r.projects, rows, seconds: Math.round(r.ms / 100) / 10 }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
