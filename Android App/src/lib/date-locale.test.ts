/**
 * Review Focus 2: a phone set to US English or Arabic still reads every date and time the website's
 * way — "30 Oct 2026", "Fri 30 Oct", 24-hour "09:05", Latin digits. The phone's language is faked by
 * making it the default of every Intl.DateTimeFormat made without a locale.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { appSources } from '../testing/web-source';
import type { ApiTask } from './types';

const task = (over: Partial<ApiTask> = {}): ApiTask => ({
  id: 't1', key: 'MICO-1', title: 'Pour the slab', description: null, projectId: 'p1', columnId: 'c1', position: 0,
  priority: 'NORMAL', startDate: null, dueDate: null, estimatedHours: null, progress: 0, completedAt: null, ...over,
});

const Real = Intl.DateTimeFormat;
for (const phone of ['en-US', 'ar-EG']) {
  describe(`a phone in ${phone}`, () => {
    beforeAll(() => {
      vi.resetModules();
      // Every Intl member kept (they aren't enumerable, so a spread would drop them); only the default locale changes.
      const fake = Object.defineProperties({}, Object.getOwnPropertyDescriptors(Intl)) as typeof Intl;
      Object.defineProperty(fake, 'DateTimeFormat', {
        value: new Proxy(Real, {
          construct: (T, [l, o]) => new T(l ?? phone, o),
          apply: (T, _t, [l, o]) => new T(l ?? phone, o),
        }),
      });
      vi.stubGlobal('Intl', fake);
    });
    afterAll(() => vi.unstubAllGlobals());

    it('the fake really is the phone’s language', () => {
      expect(new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date('2026-10-30T12:00:00Z'))).not.toBe('30 Oct');
    });

    it('every date the app writes is day-first English with Latin digits and a 24-hour clock', async () => {
      const TZ = 'Asia/Muscat';
      const NOW = new Date('2026-10-30T08:00:00Z');
      expect((await import('./board')).cardDueText('2026-10-20', TZ)).toBe('20 Oct 2026');
      expect((await import('./board-date')).formatKeyLabel('2026-10-30')).toBe('Fri 30 Oct 2026');
      expect((await import('./due-date')).formatDueDay('2026-09-30T00:00:00.000Z', TZ)).toBe('30 Sep 2026');
      expect((await import('./task-detail')).dueState({ dueDate: '2026-11-02' }, NOW, TZ).text).toBe('Due 2 Nov 2026');
      expect((await import('./meetings')).clockTime('2026-10-30T05:05:00Z', TZ)).toBe('09:05');
      expect((await import('./meeting-detail')).meetingWhen({ startAt: '2026-10-30T05:05:00Z', endAt: '2026-10-30T06:30:00Z' }, TZ)).toEqual({ day: 'Fri 30 Oct', time: '09:05 – 10:30' });
      expect((await import('./meeting-list')).dateLeafParts('2026-09-04T05:00:00Z', TZ)).toEqual({ weekday: 'FRI', day: '4', month: 'SEP' });
      expect((await import('./project-list')).projectDates('2026-09-01', '2026-12-31', TZ)).toBe('1 Sep 2026 → 31 Dec 2026');
      expect((await import('./chat-ui')).messageClock('2026-10-30T05:05:00Z')).toMatch(/^\d{2}:\d{2}$/);
      expect((await import('./my-tasks')).enrichMyTasks([task({ dueDate: '2026-10-30' })], [], { timeZone: TZ, now: NOW })[0]!.dueLabel).toBe('30 Oct');
      expect((await import('./task-detail')).carryForward([{ from: '2026-10-20', to: '2026-10-21' }])!.text).toBe('Carried forward 1× · since 20 Oct 2026');
      expect((await import('./meeting-detail')).approvedLine({ approvedBy: { name: 'Aisha Khan' }, approvedAt: '2026-10-10T06:30:00Z' } as never, TZ)).toBe('Approved by Aisha Khan on 10 Oct 2026, 10:30.');
      expect((await import('./meeting-list')).startsLabel({ status: 'SCHEDULED', startAt: '2026-11-06T05:05:00Z', endAt: null } as never, NOW, TZ)).toBe('Fri 6 Nov at 09:05');
      expect((await import('./task-detail')).meetingLine({ id: 'm1', title: 'Site walk', startAt: '2026-10-30T05:05:00Z', canView: true } as never, TZ)!.text).toBe('From meeting: Site walk · Fri 30 Oct');
      expect((await import('./chat-ui')).listTime('2026-10-20T05:05:00Z', NOW)).toBe('20 Oct');
      expect((await import('./meeting-detail')).actionDueText({ dueDate: '2026-11-02', status: 'OPEN' } as never, NOW, TZ)).toBe('Due 2 Nov 2026');
    });
  });
}

// Day-words' own formatters (a fixed 'en-CA' / 'en-GB') and the formatter cache (its callers are
// checked to pass a literal locale) are the only places that make an Intl.DateTimeFormat from a name.
const FIXED_LOCALE_MAKERS = ['lib/day-words.ts', 'lib/intl-cache.ts'];
// A month or weekday in words from Intl ("Sept" in newer ICU data, the phone's words without a
// locale): inside a dateFormat / Intl.DateTimeFormat call, or anywhere in a file that builds
// Intl.DateTimeFormatOptions. (calendar.dayLabel's parts use the same names but are fixed English.)
const INTL_WORDS_CALL = /(?:dateFormat|DateTimeFormat)\([^;]*?\b(?:month|weekday):\s*'(?:short|long|narrow)'/;
const WORD_PARTS = /\b(?:month|weekday):\s*'(?:short|long|narrow)'/;

it('no code asks the phone for its language', () => {
  const files = appSources();
  expect(files.length).toBeGreaterThan(100);
  for (const [file, text] of files) {
    expect(text, file).not.toMatch(/toLocale(Date|Time)String\(/);
    // Numbers too (final review L3): "4,000" as on the website, not "٤٬٠٠٠" or "4.000" — a literal locale always.
    expect(text, file).not.toMatch(/\.toLocaleString\(\s*(?!')/);
    expect(text, file).not.toMatch(/Intl\.NumberFormat\(\s*(?!')/);
    expect(text, file).not.toMatch(/(?<!function )dateFormat\(\s*(?!')/); // the locale is always a literal
    if (!FIXED_LOCALE_MAKERS.includes(file)) expect(text, file).not.toMatch(/new Intl\.DateTimeFormat\(\s*(?!'|\)\.resolvedOptions)/);
    if (file !== 'lib/day-words.ts') {
      expect(text, file).not.toMatch(INTL_WORDS_CALL);
      if (/Intl\.DateTimeFormatOptions/.test(text)) expect(text, file).not.toMatch(WORD_PARTS);
    }
  }
});

it('the formatter cache cannot be asked for the phone’s own language', async () => {
  const { appSource } = await import('../testing/web-source');
  expect(appSource('lib/intl-cache.ts')).toMatch(/export function dateFormat\(locale: string, /);
});
