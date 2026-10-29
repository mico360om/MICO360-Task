import { describe, it, expect } from 'vitest';
import { approvalOnEntry, isAwaitingApproval } from './task-approval';

const AT = new Date('2026-10-30T08:00:00Z');
const REVIEW = { id: 'review', category: 'REVIEW' };
const DONE = { columnId: 'done', category: 'DONE' };
const doing = { columnId: 'doing', columnCategory: 'IN_PROGRESS', completedAt: null };
const ctx = (o: Partial<Parameters<typeof approvalOnEntry>[2]> = {}) => ({ canApprove: false, actorId: 'u-sara', at: AT, waitColumn: REVIEW, ...o });

describe('approvalOnEntry: what entering a column does to a task that needs approval', () => {
  it('a task that doesn’t need approval completes as usual', () => {
    expect(approvalOnEntry({ ...doing, needsApproval: false }, DONE, ctx())).toEqual({ columnId: 'done', category: 'DONE', patch: {}, event: null, unchanged: false });
  });

  it('finished by someone who can’t approve: it waits in the first Review column, not done', () => {
    expect(approvalOnEntry({ ...doing, needsApproval: true }, DONE, ctx())).toEqual({
      columnId: 'review',
      category: 'REVIEW',
      patch: { approvalRequestedAt: AT, approvalRequestedById: 'u-sara' },
      event: 'REQUESTED',
      unchanged: false,
    });
  });

  it('without a Review column it waits where it is', () => {
    const d = approvalOnEntry({ ...doing, needsApproval: true }, DONE, ctx({ waitColumn: null }));
    expect(d).toMatchObject({ columnId: 'doing', category: 'IN_PROGRESS', event: 'REQUESTED' });
  });

  it('nobody named (a system step) can’t approve either: it waits', () => {
    expect(approvalOnEntry({ ...doing, needsApproval: true }, DONE, ctx({ actorId: null, canApprove: true }))).toMatchObject({ event: 'REQUESTED', patch: { approvalRequestedById: null } });
  });

  it('finished again while it waits (by someone who can’t approve): nothing changes', () => {
    const waiting = { ...doing, columnId: 'review', columnCategory: 'REVIEW', needsApproval: true, approvalRequestedAt: AT };
    expect(approvalOnEntry(waiting, DONE, ctx())).toEqual({ columnId: 'review', category: 'REVIEW', patch: {}, event: null, unchanged: true });
  });

  it('an approver moving a waiting task to Done approves it', () => {
    const waiting = { ...doing, columnId: 'review', columnCategory: 'REVIEW', needsApproval: true, approvalRequestedAt: AT };
    expect(approvalOnEntry(waiting, DONE, ctx({ canApprove: true, actorId: 'u-omar' }))).toEqual({
      columnId: 'done',
      category: 'DONE',
      patch: { approvedAt: AT, approvedById: 'u-omar', approvalRequestedAt: null, approvalRequestedById: null },
      event: 'APPROVED',
      unchanged: false,
    });
  });

  it('an approver finishing it themselves: done at once, approved by them', () => {
    expect(approvalOnEntry({ ...doing, needsApproval: true }, DONE, ctx({ canApprove: true, actorId: 'u-omar' }))).toMatchObject({
      columnId: 'done',
      event: 'APPROVED_ON_FINISH',
      patch: { approvedAt: AT, approvedById: 'u-omar' },
    });
  });

  it('moved by hand from where it waits to another open column: the request is withdrawn', () => {
    const waiting = { ...doing, columnId: 'review', columnCategory: 'REVIEW', needsApproval: true, approvalRequestedAt: AT };
    expect(approvalOnEntry(waiting, { columnId: 'doing', category: 'IN_PROGRESS' }, ctx())).toEqual({
      columnId: 'doing',
      category: 'IN_PROGRESS',
      patch: { approvalRequestedAt: null, approvalRequestedById: null },
      event: 'WITHDRAWN',
      unchanged: false,
    });
  });

  it('reordered within the column it waits in: still waiting', () => {
    const waiting = { ...doing, columnId: 'review', columnCategory: 'REVIEW', needsApproval: true, approvalRequestedAt: AT };
    expect(approvalOnEntry(waiting, { columnId: 'review', category: 'REVIEW' }, ctx())).toMatchObject({ patch: {}, event: null, unchanged: false });
  });

  it('re-opening an approved task clears the approval (it must be approved again)', () => {
    const approved = { columnId: 'done', columnCategory: 'DONE', completedAt: AT, needsApproval: true, approvedAt: AT };
    expect(approvalOnEntry(approved, { columnId: 'doing', category: 'IN_PROGRESS' }, ctx())).toMatchObject({ columnId: 'doing', patch: { approvedAt: null, approvedById: null }, event: null });
  });

  it('an already completed task moved between Done columns: nothing about approval', () => {
    const done = { columnId: 'done', columnCategory: 'DONE', completedAt: AT, needsApproval: true };
    expect(approvalOnEntry(done, { columnId: 'done2', category: 'DONE' }, ctx())).toMatchObject({ columnId: 'done2', patch: {}, event: null });
  });

  it('isAwaitingApproval: waiting means a request time is set', () => {
    expect(isAwaitingApproval({ approvalRequestedAt: AT })).toBe(true);
    expect(isAwaitingApproval({ approvalRequestedAt: '2026-10-30T08:00:00Z' })).toBe(true);
    expect(isAwaitingApproval({ approvalRequestedAt: null })).toBe(false);
    expect(isAwaitingApproval({})).toBe(false);
  });
});
