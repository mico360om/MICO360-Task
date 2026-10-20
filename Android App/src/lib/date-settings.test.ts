import { describe, it, expect } from 'vitest';
import { nextDateZones, parseDateZones } from './date-settings';

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
