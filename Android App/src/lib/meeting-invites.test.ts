import { describe, it, expect } from 'vitest';
import { ApiError, NetworkError } from './api-client';
import { inviteChoice, inviteFailure, inviteRequest, keepsSendKey, minutesChoice, people, sendFailure, sendSummary } from './meeting-invites';
import type { InvitePreview, MinutesPreview, Recipient } from './types';

const r = (email: string, alreadyInvited = false): Recipient => ({ name: email.split('@')[0]!, email, kind: 'member', attendeeIds: [email], alreadyInvited });
const preview = (over: Partial<InvitePreview> = {}): InvitePreview => ({ recipients: [r('a@x.co', true), r('b@x.co'), r('c@x.co')], missingEmail: [], problems: [], invitesSentAt: null, ...over });

describe('sending invitations', () => {
  it('the first time: everyone, and a draft is scheduled as it is sent', () => {
    const first = inviteChoice(preview(), { status: 'DRAFT', invitesSentAt: null }, null);
    expect(first).toMatchObject({ sentBefore: null, effective: 'all', blocked: false, sendLabel: 'Schedule and send to 3 people' });
    expect(inviteRequest(first)).toEqual({});
  });

  it('once they went out: only the people not invited yet, unless everyone is chosen again', () => {
    const sent = preview({ invitesSentAt: '2026-10-20T08:00:00.000Z' });
    const onlyNew = inviteChoice(sent, { status: 'SCHEDULED', invitesSentAt: '2026-10-20T08:00:00.000Z' }, null);
    expect(onlyNew).toMatchObject({ effective: 'new', sendLabel: 'Send to 2 people' });
    expect(onlyNew.fresh.map((x) => x.email)).toEqual(['b@x.co', 'c@x.co']);
    expect(inviteRequest(onlyNew)).toEqual({ onlyNew: true });
    const all = inviteChoice(sent, { status: 'SCHEDULED', invitesSentAt: '2026-10-20T08:00:00.000Z' }, 'all');
    expect(all).toMatchObject({ effective: 'all', sendLabel: 'Send to 3 people' });
    expect(inviteRequest(all)).toEqual({ resend: true });
    // Nobody new: everyone again is the only choice.
    const nobodyNew = inviteChoice(preview({ invitesSentAt: 'x', recipients: [r('a@x.co', true)] }), { status: 'SCHEDULED', invitesSentAt: 'x' }, null);
    expect(nobodyNew).toMatchObject({ effective: 'all', sendLabel: 'Send to 1 person' });
  });

  it('can’t be sent while something must be fixed first', () => {
    expect(inviteChoice(preview({ problems: [{ level: 'warning', message: 'No location' }] }), { status: 'SCHEDULED', invitesSentAt: null }, null).blocked).toBe(false);
    expect(inviteChoice(preview({ problems: [{ level: 'error', message: 'No start time' }] }), { status: 'SCHEDULED', invitesSentAt: null }, null).blocked).toBe(true);
  });

  it('reports the send, person by person, and a send made elsewhere meanwhile', () => {
    expect(sendSummary({ sent: 3, failed: 0 }, 'Invitation')).toEqual({ text: 'Invitation sent to 3 of 3.', failed: false });
    expect(sendSummary({ sent: 1, failed: 1, recipients: [{ name: 'a', email: 'a@x.co', kind: 'member', ok: true }, { name: 'b', email: 'b@x.co', kind: 'guest', ok: false }] }, 'Minutes')).toEqual({
      text: 'Minutes sent to 1 of 2. 1 couldn’t be delivered.',
      failed: true,
    });
    expect(inviteFailure(new ApiError(409, 'INVITES_ALREADY_SENT', 'x'))).toEqual({ text: 'Invitations were just sent from somewhere else. Check who has one, then choose again.', reload: true });
    expect(inviteFailure(new ApiError(403, 'FORBIDDEN', 'x'))).toEqual({ text: 'Couldn’t send the invitations. You don’t have permission to do that.', reload: false });
    expect(people(1)).toBe('1 person');
    expect(people(0)).toBe('0 people');
  });
});

describe('a send that got no answer', () => {
  it('may still be going: tapping again (with the same key) reports it instead of sending twice', () => {
    expect(sendFailure(new NetworkError('slow', { timedOut: true }), 'Couldn’t email the minutes.')).toBe(
      'The server took too long to answer — it may still be sending. Tap Send again to see what happened: nobody gets it twice.',
    );
    expect(sendFailure(new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'x'), 'Couldn’t email the minutes.')).toBe('Still sending — try again in a moment.');
    expect(sendFailure(new ApiError(403, 'FORBIDDEN', 'x'), 'Couldn’t email the minutes.')).toBe('Couldn’t email the minutes. You don’t have permission to do that.');
    expect(inviteFailure(new NetworkError('slow', { timedOut: true })).text).toMatch(/^The server took too long/);
    expect([keepsSendKey(new NetworkError('x')), keepsSendKey(new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'x')), keepsSendKey(new ApiError(400, 'VALIDATION', 'x'))]).toEqual([true, true, false]);
  });
});

describe('emailing the minutes', () => {
  const mp: MinutesPreview = { subject: 'Minutes', html: '<p/>', text: 'Hello', attachmentName: 'minutes.pdf', recipients: [r('a@x.co'), r('b@x.co')], missingEmail: [] };

  it('goes to everyone unless someone is left out (then only to those chosen)', () => {
    expect(minutesChoice(mp, new Set())).toEqual({ chosen: mp.recipients, recipients: undefined, sendLabel: 'Send to 2 people', canSend: true });
    expect(minutesChoice(mp, new Set(['a@x.co']))).toEqual({ chosen: [mp.recipients[1]], recipients: ['b@x.co'], sendLabel: 'Send to 1 person', canSend: true });
    expect(minutesChoice(mp, new Set(['a@x.co', 'b@x.co']))).toMatchObject({ chosen: [], canSend: false });
  });
});
