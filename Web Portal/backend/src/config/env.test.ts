import { describe, it, expect } from 'vitest';
import { aiJobRetryDelays, loadEnv } from './env';

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

  it('AI_JOB_RETRY_DELAYS_MS: read outside production only, as whole milliseconds; anything else is the default', () => {
    expect(aiJobRetryDelays(loadEnv({ ...base, NODE_ENV: 'development' } as NodeJS.ProcessEnv))).toBeUndefined();
    expect(aiJobRetryDelays(loadEnv({ ...base, NODE_ENV: 'development', AI_JOB_RETRY_DELAYS_MS: '2000, 3000,4000' } as NodeJS.ProcessEnv))).toEqual([2000, 3000, 4000]);
    expect(aiJobRetryDelays(loadEnv({ ...base, NODE_ENV: 'development', AI_JOB_RETRY_DELAYS_MS: '2000,soon' } as NodeJS.ProcessEnv))).toBeUndefined();
    expect(aiJobRetryDelays({ NODE_ENV: 'production', AI_JOB_RETRY_DELAYS_MS: '1,1,1' })).toBeUndefined();
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

  it('BACKUP_WARN_GB: the size of the kept copies that brings a warning, 5 GB unless set', () => {
    const warnGb = (v?: string) => loadEnv({ ...base, ...(v === undefined ? {} : { BACKUP_WARN_GB: v }) } as NodeJS.ProcessEnv).BACKUP_WARN_GB;
    expect(warnGb()).toBe(5);
    expect(warnGb('')).toBe(5);
    expect(warnGb(' 12 ')).toBe(12);
    expect(warnGb('0.5')).toBe(0.5);
    expect(() => warnGb('lots')).toThrow(/BACKUP_WARN_GB/);
    expect(() => warnGb('0')).toThrow(/BACKUP_WARN_GB/);
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

// Pinned before the zod 4 upgrade (1.23.12): the defaults, the switches and the address checks read as before.
describe('loadEnv — defaults and checks', () => {
  it('fills the defaults', () => {
    const env = loadEnv({ ...base } as NodeJS.ProcessEnv);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      API_BASE_URL: 'http://localhost:4000',
      APP_URL: 'http://localhost:5173',
      RATE_LIMIT_MAX: 600,
      OTP_LENGTH: 6,
      SECRETS_ENCRYPTION_KEY: '',
      AI_ALLOW_PRIVATE_HOSTS: false,
      BACKUP_NIGHTLY: false,
      BACKUP_WARN_GB: 5,
      UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
    });
    expect(env.UPLOAD_ALLOWED_MIME.split(',')).toContain('application/pdf');
  });
  it('reads numbers, switches and blanks', () => {
    const env = loadEnv({ ...base, PORT: '4971', AI_ALLOW_PRIVATE_HOSTS: ' Yes ', BACKUP_NIGHTLY: 'off', BACKUP_WARN_GB: ' ', OTP_LENGTH: '8' } as NodeJS.ProcessEnv);
    expect(env).toMatchObject({ PORT: 4971, AI_ALLOW_PRIVATE_HOSTS: true, BACKUP_NIGHTLY: false, BACKUP_WARN_GB: 5, OTP_LENGTH: 8 });
    expect(loadEnv({ ...base, BACKUP_NIGHTLY: '' } as NodeJS.ProcessEnv).BACKUP_NIGHTLY).toBe(false);
    expect(loadEnv({ ...base, BACKUP_WARN_GB: '2.5' } as NodeJS.ProcessEnv).BACKUP_WARN_GB).toBe(2.5);
  });
  it('refuses a bad address, a bad number and an unknown mode, naming each', () => {
    expect(() => loadEnv({ ...base, API_BASE_URL: 'not a url' } as NodeJS.ProcessEnv)).toThrow('API_BASE_URL: Invalid url');
    expect(() => loadEnv({ ...base, PORT: 'abc' } as NodeJS.ProcessEnv)).toThrow('PORT: Expected number, received nan');
    expect(() => loadEnv({ ...base, OTP_LENGTH: '3' } as NodeJS.ProcessEnv)).toThrow('OTP_LENGTH: Number must be greater than or equal to 4');
    expect(() => loadEnv({ ...base, NODE_ENV: 'staging' } as NodeJS.ProcessEnv)).toThrow("NODE_ENV: Invalid enum value. Expected 'development' | 'test' | 'production', received 'staging'");
    expect(() => loadEnv({ ...base, BACKUP_WARN_GB: '0' } as NodeJS.ProcessEnv)).toThrow('BACKUP_WARN_GB: Number must be greater than 0');
  });
});

describe('TRAINING_TOUR_AUTO (Learning Hub, R20)', () => {
  const tour = (v?: string) => loadEnv({ ...base, NODE_ENV: 'development', ...(v === undefined ? {} : { TRAINING_TOUR_AUTO: v }) } as NodeJS.ProcessEnv).TRAINING_TOUR_AUTO;
  it('on unless set to off (any case, spaces ignored); anything else is refused', () => {
    expect(tour()).toBe('on');
    expect(tour('')).toBe('on');
    expect(tour('off')).toBe('off');
    expect(tour(' OFF ')).toBe('off');
    expect(tour('on')).toBe('on');
    expect(() => tour('maybe')).toThrow();
  });
});

// 1.23.29 private file links: nothing new is needed to start (the live deploy sets no new variable).
describe('file links (1.23.29)', () => {
  const env = (extra: Record<string, string> = {}) => loadEnv({ ...base, NODE_ENV: 'development', ...extra } as NodeJS.ProcessEnv);
  it('need no new setting: the key comes from JWT_ACCESS_SECRET, links last 30 hours', () => {
    expect(env().FILE_LINK_SECRET).toBe('');
    expect(env().FILE_LINK_MINUTES).toBe(1800);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40) } as NodeJS.ProcessEnv)).not.toThrow();
  });
  it('FILE_LINK_SECRET may set their own key; FILE_LINK_MINUTES a shorter life (tests), never longer than 30 hours', () => {
    expect(env({ FILE_LINK_SECRET: 'x'.repeat(40) }).FILE_LINK_SECRET).toBe('x'.repeat(40));
    expect(env({ FILE_LINK_MINUTES: '10' }).FILE_LINK_MINUTES).toBe(10);
    expect(env({ FILE_LINK_MINUTES: '' }).FILE_LINK_MINUTES).toBe(1800);
    expect(() => env({ FILE_LINK_MINUTES: '4' })).toThrow();
    expect(() => env({ FILE_LINK_MINUTES: '1801' })).toThrow();
  });
  it('a short FILE_LINK_SECRET is refused in production', () => {
    const prod = { ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40) };
    expect(() => loadEnv({ ...prod, FILE_LINK_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(/FILE_LINK_SECRET/);
  });
});
