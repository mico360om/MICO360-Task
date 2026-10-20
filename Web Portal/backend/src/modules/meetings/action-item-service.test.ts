import { describe, it, expect } from 'vitest';
import { createActionItemService } from './action-item-service';
import type { ActionItemRepository, ActionItemRecord, CreateActionItemData, UpdateActionItemData, AssigneeListFilter } from './action-item-repository';

function inMemory(): ActionItemRepository {
  const rows = new Map<string, ActionItemRecord>();
  let seq = 0;
  return {
    async create(d: CreateActionItemData) {
      const now = new Date();
      const rec: ActionItemRecord = {
        id: `ai${seq++}`, meetingId: d.meetingId ?? null, agendaItemId: d.agendaItemId ?? null, sourceNoteId: d.sourceNoteId ?? null,
        projectId: d.projectId ?? null, description: d.description, assigneeId: d.assigneeId ?? null, priority: d.priority ?? 'NORMAL',
        status: d.status ?? 'OPEN', dueDate: d.dueDate ?? null, progress: 0, completedAt: null, taskId: d.taskId ?? null,
        createdById: d.createdById, createdAt: now, updatedAt: now,
      };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async listByMeeting(meetingId) { return [...rows.values()].filter((a) => a.meetingId === meetingId); },
    async listByTask(taskId) { return [...rows.values()].filter((a) => a.taskId === taskId); },
    async listForAssignee(userId, filter: AssigneeListFilter = {}) {
      let all = [...rows.values()].filter((a) => a.assigneeId === userId);
      if (filter.status) all = all.filter((a) => a.status === filter.status);
      if (filter.openOnly) all = all.filter((a) => a.status !== 'COMPLETED' && a.status !== 'CANCELLED');
      return all;
    },
    async update(id, patch: UpdateActionItemData) { const u = { ...rows.get(id)!, ...patch, updatedAt: new Date() } as ActionItemRecord; rows.set(id, u); return u; },
    async remove(id) { rows.delete(id); },
  };
}

const at = (iso: string) => new Date(iso);

describe('ActionItemService', () => {
  it('adds an action item defaulting to OPEN / NORMAL and trims the description', async () => {
    const svc = createActionItemService({ actionItems: inMemory() });
    const a = await svc.addItem('m1', 'u1', { description: '  Draft the OKRs  ', projectId: 'p1' });
    expect(a.description).toBe('Draft the OKRs');
    expect(a.status).toBe('OPEN');
    expect(a.priority).toBe('NORMAL');
    expect(a.meetingId).toBe('m1');
    expect(a.projectId).toBe('p1');
  });

  it('rejects an empty description and an invalid status', async () => {
    const svc = createActionItemService({ actionItems: inMemory() });
    await expect(svc.addItem('m1', 'u1', { description: '   ' })).rejects.toThrow(/description/i);
    const a = await svc.addItem('m1', 'u1', { description: 'x' });
    // @ts-expect-error invalid status
    await expect(svc.setStatus(a.id, 'DONE')).rejects.toThrow(/status/i);
  });

  it('sets completedAt when moved to COMPLETED and clears it when reopened', async () => {
    const svc = createActionItemService({ actionItems: inMemory(), now: () => at('2026-10-01T00:00:00Z') });
    const a = await svc.addItem('m1', 'u1', { description: 'Ship it' });
    const done = await svc.setStatus(a.id, 'COMPLETED');
    expect(done.status).toBe('COMPLETED');
    expect(done.completedAt).toEqual(at('2026-10-01T00:00:00Z'));
    expect(done.progress).toBe(100);
    const reopened = await svc.setStatus(a.id, 'IN_PROGRESS');
    expect(reopened.completedAt).toBeNull();
  });

  it('updates fields (assignee, due date, priority)', async () => {
    const svc = createActionItemService({ actionItems: inMemory() });
    const a = await svc.addItem('m1', 'u1', { description: 'Review' });
    const up = await svc.updateItem(a.id, { assigneeId: 'u2', dueDate: at('2026-11-01T00:00:00Z'), priority: 'HIGH' });
    expect(up.assigneeId).toBe('u2');
    expect(up.priority).toBe('HIGH');
    expect(up.dueDate).toEqual(at('2026-11-01T00:00:00Z'));
  });

  it('lists a user’s own action items and flags overdue ones', async () => {
    const svc = createActionItemService({ actionItems: inMemory(), now: () => at('2026-10-10T00:00:00Z') });
    const a1 = await svc.addItem('m1', 'u1', { description: 'Overdue', assigneeId: 'u2', dueDate: at('2026-10-01T00:00:00Z') });
    await svc.addItem('m1', 'u1', { description: 'Future', assigneeId: 'u2', dueDate: at('2026-12-01T00:00:00Z') });
    await svc.addItem('m1', 'u1', { description: 'Someone else', assigneeId: 'u3' });
    const mine = await svc.listMine('u2');
    expect(mine).toHaveLength(2);
    const overdue = mine.find((x) => x.id === a1.id)!;
    expect(overdue.overdue).toBe(true);
    expect(mine.find((x) => x.description === 'Future')!.overdue).toBe(false);
    // openOnly filter excludes completed
    await svc.setStatus(a1.id, 'COMPLETED');
    expect(await svc.listMine('u2', { openOnly: true })).toHaveLength(1);
  });

  it('a completed item is never flagged overdue even past its due date', async () => {
    const svc = createActionItemService({ actionItems: inMemory(), now: () => at('2026-10-10T00:00:00Z') });
    const a = await svc.addItem('m1', 'u1', { description: 'Done late', assigneeId: 'u2', dueDate: at('2026-10-01T00:00:00Z') });
    await svc.setStatus(a.id, 'COMPLETED');
    const mine = await svc.listMine('u2');
    expect(mine[0]!.overdue).toBe(false);
  });

  it('treats the due date as a calendar day in the company zone (XP-03)', async () => {
    // Due 2026-10-01 (stored as UTC midnight = 04:00 in Muscat).
    const due = at('2026-10-01T00:00:00Z');
    const lateOnDueDay = createActionItemService({ actionItems: inMemory(), timeZone: 'Asia/Muscat', now: () => at('2026-10-01T19:59:00Z') }); // 23:59 Muscat
    const a = await lateOnDueDay.addItem('m1', 'u1', { description: 'Today', assigneeId: 'u2', dueDate: due });
    expect((await lateOnDueDay.listMine('u2')).find((x) => x.id === a.id)!.overdue).toBe(false);
    const nextDay = createActionItemService({ actionItems: inMemory(), timeZone: 'Asia/Muscat', now: () => at('2026-10-01T20:00:00Z') }); // 00:00 Muscat, Oct 2
    await nextDay.addItem('m1', 'u1', { description: 'Yesterday', assigneeId: 'u2', dueDate: due });
    expect((await nextDay.listMine('u2'))[0]!.overdue).toBe(true);
  });

  it('removes an item', async () => {
    const svc = createActionItemService({ actionItems: inMemory() });
    const a = await svc.addItem('m1', 'u1', { description: 'Temp' });
    await svc.removeItem(a.id);
    expect(await svc.listByMeeting('m1')).toHaveLength(0);
  });
});

describe('ActionItemService.followTask (an action item follows the task it is tracked as)', () => {
  async function setup() {
    const changed: Array<string | null> = [];
    const repo = inMemory();
    const svc = createActionItemService({ actionItems: repo, onChanged: (m) => changed.push(m), now: () => at('2026-10-21T08:00:00Z') });
    const open = await svc.addItem('m1', 'u1', { description: 'Book the inspection', taskId: 't1' });
    const doing = await svc.addItem('m2', 'u1', { description: 'Same task, another meeting', taskId: 't1' });
    await svc.setStatus(doing.id, 'IN_PROGRESS');
    const other = await svc.addItem('m1', 'u1', { description: 'Not tracked as t1', taskId: 't2' });
    changed.length = 0;
    return { svc, repo, changed, open, doing, other };
  }

  it('completes the items tracked as a task when the task is done', async () => {
    const { svc, changed, open, doing, other } = await setup();
    await svc.followTask('t1', true);
    for (const id of [open.id, doing.id]) {
      const a = await svc.getItem(id);
      expect(a.status).toBe('COMPLETED');
      expect(a.completedAt).toEqual(at('2026-10-21T08:00:00Z'));
      expect(a.progress).toBe(100);
    }
    expect((await svc.getItem(other.id)).status).toBe('OPEN');
    expect(changed.sort()).toEqual(['m1', 'm2']); // both meetings' pages refresh
  });

  it('opens them again when the task is reopened', async () => {
    const { svc, open } = await setup();
    await svc.followTask('t1', true);
    await svc.followTask('t1', false);
    const a = await svc.getItem(open.id);
    expect(a.status).toBe('OPEN');
    expect(a.completedAt).toBeNull();
  });

  it('leaves cancelled items, and items already in step, alone', async () => {
    const { svc, changed, open, doing } = await setup();
    await svc.setStatus(doing.id, 'CANCELLED');
    changed.length = 0;
    await svc.followTask('t1', false); // the open one is already open
    expect((await svc.getItem(open.id)).status).toBe('OPEN');
    expect(changed).toEqual([]);
    await svc.followTask('t1', true);
    expect((await svc.getItem(doing.id)).status).toBe('CANCELLED');
  });
});
