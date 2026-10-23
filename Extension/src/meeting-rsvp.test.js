import { describe, it, expect, vi } from 'vitest';
import { mutationRequest, describeMutation, sendOrQueue, flushQueue, makePerformMutation, getQueue, enqueue } from './queue.js';
import { applyPending } from './pending-overlay.js';
import { mustFollow, supersede, SUPERSEDED_MESSAGE } from './task-writes.js';
import { fakeStorage } from './test-helpers.js';

// Stage 6: your answer to a meeting invitation (Accept / Maybe / Decline) — sent now, or kept on
// this device until the connection is back, like the other changes.
const answer = (response, over = {}) => ({ kind: 'meeting.respond', userId: 'me', payload: { meetingId: 'm1', attendeeId: 'a1', response, ...over } });
const res = (status, body = { data: { id: 'a1' } }) => ({ ok: status < 300, status, json: async () => body, headers: { get: () => 'application/json' } });

describe('meeting.respond', () => {
  it('is PATCH /meetings/:id/attendees/:attendeeId with the answer only (an invitee may change only that)', () => {
    expect(mutationRequest(answer('ACCEPTED'))).toEqual({
      path: '/meetings/m1/attendees/a1',
      init: { method: 'PATCH', body: JSON.stringify({ response: 'ACCEPTED' }) },
    });
    expect(mutationRequest(answer('PENDING', { meetingId: 'a/b', attendeeId: '?x' })).path).toBe('/meetings/a%2Fb/attendees/%3Fx');
  });

  it('says what it is in Settings → Sync', () => {
    expect(describeMutation(answer('ACCEPTED', { title: 'Rig review' }))).toBe('Accept “Rig review”');
    expect(describeMutation(answer('TENTATIVE', { title: 'Rig review' }))).toBe('Answer Maybe to “Rig review”');
    expect(describeMutation(answer('DECLINED', { title: 'Rig review' }))).toBe('Decline “Rig review”');
    expect(describeMutation(answer('PENDING', { title: 'Rig review' }))).toBe('Take back your answer to “Rig review”');
    expect(describeMutation(answer('ACCEPTED'))).toBe('Accept a meeting');
  });

  it('shows on the meeting’s people until it has synced (the latest answer wins)', () => {
    const people = [{ id: 'a1', userId: 'me', response: 'PENDING', respondedAt: null }, { id: 'a2', userId: 'u2', response: 'DECLINED' }];
    const items = [{ id: 'q1', status: 'pending', ...answer('ACCEPTED') }, { id: 'q2', status: 'pending', ...answer('DECLINED') }];
    const { data, applied } = applyPending('meeting-attendees:m1', people, items);
    expect(applied).toBe(2);
    expect(data[0]).toMatchObject({ response: 'DECLINED', pending: true });
    expect(data[1]).toBe(people[1]);
    expect(people[0].response).toBe('PENDING'); // not changed in place
    expect(applyPending('meeting-attendees:m2', people, items).applied).toBe(0);
    expect(applyPending('meeting-attendees:m1', people, [{ ...items[0], status: 'failed' }]).applied).toBe(0);
  });

  it('two answers to one invitation reach the server in order: a new one waits behind one still queued', async () => {
    expect(mustFollow(answer('DECLINED'), answer('ACCEPTED'))).toBe(true);
    expect(mustFollow(answer('DECLINED'), answer('ACCEPTED', { attendeeId: 'a9' }))).toBe(false);
    expect(mustFollow(answer('DECLINED'), { kind: 'task.update', userId: 'me', payload: { id: 'm1' } })).toBe(false);

    const storage = fakeStorage();
    await enqueue(storage, answer('ACCEPTED'));
    const doFetch = vi.fn(async () => res(200));
    const r = await sendOrQueue(answer('DECLINED'), { doFetch, storage, userId: 'me' });
    expect(r).toMatchObject({ queued: true, syncNow: true });
    expect(doFetch).not.toHaveBeenCalled();
    expect((await getQueue(storage)).map((i) => i.payload.response)).toEqual(['ACCEPTED', 'DECLINED']);

    const sent = [];
    const perform = makePerformMutation(async (path, init) => { sent.push(JSON.parse(init.body).response); return res(200); });
    await flushQueue(storage, perform, { userId: 'me' });
    expect(sent).toEqual(['ACCEPTED', 'DECLINED']);
    expect(await getQueue(storage)).toEqual([]);
  });

  it('a newer answer that reached the server replaces an older one that failed (trying that again would undo it)', () => {
    const older = { id: 'q1', status: 'failed', ...answer('ACCEPTED') };
    expect(supersede({ id: 'q2', ...answer('DECLINED') }, older)).toMatchObject({ superseded: true, lastError: SUPERSEDED_MESSAGE });
    expect(supersede({ id: 'q2', ...answer('DECLINED', { attendeeId: 'a9' }) }, older)).toBe(older);
  });

  it('sent now while online; kept on this device when the server can’t be reached', async () => {
    const storage = fakeStorage();
    const online = await sendOrQueue(answer('ACCEPTED'), { doFetch: async () => res(200, { data: { id: 'a1', response: 'ACCEPTED' } }), storage, userId: 'me' });
    expect(online).toEqual({ queued: false, data: { id: 'a1', response: 'ACCEPTED' } });
    const off = await sendOrQueue(answer('DECLINED'), { doFetch: async () => { throw new TypeError('Failed to fetch'); }, storage, userId: 'me' });
    expect(off.queued).toBe(true);
    expect((await getQueue(storage))[0]).toMatchObject({ kind: 'meeting.respond', payload: { response: 'DECLINED' } });
  });

  it('a refusal (the meeting is cancelled, or you were taken off it) is the server’s own words', async () => {
    const storage = fakeStorage();
    const refuse = async () => res(403, { error: { code: 'FORBIDDEN', message: 'Only the organizer, the project manager or an admin can change the attendees.' } });
    await expect(sendOrQueue(answer('ACCEPTED'), { doFetch: refuse, storage, userId: 'me' })).rejects.toMatchObject({ status: 403, serverMessage: expect.stringContaining('organizer') });
  });
});
