import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Owner decision (18 Nov 2026), 1.24.0: every administrator's existing session ends ONCE at the release
// (admin-sign-out-once.ts). The server must run it at start-up BEFORE it takes requests — run later, it would also
// end a sign-in an administrator made with password + code under 1.24.0 in between.
const server = readFileSync(resolve(__dirname, '../../server.ts'), 'utf8');

describe('1.24.0 one-time administrator sign-out: start-up wiring', () => {
  it('server.ts runs the step before app.listen, and a failure never stops the server (it is tried again later)', () => {
    const run = server.indexOf('adminSignOutOnce.run()');
    const listen = server.indexOf('await app.listen(');
    expect(run).toBeGreaterThan(0);
    expect(listen).toBeGreaterThan(0);
    expect(run).toBeLessThan(listen);
    expect(server).toMatch(/createAdminSignOutOnce\(\{ prisma \}\)/);
    // A failed first try (database away at start-up) is retried on a timer until it is recorded as done.
    expect(server).toMatch(/name: 'admin-sign-out-124'/);
  });
});
