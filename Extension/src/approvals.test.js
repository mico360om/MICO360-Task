import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isWaitingForApproval, approvalNotice, DECISION_WORDS, REASON_MAX, approveLabel, approvedNotice, sendBackLabel, sendBackNote, sendBackTitle, sentBackNotice } from './approvals.js';

describe('task approvals: what the extension says about a task that waits', () => {
  it('a task waits while it has an approval request (it is not done yet)', () => {
    expect(isWaitingForApproval({ approvalRequestedAt: '2026-10-30T08:00:00Z' })).toBe(true);
    expect(isWaitingForApproval({ approvalRequestedAt: null })).toBe(false);
    expect(isWaitingForApproval({})).toBe(false);
    expect(isWaitingForApproval(null)).toBe(false);
  });

  it('after a move to Done that the server turned into a wait: the web’s words; else nothing', () => {
    const waiting = { key: 'RIG-4', columnId: 'rev', approvalRequestedAt: '2026-10-30T08:00:00Z' };
    expect(approvalNotice('done', waiting)).toBe('RIG-4 needs approval, so it’s waiting for a project manager.');
    expect(approvalNotice('rev', waiting)).toBeNull(); // it went where it was asked
    expect(approvalNotice('done', { ...waiting, approvalRequestedAt: null })).toBeNull();
    expect(approvalNotice('done', null)).toBeNull();
  });
});

// A copy of the web's rules (Web Portal/frontend/src/lib/approvals.ts): these fail when the copies
// drift (skipped where the website isn't checked out next to the extension).
const repo = resolve(__dirname, '../..');
const WEB = resolve(repo, 'Web Portal/frontend/src/lib/approvals.ts');
const web = existsSync(WEB) ? await import(pathToFileURL(WEB).href) : null;

describe.skipIf(!web)('src/approvals.js matches the web (lib/approvals.ts)', () => {
  const TASKS = [
    null,
    undefined,
    {},
    { key: 'A-1', columnId: 'c2', approvalRequestedAt: null },
    { key: 'A-2', columnId: 'c2', approvalRequestedAt: '2026-10-30T08:00:00Z' },
    { key: 'A-3', columnId: 'c3', approvalRequestedAt: '2026-10-30T08:00:00Z' },
    { key: 'رگ-5', columnId: 'c2', approvalRequestedAt: '2026-10-29T21:00:00+03:00' },
  ];
  it('the same answer to “is it waiting?”', () => {
    for (const t of TASKS) expect(isWaitingForApproval(t), JSON.stringify(t)).toBe(web.isWaitingForApproval(t));
  });
  it('the same notice after a move', () => {
    for (const asked of ['c2', 'c3']) {
      for (const t of TASKS) expect(approvalNotice(asked, t), `${asked} ${JSON.stringify(t)}`).toBe(web.approvalNotice(asked, t));
    }
  });
  it('the same words for Approve and Send back (buttons, the dialog, what is said once done)', () => {
    expect(DECISION_WORDS).toEqual({ ...web.DECISION_WORDS });
    expect(REASON_MAX).toBe(web.REASON_MAX);
    for (const key of ['RIG-4', 'رگ-5']) {
      for (const f of ['approveLabel', 'sendBackLabel', 'sendBackTitle', 'approvedNotice', 'sentBackNotice']) {
        const mine = { approveLabel, sendBackLabel, sendBackTitle, approvedNotice, sentBackNotice }[f];
        expect(mine(key), `${f} ${key}`).toBe(web[f](key));
      }
    }
    expect(sendBackNote('Pressure test report')).toBe(web.sendBackNote('Pressure test report'));
  });
});
