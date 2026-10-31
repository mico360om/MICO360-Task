import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createSearchService } from '../../src/modules/search/search-service';
import { createPrismaSearchDataSource } from '../../src/modules/search/prisma-search-data-source';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createTaskSearchEngine } from '../../src/modules/search/task-search-engine';
import { createPrismaMicoAiData } from '../../src/modules/mico-ai/prisma-mico-ai-data';
import { createMicoAiTools } from '../../src/modules/mico-ai/mico-ai-tools';
import type { Viewer as AiViewer } from '../../src/modules/mico-ai/mico-ai-data';
import { createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import { createProjectAccess } from '../../src/modules/projects/project-access';
import { createPrismaProjectManagerLookup } from '../../src/modules/projects/prisma-member-repository';
import { createProjectAuthz } from '../../src/modules/projects/project-authz';
import { createPrismaMeetingRepository } from '../../src/modules/meetings/prisma-meeting-repository';
import { createMeetingAccess } from '../../src/modules/meetings/meeting-access';
import { createMessageService } from '../../src/modules/chat/message-service';
import {
  createPrismaChatMemberLookup,
  createPrismaConversationRepository,
  createPrismaMessageRepository,
  createPrismaParticipantRepository,
  createPrismaReactionRepository,
} from '../../src/modules/chat/prisma-chat-repository';
import { createPrismaFinalMinutesRepository } from '../../src/modules/meetings/final-minutes-repository';
import { buildCompanyWorld, dropCompanyWorld, sorted, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// companies (Task 13): search (the global search and the full task search) and MICO AI's tools answer
// only from the person's companies and the picked one (X-Company-Id).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const projectRepository = createPrismaProjectRepository(prisma);
const projectAccess = createProjectAccess({ projects: projectRepository, managers: createPrismaProjectManagerLookup(prisma) });
const projectAuthz = createProjectAuthz({ managers: createPrismaProjectManagerLookup(prisma) });
const meetingAccess = createMeetingAccess({
  meetings: createPrismaMeetingRepository(prisma),
  projectAccess: {
    canViewProject: (u, r, p) => projectAccess.canViewProject(u, r, p),
    accessibleProjectIds: (u, r, pick?: string | null) => projectAccess.accessibleProjectIds(u, r, pick),
    canManageProject: (u, r, p) => projectAuthz.canManageProject(u, r, p),
  },
});
const chat = createMessageService({
  conversations: createPrismaConversationRepository(prisma),
  participants: createPrismaParticipantRepository(prisma),
  messages: createPrismaMessageRepository(prisma),
  reactions: createPrismaReactionRepository(prisma),
  members: createPrismaChatMemberLookup(prisma),
});
const micoData = createPrismaMicoAiData({
  prisma,
  projectAccess,
  meetingAccess,
  conversationIdsFor: (userId) => chat.accessibleConversationIds(userId),
  finalMinutes: createPrismaFinalMinutesRepository(prisma),
});
const tools = createMicoAiTools({ data: micoData, timeZone: 'Asia/Muscat' });
const searchIndex = createTaskSearchIndex({ prisma });
const taskSearch = createTaskSearchEngine({ prisma, index: searchIndex, timeZone: 'Asia/Muscat' });

let w: CompanyWorld;
let api: CompanyApp;

type Results = { tasks: { projectId: string }[]; projects: { id: string }[]; users: { id: string }[]; meetings: { id: string; projectId: string | null; snippet: string }[] };
const search = async (viewer: { id: string; roles: string[] }, q: string, opts: { pick?: string } = {}) =>
  (await api.get(viewer, `/search?q=${encodeURIComponent(q)}`, opts.pick ? { 'x-company-id': opts.pick } : {})) as Results;
const projectIdsOf = (r: Results) => sorted([...new Set([...r.tasks.map((t) => t.projectId), ...r.projects.map((p) => p.id), ...r.meetings.map((m) => m.projectId).filter((p): p is string => !!p)])]);
const peopleOf = (r: Results) => r.users.map((u) => u.id);
const taskIndexSearch = async (viewer: { id: string; roles: string[] }, q: string, pick?: string) =>
  ((await api.get(viewer, `/search/tasks?q=${encodeURIComponent(q)}`, pick ? { 'x-company-id': pick } : {})) as { id: string }[]).map((h) => h.id);
const asAi = (v: { id: string; roles: string[] }, pick: string | null = null): AiViewer => ({ userId: v.id, roles: v.roles, pick });
const tool = (name: string, args: Record<string, unknown>, viewer: AiViewer) => tools.run(viewer, name, args);
type ToolOut = Awaited<ReturnType<typeof tool>>;
const refsOf = (out: ToolOut, type: string) => sorted(out.rows.map((r) => r.ref).filter((ref): ref is NonNullable<typeof ref> => !!ref && ref.type === type).map((ref) => ref.id!));

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
  for (const taskId of Object.values(w.tasks)) await searchIndex.taskChanged(taskId);
  api = await buildCompanyApp(prisma, () => ({
    searchService: createSearchService({ data: createPrismaSearchDataSource(prisma), tasks: taskSearch }),
    taskSearch,
  }));
});

afterAll(async () => {
  await api?.close();
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

describe('search and MICO AI follow companies and the pick (companies)', () => {
  it('search: ana never finds Beta’s words; cat with pick Alpha finds only Alpha’s', async () => {
    const { ana, cat } = w.as;
    const empty = { tasks: [], projects: [], users: [], meetings: [] };
    expect(await search(ana, 'ZZBETA')).toEqual(empty);
    expect(await search(ana, 'ZZGAMMA')).toEqual(empty);
    expect(projectIdsOf(await search(cat, 'ZZ', { pick: w.companies.A }))).toEqual([w.projects.PA]);
    expect(projectIdsOf(await search(cat, 'ZZ', { pick: w.companies.B }))).toEqual([w.projects.PB]);
    expect(await taskIndexSearch(ana, 'ZZBETA')).toEqual([]); // the full task index (comments, checklist, files, contacts)
    expect(sorted(await taskIndexSearch(cat, 'ZZ', w.companies.A))).toEqual(sorted([w.tasks.TA1, w.tasks.TA2]));
    expect(sorted(await taskIndexSearch(cat, 'ZZ'))).toEqual(sorted([w.tasks.TA1, w.tasks.TA2, w.tasks.TB1, w.tasks.TB2]));
    expect(await taskIndexSearch(cat, 'ZZBETA', w.companies.A)).toEqual([]);
    expect(peopleOf(await search(ana, 'Bob'))).toEqual([]);
    expect(peopleOf(await search(ana, 'Gus'))).toEqual([]);
    expect(peopleOf(await search(ana, 'Amy'))).toEqual([w.people.amy]); // a colleague
  });

  it('search people: colleagues only, the pick’s people with a pick; admins everyone', async () => {
    const { cat, admin } = w.as;
    expect(peopleOf(await search(cat, 'Betaonly'))).toEqual([w.people.bob]);
    expect(peopleOf(await search(cat, 'Betaonly', { pick: w.companies.A }))).toEqual([]);
    expect(peopleOf(await search(admin, 'Gammaonly'))).toEqual([w.people.gus]);
    expect(peopleOf(await search(admin, 'Betaonly', { pick: w.companies.A }))).toEqual([]);
  });

  it('search meetings: an invitee finds the meeting, never its notes; a pick narrows meetings too', async () => {
    const { bob, ana } = w.as;
    const found = await search(bob, 'ZZALPHA');
    expect(found.meetings.map((m) => m.id)).toEqual([w.meetings.MA]);
    expect(JSON.stringify(found)).not.toContain('ZZALPHA note');
    expect((await search(bob, 'note')).meetings).toEqual([]);
    expect((await search(ana, 'note')).meetings.map((m) => m.id)).toEqual([w.meetings.MA]); // the team sees the notes
    expect((await search(bob, 'ZZALPHA', { pick: w.companies.B })).meetings).toEqual([]); // invitations show under all my companies only
    expect((await search(ana, 'MN_A', { pick: w.companies.A })).meetings.map((m) => m.id)).toEqual([w.meetings.MN_A]);
  });

  it('MICO AI tools for ana stay inside her companies', async () => {
    const { ana, bob } = w.as;
    expect(refsOf(await tool('list_projects', {}, asAi(ana)), 'project')).toEqual(sorted([w.projects.PA, w.projects.PAB]));
    expect(JSON.stringify(await tool('find_people', { name: 'b' }, asAi(ana)))).not.toMatch(/Betaonly|Gammaonly/);
    expect(JSON.stringify(await tool('find_people', {}, asAi(ana)))).not.toMatch(/Betaonly|Gammaonly/);
    expect(JSON.stringify(await tool('search_tasks', { query: 'ZZBETA' }, asAi(ana)))).not.toContain('ZZBETA');
    // bob was invited to MA: he sees the meeting and his own action item — not its notes, nor ana's item.
    const details = JSON.stringify(await tool('meeting_details', { meeting: w.meetings.MA }, asAi(bob)));
    expect(details).toContain('MA ZZALPHA meeting');
    expect(details).toContain(`ZZALPHA action for ${w.people.bob}`);
    expect(details).not.toContain('ZZALPHA note');
    expect(details).not.toContain(`ZZALPHA action for ${w.people.ana}`);
    const items = JSON.stringify(await tool('list_action_items', {}, asAi(bob)));
    expect(items).not.toContain(`ZZALPHA action for ${w.people.ana}`);
    // ana runs the meeting's project team: the whole meeting.
    expect(JSON.stringify(await tool('meeting_details', { meeting: w.meetings.MA }, asAi(ana)))).toContain('ZZALPHA note');
  });

  it('MICO AI with pick Beta counts only Beta', async () => {
    const { cat } = w.as;
    expect(refsOf(await tool('report_figures', { report: 'projects' }, asAi(cat, w.companies.B)), 'project')).toEqual([w.projects.PB]);
    expect(refsOf(await tool('list_projects', {}, asAi(cat, w.companies.B)), 'project')).toEqual([w.projects.PB]);
    expect(refsOf(await tool('list_projects', {}, asAi(cat)), 'project')).toEqual(sorted([w.projects.PA, w.projects.PB]));
    expect(JSON.stringify(await tool('search_tasks', { query: 'ZZALPHA' }, asAi(cat, w.companies.B)))).not.toContain('ZZALPHA task');
    expect(refsOf(await tool('list_meetings', {}, asAi(w.as.bob, w.companies.B)), 'meeting')).toEqual([]);
  });
});
