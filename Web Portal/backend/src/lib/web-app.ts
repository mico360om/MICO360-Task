import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * The folder for the hosted APK that deploys keep: DOWNLOADS_DIR, else `downloads` beside the
 * uploads folder (on the live site ~/mico360-data/downloads, next to ~/mico360-data/uploads).
 */
export function downloadsDirFor(env: { UPLOAD_DIR: string; DOWNLOADS_DIR: string }, cwd: string): string {
  if (env.DOWNLOADS_DIR.trim()) return resolve(cwd, env.DOWNLOADS_DIR.trim());
  return join(dirname(resolve(cwd, env.UPLOAD_DIR)), 'downloads');
}

/**
 * Optional hosting of the built web app (WEB_ROOT) by the API server itself — used by the
 * self-contained Windows server, where no nginx sits in front. Mirrors deploy/nginx: hashed
 * assets are cached for a year, index.html is always revalidated, every page gets the same
 * security headers, and unknown client-side routes (/board/123) fall back to index.html.
 */

/**
 * Where a hosted copy of the Android app lives in the web root (the release packages put it there).
 * One address for every release: a new build replaces the file, and the sign-in page's "Download
 * for Android" button always points here (the web app's lib/android-app-link.ts says the same).
 */
export const HOSTED_APK_PATH = '/downloads/MICO360-Tasks.apk';

/** The APK's file name, in the downloads folder and in the web root's downloads/. */
const APK_FILE = HOSTED_APK_PATH.slice(HOSTED_APK_PATH.lastIndexOf('/') + 1);

/**
 * The "Download for Android" link: the configured one, else the APK this server hosts (in the
 * downloads folder kept across deploys, or in the web root), else null (the web app then offers the
 * hosted address anyway, and asks the site whether the file is there).
 */
export function androidAppLink(configured: string, webRoot: string | null, downloadsDir?: string | null): string | null {
  if (configured.trim()) return configured.trim();
  if (downloadsDir && existsSync(join(downloadsDir, APK_FILE))) return HOSTED_APK_PATH;
  if (webRoot && existsSync(join(webRoot, ...HOSTED_APK_PATH.split('/').filter(Boolean)))) return HOSTED_APK_PATH;
  return null;
}

/** Paths owned by the API; they never fall back to the web app. */
const SERVER_PREFIXES = ['/api/', '/socket.io/', '/uploads/', '/email-assets/'];

/** Host header values safe to echo into the CSP (host, IPv4, [IPv6], optional port). */
const SAFE_HOST = /^[a-z0-9.-]+(:\d{1,5})?$|^\[[0-9a-f:.]+\](:\d{1,5})?$/i;

/** The page CSP; the realtime socket is same-origin, named explicitly for older browsers. */
export function webAppCsp(host: string | undefined): string {
  const ws = host && SAFE_HOST.test(host) ? ` ws://${host} wss://${host}` : '';
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    `connect-src 'self'${ws}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join('; ');
}

/** Whether a request may be answered with index.html (a client-side route). */
export function isClientRoute(method: string, url: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const path = url.split('?')[0]!;
  if (SERVER_PREFIXES.some((p) => path.startsWith(p) || path === p.slice(0, -1))) return false;
  // A missing file (/logo.png, /assets/x.js) is a real 404, not a page.
  const last = path.slice(path.lastIndexOf('/') + 1);
  return !last.includes('.') || last.endsWith('.html');
}

/** Pages a search engine may list: the site root (it shows the sign-in page), sign-in, privacy and terms. */
const INDEXABLE_PAGES = new Set(['/', '/login', '/privacy', '/terms']);

/**
 * The X-Robots-Tag for a page: null for the public pages, `noindex, nofollow` for everything else —
 * the signed-in pages, and password-recovery links (/reset carries a token in its address).
 * The web app sets the same rule in its robots meta tag; deploy/ has it for nginx and Hostinger.
 */
export function robotsTagFor(url: string): string | null {
  const path = url.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  return INDEXABLE_PAGES.has(path) ? null : 'noindex, nofollow';
}

/** A pre-compressed copy written by the web build (see the frontend's vite.config). */
const COMPRESSED_COPY = /\.(br|gz)$/i;

/** Cache policy for a web-app file: hashed build assets are immutable, everything else revalidates. */
export function cacheControlFor(url: string): string {
  return url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
}

function applyPageHeaders(req: FastifyRequest, reply: FastifyReply): void {
  reply.header('Content-Security-Policy', webAppCsp(req.headers.host));
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
}

/** Headers for the hosted APK: a download under its own name, always checked for a newer build. */
function apkHeaders(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-cache');
  reply.header('Content-Disposition', `attachment; filename="${APK_FILE}"`);
}

/**
 * `downloadsDir`: a folder outside the web root that deploys don't replace (on Hostinger the web
 * root is rebuilt by every Git deploy). The APK there is served at HOSTED_APK_PATH before any copy
 * in the web root; nothing else in that folder is served.
 */
export async function registerWebApp(app: FastifyInstance, opts: { root: string; downloadsDir?: string }): Promise<void> {
  const { default: fastifyStatic } = await import('@fastify/static');
  if (opts.downloadsDir) {
    const roots = [opts.downloadsDir, join(opts.root, 'downloads')];
    await app.register(async (scope) => {
      await scope.register(fastifyStatic, {
        root: roots,
        prefix: '/downloads/',
        decorateReply: false,
        index: false,
        cacheControl: false,
        allowedPath: (pathName) => pathName === `/${APK_FILE}`,
        setHeaders: (reply) => apkHeaders(reply),
      });
    });
  }
  // The start page names the build's asset files, so it is re-read whenever a new build replaces it:
  // a web app rebuilt in place is served at once, never an old page pointing at removed files.
  const indexFile = join(opts.root, 'index.html');
  let index = { mtimeMs: statSync(indexFile).mtimeMs, html: readFileSync(indexFile) };
  const indexHtml = (): Buffer => {
    try {
      const mtimeMs = statSync(indexFile).mtimeMs;
      if (mtimeMs !== index.mtimeMs) index = { mtimeMs, html: readFileSync(indexFile) };
    } catch {
      // Mid-deployment (the file is being replaced): keep serving the last good copy.
    }
    return index.html;
  };

  await app.register(fastifyStatic, {
    root: opts.root,
    prefix: '/',
    // /uploads/ registered the reply decorators already.
    decorateReply: false,
    // index.html is sent by the fallback below so it always gets the page headers.
    index: false,
    cacheControl: false,
    // The web build writes a .br and a .gz copy next to each large text file. A browser that accepts
    // one gets it (about a third of the bytes); when there is no copy the plain file is sent. This
    // matters where nothing in front of the API compresses for it (the Windows server install).
    preCompressed: true,
    // The copies are an encoding of a file, never a file to ask for by name.
    allowedPath: (pathName) => !COMPRESSED_COPY.test(pathName),
    setHeaders: (reply) => {
      reply.header('Cache-Control', cacheControlFor(reply.request.url));
      // The Android app downloads under its own name from any link (a shared one too), as nginx and
      // the Hostinger rules send it.
      if (reply.request.url.split('?')[0] === HOSTED_APK_PATH) apkHeaders(reply);
    },
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.startsWith('text/html')) applyPageHeaders(req, reply);
    return payload;
  });

  const sendIndex = (req: FastifyRequest, reply: FastifyReply) => {
    const robots = robotsTagFor(req.url);
    if (robots) reply.header('X-Robots-Tag', robots);
    return reply.code(200).header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send(indexHtml());
  };

  // The static wildcard would answer "/" with a directory 403.
  app.get('/', (req, reply) => sendIndex(req, reply));

  app.setNotFoundHandler((req, reply) => {
    if (isClientRoute(req.method, req.url)) return sendIndex(req, reply);
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });
}
