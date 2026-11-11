import { describe, it, expect, beforeEach } from 'vitest';
import { archivedBannerText, archivedDay, archivedLine, clearArchiveNotice, mayArchiveTasks, showArchiveNotice, useArchiveNotice } from './task-archive';

const NOW = new Date('2026-11-11T08:00:00Z');
const TZ = 'Asia/Muscat';

describe('task archive words', () => {
  it('the day an archive happened: "3 Nov" this year, with the year another', () => {
    expect(archivedDay('2026-11-03T05:00:00Z', TZ, NOW)).toBe('3 Nov');
    expect(archivedDay('2025-12-30T05:00:00Z', TZ, NOW)).toBe('30 Dec 2025');
    // In the company's day: 22:00 UTC on 2 Nov is 3 Nov in Muscat.
    expect(archivedDay('2026-11-02T22:00:00Z', TZ, NOW)).toBe('3 Nov');
    expect(archivedDay('not a date', TZ, NOW)).toBe('');
  });

  it('the panel’s banner and a list row’s line', () => {
    expect(archivedBannerText({ archivedAt: '2026-11-03T05:00:00Z' }, 'Ali Hassan', TZ, NOW)).toBe('Archived on 3 Nov by Ali Hassan — read-only');
    expect(archivedBannerText({ archivedAt: '2026-11-03T05:00:00Z' }, null, TZ, NOW)).toBe('Archived on 3 Nov — read-only');
    expect(archivedBannerText({ archivedAt: null }, 'Ali', TZ, NOW)).toBe('');
    expect(archivedLine({ archivedAt: '2026-11-03T05:00:00Z' }, 'Ali', TZ, NOW)).toBe('Archived 3 Nov by Ali');
  });

  it('administrators and the people who run its project archive — never in an archived project', () => {
    const live = { status: 'ACTIVE', canManage: false };
    expect(mayArchiveTasks({ isAdmin: true, project: live })).toBe(true);
    expect(mayArchiveTasks({ isAdmin: false, project: live })).toBe(false);
    expect(mayArchiveTasks({ isAdmin: false, project: { ...live, canManage: true } })).toBe(true);
    expect(mayArchiveTasks({ isAdmin: true, project: { status: 'ARCHIVED' } })).toBe(false);
    expect(mayArchiveTasks({ isAdmin: true, project: { status: 'ACTIVE', archived: true } })).toBe(false);
    expect(mayArchiveTasks({ isAdmin: true, project: null })).toBe(false);
  });
});

describe('the archive notice', () => {
  beforeEach(() => clearArchiveNotice());
  it('"RIG-12 archived", the newest replacing the one before', () => {
    showArchiveNotice({ id: 't1', key: 'RIG-12' });
    expect(useArchiveNotice.getState().notice).toEqual({ text: 'RIG-12 archived', taskId: 't1', key: 'RIG-12' });
    showArchiveNotice({ id: 't2', key: 'RIG-13' });
    expect(useArchiveNotice.getState().notice?.key).toBe('RIG-13');
    clearArchiveNotice();
    expect(useArchiveNotice.getState().notice).toBeNull();
  });
});
