import { describe, it, expect } from 'vitest';
import { withWorkBlocks } from './busy-blocks';
import type { BusyMeetingsStore } from '../meetings/meeting-repository';

const at = (iso: string) => new Date(iso);

describe('meeting free times count planned work time as busy (owner 2) — never naming it', () => {
  const meetings: BusyMeetingsStore = {
    async busyBetween() {
      return [{ meetingId: 'm1', start: at('2026-11-12T05:00:00Z'), end: at('2026-11-12T06:00:00Z'), title: 'Site walk', userIds: ['ali'] }];
    },
    async visibleTo(ids) {
      return new Set(ids.filter((id) => id === 'm1'));
    },
  };
  const blocks = async (userIds: string[], from: Date, to: Date) => {
    void from;
    void to;
    return [
      { id: 'b1', userId: 'ali', startAt: at('2026-11-12T07:00:00Z'), endAt: at('2026-11-12T08:00:00Z') },
      { id: 'b2', userId: 'mona', startAt: at('2026-11-12T07:00:00Z'), endAt: at('2026-11-12T09:00:00Z') },
    ].filter((b) => userIds.includes(b.userId));
  };

  it('adds each person’s blocks as busy time, after the meetings', async () => {
    const store = withWorkBlocks(meetings, blocks);
    const rows = await store.busyBetween(['ali', 'mona'], at('2026-11-12T00:00:00Z'), at('2026-11-13T00:00:00Z'));
    expect(rows.map((r) => [r.meetingId, r.userIds])).toEqual([
      ['m1', ['ali']],
      ['wb:b1', ['ali']],
      ['wb:b2', ['mona']],
    ]);
  });

  it('a block is never visible by name: it shows as “Busy”', async () => {
    const store = withWorkBlocks(meetings, blocks);
    expect([...(await store.visibleTo!(['m1', 'wb:b1'], 'ali', null))]).toEqual(['m1']);
  });

  it('keeps the meetings’ own visibility check when there is one, and none when there isn’t', async () => {
    const plain = withWorkBlocks({ busyBetween: meetings.busyBetween }, blocks);
    expect(plain.visibleTo).toBeUndefined();
  });
});
