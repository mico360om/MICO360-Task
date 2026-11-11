import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { Viewer } from '../companies/company-access';
import { NO_PICK, type PickOf } from '../companies/company-pick';
import { ValidationError } from '../../lib/http-errors';
import type { NotifyPolicyService } from './policy-service';
import { POLICY_SECTIONS } from './policy-service';

/**
 * Notification & Scheduling centre routes.
 *
 *   admin   GET/PUT  /notification-settings…            the panel (per company): working time, holidays,
 *                                                        schedules, the policy, "Preview for a person"
 *   own     GET      /notifications/policy               the person's company rules (Settings → Notifications)
 *   list    GET      /working-time                       working days, hours and days off (task form, Timeline)
 *   object  GET/PUT  /projects/:id/reminders             a project's schedule and escalation numbers
 *   object  GET/PUT  /tasks/:id/reminder-schedule        a task's own schedule
 */

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.');
const workingTimeSchema = z.object({
  weekStart: z.union([z.literal(0), z.literal(1), z.literal(6)]),
  workingHours: z.object({ days: z.array(z.number().int().min(0).max(6)).min(1).max(7), start: HHMM, end: HHMM }),
});
const policySchema = z.object(Object.fromEntries(POLICY_SECTIONS.map((s) => [s, z.unknown().optional()])) as Record<(typeof POLICY_SECTIONS)[number], z.ZodOptional<z.ZodUnknown>>);
const holidaySchema = z.object({ day: z.string().max(10).optional(), name: z.string().max(200).optional(), recurring: z.boolean().optional(), expected: z.boolean().optional() });
const scheduleSchema = z.object({ name: z.string().max(200).optional(), steps: z.unknown().optional() });
const starterSchema = z.object({ year: z.number().int().min(2000).max(2100) });
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const workingTimeQuery = z.object({ projectId: z.string().max(64).optional(), companyId: z.string().max(64).optional(), from: DAY.optional(), to: DAY.optional() });
const previewQuery = z.object({ userId: z.string().min(1).max(64) });
const projectRemindersSchema = z.object({
  scheduleId: z.string().max(64).nullable().optional(),
  escalationDays: z.object({ step1Days: z.number().int().min(1).max(60), step2Days: z.number().int().min(1).max(60) }).nullable().optional(),
});
const taskScheduleSchema = z.object({ scheduleId: z.string().max(64).nullable() });

export interface WorkingTimeView {
  weekStart: 0 | 1 | 6;
  workingHours: { days: number[]; start: string; end: string };
  /** The company has its own (else it follows the site's System Settings values). */
  own: boolean;
}

export interface NotifyPolicyRouteDeps {
  guard: AuthGuard;
  service: NotifyPolicyService;
  pickOf?: PickOf;
  timeZone: string;
  /** Active companies, A–Z (the panel's picker). */
  companies(): Promise<{ id: string; name: string }[]>;
  workingTimeOf(companyId: string): Promise<WorkingTimeView>;
  saveWorkingTime(companyId: string, value: z.infer<typeof workingTimeSchema>, actor: Viewer, ip: string | null): Promise<WorkingTimeView>;
  resetWorkingTime(companyId: string, actor: Viewer, ip: string | null): Promise<WorkingTimeView>;
  /** Active staff of the company (admins everywhere) — the preview's people and step 2's chosen people. */
  people(companyId: string): Promise<{ id: string; name: string; email: string | null; admin: boolean }[]>;
  /** The site-wide meeting reminder times (the Channels tab shows them). */
  meetingReminders(): Promise<unknown>;
  preview(companyId: string, userId: string): Promise<unknown>;
  personPolicy(userId: string): Promise<unknown>;
  /** Working days, hours and days off for a project the viewer can see, one of their companies, or their own. */
  workingTime(viewer: Viewer, target: { projectId: string | null; companyId: string | null; pick: string | null }, range: { from: string; to: string }): Promise<unknown>;
  projectReminders: {
    get(viewer: Viewer, projectId: string): Promise<unknown>;
    set(viewer: Viewer, projectId: string, body: z.infer<typeof projectRemindersSchema>, ip: string | null): Promise<unknown>;
  };
  taskSchedule: {
    get(viewer: Viewer, taskId: string): Promise<unknown>;
    set(viewer: Viewer, taskId: string, scheduleId: string | null, ip: string | null): Promise<unknown>;
  };
}

const MAX_RANGE_DAYS = 1200;

export async function registerNotifyPolicyRoutes(app: FastifyInstance, deps: NotifyPolicyRouteDeps): Promise<void> {
  const { guard, service } = deps;
  const admin = { preHandler: guard.requireRoles('ADMIN') };
  const signedIn = { preHandler: guard.authenticate };
  const viewerOf = (req: FastifyRequest): Viewer => ({ id: req.user!.id, roles: req.user!.roles ?? [] });
  const actorId = (req: FastifyRequest) => req.user?.id ?? null;
  const companyOf = (req: FastifyRequest) => (req.params as { companyId: string }).companyId;

  // ── The admin panel ──────────────────────────────────────────────────────
  app.get('/notification-settings', admin, async () => ({ data: { companies: await deps.companies(), timeZone: deps.timeZone } }));

  app.get('/notification-settings/:companyId', admin, async (req) => {
    const companyId = companyOf(req);
    const [policy, holidays, schedules, banners, workingTime, people, meetingReminders] = await Promise.all([
      service.policyOf(companyId),
      service.holidays(companyId),
      service.schedules(companyId),
      service.banners(companyId),
      deps.workingTimeOf(companyId),
      deps.people(companyId),
      deps.meetingReminders(),
    ]);
    return { data: { companyId, timeZone: deps.timeZone, policy, defaults: service.defaults(), holidays, schedules, banners, workingTime, people, meetingReminders } };
  });

  app.put('/notification-settings/:companyId/working-time', admin, async (req) => {
    const value = workingTimeSchema.parse(req.body);
    if (value.workingHours.end <= value.workingHours.start) throw new ValidationError('The day has to end after it starts.');
    const saved = await deps.saveWorkingTime(companyOf(req), value, viewerOf(req), req.ip ?? null);
    service.clearCache();
    return { data: saved };
  });

  app.delete('/notification-settings/:companyId/working-time', admin, async (req) => {
    const saved = await deps.resetWorkingTime(companyOf(req), viewerOf(req), req.ip ?? null);
    service.clearCache();
    return { data: saved };
  });

  app.put('/notification-settings/:companyId/policy', admin, async (req) => {
    const patch = policySchema.parse(req.body ?? {});
    return { data: await service.savePolicy(companyOf(req), patch, actorId(req)) };
  });

  app.post('/notification-settings/:companyId/holidays', admin, async (req) => {
    const body = holidaySchema.parse(req.body ?? {});
    return { data: await service.addHoliday(companyOf(req), body, actorId(req)) };
  });

  app.post('/notification-settings/:companyId/holidays/starter', admin, async (req) => {
    const { year } = starterSchema.parse(req.body ?? {});
    return { data: { added: await service.addStarterYear(companyOf(req), year, actorId(req)) } };
  });

  app.put('/notification-settings/:companyId/holidays/:holidayId', admin, async (req) => {
    const { holidayId } = req.params as { holidayId: string };
    return { data: await service.updateHoliday(companyOf(req), holidayId, holidaySchema.parse(req.body ?? {}), actorId(req)) };
  });

  app.delete('/notification-settings/:companyId/holidays/:holidayId', admin, async (req) => {
    const { holidayId } = req.params as { holidayId: string };
    await service.removeHoliday(companyOf(req), holidayId, actorId(req));
    return { data: { ok: true } };
  });

  app.post('/notification-settings/:companyId/schedules', admin, async (req) => {
    return { data: await service.createSchedule(companyOf(req), scheduleSchema.parse(req.body ?? {}), actorId(req)) };
  });

  app.put('/notification-settings/:companyId/schedules/:scheduleId', admin, async (req) => {
    const { scheduleId } = req.params as { scheduleId: string };
    return { data: await service.updateSchedule(companyOf(req), scheduleId, scheduleSchema.parse(req.body ?? {}), actorId(req)) };
  });

  app.delete('/notification-settings/:companyId/schedules/:scheduleId', admin, async (req) => {
    const { scheduleId } = req.params as { scheduleId: string };
    await service.removeSchedule(companyOf(req), scheduleId, actorId(req));
    return { data: { ok: true } };
  });

  app.post('/notification-settings/:companyId/schedules/:scheduleId/default', admin, async (req) => {
    const { scheduleId } = req.params as { scheduleId: string };
    return { data: await service.setDefaultSchedule(companyOf(req), scheduleId, actorId(req)) };
  });

  app.get('/notification-settings/:companyId/preview', admin, async (req) => {
    const { userId } = previewQuery.parse(req.query ?? {});
    return { data: await deps.preview(companyOf(req), userId) };
  });

  // ── The person's own rules (Settings → Notifications) ─────────────────────
  app.get('/notifications/policy', signedIn, async (req) => ({ data: await deps.personPolicy(req.user!.id) }));

  // ── Working days, hours and days off (task form warning, Timeline shading) ──
  app.get('/working-time', signedIn, async (req) => {
    const q = workingTimeQuery.parse(req.query ?? {});
    const today = new Date().toISOString().slice(0, 10);
    const from = q.from ?? `${today.slice(0, 4)}-01-01`;
    const to = q.to ?? `${Number(today.slice(0, 4)) + 1}-12-31`;
    if (to < from || (Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_RANGE_DAYS) throw new ValidationError(`Ask for at most ${MAX_RANGE_DAYS} days.`);
    const pick = await (deps.pickOf ?? NO_PICK)(req);
    return { data: await deps.workingTime(viewerOf(req), { projectId: q.projectId ?? null, companyId: q.companyId ?? null, pick }, { from, to }) };
  });

  // ── A project's reminders, a task's schedule ──────────────────────────────
  app.get('/projects/:id/reminders', signedIn, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await deps.projectReminders.get(viewerOf(req), id) };
  });

  app.put('/projects/:id/reminders', signedIn, async (req) => {
    const { id } = req.params as { id: string };
    const body = projectRemindersSchema.parse(req.body ?? {});
    return { data: await deps.projectReminders.set(viewerOf(req), id, body, req.ip ?? null) };
  });

  app.get('/tasks/:id/reminder-schedule', signedIn, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await deps.taskSchedule.get(viewerOf(req), id) };
  });

  app.put('/tasks/:id/reminder-schedule', signedIn, async (req) => {
    const { id } = req.params as { id: string };
    const { scheduleId } = taskScheduleSchema.parse(req.body ?? {});
    return { data: await deps.taskSchedule.set(viewerOf(req), id, scheduleId, req.ip ?? null) };
  });
}
