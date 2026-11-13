import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createSearchService, createCachedSearchDataSource } from '../../src/modules/search/search-service';
import { createPrismaSearchDataSource } from '../../src/modules/search/prisma-search-data-source';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createTaskSearchEngine } from '../../src/modules/search/task-search-engine';
import { createSearchIndex } from '../../src/modules/search/search-index';
import { createSearchEngine } from '../../src/modules/search/search-engine';
import { createSearchScope } from '../../src/modules/search/search-scope';
import { createTopBarMeetings } from '../../src/modules/search/top-bar-meetings';
import { createCompanyAccess, type Viewer } from '../../src/modules/companies/company-access';
import { createPrismaMeetingRepository } from '../../src/modules/meetings/prisma-meeting-repository';
import { createMeetingAccess } from '../../src/modules/meetings/meeting-access';
import type { SearchHit } from '../../src/modules/search/search-types';
import { buildCompanyApp, type CompanyApp } from './company-app';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// Review findings #22, #10 and N3 (13 Nov 2026): the top bar's meetings (GET /search → meetings) come
// from the search index with the person's access read on every request, as meeting-access.ts decides —
// never from fixed slices of the oldest records, never from access facts kept for 15 seconds.
// Wired as server.ts wires the search (the 15-second cache of the snapshot included).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const TZ = 'Asia/Muscat';
const tag = randomBytes(3).toString('hex');
const index = createSearchIndex({ prisma });
const taskIndex = createTaskSearchIndex({ prisma });
const engine = createSearchEngine({ prisma, timeZone: TZ });
const companies = createCompanyAccess(prisma);
const access = createMeetingAccess({ meetings: createPrismaMeetingRepository(prisma), meetingView: (v, m) => companies.meetingView(v, m) });

type Person = 'org' | 'creator' | 'attendee' | 'arabic' | 'zed' | 'outsider';
const people = {} as Record<Person, string>;
const fillers: string[] = [];
const ids = { newest: '', removed: '', archived: '', handed: '', arabic: '' };
const allMeetings: string[] = [];
let company = '';
let oldCompany = '';
let api: CompanyApp;

type Found = { id: string; title: string; projectId: string | null; snippet: string };
type TopBar = { meetings: Found[]; more?: SearchHit[] };
const as = (id: string): Viewer => ({ id, roles: ['EMPLOYEE'] });
const topBar = async (viewer: Viewer, q: string) => (await api.get(viewer, `/search?q=${encodeURIComponent(q)}`)) as TopBar;
const meetingIds = (r: TopBar) => r.meetings.map((m) => m.id);

beforeAll(async () => {
  await prisma.$connect();
  company = (await prisma.company.create({ data: { name: `Contoso Engineering ${tag}`, code: `T${tag}`.slice(0, 10) } })).id;
  oldCompany = (await prisma.company.create({ data: { name: `Fabrikam Logistics ${tag}`, code: `A${tag}`.slice(0, 10), status: 'ARCHIVED', archivedAt: new Date() } })).id;
  const person = async (key: string, companyId = company) => {
    const u = await prisma.user.create({ data: { email: `${key}-${tag}@sb3.test`, username: `${key}${tag}`, passwordHash: 'x', firstName: key, lastName: 'Test' } });
    await prisma.companyMember.create({ data: { companyId, userId: u.id } });
    return u.id;
  };
  for (const key of ['org', 'creator', 'attendee', 'arabic', 'outsider'] as const) people[key] = await person(key);
  people.zed = await person('zed', oldCompany); // all of zed's companies are archived
  for (let i = 0; i < 14; i++) fillers.push(await person(`fill${i}`));

  const meeting = async (title: string, organizerId: string, attendees: string[], extra: { description?: string; note?: string; createdById?: string } = {}) => {
    const m = await prisma.meeting.create({ data: { title, description: extra.description ?? null, organizerId, createdById: extra.createdById ?? organizerId, companyId: company, status: 'SCHEDULED', startAt: new Date() } });
    for (const userId of attendees) await prisma.meetingAttendee.create({ data: { meetingId: m.id, userId } });
    if (extra.note) await prisma.meetingNote.create({ data: { meetingId: m.id, authorId: organizerId, body: extra.note } });
    allMeetings.push(m.id);
    return m.id;
  };
  // The four meetings first (the oldest ids), then 600 more: the old snapshot kept the oldest 500.
  // #10: an attendee taken off a meeting.
  ids.removed = await meeting(`Budget review ${tag}`, people.org, [people.attendee], { note: `Confidential: supplier zzpenalty${tag} of 40k agreed` });
  // N3: someone whose companies are all archived.
  ids.archived = await meeting(`Pricing ${tag}`, people.org, [people.zed], { note: `Margin target zzmargin${tag} percent, keep internal` });
  // #21: the creator handed the meeting to another organizer and isn't one of its attendees.
  ids.handed = await meeting(`Site zzhandover${tag} plan`, people.creator, [people.org], { description: 'Who takes over the yard keys and the permits.' });
  await prisma.meeting.update({ where: { id: ids.handed }, data: { organizerId: people.org } });
  // Arabic letter forms and part of a word.
  ids.arabic = await meeting(`اجتماع صيانة المضخة zzar${tag}`, people.org, [people.arabic]);

  // #22: 600 meetings, one by one in time (ids ascend), 14 people on each (8,400 attendee rows: more
  // than the old 8,000 slice); the newest holds a word of its own.
  const start = Date.UTC(2026, 0, 1);
  for (let chunk = 0; chunk < 600; chunk += 200) {
    await prisma.meeting.createMany({
      data: Array.from({ length: 200 }, (_, j) => {
        const i = chunk + j + 1;
        return { title: `Cap meeting ${String(i).padStart(4, '0')} ${i === 600 ? `zznewest${tag}` : `zzcap${tag}`}`, organizerId: people.org, createdById: people.org, companyId: company, status: 'SCHEDULED' as const, startAt: new Date(start + i * 3_600_000) };
      }),
    });
  }
  const capRows = await prisma.meeting.findMany({ where: { title: { startsWith: 'Cap meeting' }, companyId: company }, select: { id: true, title: true }, orderBy: { startAt: 'asc' } });
  ids.newest = capRows[capRows.length - 1]!.id;
  allMeetings.push(...capRows.map((m) => m.id));
  await prisma.meetingAttendee.createMany({ data: capRows.flatMap((m) => fillers.map((userId) => ({ meetingId: m.id, userId }))) });

  await index.refresh('meeting', allMeetings);
  for (const id of [ids.removed, ids.archived, ids.handed, ids.arabic]) await index.meetingChanged(id);

  api = await buildCompanyApp(prisma, (base) => {
    const scope = createSearchScope({
      prisma,
      accessibleProjectIds: (u, r, pick) => base.projectAccess!.accessibleProjectIds(u, r, pick),
      manageableProjectIds: (u, r, list) => base.projectAuthz!.manageableProjectIds(u, r, list),
      myProjectsOnly: (viewer) => companies.myProjectsOnly(viewer),
    });
    const taskSearch = createTaskSearchEngine({ prisma, index: taskIndex, timeZone: TZ });
    return {
      // As server.ts: the snapshot kept for 15 seconds.
      searchService: createSearchService({ data: createCachedSearchDataSource(createPrismaSearchDataSource(prisma), { ttlMs: 15_000 }), tasks: taskSearch }),
      taskSearch,
      searchEverything: { engine, scope, meetings: createTopBarMeetings({ prisma, engine }), timeZone: TZ },
    };
  });
}, 120_000);

afterAll(async () => {
  await api?.close();
  const userIds = [...Object.values(people), ...fillers];
  await prisma.searchIndex.deleteMany({ where: { meetingId: { in: allMeetings } } });
  await prisma.meetingNote.deleteMany({ where: { meetingId: { in: allMeetings } } });
  await prisma.meetingAttendee.deleteMany({ where: { meetingId: { in: allMeetings } } });
  await prisma.meeting.deleteMany({ where: { id: { in: allMeetings } } });
  await prisma.companyMember.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.company.deleteMany({ where: { id: { in: [company, oldCompany] } } });
  await prisma.$disconnect();
});

describe('the top bar’s meetings follow the access rule, read on every request', () => {
  it('#22: with more than 500 meetings, an attendee finds the newest one', async () => {
    const found = await topBar(as(fillers[5]!), `zznewest${tag}`);
    expect(meetingIds(found)).toEqual([ids.newest]);
  });

  it('#22: results are capped, best (newest) first', async () => {
    const found = await topBar(as(fillers[5]!), `zzcap${tag}`);
    expect(found.meetings.length).toBeGreaterThan(0);
    expect(found.meetings.length).toBeLessThanOrEqual(10);
    expect(found.meetings[0]!.title).toBe(`Cap meeting 0599 zzcap${tag}`);
  });

  it('#21: the creator finds a meeting they handed to another organizer', async () => {
    const found = await topBar(as(people.creator), `zzhandover${tag}`);
    expect(meetingIds(found)).toEqual([ids.handed]);
    // Matched in the title: the snippet shows the start of the meeting, not the title again.
    expect(found.meetings[0]!.snippet).toContain('Who takes over the yard keys');
  });

  it('Arabic letter forms and part of a word still match; each result keeps its four fields', async () => {
    for (const q of ['صيانه', 'صيان', `المضخه zzar${tag}`]) {
      const found = await topBar(as(people.arabic), q);
      expect(meetingIds(found)).toContain(ids.arabic);
    }
    const [first] = (await topBar(as(people.arabic), `zzar${tag}`)).meetings;
    expect(Object.keys(first!).sort()).toEqual(['id', 'projectId', 'snippet', 'title']);
    expect(first).toMatchObject({ id: ids.arabic, title: `اجتماع صيانة المضخة zzar${tag}`, projectId: null });
  });

  it('#10: an attendee taken off a meeting stops finding it at once (meetings and notes)', async () => {
    const before = await topBar(as(people.attendee), `zzpenalty${tag}`);
    expect(meetingIds(before)).toEqual([ids.removed]);
    expect(before.meetings[0]!.snippet).toContain(`zzpenalty${tag}`);
    await prisma.meetingAttendee.deleteMany({ where: { meetingId: ids.removed, userId: people.attendee } });
    expect(await access.viewOf(people.attendee, [], ids.removed)).toBeNull();
    const after = await topBar(as(people.attendee), `zzpenalty${tag}`);
    expect(after.meetings).toEqual([]);
    expect(after.more ?? []).toEqual([]);
  });

  it('N3: someone whose companies are all archived finds none of their meetings', async () => {
    expect(await access.viewOf(people.zed, [], ids.archived)).toBeNull();
    for (const q of [`zzmargin${tag}`, `Pricing ${tag}`]) {
      const found = await topBar(as(people.zed), q);
      expect(found.meetings).toEqual([]);
      expect(found.more ?? []).toEqual([]);
    }
  });

  it('someone with no part in a meeting never finds it', async () => {
    for (const q of [`zzpenalty${tag}`, `zzmargin${tag}`, `zzhandover${tag}`, `zznewest${tag}`]) {
      expect((await topBar(as(people.outsider), q)).meetings).toEqual([]);
    }
  });
});
