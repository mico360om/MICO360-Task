import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AI_REQUESTS, isAiRequest } from './ai-requests';
import type { ApiClient } from './api-client';

// 1.23.0 (the Error log's Slow): the website's requests that wait on the AI layer count as slow only after
// a minute. This checks the one list (ai-requests.ts) against the code: every request the website's API
// modules make into a server route that can reach the AI is either on it, or below as one that doesn't wait.

describe('isAiRequest', () => {
  it('knows the AI requests by method and path (ids, a query string and the /api/v1 prefix don’t matter)', () => {
    expect(isAiRequest('POST', '/ai/parse-task')).toBe(true);
    expect(isAiRequest('post', '/api/v1/ai/parse-meeting')).toBe(true);
    expect(isAiRequest('POST', '/mico-ai/chats/clx123/messages')).toBe(true);
    expect(isAiRequest('POST', '/mico-ai/chats/clx123/messages/m7/confirm')).toBe(true);
    expect(isAiRequest('POST', '/search/ai?x=1')).toBe(true);
    expect(isAiRequest('POST', '/meetings/m1/final-minutes/draft')).toBe(true);
    expect(isAiRequest('POST', '/ai/models/abc/test')).toBe(true);
  });

  it('…and nothing else: other methods, near paths, the same pages’ ordinary requests', () => {
    expect(isAiRequest('GET', '/ai/parse-task')).toBe(false);
    expect(isAiRequest('GET', '/ai/config')).toBe(false);
    expect(isAiRequest('GET', '/search/ai/status')).toBe(false);
    expect(isAiRequest('GET', '/mico-ai/chats/c1/messages')).toBe(false);
    expect(isAiRequest('POST', '/mico-ai/chats/c1/messages/m1/stop')).toBe(false);
    expect(isAiRequest('POST', '/meetings/m1/final-minutes/approve')).toBe(false);
    expect(isAiRequest('POST', '/tasks')).toBe(false);
    expect(isAiRequest('POST', '/ai/parse-task/extra')).toBe(false);
  });
});

// ── The website's requests, recorded by running every API module against a recording client ──────────

type Call = { method: string; path: string };

/** A stand-in for any argument: every property and call gives itself back; as text it is "x". */
function anything(): unknown {
  const target = () => undefined;
  const p: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive || prop === 'toString' || prop === 'valueOf' || prop === 'toJSON') return () => 'x';
      if (prop === Symbol.iterator) return function* () {};
      if (prop === 'then') return undefined; // not a promise
      if (prop === 'length' || prop === 'size') return 0;
      return p;
    },
    apply: () => p,
    ownKeys: () => [],
  });
  return p;
}

async function websiteCalls(): Promise<Call[]> {
  const calls: Call[] = [];
  const pending: Promise<unknown>[] = [];
  const record = (method: string) => (path: unknown) => {
    calls.push({ method, path: String(path) });
    const answer = Promise.resolve(anything());
    pending.push(answer);
    return answer;
  };
  const client = { get: record('GET'), post: record('POST'), put: record('PUT'), patch: record('PATCH'), del: record('DELETE'), upload: record('POST'), getText: record('GET'), getBlob: record('GET') } as unknown as ApiClient;
  const modules = import.meta.glob('../api/*.ts', { eager: true }) as Record<string, Record<string, unknown>>;
  for (const [file, mod] of Object.entries(modules)) {
    if (file.endsWith('.test.ts') || file.endsWith('/client.ts')) continue;
    for (const value of Object.values(mod)) {
      if (typeof value !== 'function') continue;
      let api: unknown;
      try {
        api = (value as (c: ApiClient) => unknown)(client);
      } catch {
        continue;
      }
      if (!api || typeof api !== 'object') continue;
      for (const method of Object.values(api as Record<string, unknown>)) {
        if (typeof method !== 'function') continue;
        try {
          const out = (method as (...a: unknown[]) => unknown)(...Array.from({ length: 6 }, anything));
          if (out instanceof Promise) pending.push(out);
        } catch {
          // a helper that isn't a request
        }
      }
    }
  }
  for (let i = 0; i < 5; i++) await Promise.allSettled([...pending]); // chained requests too
  return calls;
}

/** "/meetings/x/final-minutes/draft?…" → its segments, an id ("x") matching any `:param`. */
const segments = (path: string) => path.split('?')[0]!.replace(/^\/api\/v1(?=\/)/, '').split('/').filter(Boolean);
const samePath = (website: string, pattern: string) => {
  const a = segments(website);
  const b = segments(pattern);
  return a.length === b.length && b.every((s, i) => s.startsWith(':') || a[i] === 'x' || a[i] === s);
};

// ── The server's routes that can reach the AI layer ───────────────────────────────────────────────────

const backend = resolve(__dirname, '../../../backend/src/modules');
/**
 * A route file is one of these when it imports from the AI layer — a module named "ai" or "…-ai…" (its
 * features and settings, MICO AI, search's AI panel, the Final MOM's AI draft).
 */
const handedAi = (source: string) => [...source.matchAll(/from '([^']+)'/g)].some((m) => /(^|[/.-])ai($|[-/])/.test(m[1]!));
function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return routeFiles(p);
    return e.name.endsWith('-routes.ts') ? [p] : [];
  });
}
const ROUTE = /\b(?:app|api)\.(get|post|put|patch|delete)\(\s*(['`])([^'`]+)\2/g;

/**
 * Requests to those route files that never wait on the AI (reading, settings, the chat's own records,
 * a draft already made). Each is named here on purpose: a new request to such a route fails below until
 * it is put on the AI list or here.
 */
const NOT_WAITING_ON_AI = new Set([
  'GET /ai/config',
  'POST /ai/models',
  'PUT /ai/models/:id',
  'PATCH /ai/models/:id/enabled',
  'DELETE /ai/models/:id',
  'DELETE /ai/providers/:id',
  'PUT /ai/defaults/:capability',
  'GET /mico-ai/status',
  'GET /mico-ai/chats',
  'POST /mico-ai/chats',
  'GET /mico-ai/chats/:chatId',
  'PATCH /mico-ai/chats/:chatId',
  'DELETE /mico-ai/chats/:chatId',
  'GET /mico-ai/chats/:chatId/messages',
  'GET /mico-ai/chats/:chatId/messages/:messageId',
  'POST /mico-ai/chats/:chatId/messages/:messageId/stop',
  'POST /mico-ai/chats/:chatId/messages/:messageId/cancel',
  'POST /mico-ai/chats/:chatId/messages/:messageId/undo',
  'GET /mico-ai/chats/:chatId/messages/:messageId/tables/:file',
  'GET /mico-ai/chats/:chatId/messages/:messageId/report.pdf',
  'GET /search',
  'GET /search/tasks',
  'GET /search/all',
  'GET /search/ai/status',
  'GET /meetings/:id/final-minutes',
  'PUT /meetings/:id/final-minutes',
  'POST /meetings/:id/final-minutes/approve',
  'POST /meetings/:id/final-minutes/reopen',
  'POST /meetings/:id/final-minutes/ai-draft/:jobId/use',
  'POST /meetings/:id/final-minutes/ai-draft/:jobId/discard',
  'GET /meetings/:id/minutes.pdf',
  'GET /meetings/:id/minutes/preview',
  'POST /meetings/:id/minutes/send',
  'GET /meetings/:id/minutes/sends',
  'GET /meetings/:id/minutes/suggestions',
]);

describe.skipIf(!existsSync(backend))('the AI list covers every website request that can wait on the AI', async () => {
  const files = routeFiles(backend).filter((f) => handedAi(readFileSync(f, 'utf8')));
  const routes = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(ROUTE)].map((m) => `${m[1]!.toUpperCase()} ${m[3]}`));
  const calls = await websiteCalls();
  const intoAiRoutes = new Map<string, string>(); // website "METHOD path" → the server route it reaches
  for (const c of calls) {
    const route = routes.find((r) => r.split(' ')[0] === c.method && samePath(c.path, r.split(' ')[1]!));
    if (route) intoAiRoutes.set(`${c.method} ${c.path.split('?')[0]}`, route);
  }

  it('the server’s route files handed the AI are the known ones (a new one needs a look here)', () => {
    const names = files.map((f) => f.slice(backend.length + 1).replace(/\\/g, '/')).sort();
    expect(names).toEqual(['ai/ai-config-routes.ts', 'ai/ai-feature-routes.ts', 'meetings/minutes-routes.ts', 'mico-ai/mico-ai-routes.ts', 'search/search-routes.ts']);
  });

  it('the website’s requests were recorded (the API modules ran)', () => {
    expect(calls.length).toBeGreaterThan(300);
    expect(intoAiRoutes.size).toBeGreaterThan(20);
  });

  it('every website request into those routes is on the AI list or is one that doesn’t wait on the AI', () => {
    const unclassified = [...intoAiRoutes].filter(([call, route]) => {
      const [method, path] = call.split(' ') as [string, string];
      return !isAiRequest(method, path) && !NOT_WAITING_ON_AI.has(route);
    });
    expect(unclassified).toEqual([]);
  });

  it('every request on the AI list is one the website makes, to a route the server has', () => {
    for (const r of AI_REQUESTS) {
      expect(routes, `${r.method} ${r.path} on the server`).toContain(`${r.method} ${r.path}`);
      expect([...intoAiRoutes.values()], `${r.method} ${r.path} made by the website`).toContain(`${r.method} ${r.path}`);
    }
  });

  it('nothing is on both lists, and the "doesn’t wait" list names real routes the website calls', () => {
    for (const r of AI_REQUESTS) expect(NOT_WAITING_ON_AI.has(`${r.method} ${r.path}`)).toBe(false);
    const reached = new Set(intoAiRoutes.values());
    expect([...NOT_WAITING_ON_AI].filter((r) => !reached.has(r))).toEqual([]);
  });
});
