import { describe, it, expect } from 'vitest';
import { binBannerText, binCountdown, binDay, DELETE_ASK, eraseText, restoreText, seriesDeleteAsk } from './recycle-bin';

describe('the countdown before a deleted task is erased', () => {
  it('"12 days left"; amber at 7 or less, red at 2 or less; "Erased tonight" on the last day', () => {
    expect(binCountdown(60)).toEqual({ text: '60 days left', tone: 'neutral' });
    expect(binCountdown(8)).toEqual({ text: '8 days left', tone: 'neutral' });
    expect(binCountdown(7)).toEqual({ text: '7 days left', tone: 'warning' });
    expect(binCountdown(3)).toEqual({ text: '3 days left', tone: 'warning' });
    expect(binCountdown(2)).toEqual({ text: '2 days left', tone: 'danger' });
    expect(binCountdown(1)).toEqual({ text: '1 day left', tone: 'danger' });
    expect(binCountdown(0)).toEqual({ text: 'Erased tonight', tone: 'danger' });
    expect(binCountdown(-3)).toEqual({ text: 'Erased tonight', tone: 'danger' });
  });
});

describe('words', () => {
  const TZ = 'Asia/Muscat';
  it('a day: "3 Nov" this year, "3 Nov 2025" another year (company time)', () => {
    expect(binDay('2026-11-02T21:30:00Z', TZ, '2026-11-10')).toBe('3 Nov');
    expect(binDay('2025-11-03T06:00:00Z', TZ, '2026-11-10')).toBe('3 Nov 2025');
  });

  it('the banner says who deleted it, when, and how long is left (who: only when it was recorded)', () => {
    const bin = { deletedAt: '2026-11-03T06:00:00Z', deletedBy: { id: 'u1', name: 'Ali Hassan' }, daysLeft: 53 };
    expect(binBannerText(bin, TZ, '2026-11-10')).toBe('In the Recycle Bin — deleted by Ali Hassan on 3 Nov · 53 days left');
    expect(binBannerText({ ...bin, deletedBy: null, daysLeft: 0 }, TZ, '2026-11-10')).toBe('In the Recycle Bin — deleted on 3 Nov · Erased tonight');
  });

  it('asking before a delete', () => {
    expect(DELETE_ASK).toBe('Move to the Recycle Bin? You (or an admin) can restore it for 60 days.');
    expect(seriesDeleteAsk(12)).toBe('This is a repeating task — move this copy or the entire series (12 tasks) to the Recycle Bin? You (or an admin) can restore them for 60 days.');
    expect(seriesDeleteAsk(null)).toBe('This is a repeating task — move this copy or the entire series to the Recycle Bin? You (or an admin) can restore them for 60 days.');
  });

  it('what a restore did, and why some weren’t', () => {
    const t = (id: string, key: string) => ({ id, key, title: '', projectId: 'p' });
    const archived = (id: string, key: string) => ({ id, key, title: 'x', reason: 'archived' as const, message: 'Its project is archived.' });
    const gone = (id: string) => ({ id, reason: 'not_found' as const, message: 'It isn’t in the Recycle Bin any more.' });
    expect(restoreText({ restored: [t('a', 'RIG-12')], notRestored: [] })).toBe('Restored RIG-12.');
    expect(restoreText({ restored: [t('a', 'RIG-1'), t('b', 'RIG-2')], notRestored: [] })).toBe('Restored 2 tasks.');
    expect(restoreText({ restored: [t('a', 'RIG-1')], notRestored: [archived('c', 'OPS-4')] })).toBe('Restored RIG-1. OPS-4 wasn’t restored: its project is archived. Unarchive the project first.');
    expect(restoreText({ restored: [], notRestored: [archived('c', 'OPS-4')] })).toBe('OPS-4 wasn’t restored: its project is archived. Unarchive the project first.');
    expect(restoreText({ restored: [], notRestored: [archived('c', 'OPS-4'), archived('d', 'OPS-5')] })).toBe('OPS-4 and OPS-5 weren’t restored: their projects are archived. Unarchive them first.');
    expect(restoreText({ restored: [], notRestored: [gone('z')] })).toBe('It isn’t in the Recycle Bin any more.');
    expect(restoreText({ restored: [t('a', 'RIG-1')], notRestored: [gone('y'), gone('z')] })).toBe('Restored RIG-1. 2 were no longer in the Recycle Bin.');
  });

  it('what a delete forever did', () => {
    expect(eraseText({ erased: [{ id: 'a', key: 'RIG-12', title: 'Pump' }], notErased: [] })).toBe('Deleted RIG-12 forever.');
    expect(eraseText({ erased: [{ id: 'a', key: 'RIG-1', title: '' }, { id: 'b', key: 'RIG-2', title: '' }], notErased: [{ id: 'z', reason: 'not_found', message: 'gone' }] })).toBe('Deleted 2 tasks forever. 1 was no longer in the Recycle Bin.');
  });
});
