import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

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

/**
 * The "Download for Android" link: the configured one, else the APK this web root hosts, else null
 * (the web app then offers the hosted address anyway, and asks the site whether the file is there).
 */
export function androidAppLink(configured: string, webRoot: string | null): string | null {
  if (configured.trim()) return configured.trim();
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

export async function registerWebApp(app: FastifyInstance, opts: { root: string }): Promise<void> {
  const { default: fastifyStatic } = await import('@fastify/static');
  const indexHtml = readFileSync(join(opts.root, 'index.html'));

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
      if (reply.request.url.split('?')[0] === HOSTED_APK_PATH) reply.header('Content-Disposition', 'attachment; filename="MICO360-Tasks.apk"');
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
    return reply.code(200).header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send(indexHtml);
  };

  // The static wildcard would answer "/" with a directory 403.
  app.get('/', (req, reply) => sendIndex(req, reply));

  app.setNotFoundHandler((req, reply) => {
    if (isClientRoute(req.method, req.url)) return sendIndex(req, reply);
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });
}
