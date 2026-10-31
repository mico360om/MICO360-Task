import { describe, it, expect } from 'vitest';
import { DELETE_NOT_ALLOWED, DELETE_NOT_ALLOWED_CODE, DELETE_SERIES_NOT_ALLOWED, mayDeleteSeries, mayDeleteTask } from './task-delete-rule';

// The owner's rule (1.20.0): whoever may delete tasks at all (an admin, or someone who runs the
// task's project) may delete one only if they created it or it is assigned to them and nobody else.
const me = 'me';
const facts = (over: Partial<Parameters<typeof mayDeleteTask>[0]> = {}) => ({ viewerId: me, mayManage: true, createdById: 'someone', assigneeIds: [] as string[], ...over });

describe('who may delete a task', () => {
  // An admin and a project manager are the same here: both arrive as `mayManage`.
  for (const who of ['an admin', 'a project manager']) {
    describe(who, () => {
      it('may delete a task they created, whoever it is assigned to', () => {
        expect(mayDeleteTask(facts({ createdById: me }))).toBe(true);
        expect(mayDeleteTask(facts({ createdById: me, assigneeIds: ['a', 'b'] }))).toBe(true);
        expect(mayDeleteTask(facts({ createdById: me, assigneeIds: ['a'] }))).toBe(true);
      });

      it('may delete a task someone else created when it is assigned to them alone', () => {
        expect(mayDeleteTask(facts({ assigneeIds: [me] }))).toBe(true);
      });

      it('may not delete a task someone else created that is assigned to them and others', () => {
        expect(mayDeleteTask(facts({ assigneeIds: [me, 'a'] }))).toBe(false);
        expect(mayDeleteTask(facts({ assigneeIds: ['a', me, 'b'] }))).toBe(false);
      });

      it('may not delete a task someone else created that is unassigned, or assigned to others only', () => {
        expect(mayDeleteTask(facts({ assigneeIds: [] }))).toBe(false);
        expect(mayDeleteTask(facts({ assigneeIds: ['a'] }))).toBe(false);
        expect(mayDeleteTask(facts({ assigneeIds: ['a', 'b'] }))).toBe(false);
      });
    });
  }

  it('the same person listed twice is still one person', () => {
    expect(mayDeleteTask(facts({ assigneeIds: [me, me] }))).toBe(true);
  });

  it('someone who may not delete tasks at all (an employee) still may not — not even their own', () => {
    expect(mayDeleteTask(facts({ mayManage: false, createdById: me }))).toBe(false);
    expect(mayDeleteTask(facts({ mayManage: false, assigneeIds: [me] }))).toBe(false);
  });
});

describe('who may delete the entire series of a repeating task', () => {
  it('only the person who created the series (and who may delete tasks at all)', () => {
    expect(mayDeleteSeries({ viewerId: me, mayManage: true, seriesCreatorId: me })).toBe(true);
    expect(mayDeleteSeries({ viewerId: me, mayManage: true, seriesCreatorId: 'someone' })).toBe(false);
    expect(mayDeleteSeries({ viewerId: me, mayManage: false, seriesCreatorId: me })).toBe(false);
  });
});

describe('what a refusal says', () => {
  it('in plain words, with one code for every app', () => {
    expect(DELETE_NOT_ALLOWED_CODE).toBe('DELETE_NOT_ALLOWED');
    expect(DELETE_NOT_ALLOWED).toBe('Only the person who created this task, or the one person it’s assigned to, can delete it.');
    expect(DELETE_SERIES_NOT_ALLOWED).toBe('Only the person who created this repeating task can delete the entire series.');
  });
});
