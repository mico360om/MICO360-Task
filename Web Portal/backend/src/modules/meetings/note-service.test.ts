import { describe, it, expect } from 'vitest';
import { createNoteService } from './note-service';
import type { NoteRepository, NoteRecord, CreateNoteData, UpdateNoteData } from './note-repository';

function inMemory(): NoteRepository {
  const rows = new Map<string, NoteRecord>();
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
    async findById(id) { return rows.get(id) ?? null; },
    async listByMeeting(meetingId) { return [...rows.values()].filter((n) => n.meetingId === meetingId); },
    async update(id, patch: UpdateNoteData) { const u = { ...rows.get(id)!, ...patch } as NoteRecord; rows.set(id, u); return u; },
    async remove(id) { rows.delete(id); },
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
});
