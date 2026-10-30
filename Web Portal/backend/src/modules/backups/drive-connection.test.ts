import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFakeGoogle, type FakeGoogle } from './fake-google';
import { createGoogleDrive, googleUrls, FOLDER_NAME } from './google-drive';
import { createBackupDrive, createDriveConnectionStore, type KeyValue } from './drive-connection';
import { createOneTimeTokens } from './one-time-tokens';
import { createSecretBox } from '../settings/secret-box';
import { ConflictError } from '../../lib/http-errors';

const REDIRECT = 'http://localhost:4431/api/v1/backups/google/callback';
let fake: FakeGoogle;
let dir: string;
let stored: unknown;
let clock: Date;
const kv: KeyValue = {
  read: async () => stored,
  write: async (v) => {
    stored = v;
  },
  erase: async () => {
    stored = undefined;
  },
};
const box = createSecretBox([{ material: 'secrets-key-for-tests', info: 'test' }]);

function setup(opts: { configured?: boolean } = {}) {
  const google = opts.configured === false ? null : createGoogleDrive({ clientId: fake.clientId, clientSecret: fake.clientSecret, redirectUri: REDIRECT, urls: googleUrls(fake.base), chunkSize: 256 * 1024, retryDelayMs: 1 });
  const store = createDriveConnectionStore(kv, box);
  const tokens = createOneTimeTokens({ secret: 'jwt-secret-for-tests', purpose: 'drive-connect', now: () => clock });
  return { drive: createBackupDrive({ google, store, tokens, now: () => clock }), store };
}

/** What the browser does: open Google's page, then come back to the callback with its answer. */
async function signIn(url: string): Promise<{ code?: string; state?: string; error?: string }> {
  const res = await fetch(url, { redirect: 'manual' });
  const back = new URL(res.headers.get('location')!);
  return Object.fromEntries(back.searchParams) as { code?: string; state?: string; error?: string };
}

function archive(size = 600 * 1024) {
  const data = randomBytes(size);
  const path = join(dir, 'mico360-tasks-backup-2026-10-30-0200-aaaaaa.tar.gz');
  writeFileSync(path, data);
  return { path, name: 'mico360-tasks-backup-2026-10-30-0200-aaaaaa.tar.gz', sizeBytes: size, createdAt: new Date('2026-10-29T22:00:00Z'), manual: false, sha256: createHash('sha256').update(data).digest('hex'), md5: createHash('md5').update(data).digest('hex'), data };
}

beforeEach(async () => {
  fake = await startFakeGoogle();
  dir = mkdtempSync(join(tmpdir(), 'mico-drive-conn-'));
  stored = undefined;
  clock = new Date('2026-10-30T08:00:00Z');
});
afterEach(async () => {
  await fake.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('connecting Google Drive', () => {
  it('Connect → Google → back: "connected as" the account, the folder made, the token sealed at rest', async () => {
    const { drive } = setup();
    expect(await drive.state()).toEqual({ configured: true, connected: false, stored: false, email: null, connectedAt: null, problem: null });
    const answer = await signIn(drive.connectUrl('admin1'));
    expect(fake.authRequests[0]!.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(await drive.complete(answer)).toEqual({ result: 'connected', userId: 'admin1', email: 'owner@gmail.com' });
    expect(await drive.state()).toEqual({ configured: true, connected: true, stored: true, email: 'owner@gmail.com', connectedAt: clock.toISOString(), problem: null });
    expect([...fake.files.values()].map((f) => f.name)).toEqual([FOLDER_NAME]);
    const raw = JSON.stringify(stored);
    expect(raw).toContain('enc:v1:');
    expect(raw).not.toMatch(/refresh-/);
  });

  it('a sign-in answer works once; a changed or late one fails; Cancel at Google is "denied"', async () => {
    const { drive } = setup();
    const answer = await signIn(drive.connectUrl('admin1'));
    expect((await drive.complete({ ...answer, state: `${answer.state}x` })).result).toBe('failed');
    expect((await drive.complete(answer)).result).toBe('connected');
    expect((await drive.complete(answer)).result).toBe('failed'); // used
    const late = await signIn(drive.connectUrl('admin1'));
    clock = new Date(clock.getTime() + 11 * 60 * 1000);
    expect((await drive.complete(late)).result).toBe('failed');
    fake.setDeny(true);
    expect((await drive.complete(await signIn(drive.connectUrl('admin1')))).result).toBe('denied');
  });

  it('not set up on this server (no Google client): says so, and Connect is refused', async () => {
    const { drive } = setup({ configured: false });
    expect((await drive.state()).configured).toBe(false);
    expect(() => drive.connectUrl('admin1')).toThrow(ConflictError);
    expect(() => drive.connectUrl('admin1')).toThrow('Google Drive isn’t set up on this server yet.');
  });

  it('a connection kept from before on a server whose Google settings are gone: not connected (nothing is sent), and it can be disconnected', async () => {
    const { drive } = setup();
    await drive.complete(await signIn(drive.connectUrl('admin1')));
    const { drive: bare } = setup({ configured: false });
    expect(await bare.state()).toEqual({ configured: false, connected: false, stored: true, email: 'owner@gmail.com', connectedAt: clock.toISOString(), problem: null });
    await expect(bare.upload(archive())).rejects.toThrow(/not connected/);
    expect(await bare.disconnect()).toEqual({ email: 'owner@gmail.com' });
    expect(fake.revoked.size).toBe(0); // there is no Google client here to take the access back with
    expect(await bare.state()).toMatchObject({ connected: false, stored: false, email: null });
  });

  it('Disconnect takes the access back at Google and forgets the connection', async () => {
    const { drive } = setup();
    await drive.complete(await signIn(drive.connectUrl('admin1')));
    expect(await drive.disconnect()).toEqual({ email: 'owner@gmail.com' });
    expect(fake.revoked.size).toBe(1);
    expect(stored).toBeUndefined();
    expect((await drive.state()).connected).toBe(false);
  });

  it('a stored connection this server can no longer open (its secret key changed) asks to connect again', async () => {
    const { drive } = setup();
    await drive.complete(await signIn(drive.connectUrl('admin1')));
    const otherBox = createSecretBox([{ material: 'a different key', info: 'test' }]);
    const other = createBackupDrive({ google: null, store: createDriveConnectionStore(kv, otherBox), tokens: createOneTimeTokens({ secret: 's', purpose: 'p' }) });
    expect((await other.state()).problem).toMatch(/Connect it again/);
  });
});

describe('sending copies to Drive', () => {
  async function connected() {
    const s = setup();
    await s.drive.complete(await signIn(s.drive.connectUrl('admin1')));
    return s;
  }

  it('uploads each copy into the folder with the app’s marker (its date and checksum)', async () => {
    const { drive } = await connected();
    const a = archive();
    const { fileId } = await drive.upload(a);
    const f = fake.files.get(fileId)!;
    expect(f.content.equals(a.data)).toBe(true);
    expect(f.name).toBe(a.name);
    expect(fake.files.get(f.parents[0]!)!.name).toBe(FOLDER_NAME);
    expect(f.appProperties).toEqual({ mico360Backup: '1', createdAt: '2026-10-29T22:00:00.000Z', sha256: a.sha256, trigger: 'nightly' });
    const m = await drive.upload({ ...archive(), manual: true });
    expect(fake.files.get(m.fileId)!.appProperties.trigger).toBe('manual');
  });

  it('makes the folder again when the owner deleted it in Drive', async () => {
    const { drive } = await connected();
    const folder = [...fake.files.values()].find((f) => f.name === FOLDER_NAME)!;
    fake.files.delete(folder.id);
    const { fileId } = await drive.upload(archive());
    const parent = fake.files.get(fake.files.get(fileId)!.parents[0]!)!;
    expect(parent.name).toBe(FOLDER_NAME);
    expect(parent.id).not.toBe(folder.id);
  });

  it('a run-out access token is renewed on the way', async () => {
    const { drive } = await connected();
    fake.expireAccess();
    await expect(drive.upload(archive())).resolves.toMatchObject({ fileId: expect.any(String) });
  });

  it('access taken back in the Google account: the upload fails and the connection asks to be made again', async () => {
    const { drive } = await connected();
    fake.revokeAll();
    fake.expireAccess();
    const err = await drive.upload(archive()).catch((e: unknown) => e);
    expect(drive.plainError(err)).toBe('Google Drive no longer accepts this connection. Connect it again in System Settings → Backups.');
    expect((await drive.state()).problem).toBe('Google Drive no longer accepts this connection. Connect it again in System Settings → Backups.');
    // Connecting again clears it.
    await drive.complete(await signIn(drive.connectUrl('admin1')));
    expect((await drive.state()).problem).toBeNull();
  });

  it('keeps Drive’s copies to 7 nightly + 4 weekly too — only the app’s own files', async () => {
    const { drive } = await connected();
    const folder = [...fake.files.values()].find((f) => f.name === FOLDER_NAME)!;
    for (let d = 1; d <= 30; d++) {
      const day = `2026-10-${String(d).padStart(2, '0')}`;
      fake.addFile({ name: `copy-${day}.tar.gz`, parents: [folder.id], appProperties: { mico360Backup: '1', createdAt: new Date(`${day}T02:00:00+04:00`).toISOString() } });
    }
    fake.addFile({ name: 'owner-notes.pdf', parents: [folder.id] });
    for (const [d, hhmm] of [['2026-10-30', '11:00'], ['2026-10-30', '12:00'], ['2026-10-29', '12:00'], ['2026-10-02', '12:00']]) {
      fake.addFile({ name: `now-${d}-${hhmm}.tar.gz`, parents: [folder.id], appProperties: { mico360Backup: '1', trigger: 'manual', createdAt: new Date(`${d}T${hhmm}:00+04:00`).toISOString() } });
    }
    await drive.applyRetention({ timeZone: 'Asia/Muscat', weekStart: 0 });
    const names = [...fake.files.values()].filter((f) => f.parents.includes(folder.id)).map((f) => f.name).sort();
    expect(names).toEqual([
      'copy-2026-10-03.tar.gz',
      'copy-2026-10-10.tar.gz',
      'copy-2026-10-17.tar.gz',
      ...[24, 25, 26, 27, 28, 29, 30].map((d) => `copy-2026-10-${d}.tar.gz`),
      'now-2026-10-29-12:00.tar.gz',
      'now-2026-10-30-11:00.tar.gz',
      'now-2026-10-30-12:00.tar.gz',
      'owner-notes.pdf',
    ]);
  });
});
