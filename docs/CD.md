# Continuous Deployment & Scaling (T19.5)

## CD pipeline

`.github/workflows/cd.yml` triggers on a version tag (`v*`): it installs, builds all workspaces,
runs `prisma migrate deploy` against `DATABASE_URL` (from repo secrets), then runs a **Deploy**
step you fill in for your platform (Docker image push, Fly.io, Render, a server over SSH, etc.).
CI (`ci.yml`) must be green first — type-check, lint, unit tests, build, and the MySQL
integration tests.

Recommended repo/environment secrets: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`MAILJET_API_KEY`, `MAILJET_SECRET_KEY`, `MAILJET_WEBHOOK_TOKEN`, and (optionally) `SENTRY_DSN`,
`REDIS_URL`.

## Scaling Socket.IO across multiple instances

A single Node process broadcasts real-time task events in-memory. To run **more than one API
instance** behind a load balancer, add the Redis adapter so events fan out across instances:

```bash
npm i @socket.io/redis-adapter redis --workspace @mico360/backend
```

Then, in `Web Portal/backend/src/realtime/realtime.ts`, attach the adapter when `REDIS_URL` is set:

```ts
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

// inside createRealtime(), after `const io = new Server(...)`:
if (process.env.REDIS_URL) {
  const pub = createClient({ url: process.env.REDIS_URL });
  const sub = pub.duplicate();
  await Promise.all([pub.connect(), sub.connect()]);
  io.adapter(createAdapter(pub, sub));
}
```

Also enable sticky sessions (or use only WebSocket transport) at the load balancer so a client
stays on one instance for the duration of a connection.

## Health & rollback

- Point the platform's health check at `GET /api/v1/health`.
- Because deploys run `prisma migrate deploy` (forward-only), write backward-compatible
  migrations and keep a database backup immediately before each deploy (see `DATA-POLICY.md`).
