import { describe, it, expect } from 'vitest';
import { createBinService, BIN_WORDS, type BinViewer } from './bin-service';
import type { BinnedTask, BinRow, BinStore } from './bin-store';
import { binExpiryOf } from './bin-rules';

const TZ = 'Asia/Muscat';
const NOW = new Date('2026-11-10T08:00:00Z');
const admin: BinViewer = { id: 'u-admin', roles: ['ADMIN'] };
const lead: BinViewer = { id: 'u-lead', roles: ['EMPLOYEE'] };
const member: BinViewer = { id: 'u-member', roles: ['EMPLOYEE'] };

const project = (id: string, name: string) => ({ id, name, code: id.toUpperCase(), color: '#333', icon: null, imageUrl: null });
function row(id: string, over: Partial<BinRow> = {}): BinRow {
  const deletedAt = over.deletedAt ?? new Date('2026-11-09T08:00:00Z');
  return {
    id,
    key: `RIG-${id.replace(/\D/g, '') || '1'}`,
    title: `Task ${id}`,
    description: null,
    formerKeys: [],
    project: project('rig', 'Rig works'),
    companyIds: ['c1'],
    status: { name: 'To do', category: 'TODO' },
    deletedAt,
    deletedById: 'u-lead',
    binExpiresAt: binExpiryOf(deletedAt, TZ),
    deleteBatchId: null,
    assignees: [],
    ...over,
  };
}

function storeWith(rows: BinRow[], opts: { runs?: Record<string, string[]>; archived?: string[] } = {}) {
  const live = new Map(rows.map((r) => [r.id, r]));
  const restored: string[] = [];
  const erased: string[] = [];
  const binned = (r: BinRow): BinnedTask => ({ id: r.id, key: r.key, title: r.title, projectId: r.project.id, deletedAt: r.deletedAt, deletedById: r.deletedById, binExpiresAt: r.binExpiresAt, deleteBatchId: r.deleteBatchId });
  const runs = opts.runs ?? { 'u-lead': ['rig'] };
  const store: BinStore = {
    async list(projectIds) {
      return [...live.values()].filter((r) => !projectIds || projectIds.includes(r.project.id)).sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
    },
    async people(ids) {
      return ids.map((id) => ({ id, name: id === 'u-lead' ? 'Sara Lead' : `Person ${id}` }));
    },
    async batchSizes(batchIds) {
      return new Map(batchIds.map((b) => [b, [...live.values()].filter((r) => r.deleteBatchId === b).length]));
    },
    async find(id) {
      const r = live.get(id);
      return r ? binned(r) : null;
    },
    async facts(ids) {
      return ids.map((id) => ({ id, key: 'K-1', title: 't', projectId: 'rig' }));
    },
    async inBatch(batchId) {
      return [...live.values()].filter((r) => r.deleteBatchId === batchId).map(binned);
    },
    async detail() {
      return null;
    },
    async restore(id) {
      if (!live.delete(id)) return false;
      restored.push(id);
      return true;
    },
    async erase(id) {
      const r = live.get(id);
      if (!r) return null;
      live.delete(id);
      erased.push(id);
      return { id, key: r.key, title: r.title, projectId: r.project.id, files: [] };
    },
    async fileInUse() {
      return false;
    },
    async due() {
      return [];
    },
    async runsProject(userId, projectId) {
      return (runs[userId] ?? []).includes(projectId);
    },
    async runProjectIds(userId) {
      return runs[userId] ?? [];
    },
    async runsAny(userId) {
      return (runs[userId] ?? []).length > 0;
    },
  };
  const service = createBinService({
    store,
    timeZone: TZ,
    now: () => NOW,
    adminScope: async () => null,
    isArchived: async (id) => (opts.archived ?? []).includes(id),
    canViewProject: async () => true,
  });
  return { service, restored, erased };
}

describe('the bin list: search, filters, sort and page', () => {
  it('finds by number however typed, by an old number, and by words of the title or description (Arabic folded)', async () => {
    const { service } = storeWith([
      row('t12', { key: 'RIG-12', title: 'Replace the pump' }),
      row('t7', { key: 'OPS-3', formerKeys: ['RIG-7'], title: 'Moved away' }),
      row('t9', { key: 'RIG-9', title: 'Paperwork', description: 'تقرير السلامة' }),
    ]);
    const ids = async (q: string) => (await service.list(admin, null, { q })).rows.map((r) => r.id);
    expect(await ids('rig 12')).toEqual(['t12']);
    expect(await ids('#RIG-7')).toEqual(['t7']);
    expect(await ids('12')).toEqual(['t12']);
    expect(await ids('pump replace')).toEqual(['t12']);
    expect(await ids('تقرير')).toEqual(['t9']);
    expect(await ids('nothing like it')).toEqual([]);
  });

  it('a task number finds that task only — never others whose words happen to hold its letters and digits', async () => {
    const { service } = storeWith([row('t3', { key: 'BN33R-3', title: 'Close out' }), row('t1', { key: 'BN33R-1', title: 'Order 3 cement trucks' })]);
    expect((await service.list(admin, null, { q: 'bn33r 3' })).rows.map((r) => r.id)).toEqual(['t3']);
    // A bare number still finds its words too ("3 cement trucks") as well as any task numbered …-3.
    expect((await service.list(admin, null, { q: '3' })).rows.map((r) => r.id).sort()).toEqual(['t1', 't3']);
  });

  it('filters by project, who deleted it (Unknown too), the days it was deleted and "7 days or less left"', async () => {
    const { service } = storeWith([
      row('a1', { deletedAt: new Date('2026-09-15T08:00:00Z') }), // 4 days left on 10 Nov (56 days on)
      row('b2', { project: project('ops', 'Ops'), deletedById: null, deletedAt: new Date('2026-11-01T08:00:00Z') }),
      row('c3', { deletedById: 'u-other', deletedAt: new Date('2026-11-09T08:00:00Z') }),
    ]);
    const ids = async (q: object) => (await service.list(admin, null, q)).rows.map((r) => r.id);
    expect(await ids({ projectId: 'ops' })).toEqual(['b2']);
    expect(await ids({ deletedById: 'unknown' })).toEqual(['b2']);
    expect(await ids({ deletedById: 'u-other' })).toEqual(['c3']);
    expect(await ids({ deletedFrom: '2026-10-01', deletedTo: '2026-11-05' })).toEqual(['b2']);
    expect(await ids({ soon: true })).toEqual(['a1']);
    const page = await service.list(admin, null, {});
    expect(page.facets.projects.map((p) => p.id)).toEqual(['ops', 'rig']);
    expect(page.facets.deleters).toEqual([
      { id: 'u-other', name: 'Person u-other' },
      { id: 'u-lead', name: 'Sara Lead' },
      { id: 'unknown', name: 'Unknown' },
    ]);
    expect(page.rows.find((r) => r.id === 'a1')!.daysLeft).toBe(4);
    expect(page.rows.find((r) => r.id === 'b2')!.deletedBy).toBeNull();
  });

  it('newest deleted first by default; fewest days left first when asked; pages', async () => {
    const { service } = storeWith([
      row('old', { deletedAt: new Date('2026-09-20T08:00:00Z') }),
      row('new', { deletedAt: new Date('2026-11-09T08:00:00Z') }),
      row('mid', { deletedAt: new Date('2026-10-20T08:00:00Z') }),
    ]);
    expect((await service.list(admin, null, {})).rows.map((r) => r.id)).toEqual(['new', 'mid', 'old']);
    expect((await service.list(admin, null, { sort: 'daysLeft' })).rows.map((r) => r.id)).toEqual(['old', 'mid', 'new']);
    const page = await service.list(admin, null, { limit: 2, offset: 1 });
    expect([page.rows.map((r) => r.id), page.total, page.offset, page.limit]).toEqual([['mid', 'old'], 3, 1, 2]);
  });

  it('a whole series shows how many were deleted with it; a lone task none', async () => {
    const { service } = storeWith([row('s1', { deleteBatchId: 'b' }), row('s2', { deleteBatchId: 'b' }), row('x', { deleteBatchId: 'lone' })]);
    const rows = (await service.list(admin, null, {})).rows;
    expect(rows.map((r) => [r.id, r.batch?.size ?? null])).toEqual([['s1', 2], ['s2', 2], ['x', null]]);
  });
});

describe('who sees and does what', () => {
  it('a manager sees their projects’ deleted tasks; someone who runs no project is refused; admins may erase', async () => {
    const { service } = storeWith([row('r1'), row('o1', { project: project('ops', 'Ops') })]);
    expect((await service.list(lead, null, {})).rows.map((r) => r.id)).toEqual(['r1']);
    expect((await service.list(lead, null, {})).canErase).toBe(false);
    expect((await service.list(admin, null, {})).canErase).toBe(true);
    await expect(service.list(member, null, {})).rejects.toMatchObject({ status: 403, message: BIN_WORDS.notAllowed });
  });

  it('restore: someone else’s project’s task is "not found" (nothing about it); a whole batch only within what they run', async () => {
    const { service, restored } = storeWith([row('r1', { deleteBatchId: 'b' }), row('r2', { deleteBatchId: 'b' }), row('o1', { project: project('ops', 'Ops') })]);
    const r = await service.restore(lead, ['o1', 'r1'], { wholeBatch: true });
    expect(r.notRestored).toEqual([{ id: 'o1', reason: 'not_found', message: BIN_WORDS.notInBin }]);
    expect(restored.sort()).toEqual(['r1', 'r2']);
  });

  it('erase: refused for anyone but an admin, before anything is touched', async () => {
    const { service, erased } = storeWith([row('r1')]);
    await expect(service.erase(lead, ['r1'])).rejects.toMatchObject({ status: 403, message: BIN_WORDS.eraseAdminsOnly });
    expect(erased).toEqual([]);
    expect((await service.erase(admin, ['r1', 'nope'])).notErased).toEqual([{ id: 'nope', reason: 'not_found', message: BIN_WORDS.notInBin }]);
  });
});

describe('the nightly erase keeps going', () => {
  it('a task that can’t be erased doesn’t hold up the ones after it (I4)', async () => {
    const due = Array.from({ length: 30 }, (_, i) => `d${i}`);
    const erased: string[] = [];
    const asked: string[][] = [];
    const store = {
      async due(_now: Date, limit: number, skip: string[] = []) {
        asked.push(skip);
        return due.filter((id) => !erased.includes(id) && !skip.includes(id)).slice(0, limit);
      },
      async erase(id: string) {
        // The first 25 always fail (as a too-big task timing out would).
        if (Number(id.slice(1)) < 25) throw new Error('timed out');
        erased.push(id);
        return { id, key: `K-${id}`, title: id, projectId: 'p', files: [] };
      },
      async fileInUse() {
        return false;
      },
    } as unknown as BinStore;
    const failures: string[] = [];
    const service = createBinService({ store, timeZone: TZ, now: () => NOW, adminScope: async () => null, isArchived: async () => false, canViewProject: async () => true, onError: (_e, _w, id) => failures.push(id!) });
    expect(await service.sweep()).toBe(5);
    expect(erased).toEqual(['d25', 'd26', 'd27', 'd28', 'd29']);
    expect(failures).toHaveLength(25);
  });
});
