import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { SettingsService } from './settings-service';
import type { AuthGuard } from '../auth/auth-guard';

const setSchema = z.object({ value: z.unknown() });

export interface SettingsRouteDeps {
  settingsService: SettingsService;
  guard: AuthGuard;
}

export async function registerSettingsRoutes(app: FastifyInstance, deps: SettingsRouteDeps): Promise<void> {
  const { settingsService, guard } = deps;

  app.get('/system-settings', { preHandler: guard.requireRoles('ADMIN') }, async () => {
    return { data: await settingsService.getAll() };
  });

  app.put('/system-settings/:key', { preHandler: guard.requireRoles('ADMIN') }, async (req) => {
    const { key } = req.params as { key: string };
    const { value } = setSchema.parse(req.body);
    return { data: await settingsService.set(key, value) };
  });
}
