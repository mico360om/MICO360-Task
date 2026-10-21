import { describe, it, expect, vi } from 'vitest';
import { gatherAgendaSources, type AgendaSourceStore } from './agenda-sources';

const TZ = 'Asia/Muscat';
const NOW = new Date('2026-10-21T06:00:00Z'); // Wednesday 21 Oct, 10:00 in Muscat
const START = new Date('2026-10-26T06:00:00Z');
const me = { userId: 'u1', roles: ['EMPLOYEE'] };

function setup(opts: { canUse?: boolean; canView?: (id: string) => boolean; previous?: string | null; last?: string | null } = {}) {
  const store: AgendaSourceStore = {
    openTasks: vi.fn(async () => [
      { key: 'PUMP-3', title: 'Order spare seals', dueDate: new Date('2026-10-29T00:00:00Z'), blocked: false },
      { key: 'PUMP-1', title: 'Fix the valve', dueDate: null, blocked: true },
      { key: 'PUMP-2', title: 'Send the test report', dueDate: new Date('2026-10-18T00:00:00Z'), blocked: true },
    ]),
    previousInSeries: vi.fn(async () => opts.previous ?? null),
    lastProjectMeetingBefore: vi.fn(async () => opts.last ?? null),
    leftovers: vi.fn(async (meetingId: string) => [{ title: `Open point from ${meetingId}`, kind: 'action' as const }]),
  };
  const deps = {
    store,
    canUseProject: vi.fn(async () => opts.canUse ?? true),
    canViewMeeting: vi.fn(async (_u: string, _r: string[], id: string) => (opts.canView ? opts.canView(id) : true)),
    timeZone: TZ,
    now: () => NOW,
  };
  return { store, deps };
}

describe('gatherAgendaSources', () => {
  it('takes the project’s open tasks: overdue, blocked, or due up to 7 days after the meeting', async () => {
    const { store, deps } = setup();
    const out = await gatherAgendaSources(deps, { requester: me, projectId: 'p1', startAt: START });
    expect(store.openTasks).toHaveBeenCalledWith('p1', new Date(START.getTime() + 7 * 86_400_000));
    expect(out.tasks).toEqual([
      { key: 'PUMP-2', title: 'Send the test report', reason: 'overdue' },
      { key: 'PUMP-1', title: 'Fix the valve', reason: 'blocked' },
      { key: 'PUMP-3', title: 'Order spare seals', reason: 'due' },
    ]);
  });

  it('takes leftovers from the previous meeting of the series, else the project’s last meeting', async () => {
    const series = setup({ previous: 'm4', last: 'm2' });
    expect((await gatherAgendaSources(series.deps, { requester: me, projectId: 'p1', startAt: START, meetingId: 'm5' })).leftovers).toEqual([{ title: 'Open point from m4', kind: 'action' }]);
    expect(series.store.lastProjectMeetingBefore).not.toHaveBeenCalled();

    const first = setup({ previous: null, last: 'm2' });
    expect((await gatherAgendaSources(first.deps, { requester: me, projectId: 'p1', startAt: START, meetingId: 'm5' })).leftovers).toEqual([{ title: 'Open point from m2', kind: 'action' }]);
    expect(first.store.lastProjectMeetingBefore).toHaveBeenCalledWith('p1', START, 'm5');

    const fresh = setup({ last: 'm2' });
    expect((await gatherAgendaSources(fresh.deps, { requester: me, projectId: 'p1', startAt: START })).leftovers).toEqual([{ title: 'Open point from m2', kind: 'action' }]);
    expect(fresh.store.previousInSeries).not.toHaveBeenCalled();
  });

  it('nothing from a project or meeting the person can’t see', async () => {
    const hidden = setup({ canUse: false, last: 'm2' });
    expect(await gatherAgendaSources(hidden.deps, { requester: me, projectId: 'p9', startAt: START })).toEqual({ tasks: [], leftovers: [] });
    expect(hidden.store.openTasks).not.toHaveBeenCalled();
    expect(hidden.store.lastProjectMeetingBefore).not.toHaveBeenCalled();

    const secret = setup({ previous: 'm4', canView: (id) => id !== 'm4' });
    expect((await gatherAgendaSources(secret.deps, { requester: me, projectId: 'p1', startAt: START, meetingId: 'm5' })).leftovers).toEqual([]);
    expect(secret.store.leftovers).not.toHaveBeenCalled();
  });

  it('a meeting without a project has no tasks, and leftovers only from its own series', async () => {
    const { store, deps } = setup({ previous: 'm4' });
    const out = await gatherAgendaSources(deps, { requester: me, projectId: null, startAt: START, meetingId: 'm5' });
    expect(out).toEqual({ tasks: [], leftovers: [{ title: 'Open point from m4', kind: 'action' }] });
    expect(store.openTasks).not.toHaveBeenCalled();
    expect(store.lastProjectMeetingBefore).not.toHaveBeenCalled();
  });
});
