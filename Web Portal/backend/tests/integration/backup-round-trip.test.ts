import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { writeBackupArchive, readManifest, openArchiveEntries, verifyArchive } from '../../src/modules/backups/backup-archive';
import { restoreBackup, RestoreError } from '../../src/modules/backups/restore';
import { prismaSqlRunner, type SqlRunner } from '../../src/modules/backups/sql-runner';

// The whole round trip on a real MySQL (TEST_DATABASE_URL): seed → back up → restore into an empty
// database → identical row counts and contents for every table, files restored byte for byte.
const SOURCE_URL = process.env.TEST_DATABASE_URL!;
const sourceDb = new URL(SOURCE_URL).pathname.slice(1);
const TARGET_DB = `${sourceDb}_rt`;
const targetUrl = (() => {
  const u = new URL(SOURCE_URL);
  u.pathname = `/${TARGET_DB}`;
  return u.toString();
})();

const BACKEND = resolve(__dirname, '..', '..');
const MIGRATIONS = join(BACKEND, 'prisma', 'migrations');
const SCHEMA = join(BACKEND, 'prisma', 'schema.prisma');
const PRISMA_CLI = createRequire(join(BACKEND, 'package.json')).resolve('prisma/build/index.js');
const KEY = 'a test backup key, long enough';

const prisma = new PrismaClient({ datasources: { db: { url: SOURCE_URL } } });
const work = mkdtempSync(join(tmpdir(), 'mico-bk-rt-'));
const uploads = join(work, 'uploads');
const MARK = `bkrt${Date.now().toString(36)}`;
const ids: Record<string, string> = {};

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const createDatabase = async (name: string) => {
  await prisma.$executeRawUnsafe(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
};
const dropTarget = () => prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${TARGET_DB}\``);
const restoreOpts = (file: string, extra: Partial<Parameters<typeof restoreBackup>[0]> = {}) => ({
  file,
  targetUrl,
  filesInto: join(work, `restored-${Math.random().toString(36).slice(2)}`),
  migrationsDir: MIGRATIONS,
  schemaFile: SCHEMA,
  prismaCli: PRISMA_CLI,
  createDatabase,
  ...extra,
});

function filesUnder(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(relative(dir, p).split('\\').join('/'), sha(readFileSync(p)));
    }
  };
  walk(dir);
  return out;
}

async function tableNames(client: PrismaClient): Promise<string[]> {
  const rows = await client.$queryRawUnsafe<{ name: string }[]>("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
  return rows.map((r) => r.name);
}

/** Every table's row count and MySQL's own CHECKSUM TABLE (independent of the backup code). */
async function fingerprint(client: PrismaClient): Promise<Record<string, { rows: number; checksum: string }>> {
  const out: Record<string, { rows: number; checksum: string }> = {};
  for (const t of await tableNames(client)) {
    if (t === '_prisma_migrations') continue;
    const [count] = await client.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM \`${t}\``);
    const [cs] = await client.$queryRawUnsafe<{ Checksum: bigint }[]>(`CHECKSUM TABLE \`${t}\``);
    out[t] = { rows: Number(count!.n), checksum: String(cs!.Checksum) };
  }
  return out;
}

async function migrationNames(client: PrismaClient): Promise<string[]> {
  const rows = await client.$queryRawUnsafe<{ m: string }[]>('SELECT migration_name AS m FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name');
  return rows.map((r) => r.m);
}

async function seed() {
  const role = await prisma.role.upsert({ where: { name: 'ADMIN' }, update: {}, create: { name: 'ADMIN' } });
  const user = await prisma.user.create({
    data: {
      email: `${MARK}@mico360.test`,
      username: MARK,
      passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
      firstName: 'خرم',
      lastName: 'Test 🚀',
      notificationPrefs: { muted: ['TASK_COMMENT'], weeklySummary: false, note: 'قيمة "مقتبسة"' },
    },
  });
  ids.user = user.id;
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const project = await prisma.project.create({ data: { code: MARK.toUpperCase().slice(0, 12), name: 'Rig 7 — صيانة', description: '', createdById: user.id } });
  ids.project = project.id;
  const column = await prisma.kanbanColumn.create({ data: { projectId: project.id, name: 'To do', position: 0 } });
  // The copy's id sorts before its parent's, so a load in key order meets the child first.
  const parent = await prisma.task.create({ data: { id: `zz${MARK}parent`, key: `${MARK}-1`, title: 'Monthly gas test', projectId: project.id, columnId: column.id, createdById: user.id, estimatedHours: 1.1, actualHours: 0.30000000000000004, description: null, recurrenceRule: { freq: 'MONTHLY' } } });
  await prisma.task.create({ data: { id: `aa${MARK}copy`, key: `${MARK}-2`, title: 'Monthly gas test (copy)', projectId: project.id, columnId: column.id, createdById: user.id, recurrenceParentId: parent.id, dueDate: new Date('2026-10-30T09:15:42.123Z'), estimatedHours: 1e-7 } });
  const inspection = await prisma.inspection.create({
    data: { projectId: project.id, formVersion: 1, title: 'Pressure check', structure: { sections: [{ title: 'Valves', items: [] }] }, inspectorId: user.id, startedById: user.id },
  });
  await prisma.inspectionSignature.create({
    data: { inspectionId: inspection.id, role: 'CLIENT', name: 'Omar', method: 'DRAWN', image: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0xff]), randomBytes(5000)]), signedAt: new Date(), capturedById: user.id },
  });

  mkdirSync(join(uploads, 'nested', 'deeper'), { recursive: true });
  writeFileSync(join(uploads, 'a1b2c3.png'), randomBytes(1234));
  writeFileSync(join(uploads, 'nested', 'deeper', 'مرفق جديد.pdf'), Buffer.from('%PDF-1.4 arabic name'));
  writeFileSync(join(uploads, 'empty.txt'), Buffer.alloc(0));
  writeFileSync(join(uploads, 'big.bin'), randomBytes(2 * 1024 * 1024 + 3));
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: MARK } }, select: { id: true } });
  const projects = await prisma.project.findMany({ where: { createdById: { in: users.map((u) => u.id) } }, select: { id: true } });
  await prisma.inspection.deleteMany({ where: { projectId: { in: projects.map((p) => p.id) } } });
  await prisma.task.updateMany({ where: { projectId: { in: projects.map((p) => p.id) } }, data: { recurrenceParentId: null } });
  await prisma.task.deleteMany({ where: { projectId: { in: projects.map((p) => p.id) } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: projects.map((p) => p.id) } } });
  await prisma.project.deleteMany({ where: { id: { in: projects.map((p) => p.id) } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

/** Reads one table's lines out of an archive. */
async function tableLines(file: string, table: string, key?: string): Promise<string[]> {
  const lines: string[] = [];
  for await (const entry of openArchiveEntries(file, key)) {
    if (entry.name !== `database/${table}.jsonl`) {
      entry.body.resume();
      continue;
    }
    for await (const line of createInterface({ input: entry.body, crlfDelay: Infinity })) if (line) lines.push(line);
  }
  return lines;
}

beforeAll(async () => {
  await prisma.$connect();
  await dropTarget();
  await cleanup();
  await seed();
}, 60_000);

afterAll(async () => {
  await cleanup();
  await dropTarget();
  await prisma.$disconnect();
  rmSync(work, { recursive: true, force: true });
});

describe('Backup → restore round trip (integration)', () => {
  let plainCopy = '';

  it('the copy holds every table, the files and a manifest; rows written during the backup are not in it', async () => {
    const lateEmail = `${MARK}-late@mico360.test`;
    // Another connection adds a person while the users table is being read: the copy is one moment.
    const base = prismaSqlRunner(prisma);
    let added = false;
    const watching: SqlRunner = {
      ...base,
      transaction: (fn, opts) =>
        base.transaction(
          (tx) =>
            fn({
              ...tx,
              query: async (sql, ...params) => {
                if (!added && sql.includes('FROM `users`')) {
                  added = true;
                  await prisma.user.create({ data: { email: lateEmail, username: `${MARK}late`, passwordHash: 'x', firstName: 'Late', lastName: 'Comer' } });
                }
                return tx.query(sql, ...params);
              },
            }),
          opts,
        ),
    };
    plainCopy = join(work, 'copy.tar.gz');
    const res = await writeBackupArchive({ sql: watching, uploadDir: uploads, outFile: plainCopy, workDir: join(work, 'w1'), appVersion: '1.19.0-test', trigger: 'manual' });
    expect(added).toBe(true);
    expect(statSync(plainCopy).size).toBe(res.sizeBytes);
    expect(res.sha256).toBe(sha(readFileSync(plainCopy)));
    expect(res.files).toBe(4);
    expect(res.tables).toBeGreaterThan(60);
    expect(readdirSync(work)).not.toContain('copy.tar.gz.partial');
    expect(readdirSync(work)).not.toContain('w1');

    const manifest = await readManifest(plainCopy);
    const local = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    expect(manifest).toMatchObject({ format: 'mico360-tasks-backup', formatVersion: 1, appVersion: '1.19.0-test', trigger: 'manual', latestMigration: local.at(-1), files: { count: 4 } });
    expect(manifest.migrations).toEqual(await migrationNames(prisma));
    const users = manifest.database.tables.find((t) => t.name === 'users')!;
    expect(users.rows).toBeGreaterThan(0);
    expect(users.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Parents before children: projects come before tasks, users before projects.
    const order = manifest.database.tables.map((t) => t.name);
    expect(order.indexOf('users')).toBeLessThan(order.indexOf('projects'));
    expect(order.indexOf('projects')).toBeLessThan(order.indexOf('tasks'));

    const lines = await tableLines(plainCopy, 'users');
    expect(lines.length).toBe(users.rows);
    expect(lines.some((l) => l.includes(lateEmail))).toBe(false);
    expect(lines.some((l) => l.includes(`${MARK}@mico360.test`))).toBe(true);
    await prisma.user.deleteMany({ where: { email: lateEmail } });
  }, 120_000);

  it('restores into an empty database: every table identical (CHECKSUM TABLE), files byte for byte', async () => {
    const opts = restoreOpts(plainCopy);
    const report = await restoreBackup(opts);
    expect(report.tables).toBeGreaterThan(60);
    expect(report.files).toBe(4);
    const target = new PrismaClient({ datasources: { db: { url: targetUrl } } });
    try {
      expect(await fingerprint(target)).toEqual(await fingerprint(prisma));
      expect(await migrationNames(target)).toEqual(await migrationNames(prisma));
      const copy = await target.task.findUnique({ where: { id: `aa${MARK}copy` } });
      expect(copy).toMatchObject({ recurrenceParentId: `zz${MARK}parent`, estimatedHours: 1e-7 });
      expect(copy!.dueDate!.toISOString()).toBe('2026-10-30T09:15:42.123Z');
      const user = await target.user.findUnique({ where: { id: ids.user } });
      expect(user).toMatchObject({ firstName: 'خرم', lastName: 'Test 🚀' });
      expect(user!.notificationPrefs).toEqual({ muted: ['TASK_COMMENT'], weeklySummary: false, note: 'قيمة "مقتبسة"' });
      const project = await target.project.findUnique({ where: { id: ids.project } });
      expect(project!.description).toBe('');
    } finally {
      await target.$disconnect();
    }
    expect(filesUnder(opts.filesInto!)).toEqual(filesUnder(uploads));
  }, 240_000);

  it('refuses a database that already holds tables, unless told to wipe it (--force)', async () => {
    await expect(restoreBackup(restoreOpts(plainCopy))).rejects.toThrow(RestoreError);
    await expect(restoreBackup(restoreOpts(plainCopy))).rejects.toThrow(/not empty/i);
  }, 60_000);

  it('refuses a copy made by a newer version of the app (a database change this one does not have)', async () => {
    const older = join(work, 'older-migrations');
    cpSync(MIGRATIONS, older, { recursive: true });
    const newest = readdirSync(older, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().at(-1)!;
    rmSync(join(older, newest), { recursive: true });
    await expect(restoreBackup(restoreOpts(plainCopy, { migrationsDir: older, force: true }))).rejects.toThrow(/newer version/i);
  }, 60_000);

  it('an encrypted copy needs its key; with it, it restores over the old target (--force)', async () => {
    const sealed = join(work, 'copy.tar.gz.enc');
    await writeBackupArchive({ sql: prismaSqlRunner(prisma), uploadDir: uploads, outFile: sealed, workDir: join(work, 'w2'), appVersion: '1.19.0-test', trigger: 'nightly', encryptionKey: KEY });
    expect(readFileSync(sealed).subarray(0, 8).toString('latin1')).toBe('MBKENC1\n');
    await expect(readManifest(sealed)).rejects.toThrow(/backup key/i);
    await expect(readManifest(sealed, 'the wrong key, also long')).rejects.toThrow(/backup key/i);
    expect((await readManifest(sealed, KEY)).trigger).toBe('nightly');

    const opts = restoreOpts(sealed, { key: KEY, force: true });
    await restoreBackup(opts);
    const target = new PrismaClient({ datasources: { db: { url: targetUrl } } });
    try {
      expect(await fingerprint(target)).toEqual(await fingerprint(prisma));
    } finally {
      await target.$disconnect();
    }
    expect(filesUnder(opts.filesInto!)).toEqual(filesUnder(uploads));
  }, 240_000);

  it('a damaged or cut-short copy is refused before anything is changed (the whole copy is checked first)', async () => {
    const target = new PrismaClient({ datasources: { db: { url: targetUrl } } });
    try {
      const before = await fingerprint(target);
      const buf = readFileSync(plainCopy);
      const cut = join(work, 'cut.tar.gz');
      writeFileSync(cut, buf.subarray(0, Math.floor(buf.length * 0.9)));
      await expect(restoreBackup(restoreOpts(cut, { force: true }))).rejects.toThrow(/incomplete|damaged/i);
      const flipped = join(work, 'flipped.tar.gz');
      const copy = Buffer.from(buf);
      const at = Math.floor(copy.length / 3);
      copy[at] = copy[at]! ^ 0xff;
      writeFileSync(flipped, copy);
      await expect(restoreBackup(restoreOpts(flipped, { force: true }))).rejects.toThrow(RestoreError);
      expect(await fingerprint(target)).toEqual(before);
    } finally {
      await target.$disconnect();
    }
  }, 120_000);

  it('checking a copy on its own (no database) confirms it is whole', async () => {
    const check = await verifyArchive(plainCopy);
    expect(check).toMatchObject({ tables: expect.any(Number), files: 4 });
  }, 60_000);
});
