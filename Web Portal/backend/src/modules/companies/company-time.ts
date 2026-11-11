import type { PrismaClient } from '@prisma/client';
import type { Holiday } from '../../lib/working-days';
import type { WorkingHours } from '../settings/settings-service';
import type { CompanyBrand, CompanyBranding } from './company-branding';
import type { Viewer } from './company-access';

/**
 * Companies (MC1 Task 15): each company's week start and working days and hours. Every company is in
 * the site's time zone (owner, 31 Oct: all in Oman), so nothing here judges days in another zone; a
 * company that hasn't set its own week start or hours inherits System Settings'.
 *
 *   - Something that belongs to a project: its main company's.
 *   - A meeting without a project: its company's.
 *   - A list across projects (Workload, Management): the picked company's, else the reader's
 *     primary company's, else the site's.
 *   - A person's own week (the weekly summary's day): their primary company's.
 */
export type WeekStart = 0 | 1 | 6;

/** The week a calendar runs: the day it starts and its working days (0 Sunday … 6 Saturday). */
export interface CompanyCalendar {
  weekStart: WeekStart;
  workingDays: number[];
  /** Notification & Scheduling centre: the company's holidays (the weekly summary skips them). */
  holidays?: Holiday[];
}

/** What working hours are asked for; the first of these that is given decides. */
export interface HoursTarget {
  projectId?: string | null;
  companyId?: string | null;
  meetingId?: string | null;
  viewer?: Viewer | null;
  pick?: string | null;
}

export interface CompanyTime {
  hoursFor(target: HoursTarget): Promise<WorkingHours>;
  weekStartOfScope(viewer: Viewer, pick: string | null): Promise<WeekStart>;
  /** A person's own week: their primary company's (else the site's). */
  calendarOf(userId: string): Promise<CompanyCalendar>;
  /** Every distinct calendar in use: the site's, then each active company's. */
  calendars(): Promise<CompanyCalendar[]>;
}

/**
 * What an asker may use to choose working hours (meeting free times): a project they can see, one of
 * their own active companies (any company for admins), a meeting they can open. Anything else is
 * dropped, so the hours fall back to their own company's — a guess at an id never reveals another
 * company's hours.
 */
export async function usableHoursTarget(
  t: { projectId: string | null; companyId: string | null; meetingId: string | null; viewer: Viewer },
  can: { seeProject(viewer: Viewer, projectId: string): Promise<boolean>; companyIds(userId: string): Promise<string[]>; openMeeting(viewer: Viewer, meetingId: string): Promise<boolean> },
): Promise<HoursTarget> {
  const admin = t.viewer.roles.includes('ADMIN');
  const [project, company, meeting] = await Promise.all([
    t.projectId ? can.seeProject(t.viewer, t.projectId) : false,
    t.companyId ? (admin ? true : can.companyIds(t.viewer.id).then((ids) => ids.includes(t.companyId!))) : false,
    t.meetingId ? can.openMeeting(t.viewer, t.meetingId) : false,
  ]);
  return { projectId: project ? t.projectId : null, companyId: company ? t.companyId : null, meetingId: meeting ? t.meetingId : null, viewer: t.viewer };
}

const calendarOfBrand = (b: CompanyBrand): CompanyCalendar => ({ weekStart: b.weekStart, workingDays: [...b.workingHours.days] });

export function createCompanyTime(branding: CompanyBranding, prisma?: Pick<PrismaClient, 'company'>): CompanyTime {
  async function brandFor(t: HoursTarget): Promise<CompanyBrand> {
    if (t.projectId) return branding.forProject(t.projectId);
    if (t.companyId) return branding.forCompany(t.companyId);
    if (t.meetingId) return branding.forMeeting(t.meetingId);
    if (t.viewer) return branding.forScope(t.viewer, t.pick ?? null);
    return branding.siteBrand();
  }

  return {
    hoursFor: async (t) => (await brandFor(t)).workingHours,
    weekStartOfScope: async (viewer, pick) => (await branding.forScope(viewer, pick)).weekStart,
    calendarOf: async (userId) => calendarOfBrand(await branding.forPerson(userId)),
    async calendars() {
      const ids = prisma ? (await prisma.company.findMany({ where: { status: 'ACTIVE' }, select: { id: true }, orderBy: { id: 'asc' } })).map((c) => c.id) : [];
      const all = [calendarOfBrand(await branding.siteBrand()), ...(await Promise.all(ids.map(async (id) => calendarOfBrand(await branding.forCompany(id)))))];
      const seen = new Set<string>();
      return all.filter((c) => {
        const key = `${c.weekStart}|${c.workingDays.join(',')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  };
}
