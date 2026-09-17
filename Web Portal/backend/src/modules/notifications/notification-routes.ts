import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { NotificationService } from './notification-service';
import type { AuthGuard } from '../auth/auth-guard';
import { normalizePreferences, MAX_REMINDER_LEAD_MINUTES } from './notification-preferences';

const prefsSchema = z.object({
  muted: z.array(z.string()).optional(),
  reminderLeadMinutes: z.number().int().min(0).max(MAX_REMINDER_LEAD_MINUTES).optional(),
});

export interface NotificationRouteDeps {
  notificationService: NotificationService;
  guard: AuthGuard;
}

export async function registerNotificationRoutes(app: FastifyInstance, deps: NotificationRouteDeps): Promise<void> {
  const { notificationService, guard } = deps;

  app.get('/notifications', { preHandler: guard.authenticate }, async (req) => {
    return { data: await notificationService.listForUser(req.user!.id) };
  });

  // Per-user notification preferences (mute specific notification types).
  app.get('/notifications/preferences', { preHandler: guard.authenticate }, async (req) => {
    return { data: await notificationService.getPreferences(req.user!.id) };
  });

  app.put('/notifications/preferences', { preHandler: guard.authenticate }, async (req) => {
    const body = prefsSchema.parse(req.body);
    return { data: await notificationService.setPreferences(req.user!.id, normalizePreferences(body)) };
  });

  app.get('/notifications/unread-count', { preHandler: guard.authenticate }, async (req) => {
    return { data: { count: await notificationService.unreadCount(req.user!.id) } };
  });

  app.put('/notifications/:id/read', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await notificationService.markRead(id, req.user!.id) };
  });

  app.post('/notifications/read-all', { preHandler: guard.authenticate }, async (req) => {
    await notificationService.markAllRead(req.user!.id);
    return { data: { ok: true } };
  });
}
