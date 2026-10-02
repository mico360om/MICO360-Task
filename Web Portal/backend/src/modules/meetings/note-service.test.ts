import { describe, it, expect } from 'vitest';
import { createNoteService } from './note-service';
import type { NoteRepository, NoteRecord, CreateNoteData, UpdateNoteData } from './note-repository';

function inMemory(): NoteRepository {
  const rows = new Map<string, NoteRecord>();
  const deleted = new Set<string>();
  let seq = 0;
  return {
    async add(d: CreateNoteData) {
      const rec: NoteRecord = {
        id: `n${seq++}`, meetingId: d.meetingId, agendaItemId: d.agendaItemId ?? null, authorId: d.authorId,
        type: d.type, body: d.body, highlighted: d.highlighted ?? false, taskId: null, actionItemId: null,
        decisionId: null, createdAt: new Date(), editedAt: null,
      };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) { return deleted.has(id) ? null : rows.get(id) ?? null; },
    async listByMeeting(meetingId) { return [...rows.values()].filter((n) => n.meetingId === meetingId && !deleted.has(n.id)); },
    async update(id, patch: UpdateNoteData) { const u = { ...rows.get(id)!, ...patch } as NoteRecord; rows.set(id, u); return u; },
    async remove(id) { deleted.add(id); },
    async findDeleted(id) { return deleted.has(id) ? rows.get(id) ?? null : null; },
    async restore(id) { deleted.delete(id); return rows.get(id)!; },
    async claimTask(id, marker) { const r = rows.get(id); if (!r || r.taskId) return false; rows.set(id, { ...r, taskId: marker }); return true; },
    async releaseTaskClaim(id, marker) { const r = rows.get(id); if (r && r.taskId === marker) rows.set(id, { ...r, taskId: null }); },
  };
}

describe('NoteService', () => {
  it('adds a note defaulting to DISCUSSION and trims the body', async () => {
    const svc = createNoteService({ notes: inMemory() });
    const n = await svc.addNote('m1', 'u1', { body: '  Kicked off the call  ' });
    expect(n.type).toBe('DISCUSSION');
    expect(n.body).toBe('Kicked off the call');
    expect(n.authorId).toBe('u1');
    expect(n.highlighted).toBe(false);
  });

  it('accepts a typed note and an agenda link', async () => {
    const svc = createNoteService({ notes: inMemory() });
    const n = await svc.addNote('m1', 'u1', { body: 'Ship by Friday', type: 'ACTION', agendaItemId: 'g1', highlighted: true });
    expect(n.type).toBe('ACTION');
    expect(n.agendaItemId).toBe('g1');
    expect(n.highlighted).toBe(true);
  });

  it('rejects an empty body and an invalid type', async () => {
    const svc = createNoteService({ notes: inMemory() });
    await expect(svc.addNote('m1', 'u1', { body: '   ' })).rejects.toThrow(/note/i);
    // @ts-expect-error invalid type
    await expect(svc.addNote('m1', 'u1', { body: 'x', type: 'RANT' })).rejects.toThrow(/type/i);
  });

  it('edits a note (type/body/highlight) and stamps editedAt', async () => {
    const svc = createNoteService({ notes: inMemory() });
    const n = await svc.addNote('m1', 'u1', { body: 'draft' });
    const up = await svc.updateNote('m1', n.id, { body: 'final', type: 'DECISION', highlighted: true });
    expect(up.body).toBe('final');
    expect(up.type).toBe('DECISION');
    expect(up.highlighted).toBe(true);
    expect(up.editedAt).toBeInstanceOf(Date);
  });

  it('does not mark a note edited when it is only highlighted (WEB-19)', async () => {
    const svc = createNoteService({ notes: inMemory() });
    const n = await svc.addNote('m1', 'u1', { body: 'Decision: ship' });
    const lit = await svc.updateNote('m1', n.id, { highlighted: true });
    expect(lit.highlighted).toBe(true);
    expect(lit.editedAt).toBeNull();
    // Re-saving identical content isn't an edit either.
    expect((await svc.updateNote('m1', n.id, { body: ' Decision: ship ' })).editedAt).toBeNull();
    expect((await svc.updateNote('m1', n.id, { body: 'Decision: ship Friday' })).editedAt).toBeInstanceOf(Date);
  });

  it('claims a note for task conversion once; a second claim is a 409', async () => {
    const svc = createNoteService({ notes: inMemory() });
    const n = await svc.addNote('m1', 'u1', { body: 'Follow up' });
    const claim = await svc.claimForTask('m1', n.id);
    await expect(svc.claimForTask('m1', n.id)).rejects.toMatchObject({ status: 409 });
    await svc.releaseTaskClaim(n.id, claim);
    await expect(svc.claimForTask('m1', n.id)).resolves.toMatch(/^pending:/);
  });

  it('rejects editing/removing a note from another meeting', async () => {
    const svc = createNoteService({ notes: inMemory() });
    const n = await svc.addNote('m1', 'u1', { body: 'x' });
    await expect(svc.updateNote('m2', n.id, { body: 'y' })).rejects.toThrow(/not found/i);
    await expect(svc.removeNote('m2', n.id)).rejects.toThrow(/not found/i);
  });

  it('removes a note', async () => {
    const svc = createNoteService({ notes: inMemory() });
    const n = await svc.addNote('m1', 'u1', { body: 'temp' });
    await svc.removeNote('m1', n.id);
    expect(await svc.listNotes('m1')).toHaveLength(0);
  });

  it('restores a deleted note (MTG-07: deleting is undoable)', async () => {
    const changed: string[] = [];
    const svc = createNoteService({ notes: inMemory(), onChanged: (m) => changed.push(m) });
    const n = await svc.addNote('m1', 'u1', { body: 'Budget approved', type: 'DECISION' });
    await svc.removeNote('m1', n.id);
    const back = await svc.restoreNote('m1', n.id);
    expect(back).toMatchObject({ id: n.id, body: 'Budget approved', type: 'DECISION' });
    expect((await svc.listNotes('m1')).map((x) => x.id)).toEqual([n.id]);
    expect(changed).toEqual(['m1', 'm1', 'm1']);
  });

  it('only restores a deleted note of the same meeting', async () => {
    const svc = createNoteService({ notes: inMemory() });
    const live = await svc.addNote('m1', 'u1', { body: 'still here' });
    await expect(svc.restoreNote('m1', live.id)).rejects.toThrow(/not found/i);
    const gone = await svc.addNote('m1', 'u1', { body: 'gone' });
    await svc.removeNote('m1', gone.id);
    await expect(svc.restoreNote('m2', gone.id)).rejects.toThrow(/not found/i);
    await expect(svc.restoreNote('m1', 'nope')).rejects.toThrow(/not found/i);
  });

  it('tells who may restore a deleted note (its author)', async () => {
    const svc = createNoteService({ notes: inMemory() });
    const n = await svc.addNote('m1', 'u1', { body: 'x' });
    await svc.removeNote('m1', n.id);
    expect((await svc.getDeletedNote('m1', n.id)).authorId).toBe('u1');
  });
});
