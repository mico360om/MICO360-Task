import type { BusyMeetingsStore } from '../meetings/meeting-repository';

/**
 * Meeting free times (Meeting AI's suggestions, clashes and the day's busy strip) count work blocks as
 * busy time (owner, 11 Nov: "meeting free-time finding avoids them"). A block is never named there —
 * its title is never visible, so everyone sees "Busy" (a person's own calendar shows what it is).
 */
export function withWorkBlocks(
  meetings: BusyMeetingsStore,
  blocksOf: (userIds: string[], from: Date, to: Date) => Promise<{ id: string; userId: string; startAt: Date; endAt: Date }[]>,
): BusyMeetingsStore {
  const store: BusyMeetingsStore = {
    async busyBetween(userIds, from, to, excludeMeetingId) {
      const [rows, blocks] = await Promise.all([meetings.busyBetween(userIds, from, to, excludeMeetingId), userIds.length ? blocksOf(userIds, from, to) : []]);
      return [...rows, ...blocks.map((b) => ({ meetingId: `wb:${b.id}`, start: b.startAt, end: b.endAt, title: 'Busy', userIds: [b.userId] }))];
    },
  };
  if (meetings.visibleTo) {
    const visibleTo = meetings.visibleTo.bind(meetings);
    store.visibleTo = (ids, userId, projectIds) => visibleTo(ids.filter((id) => !id.startsWith('wb:')), userId, projectIds);
  }
  return store;
}
