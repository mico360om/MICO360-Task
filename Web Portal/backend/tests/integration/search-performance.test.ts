import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createSearchIndex } from '../../src/modules/search/search-index';
import { createSearchEngine } from '../../src/modules/search/search-engine';
import { createSearchScope } from '../../src/modules/search/search-scope';
import { createTopBarMeetings } from '../../src/modules/search/top-bar-meetings';
import { createVocabulary } from '../../src/modules/search/search-fuzzy';
import { createPrismaSearchWords } from '../../src/modules/search/prisma-search-words';
import { createProjectAccess } from '../../src/modules/projects/project-access';
import { createProjectAuthz } from '../../src/modules/projects/project-authz';
import { createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import { createPrismaProjectManagerLookup } from '../../src/modules/projects/prisma-member-repository';
import { createCompanyAccess, readMyProjectsOnly } from '../../src/modules/companies/company-access';

// 1.23 Search everything — the performance test: standard search (the scope, both indexes, the
// counts, the results read again) over 50,000 items, p95 under 300 ms. Slow to set up (it writes the
// items and indexes them), so it runs only when asked, on a database of its own:
//   SEARCH_PERF=1 TEST_DATABASE_URL=mysql://…/mico360_t_s123_perf npx vitest run --config vitest.integration.config.ts tests/integration/search-performance.test.ts
const ON = process.env.SEARCH_PERF === '1';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });

const WORDS = (
  'pump valve rig mast derrick generator overhaul inspection scaffold permit welding crane lift plan drill pipe casing cement ' +
  'mud liner motor bearing seal gasket flange pressure gauge calibration electrical isolation lockout cable tray panel breaker ' +
  'transformer hydrocracker reactor exchanger compressor nitrogen purge leak test hydrotest commissioning procedure review loop ' +
  'instrument transmitter tank farm fire water foam deluge alarm safety stand-down toolbox talk incident report audit spare parts ' +
  'delivery warehouse procurement order invoice budget schedule delay crew shift night day handover maintenance planned corrective ' +
  'vibration temperature oil filter replacement contractor client meeting minutes decision action follow-up approval drawing ' +
  'مضخة صمام صيانة فحص سلامة تقرير تسرب مانع ضغط مولد كهرباء رافعة لحام تصريح مقاول عميل اجتماع قرار'
).split(' ');
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
const sentence = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(' ');
const TOTAL = { projects: 300, tasks: 40_000, comments: 0, meetings: 3_000, notes: 4_000, minutes: 300, files: 1_500, inspections: 950 };
const ITEMS = TOTAL.projects + TOTAL.tasks + TOTAL.meetings + TOTAL.notes + TOTAL.minutes + TOTAL.files + TOTAL.inspections;

let admin = { id: '', roles: ['ADMIN'] };
let member = { id: '', roles: ['EMPLOYEE'] };
const projectIds: string[] = [];

async function inBatches<T>(rows: T[], size: number, write: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
}

beforeAll(async () => {
  if (!ON) return;
  await prisma.$connect();
  // A database seeded by an earlier run is used as it is (seeding and indexing take a while).
  const before = await prisma.user.findFirst({ where: { username: { startsWith: 'perfadmin' } }, select: { id: true } });
  if (before) {
    admin = { id: before.id, roles: ['ADMIN'] };
    member = { id: (await prisma.user.findFirstOrThrow({ where: { username: { startsWith: 'perfmember' } }, select: { id: true } })).id, roles: ['EMPLOYEE'] };
    console.log('[search performance] using the items seeded before');
    return;
  }
  const role = async (name: string) => (await prisma.role.upsert({ where: { name }, update: {}, create: { name } })).id;
  const company = await prisma.company.create({ data: { name: 'Perf Co', code: `PF${Date.now() % 100000}` } });
  const mk = async (name: string, r: string) => (await prisma.user.create({ data: { email: `${name}@perf.test`, username: name, passwordHash: 'x', firstName: name, lastName: 'Perf', roles: { create: { roleId: await role(r) } }, companies: { create: { companyId: company.id } } } })).id;
  admin = { id: await mk(`perfadmin${Date.now()}`, 'ADMIN'), roles: ['ADMIN'] };
  member = { id: await mk(`perfmember${Date.now()}`, 'EMPLOYEE'), roles: ['EMPLOYEE'] };
  const columns: string[] = [];
  for (let i = 0; i < TOTAL.projects; i++) {
    const p = await prisma.project.create({
      data: {
        code: `PF${i}X${Date.now() % 1000}`, name: `${sentence(3)} ${i}`, description: sentence(25), status: 'ACTIVE', createdById: admin.id, mainCompanyId: company.id,
        companies: { create: { companyId: company.id } }, ...(i % 3 === 0 ? { members: { create: { userId: member.id } } } : {}),
      },
    });
    projectIds.push(p.id);
    columns.push((await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'To do', category: 'TODO', position: 0 } })).id);
  }
  const tasks: Prisma.TaskCreateManyInput[] = Array.from({ length: TOTAL.tasks }, (_, i) => {
    const at = i % TOTAL.projects;
    return { key: `PF${at}X-${i}`, title: sentence(6), description: rand() < 0.7 ? sentence(30) : null, projectId: projectIds[at]!, columnId: columns[at]!, createdById: admin.id };
  });
  await inBatches(tasks, 2000, (b) => prisma.task.createMany({ data: b }));
  const taskRows = await prisma.task.findMany({ where: { projectId: { in: projectIds } }, select: { id: true, projectId: true } });
  await inBatches(taskRows.filter((_, i) => i % 2 === 0), 2000, (b) => prisma.comment.createMany({ data: b.map((t) => ({ taskId: t.id, userId: admin.id, body: sentence(20) })) }));
  const startAt = new Date();
  await inBatches(Array.from({ length: TOTAL.meetings }, (_, i) => i), 1000, (b) => prisma.meeting.createMany({ data: b.map((i) => ({ title: sentence(5), description: sentence(20), projectId: projectIds[i % TOTAL.projects]!, organizerId: admin.id, createdById: admin.id, startAt: new Date(startAt.getTime() - i * 3600_000), status: 'SCHEDULED' as const })) }));
  const meetings = await prisma.meeting.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } });
  await inBatches(Array.from({ length: TOTAL.notes }, (_, i) => i), 2000, (b) => prisma.meetingNote.createMany({ data: b.map((i) => ({ meetingId: meetings[i % meetings.length]!.id, authorId: admin.id, body: sentence(40) })) }));
  await inBatches(meetings.slice(0, TOTAL.minutes), 300, (b) => prisma.meetingMinutes.createMany({ data: b.map((m) => ({ meetingId: m.id, status: 'APPROVED', content: JSON.stringify({ summary: sentence(30), discussion: [{ topic: sentence(3), text: sentence(60) }], decisions: [sentence(10)], risks: [], nextSteps: [] }) })) }));
  await inBatches(taskRows.slice(0, TOTAL.files), 500, async (b) => {
    await prisma.attachment.createMany({ data: b.map((t, i) => ({ taskId: t.id, uploadedById: admin.id, filename: `${pick(WORDS)}-${i}.pdf`, mimeType: 'application/pdf', sizeBytes: 1, storageKey: `perf-${t.id}`, url: '/u/x' })) });
  });
  const files = await prisma.attachment.findMany({ where: { task: { projectId: { in: projectIds } } }, select: { id: true } });
  await inBatches(files, 200, (b) => prisma.searchFileText.createMany({ data: b.map((f) => ({ fileId: f.id, status: 'READ', method: 'pdf', text: sentence(600), readAt: new Date() })) }));
  await inBatches(Array.from({ length: TOTAL.inspections }, (_, i) => i), 500, (b) => prisma.inspection.createMany({ data: b.map((i) => ({ projectId: projectIds[i % TOTAL.projects]!, title: sentence(4), description: sentence(15), formVersion: 1, inspectorId: admin.id, startedById: admin.id, structure: { sections: [{ id: 's', title: sentence(2), items: [{ id: 'i', kind: 'CHECK', label: sentence(5), help: null }] }] } })) }));

  const words = createPrismaSearchWords(prisma);
  const vocabulary = createVocabulary({ load: words.load, store: words.store });
  const started = Date.now();
  await createTaskSearchIndex({ prisma, words: vocabulary }).rebuildAll();
  await createSearchIndex({ prisma, words: vocabulary }).rebuildAll();
  console.log(`[search performance] ${ITEMS} items written and indexed in ${Math.round((Date.now() - started) / 1000)} s`);
}, 60 * 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!ON)('search performance (50,000 items)', () => {
  it('standard search: p95 under 300 ms (the scope, both indexes, the counts, the results read again)', async () => {
    const words = createPrismaSearchWords(prisma);
    const vocabulary = createVocabulary({ load: words.load });
    const engine = createSearchEngine({ prisma, timeZone: 'Asia/Muscat', suggest: (w) => vocabulary.suggest(w) });
    const projectRepository = createPrismaProjectRepository(prisma);
    const projectAccess = createProjectAccess({ projects: projectRepository, managers: createPrismaProjectManagerLookup(prisma), myProjectsOnly: (u) => readMyProjectsOnly(prisma, u) });
    const authz = createProjectAuthz({ managers: createPrismaProjectManagerLookup(prisma) });
    const companies = createCompanyAccess(prisma);
    const scopes = createSearchScope({ prisma, accessibleProjectIds: (u, r, p) => projectAccess.accessibleProjectIds(u, r, p), manageableProjectIds: (u, r, ids) => authz.manageableProjectIds(u, r, ids), myProjectsOnly: (v) => companies.myProjectsOnly(v) });
    const queries = ['pump', 'valve replacement', 'mud liner', '"fire water"', 'insp', 'hydrocrak', 'genrator overhaul', 'مضخة', 'صيانة مضخة', 'PF12X-3412', 'compressor nitrogen purge', 'zzzz nothing'];
    const times: number[] = [];
    const time = async (viewer: { id: string; roles: string[] }, q: string) => {
      const t0 = performance.now();
      const scope = await scopes.forViewer(viewer, null);
      await engine.search({ q, scope, viewerId: viewer.id, limit: 20, withCounts: true });
      return performance.now() - t0;
    };
    for (const q of queries) await time(admin, q); // warm up
    for (let round = 0; round < 5; round++) {
      for (const viewer of [admin, member]) for (const q of queries) times.push(await time(viewer, q));
    }
    times.sort((a, b) => a - b);
    const at = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))]!;
    console.log(`[search performance] ${ITEMS} items, ${times.length} searches — p50 ${at(0.5).toFixed(0)} ms, p95 ${at(0.95).toFixed(0)} ms, max ${times[times.length - 1]!.toFixed(0)} ms`);
    expect(ITEMS).toBeGreaterThanOrEqual(50_000);
    expect(at(0.95)).toBeLessThan(300);
  }, 30 * 60_000);

  // Review #22/#10 (13 Nov 2026): the top bar's meetings now come from the index, beside its other
  // kinds — the scope read for the request, then both in parallel, as GET /search does. Same budget.
  it('the top bar (meetings + its other kinds): p95 under 300 ms', async () => {
    const words = createPrismaSearchWords(prisma);
    const vocabulary = createVocabulary({ load: words.load });
    const engine = createSearchEngine({ prisma, timeZone: 'Asia/Muscat', suggest: (w) => vocabulary.suggest(w) });
    const meetings = createTopBarMeetings({ prisma, engine });
    const projectRepository = createPrismaProjectRepository(prisma);
    const projectAccess = createProjectAccess({ projects: projectRepository, managers: createPrismaProjectManagerLookup(prisma), myProjectsOnly: (u) => readMyProjectsOnly(prisma, u) });
    const authz = createProjectAuthz({ managers: createPrismaProjectManagerLookup(prisma) });
    const companies = createCompanyAccess(prisma);
    const scopes = createSearchScope({ prisma, accessibleProjectIds: (u, r, p) => projectAccess.accessibleProjectIds(u, r, p), manageableProjectIds: (u, r, ids) => authz.manageableProjectIds(u, r, ids), myProjectsOnly: (v) => companies.myProjectsOnly(v) });
    const queries = ['pump', 'valve replacement', 'mud liner', '"fire water"', 'insp', 'hydrocrak', 'مضخة', 'صيانة مضخة', 'compressor nitrogen purge', 'zzzz nothing'];
    const times: number[] = [];
    let found = 0;
    const time = async (viewer: { id: string; roles: string[] }, q: string) => {
      const t0 = performance.now();
      const scope = await scopes.forViewer(viewer, null);
      const [m] = await Promise.all([
        meetings.search({ q, scope, viewerId: viewer.id }),
        engine.search({ q, scope, viewerId: viewer.id, kinds: ['note', 'minutes', 'file', 'inspection'], limit: 5, exactOnly: true }),
      ]);
      found += m.length;
      return performance.now() - t0;
    };
    for (const q of queries) await time(admin, q); // warm up
    for (let round = 0; round < 5; round++) {
      for (const viewer of [admin, member]) for (const q of queries) times.push(await time(viewer, q));
    }
    times.sort((a, b) => a - b);
    const at = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))]!;
    console.log(`[search performance] top bar, ${times.length} searches — p50 ${at(0.5).toFixed(0)} ms, p95 ${at(0.95).toFixed(0)} ms, max ${times[times.length - 1]!.toFixed(0)} ms`);
    expect(found).toBeGreaterThan(0);
    expect(at(0.95)).toBeLessThan(300);
  }, 30 * 60_000);
});
