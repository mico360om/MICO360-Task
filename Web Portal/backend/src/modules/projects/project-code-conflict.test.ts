import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { isProjectCodeConflict } from './prisma-project-repository';

const unique = (target: unknown) => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0', meta: { target } });

describe('only the project code’s unique index means “that code is taken”', () => {
  it('is the code index (as MySQL names it, or as a field list)', () => {
    expect(isProjectCodeConflict(unique('projects_code_key'))).toBe(true);
    expect(isProjectCodeConflict(unique(['code']))).toBe(true);
  });

  it('is not another unique index hit while writing a project’s tasks or team', () => {
    expect(isProjectCodeConflict(unique('tasks_key_key'))).toBe(false);
    expect(isProjectCodeConflict(unique('PRIMARY'))).toBe(false);
    expect(isProjectCodeConflict(unique('task_checklists_pkey'))).toBe(false);
    expect(isProjectCodeConflict(unique(undefined))).toBe(false);
  });

  it('is not any other error', () => {
    expect(isProjectCodeConflict(new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '5.22.0', meta: { field_name: 'code' } }))).toBe(false);
    expect(isProjectCodeConflict(new Error('projects_code_key'))).toBe(false);
  });
});
