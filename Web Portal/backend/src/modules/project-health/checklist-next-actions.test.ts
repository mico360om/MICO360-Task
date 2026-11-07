import { describe, expect, it } from 'vitest';
import { projectChecklistItems } from './checklist-next-actions';
import type { PrioritySource, SourceRequest } from '../dashboard/priority-sources';

// 1.23.5 × 1.23.3: Next actions take the Dashboard's checklist source, scoped to the project.
describe('projectChecklistItems', () => {
  it('asks the Dashboard’s source for the person’s own items in this project only, and keeps its checklist rows', async () => {
    const asked: { projectId: string; req: SourceRequest }[] = [];
    const items = projectChecklistItems((projectId): PrioritySource => ({
      name: 'checklist-items',
      async collect(req) {
        asked.push({ projectId, req });
        const at = new Date('2026-11-18T00:00:00.000Z');
        return [{ kind: 'checklist-item', id: 'c1', key: null, priority: 'NORMAL', dueDate: at, createdAt: at, row: { checklistItem: { id: 'c1', text: 'Bolts', dueDate: '2026-11-18', listTitle: 'Checklist', task: { id: 't', key: 'RIG-1', title: 'T', projectId } as never, can: { tick: true, reschedule: true } } }, watch: [projectId] }];
      },
    }));
    const got = await items.collect('p1', { today: '2026-11-20', timeZone: 'Asia/Muscat' }, { id: 'sara', roles: ['EMPLOYEE'] });
    expect(asked).toEqual([{ projectId: 'p1', req: { viewer: { id: 'sara', roles: ['EMPLOYEE'] }, pick: null, today: '2026-11-20', timeZone: 'Asia/Muscat' } }]);
    expect(got).toEqual([expect.objectContaining({ kind: 'checklist-item', id: 'c1', row: expect.objectContaining({ checklistItem: expect.objectContaining({ id: 'c1' }) }) })]);
    expect(got[0]).not.toHaveProperty('watch');
    // Nobody asking: no one's items.
    expect(await items.collect('p1', { today: '2026-11-20', timeZone: 'Asia/Muscat' }, null)).toEqual([]);
  });
});
