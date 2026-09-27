import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EmailWebhookService, EmailEvent } from './email-webhook-service';

export interface EmailWebhookRouteDeps {
  emailWebhookService: EmailWebhookService;
  /** Shared secret (MAILJET_WEBHOOK_TOKEN), sent as ?token=… or as the HTTP Basic password. */
  token?: string;
  /** Refuse every event while no token is configured. Default: on in production. */
  requireToken?: boolean;
}

/** Constant-time comparison (hashing first makes the lengths equal). */
export function tokensMatch(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function presentedToken(req: FastifyRequest): string | null {
  const q = (req.query as { token?: unknown } | undefined)?.token;
  if (typeof q === 'string' && q) return q;
  const header = req.headers.authorization;
  if (header?.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice('Basic '.length).trim(), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    return i >= 0 ? decoded.slice(i + 1) : decoded;
  }
  return null;
}

export async function registerEmailWebhookRoutes(app: FastifyInstance, deps: EmailWebhookRouteDeps): Promise<void> {
  const requireToken = deps.requireToken ?? process.env.NODE_ENV === 'production';

  // Mailjet posts delivery/bounce/spam events here (unauthenticated; guarded by a token). Without
  // a token anyone could post fake bounces and stop mail to any address, so production refuses.
  app.post('/webhooks/mailjet', async (req, reply) => {
    if (deps.token) {
      const presented = presentedToken(req);
      if (!presented || !tokensMatch(presented, deps.token)) {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook token.' } });
      }
    } else if (requireToken) {
      req.log.warn('Mailjet webhook call refused: MAILJET_WEBHOOK_TOKEN is not set');
      return reply.status(503).send({ error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'The email webhook is not configured.' } });
    }
    const body = req.body;
    const events = (Array.isArray(body) ? body : [body]) as EmailEvent[];
    const result = await deps.emailWebhookService.handleEvents(events);
    return reply.send({ data: result });
  });
}
