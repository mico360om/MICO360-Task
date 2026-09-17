import { describe, it, expect } from 'vitest';
import { buildDigests, type DigestTask } from './notification-digest';

const d = (iso: string) => new Date(iso);
const now = d('2026-03-10T09:00:00Z');

const tasks: DigestTask[] = [
  // overdue, assigned to u1 (and watched by u2)
  { id: 't1', key: 'MICO-1', title: 'Ship invoice', dueDate: d('2026-03-08T00:00:00Z'), columnCategory: 'TODO', recipientIds: ['u1', 'u2'] },
  // due today, assigned to u1
  { id: 't2', key: 'MICO-2', title: 'Call client', dueDate: d('2026-03-10T00:00:00Z'), columnCategory: 'IN_PROGRESS', recipientIds: ['u1'] },
  // future — excluded
  { id: 't3', key: 'MICO-3', title: 'Later', dueDate: d('2026-03-20T00:00:00Z'), columnCategory: 'TODO', recipientIds: ['u1'] },
  // overdue but DONE — excluded
  { id: 't4', key: 'MICO-4', title: 'Done thing', dueDate: d('2026-03-01T00:00:00Z'), columnCategory: 'DONE', recipientIds: ['u1'] },
  // no due date — excluded
  { id: 't5', key: 'MICO-5', title: 'Someday', dueDate: null, columnCategory: 'TODO', recipientIds: ['u1'] },
];

describe('buildDigests', () => {
  const digests = buildDigests(tasks, { now });
  const byUser = (id: string) => digests.find((x) => x.userId === id);

  it('buckets each recipient’s open tasks into overdue vs due-today', () => {
    const u1 = byUser('u1')!;
    expect(u1.overdue.map((i) => i.key)).toEqual(['MICO-1']);
    expect(u1.dueToday.map((i) => i.key)).toEqual(['MICO-2']);
  });

  it('includes watchers, not just assignees', () => {
    const u2 = byUser('u2')!;
    expect(u2.overdue.map((i) => i.key)).toEqual(['MICO-1']);
    expect(u2.dueToday).toEqual([]);
  });

  it('excludes done, future and no-due-date tasks, and users with nothing to report', () => {
    const u1 = byUser('u1')!;
    const keys = [...u1.overdue, ...u1.dueToday].map((i) => i.key);
    expect(keys).not.toContain('MICO-3');
    expect(keys).not.toContain('MICO-4');
    expect(keys).not.toContain('MICO-5');
    expect(digests.every((x) => x.overdue.length + x.dueToday.length > 0)).toBe(true);
  });

  it('returns nothing when there is nothing due or overdue', () => {
    expect(buildDigests([tasks[2]!, tasks[3]!, tasks[4]!], { now })).toEqual([]);
  });
});
