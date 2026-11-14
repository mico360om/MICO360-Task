import type { FastifyInstance, FastifyReply } from 'fastify';
import { uploadResponseHeaders } from '../../lib/upload-safety';
import { isClientRoles } from '../clients/client-kind';
import type { UserState } from '../auth/auth-guard';
import type { FileLinks } from './file-links';
import type { FileAccess } from './file-access';

/**
 * 1.23.29 Private file links (design §7.2): GET /uploads/:file (Fastify adds HEAD) replaces the open folder.
 *
 *   1. the name: one plain file name (no path, no `..`, no backslash, no NUL, no `%`, at most 200 characters)
 *   2. what it is (file-access.ts): protected, public or unknown (404)
 *   3. public (a current photo, project picture or logo): sent as before, no link asked for
 *   4. protected: the link's parts and expiry (no database), the account (active, not a client; the guard's
 *      cache), the signature with the account's session version, then whether the person can see the task
 *      or conversation now. Refused: one short page that never says why (403, no-store).
 *
 * Files go out through @fastify/static's sendFile, so ETag, 304, Range/206 and streaming are as before —
 * and only after the check, so a removed member never gets a 304. Headers are today's (nosniff, a sandbox
 * CSP, `private, no-cache`, a download for anything but a raster picture); app.ts adds CORP cross-origin
 * (the extension and another origin's website show them) and noindex for every /uploads answer.
 */
export interface UploadsDeps {
  /** The uploads folder. */
  root: string;
  links: FileLinks;
  access: FileAccess;
  /** The account behind a link (the auth guard's accountState: the same 10-second cache as the API). */
  accountState: (userId: string, opts?: { fresh?: boolean }) => Promise<UserState | null>;
  /** The website's address, for the plain page's way back (optional). */
  appUrl?: string;
  productName?: string;
  /**
   * Review (1.23.29): /uploads has no API rate limit, so one address may get at most this many answers a
   * minute that cost the server work for nothing — an unknown name (404) or a link that was refused (403) —
   * before it waits out the minute (429). Plain unsigned addresses (pages opened before the change) don't
   * count. Default 120.
   */
  refusalsPerMinute?: number;
  now?: () => number;
}

const MAX_NAME = 200;
/** The names this server stores: a random UUID, and an extension (v0.1.0 kept the uploader's own). */
const STORED_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.[^/\\%\0]{1,40})?$/i;
const MINUTE = 60_000;
/** Most addresses whose refusals are counted at once (the oldest go first). */
const MAX_COUNTED = 10_000;
/** How many session versions newer than the remembered one a signature is tried with (no database read). */
const NEWER_VERSIONS = 5;

/** The stored name a request asks for, or null for anything that isn't one plain file name. */
export function storedName(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_NAME) return null;
  if (/[/\\%\0]/.test(raw) || raw.includes('..')) return null;
  // Only a name this server could have stored is looked up (anything else never reaches the database).
  return STORED_KEY.test(raw) ? raw : null;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The plain page for every refused task or chat file link: no script, nothing from elsewhere, never says why. */
export function noLongerWorksPage(opts: { appUrl?: string; productName?: string } = {}): string {
  const product = escapeHtml(opts.productName || 'MICO360 Tasks');
  const home = opts.appUrl && /^https?:\/\//i.test(opts.appUrl) ? `<p><a href="${escapeHtml(opts.appUrl.replace(/\/+$/, ''))}/">Open ${product}</a></p>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>This file link no longer works</title>
<style>
/* The website's own colours (index.css): light, and dark when the device prefers it. */
:root{color-scheme:light dark;--bg:rgb(244 242 240);--card:rgb(255 255 255);--ink:rgb(33 27 26);--ink2:rgb(108 98 95);--brand:rgb(139 30 30);--line:rgb(230 223 220)}
@media (prefers-color-scheme:dark){:root{--bg:rgb(24 20 19);--card:rgb(36 31 29);--ink:rgb(244 240 238);--ink2:rgb(178 168 163);--brand:rgb(224 122 102);--line:rgb(58 50 47)}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{box-sizing:border-box;width:min(28rem,calc(100% - 32px));margin:16px;padding:24px;border:1px solid var(--line);border-radius:12px;background:var(--card)}
h1{margin:0 0 8px;font-size:1.25rem;line-height:1.3}
p{margin:8px 0 0;color:var(--ink2)}
a{display:inline-block;min-height:44px;line-height:44px;color:var(--brand);font-weight:600}
</style>
</head>
<body>
<main>
<h1>This file link no longer works</h1>
<p>Open the task or chat in ${product} to get the file.</p>
<p>If you can no longer see it, ask the project’s manager.</p>
${home}
</main>
</body>
</html>
`;
}

/** Per address: answers this minute that cost work for nothing (see UploadsDeps.refusalsPerMinute). */
function refusalCounter(max: number, now: () => number) {
  const seen = new Map<string, { start: number; count: number }>();
  return {
    blocked(ip: string): boolean {
      const e = seen.get(ip);
      return !!e && now() - e.start < MINUTE && e.count >= max;
    },
    count(ip: string): void {
      const t = now();
      let e = seen.get(ip);
      if (!e || t - e.start >= MINUTE) {
        seen.delete(ip);
        while (seen.size >= MAX_COUNTED) seen.delete(seen.keys().next().value!);
        e = { start: t, count: 0 };
        seen.set(ip, e);
      }
      e.count += 1;
    },
  };
}

/** Registers the uploads folder's file route (and the reply's sendFile, which the web app's static files use too). */
export async function registerUploads(app: FastifyInstance, deps: UploadsDeps): Promise<void> {
  const { default: fastifyStatic } = await import('@fastify/static');
  await app.register(fastifyStatic, {
    root: deps.root,
    // Nothing is served from the folder by itself any more: only through the route below, after its check.
    serve: false,
    setHeaders: (reply, filePath) => {
      for (const [name, value] of Object.entries(uploadResponseHeaders(filePath))) reply.header(name, value);
    },
  });

  const page = noLongerWorksPage({ appUrl: deps.appUrl, productName: deps.productName });
  const refusals = refusalCounter(deps.refusalsPerMinute ?? 120, deps.now ?? (() => Date.now()));
  const notFound = (reply: FastifyReply) => reply.code(404).header('Cache-Control', 'no-store').send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  const refused = (reply: FastifyReply) =>
    reply
      .code(403)
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
      .header('Referrer-Policy', 'no-referrer')
      .type('text/html; charset=utf-8')
      .send(page);

  /** The account a link names, if its signature holds for that account's session version now. */
  async function signer(key: string, link: NonNullable<ReturnType<FileLinks['parse']>>): Promise<UserState | null> {
    const usable = (s: UserState | null): s is UserState => !!s && s.active && !isClientRoles(s.roles);
    const state = await deps.accountState(link.u);
    if (!usable(state)) return null;
    if (deps.links.verify(key, link, state.tokenVersion)) return state;
    // Signed for a newer session than the remembered account (a password changed a moment ago)? Versions only
    // grow: try the next few with no database read, and read the account again only when one of them matches.
    for (let v = state.tokenVersion + 1; v <= state.tokenVersion + NEWER_VERSIONS; v++) {
      if (!deps.links.verify(key, link, v)) continue;
      const now = await deps.accountState(link.u, { fresh: true });
      return usable(now) && now.tokenVersion === v ? now : null;
    }
    return null;
  }

  app.get('/uploads/:file', async (req, reply) => {
    const ip = req.ip;
    if (refusals.blocked(ip)) {
      return reply.code(429).header('Cache-Control', 'no-store').header('Retry-After', '60').send({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } });
    }
    const key = storedName((req.params as { file?: unknown }).file);
    if (!key) {
      refusals.count(ip);
      return notFound(reply);
    }
    const kind = await deps.access.classify(key);
    if (kind.kind === 'unknown') {
      refusals.count(ip);
      return notFound(reply);
    }
    if (kind.kind === 'public') return reply.sendFile(key);
    // A task's or a chat's file: the cheap checks first, then the account, then the access queries.
    const link = deps.links.parse(req.query);
    if (!link || !deps.links.fresh(link)) return refused(reply);
    const account = await signer(key, link);
    if (!account || !(await deps.access.mayOpen({ id: link.u, roles: account.roles }, kind))) {
      refusals.count(ip); // a link was tried and refused: it cost the account read (and the access check)
      return refused(reply);
    }
    return reply.sendFile(key);
  });
}
