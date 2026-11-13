import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { UserState } from '../auth/auth-guard';
import { createFileLinks } from './file-links';
import { createFileAccess, type FileChatRow } from './file-access';
import { registerUploads, storedName } from './file-route';

// 1.23.29 Private file links (design §7.2, §7.7, §7.9, §10 "The route"): GET /uploads/:file on a real
// server with real files — a task's or a chat's file only through a link signed for someone who can see it
// now; a current photo, project picture or logo as before; anything else 404.

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const dir = mkdtempSync(join(tmpdir(), 'pf-route-'));
const files: Record<string, Buffer> = { 'task-file.pdf': PDF, 'task-pic.png': PNG, 'chat-pic.png': PNG, 'dm-file.pdf': PDF, 'photo.png': PNG, 'old-photo.png': PNG, 'orphan.png': PNG, 'logo.png': PNG };
beforeAll(() => {
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, name), bytes);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const tokenService = createTokenService({
  accessSecret: 'pf-route-access-secret', refreshSecret: 'pf-route-refresh', accessTtl: 900, refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

// The world: tasks t1 (project P, live) and t2; a project channel c1 and a direct chat d1.
let accounts: Map<string, UserState>;
let taskViewers: Map<string, Set<string>>;
let convViewers: Map<string, Set<string>>;
let deadTasks: Set<string>;
let taskFiles: Map<string, string[]>;
let chatFiles: Map<string, FileChatRow[]>;
let pictures: Set<string>;
let storeAsked: string[];
let app: FastifyInstance;
const links = createFileLinks({ secret: 'pf-route-access-secret' });

async function makeApp() {
  const a = await buildApp({ authService, tokenService });
  const access = createFileAccess({
    store: {
      async rowsOf(key) {
        storeAsked.push(key);
        return { taskIds: taskFiles.get(key) ?? [], chats: chatFiles.get(key) ?? [] };
      },
      async isPublicPicture(url) { return pictures.has(url); },
      async taskIsLive(taskId) { return !deadTasks.has(taskId); },
    },
    canViewTask: async (userId, roles, taskId) => roles.includes('ADMIN') || (taskViewers.get(taskId)?.has(userId) ?? false),
    canSeeConversation: async (cid, userId) => convViewers.get(cid)?.has(userId) ?? false,
    // No memory between the steps of a test: each refusal reason is seen at once.
    classifyTtlMs: 0,
    decisionTtlMs: 0,
  });
  // A stand-in for the face route (registered first in server.ts): the deeper path is never this route's.
  a.get('/uploads/faces/:file', async () => 'a face');
  await registerUploads(a, { root: dir, links, access, accountState: async (id) => accounts.get(id) ?? null, appUrl: 'https://task.example' });
  await a.ready();
  return a;
}

beforeEach(async () => {
  accounts = new Map([
    ['amal', { tokenVersion: 1, active: true, roles: ['EMPLOYEE'] }],
    ['basim', { tokenVersion: 0, active: true, roles: ['EMPLOYEE'] }],
    ['root', { tokenVersion: 0, active: true, roles: ['ADMIN'] }],
    ['client1', { tokenVersion: 0, active: true, roles: ['CLIENT'] }],
  ]);
  taskViewers = new Map([['t1', new Set(['amal', 'basim', 'client1'])]]);
  convViewers = new Map([['c1', new Set(['amal', 'client1'])], ['d1', new Set(['basim'])]]);
  deadTasks = new Set();
  taskFiles = new Map([['task-file.pdf', ['t1']], ['task-pic.png', ['t1']]]);
  chatFiles = new Map([['chat-pic.png', [{ conversationId: 'c1', deleted: false }]], ['dm-file.pdf', [{ conversationId: 'd1', deleted: false }]]]);
  pictures = new Set(['/uploads/photo.png', '/uploads/logo.png']);
  storeAsked = [];
  app = await makeApp();
});

const amal = { id: 'amal', ver: 1 };
const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers });

describe('a task or chat file without a working link: the plain page', () => {
  it('an unsigned address gets 403 and a short page that never says why', async () => {
    const res = await get('/uploads/task-file.pdf');
    expect(res.statusCode).toBe(403);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(res.body).toContain('This file link no longer works');
    expect(res.body).toContain('Open the task or chat in MICO360 Tasks');
    expect(res.body).toMatch(/<meta name="viewport"/);
    expect(res.body).not.toMatch(/<script|<link|src=/i);
    expect(res.body).not.toMatch(/expired|removed|deleted|binned/i);
  });

  it('the same words for every reason', async () => {
    const unsigned = (await get('/uploads/task-pic.png')).body;
    accounts.set('amal', { tokenVersion: 1, active: false, roles: ['EMPLOYEE'] });
    const inactive = await get(links.sign('task-pic.png', amal));
    expect(inactive.statusCode).toBe(403);
    expect(inactive.body).toBe(unsigned);
  });

  it('HEAD is refused the same way', async () => {
    const res = await app.inject({ method: 'HEAD', url: '/uploads/task-file.pdf' });
    expect(res.statusCode).toBe(403);
    expect(res.body).toBe('');
  });
});

describe('a signed link for someone who can see the task or chat', () => {
  it('a task’s PDF: 200, the bytes, and today’s safe headers (a download, revalidated before each use)', async () => {
    const res = await get(links.sign('task-file.pdf', amal));
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(PDF)).toBe(true);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toMatch(/sandbox/);
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['content-disposition']).toBe('attachment');
    expect(res.headers.etag).toBeTruthy();
  });

  it('a task’s picture shows in place (no attachment header)', async () => {
    const res = await get(links.sign('task-pic.png', amal));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it('a chat picture for someone in the conversation', async () => {
    expect((await get(links.sign('chat-pic.png', amal))).statusCode).toBe(200);
  });

  it('HEAD and Range are checked and served', async () => {
    const head = await app.inject({ method: 'HEAD', url: links.sign('task-file.pdf', amal) });
    expect(head.statusCode).toBe(200);
    expect(Number(head.headers['content-length'])).toBe(PDF.length);
    const range = await get(links.sign('task-file.pdf', amal), { range: 'bytes=0-3' });
    expect(range.statusCode).toBe(206);
    expect(range.body).toBe('%PDF');
  });

  it('If-None-Match answers 304 only while the person may still open it', async () => {
    const url = links.sign('task-pic.png', amal);
    const etag = String((await get(url)).headers.etag);
    expect((await get(url, { 'if-none-match': etag })).statusCode).toBe(304);
    taskViewers.get('t1')!.delete('amal');
    const after = await get(url, { 'if-none-match': etag });
    expect(after.statusCode).toBe(403);
  });

  it('a file still listed but gone from the disk is a 404, not an error', async () => {
    taskFiles.set('missing.png', ['t1']);
    expect((await get(links.sign('missing.png', amal))).statusCode).toBe(404);
  });

  it('a link made for a newer session than the remembered one works at once (a password just changed)', async () => {
    let fresh = 0;
    const a = await buildApp({ authService, tokenService });
    const access = createFileAccess({ store: { async rowsOf() { return { taskIds: ['t1'], chats: [] }; }, async isPublicPicture() { return false; }, async taskIsLive() { return true; } }, canViewTask: async () => true, canSeeConversation: async () => false });
    let remembered: UserState = { tokenVersion: 1, active: true, roles: ['EMPLOYEE'] };
    const now: UserState = { tokenVersion: 2, active: true, roles: ['EMPLOYEE'] };
    await registerUploads(a, { root: dir, links, access, accountState: async (_id, o) => { if (o?.fresh) { fresh++; remembered = now; } return remembered; } });
    expect((await a.inject({ method: 'GET', url: links.sign('task-pic.png', { id: 'amal', ver: 2 }) })).statusCode).toBe(200);
    expect(fresh).toBe(1);
    // A made-up signature never costs a fresh read.
    const forged = links.sign('task-pic.png', { id: 'amal', ver: 2 }).replace(/s=.{4}/, 's=AAAA');
    expect((await a.inject({ method: 'GET', url: forged })).statusCode).toBe(403);
    expect(fresh).toBe(1);
    await a.close();
  });
});

describe('each reason a link is refused (403)', () => {
  const pic = (who = amal) => get(links.sign('task-pic.png', who));

  it('the account was deactivated', async () => {
    accounts.set('amal', { tokenVersion: 1, active: false, roles: ['EMPLOYEE'] });
    expect((await pic()).statusCode).toBe(403);
  });

  it('the session version changed (password change, sign out everywhere)', async () => {
    accounts.set('amal', { tokenVersion: 2, active: true, roles: ['EMPLOYEE'] });
    expect((await pic()).statusCode).toBe(403);
  });

  it('the person was removed from the project', async () => {
    taskViewers.get('t1')!.delete('amal');
    expect((await pic()).statusCode).toBe(403);
  });

  it('the task is in the Recycle Bin — for an administrator too', async () => {
    deadTasks.add('t1');
    expect((await pic()).statusCode).toBe(403);
    expect((await pic({ id: 'root', ver: 0 })).statusCode).toBe(403);
  });

  it('the project was deleted — for an administrator too', async () => {
    deadTasks.add('t1'); // taskIsLive is false for a task of a deleted project
    expect((await get(links.sign('task-file.pdf', { id: 'root', ver: 0 }))).statusCode).toBe(403);
  });

  it('not a participant of the direct chat', async () => {
    expect((await get(links.sign('dm-file.pdf', amal))).statusCode).toBe(403);
    expect((await get(links.sign('dm-file.pdf', { id: 'basim', ver: 0 }))).statusCode).toBe(200); // a participant
  });

  it('a client account named in the link (clients download through the Client portal only)', async () => {
    expect((await get(links.sign('task-pic.png', { id: 'client1', ver: 0 }))).statusCode).toBe(403);
    expect((await get(links.sign('chat-pic.png', { id: 'client1', ver: 0 }))).statusCode).toBe(403);
  });

  it('an unknown person', async () => {
    expect((await get(links.sign('task-pic.png', { id: 'nobody', ver: 0 }))).statusCode).toBe(403);
  });

  it('expired, changed, another person’s or another file’s link', async () => {
    const old = createFileLinks({ secret: 'pf-route-access-secret', now: () => Date.now() - 31 * 3600_000 });
    expect((await get(old.sign('task-pic.png', amal))).statusCode).toBe(403);
    const good = links.sign('task-pic.png', amal);
    expect((await get(good.replace('u=amal', 'u=basim'))).statusCode).toBe(403);
    expect((await get(good.replace('/task-pic.png', '/task-file.pdf'))).statusCode).toBe(403);
    expect((await get(`${good}&u=amal`)).statusCode).toBe(403); // a part given twice
    const other = createFileLinks({ secret: 'another-secret' });
    expect((await get(other.sign('task-pic.png', amal))).statusCode).toBe(403);
  });

  it('a deleted chat message’s file (rows not yet purged)', async () => {
    chatFiles.set('chat-pic.png', [{ conversationId: 'c1', deleted: true }]);
    expect((await get(links.sign('chat-pic.png', amal))).statusCode).toBe(403);
  });
});

describe('public pictures and everything else', () => {
  it('a current photo or logo opens with no link, as before (any query is harmless)', async () => {
    const res = await get('/uploads/photo.png');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect((await get('/uploads/logo.png?v=2')).statusCode).toBe(200);
  });

  it('a replaced photo, an erased file or an orphan: 404, kept by no one', async () => {
    for (const name of ['old-photo.png', 'orphan.png', 'nothing-here.png']) {
      const res = await get(`/uploads/${name}`);
      expect(res.statusCode, name).toBe(404);
      expect(res.headers['cache-control'], name).toBe('no-store');
      expect(res.headers['x-robots-tag'], name).toBe('noindex, nofollow');
    }
  });

  it('a deleted message’s file once its rows are purged: 404', async () => {
    chatFiles.delete('chat-pic.png');
    expect((await get(links.sign('chat-pic.png', amal))).statusCode).toBe(404);
  });

  it('bad names never reach the database: 404', async () => {
    for (const url of ['/uploads/%2e%2e', '/uploads/..%2Fsecret', '/uploads/a%5Cb.png', '/uploads/a%00b', '/uploads/%25', '/uploads/']) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(404);
    }
    // A name longer than Fastify's parameter limit (100) is refused by Fastify itself (414) before the route.
    expect((await get(`/uploads/${'x'.repeat(201)}`)).statusCode).toBeGreaterThanOrEqual(404);
    expect(storedName('x'.repeat(201))).toBeNull();
    expect(storeAsked).toEqual([]);
  });

  it('face copies keep their own route', async () => {
    expect((await get('/uploads/faces/photo.png.webp')).body).toBe('a face');
  });
});

describe('on a server that serves the web app too (the live site, the Windows server)', () => {
  it('the plain page keeps its own strict policy (no web-app script policy), and files still go out', async () => {
    const web = mkdtempSync(join(tmpdir(), 'pf-web-'));
    writeFileSync(join(web, 'index.html'), '<!doctype html><title>MICO360</title><div id="root"></div>');
    const { registerWebApp } = await import('../../lib/web-app');
    const a = await buildApp({ authService, tokenService });
    const access = createFileAccess({ store: { async rowsOf(k) { return { taskIds: k === 'task-pic.png' ? ['t1'] : [], chats: [] }; }, async isPublicPicture(u) { return u === '/uploads/photo.png'; }, async taskIsLive() { return true; } }, canViewTask: async () => true, canSeeConversation: async () => false });
    await registerUploads(a, { root: dir, links, access, accountState: async (id) => accounts.get(id) ?? null });
    await registerWebApp(a, { root: web });
    await a.ready();
    const refused = await a.inject({ method: 'GET', url: '/uploads/task-pic.png', headers: { host: 'task.example' } });
    expect(refused.statusCode).toBe(403);
    expect(refused.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    expect((await a.inject({ method: 'GET', url: links.sign('task-pic.png', amal) })).statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: '/uploads/photo.png' })).statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: '/uploads/nothing.png' })).statusCode).toBe(404);
    expect((await a.inject({ method: 'GET', url: '/', headers: { host: 'task.example' } })).statusCode).toBe(200);
    await a.close();
    rmSync(web, { recursive: true, force: true });
  });
});

describe('logs never keep a link', () => {
  it('a failed file request is logged by its path alone (the signature would open the file)', async () => {
    const logged: unknown[] = [];
    const logger = { info() {}, warn() {}, debug() {}, error: (_m: string, meta?: unknown) => { logged.push(meta); } };
    const a = await buildApp({ authService, tokenService, logger: logger as never });
    const access = createFileAccess({ store: { async rowsOf() { throw new Error('database unreachable'); }, async isPublicPicture() { return false; }, async taskIsLive() { return true; } }, canViewTask: async () => true, canSeeConversation: async () => true });
    await registerUploads(a, { root: dir, links, access, accountState: async () => null });
    const url = links.sign('task-pic.png', amal);
    const res = await a.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(logged)).toContain('/uploads/task-pic.png');
    expect(JSON.stringify(logged)).not.toContain('s=');
    await a.close();
  });
});
