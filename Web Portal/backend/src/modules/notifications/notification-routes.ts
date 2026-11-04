import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { MAX_BULK_NOTIFICATIONS, type NotificationService } from './notification-service';
import { KIND_KEYS } from './notification-kinds';
import type { ListScope } from './notification-repository';
import { NO_PICK, type PickOf } from '../companies/company-pick';
import type { AuthGuard } from '../auth/auth-guard';
import { dailyEmailOn, dailyEmailPrefs, normalizePreferences, weeklySummaryOn, DAILY_EMAIL_TIME, MAX_REMINDER_LEAD_MINUTES, type DailyEmailPrefs, type NotificationPreferences } from './notification-preferences';

const prefsSchema = z.object({
  muted: z.array(z.string()).optional(),
  reminderLeadMinutes: z.number().int().min(0).max(MAX_REMINDER_LEAD_MINUTES).optional(),
  dailyEmails: z
    .object({
      pending: z.boolean().optional(),
      completed: z.boolean().optional(),
      time: z.string().regex(DAILY_EMAIL_TIME, 'Choose a time as HH:MM.').optional(),
      // 1.22: the one daily email's other parts.
      schedule: z.boolean().optional(),
      urgent: z.boolean().optional(),
      managed: z.boolean().optional(),
    })
    .optional(),
  weeklySummary: z.boolean().optional(),
});

const kindsSchema = z.array(z.enum(KIND_KEYS)).max(KIND_KEYS.length * 2);
const readAllSchema = z.object({ upTo: z.string().datetime({ offset: true }).optional(), kinds: kindsSchema.optional() });

/** 1.22: a page of the list — `kinds=mentions,due` (the chips), `unread=1` (the Unread tab), `limit` (≤100, default 100), `cursor`. */
const pageSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  unread: z.enum(['1', '0', 'true', 'false']).transform((v) => v === '1' || v === 'true').optional(),
  kinds: z
    .string()
    .max(200)
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
    .pipe(kindsSchema)
    .optional(),
});
const bulkSchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(MAX_BULK_NOTIFICATIONS), action: z.enum(['read', 'unread', 'remove']) });

/**
 * 1.22: a daily email save from an app that knows only the two old switches (pending tasks, completed
 * yesterday) keeps their meaning: "Overdue & urgent" follows "Pending tasks", and both off is no email.
 * 1.22 review: turned back on from no email at all, "Today's schedule" and "In your projects" come
 * back too (as an old app's settings read: on whenever either old email is) — not just the task list.
 */
function dailyEmailsSaved(current: DailyEmailPrefs, sent: z.infer<typeof prefsSchema>['dailyEmails'] & object): DailyEmailPrefs {
  const next = { ...current, ...sent };
  const older = sent.schedule === undefined && sent.urgent === undefined && sent.managed === undefined;
  // Only a switch the save changes means something (older apps send both, as they are, with the time).
  const pendingChanged = sent.pending !== undefined && sent.pending !== current.pending;
  const completedChanged = sent.completed !== undefined && sent.completed !== current.completed;
  if (!older || (!pendingChanged && !completedChanged)) return next;
  const off = !next.pending && !next.completed;
  const backOn = !off && !dailyEmailOn(current);
  return {
    ...next,
    ...(pendingChanged ? { urgent: next.pending } : {}),
    ...(backOn ? { schedule: true, managed: true } : {}),
    ...(off ? { schedule: false, urgent: false, managed: false } : {}),
  };
}

/** Preferences as the apps read them: the daily email settings and the weekly summary switch always filled in. */
const withDailyEmails = (p: NotificationPreferences): NotificationPreferences => ({ ...p, dailyEmails: dailyEmailPrefs(p), weeklySummary: weeklySummaryOn(p) });

export interface NotificationRouteDeps {
  notificationService: NotificationService;
  guard: AuthGuard;
  /** companies: the person's project ids, in a picked company (null = every project: an administrator without a pick). */
  accessibleProjectIds?: (userId: string, roles: string[], pick?: string | null) => Promise<string[] | null>;
  /** companies: the request's picked company (X-Company-Id). Absent: no pick. */
  pickOf?: PickOf;
}

export async function registerNotificationRoutes(app: FastifyInstance, deps: NotificationRouteDeps): Promise<void> {
  const { notificationService, guard } = deps;
  /**
   * companies: the bell shows notices about no project, and about the projects the person sees now
   * (in the picked company) — never one about a project they can no longer see. Unscoped without the module.
   */
  async function scopeOf(req: FastifyRequest): Promise<ListScope | undefined> {
    if (!deps.accessibleProjectIds) return undefined;
    const pick = await (deps.pickOf ?? NO_PICK)(req);
    return { projectIds: await deps.accessibleProjectIds(req.user!.id, req.user!.roles ?? [], pick), pick };
  }

  // 1.22: pages of the list. Without a query (the bell, the phone app, the extension): the newest 100,
  // as before; `nextCursor` (null at the end) and each row's `project` are new fields beside them.
  app.get('/notifications', { preHandler: guard.authenticate }, async (req) => {
    const q = pageSchema.parse(req.query ?? {});
    return notificationService.listPage(req.user!.id, await scopeOf(req), q);
  });

  // 1.22: unread ones per type chip, and in all, for the Notifications page.
  app.get('/notifications/counts', { preHandler: guard.authenticate }, async (req) => {
    return { data: await notificationService.counts(req.user!.id, await scopeOf(req)) };
  });

  // Per-user notification preferences (muted types, reminder lead time, daily task emails).
  app.get('/notifications/preferences', { preHandler: guard.authenticate }, async (req) => {
    return { data: withDailyEmails(await notificationService.getPreferences(req.user!.id)) };
  });

  // The muted types and the reminder time are saved together, as the apps always have (the time left
  // out means the default). The daily email settings and the weekly summary switch are kept unless
  // they are sent, so an app that doesn't know them (an older phone app) never wipes them.
  app.put('/notifications/preferences', { preHandler: guard.authenticate }, async (req) => {
    const body = prefsSchema.parse(req.body);
    const current = await notificationService.getPreferences(req.user!.id);
    const pair = body.muted !== undefined ? { muted: body.muted, reminderLeadMinutes: body.reminderLeadMinutes } : { muted: current.muted, reminderLeadMinutes: body.reminderLeadMinutes ?? current.reminderLeadMinutes };
    const merged = {
      ...pair,
      ...(body.dailyEmails !== undefined ? { dailyEmails: dailyEmailsSaved(dailyEmailPrefs(current), body.dailyEmails) } : current.dailyEmails ? { dailyEmails: current.dailyEmails } : {}),
      ...(body.weeklySummary !== undefined ? { weeklySummary: body.weeklySummary } : current.weeklySummary !== undefined ? { weeklySummary: current.weeklySummary } : {}),
    };
    return { data: withDailyEmails(await notificationService.setPreferences(req.user!.id, normalizePreferences(merged))) };
  });

  app.get('/notifications/unread-count', { preHandler: guard.authenticate }, async (req) => {
    return { data: { count: await notificationService.unreadCount(req.user!.id, await scopeOf(req)) } };
  });

  app.put('/notifications/:id/read', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await notificationService.markRead(id, req.user!.id) };
  });

  // `upTo` (optional, the newest notification the reader was shown): only what came in by then is
  // read, so one that arrives while the list is open stays unread. Without it, everything (as before).
  app.post('/notifications/read-all', { preHandler: guard.authenticate }, async (req) => {
    const { upTo, kinds } = readAllSchema.parse(req.body ?? {});
    // companies: only what the list (in this scope) shows is read; 1.22: of the page's chips, when sent.
    const args = [req.user!.id, upTo ? new Date(upTo) : undefined, await scopeOf(req)] as const;
    await (kinds?.length ? notificationService.markAllRead(...args, kinds) : notificationService.markAllRead(...args));
    return { data: { ok: true } };
  });

  // 1.22: one of the caller's own, back to unread.
  app.post('/notifications/:id/unread', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await notificationService.markUnread(id, req.user!.id) };
  });

  // 1.22: one of the caller's own, removed (gone for them).
  app.delete('/notifications/:id', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    await notificationService.remove(id, req.user!.id);
    return { data: { ok: true } };
  });

  // 1.22: several of the caller's own at once (at most 200): read, unread or remove. Others' ids are skipped.
  app.post('/notifications/bulk', { preHandler: guard.authenticate }, async (req) => {
    const { ids, action } = bulkSchema.parse(req.body ?? {});
    return { data: await notificationService.bulk(req.user!.id, ids, action) };
  });
}
