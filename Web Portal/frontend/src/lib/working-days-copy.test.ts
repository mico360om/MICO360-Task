import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { workingDaysBetween, dayOffReason } from './working-days';

// The server owns the working-day rule (which days are worked, how many working days lie between
// two days); the website keeps an identical copy so a page counts "days late" and shades days off
// exactly as the server does. This fails when the copy drifts (skipped where the server's code isn't
// checked out): copy the server's file over this one.
const here = resolve(__dirname);
const server = resolve(here, '../../../backend/src/lib/working-days.ts');
const copy = resolve(here, 'working-days.ts');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('shared working-day rule', () => {
  it.skipIf(!existsSync(server))('src/lib/working-days.ts matches the server’s', () => {
    expect(existsSync(copy), 'the website keeps a copy of the server’s working-day rule').toBe(true);
    expect(read(copy)).toBe(read(server));
  });

  it('counts like the server: a Thursday due day is 1 working day late on Sunday (Sun–Thu week)', () => {
    const cal = { workingDays: [0, 1, 2, 3, 4], holidays: [{ day: '2026-11-18', name: 'National Day', recurring: true }] };
    expect(workingDaysBetween('2026-11-12', '2026-11-15', cal)).toBe(1);
    expect(dayOffReason('2027-11-18', cal)).toEqual({ kind: 'holiday', name: 'National Day' });
  });
});
