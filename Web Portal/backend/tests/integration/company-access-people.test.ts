import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyWorld, dropCompanyWorld, sorted, type CompanyWorld } from './company-world';
import { buildPeopleApp } from './company-people-app';
import { keepKnownPeople } from '../../src/modules/companies/person-options';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// People see colleagues who share a company with them; inside a shared project its whole team works
// together; a direct chat with someone you no longer share a company with stays readable but read-only.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let w: CompanyWorld;
let h: Awaited<ReturnType<typeof buildPeopleApp>>;

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
  h = await buildPeopleApp(prisma);
});
afterAll(async () => {
  await h?.close();
  if (w) await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

const worldIds = () => Object.values(w.people);
/** The world's people in a list of `{ id }` rows. */
const ids = (rows: { id: string }[]) => sorted(rows.map((r) => r.id).filter((id) => worldIds().includes(id)));
/** The directory as { id → colleague } for the world's people. */
const byId = (rows: { id: string; colleague: boolean }[]) => Object.fromEntries(rows.filter((r) => worldIds().includes(r.id)).map((r) => [r.id, r.colleague]));
const directory = async (who: keyof CompanyWorld['as']) => {
  const r = await h.get(w.as[who], '/users/directory');
  expect(r.status).toBe(200);
  return r.data as { id: string; colleague: boolean }[];
};
async function withoutCatInBeta(run: () => Promise<void>) {
  await prisma.companyMember.delete({ where: { companyId_userId: { companyId: w.companies.B, userId: w.people.cat } } });
  try {
    await run();
  } finally {
    await prisma.companyMember.create({ data: { companyId: w.companies.B, userId: w.people.cat } });
  }
}

describe('People visibility follows companies (integration)', () => {
  it('directory: known people, colleagues marked; administrators are everyone’s colleagues', async () => {
    const { ana, amy, cat, ben, gus, admin } = w.people;
    expect(byId(await directory('ana'))).toEqual({ [amy]: true, [cat]: true, [ben]: false, [ana]: true, [admin]: true });
    expect(sorted(Object.keys(byId(await directory('gus'))))).toEqual(sorted([gus, admin]));
    expect(JSON.stringify(await directory('ana'))).not.toMatch(/Betaonly|Gammaonly/);
    const all = byId(await directory('admin'));
    expect(sorted(Object.keys(all))).toEqual(sorted(worldIds()));
    expect(Object.values(all).every(Boolean)).toBe(true);
  });

  it('ben on PAB’s team sees ana inside PAB only: PA, ana’s colleagues and her other projects stay hidden', async () => {
    const { ana, ben, admin } = w.people;
    const mention = await h.get(w.as.ben, `/tasks/${w.tasks.TAB1}/mentionable`);
    expect(ids(mention.data)).toEqual(sorted([ana, ben, admin])); // admins may be mentioned anywhere, as before
    const members = await h.get(w.as.ben, `/projects/${w.projects.PAB}/members`);
    expect(ids(members.data)).toEqual(sorted([ana, ben]));
    expect(members.data.every((m: { hasAccess: boolean }) => m.hasAccess)).toBe(true);
    expect(await h.companyAccess.canSeeProject(w.as.ben, w.projects.PA)).toBe(false);
    expect(JSON.stringify(await directory('ben'))).not.toMatch(/Alphaonly/);
    expect((await h.get(w.as.ben, `/tasks/${w.tasks.TA1}`)).status).toBe(404);
    expect((await h.get(w.as.ben, `/tasks/${w.tasks.TA1}/mentionable`)).status).toBe(403);
  });

  it('the Team tab says who has lost access: still listed, hasAccess false', async () => {
    await withoutCatInBeta(async () => {
      const members = (await h.get(w.as.ben, `/projects/${w.projects.PB}/members`)).data as { id: string; hasAccess: boolean }[];
      expect(members.find((m) => m.id === w.people.cat)).toMatchObject({ hasAccess: false });
      expect(ids((await h.get(w.as.ben, `/tasks/${w.tasks.TB1}/mentionable`)).data)).not.toContain(w.people.cat);
    });
  });

  it('team candidates come from the project’s companies', async () => {
    const { ana, amy, cat, ben, bob } = w.people;
    const csv = (...c: string[]) => `/people/candidates?companyIds=${c.join(',')}`;
    const r = await h.get(w.as.admin, csv(w.companies.A, w.companies.B));
    expect(r.status).toBe(200);
    expect(ids(r.data)).toEqual(sorted([ana, amy, cat, ben, bob]));
    expect(Object.keys(r.data[0]).sort()).toEqual(['avatarUrl', 'firstName', 'id', 'lastName', 'username']);
    expect(ids((await h.get(w.as.ana, csv(w.companies.A))).data)).toEqual(sorted([ana, amy, cat]));
    expect(await h.get(w.as.ana, csv(w.companies.B))).toMatchObject({ status: 403, error: { code: 'COMPANY_NOT_AVAILABLE' } });
    expect((await h.get(w.as.gus, csv(w.companies.C))).status).toBe(403); // archived: no access
    expect((await h.get(w.as.ana, '/people/candidates')).status).toBe(400);
  });

  it('new DMs only with colleagues; an old one stays readable and read-only', async () => {
    const { ana, ben, amy } = w.people;
    await expect(h.chat.getOrCreateDirectConversation(ben, amy)).rejects.toMatchObject({ status: 403, code: 'NOT_A_COLLEAGUE', message: 'You can only message people who share a company with you.' });
    expect(await h.post(w.as.ben, '/conversations/direct', { userId: amy })).toMatchObject({ status: 403, error: { code: 'NOT_A_COLLEAGUE' } });
    const again = await h.chat.getOrCreateDirectConversation(ben, ana); // the existing one comes back
    expect(again.id).toBe(w.chats.anaBen);
    expect(again.readOnly).toEqual({ message: 'You no longer share a company with Ana.' });
    const listed = await h.chat.listConversations(ana);
    expect(listed.find((c) => c.conversation.id === w.chats.anaBen)!.readOnly).toEqual({ message: 'You no longer share a company with Ben.' });
    expect(listed.find((c) => c.conversation.id === w.chats.anaAmy)!.readOnly).toBeNull();
    expect(listed.find((c) => c.conversation.id === w.chats.PAB)!.readOnly).toBeNull();
    await expect(h.chat.sendMessage(w.chats.anaBen, ana, 'hi')).rejects.toMatchObject({ status: 403, code: 'DM_READ_ONLY', message: 'You no longer share a company with Ben.' });
    expect(await h.post(w.as.ana, `/conversations/${w.chats.anaBen}/messages`, { body: 'hi' })).toMatchObject({ status: 403, error: { code: 'DM_READ_ONLY' } });
    const page = await h.chat.listMessages(w.chats.anaBen, ana);
    expect(page.messages.length).toBeGreaterThan(0);
    const first = page.messages[0]!;
    await expect(h.chat.addReaction(first.id, ana, '👍')).rejects.toMatchObject({ code: 'DM_READ_ONLY' });
    await expect(h.chat.editMessage(first.id, ana, 'changed')).rejects.toMatchObject({ code: 'DM_READ_ONLY' });
    await expect(h.chat.assertCanPost(w.chats.anaBen, ana)).rejects.toMatchObject({ code: 'DM_READ_ONLY' });
    expect(await h.chat.canWriteDirect(w.chats.anaBen, ben)).toEqual({ ok: false, message: 'You no longer share a company with Ana.' });
    expect(await h.chat.canWriteDirect(w.chats.anaAmy, ana)).toEqual({ ok: true });
    // Still allowed: read marks, settings.
    await h.chat.markRead(w.chats.anaBen, ana);
    expect((await h.chat.setPreferences(w.chats.anaBen, ana, { favorite: true })).favorite).toBe(true);
    // A DM with an administrator never goes read-only.
    const withAdmin = await h.chat.getOrCreateDirectConversation(ben, w.people.admin);
    expect(withAdmin.readOnly).toBeNull();
    await h.chat.sendMessage(withAdmin.id, ben, 'ZZBETA to the admin');
  });

  it('a page of messages names every author', async () => {
    await h.chat.sendMessage(w.chats.PAB, w.people.ben, 'ZZSHARED from ben');
    const page = await h.chat.listMessages(w.chats.PAB, w.people.ana);
    expect(page.authors.map((a) => a.id).sort()).toEqual(sorted([w.people.ana, w.people.ben]));
    expect(page.authors.find((a) => a.id === w.people.ben)).toEqual({ id: w.people.ben, name: `Ben Beta ${w.tag}`, avatarUrl: null });
    const r = await h.get(w.as.ana, `/conversations/${w.chats.PAB}/messages`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data)).toBe(true);
    expect(JSON.parse(r.body).authors.map((a: { id: string }) => a.id).sort()).toEqual(sorted([w.people.ana, w.people.ben]));
  });

  it('moving a task: assignees outside the target’s companies can’t join its team', async () => {
    const preview = await h.move.preview(w.as.admin, [w.tasks.TA1], w.projects.PB);
    expect(preview.outsiders).toEqual([expect.objectContaining({ id: w.people.ana, canJoin: false })]);
    expect(preview.tasks[0]!.outsiders).toEqual([expect.objectContaining({ id: w.people.ana, canJoin: false })]);
    expect((await h.move.preview(w.as.admin, [w.tasks.TB2], w.projects.PAB)).outsiders).toEqual([expect.objectContaining({ id: w.people.cat, canJoin: true })]);
    await expect(h.move.moveTask(w.as.admin, w.tasks.TA1, { projectId: w.projects.PB, assignees: 'ADD_TO_TEAM' })).rejects.toMatchObject({ status: 409, code: 'CANT_JOIN_TEAM' });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: w.tasks.TA1 } })).projectId).toBe(w.projects.PA); // nothing moved
  });

  it('describing a meeting offers only known people', async () => {
    const people = await prisma.user.findMany({ where: { id: { in: worldIds() } }, select: { id: true } });
    expect(ids(await keepKnownPeople(h.companyAccess, w.as.ana, people))).toEqual(sorted([w.people.ana, w.people.amy, w.people.cat, w.people.ben]));
    expect(ids(await keepKnownPeople(h.companyAccess, w.as.admin, people))).toEqual(sorted(worldIds()));
  });
});
