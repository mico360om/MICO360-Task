import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerWebApp, isClientRoute, webAppCsp, cacheControlFor } from './web-app';

describe('isClientRoute', () => {
  it('accepts page routes and rejects server paths, files and non-GET requests', () => {
    expect(isClientRoute('GET', '/')).toBe(true);
    expect(isClientRoute('GET', '/projects/abc/board?x=1')).toBe(true);
    expect(isClientRoute('HEAD', '/dashboard')).toBe(true);
    expect(isClientRoute('GET', '/index.html')).toBe(true);
    expect(isClientRoute('GET', '/api/v1/nope')).toBe(false);
    expect(isClientRoute('GET', '/api')).toBe(false);
    expect(isClientRoute('GET', '/uploads/missing.png')).toBe(false);
    expect(isClientRoute('GET', '/socket.io/')).toBe(false);
    expect(isClientRoute('GET', '/assets/missing.js')).toBe(false);
    expect(isClientRoute('POST', '/dashboard')).toBe(false);
  });
});

describe('webAppCsp', () => {
  it('names the same-origin socket for a normal host', () => {
    expect(webAppCsp('192.168.1.20:4000')).toContain("connect-src 'self' ws://192.168.1.20:4000 wss://192.168.1.20:4000");
    expect(webAppCsp('[::1]:4000')).toContain('ws://[::1]:4000');
  });

  it('never echoes an unsafe Host header', () => {
    const csp = webAppCsp("evil.example; script-src 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).not.toContain('evil');
    expect(webAppCsp(undefined)).toContain("connect-src 'self';");
  });
});

describe('cacheControlFor', () => {
  it('caches hashed assets for a year and revalidates everything else', () => {
    expect(cacheControlFor('/assets/index-abc123.js')).toBe('public, max-age=31536000, immutable');
    expect(cacheControlFor('/favicon.ico')).toBe('no-cache');
  });
});

describe('registerWebApp', () => {
  let root: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'webapp-'));
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>MICO360</title><div id="root"></div>');
    writeFileSync(join(root, 'assets', 'app-abc123.js'), 'console.log(1)');
    app = Fastify();
    app.get('/api/v1/health', async () => ({ data: { status: 'ok' } }));
    await registerWebApp(app, { root });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('serves index.html at / with the page security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/', headers: { host: 'localhost:4000' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.body).toContain('<div id="root">');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['content-security-policy']).toContain('ws://localhost:4000');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('falls back to index.html for client-side routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/projects/p1/board' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<div id="root">');
  });

  it('serves hashed assets with a long cache lifetime', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('console.log(1)');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('keeps API routes working and answers unknown API paths and files with a JSON 404', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).json()).toEqual({ data: { status: 'ok' } });
    for (const url of ['/api/v1/nope', '/assets/missing.js']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
    }
  });

  it('does not serve files outside the web root', async () => {
    const res = await app.inject({ method: 'GET', url: '/..%2f..%2fpackage.json' });
    expect(res.statusCode).not.toBe(200);
  });
});
