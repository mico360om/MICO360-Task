import { describe, it, expect } from 'vitest';
import { buildTaskTimeline } from './task-history-extra';
import type { FeedEntry } from './activity-feed';

const at = (min: number) => new Date(Date.UTC(2026, 10, 10, 9, min)).toISOString();
const e = (id: string, action: string, min: number, meta: Record<string, unknown> = {}, actorName = 'Omar'): FeedEntry => ({ id, action, actorName, createdAt: at(min), meta });

describe('task history: guests and categories (1.24)', () => {
  it('words guest lines as assigning and removing guests', () => {
    const items = buildTaskTimeline([
      e('3', 'EXTERNAL_CONTACT_REMOVED', 50, { name: 'Sara' }),
      e('2', 'EXTERNAL_CONTACT_ADDED', 2, { name: 'Ali', company: 'BP', guestId: 'g2' }),
      e('1', 'EXTERNAL_CONTACT_ADDED', 1, { name: 'Ahmed', company: 'OXY', guestId: 'g1' }),
    ]);
    expect(items.map((i) => i.text)).toEqual(['removed guest Sara', 'assigned guests Ahmed (OXY) and Ali (BP)']);
    expect(items[1]).toMatchObject({ id: '2', kind: 'external', count: 2 });
  });
  it('a changed guest is re-linked or edited', () => {
    expect(buildTaskTimeline([e('1', 'EXTERNAL_CONTACT_CHANGED', 1, { name: 'Ahmed', company: 'OXY' })])[0]!.text).toBe('changed guest Ahmed (OXY)');
  });
  it('category lines, a run by one person reading as one', () => {
    const items = buildTaskTimeline([
      e('4', 'CATEGORY_REMOVED', 9, { name: 'HSE' }),
      e('3', 'CATEGORY_ADDED', 3, { name: 'Electrical' }),
      e('2', 'CATEGORY_ADDED', 2, { name: 'Civil' }, 'Sara'),
      e('1', 'CATEGORY_ADDED', 1, { name: 'Civil' }),
    ]);
    expect(items.map((i) => `${i.actorName} ${i.text}`)).toEqual([
      'Omar removed category HSE',
      'Omar added category Electrical',
      'Sara added category Civil',
      'Omar added category Civil',
    ]);
  });
  it('the person added to look after the guests', () => {
    const items = buildTaskTimeline([e('1', 'ASSIGNED', 1, { assignee: 'Omar Ahmed', assigneeId: 'u1', reason: 'guests' }, 'MICO360')]);
    expect(items[0]!.text).toBe('added Omar Ahmed as the person responsible for the guests');
    const auto = buildTaskTimeline([e('2', 'ASSIGNED', 1, { assignee: 'Omar Ahmed', assigneeId: 'u1', reason: 'guests', auto: true }, 'Omar Ahmed')]);
    expect(auto[0]!.text).toBe('became the person responsible for the guests');
  });
  it('keeps every other line as the shared timeline words it, newest first', () => {
    const items = buildTaskTimeline([
      e('3', 'CATEGORY_ADDED', 30, { name: 'Civil' }),
      e('2', 'ASSIGNED', 20, { assignee: 'Sara' }),
      e('1', 'CREATED', 10),
    ]);
    expect(items.map((i) => i.text)).toEqual(['added category Civil', 'assigned Sara', 'created this task']);
  });
});
