import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from 'node:zlib';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerWebApp, isClientRoute, webAppCsp, cacheControlFor, androidAppLink, robotsTagFor, HOSTED_APK_PATH } from './web-app';

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

  it('allows styles and fonts from the app itself only (the fonts are bundled, no other site is asked)', () => {
    const csp = webAppCsp('task.example.com');
    expect(csp).toContain("style-src 'self' 'unsafe-inline';");
    expect(csp).toContain("font-src 'self' data:;");
    expect(csp).not.toMatch(/googleapis|gstatic/);
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

describe('robotsTagFor — search engines may list the public pages only', () => {
  it('lets the sign-in, privacy and terms pages (and the site root) be indexed', () => {
    for (const url of ['/', '/login', '/login/', '/login?next=1', '/privacy', '/terms']) expect(robotsTagFor(url), url).toBeNull();
  });

  it('keeps every other page out of search results, including password-reset links', () => {
    for (const url of ['/dashboard', '/board?project=p1', '/projects/p1', '/admin/users', '/reset?token=secret', '/forgot', '/login/extra', '/index.html', '/anything-new']) {
      expect(robotsTagFor(url), url).toBe('noindex, nofollow');
    }
  });
});

describe('androidAppLink', () => {
  it('prefers the configured link, then an APK the web root hosts, else none', () => {
    const root = mkdtempSync(join(tmpdir(), 'webapp-apk-'));
    try {
      expect(androidAppLink(' https://play.google.com/x ', root)).toBe('https://play.google.com/x');
      expect(androidAppLink('', root)).toBeNull();
      expect(androidAppLink('', null)).toBeNull();
      mkdirSync(join(root, 'downloads'));
      writeFileSync(join(root, 'downloads', 'MICO360-Tasks.apk'), 'PK');
      expect(androidAppLink('', root)).toBe(HOSTED_APK_PATH);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('registerWebApp', () => {
  const BIG_JS = `console.log(${JSON.stringify('x'.repeat(4000))})`;
  let root: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'webapp-'));
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>MICO360</title><div id="root"></div>');
    writeFileSync(join(root, 'assets', 'app-abc123.js'), 'console.log(1)');
    // The build also writes compressed copies of the large files.
    writeFileSync(join(root, 'assets', 'big-def456.js'), BIG_JS);
    writeFileSync(join(root, 'assets', 'big-def456.js.br'), brotliCompressSync(Buffer.from(BIG_JS)));
    writeFileSync(join(root, 'assets', 'big-def456.js.gz'), gzipSync(Buffer.from(BIG_JS)));
    writeFileSync(join(root, 'robots.txt'), ['User-agent: *', 'Disallow: /api/', ''].join(String.fromCharCode(10)));
    mkdirSync(join(root, 'downloads'));
    writeFileSync(join(root, 'downloads', 'MICO360-Tasks.apk'), Buffer.from('PK-apk-bytes-v1'));
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

  it('marks private pages noindex and leaves the public pages indexable', async () => {
    for (const url of ['/dashboard', '/projects/p1/board', '/reset?token=abc']) {
      expect((await app.inject({ method: 'GET', url })).headers['x-robots-tag'], url).toBe('noindex, nofollow');
    }
    for (const url of ['/', '/login', '/privacy', '/terms']) {
      expect((await app.inject({ method: 'GET', url })).headers['x-robots-tag'], url).toBeUndefined();
    }
  });

  it('serves the hosted Android app as a download at its one address, always checked for a newer build', async () => {
    const res = await app.inject({ method: 'GET', url: HOSTED_APK_PATH });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.android.package-archive');
    expect(res.headers['content-disposition']).toBe('attachment; filename="MICO360-Tasks.apk"');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.rawPayload.toString()).toBe('PK-apk-bytes-v1');
    // A new release replaces the file in place: the same address serves the new bytes.
    writeFileSync(join(root, 'downloads', 'MICO360-Tasks.apk'), Buffer.from('PK-apk-bytes-v2-newer'));
    const next = await app.inject({ method: 'GET', url: HOSTED_APK_PATH });
    expect(next.rawPayload.toString()).toBe('PK-apk-bytes-v2-newer');
    const head = await app.inject({ method: 'HEAD', url: HOSTED_APK_PATH });
    expect(head.statusCode).toBe(200);
  });

  it('serves robots.txt from the web root as plain text', async () => {
    const res = await app.inject({ method: 'GET', url: '/robots.txt' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.body).toContain('Disallow: /api/');
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

  it('sends the compressed copy of an asset to browsers that accept it', async () => {
    const br = await app.inject({ method: 'GET', url: '/assets/big-def456.js', headers: { 'accept-encoding': 'gzip, deflate, br' } });
    expect(br.statusCode).toBe(200);
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.headers['content-type']).toContain('javascript');
    expect(br.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(String(br.headers.vary)).toMatch(/accept-encoding/i);
    expect(br.rawPayload.length).toBeLessThan(BIG_JS.length / 4);
    expect(brotliDecompressSync(br.rawPayload).toString()).toBe(BIG_JS);

    const gz = await app.inject({ method: 'GET', url: '/assets/big-def456.js', headers: { 'accept-encoding': 'gzip' } });
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gz.rawPayload).toString()).toBe(BIG_JS);
  });

  it('sends the plain file when the browser accepts no compression, or no compressed copy exists', async () => {
    const plain = await app.inject({ method: 'GET', url: '/assets/big-def456.js' });
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body).toBe(BIG_JS);

    const small = await app.inject({ method: 'GET', url: '/assets/app-abc123.js', headers: { 'accept-encoding': 'gzip, br' } });
    expect(small.statusCode).toBe(200);
    expect(small.headers['content-encoding']).toBeUndefined();
    expect(small.body).toBe('console.log(1)');
  });

  it('never offers the compressed copies as downloads of their own', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/big-def456.js.br' });
    expect(res.statusCode).toBe(404);
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
