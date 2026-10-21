import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { DATE_PREFERENCES_KEY, WEEK_START_OPTIONS, calendarZoneNote, datePrefsSavedText, deviceTimeZone, loadDateSettings, weekStartKnown, nextDateZones, parseDateZones, supportedTimeZones, timeZoneChoices, withDatePatch } from './date-settings';

const prev = { company: 'Asia/Dubai', own: 'Europe/London' };

describe('nextDateZones — the company’s zone and your own, as the website has them', () => {
  it('takes both from the server', () => {
    expect(nextDateZones(prev, { config: { timeZone: 'Asia/Riyadh' }, prefs: { timeZone: 'Asia/Karachi', weekStart: null } })).toEqual({
      company: 'Asia/Riyadh',
      own: 'Asia/Karachi',
    });
  });
  it('a load that failed (offline, a Wi-Fi sign-in page) keeps what the phone had', () => {
    expect(nextDateZones(prev, { config: null, prefs: null })).toEqual(prev);
    expect(nextDateZones(prev, { config: null, prefs: { timeZone: null, weekStart: null } })).toEqual({ company: 'Asia/Dubai', own: null });
    expect(nextDateZones(prev, { config: { timeZone: 'Asia/Riyadh' }, prefs: null })).toEqual({ company: 'Asia/Riyadh', own: 'Europe/London' });
  });
  it('a server zone that is missing or unknown falls back to Asia/Muscat', () => {
    expect(nextDateZones(prev, { config: {}, prefs: null }).company).toBe('Asia/Muscat');
    expect(nextDateZones(prev, { config: { timeZone: 'Mars/Olympus' }, prefs: null }).company).toBe('Asia/Muscat');
  });
  it('your own zone that is unknown counts as none (the company’s is used)', () => {
    expect(nextDateZones(prev, { config: null, prefs: { timeZone: 'Mars/Olympus', weekStart: null } }).own).toBeNull();
    expect(nextDateZones(prev, { config: null, prefs: { timeZone: '', weekStart: null } }).own).toBeNull();
  });
});

describe('parseDateZones — the zones the phone kept from last time', () => {
  it('reads what was saved', () => {
    expect(parseDateZones(JSON.stringify(prev))).toEqual(prev);
    expect(parseDateZones(JSON.stringify({ company: 'Asia/Dubai', own: null }))).toEqual({ company: 'Asia/Dubai', own: null });
  });
  it('nothing, junk or an unknown company zone: nothing', () => {
    expect(parseDateZones(null)).toBeNull();
    expect(parseDateZones('not json')).toBeNull();
    expect(parseDateZones(JSON.stringify({ company: 'Mars/Olympus', own: null }))).toBeNull();
    expect(parseDateZones(JSON.stringify(['Asia/Dubai']))).toBeNull();
  });
  it('an unknown own zone is dropped', () => {
    expect(parseDateZones(JSON.stringify({ company: 'Asia/Dubai', own: 'Mars/Olympus' }))).toEqual({ company: 'Asia/Dubai', own: null });
  });
});

describe('Settings → Calendar & dates (the website’s DatePreferences)', () => {
  it('offers the three week starts in the website’s order', () => {
    expect(WEEK_START_OPTIONS).toEqual([
      { value: 6, label: 'Saturday' },
      { value: 0, label: 'Sunday' },
      { value: 1, label: 'Monday' },
    ]);
  });

  it('changes only what was chosen, the rest as it was (null = the default)', () => {
    expect(withDatePatch({ timeZone: 'Asia/Dubai', weekStart: 6 }, { weekStart: 1 })).toEqual({ timeZone: 'Asia/Dubai', weekStart: 1 });
    expect(withDatePatch(undefined, { timeZone: 'Europe/London' })).toEqual({ timeZone: 'Europe/London', weekStart: null });
    expect(withDatePatch({ timeZone: 'Asia/Dubai', weekStart: null }, { timeZone: null })).toEqual({ timeZone: null, weekStart: null });
  });

  it('says which zone the calendar uses, in the website’s words', () => {
    expect(calendarZoneNote(null, 'Asia/Muscat')).toBe('Dates use the company time zone (Asia/Muscat). Due dates without a time always stay on their day.');
    expect(calendarZoneNote('Europe/London', 'Asia/Muscat')).toBe('Your own: Europe/London. Due dates without a time always stay on their day.');
  });

  it('lists the zones the phone knows; without the full list (Hermes), a list of its own', () => {
    expect(supportedTimeZones({ supportedValuesOf: () => ['Asia/Dubai', 'Europe/London'] })).toEqual(['Asia/Dubai', 'Europe/London']);
    const fallback = supportedTimeZones({});
    expect(fallback.length).toBeGreaterThan(100);
    expect(fallback).toContain('Asia/Muscat');
    expect(fallback).toContain('UTC');
    expect(fallback).toContain('America/New_York');
    expect(new Set(fallback).size).toBe(fallback.length);
  });

  it('labels each zone as the website does, marks the company’s and this phone’s, and always has the chosen one', () => {
    const choices = timeZoneChoices({ zones: ['Asia/Dubai', 'Asia/Muscat', 'America/New_York'], company: 'Asia/Muscat', own: 'Pacific/Chatham', device: 'Asia/Dubai' });
    expect(choices).toEqual([
      { value: 'America/New_York', label: 'America/New York' },
      { value: 'Asia/Dubai', label: 'Asia/Dubai', hint: 'this phone' },
      { value: 'Asia/Muscat', label: 'Asia/Muscat', hint: 'company' },
      { value: 'Pacific/Chatham', label: 'Pacific/Chatham' },
    ]);
    expect(timeZoneChoices({ zones: ['Asia/Muscat'], company: 'Asia/Muscat', own: null, device: 'Asia/Muscat' })).toEqual([{ value: 'Asia/Muscat', label: 'Asia/Muscat', hint: 'company · this phone' }]);
  });
});

describe('this phone’s own time zone', () => {
  it('is the one the phone reports, when it is a real zone', () => {
    expect(deviceTimeZone(() => 'Asia/Dubai')).toBe('Asia/Dubai');
    expect(deviceTimeZone(() => 'Not/AZone')).toBeNull();
    expect(deviceTimeZone(() => undefined)).toBeNull();
    expect(deviceTimeZone(() => { throw new Error('no Intl'); })).toBeNull();
  });
});

describe('what TalkBack hears after a date setting is saved', () => {
  it('names what changed (the screens open again for a new time zone, so it must be said)', () => {
    expect(datePrefsSavedText({ timeZone: null, weekStart: 0 }, { timeZone: null, weekStart: 1 })).toBe('Saved. Weeks start on Monday.');
    expect(datePrefsSavedText({ timeZone: null, weekStart: 0 }, { timeZone: 'Europe/London', weekStart: 0 })).toBe('Saved. The calendar uses Europe/London.');
    expect(datePrefsSavedText({ timeZone: 'Europe/London', weekStart: 6 }, { timeZone: null, weekStart: 6 })).toBe('Saved. The calendar uses the company time zone.');
    expect(datePrefsSavedText(undefined, { timeZone: null, weekStart: null })).toBe('Saved. Weeks start on Sunday.');
    expect(datePrefsSavedText({ timeZone: null, weekStart: 1 }, { timeZone: null, weekStart: 1 })).toBe('Saved.');
  });
});

describe('loadDateSettings (5a review: the calendar knows the week start on its first open)', () => {
  const makeQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const deps = (over: Partial<Parameters<typeof loadDateSettings>[0]> = {}) => {
    let zones = { company: 'Asia/Muscat', own: null as string | null };
    const kept: unknown[] = [];
    const d = {
      qc: makeQc(),
      config: async () => ({ timeZone: 'Asia/Dubai' }),
      readPrefs: vi.fn(async () => ({ timeZone: 'Europe/London', weekStart: 1 as const })),
      keepZones: async (z: unknown) => {
        kept.push(z);
      },
      zones: { get: () => zones, set: (z: typeof zones) => (zones = z) },
      ...over,
    };
    return { d, kept, zones: () => zones };
  };

  it('puts your date settings where the calendar reads them, so its first open has your week start', async () => {
    const { d } = deps();
    await loadDateSettings(d);
    expect(d.qc.getQueryData(DATE_PREFERENCES_KEY)).toEqual({ timeZone: 'Europe/London', weekStart: 1 });
  });

  it('sets and keeps both zones, as before', async () => {
    const { d, kept, zones } = deps();
    await loadDateSettings(d);
    expect(zones()).toEqual({ company: 'Asia/Dubai', own: 'Europe/London' });
    expect(kept).toEqual([{ company: 'Asia/Dubai', own: 'Europe/London' }]);
  });

  it('asks again each time (back in the app), even when the settings it has are fresh — they may have changed on the website', async () => {
    const { d } = deps();
    await loadDateSettings(d);
    await loadDateSettings(d);
    expect(d.readPrefs).toHaveBeenCalledTimes(2);
  });

  it('a load that failed keeps what the phone had; one that ended after the screen went changes nothing', async () => {
    const failed = deps({ config: async () => Promise.reject(new Error('offline')), readPrefs: vi.fn(async () => Promise.reject(new Error('offline'))) });
    await loadDateSettings(failed.d);
    expect(failed.zones()).toEqual({ company: 'Asia/Muscat', own: null });
    expect(failed.kept).toEqual([]);
    const gone = deps({ isActive: () => false });
    await loadDateSettings(gone.d);
    expect(gone.zones()).toEqual({ company: 'Asia/Muscat', own: null });
  });
});

describe('weekStartKnown — the calendar asks for its days once it knows how its weeks are laid out', () => {
  it('known once the settings are here, or their load has ended without them (the default is used)', () => {
    expect(weekStartKnown({ data: { timeZone: null, weekStart: 1 }, fetchStatus: 'fetching' })).toBe(true);
    expect(weekStartKnown({ data: undefined, fetchStatus: 'fetching' })).toBe(false);
    expect(weekStartKnown({ data: undefined, fetchStatus: 'idle' })).toBe(true);
    expect(weekStartKnown({ data: undefined, fetchStatus: 'paused' })).toBe(true);
  });
});

describe('loadDateSettings keeps your settings for the whole session', () => {
  it('they aren’t dropped after a few minutes with the calendar closed (it would open on a loader again)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let zones = { company: 'Asia/Muscat', own: null as string | null };
    await loadDateSettings({
      qc,
      config: async () => ({ timeZone: 'Asia/Muscat' }),
      readPrefs: async () => ({ timeZone: null, weekStart: 6 }),
      keepZones: async () => {},
      zones: { get: () => zones, set: (z) => (zones = z) },
    });
    expect(qc.getQueryCache().find({ queryKey: DATE_PREFERENCES_KEY })?.options.gcTime).toBe(Infinity);
  });
});
