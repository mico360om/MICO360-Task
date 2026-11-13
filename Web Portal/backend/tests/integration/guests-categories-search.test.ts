import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createSearchEngine, type SearchAllInput } from '../../src/modules/search/search-engine';
import { engineInput } from '../../src/modules/search/search-routes';
import { readQuery } from '../../src/modules/search/search-reader';
import type { SearchScopeAll } from '../../src/modules/search/search-scope';

// 1.24 Search: a task is found by its categories' and guests' words; "category:Electrical" and the page's
// Guest / Guest company / Category filters narrow to tasks (MySQL here; the SQL is plain EXISTS — MariaDB-safe).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const index = createTaskSearchIndex({ prisma });
const engine = createSearchEngine({ prisma, timeZone: 'Asia/Muscat' });
const everyone: SearchScopeAll = { projectIds: null, meetings: { full: null, invitee: [], editable: null } };
const L = Array.from({ length: 5 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
let owner = '';
let projectId = '';
const t: Record<string, string> = {};
let guestId = '';
let electrical = '';

const run = (q: string, extra: Partial<SearchAllInput> = {}) =>
  engine.search({ q, scope: everyone, viewerId: owner, limit: 50, ...extra }).then((r) => r.hits.filter((h) => h.kind === 'task').map((h) => h.id).sort());

beforeAll(async () => {
  await prisma.$connect();
  owner = (await prisma.user.create({ data: { email: `gcs.${L}@search.test`, username: `gcs_${L}`, passwordHash: 'x', firstName: 'Gcs', lastName: 'Owner' } })).id;
  projectId = (await prisma.project.create({ data: { code: `GCS${L.toUpperCase()}`, name: `Search ${L}`, createdById: owner, ownerId: owner, status: 'ACTIVE' } })).id;
  const todo = (await prisma.kanbanColumn.create({ data: { projectId, name: 'To do', category: 'TODO', position: 0 } })).id;
  let n = 0;
  for (const name of ['wired', 'plain', 'guested']) {
    n += 1;
    t[name] = (await prisma.task.create({ data: { key: `GCS${L.toUpperCase()}-${n}`, title: `Pump ${name} ${L}`, projectId, columnId: todo, createdById: owner } })).id;
  }
  electrical = (await prisma.projectCategory.create({ data: { projectId, name: `Electrical${L}`, nameKey: `electrical${L}`, color: 'gold' } })).id;
  await prisma.taskCategory.create({ data: { taskId: t.wired!, categoryId: electrical } });
  guestId = (await prisma.guestContact.create({ data: { companyId: 'company_prolens', name: `Ahmed ${L}`, nameKey: `ahmed${L}`, company: `Acme ${L}` } })).id;
  await prisma.taskExternalContact.create({ data: { taskId: t.guested!, guestId, name: `Ahmed ${L}`, company: `Acme ${L}` } });
  for (const id of Object.values(t)) await index.taskChanged(id);
});
afterAll(async () => {
  await prisma.task.deleteMany({ where: { projectId } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId } });
  await prisma.project.delete({ where: { id: projectId } });
  await prisma.guestContact.delete({ where: { id: guestId } });
  await prisma.user.delete({ where: { id: owner } });
  await prisma.$disconnect();
});

describe('search by guests and categories (1.24)', () => {
  it('a category’s or a guest’s words find the task', async () => {
    expect(await run(`electrical${L}`)).toEqual([t.wired]);
    expect(await run(`ahmed ${L}`)).toContain(t.guested);
  });

  it('"category:Electrical…" narrows to tasks of a category of that name (case and spaces aside)', async () => {
    const reading = { ctx: null as never, read: readQuery(`category:ELECTRICAL${L} pump`, { today: '2026-11-10', weekStart: 0, projects: [], people: [] }), understood: { chips: [], words: '', removed: [] } };
    const input = engineInput('Asia/Muscat', null, owner, { q: `category:ELECTRICAL${L} pump` }, reading);
    expect(input.categoryKeys).toEqual([`electrical${L}`]);
    expect(await run(input.q, input)).toEqual([t.wired]);
  });

  it('the page’s Guest, Guest company and Category filters: tasks only', async () => {
    expect(await run(`pump ${L}`, { guestIds: [guestId] })).toEqual([t.guested]);
    expect(await run(`pump ${L}`, { guestCompany: `acme${L}` })).toEqual([t.guested]);
    expect(await run(`pump ${L}`, { categoryIds: [electrical] })).toEqual([t.wired]);
    const all = await engine.search({ q: `pump ${L}`, scope: everyone, viewerId: owner, limit: 50, categoryIds: [electrical] });
    expect(all.hits.every((h) => h.kind === 'task')).toBe(true);
  });
});
