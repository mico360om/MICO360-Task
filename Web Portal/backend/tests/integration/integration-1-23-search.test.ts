import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createSearchIndex } from '../../src/modules/search/search-index';
import { createSearchEngine } from '../../src/modules/search/search-engine';
import { createVocabulary } from '../../src/modules/search/search-fuzzy';
import { createPrismaSearchWords } from '../../src/modules/search/prisma-search-words';
import type { SearchScopeAll } from '../../src/modules/search/search-scope';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// 1.23 integration: search with the other lanes of 1.23.0 —
//  - a Teams link is a meeting field, not searchable text (only the meeting's own words find it);
//  - a series' name isn't searchable (the search design has no series kind; its meetings are found by theirs);
//  - a comment a client wrote in the Client portal is found like any comment, by staff.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const store = createPrismaSearchWords(prisma);
const vocabulary = createVocabulary({ load: store.load, store: store.store, ttlMs: 0 });
const taskIndex = createTaskSearchIndex({ prisma, words: vocabulary });
const index = createSearchIndex({ prisma, words: vocabulary });
const engine = createSearchEngine({ prisma, timeZone: 'Asia/Muscat', suggest: (w) => vocabulary.suggest(w) });

const L = Array.from({ length: 5 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
const T = L.toUpperCase();
const w = (word: string) => `${word}${L}`;
const everyone: SearchScopeAll = { projectIds: null, meetings: { full: null, invitee: [], editable: null } };

let owner = '';
let client = '';
let projectId = '';
let taskId = '';
let meetingId = '';
let seriesId = '';

const found = async (q: string) => (await engine.search({ q, scope: everyone, viewerId: owner, limit: 20, withCounts: true })).hits.map((h) => `${h.kind}:${h.id}`);

beforeAll(async () => {
  await prisma.$connect();
  const user = (name: string) => prisma.user.create({ data: { email: `${name}.${L}@integ.test`, username: `${name}_${L}`, passwordHash: 'x', firstName: name, lastName: `Integ${T}` } }).then((u) => u.id);
  owner = await user('owner');
  client = await user('client');
  await prisma.userRole.create({ data: { userId: client, roleId: 'role_builtin_client' } });
  projectId = (await prisma.project.create({ data: { code: `I${T}`, name: `Integration ${L}`, createdById: owner, ownerId: owner, status: 'ACTIVE' } })).id;
  const column = await prisma.kanbanColumn.create({ data: { projectId, name: 'To do', category: 'TODO', position: 0 } });
  taskId = (await prisma.task.create({ data: { key: `I${T}-1`, title: 'Handover pack', projectId, columnId: column.id, createdById: owner, clientVisible: true } })).id;
  await prisma.comment.create({ data: { taskId, userId: client, body: `Please send the ${w('commissioning')} sheets`, fromClient: true } });
  seriesId = (await prisma.meetingSeries.create({ data: { name: `Monthly ${w('sitereview')}`, projectId, createdById: owner } })).id;
  meetingId = (
    await prisma.meeting.create({
      data: {
        title: `Progress ${w('walkdown')}`, organizerId: owner, createdById: owner, startAt: new Date('2026-11-10T06:00:00Z'), status: 'SCHEDULED', projectId, seriesId,
        onlineLink: `https://teams.microsoft.com/l/meetup-join/19%3ameeting_${w('teamsonly')}%40thread.v2/0`, onlineMeetingProvider: 'TEAMS',
      },
    })
  ).id;
  await taskIndex.refresh([taskId]);
  await index.meetingChanged(meetingId);
});

afterAll(async () => {
  await prisma.searchIndex.deleteMany({ where: { OR: [{ projectId }, { meetingId }] } });
  await prisma.meeting.deleteMany({ where: { id: meetingId } });
  await prisma.meetingSeries.deleteMany({ where: { id: seriesId } });
  await prisma.comment.deleteMany({ where: { taskId } });
  await prisma.task.deleteMany({ where: { projectId } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, client] } } });
  await prisma.$disconnect();
});

describe('1.23 integration: search with Teams links, meeting series and client accounts (database)', () => {
  it('a meeting is found by its own words, never by its Teams link', async () => {
    expect(await found(w('walkdown'))).toContain(`meeting:${meetingId}`);
    expect(await found(w('teamsonly'))).toEqual([]);
    expect(await found('meetup')).not.toContain(`meeting:${meetingId}`);
  });

  it('a series’ name finds nothing of its own (its meetings are found by their words)', async () => {
    expect(await found(w('sitereview'))).toEqual([]);
  });

  it('a client’s comment is found like any comment, by staff', async () => {
    expect(await found(w('commissioning'))).toContain(`task:${taskId}`);
  });
});
