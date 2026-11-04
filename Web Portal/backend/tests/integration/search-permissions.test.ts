import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createSearchService } from '../../src/modules/search/search-service';
import { createPrismaSearchDataSource } from '../../src/modules/search/prisma-search-data-source';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createTaskSearchEngine } from '../../src/modules/search/task-search-engine';
import { createSearchIndex } from '../../src/modules/search/search-index';
import { createSearchEngine } from '../../src/modules/search/search-engine';
import { createSearchScope } from '../../src/modules/search/search-scope';
import { createAiSearch } from '../../src/modules/search/search-ai';
import { createCompanyAccess, meetingViewsOf, type Viewer } from '../../src/modules/companies/company-access';
import type { SearchHit } from '../../src/modules/search/search-types';
import { buildCompanyWorld, dropCompanyWorld, sorted, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// 1.23 Search everything — the permission leak matrix: every role, company, picked company, "Show my
// projects only" and the invitee view; nothing of an item a person can't open (titles, words, counts).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const taskIndex = createTaskSearchIndex({ prisma });
const index = createSearchIndex({ prisma });
const engine = createSearchEngine({ prisma, timeZone: 'Asia/Muscat' });
const companyAccess = createCompanyAccess(prisma);
const prompts: string[] = [];

let w: CompanyWorld;
let api: CompanyApp;
const extra = { file: '', inspection: '', decision: '' };

type Page = { data: SearchHit[]; counts: Record<string, number>; total: number };
const searchAll = async (viewer: Viewer, q: string, pick?: string): Promise<Page> => {
  const res = await api.getRaw(viewer, `/search/all?q=${encodeURIComponent(q)}`, pick ? { 'x-company-id': pick } : {});
  if (res.statusCode !== 200) throw new Error(`${res.statusCode} ${res.body}`);
  return res.json() as Page;
};
const keys = (p: Page) => sorted(p.data.map((h) => `${h.kind}:${h.id}`));

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
  const { people, projects, tasks, meetings } = w;
  // More of each kind, all marked ZZALPHA (PA, company A): a file, an inspection, a decision and minutes of MA.
  extra.file = (await prisma.attachment.create({ data: { taskId: tasks.TA1, uploadedById: people.ana, filename: 'zz-permit.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: `zz-${w.tag}.pdf`, url: '/u/zz' } })).id;
  await prisma.searchFileText.create({ data: { fileId: extra.file, status: 'READ', method: 'pdf', text: 'ZZALPHA file text inside the permit', readAt: new Date() } });
  extra.inspection = (await prisma.inspection.create({ data: { projectId: projects.PA, title: 'ZZALPHA inspection', formVersion: 1, inspectorId: people.ana, startedById: people.ana, structure: { sections: [] } } })).id;
  extra.decision = (await prisma.decision.create({ data: { meetingId: meetings.MA, title: 'ZZALPHA decision stop the crane', createdById: people.ana } })).id;
  await prisma.meetingMinutes.create({ data: { meetingId: meetings.MA, status: 'DRAFT', content: JSON.stringify({ summary: 'ZZALPHA draft minutes', discussion: [], decisions: [], risks: [], nextSteps: [] }) } });
  await prisma.meetingMinutes.create({ data: { meetingId: meetings.MB, status: 'APPROVED', approvedAt: new Date(), content: JSON.stringify({ summary: 'ZZBETA final minutes', discussion: [], decisions: [], risks: [], nextSteps: [] }) } });
  // Every meeting gets a ZZGUEST word in its title (from the agenda) so the meetings themselves can be compared.
  for (const id of Object.values(meetings)) await prisma.agendaItem.create({ data: { meetingId: id, title: `ZZGUEST agenda of ${id}` } });

  await taskIndex.refresh(Object.values(tasks));
  await index.refresh('project', Object.values(projects));
  for (const id of Object.values(meetings)) await index.meetingChanged(id);
  await index.refresh('file', [extra.file]);
  await index.refresh('inspection', [extra.inspection]);

  api = await buildCompanyApp(prisma, (base) => {
    const scope = createSearchScope({
      prisma,
      accessibleProjectIds: (u, r, pick) => base.projectAccess!.accessibleProjectIds(u, r, pick),
      manageableProjectIds: (u, r, ids) => base.projectAuthz!.manageableProjectIds(u, r, ids),
      myProjectsOnly: (viewer) => companyAccess.myProjectsOnly(viewer),
    });
    const ai = createAiSearch({
      ai: {
        chatReady: async () => true,
        startSearchQuestion: () => undefined,
        chat: async (input) => {
          prompts.push(input.prompt);
          return input.prompt.startsWith('Question:') ? JSON.stringify({ answer: 'Here.', best: ['R1'] }) : JSON.stringify({ keywords: input.prompt.split(/\s+/) });
        },
      },
      candidates: (query, viewer, s) => engine.anyWords({ q: '', scope: s, viewerId: viewer.id, ...query }),
      projects: async () => [],
      timeZone: 'Asia/Muscat',
    });
    const taskSearch = createTaskSearchEngine({ prisma, index: taskIndex, timeZone: 'Asia/Muscat' });
    return {
      searchService: createSearchService({ data: createPrismaSearchDataSource(prisma), tasks: taskSearch }),
      taskSearch,
      searchEverything: { engine, scope, ai: { status: async () => ({ ready: true, semantic: false }), ask: ai.ask }, timeZone: 'Asia/Muscat' },
    };
  });
});

afterAll(async () => {
  await api?.close();
  if (w) {
    await prisma.searchIndex.deleteMany({ where: { OR: [{ projectId: { in: Object.values(w.projects) } }, { meetingId: { in: Object.values(w.meetings) } }, { recordId: { in: [extra.file, extra.inspection] } }] } });
    await prisma.decision.deleteMany({ where: { id: extra.decision } });
    await prisma.inspection.deleteMany({ where: { id: extra.inspection } });
    await prisma.user.updateMany({ where: { id: w.people.admin }, data: { myProjectsOnly: false } });
    await dropCompanyWorld(prisma, w);
  }
  await prisma.$disconnect();
});

describe('search everything: the permission leak matrix', () => {
  it('a team member: their projects’ items of every kind, nothing of another company', async () => {
    const { ana } = w.as;
    expect(keys(await searchAll(ana, 'ZZALPHA'))).toEqual(
      // ana organizes MA: its draft minutes too.
      sorted([`task:${w.tasks.TA1}`, `task:${w.tasks.TA2}`, `meeting:${w.meetings.MA}`, `meeting:${w.meetings.MN_A}`, `note:${w.notes.MA}`, `minutes:${w.meetings.MA}`, `file:${extra.file}`, `inspection:${extra.inspection}`]),
    );
    const draft = await searchAll(ana, 'ZZALPHA draft');
    expect(draft.data.filter((h) => !h.match).map((h) => `${h.kind}:${h.id}`)).toEqual([`minutes:${w.meetings.MA}`]); // the rest hold some of the words
    // amy is on PA's company but not its team, and not at MA: nothing of PA; MN_A she organizes.
    expect(keys(await searchAll(w.as.amy, 'ZZALPHA'))).toEqual([`meeting:${w.meetings.MN_A}`]);
    for (const q of ['ZZBETA', 'ZZGAMMA']) {
      const page = await searchAll(ana, q);
      expect(page.data, q).toEqual([]);
      expect(page.total, q).toBe(0); // not even a count
    }
    expect(keys(await searchAll(ana, 'ZZSHARED'))).toEqual([`task:${w.tasks.TAB1}`]);
  });

  it('invited from another company: the meeting by its own words — never its notes, decisions, action items or draft minutes', async () => {
    const { bob } = w.as;
    const page = await searchAll(bob, 'ZZALPHA');
    expect(keys(page)).toEqual([`meeting:${w.meetings.MA}`]);
    const text = JSON.stringify(page);
    for (const hidden of ['ZZALPHA note', 'ZZALPHA decision', 'ZZALPHA action', 'ZZALPHA draft', 'ZZALPHA file', 'ZZALPHA inspection', 'ZZALPHA description', 'ZZALPHA comment']) expect(text).not.toContain(hidden);
    expect((await searchAll(bob, 'crane')).data).toEqual([]); // a decision's word
    expect((await searchAll(bob, 'ZZALPHA', w.companies.B)).data).toEqual([]); // invitations under "All my companies" only
  });

  it('two companies: each pick narrows to its own; no pick shows both', async () => {
    const { cat } = w.as;
    const both = keys(await searchAll(cat, 'ZZ'));
    expect(both).toEqual(expect.arrayContaining([`task:${w.tasks.TA1}`, `task:${w.tasks.TB1}`, `meeting:${w.meetings.MA}`, `meeting:${w.meetings.MB}`, `minutes:${w.meetings.MB}`]));
    const pickA = keys(await searchAll(cat, 'ZZ', w.companies.A));
    expect(pickA.some((k) => k.includes(w.tasks.TB1) || k.includes(w.meetings.MB))).toBe(false);
    const pickB = keys(await searchAll(cat, 'ZZ', w.companies.B));
    expect(pickB.some((k) => k.includes(w.tasks.TA1) || k.includes(w.meetings.MA) || k.includes(extra.file))).toBe(false);
  });

  it('all their companies archived: nothing at all', async () => {
    expect((await searchAll(w.as.gus, 'ZZGAMMA')).data).toEqual([]);
    expect((await searchAll(w.as.gus, 'ZZ')).total).toBe(0);
  });

  it('an administrator: everything; a pick narrows to that company; "Show my projects only" to their own', async () => {
    const { admin } = w.as;
    const all = keys(await searchAll(admin, 'ZZ'));
    expect(all).toEqual(expect.arrayContaining([`task:${w.tasks.TA1}`, `task:${w.tasks.TB1}`, `minutes:${w.meetings.MA}`, `note:${w.notes.MA}`]));
    // PC's only company is archived: its task with "Include archived" only.
    expect(all).not.toContain(`task:${w.tasks.TC1}`);
    const res = await api.getRaw(admin, '/search/all?q=ZZGAMMA&archived=true');
    expect((res.json() as Page).data.map((h) => h.id)).toEqual([w.tasks.TC1]);
    const pickB = keys(await searchAll(admin, 'ZZ', w.companies.B));
    expect(pickB.some((k) => k.includes(w.tasks.TA1) || k.includes(w.meetings.MA))).toBe(false);
    expect(pickB).toEqual(expect.arrayContaining([`task:${w.tasks.TB1}`, `meeting:${w.meetings.MB}`, `meeting:${w.meetings.MN_B}`]));
    await prisma.user.update({ where: { id: admin.id }, data: { myProjectsOnly: true } });
    try {
      expect((await searchAll(admin, 'ZZ')).data).toEqual([]); // on no project's team, at no meeting
    } finally {
      await prisma.user.update({ where: { id: admin.id }, data: { myProjectsOnly: false } });
    }
  });

  it('the meetings found are exactly the meetings list’s, for every person and pick', async () => {
    const meetingsOf = async (viewer: Viewer, pick?: string) => sorted(((await api.get(viewer, '/meetings', pick ? { 'x-company-id': pick } : {})) as { id: string }[]).map((m) => m.id).filter((id) => Object.values(w.meetings).includes(id)));
    const foundOf = async (viewer: Viewer, pick?: string) => sorted((await searchAll(viewer, 'ZZGUEST', pick)).data.filter((h) => h.kind === 'meeting').map((h) => h.id));
    for (const [name, viewer] of Object.entries(w.as)) {
      for (const pick of [undefined, w.companies.A, w.companies.B]) {
        const isMember = pick === undefined || name === 'admin' || (pick === w.companies.A ? ['ana', 'amy', 'cat'] : ['ben', 'bob', 'cat']).includes(name);
        if (!isMember) continue; // a pick of a company they aren't in is refused, as everywhere
        expect(await foundOf(viewer, pick), `${name} ${pick ?? 'all'}`).toEqual(await meetingsOf(viewer, pick));
      }
    }
  });

  it('the batched invitee rule is meetingView’s, for every person and meeting', async () => {
    const meetings = await prisma.meeting.findMany({ where: { id: { in: Object.values(w.meetings) } }, select: { id: true, projectId: true, organizerId: true, createdById: true, attendees: { select: { userId: true } } } });
    for (const viewer of Object.values(w.as)) {
      const facts = meetings.map((m) => ({ id: m.id, projectId: m.projectId, organizerId: m.organizerId, createdById: m.createdById, attendeeUserIds: m.attendees.map((a) => a.userId).filter((u): u is string => !!u) }));
      const batched = await meetingViewsOf(prisma, viewer, facts);
      for (const m of facts) expect(batched.get(m.id), `${viewer.id} ${m.id}`).toBe(await companyAccess.meetingView(viewer, m));
    }
  });

  it('the AI panel is given only what the person may open', async () => {
    prompts.length = 0;
    const res = await api.post(w.as.bob, '/search/ai', { q: 'ZZALPHA crane note' });
    expect(res.statusCode).toBe(200);
    const sent = prompts.join('\n');
    expect(sent).toContain('ZZALPHA meeting'); // the meeting he was invited to
    for (const hidden of ['ZZALPHA note', 'ZZALPHA decision', 'ZZALPHA task', 'ZZALPHA file', 'ZZALPHA draft']) expect(sent).not.toContain(hidden);
    prompts.length = 0;
    await api.post(w.as.ana, '/search/ai', { q: 'ZZBETA ZZGAMMA' });
    expect(prompts.join('\n')).not.toMatch(/R1 \|/); // nothing to give: no answer call at all
  });

  it('the top-bar search’s other kinds follow the same rules', async () => {
    const top = (await api.get(w.as.bob, '/search?q=ZZALPHA')) as { more?: SearchHit[] };
    expect(top.more).toEqual([]);
    const ana = (await api.get(w.as.ana, '/search?q=ZZALPHA')) as { more?: SearchHit[] };
    expect(sorted((ana.more ?? []).map((h) => `${h.kind}:${h.id}`))).toEqual(sorted([`note:${w.notes.MA}`, `minutes:${w.meetings.MA}`, `file:${extra.file}`, `inspection:${extra.inspection}`]));
  });

  it('a client page session (no staff sign-in) is refused', async () => {
    for (const url of ['/api/v1/search/all?q=ZZALPHA', '/api/v1/search/ai/status', '/api/v1/search?q=ZZALPHA']) {
      const res = await api.app.inject({ method: 'GET', url, headers: { cookie: 'mico_client_session=x' } });
      expect(res.statusCode, url).toBe(401);
    }
    expect((await api.app.inject({ method: 'POST', url: '/api/v1/search/ai', payload: { q: 'ZZALPHA' } })).statusCode).toBe(401);
  });
});
