import { describe, it, expect, vi } from 'vitest';
import { createAttendeeService } from './attendee-service';
import { memoryAttendees } from './meeting-memory.fixture';

/** Meeting m1 of a series, with m2 and m3 after it. */
function setup() {
  const attendees = memoryAttendees();
  const onChanged = vi.fn();
  const onRemoved = vi.fn();
  const svc = createAttendeeService({
    attendees,
    onChanged,
    onRemoved,
    laterMeetings: async (meetingId) => (meetingId === 'm1' ? ['m2', 'm3'] : []),
  });
  return { attendees, onChanged, onRemoved, svc };
}

describe('attendees of a series meeting', () => {
  it('adds someone to this and the later meetings of the series', async () => {
    const t = setup();
    await t.attendees.add({ meetingId: 'm3', userId: 'u2' }); // already on m3
    const a = await t.svc.addAttendee('m1', { userId: 'u2', role: 'OPTIONAL' });
    expect(a.meetingId).toBe('m1');
    expect((await t.attendees.listByMeeting('m2')).map((x) => [x.userId, x.role])).toEqual([['u2', 'OPTIONAL']]);
    expect(await t.attendees.listByMeeting('m3')).toHaveLength(1);
    expect(t.onChanged.mock.calls.map((c) => c[0]).sort()).toEqual(['m1', 'm2']);
  });

  it('adds a guest to the later meetings too', async () => {
    const t = setup();
    await t.svc.addAttendee('m1', { externalName: 'Sara', externalEmail: 'sara@example.com' });
    expect((await t.attendees.listByMeeting('m3')).map((x) => x.externalEmail)).toEqual(['sara@example.com']);
  });

  it('takes someone off this and the later meetings, with one notice', async () => {
    const t = setup();
    const a = await t.svc.addAttendee('m1', { userId: 'u2' });
    await t.svc.addAttendee('m1', { externalName: 'Sara', externalEmail: 'sara@example.com' });
    await t.svc.removeAttendee('m1', a.id);
    for (const m of ['m1', 'm2', 'm3']) expect((await t.attendees.listByMeeting(m)).map((x) => x.externalName)).toEqual(['Sara']);
    expect(t.onRemoved).toHaveBeenCalledTimes(1);
    expect(t.onRemoved).toHaveBeenCalledWith('m1', expect.objectContaining({ id: a.id }), ['m2', 'm3']);
  });

  it('changes only this meeting when it is not in a series', async () => {
    const t = setup();
    const a = await t.svc.addAttendee('m9', { userId: 'u2' });
    expect(await t.attendees.listByMeeting('m2')).toEqual([]);
    await t.svc.removeAttendee('m9', a.id);
    expect(t.onRemoved).toHaveBeenCalledWith('m9', expect.objectContaining({ id: a.id }), []);
  });
});
