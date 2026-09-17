import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DeviceTokenService } from './device-token-service';
import type { AuthGuard } from '../auth/auth-guard';

export interface DeviceTokenRouteDeps {
  deviceTokenService: DeviceTokenService;
  guard: AuthGuard;
}

const registerSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']).default('ANDROID'),
});

export async function registerDeviceTokenRoutes(app: FastifyInstance, deps: DeviceTokenRouteDeps): Promise<void> {
  const { deviceTokenService, guard } = deps;

  app.post('/device-tokens', { preHandler: guard.authenticate }, async (req, reply) => {
    const { token, platform } = registerSchema.parse(req.body);
    const record = await deviceTokenService.register({ userId: req.user!.id, token, platform });
    return reply.status(201).send({ data: record });
  });

  app.get('/device-tokens', { preHandler: guard.authenticate }, async (req) => {
    return { data: await deviceTokenService.listForUser(req.user!.id) };
  });

  app.delete('/device-tokens/:token', { preHandler: guard.authenticate }, async (req, reply) => {
    const { token } = req.params as { token: string };
    await deviceTokenService.unregister(token, req.user!.id);
    return reply.status(204).send();
  });
}
