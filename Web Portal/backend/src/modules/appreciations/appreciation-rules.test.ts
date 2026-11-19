import { describe, expect, it } from 'vitest';
import {
  APPRECIATION_ICONS,
  APPRECIATION_THEMES,
  BUILT_IN_ICON_UPGRADES,
  BUILT_IN_TEMPLATES,
  canManageAppreciations,
  normaliseTheme,
  cleanNote,
  companyToday,
  noteNoticeTitle,
  dayWindow,
  fillPlaceholders,
  isLiveNow,
  isRealDay,
  scopeOfManager,
  statusOf,
} from './appreciation-rules';

const MUSCAT = 'Asia/Muscat'; // UTC+4
const at = (iso: string) => new Date(iso);

describe('the company-time-zone day', () => {
  it('runs from 00:00 to the next 00:00 company time (Muscat: 20:00 UTC the day before)', () => {
    const w = dayWindow('2026-11-18', MUSCAT);
    expect(w.startsAt.toISOString()).toBe('2026-11-17T20:00:00.000Z');
    expect(w.endsAt.toISOString()).toBe('2026-11-18T20:00:00.000Z');
  });

  it('a different time zone moves the window (New York, UTC-5 in November)', () => {
    const w = dayWindow('2026-11-18', 'America/New_York');
    expect(w.startsAt.toISOString()).toBe('2026-11-18T05:00:00.000Z');
    expect(w.endsAt.toISOString()).toBe('2026-11-19T05:00:00.000Z');
  });

  it('today follows the company zone, not UTC', () => {
    expect(companyToday(at('2026-11-17T20:30:00Z'), MUSCAT)).toBe('2026-11-18');
    expect(companyToday(at('2026-11-17T19:59:59Z'), MUSCAT)).toBe('2026-11-17');
  });

  it('only real calendar days pass', () => {
    expect(isRealDay('2026-11-18')).toBe(true);
    expect(isRealDay('2026-02-30')).toBe(false);
    expect(isRealDay('18 Nov')).toBe(false);
  });
});

describe('status at the day’s edges', () => {
  const w = dayWindow('2026-11-18', MUSCAT);
  const r = { ...w, acceptedAt: null, cancelledAt: null };
  it('scheduled until 00:00, active 00:00–23:59:59, expired from the next 00:00', () => {
    expect(statusOf(r, at('2026-11-17T19:59:59.999Z'))).toBe('SCHEDULED'); // 23:59:59 the day before
    expect(statusOf(r, w.startsAt)).toBe('ACTIVE'); // 00:00
    expect(statusOf(r, at('2026-11-18T19:59:00Z'))).toBe('ACTIVE'); // 23:59
    expect(statusOf(r, w.endsAt)).toBe('EXPIRED'); // 00:00 next day
    expect(isLiveNow(r, at('2026-11-18T19:59:59.999Z'))).toBe(true);
    expect(isLiveNow(r, w.endsAt)).toBe(false);
  });
  it('accepted and cancelled are kept whatever the clock says', () => {
    expect(statusOf({ ...r, acceptedAt: at('2026-11-18T05:00:00Z') }, at('2027-01-01T00:00:00Z'))).toBe('ACCEPTED');
    expect(statusOf({ ...r, cancelledAt: at('2026-11-10T05:00:00Z') }, at('2026-11-18T05:00:00Z'))).toBe('CANCELLED');
    expect(isLiveNow({ ...r, cancelledAt: at('2026-11-10T05:00:00Z') }, at('2026-11-18T05:00:00Z'))).toBe(false);
    // Accepted stays on the Dashboard all day.
    expect(isLiveNow({ ...r, acceptedAt: at('2026-11-18T05:00:00Z') }, at('2026-11-18T10:00:00Z'))).toBe(true);
  });
});

describe('templates and placeholders', () => {
  it('sixteen built-ins with unique keys (owner, 19 Nov: 10 more)', () => {
    expect(BUILT_IN_TEMPLATES.map((t) => t.name)).toEqual(['Outstanding Performance', 'Great Teamwork', 'Excellent Work', 'Innovation', 'Dedication', 'Employee of the Day', 'Safety Champion', 'Customer Hero', 'Problem Solver', 'Above and Beyond', 'Deadline Achiever', 'Leadership', 'Helping Hand', 'Quality Champion', 'Project Milestone', 'Work Anniversary']);
    expect(new Set(BUILT_IN_TEMPLATES.map((t) => t.key)).size).toBe(16);
  });
  it('fills {name}, {company} and {date}, leaving other braces', () => {
    expect(fillPlaceholders('Well done {name} of {company} on {date} {other}', { name: 'Sara Khan', company: 'Contoso', day: '2026-11-18' })).toBe('Well done Sara Khan of Contoso on 18 Nov 2026 {other}');
    expect(fillPlaceholders('{name}{name}', { name: 'A', company: '', day: '2026-01-02' })).toBe('AA');
  });
});

describe('who manages', () => {
  const base = { active: true, client: false, admin: false, managerView: false, appreciationManager: false };
  it('administrators and Appreciation managers; never a client, an inactive account, or an admin in Manager View without the switch', () => {
    expect(canManageAppreciations({ ...base, admin: true })).toBe(true);
    expect(canManageAppreciations({ ...base, appreciationManager: true })).toBe(true);
    expect(canManageAppreciations(base)).toBe(false);
    expect(canManageAppreciations({ ...base, admin: true, managerView: true })).toBe(false);
    expect(canManageAppreciations({ ...base, admin: true, managerView: true, appreciationManager: true })).toBe(true);
    expect(canManageAppreciations({ ...base, client: true, appreciationManager: true })).toBe(false);
    expect(canManageAppreciations({ ...base, active: false, admin: true })).toBe(false);
  });
  it('administrators reach every company, managers their own', () => {
    expect(scopeOfManager({ ...base, admin: true, companyIds: ['a'] })).toBeNull();
    expect(scopeOfManager({ ...base, appreciationManager: true, companyIds: ['a', 'b'] })).toEqual(['a', 'b']);
  });
});

describe('the note for the manager (1.24.1)', () => {
  it('plain text: trimmed, CRLF made LF, line breaks and tabs kept; control, bidi-override and zero-width marks dropped', () => {
    const c = (...codes: number[]) => String.fromCodePoint(...codes);
    expect(cleanNote(`  Hi${c(13, 10)}there${c(9)}!  `)).toBe(`Hi${c(10)}there${c(9)}!`);
    expect(cleanNote(`a${c(0, 7, 27, 127, 133, 0x202e, 0x2066, 0x200b, 0xfeff)}b`)).toBe('ab');
    expect(cleanNote(`شكرا ${c(0x200f)}جزيلا`)).toBe(`شكرا ${c(0x200f)}جزيلا`); // a right-to-left mark is kept
    expect(cleanNote(`  ${c(0x202e)} `)).toBeNull();
    expect(cleanNote(null)).toBeNull();
    expect(cleanNote(5 as never)).toBeNull();
  });

  it('the notice title: one line, the note cut at 80, a long name cut at 60 (fits 191)', () => {
    const c = (n: number) => String.fromCodePoint(n);
    expect(noteNoticeTitle('Sara Khan', `Thanks${c(10)}a lot`)).toBe('Sara Khan accepted your appreciation: “Thanks a lot”');
    const t = noteNoticeTitle('N'.repeat(191), 'x'.repeat(500));
    expect([...t].length).toBeLessThanOrEqual(191);
    expect(t).toBe(`${'N'.repeat(60)}… accepted your appreciation: “${'x'.repeat(80)}…”`);
  });
});

describe('colours and icons (1.24.4, owner 19 Nov)', () => {
  it('fourteen named themes and twenty icons, each name fitting the VarChar(16) columns', () => {
    expect(APPRECIATION_THEMES).toEqual(['ruby', 'ocean', 'emerald', 'amber', 'violet', 'slate', 'rose', 'coral', 'gold', 'lime', 'teal', 'sky', 'indigo', 'plum']);
    expect(APPRECIATION_ICONS).toEqual([
      'star', 'team', 'trophy', 'bulb', 'heart', 'medal',
      'shield', 'clock', 'rocket', 'target', 'thumbs-up', 'handshake', 'crown', 'flag', 'gift', 'sparkles', 'award', 'lightning', 'smile', 'sun',
    ]);
    for (const n of [...APPRECIATION_THEMES, ...APPRECIATION_ICONS]) expect(n.length).toBeLessThanOrEqual(16);
  });

  it('a theme is a name or a custom colour #rrggbb (stored in lower case); anything else is refused', () => {
    expect(normaliseTheme('ocean')).toBe('ocean');
    expect(normaliseTheme('#1E6091')).toBe('#1e6091');
    expect(normaliseTheme('#f5f5a0')).toBe('#f5f5a0');
    for (const bad of ['neon', 'Ocean', '#fff', '#12345g', '1e6091', '#1e60911', ' #1e6091', '', 5, null, undefined]) expect(normaliseTheme(bad as never)).toBeNull();
  });

  it('the four built-ins with a better icon: new installs get it, and each upgrade names the old icon it replaces', () => {
    const icon = (k: string) => BUILT_IN_TEMPLATES.find((t) => t.key === k)!.icon;
    expect(BUILT_IN_ICON_UPGRADES).toEqual([
      { key: 'safety-champion', from: 'medal', to: 'shield' },
      { key: 'deadline-achiever', from: 'trophy', to: 'clock' },
      { key: 'customer-hero', from: 'heart', to: 'handshake' },
      { key: 'leadership', from: 'trophy', to: 'crown' },
    ]);
    for (const u of BUILT_IN_ICON_UPGRADES) expect(icon(u.key)).toBe(u.to);
  });
});
