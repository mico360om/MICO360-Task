import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { buildClientWorld, dropClientWorld, type ClientWorld } from './client-world';
import { buildClientPortalApp } from './client-portal-app';
import { createPrismaTaskRepository } from '../../src/modules/tasks/prisma-task-repository';
import { createPrismaMemberRepository } from '../../src/modules/projects/prisma-member-repository';
import { createPrismaActivityRepository } from '../../src/modules/activity/prisma-activity-repository';
import { createPrismaMeetingListCounts, createPrismaProjectMeetingsSource } from '../../src/modules/meetings/prisma-project-meetings';
import { buildProjectMeetingsOverview } from '../../src/modules/meetings/project-meetings';
import { createPrismaInspectionScheduleSource } from '../../src/modules/inspections/prisma-inspection-schedule-source';
import { createClientAccounts } from '../../src/modules/clients/client-accounts';
import { createPrismaTimelineSource } from '../../src/modules/planning/prisma-timeline-source';
import { prismaIsAvatar } from '../../src/modules/users/avatar-faces';

// Avatar hotfix (owner, 10 Nov: "Icon was not showing, fix it."): the payloads behind the website's
// faces carry each person's photo (avatarUrl, null without one), read in the query each already makes —
// never one more query per row. The Client portal is untouched: no route a client may call answers with
// anybody's photo. Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const url = process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });
// The same database, counting the statements each read sends (the no-N+1 checks).
const counted = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
let statements = 0;
counted.$on('query', () => { statements += 1; });
const countOf = async (read: () => Promise<unknown>) => {
  await read(); // warm: the first call may connect
  statements = 0;
  await read();
  return statements;
};

const PHOTO = { omar: '/uploads/avatars/zzphoto-omar.png', zara: '/uploads/avatars/zzphoto-zara.png', c1: '/uploads/avatars/zzphoto-c1.png' };
let w: ClientWorld;
let plain = ''; // a team member without a photo
let formId = '';
let checkId = '';
let portal: Awaited<ReturnType<typeof buildClientPortalApp>>;

beforeAll(async () => {
  await prisma.$connect();
  await counted.$connect();
  w = await buildClientWorld(prisma);
  for (const who of ['omar', 'zara', 'c1'] as const) await prisma.user.update({ where: { id: w.people[who] }, data: { avatarUrl: PHOTO[who] } });
  plain = (await prisma.user.create({ data: { email: `plain.${w.tag}@cw.test`, username: `plain_${w.tag}`, passwordHash: 'x', firstName: 'Plain', lastName: `Face ${w.tag}` } })).id;
  const { P1 } = w.projects;
  await prisma.projectMember.create({ data: { projectId: P1, userId: plain } });
  await prisma.taskAssignee.create({ data: { taskId: w.tasks.S1, userId: plain } });
  await prisma.task.update({ where: { id: w.tasks.S1 }, data: { dueDate: new Date(Date.now() + 3 * 86_400_000) } });
  await prisma.meetingAttendee.create({ data: { meetingId: w.meetings.M1, userId: plain } });
  await prisma.activity.createMany({ data: [
    { userId: w.people.omar, projectId: P1, taskId: w.tasks.S1, action: 'UPDATED' },
    { userId: plain, projectId: P1, taskId: w.tasks.S1, action: 'UPDATED' },
  ] });
  const sections = [{ id: 's1', title: 'Deck', items: [{ id: 'i1', kind: 'CHECK', label: 'Guard rails fitted', help: null }] }] as unknown as Prisma.InputJsonValue;
  formId = (await prisma.inspectionForm.create({ data: { title: `Rig check ${w.tag}`, sections, createdById: w.people.omar } })).id;
  checkId = (await prisma.task.create({
    data: {
      key: `T${w.tag.toUpperCase()}-CHK`, title: 'Daily rig check', projectId: P1, columnId: w.columns[P1]!.todo, createdById: w.people.omar,
      inspectionFormId: formId, dueDate: new Date(Date.now() + 86_400_000), recurrenceRule: { freq: 'DAILY', interval: 1 } as unknown as Prisma.InputJsonValue,
      assignees: { create: [{ userId: w.people.zara }, { userId: plain }] },
    },
  })).id;
  portal = await buildClientPortalApp(prisma);
});

afterAll(async () => {
  await portal?.close();
  if (w) {
    await prisma.task.deleteMany({ where: { id: checkId } });
    await prisma.inspectionForm.deleteMany({ where: { id: formId } });
    await dropClientWorld(prisma, w);
  }
  await counted.$disconnect();
  await prisma.$disconnect();
});

const faceOf = (list: Array<{ id: string; avatarUrl?: string | null }> | undefined, id: string) => list?.find((p) => p.id === id)?.avatarUrl;

describe('the team’s faces carry their photos (avatar hotfix)', () => {
  it('task rows (board cards, My Tasks, project tasks, the Table view): each assignee’s photo, null without one', async () => {
    const rows = await createPrismaTaskRepository(prisma).list({ projectIds: [w.projects.P1] });
    const s1 = rows.find((t) => t.id === w.tasks.S1)!;
    expect(s1.assignees).toEqual(expect.arrayContaining([
      { id: w.people.omar, name: `Omar Staff ${w.tag}`, avatarUrl: PHOTO.omar },
      { id: plain, name: `Plain Face ${w.tag}`, avatarUrl: null },
    ]));
  });

  it('a project’s team: each member’s photo', async () => {
    const team = await createPrismaMemberRepository(prisma).list(w.projects.P1);
    expect(faceOf(team, w.people.zara)).toBe(PHOTO.zara);
    expect(faceOf(team, plain)).toBeNull();
  });

  it('activity lines (Activity, Dashboard, project health): who did it, with their photo', async () => {
    const feed = await createPrismaActivityRepository(prisma).listRecent(20, [w.projects.P1]);
    const actors = feed.map((a) => a.actor);
    expect(actors).toEqual(expect.arrayContaining([
      { id: w.people.omar, name: `Omar Staff ${w.tag}`, avatarUrl: PHOTO.omar },
      { id: plain, name: `Plain Face ${w.tag}`, avatarUrl: null },
    ]));
  });

  it('meeting cards: the first attendees’ names as before, and their faces (a client invitee’s too)', async () => {
    const counts = await createPrismaMeetingListCounts(prisma)([w.meetings.M1], w.people.omar);
    const m1 = counts[w.meetings.M1]!;
    expect(m1.attendees).toEqual([`Omar Staff ${w.tag}`, `Cliff One ${w.tag}`, `Plain Face ${w.tag}`]);
    expect(m1.attendeeFaces).toEqual([
      { name: `Omar Staff ${w.tag}`, avatarUrl: PHOTO.omar },
      { name: `Cliff One ${w.tag}`, avatarUrl: PHOTO.c1 },
      { name: `Plain Face ${w.tag}`, avatarUrl: null },
    ]);
  });

  it('the project dashboard’s meetings: the same faces', async () => {
    const data = await createPrismaProjectMeetingsSource(prisma).load(w.projects.P1, new Date(Date.now() - 30 * 86_400_000), new Date(Date.now() + 30 * 86_400_000));
    const m1 = buildProjectMeetingsOverview(data, new Date(), 'Asia/Muscat').meetings.find((m) => m.id === w.meetings.M1)!;
    expect(m1.attendees).toEqual([`Omar Staff ${w.tag}`, `Cliff One ${w.tag}`, `Plain Face ${w.tag}`]);
    expect(m1.attendeeFaces.map((f) => f.avatarUrl)).toEqual([PHOTO.omar, PHOTO.c1, null]);
  });

  it('scheduled inspections: the inspectors’ photos', async () => {
    const source = createPrismaInspectionScheduleSource(prisma, { workingDays: async () => [0, 1, 2, 3, 4] });
    const check = (await source.schedules(w.projects.P1)).find((c) => c.id === checkId)!;
    expect(faceOf(check.assignees, w.people.zara)).toBe(PHOTO.zara);
    expect(faceOf(check.assignees, plain)).toBeNull();
  });

  it('“Clients with access” on a project page (staff only): each client’s own photo', async () => {
    const clients = await createClientAccounts({ prisma, userService: {} as never }).forProject(w.projects.P1);
    expect(faceOf(clients, w.people.c1)).toBe(PHOTO.c1);
  });

  it('the timeline’s task lane: each assignee’s photo', async () => {
    const day = 86_400_000;
    const today = new Date(new Date().toISOString().slice(0, 10));
    const rows = await createPrismaTimelineSource(prisma).projectTasks(w.projects.P1, { from: new Date(today.getTime() - 7 * day), to: new Date(today.getTime() + 30 * day), overdueBefore: today, upcomingFrom: today });
    const s1 = [...rows.openInRange, ...rows.overdue].find((t) => t.id === w.tasks.S1)!;
    expect(faceOf(s1.assignees, w.people.omar)).toBe(PHOTO.omar);
    expect(faceOf(s1.assignees, plain)).toBeNull();
  });
});

describe('a face copy is made only for someone’s current photo (avatar thumbnails)', () => {
  it('a current photo is one; an old one, another upload or a made-up address is not', async () => {
    const isAvatar = prismaIsAvatar(prisma);
    expect(await isAvatar(PHOTO.omar)).toBe(true);
    expect(await isAvatar(PHOTO.c1)).toBe(true);
    expect(await isAvatar('/uploads/avatars/zzphoto-nobody.png')).toBe(false);
    expect(await isAvatar('/uploads/avatars/zzphoto-%')).toBe(false); // no pattern matching: the exact address only
  });
});

describe('no extra query per row (the photos come with the rows)', () => {
  it('task rows: as many statements for a busy project as for a quiet one', async () => {
    const repo = createPrismaTaskRepository(counted);
    const before = await countOf(() => repo.list({ projectIds: [w.projects.P1] }));
    for (let i = 0; i < 8; i++) {
      await prisma.task.create({ data: { key: `T${w.tag.toUpperCase()}-X${i}`, title: `Extra ${i}`, projectId: w.projects.P1, columnId: w.columns[w.projects.P1]!.doing, createdById: w.people.omar, assignees: { create: [{ userId: w.people.zara }, { userId: plain }] } } });
    }
    expect(await countOf(() => repo.list({ projectIds: [w.projects.P1] }))).toBe(before);
  });

  it('meeting cards and activity: a fixed number of statements, however many rows', async () => {
    const counts = createPrismaMeetingListCounts(counted);
    const one = await countOf(() => counts([w.meetings.M1], w.people.omar));
    const all = await countOf(() => counts(Object.values(w.meetings), w.people.omar));
    expect(all).toBe(one);
    const feed = createPrismaActivityRepository(counted);
    // The newest two (a task and a project each) against the whole feed: Prisma skips a relation no row has.
    expect(await countOf(() => feed.listRecent(50, [w.projects.P1]))).toBe(await countOf(() => feed.listRecent(2, [w.projects.P1])));
  });
});

describe('the Client portal sends nobody’s photo (clients see only what they saw before)', () => {
  it('no route a client may call answers with a photo', async () => {
    const { P1 } = w.projects;
    const paths = [
      '/portal/me',
      `/portal/projects/${P1}`,
      `/portal/projects/${P1}/tasks/${w.tasks.S1}`,
      `/portal/projects/${P1}/meetings`,
      `/portal/projects/${P1}/meetings/${w.meetings.M1}`,
      `/portal/meetings/${w.meetings.M1}`,
      '/portal/notifications',
    ];
    for (const path of paths) {
      const r = await portal.get(w.as.c1, path);
      expect(r.status, path).toBe(200);
      expect(r.body, path).not.toMatch(/zzphoto|avatarUrl/);
    }
  });
});
