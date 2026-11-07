import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createSearchService } from '../../src/modules/search/search-service';
import { createPrismaSearchDataSource } from '../../src/modules/search/prisma-search-data-source';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createTaskSearchEngine } from '../../src/modules/search/task-search-engine';
import { createSearchIndex } from '../../src/modules/search/search-index';
import { createSearchEngine } from '../../src/modules/search/search-engine';
import { createSearchScope } from '../../src/modules/search/search-scope';
import { createReaderContext } from '../../src/modules/search/search-reader-context';
import { createSavedSearches, MAX_PINS } from '../../src/modules/search/saved-searches';
import { createCompanyAccess, type Viewer } from '../../src/modules/companies/company-access';
import { todayKey, shiftDayKey } from '../../src/lib/due-date';
import { portabilityProblems } from '../../src/lib/sql-portability';
import type { SearchHit } from '../../src/modules/search/search-types';
import { buildCompanyWorld, dropCompanyWorld, sorted, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// 1.23.6 Advanced search & smart filters, on the real database: the owner's example read and run for each
// person, the two new kinds (checklist items; clients & contacts) and who may find each, and saved
// searches (save, names, share with a team, use but not change, pin limit, counts per person).
const TZ = 'Asia/Muscat';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const taskIndex = createTaskSearchIndex({ prisma });
const index = createSearchIndex({ prisma });
const engine = createSearchEngine({ prisma, timeZone: TZ });
const companyAccess = createCompanyAccess(prisma);

let w: CompanyWorld;
let api: CompanyApp;
let PB2 = '';
const made = { itemA: '', itemB: '', contactA: '', contactB: '', account: '', list: '' };
const today = todayKey(TZ);
const utc = (key: string) => new Date(`${key}T00:00:00Z`);

type Page = { data: SearchHit[]; counts: Record<string, number>; total: number; understood: { chips: { label: string }[]; words: string } | null };
const searchAll = async (viewer: Viewer, query: string, pick?: string): Promise<Page> => {
  const res = await api.getRaw(viewer, `/search/all?${query}`, pick ? { 'x-company-id': pick } : {});
  if (res.statusCode !== 200) throw new Error(`${res.statusCode} ${res.body}`);
  return res.json() as Page;
};
const q = (text: string, more = '') => `q=${encodeURIComponent(text)}${more}`;
const keys = (p: Page) => sorted(p.data.map((h) => `${h.kind}:${h.id}`));
const send = async (viewer: Viewer, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  api.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: await api.bearer(viewer) }, ...(payload !== undefined ? { payload: payload as object } : {}) });

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
  const { people, projects, tasks } = w;
  const T = w.tag.toUpperCase();
  // Due dates: TA1 (ana) and TB1 (ben) overdue, TA2 (cat) due tomorrow; cat runs PA (a manager on its team).
  await prisma.task.update({ where: { id: tasks.TA1 }, data: { dueDate: utc(shiftDayKey(today, -1)), priority: 'HIGH' } });
  await prisma.task.update({ where: { id: tasks.TB1 }, data: { dueDate: utc(shiftDayKey(today, -1)) } });
  await prisma.task.update({ where: { id: tasks.TA2 }, data: { dueDate: utc(shiftDayKey(today, 1)) } });
  await prisma.projectMember.update({ where: { projectId_userId: { projectId: projects.PA, userId: people.cat } }, data: { role: 'MANAGER' } });
  // Clients named on projects: the same client on PA, PB (other case) and PC (archived company); one on PB2 only.
  await prisma.project.update({ where: { id: projects.PA }, data: { clientName: `ZZCLIENT Petro ${T}` } });
  await prisma.project.update({ where: { id: projects.PB }, data: { clientName: ` zzclient petro ${w.tag} ` } });
  await prisma.project.update({ where: { id: projects.PC }, data: { clientName: `ZZCLIENT Petro ${T}` } });
  PB2 = (await prisma.project.create({ data: { code: `PBB${T}`, name: `Project PB2 ${w.tag}`, status: 'ACTIVE', createdById: people.admin, ownerId: people.ben, clientName: `ZZCLIENT Bonly ${T}`, mainCompanyId: w.companies.B, companies: { create: [{ companyId: w.companies.B }] } } })).id;
  // Checklist items with their own person and due date (1.23.3): one on TA1 (ana's, in "Electrical"), one on TB1 (ben's).
  made.list = (await prisma.checklistList.create({ data: { taskId: tasks.TA1, title: 'Electrical' } })).id;
  made.itemA = (await prisma.checklistItem.create({ data: { taskId: tasks.TA1, listId: made.list, text: 'ZZITEM Label circuits', assigneeId: people.ana, dueDate: utc(shiftDayKey(today, -2)) } })).id;
  made.itemB = (await prisma.checklistItem.create({ data: { taskId: tasks.TB1, text: 'ZZITEM beta valves', assigneeId: people.ben, dueDate: utc(shiftDayKey(today, -2)) } })).id;
  // External contacts on TA1 (PA) and TB1 (PB).
  made.contactA = (await prisma.taskExternalContact.create({ data: { taskId: tasks.TA1, name: 'ZZCONTACT Khalid', company: 'Larsen & Toubro' } })).id;
  made.contactB = (await prisma.taskExternalContact.create({ data: { taskId: tasks.TB1, name: 'ZZCONTACT Hidden', company: 'Secret Co' } })).id;
  // A client portal account.
  const clientRole = (await prisma.role.upsert({ where: { name: 'CLIENT' }, update: {}, create: { name: 'CLIENT' } })).id;
  made.account = (await prisma.user.create({ data: { email: `zzacc.${w.tag}@client.test`, username: `zzacc_${w.tag}`, passwordHash: 'x', firstName: 'Huda', lastName: 'Saleh', organisation: `ZZORG Owner Group ${T}`, roles: { create: { roleId: clientRole } } } })).id;

  await taskIndex.refresh(Object.values(tasks));
  await index.refresh('project', [...Object.values(projects), PB2]);
  for (const id of Object.values(w.meetings)) await index.meetingChanged(id);
  for (const t of [tasks.TA1, tasks.TB1]) await index.taskPartsChanged(t);
  for (const p of [...Object.values(projects), PB2]) await index.projectChanged(p);
  await index.refresh('account', [made.account]);

  api = await buildCompanyApp(prisma, (base) => {
    const scope = createSearchScope({
      prisma,
      accessibleProjectIds: (u, r, pick) => base.projectAccess!.accessibleProjectIds(u, r, pick),
      manageableProjectIds: (u, r, ids) => base.projectAuthz!.manageableProjectIds(u, r, ids),
      myProjectsOnly: (viewer) => companyAccess.myProjectsOnly(viewer),
    });
    const taskSearch = createTaskSearchEngine({ prisma, index: taskIndex, timeZone: TZ });
    return {
      searchService: createSearchService({ data: createPrismaSearchDataSource(prisma), tasks: taskSearch }),
      taskSearch,
      searchEverything: { engine, scope, reader: createReaderContext({ prisma, timeZone: TZ, weekStart: async () => 0 }), timeZone: TZ },
      savedSearches: createSavedSearches({
        prisma,
        accessibleProjectIds: (u, r, pick) => base.projectAccess!.accessibleProjectIds(u, r, pick ?? null),
        manageableProjectIds: (u, r, ids) => base.projectAuthz!.manageableProjectIds(u, r, ids),
      }),
    };
  });
});

afterAll(async () => {
  await api?.close();
  if (w) {
    await prisma.savedSearch.deleteMany({ where: { ownerId: { in: Object.values(w.people) } } });
    await prisma.searchIndex.deleteMany({ where: { OR: [{ projectId: { in: [...Object.values(w.projects), PB2] } }, { meetingId: { in: Object.values(w.meetings) } }, { taskId: { in: Object.values(w.tasks) } }, { recordId: { in: [made.account] } }, { kind: 'client', recordId: { contains: w.tag } }] } });
    await prisma.taskExternalContact.deleteMany({ where: { id: { in: [made.contactA, made.contactB] } } });
    await prisma.checklistItem.deleteMany({ where: { id: { in: [made.itemA, made.itemB] } } });
    await prisma.checklistList.deleteMany({ where: { id: made.list } });
    await prisma.user.deleteMany({ where: { id: made.account } });
    await prisma.project.deleteMany({ where: { id: PB2 } });
    await dropCompanyWorld(prisma, w);
  }
  await prisma.$disconnect();
});

describe('the reader, read and run for each person', () => {
  it('“Show overdue <PA> tasks assigned to me”: ana’s overdue task in PA, nothing of anyone else’s', async () => {
    const code = `PA${w.tag.toUpperCase()}`;
    const text = `Show overdue ${code} tasks assigned to me`;
    const ana = await searchAll(w.as.ana, q(text));
    expect(ana.understood?.chips.map((c) => c.label)).toEqual(['Tasks', 'Overdue', code, 'Assigned to me']);
    expect(ana.understood?.words).toBe('');
    expect(keys(ana)).toEqual([`task:${w.tasks.TA1}`]);
    expect(ana.total).toBe(1);
    // cat runs the same words: "me" is cat (TA2 isn't overdue) — nothing.
    expect((await searchAll(w.as.cat, q(text))).data).toEqual([]);
    // A project ana can't see is never read: PB's code stays a word.
    const pb = await searchAll(w.as.ana, q(`overdue PB${w.tag.toUpperCase()} tasks`));
    expect(pb.understood?.chips.map((c) => c.label)).toEqual(['Tasks', 'Overdue']);
    expect(pb.data).toEqual([]);
    // Ben's overdue task: his alone.
    expect(keys(await searchAll(w.as.ben, q('overdue tasks assigned to me')))).toEqual([`task:${w.tasks.TB1}`]);
  });

  it('the top bar’s first row counts what the person may open', async () => {
    const top = (await api.get(w.as.ana, `/search?${q('overdue tasks assigned to me')}`)) as { understood?: { total: number; chips: { label: string }[] } };
    expect(top.understood?.total).toBe(1);
    expect(top.understood?.chips.map((c) => c.label)).toEqual(['Tasks', 'Overdue', 'Assigned to me']);
  });

  it('a priority, a chip taken off, and the words instead', async () => {
    expect(keys(await searchAll(w.as.cat, q('high priority')))).toEqual([`task:${w.tasks.TA1}`]);
    // The overdue chip off: every task of ana's (none other is hers).
    expect(keys(await searchAll(w.as.ana, q('overdue tasks assigned to me', '&off=due')))).toEqual([`task:${w.tasks.TA1}`]);
    // Plain words: "overdue" is in no task.
    expect((await searchAll(w.as.ana, q('overdue tasks assigned to me', '&plain=true'))).data).toEqual([]);
  });
});

describe('checklist items: their own person and due date, their task’s access', () => {
  it('“overdue checklist items assigned to me” uses each item’s person and date', async () => {
    expect(keys(await searchAll(w.as.ana, q('overdue checklist items assigned to me')))).toEqual([`checklist:${made.itemA}`]);
    expect(keys(await searchAll(w.as.ben, q('overdue checklist items assigned to me')))).toEqual([`checklist:${made.itemB}`]);
    expect((await searchAll(w.as.cat, q('overdue checklist items assigned to me'))).data).toEqual([]);
  });

  it('an item of a task the person can’t open is never found (nor counted, nor its words shown)', async () => {
    const ana = await searchAll(w.as.ana, q('ZZITEM'));
    expect(keys(ana)).toEqual(sorted([`checklist:${made.itemA}`, `task:${w.tasks.TA1}`]));
    expect(ana.counts.checklist).toBe(1);
    expect(JSON.stringify(ana)).not.toContain('beta valves');
    const item = ana.data.find((h) => h.kind === 'checklist')!;
    expect(item.context).toContain('Checklist ‘Electrical’');
    expect(item.target).toEqual({ type: 'checklist', taskId: w.tasks.TA1, itemId: made.itemA });
    // The task result says where: "Checklist ‘Electrical’: ZZITEM Label circuits".
    const task = ana.data.find((h) => h.kind === 'task')!;
    expect(task.matches.map((m) => m.label)).toContain('Checklist ‘Electrical’');
  });
});

describe('review I2: an item or contact moved to another task (a merge, its undo) follows its task at once', () => {
  it('found only by those who may open the task it is on now — even before it is indexed again', async () => {
    // Moved to TB1 (PB, which ana can't open) without telling the index.
    await prisma.checklistItem.update({ where: { id: made.itemA }, data: { taskId: w.tasks.TB1, listId: null } });
    await prisma.taskExternalContact.update({ where: { id: made.contactA }, data: { taskId: w.tasks.TB1 } });
    try {
      for (const text of ['ZZITEM Label', 'ZZCONTACT Khalid']) {
        const ana = await searchAll(w.as.ana, q(text));
        expect(ana.data.filter((h) => h.kind !== 'task').map((h) => h.id), text).toEqual([]);
        expect((ana.counts.checklist ?? 0) + (ana.counts.contact ?? 0), text).toBe(0);
        expect(JSON.stringify(ana), text).not.toContain('TB1');
      }
      // ben (PB) finds them, on TB1.
      const ben = await searchAll(w.as.ben, q('ZZITEM Label', '&type=checklist'));
      const whole = ben.data.filter((h) => !h.match);
      expect(whole.map((h) => h.id)).toEqual([made.itemA]);
      expect(whole[0]!.key).toContain('TB1');
    } finally {
      await prisma.checklistItem.update({ where: { id: made.itemA }, data: { taskId: w.tasks.TA1, listId: made.list } });
      await prisma.taskExternalContact.update({ where: { id: made.contactA }, data: { taskId: w.tasks.TA1 } });
    }
  });
});

describe('review M8: a task change re-reads only the checklist items and contacts that changed', () => {
  it('unchanged: not written again; changed: written', async () => {
    const at = async () => (await prisma.searchIndex.findUniqueOrThrow({ where: { kind_recordId: { kind: 'checklist', recordId: made.itemB } } })).indexedAt.getTime();
    const before = await at();
    await new Promise((r) => setTimeout(r, 20));
    await index.taskPartsChanged(w.tasks.TB1);
    expect(await at()).toBe(before);
    await prisma.checklistItem.update({ where: { id: made.itemB }, data: { text: 'ZZITEM beta valves and gaskets' } });
    await index.taskPartsChanged(w.tasks.TB1);
    expect(await at()).toBeGreaterThan(before);
    await prisma.checklistItem.update({ where: { id: made.itemB }, data: { text: 'ZZITEM beta valves' } });
    await index.taskPartsChanged(w.tasks.TB1);
  });
});

describe('review I1: the new list routes follow the picked company (the company matrix)', () => {
  it('a company the person isn’t in, picked: refused before anything else is read', async () => {
    for (const url of ['/search/saved/counts', '/search/saved/counts?ids=x', '/search/saved/share-options']) {
      const res = await api.getRaw(w.as.ana, url, { 'x-company-id': w.companies.B });
      expect(res.statusCode, url).toBe(403);
    }
    // Their own company picked: the projects they run there.
    const cat = await api.getRaw(w.as.cat, '/search/saved/share-options', { 'x-company-id': w.companies.B });
    expect(cat.statusCode).toBe(200);
    expect((cat.json() as { data: unknown[] }).data).toEqual([]); // cat runs PA (company A) only
  });
});

describe('clients & contacts: each kind and its access', () => {
  it('external contacts: only on tasks the person may open', async () => {
    const ana = await searchAll(w.as.ana, q('ZZCONTACT', '&type=contact'));
    expect(keys(ana)).toEqual([`contact:contact:${made.contactA}`]);
    expect(JSON.stringify(ana)).not.toContain('Hidden');
    expect(ana.data[0]!.target).toEqual({ type: 'contact', taskId: w.tasks.TA1, contactId: made.contactA });
    expect(keys(await searchAll(w.as.cat, q('ZZCONTACT', '&type=contact')))).toEqual(sorted([`contact:contact:${made.contactA}`, `contact:contact:${made.contactB}`]));
    expect((await searchAll(w.as.amy, q('ZZCONTACT'))).total).toBe(0);
  });

  it('a client named on projects: counted over the projects the person may see only', async () => {
    const name = `zzclient petro ${w.tag}`;
    const ana = await searchAll(w.as.ana, q('ZZCLIENT', '&type=contact'));
    expect(keys(ana)).toEqual([`contact:client:${name}`]);
    expect(ana.data[0]!.context).toBe('Client of 1 project');
    const cat = await searchAll(w.as.cat, q('ZZCLIENT', '&type=contact'));
    expect(keys(cat)).toEqual([`contact:client:${name}`]); // PB2's client is ben's team's only
    expect(cat.data[0]!.context).toBe('Client of 2 projects');
    const admin = await searchAll(w.as.admin, q(`ZZCLIENT Petro ${w.tag}`, '&type=contact'));
    expect(admin.data.find((h) => h.id === `client:${name}`)!.context).toBe('Client of 2 projects'); // PC's company is archived
    const withArchived = await searchAll(w.as.admin, q(`ZZCLIENT Petro ${w.tag}`, '&type=contact&archived=true'));
    expect(withArchived.data.find((h) => h.id === `client:${name}`)!.context).toBe('Client of 3 projects');
    const ben = await searchAll(w.as.ben, q('ZZCLIENT Bonly', '&type=contact'));
    expect(ben.data.filter((h) => !h.match).map((h) => `${h.kind}:${h.id}`)).toEqual([`contact:client:${`zzclient bonly ${w.tag}`}`]); // the rest hold some of the words
    expect((await searchAll(w.as.gus, q('ZZCLIENT'))).total).toBe(0);
    expect((await searchAll(w.as.amy, q('ZZCLIENT'))).total).toBe(0);
  });

  it('a picked company narrows the new kinds as everything else', async () => {
    const pickA = await searchAll(w.as.cat, q('ZZCONTACT', '&type=contact'), w.companies.A);
    expect(keys(pickA)).toEqual([`contact:contact:${made.contactA}`]);
    const clientsA = await searchAll(w.as.cat, q('ZZCLIENT Petro', '&type=contact'), w.companies.A);
    expect(clientsA.data.find((h) => !h.match)!.context).toBe('Client of 1 project');
    const itemsB = await searchAll(w.as.cat, q('ZZITEM', '&type=checklist'), w.companies.B);
    expect(itemsB.data.map((h) => h.id)).toEqual([made.itemB]);
  });

  it('1.23.6 + onboarding: a client account’s result shows its onboarding status and whether its email is verified', async () => {
    const otp = await prisma.loginOtp.create({ data: { userId: made.account, codeHash: 'x', purpose: 'WELCOME', expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
    await prisma.user.update({ where: { id: made.account }, data: { invitedAt: new Date(), welcomeSentAt: new Date(), emailVerifiedAt: null } });
    try {
      const invited = (await searchAll(w.as.admin, q('ZZORG', '&type=contact'))).data[0]!;
      expect(invited.status).toMatchObject({ label: 'Invited', category: 'INVITED', done: false });
      expect(invited.context).toBe(`Client account · ZZORG Owner Group ${w.tag.toUpperCase()} · Email not verified`);
      await prisma.loginOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      expect((await searchAll(w.as.admin, q('ZZORG', '&type=contact'))).data[0]!.status?.label).toBe('Invite expired');
      await prisma.user.update({ where: { id: made.account }, data: { activatedAt: new Date(), emailVerifiedAt: new Date() } });
      const active = (await searchAll(w.as.admin, q('ZZORG', '&type=contact'))).data[0]!;
      expect(active.status?.label).toBe('Active');
      expect(active.context).toBe(`Client account · ZZORG Owner Group ${w.tag.toUpperCase()} · Email verified`);
      await prisma.user.update({ where: { id: made.account }, data: { status: 'INACTIVE' } });
      expect((await searchAll(w.as.admin, q('ZZORG', '&type=contact'))).data[0]!.status?.label).toBe('Deactivated');
    } finally {
      await prisma.user.update({ where: { id: made.account }, data: { status: 'ACTIVE', invitedAt: null, welcomeSentAt: null, activatedAt: null } });
      await prisma.loginOtp.deleteMany({ where: { userId: made.account } });
    }
  });

  it('a client portal account: administrators only', async () => {
    const admin = await searchAll(w.as.admin, q('ZZORG', '&type=contact'));
    expect(keys(admin)).toEqual([`contact:account:${made.account}`]);
    expect(admin.data[0]!.target).toEqual({ type: 'account', userId: made.account });
    for (const viewer of [w.as.ana, w.as.cat, w.as.ben]) {
      const page = await searchAll(viewer, q('ZZORG'));
      expect(page.total).toBe(0);
      expect(JSON.stringify(page)).not.toContain('Huda');
    }
  });
});

describe('saved searches', () => {
  it('save, names, share with a team you run, use but not change, counts for each person, unshare', async () => {
    // cat (a manager on PA's team) saves and shares with PA.
    const made1 = await send(w.as.cat, 'POST', '/search/saved', { name: 'Overdue of mine', q: 'overdue tasks assigned to me' });
    expect(made1.statusCode).toBe(201);
    const id = (made1.json() as { data: { id: string } }).data.id;
    expect((await send(w.as.cat, 'POST', '/search/saved', { name: ' overdue OF MINE ', q: 'x' })).statusCode).toBe(409);
    // Not a project cat runs (a member of PB only): refused.
    expect((await send(w.as.cat, 'PUT', `/search/saved/${id}/share`, { projectId: w.projects.PB })).statusCode).toBe(403);
    expect((await send(w.as.cat, 'PUT', `/search/saved/${id}/share`, { projectId: w.projects.PA })).statusCode).toBe(200);
    // ana (PA's team) sees it shared; amy (company A, not on the team) and bob don't.
    const anaList = (await api.get(w.as.ana, '/search/saved')) as { shared: { id: string; owner: { name: string }; shared: { projectId: string } }[] };
    expect(anaList.shared.map((s) => s.id)).toEqual([id]);
    expect(anaList.shared[0]!.shared.projectId).toBe(w.projects.PA);
    for (const viewer of [w.as.amy, w.as.bob, w.as.ben]) expect(((await api.get(viewer, '/search/saved')) as { shared: unknown[] }).shared).toEqual([]);
    // ana may use and pin it, never change it.
    expect((await send(w.as.ana, 'PATCH', `/search/saved/${id}`, { name: 'Mine now' })).statusCode).toBe(403);
    expect((await send(w.as.ana, 'DELETE', `/search/saved/${id}`)).statusCode).toBe(403);
    expect((await send(w.as.amy, 'PATCH', `/search/saved/${id}`, { name: 'x' })).statusCode).toBe(404);
    expect((await send(w.as.ana, 'PUT', `/search/saved/${id}/pin`, { pinned: true })).statusCode).toBe(200);
    // Its count is the search run for whoever asks: ana's overdue task for ana, nothing for cat.
    expect(await api.get(w.as.ana, `/search/saved/counts?ids=${id}`)).toEqual({ [id]: { total: 1, capped: false } });
    expect(await api.get(w.as.cat, `/search/saved/counts?ids=${id}`)).toEqual({ [id]: { total: 0, capped: false } });
    expect(await api.get(w.as.amy, `/search/saved/counts?ids=${id}`)).toEqual({});
    // Unshared: off ana's side menu, and no longer hers to use.
    expect((await send(w.as.cat, 'PUT', `/search/saved/${id}/share`, { projectId: null })).statusCode).toBe(200);
    const after = (await api.get(w.as.ana, '/search/saved')) as { shared: unknown[]; pinned: string[] };
    expect(after.shared).toEqual([]);
    expect(after.pinned).toEqual([]);
    expect(await prisma.savedSearchPin.count({ where: { savedSearchId: id } })).toBe(0);
  });

  it('pins: up to five; the sixth is refused with a reason', async () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_PINS + 1; i++) {
      const r = await send(w.as.ben, 'POST', '/search/saved', { name: `Pin ${i}`, q: `pump ${i}`, filters: { type: 'task', off: ['due'] } });
      ids.push((r.json() as { data: { id: string } }).data.id);
    }
    for (const id of ids.slice(0, MAX_PINS)) expect((await send(w.as.ben, 'PUT', `/search/saved/${id}/pin`, { pinned: true })).statusCode).toBe(200);
    const sixth = await send(w.as.ben, 'PUT', `/search/saved/${ids[MAX_PINS]}/pin`, { pinned: true });
    expect(sixth.statusCode).toBe(409);
    expect((sixth.json() as { error: { message: string } }).error.message).toBe('You can pin up to 5 searches. Unpin one first.');
    expect(((await api.get(w.as.ben, '/search/saved')) as { pinned: string[] }).pinned).toEqual(ids.slice(0, MAX_PINS));
    // Its filters come back as saved.
    expect(((await api.get(w.as.ben, '/search/saved')) as { mine: { filters: unknown }[] }).mine[0]!.filters).toEqual({ type: 'task', off: ['due'] });
    expect((await send(w.as.ben, 'PUT', `/search/saved/${ids[0]}/pin`, { pinned: false })).statusCode).toBe(200);
    expect((await send(w.as.ben, 'PUT', `/search/saved/${ids[MAX_PINS]}/pin`, { pinned: true })).statusCode).toBe(200);
    expect((await send(w.as.ben, 'DELETE', `/search/saved/${ids[1]}`)).statusCode).toBe(204);
    expect((await send(w.as.ana, 'DELETE', `/search/saved/${ids[2]}`)).statusCode).toBe(404);
  });

  it('share options: only the projects the person runs', async () => {
    const cat = (await api.get(w.as.cat, '/search/saved/share-options')) as { id: string }[];
    expect(cat.map((p) => p.id)).toEqual([w.projects.PA]);
    expect((await api.get(w.as.ana, '/search/saved/share-options')) as unknown[]).toEqual([]);
  });
});

describe('the new SQL reads alike on MySQL 8 and MariaDB', () => {
  it('every statement the reader’s filters, the new kinds and the counts send is portable', async () => {
    const sent: string[] = [];
    const client = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } }, log: [{ emit: 'event', level: 'query' }] });
    client.$on('query', (e) => void sent.push(e.query));
    try {
      const e = createSearchEngine({ prisma: client, timeZone: TZ });
      const scope = { projectIds: [w.projects.PA, w.projects.PB], clientAccounts: true, meetings: { full: null, invitee: [], editable: null } };
      const base = { scope, viewerId: w.people.ana, limit: 5, withCounts: true };
      await e.search({ ...base, q: '', browse: true, kinds: ['task', 'checklist'], due: { before: utc(today), open: true }, assigneeIds: [w.people.ana] });
      await e.search({ ...base, q: 'ZZCLIENT', kinds: ['contact'], includeArchived: true });
      await e.search({ ...base, q: 'ZZ', priorities: ['HIGH'], approval: false, unassigned: true, creatorIds: [w.people.ana] });
      await e.search({ ...base, q: '', browse: true, organizerIds: [w.people.ana], from: utc(today), to: utc(shiftDayKey(today, 7)) });
      await e.count({ ...base, q: 'ZZITEM', kinds: ['checklist'] });
      await createSearchIndex({ prisma: client }).probe();
      expect(sent.length).toBeGreaterThan(10);
      expect(sent.flatMap((sql) => portabilityProblems(sql).map((p) => `${p}: ${sql}`))).toEqual([]);
    } finally {
      await client.$disconnect();
    }
  });
});
