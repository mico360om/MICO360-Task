import { describe, it, expect } from 'vitest';
import { APPROVAL_HINT, DECISION_WORDS, REASON_MAX, approvalNotice, approveLabel, approvedNotice, isWaitingForApproval, sendBackLabel, sendBackNote, sendBackTitle, sentBackNotice, waitingForText } from './approvals';

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

  it('Approve and Send back in the same words everywhere (the Chrome extension keeps a copy)', () => {
    expect(DECISION_WORDS).toEqual({
      waiting: 'Waiting for approval',
      approve: 'Approve',
      sendBack: 'Send back',
      cancel: 'Cancel',
      reasonLabel: 'Why are you sending it back?',
      reasonPlaceholder: 'For example: the pressure readings are missing.',
      reasonMissing: 'Write a reason first.',
    });
    expect(approveLabel('RIG-4')).toBe('Approve RIG-4');
    expect(sendBackLabel('RIG-4')).toBe('Send RIG-4 back');
    expect(sendBackTitle('RIG-4')).toBe('Send RIG-4 back?');
    expect(sendBackNote('Pressure test report')).toBe('Pressure test report goes back to In progress. Your reason is added as a comment and sent to the people on it.');
    expect(approvedNotice('RIG-4')).toBe('Approved RIG-4.');
    expect(sentBackNotice('RIG-4')).toBe('Sent RIG-4 back.');
    expect(REASON_MAX).toBe(2000);
  });

  it('the tick’s hint is one plain line', () => {
    expect(APPROVAL_HINT).toBe('A project manager must approve it before it counts as done.');
  });
});
