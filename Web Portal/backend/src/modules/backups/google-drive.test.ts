import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFakeGoogle, type FakeGoogle } from './fake-google';
import { createGoogleDrive, googleUrls, DriveError, DRIVE_SCOPE, FOLDER_NAME, plainDriveError } from './google-drive';

let fake: FakeGoogle;
let dir: string;
const REDIRECT = 'https://task.mico360.com/api/v1/backups/google/callback';

function client(extra: Partial<Parameters<typeof createGoogleDrive>[0]> = {}) {
  return createGoogleDrive({ clientId: fake.clientId, clientSecret: fake.clientSecret, redirectUri: REDIRECT, urls: googleUrls(fake.base), chunkSize: 256 * 1024, retryDelayMs: 1, ...extra });
}

/** Follow the sign-in page's answer, like the browser would, and pick the code out of it. */
async function consent(authUrl: string): Promise<{ code: string | null; state: string | null; error: string | null }> {
  const res = await fetch(authUrl, { redirect: 'manual' });
  const back = new URL(res.headers.get('location')!);
  return { code: back.searchParams.get('code'), state: back.searchParams.get('state'), error: back.searchParams.get('error') };
}

beforeEach(async () => {
  fake = await startFakeGoogle();
  dir = mkdtempSync(join(tmpdir(), 'mico-drive-'));
});
afterEach(async () => {
  await fake.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Google addresses', () => {
  it('are Google’s own unless a test stand-in is given', () => {
    expect(googleUrls()).toEqual({
      auth: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      revoke: 'https://oauth2.googleapis.com/revoke',
      drive: 'https://www.googleapis.com/drive/v3',
      upload: 'https://www.googleapis.com/upload/drive/v3',
    });
    expect(googleUrls('http://127.0.0.1:9/').token).toBe('http://127.0.0.1:9/token');
  });
});

describe('Google sign-in (OAuth 2.0)', () => {
  it('asks only for drive.file, offline access and a fresh consent (so a refresh token comes back)', () => {
    const url = new URL(client().authUrl('state-123'));
    expect(DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: fake.clientId,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: DRIVE_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'false',
      state: 'state-123',
    });
  });

  it('exchanges the code for a refresh token, names the account, and refreshes access', async () => {
    const g = client();
    const { code } = await consent(g.authUrl('s'));
    const tokens = await g.exchangeCode(code!);
    expect(tokens.refreshToken).toMatch(/^refresh-/);
    const access = await g.accessToken(tokens.refreshToken);
    expect(await g.about(access)).toEqual({ email: 'owner@gmail.com', name: 'The Owner' });
    // The access is reused until it is about to run out.
    expect(await g.accessToken(tokens.refreshToken)).toBe(access);
  });

  it('a taken-back connection is an "auth" error', async () => {
    const g = client();
    const { refreshToken } = await g.exchangeCode((await consent(g.authUrl('s'))).code!);
    fake.revokeAll();
    // The access already given is refused by Drive, and a new one is refused by sign-in.
    const refused = await g.about(await g.accessToken(refreshToken)).catch((e: unknown) => e);
    expect((refused as DriveError).kind).toBe('auth');
    g.forget(refreshToken);
    const err = await g.accessToken(refreshToken).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DriveError);
    expect((err as DriveError).kind).toBe('auth');
    expect(plainDriveError(err)).toBe('Google Drive no longer accepts this connection. Connect it again in System Settings → Backups.');
  });

  it('revoke takes the access back', async () => {
    const g = client();
    const { refreshToken } = await g.exchangeCode((await consent(g.authUrl('s'))).code!);
    await g.revoke(refreshToken);
    expect(fake.revoked.has(refreshToken)).toBe(true);
  });
});

describe('Drive: the backups folder, uploads, listing and deleting', () => {
  async function connected() {
    const g = client();
    const { refreshToken } = await g.exchangeCode((await consent(g.authUrl('s'))).code!);
    return { g, access: await g.accessToken(refreshToken) };
  }

  it('makes the "MICO360 Tasks backups" folder once, finds it again, and makes a new one if it was deleted', async () => {
    const { g, access } = await connected();
    const folder = await g.ensureFolder(access, null);
    expect(fake.files.get(folder)).toMatchObject({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' });
    expect(await g.ensureFolder(access, folder)).toBe(folder);
    expect(await g.ensureFolder(access, null)).toBe(folder);
    fake.files.get(folder)!.trashed = true;
    const again = await g.ensureFolder(access, folder);
    expect(again).not.toBe(folder);
    fake.files.delete(again);
    expect(await g.ensureFolder(access, again)).not.toBe(again);
  });

  function archive(size: number) {
    const data = randomBytes(size);
    const path = join(dir, 'copy.tar.gz');
    writeFileSync(path, data);
    return { path, data, md5: createHash('md5').update(data).digest('hex') };
  }

  it('uploads a 3 MB copy in pieces (resumable), checked by its MD5', async () => {
    const { g, access } = await connected();
    const folder = await g.ensureFolder(access, null);
    const a = archive(3 * 1024 * 1024 + 123);
    const { id } = await g.upload(access, { path: a.path, name: 'mico360-tasks-backup-x.tar.gz', folderId: folder, sizeBytes: a.data.length, md5: a.md5, appProperties: { mico360Backup: '1', createdAt: '2026-10-30T02:00:00.000Z' } });
    const stored = fake.files.get(id)!;
    expect(stored.content.equals(a.data)).toBe(true);
    expect(stored).toMatchObject({ name: 'mico360-tasks-backup-x.tar.gz', parents: [folder], appProperties: { mico360Backup: '1', createdAt: '2026-10-30T02:00:00.000Z' } });
  });

  it('a piece lost on the way (dropped connection, or a 503) is sent again from where Drive got to', async () => {
    const { g, access } = await connected();
    const folder = await g.ensureFolder(access, null);
    for (const how of ['drop', 503] as const) {
      const a = archive(1024 * 1024 + 7);
      fake.failNextChunk(how);
      const { id } = await g.upload(access, { path: a.path, name: `x-${how}.tar.gz`, folderId: folder, sizeBytes: a.data.length, md5: a.md5, appProperties: {} });
      expect(fake.files.get(id)!.content.equals(a.data)).toBe(true);
    }
  });

  it('Drive answering "resume incomplete" again and again without taking the bytes: the upload gives up instead of looping', async () => {
    const { g, access } = await connected();
    const folder = await g.ensureFolder(access, null);
    const a = archive(600 * 1024);
    fake.stallUploads(true);
    const hang = new Promise((_, reject) => setTimeout(() => reject(new Error('it loops')), 10_000).unref());
    const err = await Promise.race([g.upload(access, { path: a.path, name: 'x.tar.gz', folderId: folder, sizeBytes: a.data.length, md5: a.md5, appProperties: {} }), hang]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DriveError);
    expect(plainDriveError(err)).toBe('Google Drive stopped taking the copy part-way (it kept asking for the same piece).');
    // A few tries, with waits between them — not thousands.
    expect(fake.stalledAnswers).toBeGreaterThan(1);
    expect(fake.stalledAnswers).toBeLessThan(20);
  });

  it('a full Drive is a "full" error', async () => {
    const { g, access } = await connected();
    const folder = await g.ensureFolder(access, null);
    const a = archive(1000);
    fake.setFull(true);
    const err = await g.upload(access, { path: a.path, name: 'x.tar.gz', folderId: folder, sizeBytes: 1000, md5: a.md5, appProperties: {} }).catch((e: unknown) => e);
    expect((err as DriveError).kind).toBe('full');
    expect(plainDriveError(err)).toBe('Google Drive is full.');
  });

  it('lists the folder’s files and deletes one', async () => {
    const { g, access } = await connected();
    const folder = await g.ensureFolder(access, null);
    fake.addFile({ name: 'a.tar.gz', parents: [folder], appProperties: { mico360Backup: '1', createdAt: '2026-10-29T22:00:00.000Z' } });
    const b = fake.addFile({ name: 'b.tar.gz', parents: [folder] });
    fake.addFile({ name: 'elsewhere.tar.gz', parents: ['other'] });
    const list = await g.list(access, folder);
    expect(list.map((f) => f.name).sort()).toEqual(['a.tar.gz', 'b.tar.gz']);
    expect(list.find((f) => f.name === 'a.tar.gz')!.appProperties).toEqual({ mico360Backup: '1', createdAt: '2026-10-29T22:00:00.000Z' });
    await g.remove(access, b.id);
    expect(fake.files.has(b.id)).toBe(false);
  });

  it('Google out of reach is a "network" error in plain words', async () => {
    const g = createGoogleDrive({ clientId: 'x', clientSecret: 'y', redirectUri: REDIRECT, urls: googleUrls('http://127.0.0.1:1'), retryDelayMs: 1 });
    const err = await g.accessToken('refresh-x').catch((e: unknown) => e);
    expect((err as DriveError).kind).toBe('network');
    expect(plainDriveError(err)).toBe('Google Drive couldn’t be reached.');
  });
});
