import { describe, it, expect, beforeEach } from 'vitest';
import { createOnboardingEvents } from './onboarding-events';

let audit: { action: string; entityId?: string | null; userId?: string | null; newValue?: unknown }[];
let confirmed: { id: string; how: string }[];
let activated: string[];
let ended: string[];
let mails: { to: string; params: unknown; opts?: unknown }[];
let warnings: unknown[];
let mailOn: boolean;
let failMail: boolean;

function make() {
  return createOnboardingEvents({
    verification: {
      async confirm(id, how) {
        confirmed.push({ id, how });
        return 'verified';
      },
    },
    activate: async (id) => void activated.push(id),
    endChallenges: async (id) => void ended.push(id),
    audit: { record: async (e) => void audit.push(e) },
    firstNameOf: async () => 'Saif',
    emailOptions: async () => ({ brand: { companyName: 'Prolens' } }),
    logger: { warn: (...a: unknown[]) => void warnings.push(a) },
    mailer: {
      isConfigured: () => mailOn,
      async sendEmailChanged(to, params, opts) {
        if (failMail) throw new Error('down');
        mails.push({ to, params, opts });
      },
    },
  });
}

beforeEach(() => {
  audit = [];
  confirmed = [];
  activated = [];
  ended = [];
  mails = [];
  warnings = [];
  mailOn = true;
  failMail = false;
});

describe('A set-password link was used', () => {
  it('an invitation: the address confirmed (by the invitation), the account theirs, audited “invitation used”', async () => {
    await make().linkUsed('u1', 'WELCOME');
    expect(confirmed).toEqual([{ id: 'u1', how: 'invitation' }]);
    expect(activated).toEqual(['u1']);
    expect(audit).toEqual([{ userId: 'u1', ip: null, module: 'users', action: 'user.invitation.used', entityId: 'u1' }]);
  });

  it('a reset link: the address confirmed (by the reset link), audited “reset used”', async () => {
    await make().linkUsed('u1', 'PASSWORD_RESET');
    expect(confirmed).toEqual([{ id: 'u1', how: 'reset link' }]);
    expect(audit[0]).toMatchObject({ action: 'user.password.reset_used', entityId: 'u1' });
  });
});

describe('An administrator changed an account’s email', () => {
  it('ends its open sign-in codes, audits from → to with who did it, and tells the OLD address (new one masked)', async () => {
    await make().emailChanged('u1', 'saif@old.com', 'saif@new.com', { id: 'admin', ip: '1.2.3.4' });
    expect(ended).toEqual(['u1']);
    expect(audit).toEqual([{ userId: 'admin', ip: '1.2.3.4', module: 'users', action: 'user.email.changed', entityId: 'u1', newValue: { from: 'saif@old.com', to: 'saif@new.com' } }]);
    expect(mails).toEqual([{ to: 'saif@old.com', params: { firstName: 'Saif', newEmailMasked: 's•••@new.com' }, opts: { brand: { companyName: 'Prolens' } } }]);
  });

  it('without mail settings nothing is sent (the rest still happens)', async () => {
    mailOn = false;
    await make().emailChanged('u1', 'saif@old.com', 'saif@new.com', null);
    expect(mails).toEqual([]);
    expect(audit[0]).toMatchObject({ userId: null, action: 'user.email.changed' });
  });

  it('a notice that can’t go is logged (its words only, no addresses) and never thrown', async () => {
    failMail = true;
    await expect(make().emailChanged('u1', 'saif@old.com', 'saif@new.com', null)).resolves.toBeUndefined();
    expect(JSON.stringify(warnings)).toContain('down');
  });
});
