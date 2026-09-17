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
