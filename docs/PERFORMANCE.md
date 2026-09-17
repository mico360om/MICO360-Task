# Performance & Low-Resource Operation

MICO360 Tasks is built to stay responsive and stable on constrained hardware — small VPS
instances, older office PCs, and low-end phones on slow networks. This document lists the
measures already in the code and the deployment levers that matter when CPU, RAM, storage,
or the network is tight.

## What the app already does

### Client (browser — matters most on slow CPUs / networks)
- **Route-level code splitting.** Every screen except the login flow and the landing
  dashboard is loaded on demand (`React.lazy`). Opening the app downloads and parses
  ~130 KB gzip of JavaScript instead of one ~185 KB monolith; heavy screens (Kanban board,
  chat, reports, the meetings module) only load their code when visited.
- **Cacheable vendor chunks.** React, TanStack Query, and the realtime client are split into
  content-hashed chunks (`vendor-react`, `vendor-query`, `vendor-realtime`) so a return visit
  after a deploy re-downloads only the app code that changed, not the framework.
- **Restrained data fetching.** Queries use a 30 s stale window and **do not** refetch on
  window focus, so tabbing back to the app doesn't trigger a network + re-render stampede.
  Mutations still invalidate explicitly, so data stays correct. Deterministic 4xx responses
  are never retried.
- **Reduced-motion aware.** All animations honor `prefers-reduced-motion`; count-ups and
  scroll reveals fall back to static content, which also helps weak GPUs.
- **Offline-tolerant.** Mutations made while disconnected are queued and replayed on
  reconnect; list reads fall back to a local cache.
- **No page-level horizontal overflow**, relative units, and skeletons keep layout stable
  during slow loads (no jank on reflow).

### Server (Node + Fastify + Prisma)
- **Runs compiled JavaScript** in production (`node dist/src/server.js`) — no on-the-fly TS
  compilation, lower memory and startup cost than the dev `tsx` watcher.
- **Bounded queries.** Search loads capped row sets; the meeting list, reminder sweep, and
  reports all take explicit limits rather than unbounded scans. The schema carries indexes on
  every hot foreign key and status column.
- **Cached search snapshot.** Global search reads a broad snapshot of tasks/projects/people/
  meetings; that snapshot is cached for 15 s with single-flight loading, so a burst of
  debounced searches (per keystroke) collapses into **one** database read instead of many.
- **Lease-locked background sweeps** (digests, escalations, carry-forward, meeting reminders)
  run at most one instance at a time and their timers are `unref()`d, so they never keep the
  process awake or duplicate work across instances.
- **Dependency-free document generation.** The minutes PDF, `.ics` invites, CSV/XLS exports
  are built in memory with no headless browser or native binary — a few KB of allocation, no
  extra process to feed.

## Deployment levers for low-resource hosts

These are set in the environment / infra, not in code.

### Node memory
On a small instance, cap the heap so the process fails predictably instead of being
OOM-killed, and size it to the box:
```bash
# ~256 MB app heap on a 512 MB box (leave room for the OS + libuv)
NODE_OPTIONS="--max-old-space-size=256" node dist/src/server.js
```
Run **one** clustered worker per available core at most; a single worker is fine for small
teams. The lease locks make horizontal scaling safe when you do add workers.

### Database (MySQL in production)
- **Limit the Prisma connection pool** on low-RAM databases — each connection costs memory:
  ```
  DATABASE_URL="mysql://user:pass@host:3306/mico360?connection_limit=5&pool_timeout=20"
  ```
- Apply migrations with `prisma migrate deploy` (never `db push`) so the indexed schema lands
  intact. The indexes are what keep list/search queries cheap as data grows.
- Size the MySQL InnoDB buffer pool to the working set if you control the DB host; on a tiny
  box, 128–256 MB is a reasonable floor.

### Serving the frontend
- Serve the built `dist/` as **static files from nginx or a CDN**, not from Node. The
  filenames are content-hashed, so set long-lived immutable caching on `assets/*` and
  `no-cache` on `index.html`.
- Enable **gzip/brotli** at the edge (nginx/CDN). The app ships pre-minified; edge compression
  cuts the JS/JSON/PDF transfer roughly 3–4× for slow links. (Compressing in Node instead
  trades CPU for bandwidth — prefer the edge on CPU-constrained servers.)

### Storage
- Uploaded files (`UPLOAD_DIR`) and the SQLite-free Postgres/MySQL data are the only growth.
  Point `UPLOAD_DIR` at the largest volume and prune orphaned uploads periodically (deleting a
  chat/task/note attachment already removes its file).

## Rough minimum specs
- **Server:** 1 vCPU / 512 MB RAM / 5 GB disk runs a small team comfortably with the Node
  heap capped and the DB pool at 5. 1 GB RAM is comfortable headroom.
- **Database:** shares the box on tiny deployments; give it its own 1 GB instance once data or
  concurrency grows.
- **Client:** any browser from the last few years on a 2 GB-RAM device; the initial payload is
  ~130 KB gzip and each screen adds a few KB more only when opened.

## Verifying
- `npm run build --workspace @mico360/frontend` prints the per-chunk sizes — confirm no single
  chunk balloons and that pages are split out.
- The full test suite (`npm run test`) exercises the caching and access paths; keep it green.
