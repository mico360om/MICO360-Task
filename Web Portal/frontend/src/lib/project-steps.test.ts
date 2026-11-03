import { describe, it, expect } from 'vitest';
import { defaultProjectOrder, projectOrderOf, projectOrderState } from './project-steps';

describe('the order Previous / Next project follow', () => {
  it('the Projects page hands its order on with the link (tab, filter and sort as shown)', () => {
    expect(projectOrderState(['p3', 'p1'])).toEqual({ projectOrder: ['p3', 'p1'] });
    expect(projectOrderOf({ projectOrder: ['p3', 'p1'] })).toEqual(['p3', 'p1']);
  });

  it('a project opened any other way has none (a direct link, a reload of a link)', () => {
    expect(projectOrderOf(null)).toBeNull();
    expect(projectOrderOf(undefined)).toBeNull();
    expect(projectOrderOf({ other: 1 })).toBeNull();
    expect(projectOrderOf({ projectOrder: 'p1' })).toBeNull();
    expect(projectOrderOf({ projectOrder: [1, 'p1'] })).toEqual(['p1']);
  });

  it('then: the person’s projects that aren’t archived, A–Z', () => {
    const projects = [
      { id: 'b', name: 'beta works', status: 'ACTIVE' as const },
      { id: 'z', name: 'Zulu', status: 'PLANNING' as const },
      { id: 'old', name: 'Alpha (old)', status: 'ARCHIVED' as const },
      { id: 'gone', name: 'Archived by its companies', status: 'ACTIVE' as const, archived: true },
      { id: 'a', name: 'Alpha', status: 'ON_HOLD' as const },
    ];
    expect(defaultProjectOrder(projects)).toEqual(['a', 'b', 'z']);
  });
});
