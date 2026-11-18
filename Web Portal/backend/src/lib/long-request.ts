import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Logger } from './logger';
import { IDEMPOTENCY_LEASE_MS } from './idempotency';

/**
 * 1.24.0 (left over from review batch 1 M2 and batch 4b #19): a pending repeat-request key
 * (IDEMPOTENCY_LEASE_MS) and a note's "task being made" claim (TASK_CLAIM_TIMEOUT_MS) are taken over
 * after 10 minutes, so a request still running then could be run a second time beside it. No request
 * should ever take that long behind the live proxy; one that does is written once to the Error log —
 * like job-gate's warning about a background run that goes on far too long — and left running.
 */
export const LONG_REQUEST_MS = IDEMPOTENCY_LEASE_MS;

const timers = new WeakMap<FastifyRequest, ReturnType<typeof setTimeout>>();

export function registerLongRequestWarning(app: FastifyInstance, opts: { logger?: Pick<Logger, 'error'>; afterMs?: number } = {}): void {
  const afterMs = opts.afterMs ?? LONG_REQUEST_MS;
  const stop = (req: FastifyRequest) => {
    const t = timers.get(req);
    if (t) clearTimeout(t);
    timers.delete(req);
  };
  app.addHook('onRequest', (req, _reply, done) => {
    const t = setTimeout(() => {
      timers.delete(req);
      try {
        opts.logger?.error('a request is still running after 10 minutes (left running; a retry with the same key may now run beside it)', {
          method: req.method,
          route: req.routeOptions?.url,
          url: req.url.split('?')[0],
          userId: (req as FastifyRequest & { user?: { id?: string } }).user?.id,
          runningForMs: afterMs,
        });
      } catch {
        // A warning can never stop a request.
      }
    }, afterMs);
    t.unref?.();
    timers.set(req, t);
    done();
  });
  // The answer is on its way (sent, even to a client that has gone): the request's work is over.
  app.addHook('onSend', (req, _reply, payload, done) => {
    stop(req);
    done(null, payload);
  });
  app.addHook('onResponse', (req, _reply, done) => {
    stop(req);
    done();
  });
}
