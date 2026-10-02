import { describe, it, expect } from 'vitest';
import { demoSeedBlocker } from './seed-guard';

describe('demoSeedBlocker — the demo seed wipes the database, so it only runs on a development one', () => {
  it('allows an empty database and one that holds only demo accounts', () => {
    expect(demoSeedBlocker({ emails: [], nodeEnv: 'development' })).toBeNull();
    expect(demoSeedBlocker({ emails: ['admin@mico360.test', 'omar@mico360.test'], nodeEnv: undefined })).toBeNull();
  });

  it('refuses when a real account exists (it would be deleted)', () => {
    const why = demoSeedBlocker({ emails: ['admin@mico360.test', 'owner@company.com'], nodeEnv: 'development' });
    expect(why).toContain('owner@company.com');
    expect(why).toContain('SEED_DEMO_FORCE=1');
  });

  it('refuses in production, even on an empty database', () => {
    expect(demoSeedBlocker({ emails: [], nodeEnv: 'production' })).toContain('production');
  });

  it('SEED_DEMO_FORCE=1 overrides a real account, but never production', () => {
    expect(demoSeedBlocker({ emails: ['owner@company.com'], nodeEnv: 'development', force: true })).toBeNull();
    expect(demoSeedBlocker({ emails: [], nodeEnv: 'production', force: true })).toContain('production');
  });
});
