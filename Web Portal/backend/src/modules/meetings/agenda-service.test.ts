import { describe, it, expect } from 'vitest';
import { createAgendaService } from './agenda-service';
import type { AgendaRepository, AgendaItemRecord, CreateAgendaData, UpdateAgendaData } from './agenda-repository';

function inMemory(): AgendaRepository {
  const rows = new Map<string, AgendaItemRecord>();
  let seq = 0;
  return {
    async add(d: CreateAgendaData) {
      const rec: AgendaItemRecord = {
        id: `g${seq++}`, meetingId: d.meetingId, title: d.title, ownerId: d.ownerId ?? null,
        expectedMinutes: d.expectedMinutes ?? null, position: d.position, completed: false,
        linkedPrevActionId: d.linkedPrevActionId ?? null, createdAt: new Date(),
      };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async listByMeeting(meetingId) {
      return [...rows.values()].filter((a) => a.meetingId === meetingId).sort((a, b) => a.position - b.position);
    },
    async update(id, patch: UpdateAgendaData) { const u = { ...rows.get(id)!, ...patch } as AgendaItemRecord; rows.set(id, u); return u; },
    async remove(id) { rows.delete(id); },
    async setPositions(updates) { for (const u of updates) { const r = rows.get(u.id); if (r) r.position = u.position; } },
  };
}

describe('AgendaService', () => {
  it('adds items appended to the end (auto position) and trims the title', async () => {
    const svc = createAgendaService({ agenda: inMemory() });
    const a = await svc.addItem('m1', { title: '  Opening remarks  ' });
    const b = await svc.addItem('m1', { title: 'Budget review', expectedMinutes: 15 });
    expect(a.title).toBe('Opening remarks');
    expect(a.position).toBe(0);
    expect(b.position).toBe(1);
    expect(b.expectedMinutes).toBe(15);
  });

  it('rejects an empty title', async () => {
    const svc = createAgendaService({ agenda: inMemory() });
    await expect(svc.addItem('m1', { title: '   ' })).rejects.toThrow(/title/i);
  });

  it('updates an item and toggles completion', async () => {
    const svc = createAgendaService({ agenda: inMemory() });
    const a = await svc.addItem('m1', { title: 'Review' });
    const up = await svc.updateItem('m1', a.id, { title: 'Review Q3', ownerId: 'u2' });
    expect(up.title).toBe('Review Q3');
    expect(up.ownerId).toBe('u2');
    const done = await svc.setCompleted('m1', a.id, true);
    expect(done.completed).toBe(true);
  });

  it('rejects updating an item from another meeting', async () => {
    const svc = createAgendaService({ agenda: inMemory() });
    const a = await svc.addItem('m1', { title: 'X' });
    await expect(svc.updateItem('m2', a.id, { title: 'Y' })).rejects.toThrow(/not found/i);
  });

  it('removes an item', async () => {
    const svc = createAgendaService({ agenda: inMemory() });
    const a = await svc.addItem('m1', { title: 'Temp' });
    await svc.removeItem('m1', a.id);
    expect(await svc.listAgenda('m1')).toHaveLength(0);
  });

  it('reorders items to the given order, ignoring ids from other meetings', async () => {
    const svc = createAgendaService({ agenda: inMemory() });
    const a = await svc.addItem('m1', { title: 'A' });
    const b = await svc.addItem('m1', { title: 'B' });
    const c = await svc.addItem('m1', { title: 'C' });
    const other = await svc.addItem('m2', { title: 'Other' });
    const reordered = await svc.reorder('m1', [c.id, a.id, b.id, other.id]);
    expect(reordered.map((x) => x.title)).toEqual(['C', 'A', 'B']);
    // the other meeting's item is untouched
    const m2 = await svc.listAgenda('m2');
    expect(m2[0]?.position).toBe(other.position);
  });
});
