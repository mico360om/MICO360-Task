import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { SettingsService } from './settings-service';
import type { AuthGuard } from '../auth/auth-guard';
import type { AuditService } from '../audit/audit-service';

// `value` must be present (a missing value used to reach the database and fail with a 500).
const setSchema = z.object({ value: z.unknown() }).refine((b) => b.value !== undefined, { message: 'value is required', path: ['value'] });

export interface SettingsRouteDeps {
  settingsService: SettingsService;
  guard: AuthGuard;
  /** Every settings write is recorded to the audit log. */
  audit?: AuditService;
}

export async function registerSettingsRoutes(app: FastifyInstance, deps: SettingsRouteDeps): Promise<void> {
  const { settingsService, guard } = deps;

  app.get('/system-settings', { preHandler: guard.requireRoles('ADMIN') }, async () => {
    return { data: await settingsService.getAll() };
  });

  app.put('/system-settings/:key', { preHandler: guard.requireRoles('ADMIN') }, async (req) => {
    const { key } = req.params as { key: string };
    const { value } = setSchema.parse(req.body);
    const previous = await settingsService.get(key);
    const saved = await settingsService.set(key, value);
    await deps.audit?.record({
      userId: req.user?.id ?? null,
      ip: req.ip ?? null,
      module: 'settings',
      action: 'setting.update',
      entityId: key,
      oldValue: previous ?? null,
      newValue: saved.value,
    });
    return { data: saved };
  });
}
