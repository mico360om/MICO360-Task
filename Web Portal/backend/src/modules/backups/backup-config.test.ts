import { describe, it, expect } from 'vitest';
import { join, resolve } from 'node:path';
import { resolveBackupDir, backupDirProblem, isInside, backupFileName, isBackupFileName, plainReason } from './backup-config';
import { BackupFailedError } from './backup-errors';
import { BackupKeyError } from './backup-crypto';

const root = resolve('/srv/app/backend');

describe('where backups are kept (BACKUP_DIR)', () => {
  it('defaults to a "backups" folder beside the uploads folder', () => {
    expect(resolveBackupDir({ BACKUP_DIR: '', UPLOAD_DIR: '/home/u/mico360-data/uploads' }, root)).toBe(resolve('/home/u/mico360-data/backups'));
    expect(resolveBackupDir({ BACKUP_DIR: '  ', UPLOAD_DIR: 'uploads' }, root)).toBe(join(root, 'backups'));
  });

  it('takes BACKUP_DIR as given (a relative one from the app folder)', () => {
    expect(resolveBackupDir({ BACKUP_DIR: '/mnt/safe/backups', UPLOAD_DIR: 'uploads' }, root)).toBe(resolve('/mnt/safe/backups'));
    expect(resolveBackupDir({ BACKUP_DIR: '../kept', UPLOAD_DIR: 'uploads' }, root)).toBe(resolve(root, '../kept'));
  });

  it('refuses a folder the website serves: the uploads folder, the web app or the email pictures', () => {
    const where = { uploadDir: '/data/uploads', webRoot: '/srv/app/frontend/dist', assetsDir: '/srv/app/backend/assets' };
    expect(backupDirProblem('/data/uploads/backups', where)).toMatch(/inside the uploads folder/);
    expect(backupDirProblem('/data/uploads', where)).toMatch(/inside the uploads folder/);
    expect(backupDirProblem('/srv/app/frontend/dist/b', where)).toMatch(/web app/);
    expect(backupDirProblem('/srv/app/backend/assets/x', where)).toMatch(/email pictures/);
    expect(backupDirProblem('/data/backups', where)).toBeNull();
    expect(backupDirProblem('/data/backups', { ...where, webRoot: null })).toBeNull();
  });

  it('isInside compares whole folder names (uploads-old is not inside uploads)', () => {
    expect(isInside('/data/uploads/a', '/data/uploads')).toBe(true);
    expect(isInside('/data/uploads-old', '/data/uploads')).toBe(false);
    expect(isInside('/data', '/data/uploads')).toBe(false);
  });
});

describe('backup file names', () => {
  it('say the company date and time; ".enc" when encrypted', () => {
    // 02:05 in Muscat is 22:05 UTC the evening before.
    const at = new Date('2026-10-29T22:05:00Z');
    expect(backupFileName(at, 'Asia/Muscat', 'cmabc123xyz', false)).toBe('mico360-tasks-backup-2026-10-30-0205-123xyz.tar.gz');
    expect(backupFileName(at, 'Asia/Muscat', 'cmabc123xyz', true)).toBe('mico360-tasks-backup-2026-10-30-0205-123xyz.tar.gz.enc');
  });

  it('only our own names count as copies (never the Windows tray’s SQL files or anything else)', () => {
    expect(isBackupFileName('mico360-tasks-backup-2026-10-30-0205-123xyz.tar.gz')).toBe(true);
    expect(isBackupFileName('mico360-tasks-backup-2026-10-30-0205-123xyz.tar.gz.enc')).toBe(true);
    expect(isBackupFileName('mico360-20261030-020000.sql')).toBe(false);
    expect(isBackupFileName('../mico360-tasks-backup-2026-10-30-0205-123xyz.tar.gz')).toBe(false);
  });
});

describe('the reason a backup failed, in plain words', () => {
  const err = (code: string) => Object.assign(new Error(`${code}: low level`), { code });
  it('says what happened without technical details', () => {
    expect(plainReason(err('ENOSPC'))).toBe('The server’s disk is full.');
    expect(plainReason(err('EDQUOT'))).toBe('The server’s disk is full.');
    expect(plainReason(err('EACCES'))).toMatch(/can’t be written to/);
    expect(plainReason(Object.assign(new Error('x'), { name: 'PrismaClientKnownRequestError' }))).toBe('The database couldn’t be read.');
    expect(plainReason(new BackupFailedError('There isn’t enough free disk space.'))).toBe('There isn’t enough free disk space.');
    expect(plainReason(new BackupKeyError('The backup key is too short.'))).toBe('The backup key is too short.');
    expect(plainReason(new Error('socket hang up at 0x1234'))).toBe('Something went wrong while making the copy (the server log has the details).');
  });
});
