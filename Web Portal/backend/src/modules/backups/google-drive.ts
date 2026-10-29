import { open } from 'node:fs/promises';

/**
 * Google sign-in (OAuth 2.0) and the few Drive v3 calls the backups need, with plain fetch (no Google
 * library: it is large for ~8 calls). The app asks only for `drive.file`: it can see and change only
 * the files it made itself. Copies go up with resumable uploads in 8 MB pieces, so a lost connection
 * picks up where Drive got to.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const FOLDER_NAME = 'MICO360 Tasks backups';
const FOLDER_TYPE = 'application/vnd.google-apps.folder';

export interface GoogleUrls {
  auth: string;
  token: string;
  revoke: string;
  drive: string;
  upload: string;
}

/** Google's addresses, or a test stand-in's (`testBase`, never in production). */
export function googleUrls(testBase?: string): GoogleUrls {
  if (testBase) {
    const b = testBase.replace(/\/+$/, '');
    return { auth: `${b}/o/oauth2/v2/auth`, token: `${b}/token`, revoke: `${b}/revoke`, drive: `${b}/drive/v3`, upload: `${b}/upload/drive/v3` };
  }
  return {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    revoke: 'https://oauth2.googleapis.com/revoke',
    drive: 'https://www.googleapis.com/drive/v3',
    upload: 'https://www.googleapis.com/upload/drive/v3',
  };
}

export type DriveErrorKind = 'auth' | 'full' | 'network' | 'http';

export class DriveError extends Error {
  constructor(
    readonly kind: DriveErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

/** A Drive problem in words for System Settings and the email. */
export function plainDriveError(err: unknown): string {
  if (err instanceof DriveError) {
    if (err.kind === 'auth') return 'Google Drive no longer accepts this connection. Connect it again in System Settings → Backups.';
    if (err.kind === 'full') return 'Google Drive is full.';
    if (err.kind === 'network') return 'Google Drive couldn’t be reached.';
    return err.status ? `Google Drive refused the copy (error ${err.status}).` : err.message;
  }
  if (err instanceof Error && /isn’t set up|not connected/i.test(err.message)) return err.message;
  return 'The copy couldn’t be sent to Google Drive (the server log has the details).';
}

export interface DriveFileInfo {
  id: string;
  name: string;
  createdTime: string;
  appProperties: Record<string, string>;
}

export interface GoogleDriveOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  urls: GoogleUrls;
  /** Upload piece size: a multiple of 256 KB (8 MB). */
  chunkSize?: number;
  /** The first wait before a retry (doubles each time). */
  retryDelayMs?: number;
  fetch?: typeof fetch;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function errorFrom(res: Response): Promise<DriveError> {
  let reason = '';
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: string | { message?: string; errors?: { reason?: string }[]; status?: string }; error_description?: string };
    if (typeof body.error === 'string') {
      reason = body.error;
      message = body.error_description ?? body.error;
    } else if (body.error) {
      reason = body.error.errors?.[0]?.reason ?? body.error.status ?? '';
      message = body.error.message ?? message;
    }
  } catch {
    /* not JSON */
  }
  if (res.status === 401 || reason === 'invalid_grant' || reason === 'unauthorized_client' || reason === 'authError') return new DriveError('auth', message, res.status);
  if (reason === 'storageQuotaExceeded' || reason === 'quotaExceeded') return new DriveError('full', message, res.status);
  return new DriveError('http', message, res.status);
}

const retryable = (status: number) => status === 429 || status >= 500;

export function createGoogleDrive(opts: GoogleDriveOptions) {
  const f = opts.fetch ?? fetch;
  const chunkSize = opts.chunkSize ?? 8 * 1024 * 1024;
  const delay = opts.retryDelayMs ?? 1000;
  const cache = new Map<string, { token: string; until: number }>();

  async function call(url: string, init: RequestInit, timeoutMs = 60_000): Promise<Response> {
    try {
      return await f(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new DriveError('network', 'Google could not be reached.');
    }
  }

  /** A call with up to 3 tries on a lost connection, 429 or a server error. */
  async function withRetry(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      let res: Response | null = null;
      try {
        res = await call(url, init);
      } catch (err) {
        if (attempt >= 3) throw err;
      }
      if (res && (!retryable(res.status) || attempt >= 3)) return res;
      await sleep(delay * 2 ** attempt);
    }
  }

  async function tokenRequest(form: Record<string, string>): Promise<{ access_token: string; expires_in?: number; refresh_token?: string }> {
    const res = await withRetry(opts.urls.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: opts.clientId, client_secret: opts.clientSecret, ...form }).toString(),
    });
    if (!res.ok) throw await errorFrom(res);
    return (await res.json()) as { access_token: string; expires_in?: number; refresh_token?: string };
  }

  async function api<T>(access: string, method: string, path: string, query: Record<string, string> = {}, json?: unknown): Promise<T> {
    const url = `${opts.urls.drive}${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`;
    const res = await withRetry(url, {
      method,
      headers: { authorization: `Bearer ${access}`, ...(json !== undefined ? { 'content-type': 'application/json; charset=UTF-8' } : {}) },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    if (res.status === 204) return undefined as T;
    if (!res.ok) throw await errorFrom(res);
    return (await res.json()) as T;
  }

  /** How far a resumable upload got: the next byte to send, or done. */
  async function uploadStatus(session: string, size: number): Promise<{ done: { id: string; md5Checksum?: string } | null; offset: number }> {
    const res = await call(session, { method: 'PUT', headers: { 'content-range': `bytes */${size}` }, body: new Uint8Array(0) });
    if (res.status === 200 || res.status === 201) return { done: (await res.json()) as { id: string; md5Checksum?: string }, offset: size };
    if (res.status === 308) return { done: null, offset: nextOffset(res) };
    if (res.status === 404 || res.status === 410) throw new SessionLost();
    throw await errorFrom(res);
  }

  return {
    /** The Google sign-in page for an administrator to allow access. */
    authUrl(state: string): string {
      const q = new URLSearchParams({
        client_id: opts.clientId,
        redirect_uri: opts.redirectUri,
        response_type: 'code',
        scope: DRIVE_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'false',
        state,
      });
      return `${opts.urls.auth}?${q}`;
    },

    async exchangeCode(code: string): Promise<{ refreshToken: string; accessToken: string }> {
      const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: opts.redirectUri });
      if (!t.refresh_token) throw new DriveError('auth', 'Google did not give a lasting connection. Try connecting again.');
      cache.set(t.refresh_token, { token: t.access_token, until: Date.now() + ((t.expires_in ?? 3600) - 60) * 1000 });
      return { refreshToken: t.refresh_token, accessToken: t.access_token };
    },

    /** A working access token for the connection (kept until a minute before it runs out). */
    async accessToken(refreshToken: string): Promise<string> {
      const hit = cache.get(refreshToken);
      if (hit && hit.until > Date.now()) return hit.token;
      const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
      cache.set(refreshToken, { token: t.access_token, until: Date.now() + ((t.expires_in ?? 3600) - 60) * 1000 });
      return t.access_token;
    },

    forget(refreshToken: string): void {
      cache.delete(refreshToken);
    },

    async about(access: string): Promise<{ email: string | null; name: string | null }> {
      const r = await api<{ user?: { emailAddress?: string; displayName?: string } }>(access, 'GET', '/about', { fields: 'user(displayName,emailAddress)' });
      return { email: r.user?.emailAddress ?? null, name: r.user?.displayName ?? null };
    },

    /** The backups folder: the stored one while it is there, else one found by name, else a new one. */
    async ensureFolder(access: string, folderId: string | null): Promise<string> {
      if (folderId) {
        try {
          const f = await api<{ id: string; trashed?: boolean }>(access, 'GET', `/files/${encodeURIComponent(folderId)}`, { fields: 'id,trashed' });
          if (!f.trashed) return f.id;
        } catch (err) {
          if (!(err instanceof DriveError && err.status === 404)) throw err;
        }
      }
      const found = await api<{ files: { id: string }[] }>(access, 'GET', '/files', {
        q: `name = '${FOLDER_NAME}' and mimeType = '${FOLDER_TYPE}' and trashed = false`,
        fields: 'files(id,name)',
        spaces: 'drive',
      });
      if (found.files[0]) return found.files[0].id;
      return (await api<{ id: string }>(access, 'POST', '/files', { fields: 'id' }, { name: FOLDER_NAME, mimeType: FOLDER_TYPE })).id;
    },

    /** Upload a file with a resumable upload, checked by its MD5 at the end. */
    async upload(access: string, file: { path: string; name: string; folderId: string; sizeBytes: number; md5: string; appProperties: Record<string, string> }): Promise<{ id: string }> {
      for (let attempt = 1; ; attempt++) {
        const start = await call(`${opts.urls.upload}/files?uploadType=resumable&fields=id,name,size,md5Checksum`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${access}`,
            'content-type': 'application/json; charset=UTF-8',
            'x-upload-content-type': 'application/octet-stream',
            'x-upload-content-length': String(file.sizeBytes),
          },
          body: JSON.stringify({ name: file.name, parents: [file.folderId], appProperties: file.appProperties }),
        });
        if (!start.ok) throw await errorFrom(start);
        const session = start.headers.get('location');
        if (!session) throw new DriveError('http', 'Google Drive did not start the upload.', start.status);
        try {
          const done = await sendPieces(session, file.path, file.sizeBytes);
          if (done.md5Checksum && done.md5Checksum !== file.md5) {
            await api(access, 'DELETE', `/files/${encodeURIComponent(done.id)}`).catch(() => undefined);
            throw new DriveError('http', 'Google Drive’s copy did not match the file on the server.');
          }
          return { id: done.id };
        } catch (err) {
          if (err instanceof SessionLost && attempt < 2) continue; // the upload expired: start once more
          if (err instanceof SessionLost) throw new DriveError('http', 'Google Drive dropped the upload.');
          throw err;
        }
      }
    },

    async list(access: string, folderId: string): Promise<DriveFileInfo[]> {
      const out: DriveFileInfo[] = [];
      let pageToken: string | undefined;
      do {
        const page = await api<{ files: Partial<DriveFileInfo>[]; nextPageToken?: string }>(access, 'GET', '/files', {
          q: `'${folderId}' in parents and trashed = false`,
          fields: 'nextPageToken,files(id,name,createdTime,appProperties)',
          pageSize: '1000',
          spaces: 'drive',
          ...(pageToken ? { pageToken } : {}),
        });
        for (const f of page.files) out.push({ id: f.id!, name: f.name ?? '', createdTime: f.createdTime ?? '', appProperties: f.appProperties ?? {} });
        pageToken = page.nextPageToken;
      } while (pageToken);
      return out;
    },

    async remove(access: string, id: string): Promise<void> {
      try {
        await api(access, 'DELETE', `/files/${encodeURIComponent(id)}`);
      } catch (err) {
        if (!(err instanceof DriveError && err.status === 404)) throw err;
      }
    },

    /** Takes the app's access back at Google (when an administrator disconnects). */
    async revoke(token: string): Promise<void> {
      cache.delete(token);
      const res = await call(`${opts.urls.revoke}?${new URLSearchParams({ token })}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      if (!res.ok && res.status !== 400) throw await errorFrom(res);
    },
  };

  async function sendPieces(session: string, path: string, size: number): Promise<{ id: string; md5Checksum?: string }> {
    const handle = await open(path, 'r');
    try {
      let offset = 0;
      let failures = 0;
      const buf = Buffer.alloc(Math.max(1, Math.min(chunkSize, size)));
      while (true) {
        const end = Math.min(offset + chunkSize, size);
        const { bytesRead } = await handle.read(buf, 0, end - offset, offset);
        const piece = Buffer.from(buf.subarray(0, bytesRead));
        let res: Response | null = null;
        try {
          res = await call(session, { method: 'PUT', headers: { 'content-range': size === 0 ? 'bytes */0' : `bytes ${offset}-${end - 1}/${size}` }, body: piece }, 5 * 60_000);
        } catch {
          res = null; // lost on the way: ask Drive below
        }
        if (res && (res.status === 200 || res.status === 201)) return (await res.json()) as { id: string; md5Checksum?: string };
        if (res && res.status === 308) {
          offset = nextOffset(res);
          failures = 0;
          continue;
        }
        if (res && (res.status === 404 || res.status === 410)) throw new SessionLost();
        if (res && !retryable(res.status)) throw await errorFrom(res);
        failures += 1;
        if (failures > 5) throw res ? await errorFrom(res) : new DriveError('network', 'Google could not be reached.');
        await sleep(delay * 2 ** failures);
        try {
          const st = await uploadStatus(session, size);
          if (st.done) return st.done;
          offset = st.offset;
        } catch (err) {
          if (err instanceof SessionLost) throw err;
          // Still out of reach: try the same piece again.
        }
      }
    } finally {
      await handle.close();
    }
  }
}

class SessionLost extends Error {}

/** The next byte to send after a 308 (its Range header says what Drive has). */
function nextOffset(res: Response): number {
  const m = /bytes=0-(\d+)/.exec(res.headers.get('range') ?? '');
  return m ? Number(m[1]) + 1 : 0;
}

export type GoogleDrive = ReturnType<typeof createGoogleDrive>;
