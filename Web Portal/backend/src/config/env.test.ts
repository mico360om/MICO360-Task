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
});
