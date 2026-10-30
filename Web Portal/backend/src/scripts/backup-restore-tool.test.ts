import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { writeBackupArchive } from '../modules/backups/backup-archive';
import { fakeSqlRunner } from '../modules/backups/backup-fakes';

// The shipped restore tool (src/scripts/backup-restore.ts), run as the owner would run it, on copies
// made by the server. Only --check here: it needs no database.
const BACKEND = resolve(__dirname, '..', '..');
const TSX = createRequire(join(BACKEND, 'package.json')).resolve('tsx/cli');
const KEY = 'a long enough backup key';

let dir: string;
const sql = fakeSqlRunner([{ name: 'notes', columns: [{ name: 'id', type: 'varchar' }, { name: 'body', type: 'text' }], primaryKey: ['id'], rows: [['n1', 'hello']] }]);

async function copyMadeWith(key: string, name: string): Promise<string> {
  const outFile = join(dir, `${name}.tar.gz.enc`);
  await writeBackupArchive({ sql, uploadDir: join(dir, 'uploads'), outFile, workDir: join(dir, `.work-${name}`), appVersion: 't', trigger: 'nightly', encryptionKey: key });
  return outFile;
}

function check(copy: string, ...extra: string[]) {
  return spawnSync(process.execPath, [TSX, join('src', 'scripts', 'backup-restore.ts'), copy, '--check', ...extra], {
    cwd: BACKEND,
    encoding: 'utf8',
    env: { ...process.env, BACKUP_ENCRYPTION_KEY: '', DATABASE_URL: '' },
    timeout: 120_000,
  });
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mico-bk-tool-'));
  mkdirSync(join(dir, 'uploads'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('backup:restore --check with the backup key', () => {
  it('opens a copy made while the server used a key with spaces around it (before it trimmed the key)', async () => {
    const spaced = `  ${KEY}  `;
    const copy = await copyMadeWith(spaced, 'spaced');
    writeFileSync(join(dir, 'key.txt'), `${spaced}\n`);
    const viaFile = check(copy, '--key-file', join(dir, 'key.txt'));
    expect(viaFile.stdout + viaFile.stderr).toMatch(/The copy is whole/);
    expect(viaFile.status).toBe(0);
    writeFileSync(join(dir, 'spaced.env'), `BACKUP_ENCRYPTION_KEY="${spaced}"\n`);
    const viaSettings = check(copy, '--env-file', join(dir, 'spaced.env'));
    expect(viaSettings.stdout + viaSettings.stderr).toMatch(/The copy is whole/);
  }, 180_000);

  it('opens a copy made with the trimmed key from the same key file; a wrong key is still refused', async () => {
    const copy = await copyMadeWith(KEY, 'trimmed');
    writeFileSync(join(dir, 'key2.txt'), `  ${KEY}  \n`);
    expect(check(copy, '--key-file', join(dir, 'key2.txt')).stdout).toMatch(/The copy is whole/);
    writeFileSync(join(dir, 'wrong.txt'), 'not the key of this copy at all');
    const wrong = check(copy, '--key-file', join(dir, 'wrong.txt'));
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toMatch(/That backup key does not open this copy/);
  }, 180_000);
});
