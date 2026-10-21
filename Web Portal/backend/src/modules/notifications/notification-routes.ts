import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { NotificationService } from './notification-service';
import type { AuthGuard } from '../auth/auth-guard';
import { dailyEmailPrefs, normalizePreferences, DAILY_EMAIL_TIME, MAX_REMINDER_LEAD_MINUTES, type NotificationPreferences } from './notification-preferences';

const prefsSchema = z.object({
  muted: z.array(z.string()).optional(),
  reminderLeadMinutes: z.number().int().min(0).max(MAX_REMINDER_LEAD_MINUTES).optional(),
  dailyEmails: z
    .object({
      pending: z.boolean().optional(),
      completed: z.boolean().optional(),
      time: z.string().regex(DAILY_EMAIL_TIME, 'Choose a time as HH:MM.').optional(),
    })
    .optional(),
});

const readAllSchema = z.object({ upTo: z.string().datetime({ offset: true }).optional() });

/** Preferences as the apps read them: the daily email settings always filled in. */
const withDailyEmails = (p: NotificationPreferences): NotificationPreferences => ({ ...p, dailyEmails: dailyEmailPrefs(p) });

export interface NotificationRouteDeps {
  notificationService: NotificationService;
  guard: AuthGuard;
}

export async function registerNotificationRoutes(app: FastifyInstance, deps: NotificationRouteDeps): Promise<void> {
  const { notificationService, guard } = deps;

  app.get('/notifications', { preHandler: guard.authenticate }, async (req) => {
    return { data: await notificationService.listForUser(req.user!.id) };
  });

  // Per-user notification preferences (muted types, reminder lead time, daily task emails).
  app.get('/notifications/preferences', { preHandler: guard.authenticate }, async (req) => {
    return { data: withDailyEmails(await notificationService.getPreferences(req.user!.id)) };
  });

  // The muted types and the reminder time are saved together, as the apps always have (the time left
  // out means the default). The daily email settings are kept unless they are sent, so an app that
  // doesn't know them (an older phone app) never wipes them.
  app.put('/notifications/preferences', { preHandler: guard.authenticate }, async (req) => {
    const body = prefsSchema.parse(req.body);
    const current = await notificationService.getPreferences(req.user!.id);
    const pair = body.muted !== undefined ? { muted: body.muted, reminderLeadMinutes: body.reminderLeadMinutes } : { muted: current.muted, reminderLeadMinutes: body.reminderLeadMinutes ?? current.reminderLeadMinutes };
    const merged = {
      ...pair,
      ...(body.dailyEmails !== undefined ? { dailyEmails: { ...dailyEmailPrefs(current), ...body.dailyEmails } } : current.dailyEmails ? { dailyEmails: current.dailyEmails } : {}),
    };
    return { data: withDailyEmails(await notificationService.setPreferences(req.user!.id, normalizePreferences(merged))) };
  });

  app.get('/notifications/unread-count', { preHandler: guard.authenticate }, async (req) => {
    return { data: { count: await notificationService.unreadCount(req.user!.id) } };
  });

  app.put('/notifications/:id/read', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await notificationService.markRead(id, req.user!.id) };
  });

  // `upTo` (optional, the newest notification the reader was shown): only what came in by then is
  // read, so one that arrives while the list is open stays unread. Without it, everything (as before).
  app.post('/notifications/read-all', { preHandler: guard.authenticate }, async (req) => {
    const { upTo } = readAllSchema.parse(req.body ?? {});
    await notificationService.markAllRead(req.user!.id, upTo ? new Date(upTo) : undefined);
    return { data: { ok: true } };
  });
}
