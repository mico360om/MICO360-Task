/** The demo accounts made by prisma/seed.ts all live under this (non-routable) domain. */
const DEMO_DOMAIN = '@mico360.test';

/**
 * Why the demo seed must not run — or null when it may. The seed deletes every user, project and
 * task before creating demo data with a published password, so it is for development databases
 * only: never in production, and never over a real account unless SEED_DEMO_FORCE=1 says so.
 */
export function demoSeedBlocker(input: { emails: string[]; nodeEnv: string | undefined; force?: boolean }): string | null {
  if (input.nodeEnv === 'production') {
    return 'Refusing to seed demo data: NODE_ENV is production. The demo seed deletes all data and creates test accounts.';
  }
  const real = input.emails.filter((e) => !e.toLowerCase().endsWith(DEMO_DOMAIN));
  if (real.length > 0 && !input.force) {
    return (
      `Refusing to seed demo data: this database has ${real.length} real account${real.length === 1 ? '' : 's'} ` +
      `(${real.slice(0, 3).join(', ')}${real.length > 3 ? ', …' : ''}) that the seed would delete. ` +
      'Use a separate development database, or set SEED_DEMO_FORCE=1 to wipe this one.'
    );
  }
  return null;
}
