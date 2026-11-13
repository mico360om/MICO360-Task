import { Prisma, type PrismaClient } from '@prisma/client';
import { zonedDay } from '../../lib/working-days';
import { OMAN_STARTER_HOLIDAYS } from './oman-holidays';

/**
 * Owner decision (13 Nov 2026): Accession Day (11 January) is one of Oman's public holidays. A company set up
 * from now on gets it with the starter list (oman-holidays.ts); this step adds it ONCE to a site whose
 * companies were set up before: each company whose starter holidays were already added gets the coming
 * Accession Days of the starter list (from today on — a day already past is left as it was, so no past
 * figure changes). A company not set up yet is left to its set-up (which now includes it).
 *
 * Never twice, and never against an administrator's choice:
 * - done once: `holidays.accessionDay` = { at, added } in system settings is written with the additions, and
 *   a later start-up does nothing — so a day an administrator deletes afterwards stays deleted;
 * - a year that already has a day off on 11 January (any name, also an "every year" one) is skipped;
 * - a day off on that 11 January an administrator deleted before (the panel's audit line) is not put back;
 * - each add is an INSERT IGNORE on the (company, day, name) unique index.
 * Plain statements only (no transaction, no isolation statement): MySQL 8 and MariaDB alike. Start-up runs it
 * under the job lock, so one server does it; two at once still add each day once (the unique index).
 */
export const ACCESSION_DAY_KEY = 'holidays.accessionDay';
export const ACCESSION_DAY_NAME = 'Accession Day';

export interface AccessionDayRun {
  /** The step had already run: nothing was looked at. */
  already: boolean;
  /** Days off added (one per company and year). */
  added: number;
  /** Company-years left alone (their own 11 January day off, or one an administrator deleted). */
  skipped: number;
}

export interface AccessionDayDeps {
  prisma: PrismaClient;
  /** The site's time zone (which day "today" is). */
  timeZone: string;
  now?: () => Date;
  logger?: { info(msg: string, meta?: Record<string, unknown>): void };
  /** After days were added (the scheduling rules read holidays from memory for up to a minute). */
  onAdded?: () => void;
}

const isUniqueClash = (err: unknown) => (err as { code?: string })?.code === 'P2002';

export function createAccessionDayStep(deps: AccessionDayDeps): { run(): Promise<AccessionDayRun> } {
  const { prisma } = deps;
  const now = deps.now ?? (() => new Date());

  /** Does this company already have a day off on that 11 January — that day itself, or an every-year one from before? */
  async function hasDayOff(companyId: string, day: string): Promise<boolean> {
    const year = Number(day.slice(0, 4));
    const rows = await prisma.companyHoliday.findMany({
      where: { companyId, OR: [{ day }, { recurring: true, day: { endsWith: day.slice(4) } }] },
      select: { day: true, recurring: true },
    });
    return rows.some((r) => r.day === day || (r.recurring && Number(r.day.slice(0, 4)) <= year));
  }

  /** Did an administrator delete a day off on that 11 January? (The holidays panel writes an audit line.) */
  async function deletedBefore(companyId: string, day: string): Promise<boolean> {
    const lines = await prisma.auditLog.findMany({ where: { action: 'notify.holiday.remove', entityId: companyId }, select: { oldValue: true } });
    return lines.some((l) => (l.oldValue as { day?: unknown } | null)?.day === day);
  }

  return {
    async run() {
      if (await prisma.systemSetting.findUnique({ where: { key: ACCESSION_DAY_KEY }, select: { key: true } })) return { already: true, added: 0, skipped: 0 };
      const today = zonedDay(now(), deps.timeZone);
      const days = OMAN_STARTER_HOLIDAYS.filter((h) => h.name === ACCESSION_DAY_NAME && h.day >= today);
      const seeded = await prisma.notificationPolicy.findMany({ where: { holidaysSeededAt: { not: null } }, select: { companyId: true }, orderBy: { companyId: 'asc' } });
      let added = 0;
      let skipped = 0;
      for (const { companyId } of seeded) {
        for (const h of days) {
          if ((await hasDayOff(companyId, h.day)) || (await deletedBefore(companyId, h.day))) {
            skipped += 1;
            continue;
          }
          const res = await prisma.companyHoliday.createMany({
            data: [{ companyId, day: h.day, name: ACCESSION_DAY_NAME, recurring: false, source: 'STARTER', expected: h.expected }],
            skipDuplicates: true,
          });
          added += res.count;
        }
      }
      try {
        await prisma.systemSetting.create({ data: { key: ACCESSION_DAY_KEY, value: { at: now().toISOString(), added } as Prisma.InputJsonValue } });
      } catch (err) {
        // Another server finished it at the same moment: theirs is the record.
        if (!isUniqueClash(err)) throw err;
      }
      if (added) {
        deps.onAdded?.();
        deps.logger?.info('Accession Day (11 January) added to the companies’ holidays', { added, skipped });
      }
      return { already: false, added, skipped };
    },
  };
}
