import { describe, it, expect } from 'vitest';
import { ApiError } from '../lib/api-client';
import { isArchivedRefusal, PROJECT_ARCHIVED_CODE } from './archived-notice-store';

// 1.22 QA: a change refused because the project is archived is said once, across the page, in the
// server's words ("This project is archived — reopen it first.") — a part of the page that also says
// "Please try again" would contradict it.
describe('isArchivedRefusal', () => {
  it('is the server refusing a change to an archived project', () => {
    expect(isArchivedRefusal(new ApiError(409, PROJECT_ARCHIVED_CODE, 'This project is archived — reopen it first.'))).toBe(true);
  });
  it('is not any other refusal, a network failure or nothing', () => {
    expect(isArchivedRefusal(new ApiError(409, 'VERSION_CONFLICT', 'Changed meanwhile'))).toBe(false);
    expect(isArchivedRefusal(new TypeError('Failed to fetch'))).toBe(false);
    expect(isArchivedRefusal(null)).toBe(false);
  });
});
