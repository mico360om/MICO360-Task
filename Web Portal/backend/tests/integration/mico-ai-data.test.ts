import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaMicoAiData } from '../../src/modules/mico-ai/prisma-mico-ai-data';
import { createMicoAiTools } from '../../src/modules/mico-ai/mico-ai-tools';
import { createProjectAccess } from '../../src/modules/projects/project-access';
import { createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import { createPrismaProjectManagerLookup } from '../../src/modules/projects/prisma-member-repository';
import { createMeetingAccess } from '../../src/modules/meetings/meeting-access';
import { createPrismaMeetingRepository } from '../../src/modules/meetings/prisma-meeting-repository';
import { createPrismaFinalMinutesRepository } from '../../src/modules/meetings/final-minutes-repository';
import { createMessageService } from '../../src/modules/chat/message-service';
import {
  createPrismaChatMemberLookup,
  createPrismaConversationRepository,
  createPrismaMessageRepository,
  createPrismaParticipantRepository,
  createPrismaReactionRepository,
} from '../../src/modules/chat/prisma-chat-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. MICO AI's tools over the real
// queries and the app's own access rules: an employee never gets another project's tasks, meetings
// or chat, and chat search reads only the conversations they are part of.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const NOW = new Date('2026-10-24T08:00:00Z');
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const U = { admin: 'mai-admin', a: 'mai-amal', b: 'mai-badr', c: 'mai-chen' } as const;
const ids: Record<string, string> = {};

async function cleanup() {
  const users = await prisma.user.findMany({ where: { username: { in: Object.values(U) } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  const projects = await prisma.project.findMany({ where: { code: { in: ['MAIA', 'MAIB'] } }, select: { id: true } });
  const pids = projects.map((p) => p.id);
  await prisma.meeting.deleteMany({ where: { organizerId: { in: uids } } });
  await prisma.actionItem.deleteMany({ where: { createdById: { in: uids } } });
  const convs = await prisma.conversation.findMany({ where: { OR: [{ projectId: { in: pids } }, { participants: { some: { userId: { in: uids } } } }] }, select: { id: true } });
  await prisma.conversation.deleteMany({ where: { id: { in: convs.map((c) => c.id) } } });
  await prisma.activity.deleteMany({ where: { userId: { in: uids } } });
  await prisma.comment.deleteMany({ where: { userId: { in: uids } } });
  await prisma.task.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.project.deleteMany({ where: { id: { in: pids } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: uids } } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
}

function toolsFor() {
  const projectAccess = createProjectAccess({ projects: createPrismaProjectRepository(prisma), managers: createPrismaProjectManagerLookup(prisma) });
  const meetingAccess = createMeetingAccess({
    meetings: createPrismaMeetingRepository(prisma),
    projectAccess: { canViewProject: (u, r, p) => projectAccess.canViewProject(u, r, p), accessibleProjectIds: (u, r) => projectAccess.accessibleProjectIds(u, r) },
  });
  const chat = createMessageService({
    conversations: createPrismaConversationRepository(prisma),
    participants: createPrismaParticipantRepository(prisma),
    messages: createPrismaMessageRepository(prisma),
    reactions: createPrismaReactionRepository(prisma),
    members: createPrismaChatMemberLookup(prisma),
  });
  const data = createPrismaMicoAiData({
    prisma,
    projectAccess,
    meetingAccess,
    conversationIdsFor: (userId) => chat.accessibleConversationIds(userId),
    finalMinutes: createPrismaFinalMinutesRepository(prisma),
  });
  return createMicoAiTools({ data, timeZone: 'Asia/Muscat', now: () => NOW });
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanup();
  const user = (username: string, firstName: string) =>
    prisma.user.create({ data: { username, email: `${username}@mico360.test`, passwordHash: 'x', firstName, lastName: 'Test' } });
  const admin = await user(U.admin, 'Admin');
  const a = await user(U.a, 'Amal');
  const b = await user(U.b, 'Badr');
  const c = await user(U.c, 'Chen');
  const adminRole = await prisma.role.upsert({ where: { name: 'ADMIN' }, update: {}, create: { name: 'ADMIN' } });
  await prisma.userRole.create({ data: { userId: admin.id, roleId: adminRole.id } });
  Object.assign(ids, { admin: admin.id, a: a.id, b: b.id, c: c.id });

  const project = async (code: string, name: string, memberId: string) => {
    const p = await prisma.project.create({ data: { code, name, createdById: admin.id, targetDate: day('2026-11-30'), members: { create: { userId: memberId } } } });
    const todo = await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'To do', category: 'TODO', position: 0 } });
    const done = await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'Done', category: 'DONE', position: 1 } });
    return { p, todo, done };
  };
  const alpha = await project('MAIA', 'Alpha Rig', a.id);
  const beta = await project('MAIB', 'Beta Secret', b.id);
  ids.alpha = alpha.p.id;
  ids.beta = beta.p.id;

  const task = (key: string, title: string, pr: typeof alpha, extra: Record<string, unknown> = {}, assignees: string[] = []) =>
    prisma.task.create({
      data: { key, title, projectId: pr.p.id, columnId: pr.todo.id, createdById: admin.id, ...extra, assignees: { create: assignees.map((userId) => ({ userId })) } },
    });
  const a1 = await task('MAIA-1', 'Pressure test report', alpha, { dueDate: day('2026-10-19'), description: 'Run the test on rig 2.' }, [a.id]);
  await task('MAIA-2', 'Site survey', alpha, { columnId: alpha.done.id, dueDate: day('2026-10-10'), completedAt: new Date('2026-10-09T10:00:00Z') }, [a.id]);
  // Amal is assigned a Beta task but isn't on Beta: she must not see it.
  const b1 = await task('MAIB-1', 'Secret pricing sheet', beta, { dueDate: day('2026-10-15') }, [b.id, a.id]);
  ids.a1 = a1.id;
  ids.b1 = b1.id;
  await prisma.taskDependency.create({ data: { taskId: a1.id, dependsOnTaskId: b1.id } });
  await prisma.comment.create({ data: { taskId: a1.id, userId: b.id, body: 'Vendor certificate is missing.' } });
  await prisma.checklistItem.create({ data: { taskId: a1.id, text: 'Calibrate the gauge', done: true } });
  await prisma.activity.create({ data: { taskId: a1.id, projectId: alpha.p.id, userId: a.id, action: 'MOVED', meta: { from: 'To do', to: 'In progress' }, createdAt: new Date('2026-10-23T07:00:00Z') } });
  await prisma.activity.create({ data: { taskId: b1.id, projectId: beta.p.id, userId: b.id, action: 'COMMENTED', createdAt: new Date('2026-10-23T08:00:00Z') } });

  const meeting = (title: string, organizerId: string, projectId: string | null, startAt: string, attendees: string[] = []) =>
    prisma.meeting.create({
      data: { title, organizerId, createdById: organizerId, projectId, startAt: new Date(startAt), status: 'COMPLETED', attendees: { create: attendees.map((userId) => ({ userId })) } },
    });
  const m1 = await meeting('MAI weekly review', admin.id, alpha.p.id, '2026-10-21T06:00:00Z');
  const m2 = await meeting('MAI Beta pricing', b.id, beta.p.id, '2026-10-21T08:00:00Z');
  const m3 = await meeting('MAI Amal and Chen', c.id, null, '2026-10-22T09:00:00Z', [a.id]);
  await meeting('MAI Chen private', c.id, null, '2026-10-22T11:00:00Z');
  Object.assign(ids, { m1: m1.id, m2: m2.id, m3: m3.id });
  await prisma.meetingNote.create({ data: { meetingId: m1.id, authorId: b.id, type: 'DECISION', body: 'Finish the test once the gauge is calibrated.' } });
  await prisma.meetingNote.create({ data: { meetingId: m2.id, authorId: b.id, type: 'DISCUSSION', body: 'The secret price is 400 OMR.' } });
  await prisma.actionItem.create({ data: { meetingId: m1.id, description: 'MAI check the certificate', assigneeId: a.id, dueDate: day('2026-10-25'), createdById: admin.id } });
  await prisma.actionItem.create({ data: { meetingId: m2.id, description: 'MAI send the secret price list', assigneeId: b.id, createdById: b.id } });
  await createPrismaFinalMinutesRepository(prisma).save(m1.id, {
    content: { summary: 'The test moved to rig 3.', discussion: [], decisions: ['Finish after calibration'], risks: [], nextSteps: ['Amal: certificate by 25 Oct'] },
    status: 'APPROVED',
    approvedById: admin.id,
    approvedAt: new Date('2026-10-21T09:00:00Z'),
  });

  const conv = (kind: 'PROJECT' | 'DIRECT', projectId: string | null, people: string[]) =>
    prisma.conversation.create({ data: { kind, projectId, participants: { create: people.map((userId) => ({ userId })) } } });
  const ca = await conv('PROJECT', alpha.p.id, []);
  const cb = await conv('PROJECT', beta.p.id, []);
  const dac = await conv('DIRECT', null, [a.id, c.id]);
  const dbc = await conv('DIRECT', null, [b.id, c.id]);
  const msg = (conversationId: string, userId: string, body: string, at: string) => prisma.chatMessage.create({ data: { conversationId, userId, body, createdAt: new Date(at) } });
  await msg(ca.id, b.id, 'MAI the gauge is calibrated now', '2026-10-22T10:00:00Z');
  await msg(cb.id, b.id, 'MAI gauge price is secret', '2026-10-22T11:00:00Z');
  await msg(dac.id, c.id, 'MAI can you check the gauge order?', '2026-10-22T12:00:00Z');
  await msg(dbc.id, c.id, 'MAI private gauge supplier news', '2026-10-22T13:00:00Z');
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const viewer = (who: 'admin' | 'a' | 'b') => ({ userId: ids[who]!, roles: who === 'admin' ? ['ADMIN'] : ['EMPLOYEE'] });
const col = (rows: Array<{ values: Record<string, unknown> }>, key: string) => rows.map((r) => r.values[key]);
const mine = (xs: unknown[]) => xs.filter((x) => typeof x === 'string' && /^(MAI|Alpha|Beta)/.test(x));

describe('MICO AI over the database: what each person may see (integration)', () => {
  it('tasks: an employee gets only their projects’ tasks, never another project’s, even when assigned there', async () => {
    const t = toolsFor();
    expect(col((await t.run(viewer('a'), 'search_tasks', {})).rows, 'key')).toEqual(['MAIA-1', 'MAIA-2']);
    expect(col((await t.run(viewer('a'), 'search_tasks', { assignee: 'me', status: 'overdue' })).rows, 'key')).toEqual(['MAIA-1']);
    expect((await t.run(viewer('a'), 'search_tasks', { text: 'secret' })).rows).toEqual([]);
    expect((await t.run(viewer('a'), 'search_tasks', { project: 'Beta Secret' })).error).toMatch(/No project you can see/);
    expect(col((await t.run(viewer('b'), 'search_tasks', {})).rows, 'key')).toEqual(['MAIB-1']);
    expect(mine(col((await t.run(viewer('admin'), 'search_tasks', { text: 'MAI' })).rows, 'key'))).toEqual(expect.arrayContaining(['MAIA-1', 'MAIA-2', 'MAIB-1']));
  });

  it('task details: comments, checklist and history; a blocker in a hidden project isn’t named; another project’s task is not found', async () => {
    const t = toolsFor();
    const r = await t.run(viewer('a'), 'task_details', { task: 'maia-1' });
    const d = r.details as Record<string, unknown>;
    expect(d.description).toBe('Run the test on rig 2.');
    expect(d.checklist).toEqual([{ item: 'Calibrate the gauge', done: true }]);
    expect((d.comments as Array<{ text: string }>).map((c) => c.text)).toEqual(['Vendor certificate is missing.']);
    expect((d.history as Array<{ what: string }>)[0]!.what).toMatch(/moved this task/);
    expect(d).not.toHaveProperty('hiddenBlockers');
    expect(JSON.stringify(r)).not.toMatch(/MAIB|Secret pricing/);
    expect((await t.run(viewer('a'), 'task_details', { task: 'MAIB-1' })).error).toBe('No task you can see matches “MAIB-1”.');
    expect((await t.run(viewer('a'), 'task_details', { task: ids.b1! })).error).toMatch(/No task you can see/);
  });

  it('projects and what changed: only the person’s projects', async () => {
    const t = toolsFor();
    expect(col((await t.run(viewer('a'), 'list_projects', {})).rows, 'name')).toEqual(['Alpha Rig']);
    expect(col((await t.run(viewer('a'), 'project_activity', { from: '2026-10-23', to: '2026-10-23' })).rows, 'task')).toEqual(['MAIA-1']);
    expect(mine(col((await t.run(viewer('admin'), 'project_activity', { from: '2026-10-23', to: '2026-10-23' })).rows, 'task'))).toEqual(expect.arrayContaining(['MAIA-1', 'MAIB-1']));
  });

  it('meetings: their projects’ and the ones they attend; never another project’s or someone’s private one', async () => {
    const t = toolsFor();
    // Nearest to today first (both are past: the latest first).
    expect(mine(col((await t.run(viewer('a'), 'list_meetings', { from: '2026-10-20', to: '2026-10-23' })).rows, 'title'))).toEqual(['MAI Amal and Chen', 'MAI weekly review']);
    expect(mine(col((await t.run(viewer('b'), 'list_meetings', { from: '2026-10-20', to: '2026-10-23' })).rows, 'title'))).toEqual(['MAI Beta pricing']);
    const m1 = await t.run(viewer('a'), 'meeting_details', { meeting: `meeting:${ids.m1}` });
    const d = m1.details as Record<string, unknown>;
    expect((d.notes as Array<{ text: string }>).map((n) => n.text)).toEqual(['Finish the test once the gauge is calibrated.']);
    expect((d.actionItems as Array<{ item: string }>).map((i) => i.item)).toEqual(['MAI check the certificate']);
    expect((d.finalMinutes as { status: string; summary: string })).toMatchObject({ status: 'Final', summary: 'The test moved to rig 3.' });
    const denied = await t.run(viewer('a'), 'meeting_details', { meeting: ids.m2! });
    expect(denied.error).toMatch(/No meeting you can see/);
    expect(JSON.stringify(denied)).not.toContain('400 OMR');
    expect(mine(col((await t.run(viewer('a'), 'list_action_items', { from: '2026-10-20', to: '2026-10-23' })).rows, 'item'))).toEqual(['MAI check the certificate']);
  });

  it('chat: only the conversations the person is part of; an admin sees channels but not others’ direct messages', async () => {
    const t = toolsFor();
    expect(col((await t.run(viewer('a'), 'search_chat', { text: 'gauge', from: '2026-10-22', to: '2026-10-22' })).rows, 'message')).toEqual([
      'MAI can you check the gauge order?',
      'MAI the gauge is calibrated now',
    ]);
    const admin = mine(col((await t.run(viewer('admin'), 'search_chat', { text: 'MAI', from: '2026-10-22', to: '2026-10-22' })).rows, 'message'));
    expect(admin).toEqual(expect.arrayContaining(['MAI gauge price is secret', 'MAI the gauge is calibrated now']));
    expect(admin).not.toContain('MAI private gauge supplier news');
    expect(admin).not.toContain('MAI can you check the gauge order?');
  });

  it('report figures count only the tasks the person can see', async () => {
    const t = toolsFor();
    const w = await t.run(viewer('a'), 'report_figures', { report: 'workload' });
    const amal = w.rows.find((r) => r.values.person === 'Amal Test')!;
    expect(amal.values).toMatchObject({ assigned: 2, completed: 1, overdue: 1 });
    expect(col(w.rows, 'person')).not.toContain('Badr Test');
  });
});

describe('MICO AI over the database: long lists and drafts (integration)', () => {
  beforeAll(async () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms);
    // 250 meetings in Alpha (150 before NOW, 100 after), each with an action item; 250 channel messages; 250 activity rows.
    await prisma.meeting.createMany({
      data: Array.from({ length: 250 }, (_, i) => ({ title: `MAI bulk ${i}`, organizerId: ids.admin!, createdById: ids.admin!, projectId: ids.alpha!, startAt: at((i - 150) * 86_400_000 + 3_600_000), status: 'SCHEDULED' as const })),
    });
    const bulk = await prisma.meeting.findMany({ where: { title: { startsWith: 'MAI bulk ' } }, select: { id: true, title: true } });
    await prisma.actionItem.createMany({ data: bulk.map((m) => ({ meetingId: m.id, description: `MAI bulk item ${m.title.slice(9)}`, createdById: ids.admin!, assigneeId: ids.a! })) });
    const channel = await prisma.conversation.findFirst({ where: { projectId: ids.alpha } });
    await prisma.chatMessage.createMany({ data: Array.from({ length: 250 }, (_, i) => ({ conversationId: channel!.id, userId: ids.b!, body: `MAI bulk gauge ${i}`, createdAt: at(-(i + 1) * 60_000) })) });
    await prisma.activity.createMany({ data: Array.from({ length: 250 }, (_, i) => ({ taskId: ids.a1!, projectId: ids.alpha!, userId: ids.a!, action: 'COMMENTED', createdAt: at(-(i + 1) * 60_000) })) });
  });

  it('meetings: the true total, the nearest kept (upcoming soonest first), a title search finds the best match', async () => {
    const t = toolsFor();
    const r = await t.run(viewer('a'), 'list_meetings', { from: '2025-12-01', to: '2027-06-30', text: 'MAI bulk' });
    expect([r.rows.length, r.total, r.truncated]).toEqual([200, 250, true]);
    expect(r.rows[0]!.values.title).toBe('MAI bulk 150');
    expect(col(r.rows, 'title')).not.toContain('MAI bulk 0');
    const one = await t.run(viewer('a'), 'meeting_details', { meeting: 'MAI bulk 7' });
    expect(one.error).toBeUndefined();
    expect(one.rows[0]!.values.title).toBe('MAI bulk 7');
  });

  it('action items, chat and activity: the true total, the latest kept', async () => {
    const t = toolsFor();
    const items = await t.run(viewer('a'), 'list_action_items', { from: '2025-12-01', to: '2026-10-24' });
    expect(items.total).toBe(152); // 151 bulk meetings on or before 24 Oct + the weekly review's item
    expect(items.rows).toHaveLength(152);
    const chat = await t.run(viewer('a'), 'search_chat', { text: 'MAI bulk gauge', from: '2026-10-01', to: '2026-10-24' });
    expect([chat.rows.length, chat.total, chat.truncated]).toEqual([200, 250, true]);
    expect(chat.rows[0]!.values.message).toBe('MAI bulk gauge 0');
    const act = await t.run(viewer('a'), 'project_activity', { from: '2026-10-20', to: '2026-10-24' });
    expect([act.rows.length, act.total, act.truncated]).toEqual([200, 251, true]);
  });

  it('a draft Final MOM only for someone who can change the meeting', async () => {
    const minutes = createPrismaFinalMinutesRepository(prisma);
    await minutes.save(ids.m1!, { content: { summary: 'MAI draft: not agreed.', discussion: [], decisions: [], risks: [], nextSteps: [] }, status: 'DRAFT', approvedById: null, approvedAt: null });
    const t = toolsFor();
    const amal = await t.run(viewer('a'), 'meeting_details', { meeting: `meeting:${ids.m1}` });
    expect((amal.details as { finalMinutes: unknown }).finalMinutes).toBeNull();
    expect(JSON.stringify(amal)).not.toContain('not agreed');
    const admin = await t.run(viewer('admin'), 'meeting_details', { meeting: `meeting:${ids.m1}` });
    expect((admin.details as { finalMinutes: { status: string } }).finalMinutes.status).toBe('Draft');
  });

  it('results kept from earlier questions are checked again against today’s access', async () => {
    const t = toolsFor();
    const tasks = await t.run(viewer('a'), 'search_tasks', {});
    await prisma.projectMember.deleteMany({ where: { projectId: ids.alpha!, userId: ids.a! } });
    try {
      const kept = await t.recheck(viewer('a'), [{ ...tasks, id: 'r1' }]);
      expect(kept[0]!.rows).toEqual([]);
    } finally {
      await prisma.projectMember.create({ data: { projectId: ids.alpha!, userId: ids.a! } });
    }
  });
});
