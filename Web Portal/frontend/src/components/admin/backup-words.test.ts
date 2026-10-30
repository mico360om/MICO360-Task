import { describe, it, expect } from 'vitest';
import { copyWhen, driveResultNote, scheduleText, sizeText } from './backup-words';

describe('System Settings → Backups: words', () => {
  it('sizes the way people read them', () => {
    expect(sizeText(0)).toBe('0 B');
    expect(sizeText(900)).toBe('900 B');
    expect(sizeText(1536)).toBe('1.5 KB');
    expect(sizeText(24.3 * 1024 * 1024)).toBe('24 MB');
    expect(sizeText(3.25 * 1024 * 1024 * 1024)).toBe('3.3 GB');
  });

  it('when a copy was made, in company time', () => {
    // 22:01 UTC is 02:01 the next morning in Muscat.
    expect(copyWhen('2026-10-29T22:01:00.000Z', 'Asia/Muscat')).toBe('30 Oct 2026, 02:01');
    // Day before month as everywhere else (lib/day-words): "Sep", never the "Sept" some browsers write.
    expect(copyWhen('2026-09-29T22:01:00.000Z', 'Asia/Muscat')).toBe('30 Sep 2026, 02:01');
    expect(copyWhen('2026-09-30T20:05:00.000Z', 'Asia/Muscat')).toBe('1 Oct 2026, 00:05');
  });

  it('the schedule line', () => {
    expect(scheduleText({ enabled: true, hour: 2, timeZone: 'Asia/Muscat' })).toBe(
      'Every night at 02:00 (Asia/Muscat time) the server copies the whole database and every uploaded file. It keeps the last 7 nights, one copy a week for the 4 weeks before, and the 3 newest copies made with Back up now.',
    );
    expect(scheduleText({ enabled: false, hour: 2, timeZone: 'Asia/Muscat' })).toBe('Nightly copies are turned off on this server. You can still make one with Back up now.');
  });

  it('what Google said after Connect', () => {
    expect(driveResultNote('connected')).toEqual({ ok: true, text: 'Google Drive is connected. Each new copy will also go there.' });
    expect(driveResultNote('denied')).toEqual({ ok: false, text: 'Google Drive wasn’t connected: access wasn’t allowed on Google’s page.' });
    expect(driveResultNote('failed')).toEqual({ ok: false, text: 'Google Drive couldn’t be connected. Please try again.' });
    expect(driveResultNote(null)).toBeNull();
    expect(driveResultNote('whatever')).toBeNull();
  });
});
