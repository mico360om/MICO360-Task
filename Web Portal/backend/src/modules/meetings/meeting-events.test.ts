import { describe, it, expect, vi } from 'vitest';
import { createMeetingEvents, meetingEventAudience } from './meeting-events';

describe('meeting realtime audience', () => {
  it('reaches a standalone meeting’s organizer, creator and internal attendees, de-duplicated', () => {
    expect(meetingEventAudience({ projectId: null, organizerId: 'u1', createdById: 'u1', attendeeUserIds: ['u2', 'u1', 'u3'] }))
      .toEqual({ projectId: null, userIds: ['u1', 'u2', 'u3'] });
  });

  it('keeps the project room for a project meeting, plus its people', () => {
    expect(meetingEventAudience({ projectId: 'p1', organizerId: 'u1', createdById: 'u9', attendeeUserIds: [] }))
      .toEqual({ projectId: 'p1', userIds: ['u1', 'u9'] });
  });

  it('publishes an event to the loaded audience, and reports (not throws) lookup failures', async () => {
    const emit = vi.fn();
    const onError = vi.fn();
    const events = createMeetingEvents({
      loadAudience: async (id) => {
        if (id === 'broken') throw new Error('db down');
        return id === 'm1' ? { projectId: null, organizerId: 'u1', createdById: 'u1', attendeeUserIds: ['u2'] } : null;
      },
      emit,
      onError,
    });
    await events.publish('m1', 'meeting:notes');
    expect(emit).toHaveBeenCalledWith({ projectId: null, userIds: ['u1', 'u2'] }, 'meeting:notes', { id: 'm1' });
    await events.publish('missing', 'meeting:updated');
    await events.publish('broken', 'meeting:updated');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
