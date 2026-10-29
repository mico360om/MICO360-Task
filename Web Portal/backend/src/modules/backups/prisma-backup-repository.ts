import { randomUUID } from 'node:crypto';
import type { BackupRun, PrismaClient } from '@prisma/client';
import type { BackupRepository, BackupRunChange, BackupRunLock, BackupRunRecord } from './backup-repository';

function toRecord(r: BackupRun): BackupRunRecord {
  return {
    id: r.id,
    trigger: r.trigger,
    status: r.status,
    localDate: r.localDate,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    fileName: r.fileName,
    sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes),
    sha256: r.sha256,
    encrypted: r.encrypted,
    tableCount: r.tableCount,
    rowCount: r.rowCount,
    fileCount: r.fileCount,
    error: r.error,
    driveStatus: r.driveStatus,
    driveFileId: r.driveFileId,
    driveError: r.driveError,
    requestedById: r.requestedById,
  };
}

function toData(change: BackupRunChange) {
  const { sizeBytes, ...rest } = change;
  return { ...rest, ...(sizeBytes !== undefined ? { sizeBytes: sizeBytes === null ? null : BigInt(sizeBytes) } : {}) };
}

const newest = { startedAt: 'desc' } as const;

export function createPrismaBackupRepository(prisma: PrismaClient): BackupRepository {
  return {
    async create(d) {
      return toRecord(await prisma.backupRun.create({ data: { trigger: d.trigger, localDate: d.localDate, startedAt: d.startedAt, requestedById: d.requestedById } }));
    },
    async update(id, change) {
      return toRecord(await prisma.backupRun.update({ where: { id }, data: toData(change) }));
    },
    async updateIfRunning(id, change) {
      return (await prisma.backupRun.updateMany({ where: { id, status: 'RUNNING' }, data: toData(change) })).count > 0;
    },
    async find(id) {
      const r = await prisma.backupRun.findUnique({ where: { id } });
      return r ? toRecord(r) : null;
    },
    async recent(limit) {
      return (await prisma.backupRun.findMany({ orderBy: newest, take: limit })).map(toRecord);
    },
    async ok() {
      return (await prisma.backupRun.findMany({ where: { status: 'OK' }, orderBy: newest, take: 500 })).map(toRecord);
    },
    async running() {
      return (await prisma.backupRun.findMany({ where: { status: 'RUNNING' }, orderBy: newest })).map(toRecord);
    },
    async nightlyOn(localDate) {
      return (await prisma.backupRun.findMany({ where: { trigger: 'NIGHTLY', localDate }, orderBy: { startedAt: 'asc' } })).map(toRecord);
    },
    async remove(ids) {
      if (ids.length) await prisma.backupRun.deleteMany({ where: { id: { in: ids } } });
    },
    async pruneFailed(before) {
      return (await prisma.backupRun.deleteMany({ where: { status: 'FAILED', startedAt: { lt: before } } })).count;
    },
  };
}

/**
 * The backup lock on the job_locks table: claimed with a random holder token for `leaseMs`, renewed
 * while a backup runs, and released (only by its holder) when it ends.
 */
export function createPrismaBackupLock(prisma: PrismaClient, opts: { name?: string; leaseMs?: number } = {}): BackupRunLock {
  const name = opts.name ?? 'backup-run';
  const leaseMs = opts.leaseMs ?? 5 * 60 * 1000;
  let token: string | null = null;
  return {
    async acquire(now) {
      const holder = randomUUID();
      const lockedUntil = new Date(now.getTime() + leaseMs);
      const claimed = await prisma.jobLock.updateMany({ where: { name, lockedUntil: { lte: now } }, data: { lockedUntil, holder } });
      if (claimed.count === 0) {
        try {
          await prisma.jobLock.create({ data: { name, lockedUntil, holder } });
        } catch {
          return false; // held by another, or another server created it first
        }
      }
      token = holder;
      return true;
    },
    async renew(now) {
      if (token) await prisma.jobLock.updateMany({ where: { name, holder: token }, data: { lockedUntil: new Date(now.getTime() + leaseMs) } });
    },
    async release() {
      if (!token) return;
      await prisma.jobLock.updateMany({ where: { name, holder: token }, data: { lockedUntil: new Date(0) } });
      token = null;
    },
    async isHeld(now) {
      const row = await prisma.jobLock.findUnique({ where: { name } });
      return Boolean(row && row.lockedUntil > now);
    },
  };
}
