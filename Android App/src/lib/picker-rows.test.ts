import { describe, it, expect } from 'vitest';
import { PICKER_LIMIT, moreRowsText, pickerRows } from './picker-rows';
import { supportedTimeZones, timeZoneChoices } from './date-settings';

const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ value: `v${i}`, label: `Option ${String(i).padStart(3, '0')}`, hint: i === 7 ? 'special' : undefined }));

describe('a long list in a picker', () => {
  it('shows up to its limit and says how many more there are to find by typing', () => {
    const { shown, hidden } = pickerRows(opts(100), '', PICKER_LIMIT);
    expect(PICKER_LIMIT).toBe(60);
    expect(shown).toHaveLength(60);
    expect(hidden).toBe(40);
    expect(moreRowsText(hidden)).toBe('Type to find more (40 not shown).');
    expect(moreRowsText(0)).toBeNull();
  });

  it('with no limit shows everything', () => {
    const { shown, hidden } = pickerRows(opts(130), '', null);
    expect(shown).toHaveLength(130);
    expect(hidden).toBe(0);
  });

  it('narrows by the label or the hint', () => {
    expect(pickerRows(opts(100), 'special', 60).shown.map((o) => o.value)).toEqual(['v7']);
    expect(pickerRows(opts(100), 'OPTION 09', 60).shown.map((o) => o.value)).toEqual(Array.from({ length: 10 }, (_, i) => `v${90 + i}`));
  });

  it('every time zone, Asia/Muscat and Europe included, can be reached by scrolling', () => {
    const choices = timeZoneChoices({ zones: supportedTimeZones({}), company: 'Asia/Muscat', own: null, device: null });
    const { shown, hidden } = pickerRows(choices, '', null);
    expect(hidden).toBe(0);
    expect(shown.map((o) => o.value)).toEqual(expect.arrayContaining(['Asia/Muscat', 'Europe/London', 'Australia/Sydney', 'Pacific/Auckland', 'UTC']));
  });
});
