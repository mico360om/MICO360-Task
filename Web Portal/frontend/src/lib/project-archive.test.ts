import { describe, it, expect } from 'vitest';
import { isProjectArchived } from './project-archive';

// Companies (spec §8): a project counts as archived when its own status is ARCHIVED or all of its
// companies are archived (the server's `archived`) — read-only and out of the pickers either way.
describe('isProjectArchived', () => {
  it('its own status, or all its companies archived', () => {
    expect(isProjectArchived({ status: 'ARCHIVED' })).toBe(true);
    expect(isProjectArchived({ status: 'ACTIVE', archived: true })).toBe(true);
    expect(isProjectArchived({ status: 'ACTIVE', archived: false })).toBe(false);
    expect(isProjectArchived({ status: 'ACTIVE' })).toBe(false);
    expect(isProjectArchived({ status: 'COMPLETED' })).toBe(false);
  });
});
