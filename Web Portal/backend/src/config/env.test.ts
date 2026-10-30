import { describe, it, expect } from 'vitest';
import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://localhost/db',
  JWT_ACCESS_SECRET: 'dev-access',
  JWT_REFRESH_SECRET: 'dev-refresh',
};

describe('loadEnv', () => {
  it('accepts short dev secrets outside production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('rejects short/placeholder JWT secrets in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/production/i);
  });

  it('rejects identical access and refresh secrets in production', () => {
    const strong = 'x'.repeat(40);
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: strong, JWT_REFRESH_SECRET: strong } as NodeJS.ProcessEnv),
    ).toThrow(/differ/i);
  });

  it('accepts Word, Excel and PowerPoint files by default — the macro-free formats only', () => {
    const allowed = loadEnv({ ...base, NODE_ENV: 'development' } as NodeJS.ProcessEnv).UPLOAD_ALLOWED_MIME.split(',');
    expect(allowed).toEqual(expect.arrayContaining([
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/pdf',
      'image/png',
    ]));
    expect(allowed).not.toContain('application/msword');
    expect(allowed).not.toContain('application/vnd.ms-excel');
  });

  it('defaults the lock length, AI limits and private-host policy', () => {
    const env = loadEnv({ ...base, NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(env.ACCOUNT_LOCK_MINUTES).toBe(15);
    expect(env.AI_ALLOW_PRIVATE_HOSTS).toBe(false);
    expect(env.AI_USER_REQUESTS_PER_MINUTE).toBe(10);
    expect(env.AI_USER_REQUESTS_PER_DAY).toBe(200);
    expect(env.SECRETS_ENCRYPTION_KEY).toBe('');
  });

  it('reads AI_ALLOW_PRIVATE_HOSTS as a real boolean ("false" stays false)', () => {
    expect(loadEnv({ ...base, AI_ALLOW_PRIVATE_HOSTS: 'false' } as NodeJS.ProcessEnv).AI_ALLOW_PRIVATE_HOSTS).toBe(false);
    expect(loadEnv({ ...base, AI_ALLOW_PRIVATE_HOSTS: 'true' } as NodeJS.ProcessEnv).AI_ALLOW_PRIVATE_HOSTS).toBe(true);
  });

  it('rejects a short SECRETS_ENCRYPTION_KEY in production', () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'A'.repeat(40),
        JWT_REFRESH_SECRET: 'B'.repeat(40),
        SECRETS_ENCRYPTION_KEY: 'short',
      } as NodeJS.ProcessEnv),
    ).toThrow(/SECRETS_ENCRYPTION_KEY/);
  });

  it('accepts strong, distinct secrets in production', () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'A'.repeat(40),
        JWT_REFRESH_SECRET: 'B'.repeat(40),
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
  it('backups: kept beside the uploads, not encrypted, Google Drive off until set up', () => {
    const env = loadEnv({ ...base, NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(env).toMatchObject({ BACKUP_DIR: '', BACKUP_ENCRYPTION_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '' });
  });

  it('the nightly copy is on by default only in production (both server packages); off on development and test servers', () => {
    const prod = { ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'A'.repeat(40), JWT_REFRESH_SECRET: 'B'.repeat(40) };
    const nightly = (extra: Record<string, string>) => loadEnv({ ...base, ...extra } as NodeJS.ProcessEnv).BACKUP_NIGHTLY;
    expect(nightly({ NODE_ENV: 'development' })).toBe(false);
    expect(nightly({ NODE_ENV: 'test' })).toBe(false);
    expect(nightly({})).toBe(false);
    expect(nightly({ NODE_ENV: 'development', BACKUP_NIGHTLY: '' })).toBe(false);
    expect(loadEnv(prod as NodeJS.ProcessEnv).BACKUP_NIGHTLY).toBe(true);
    expect(loadEnv({ ...prod, BACKUP_NIGHTLY: ' ' } as NodeJS.ProcessEnv).BACKUP_NIGHTLY).toBe(true);
    // Said outright, it wins either way.
    expect(loadEnv({ ...prod, BACKUP_NIGHTLY: 'false' } as NodeJS.ProcessEnv).BACKUP_NIGHTLY).toBe(false);
    expect(loadEnv({ ...prod, BACKUP_NIGHTLY: 'no' } as NodeJS.ProcessEnv).BACKUP_NIGHTLY).toBe(false);
    expect(nightly({ NODE_ENV: 'development', BACKUP_NIGHTLY: 'TRUE' })).toBe(true);
    expect(nightly({ NODE_ENV: 'development', BACKUP_NIGHTLY: 'yes' })).toBe(true);
  });

  it('the backup key is read without spaces or a line end around it (as the restore tool reads it)', () => {
    expect(loadEnv({ ...base, BACKUP_ENCRYPTION_KEY: '  a long enough backup key \r\n' } as NodeJS.ProcessEnv).BACKUP_ENCRYPTION_KEY).toBe('a long enough backup key');
    expect(loadEnv({ ...base, BACKUP_ENCRYPTION_KEY: '   ' } as NodeJS.ProcessEnv).BACKUP_ENCRYPTION_KEY).toBe('');
  });

  it('the stand-in Google address for tests is ignored in production', () => {
    const strong = (c: string) => c.repeat(40);
    const prod = { ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: strong('a'), JWT_REFRESH_SECRET: strong('b'), BACKUP_GOOGLE_TEST_BASE_URL: 'http://127.0.0.1:9999' };
    expect(loadEnv(prod as NodeJS.ProcessEnv).BACKUP_GOOGLE_TEST_BASE_URL).toBe('');
    expect(loadEnv({ ...base, BACKUP_GOOGLE_TEST_BASE_URL: 'http://127.0.0.1:9999' } as NodeJS.ProcessEnv).BACKUP_GOOGLE_TEST_BASE_URL).toBe('http://127.0.0.1:9999');
  });
});
