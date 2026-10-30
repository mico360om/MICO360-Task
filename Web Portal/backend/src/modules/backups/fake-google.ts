import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for Google's sign-in (OAuth 2.0) and Drive v3 servers, for tests only: the token
 * exchange and refresh, revoking, "about", folders, resumable uploads, listing and deleting. It
 * listens on 127.0.0.1 and lets a test drop a chunk, fill the Drive, or take the access back.
 * Never used by the running app (BACKUP_GOOGLE_TEST_BASE_URL is ignored in production).
 */

export interface FakeDriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  createdTime: string;
  trashed: boolean;
  content: Buffer;
}

interface UploadSession {
  meta: Partial<FakeDriveFile>;
  total: number;
  received: Buffer[];
  length: number;
}

export interface FakeGoogle {
  base: string;
  clientId: string;
  clientSecret: string;
  email: string;
  files: Map<string, FakeDriveFile>;
  /** Every sign-in page request (to check the scope and the other settings). */
  authRequests: URLSearchParams[];
  /** Refresh tokens taken back (revoked) by the owner or by the app. */
  revoked: Set<string>;
  /** The next upload chunk is dropped: 'drop' closes the connection, 503 answers an error. */
  failNextChunk(how: 'drop' | 503): void;
  /** Every upload chunk is answered 308 "resume incomplete" without being kept (no progress, ever). */
  stallUploads(stall: boolean): void;
  /** How many such answers were given. */
  readonly stalledAnswers: number;
  /** Drive answers "storage quota exceeded" to new uploads. */
  setFull(full: boolean): void;
  /** The sign-in page answers "access denied" (the person pressed Cancel). */
  setDeny(deny: boolean): void;
  /** Takes back every token (as if the owner removed the app's access in their Google account). */
  revokeAll(): void;
  /** Every access token given so far runs out (the refresh tokens still work). */
  expireAccess(): void;
  addFile(f: Partial<FakeDriveFile> & { name: string }): FakeDriveFile;
  close(): Promise<void>;
}

async function body(req: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of req) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

function json(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}

function pick(file: FakeDriveFile, fields: string | null): Record<string, unknown> {
  const all: Record<string, unknown> = {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: file.parents,
    appProperties: file.appProperties,
    createdTime: file.createdTime,
    trashed: file.trashed,
    size: String(file.content.length),
    md5Checksum: createHash('md5').update(file.content).digest('hex'),
  };
  if (!fields) return { id: file.id, name: file.name, mimeType: file.mimeType };
  const wanted = fields.replace(/^files\(|\)$/g, '').split(',').map((f) => f.trim());
  return Object.fromEntries(wanted.filter((f) => f in all).map((f) => [f, all[f]]));
}

/** The handful of Drive query forms the app uses. */
function matches(file: FakeDriveFile, q: string): boolean {
  for (const clause of q.split(/\s+and\s+/i)) {
    let m: RegExpMatchArray | null;
    if ((m = clause.match(/^name\s*=\s*'((?:\\'|[^'])*)'$/))) {
      if (file.name !== m[1]!.replace(/\\'/g, "'")) return false;
    } else if ((m = clause.match(/^mimeType\s*=\s*'([^']*)'$/))) {
      if (file.mimeType !== m[1]) return false;
    } else if ((m = clause.match(/^trashed\s*=\s*(true|false)$/))) {
      if (file.trashed !== (m[1] === 'true')) return false;
    } else if ((m = clause.match(/^'([^']+)'\s+in\s+parents$/))) {
      if (!file.parents.includes(m[1]!)) return false;
    } else if (clause.trim()) {
      throw new Error(`fake Google: unsupported query clause ${clause}`);
    }
  }
  return true;
}

export async function startFakeGoogle(opts: { email?: string; clientId?: string; clientSecret?: string; port?: number } = {}): Promise<FakeGoogle> {
  const clientId = opts.clientId ?? 'fake-client-id.apps.googleusercontent.com';
  const clientSecret = opts.clientSecret ?? 'fake-client-secret';
  const email = opts.email ?? 'owner@gmail.com';
  const files = new Map<string, FakeDriveFile>();
  const codes = new Map<string, string>(); // code → redirect_uri
  const refreshTokens = new Set<string>();
  const accessTokens = new Map<string, string>(); // access → refresh
  const revoked = new Set<string>();
  const sessions = new Map<string, UploadSession>();
  const authRequests: URLSearchParams[] = [];
  let failNext: 'drop' | 503 | null = null;
  let stalled = false;
  let stalledAnswers = 0;
  let full = false;
  let deny = false;
  let base = '';
  const id = () => randomBytes(9).toString('base64url');

  function authed(req: IncomingMessage, res: ServerResponse): boolean {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const refresh = accessTokens.get(token);
    if (!refresh || revoked.has(refresh)) {
      json(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.', errors: [{ reason: 'authError' }] } });
      return false;
    }
    return true;
  }

  function addFile(f: Partial<FakeDriveFile> & { name: string }): FakeDriveFile {
    const file: FakeDriveFile = {
      id: f.id ?? id(),
      name: f.name,
      mimeType: f.mimeType ?? 'application/octet-stream',
      parents: f.parents ?? [],
      appProperties: f.appProperties ?? {},
      createdTime: f.createdTime ?? new Date().toISOString(),
      trashed: f.trashed ?? false,
      content: f.content ?? Buffer.alloc(0),
    };
    files.set(file.id, file);
    return file;
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', base);
      const path = url.pathname;
      try {
        // ── Sign-in page: answers at once, as if the person pressed Allow (or Cancel).
        if (req.method === 'GET' && path === '/o/oauth2/v2/auth') {
          authRequests.push(url.searchParams);
          const back = new URL(url.searchParams.get('redirect_uri') ?? '');
          back.searchParams.set('state', url.searchParams.get('state') ?? '');
          if (deny || url.searchParams.get('client_id') !== clientId) back.searchParams.set('error', 'access_denied');
          else {
            const code = `code-${id()}`;
            codes.set(code, url.searchParams.get('redirect_uri') ?? '');
            back.searchParams.set('code', code);
          }
          res.writeHead(302, { location: back.toString() });
          return res.end();
        }
        if (req.method === 'POST' && path === '/token') {
          const form = new URLSearchParams((await body(req)).toString('utf8'));
          if (form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) return json(res, 401, { error: 'invalid_client' });
          if (form.get('grant_type') === 'authorization_code') {
            const code = form.get('code') ?? '';
            if (!codes.has(code) || codes.get(code) !== form.get('redirect_uri')) return json(res, 400, { error: 'invalid_grant', error_description: 'Bad code.' });
            codes.delete(code);
            const refresh = `refresh-${id()}`;
            const access = `access-${id()}`;
            refreshTokens.add(refresh);
            accessTokens.set(access, refresh);
            return json(res, 200, { access_token: access, expires_in: 3599, refresh_token: refresh, scope: 'https://www.googleapis.com/auth/drive.file', token_type: 'Bearer' });
          }
          if (form.get('grant_type') === 'refresh_token') {
            const refresh = form.get('refresh_token') ?? '';
            if (!refreshTokens.has(refresh) || revoked.has(refresh)) return json(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
            const access = `access-${id()}`;
            accessTokens.set(access, refresh);
            return json(res, 200, { access_token: access, expires_in: 3599, scope: 'https://www.googleapis.com/auth/drive.file', token_type: 'Bearer' });
          }
          return json(res, 400, { error: 'unsupported_grant_type' });
        }
        if (req.method === 'POST' && path === '/revoke') {
          const token = url.searchParams.get('token') ?? new URLSearchParams((await body(req)).toString('utf8')).get('token') ?? '';
          revoked.add(accessTokens.get(token) ?? token);
          return json(res, 200, {});
        }

        // ── Drive
        if (path === '/drive/v3/about' && req.method === 'GET') {
          if (!authed(req, res)) return;
          return json(res, 200, { user: { emailAddress: email, displayName: 'The Owner' } });
        }
        if (path === '/drive/v3/files' && req.method === 'GET') {
          if (!authed(req, res)) return;
          const q = url.searchParams.get('q') ?? '';
          const list = [...files.values()].filter((f) => matches(f, q));
          const fields = /files\(([^)]*)\)/.exec(url.searchParams.get('fields') ?? '')?.[1] ?? null;
          return json(res, 200, { files: list.map((f) => pick(f, fields)) });
        }
        if (path === '/drive/v3/files' && req.method === 'POST') {
          if (!authed(req, res)) return;
          const meta = JSON.parse((await body(req)).toString('utf8') || '{}') as Partial<FakeDriveFile>;
          const f = addFile({ name: meta.name ?? 'Untitled', mimeType: meta.mimeType, parents: meta.parents, appProperties: meta.appProperties });
          return json(res, 200, { id: f.id });
        }
        const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(path);
        if (one) {
          if (!authed(req, res)) return;
          const f = files.get(one[1]!);
          if (!f) return json(res, 404, { error: { code: 404, message: 'File not found.', errors: [{ reason: 'notFound' }] } });
          if (req.method === 'GET') return json(res, 200, pick(f, url.searchParams.get('fields') ?? 'id,name,trashed'));
          if (req.method === 'DELETE') {
            files.delete(f.id);
            res.writeHead(204);
            return res.end();
          }
        }

        // ── Resumable uploads
        if (path === '/upload/drive/v3/files' && req.method === 'POST' && url.searchParams.get('uploadType') === 'resumable') {
          if (!authed(req, res)) return;
          if (full) return json(res, 403, { error: { code: 403, message: 'The user’s Drive storage quota has been exceeded.', errors: [{ reason: 'storageQuotaExceeded' }] } });
          const meta = JSON.parse((await body(req)).toString('utf8') || '{}') as Partial<FakeDriveFile>;
          const sid = id();
          sessions.set(sid, { meta, total: Number(req.headers['x-upload-content-length'] ?? -1), received: [], length: 0 });
          res.writeHead(200, { location: `${base}/upload/drive/v3/files?uploadType=resumable&upload_id=${sid}` });
          return res.end();
        }
        if (path === '/upload/drive/v3/files' && req.method === 'PUT') {
          const s = sessions.get(url.searchParams.get('upload_id') ?? '');
          if (!s) return json(res, 404, { error: { code: 404, message: 'Upload session not found.' } });
          const data = await body(req);
          const range = String(req.headers['content-range'] ?? '');
          const finish = () => {
            const f = addFile({ name: s.meta.name ?? 'Untitled', mimeType: s.meta.mimeType, parents: s.meta.parents, appProperties: s.meta.appProperties, content: Buffer.concat(s.received) });
            sessions.delete(url.searchParams.get('upload_id')!);
            return json(res, 200, pick(f, 'id,name,size,md5Checksum'));
          };
          const status = /^bytes \*\/(\d+)$/.exec(range);
          if (status) {
            if (s.length === Number(status[1]) && s.total === s.length) return finish();
            res.writeHead(308, s.length ? { range: `bytes=0-${s.length - 1}` } : {});
            return res.end();
          }
          const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
          if (!m) return json(res, 400, { error: { code: 400, message: 'Bad Content-Range.' } });
          if (failNext) {
            const how = failNext;
            failNext = null;
            if (how === 'drop') return req.socket.destroy();
            return json(res, 503, { error: { code: 503, message: 'Backend Error' } });
          }
          if (stalled) {
            // "Resume incomplete", but nothing was kept: the upload never gets further.
            stalledAnswers += 1;
            res.writeHead(308, s.length ? { range: `bytes=0-${s.length - 1}` } : {});
            return res.end();
          }
          const start = Number(m[1]);
          if (start !== s.length) {
            // Out of step: say what we have.
            res.writeHead(308, s.length ? { range: `bytes=0-${s.length - 1}` } : {});
            return res.end();
          }
          s.received.push(data);
          s.length += data.length;
          if (s.length >= Number(m[3])) return finish();
          res.writeHead(308, { range: `bytes=0-${s.length - 1}` });
          return res.end();
        }
        json(res, 404, { error: { code: 404, message: `fake Google: no route ${req.method} ${path}` } });
      } catch (err) {
        json(res, 500, { error: { code: 500, message: (err as Error).message } });
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    base,
    clientId,
    clientSecret,
    email,
    files,
    authRequests,
    revoked,
    failNextChunk: (how) => {
      failNext = how;
    },
    stallUploads: (v) => {
      stalled = v;
    },
    get stalledAnswers() {
      return stalledAnswers;
    },
    setFull: (v) => {
      full = v;
    },
    setDeny: (v) => {
      deny = v;
    },
    revokeAll: () => {
      for (const r of refreshTokens) revoked.add(r);
    },
    expireAccess: () => accessTokens.clear(),
    addFile,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

