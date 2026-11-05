import { describe, it, expect, vi } from 'vitest';
import { poolSizeOf, withPoolDefaults } from './db-pool';

// 1.23.2 — Prisma's default pool grows with the machine's CPUs; on shared hosting that can pass the
// host's connections-per-user limit and the database refuses connections (P1001). A URL without a
// connection_limit gets connection_limit=10&pool_timeout=20; a value already in the URL is never changed.
describe('the database connection pool', () => {
  it('a URL without a connection_limit gets connection_limit=10 and pool_timeout=20', () => {
    expect(withPoolDefaults('mysql://u:p@db.example:3306/mico')).toBe('mysql://u:p@db.example:3306/mico?connection_limit=10&pool_timeout=20');
    expect(withPoolDefaults('mysql://u:p@db/mico?sslaccept=strict')).toBe('mysql://u:p@db/mico?sslaccept=strict&connection_limit=10&pool_timeout=20');
    expect(withPoolDefaults('mysql://u:p@db/mico?')).toBe('mysql://u:p@db/mico?connection_limit=10&pool_timeout=20');
  });

  it('never overrides a value already in the URL', () => {
    expect(withPoolDefaults('mysql://u:p@db/mico?connection_limit=3')).toBe('mysql://u:p@db/mico?connection_limit=3');
    expect(withPoolDefaults('mysql://u:p@db/mico?pool_timeout=5')).toBe('mysql://u:p@db/mico?pool_timeout=5&connection_limit=10');
    expect(withPoolDefaults('mysql://u:p@db/mico?connection_limit=25&pool_timeout=40')).toBe('mysql://u:p@db/mico?connection_limit=25&pool_timeout=40');
  });

  it('a password with special characters is left exactly as written', () => {
    const url = 'mysql://mico_user:p%40ss!w%3Ad#1@127.0.0.1:3306/mico360';
    expect(withPoolDefaults(url)!.startsWith(url)).toBe(true);
  });

  it('nothing set, nothing done; the pool size read back', () => {
    expect(withPoolDefaults(undefined)).toBeUndefined();
    expect(withPoolDefaults('')).toBe('');
    expect(poolSizeOf('mysql://u:p@db/mico?connection_limit=10&pool_timeout=20')).toBe(10);
    expect(poolSizeOf('mysql://u:p@db/mico')).toBeNull();
    expect(poolSizeOf(undefined)).toBeNull();
  });

  it('never prints the URL, its host or its user', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    withPoolDefaults('mysql://secret_user:secret_pass@secret-host:3306/mico');
    poolSizeOf('mysql://secret_user:secret_pass@secret-host:3306/mico?connection_limit=x');
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
