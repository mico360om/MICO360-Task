import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatKpiTarget, formatKpiValue } from './kpi-format';

// The server owns how a KPI reads in words (its PDF and Excel say it too); the website keeps an
// identical copy so a tile says exactly what the files say. This fails when the copy drifts (skipped
// where the server's code isn't checked out): copy the server's file over this one.
const here = resolve(__dirname);
const server = resolve(here, '../../../backend/src/modules/kpis/kpi-format.ts');
const copy = resolve(here, 'kpi-format.ts');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('shared KPI words', () => {
  it.skipIf(!existsSync(server))('src/lib/kpi-format.ts matches the server’s', () => {
    expect(read(copy)).toBe(read(server));
  });

  it('reads like the server', () => {
    expect(formatKpiValue('progress', 'percent', 92)).toBe('Behind by 8%');
    expect(formatKpiTarget('daysLate', 'days', 'lower', 2)).toBe('At most 2 working days');
  });
});
