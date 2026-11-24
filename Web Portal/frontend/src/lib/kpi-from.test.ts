import { describe, it, expect } from 'vitest';
import { kpiLinkState, kpiMenuOrigin } from './kpi-from';

describe('kpiMenuOrigin (1.24.6)', () => {
  it('another person’s KPI page: the page it was opened from', () => {
    expect(kpiMenuOrigin('/performance/u1', kpiLinkState('/projects'))).toBe('/projects');
    expect(kpiMenuOrigin('/performance/u1/', kpiLinkState('/workload'))).toBe('/workload');
  });
  it('unknown or missing origin: Workload', () => {
    expect(kpiMenuOrigin('/performance/u1', null)).toBe('/workload');
    expect(kpiMenuOrigin('/performance/u1', { kpiFrom: '/admin' })).toBe('/workload');
    expect(kpiMenuOrigin('/performance/u1', 'x')).toBe('/workload');
  });
  it('every other page: nothing', () => {
    for (const p of ['/performance', '/performance/', '/workload', '/performance/u1/x', '/projects/p1']) expect(kpiMenuOrigin(p, kpiLinkState('/projects'))).toBeNull();
  });
});
