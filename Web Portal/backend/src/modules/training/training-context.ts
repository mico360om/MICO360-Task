import type { PrismaClient } from '@prisma/client';
import { todayKey, zonedDayKey } from '../../lib/due-date';
import { HttpError, NotFoundError } from '../../lib/http-errors';
import type { WorkCalendar } from '../../lib/working-days';
import { isManager, type CourseFacts } from './training-access';
import { loadPeople, loadPerson, stringList, type PersonRecord } from './prisma-training-store';
import type { TrainingFileStore } from './training-files';
import type { Rng } from './training-quiz';

/** What the Training Center services share: the database, the private files, the clock, notices. */
export interface TrainingDeps {
  prisma: PrismaClient;
  files: TrainingFileStore;
  /** The site's time zone (today, due days). */
  timeZone: string;
  /** The website's address (APP_URL): certificates' verification links. */
  appUrl: string;
  now?: () => Date;
  rng?: Rng;
  /** A notice through the notification service (Notification & Scheduling delivery); clients get none. */
  notify(n: { userId: string; type: string; title: string; body: string | null; entityType: string | null; entityId: string | null; projectId: null }): Promise<unknown>;
  /** A company's working days and escalation numbers (notifyPolicy.rules); null: the site's. */
  rules(companyId: string | null): Promise<{ calendar: WorkCalendar; step1Days: number; step2Days: number }>;
  /** Pictures stored smaller (the sharp shrinker, ≤ 1920 px); absent: as uploaded. */
  shrinkImage?(content: Buffer, mimeType: string): Promise<Buffer>;
  /** A picture made printable for a PDF (WebP → PNG); absent or null: left out. */
  printable?(raw: Buffer): Promise<Buffer | null>;
  /** The learner's company (primary → oldest active → none): the certificate's logo and name. */
  companyOfPerson?(userId: string): Promise<string | null>;
  /** A company's PDF brand (its name and logo; null company: the site's). */
  pdfBrand?(companyId: string | null): Promise<{ companyName: string | null; logo: Buffer | null }>;
  audit?(e: { userId: string; ip: string | null; action: string; entityId: string | null; oldValue?: unknown; newValue?: unknown }): Promise<void>;
  logger?: { info(msg: string, meta?: Record<string, unknown>): void; warn(msg: string, meta?: Record<string, unknown>): void; error?(msg: string, meta?: Record<string, unknown>): void };
}

export interface TrainingContext extends TrainingDeps {
  clock(): Date;
  today(): string;
  /** The site's day of an instant. */
  dayOf(at: Date): string;
  person(id: string): Promise<PersonRecord | null>;
  people(ids?: readonly string[]): Promise<Map<string, PersonRecord>>;
}

export function trainingContext(d: TrainingDeps): TrainingContext {
  const clock = d.now ?? (() => new Date());
  return {
    ...d,
    clock,
    today: () => todayKey(d.timeZone, clock()),
    dayOf: (at) => zonedDayKey(at, d.timeZone),
    person: (id) => loadPerson(d.prisma, id),
    people: (ids) => loadPeople(d.prisma, ids),
  };
}

export const notFound = (what = 'Course') => new NotFoundError(`${what} not found.`);
export const conflict = (message: string, code = 'TRAINING_CONFLICT') => new HttpError(message, code, 409);
export const forbidden = (message = 'Only Training managers and administrators can do this.') => new HttpError(message, 'FORBIDDEN', 403);

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** A path id we look up (anything else: not found). */
export function idOf(raw: unknown, what = 'Course'): string {
  if (typeof raw !== 'string' || !ID.test(raw)) throw notFound(what);
  return raw;
}

/** The course row's access facts. */
export const courseFacts = (c: { audience: string; moduleKey: string; roleKeys: unknown; companyIds: unknown; status: string }): CourseFacts => ({
  audience: c.audience,
  moduleKey: c.moduleKey,
  roleKeys: stringList(c.roleKeys),
  companyIds: stringList(c.companyIds),
  status: c.status,
});

/** A signed-in staff member who may use the Training Center (Training manager or administrator), else 403. */
export async function managerOf(ctx: TrainingContext, userId: string): Promise<PersonRecord> {
  const p = await ctx.person(userId);
  if (!p || !p.active || !isManager(p)) throw forbidden();
  return p;
}

/** R5: a manager's company scope — null for administrators (everyone), else their companies. */
export const scopeOf = (p: PersonRecord): string[] | null => (p.admin ? null : [...p.companyIds]);

/** The Training managers (active staff, not administrators-only) sharing one of these companies; else the administrators. */
export function trainingManagersFor(people: ReadonlyMap<string, PersonRecord>, companyIds: readonly string[]): { tms: string[]; admins: string[] } {
  const all = [...people.values()].filter((p) => p.active && !p.client);
  return {
    tms: all.filter((p) => p.trainingManager && p.companyIds.some((c) => companyIds.includes(c))).map((p) => p.id),
    admins: all.filter((p) => p.admin).map((p) => p.id),
  };
}
