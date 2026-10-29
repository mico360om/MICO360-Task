import { describe, it, expect } from 'vitest';
import { APPROVAL_HINT, approvalNotice, isWaitingForApproval, waitingForText } from './approvals';

describe('task approvals in words', () => {
  it('waiting means a request time is set', () => {
    expect(isWaitingForApproval({ approvalRequestedAt: '2026-10-30T08:00:00Z' })).toBe(true);
    expect(isWaitingForApproval({ approvalRequestedAt: null })).toBe(false);
    expect(isWaitingForApproval({})).toBe(false);
    expect(isWaitingForApproval(undefined)).toBe(false);
  });

  it('says whose approval it waits for: the one person who runs the project, else a project manager', () => {
    expect(waitingForText('Omar Ahmed')).toBe('Waiting for Omar Ahmed’s approval');
    expect(waitingForText(null)).toBe('Waiting for a project manager’s approval');
    expect(waitingForText('  ')).toBe('Waiting for a project manager’s approval');
  });

  it('after a move to Done: a notice when the task waits instead (and only then)', () => {
    const waiting = { key: 'RIG-4', columnId: 'review', approvalRequestedAt: '2026-10-30T08:00:00Z' };
    expect(approvalNotice('done', waiting)).toBe('RIG-4 needs approval, so it’s waiting for a project manager.');
    expect(approvalNotice('done', { ...waiting, columnId: 'done', approvalRequestedAt: null })).toBeNull();
    // Moved where it was asked (an approver's own move, or a plain one): nothing to say.
    expect(approvalNotice('review', waiting)).toBeNull();
    expect(approvalNotice('done', undefined)).toBeNull();
  });

  it('the tick’s hint is one plain line', () => {
    expect(APPROVAL_HINT).toBe('A project manager must approve it before it counts as done.');
  });
});
