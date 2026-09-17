import type { FastifyInstance } from 'fastify';
import type { EmailWebhookService, EmailEvent } from './email-webhook-service';

export interface EmailWebhookRouteDeps {
  emailWebhookService: EmailWebhookService;
  /** Optional shared secret checked as ?token=… (set MAILJET_WEBHOOK_TOKEN). */
  token?: string;
}

export async function registerEmailWebhookRoutes(app: FastifyInstance, deps: EmailWebhookRouteDeps): Promise<void> {
  // Mailjet posts delivery/bounce/spam events here (unauthenticated; guarded by a token).
  app.post('/webhooks/mailjet', async (req, reply) => {
    if (deps.token) {
      const q = req.query as { token?: string };
      if (q.token !== deps.token) {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook token.' } });
      }
    }
    const body = req.body;
    const events = (Array.isArray(body) ? body : [body]) as EmailEvent[];
    const result = await deps.emailWebhookService.handleEvents(events);
    return reply.send({ data: result });
  });
}
