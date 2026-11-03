import { describe, it, expect } from 'vitest';
import { colleaguesOf } from './people';

const u = (id: string, colleague?: boolean) => ({ id, username: id, firstName: id, lastName: '', avatarUrl: null, ...(colleague === undefined ? {} : { colleague }) });

describe('colleaguesOf', () => {
  it('keeps the people I share a company with, and anyone an older server doesn’t mark', () => {
    expect(colleaguesOf([u('amy', true), u('ben', false), u('cy')]).map((p) => p.id)).toEqual(['amy', 'cy']);
  });
});
