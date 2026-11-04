import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { createPrismaNoteRepository } from '../../src/modules/meetings/prisma-note-repository';
import { createNoteService } from '../../src/modules/meetings/note-service';

// 1.22.1 (owner, 4 Nov): the organizer or an administrator may change a note someone else wrote; the
// note keeps its author and remembers who last changed its words (meeting_notes.editedById).
// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let w: CompanyWorld;

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
});
afterAll(async () => {
  if (w) {
    await prisma.meetingNote.deleteMany({ where: { meetingId: { in: Object.values(w.meetings) } } });
    await dropCompanyWorld(prisma, w);
  }
  await prisma.$disconnect();
});

describe('a meeting note changed by someone other than its author (1.22.1)', () => {
  it('keeps its author and stores who changed it; highlighting alone changes neither', async () => {
    const notes = createNoteService({ notes: createPrismaNoteRepository(prisma) });
    const meetingId = Object.values(w.meetings)[0]!;
    const [author, editor] = Object.values(w.people);
    const note = await notes.addNote(meetingId, author!, { body: 'Steel delivery on Wednesday', type: 'DISCUSSION' });
    expect(note.editedById ?? null).toBeNull();

    const lit = await notes.updateNote(meetingId, note.id, { highlighted: true }, editor!);
    expect(lit).toMatchObject({ authorId: author, highlighted: true, editedAt: null });
    expect(lit.editedById ?? null).toBeNull();

    const changed = await notes.updateNote(meetingId, note.id, { body: 'Steel delivery moved to Thursday' }, editor!);
    expect(changed).toMatchObject({ authorId: author, editedById: editor, body: 'Steel delivery moved to Thursday' });
    expect(changed.editedAt).toBeInstanceOf(Date);

    const row = await prisma.meetingNote.findUniqueOrThrow({ where: { id: note.id } });
    expect(row).toMatchObject({ authorId: author, editedById: editor });
    const listed = (await notes.listNotes(meetingId)).find((n) => n.id === note.id);
    expect(listed).toMatchObject({ authorId: author, editedById: editor });
  });
});
