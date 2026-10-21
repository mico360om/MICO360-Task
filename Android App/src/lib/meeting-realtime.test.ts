import { describe, it, expect } from 'vitest';
import { MEETING_EVENTS, meetingEventRefreshes, meetingsReconnectRefreshes } from './meeting-realtime';

const exact = (...queryKey: string[]) => ({ queryKey, exact: true });
const lists = { queryKey: ['meetings'] };
const myItems = { queryKey: ['action-items', 'mine'] };

describe('meeting events (sent to the meeting’s project room and to its organizer, creator and attendees)', () => {
  it('listens to every meeting event the server sends', () => {
    expect([...MEETING_EVENTS]).toEqual([
      'meeting:created',
      'meeting:updated',
      'meeting:cancelled',
      'meeting:deleted',
      'meeting:attendees',
      'meeting:agenda',
      'meeting:notes',
      'meeting:action-items',
    ]);
  });

  it('a new meeting: the meeting lists (and the calendar) and its project’s meetings', () => {
    expect(meetingEventRefreshes('meeting:created', { id: 'm1' })).toEqual([lists, { projectMeetingsOf: 'm1' }]);
  });

  it('a changed or cancelled meeting: the lists, the meeting itself (not its parts) and its project’s meetings', () => {
    for (const ev of ['meeting:updated', 'meeting:cancelled']) {
      expect(meetingEventRefreshes(ev, { id: 'm1' })).toEqual([lists, exact('meeting', 'm1'), { projectMeetingsOf: 'm1' }]);
    }
  });

  it('a deleted meeting: the lists, everything of the meeting (which then says it’s gone) and My Action Items', () => {
    expect(meetingEventRefreshes('meeting:deleted', { id: 'm1' })).toEqual([lists, { queryKey: ['meeting', 'm1'] }, { projectMeetingsOf: 'm1' }, myItems]);
  });

  it('one part of a meeting: that part only, plus the cards’ counts where the part shows on them', () => {
    expect(meetingEventRefreshes('meeting:agenda', { id: 'm1' })).toEqual([exact('meeting', 'm1', 'agenda')]);
    expect(meetingEventRefreshes('meeting:attendees', { id: 'm1' })).toEqual([lists, exact('meeting', 'm1', 'attendees'), { projectMeetingsOf: 'm1' }]);
    expect(meetingEventRefreshes('meeting:notes', { id: 'm1' })).toEqual([lists, exact('meeting', 'm1', 'notes'), { projectMeetingsOf: 'm1' }]);
    expect(meetingEventRefreshes('meeting:action-items', { id: 'm1' })).toEqual([lists, exact('meeting', 'm1', 'action-items'), myItems, { projectMeetingsOf: 'm1' }]);
  });

  it('without a meeting id: everything about meetings (only what is on screen is fetched)', () => {
    expect(meetingEventRefreshes('meeting:notes', {})).toEqual(meetingsReconnectRefreshes());
    expect(meetingEventRefreshes('meeting:updated', null)).toEqual(meetingsReconnectRefreshes());
  });

  it('nothing for an event that isn’t about meetings', () => {
    expect(meetingEventRefreshes('task:moved', { id: 'm1' })).toEqual([]);
  });

  it('after a reconnect: the lists, every meeting’s parts, My Action Items and the projects’ meetings', () => {
    expect(meetingsReconnectRefreshes()).toEqual([lists, { queryKey: ['meeting'] }, myItems, { projectMeetingsOf: '' }]);
  });
});
