import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Viewer } from '../../src/modules/companies/company-access';

/**
 * The Client portal's DB test world (1.23), shared by the client-portal tests:
 *   Company   A "Alpha <tag>".
 *   Staff     admin (ADMIN), omar (A; owner of P1 and P2, team of P3), zara (A; team of P1).
 *   Clients   c1 "Cliff One": P1 — both modules, every action; P2 — Progress only, no action.
 *             c2 "Cleo Two":  P1 — Progress + Comment only; P2 — Meetings + Reply + Download.
 *             (Neither has P3.)
 *   Projects  P1, P2, P3 (all A), each with To Do / Doing (IN_PROGRESS) / Done columns.
 *   Tasks     P1: S1 shown (Doing), D1 shown (Done), H1 hidden; P2: S2 shown, H2 hidden; P3: S3 shown.
 *             Every hidden task's words hold ZZHIDDEN; S1's description ZZDESC (not ticked).
 *   Comments  on S1: omar's own (ZZSTAFF); c1's question, omar's reply to it marked visible ("Visible
 *             reply"), zara's reply to it not marked (ZZSTAFF); c2's question (ZZOTHER).
 *   Meetings  P1: M1 (c1 invited; place ZZPLACE), M1S (c1 not invited; minutes approved and shown),
 *             M1N (c1 not invited; minutes approved, not shown — ZZHIDDEN); P2: M2 (c2 invited),
 *             M2S (minutes shown); P3: M3 (c1 invited, but c1 has no P3).
 *   Actions   M1: one for c1, one for omar (ZZSTAFF); M2: one for c2.
 */
export interface ClientWorld {
  tag: string;
  company: string;
  people: { admin: string; omar: string; zara: string; c1: string; c2: string };
  as: { admin: Viewer; omar: Viewer; zara: Viewer; c1: Viewer; c2: Viewer };
  projects: { P1: string; P2: string; P3: string };
  columns: Record<string, { todo: string; doing: string; done: string }>;
  tasks: { S1: string; D1: string; H1: string; S2: string; H2: string; S3: string };
  comments: { staff: string; c1: string; shownReply: string; internalReply: string; c2: string };
  meetings: { M1: string; M1S: string; M1N: string; M2: string; M2S: string; M3: string };
  attendees: { M1_c1: string; M2_c2: string };
  actionItems: { M1_c1: string; M1_omar: string; M2_c2: string };
}

const FINAL = (marker: string) => JSON.stringify({ summary: `Agreed ${marker}`, discussion: [], decisions: ['Go ahead'], risks: ['Budget ZZRISK'], nextSteps: ['Order pumps — Omar, by 5 Nov'] });

export async function buildClientWorld(prisma: PrismaClient, tag: string = randomBytes(3).toString('hex')): Promise<ClientWorld> {
  const T = tag.toUpperCase();
  const company = (await prisma.company.create({ data: { name: `Alpha ${tag}`, code: `C${T}` } })).id;
  const role = async (name: string) => (await prisma.role.upsert({ where: { name }, update: {}, create: { name } })).id;
  const roles = { ADMIN: await role('ADMIN'), EMPLOYEE: await role('EMPLOYEE'), CLIENT: await role('CLIENT') };
  const person = async (name: string, first: string, last: string, kind: 'ADMIN' | 'EMPLOYEE' | 'CLIENT') =>
    (
      await prisma.user.create({
        data: {
          email: `${name}.${tag}@cw.test`,
          username: `${name}_${tag}`,
          passwordHash: 'x',
          firstName: first,
          lastName: last,
          roles: { create: { roleId: roles[kind] } },
          ...(kind === 'EMPLOYEE' ? { primaryCompanyId: company, companies: { create: { companyId: company } } } : {}),
          ...(kind === 'CLIENT' ? { organisation: `Acme ${tag}` } : {}),
        },
      })
    ).id;
  const people = {
    admin: await person('admin', 'Admin', `World ${tag}`, 'ADMIN'),
    omar: await person('omar', 'Omar', `Staff ${tag}`, 'EMPLOYEE'),
    zara: await person('zara', 'Zara', `Staff ${tag}`, 'EMPLOYEE'),
    c1: await person('c1', 'Cliff', `One ${tag}`, 'CLIENT'),
    c2: await person('c2', 'Cleo', `Two ${tag}`, 'CLIENT'),
  };
  const as = {
    admin: { id: people.admin, roles: ['ADMIN'] },
    omar: { id: people.omar, roles: ['EMPLOYEE'] },
    zara: { id: people.zara, roles: ['EMPLOYEE'] },
    c1: { id: people.c1, roles: ['CLIENT'] },
    c2: { id: people.c2, roles: ['CLIENT'] },
  };

  const columns: ClientWorld['columns'] = {};
  const project = async (code: string, members: string[]) => {
    const p = await prisma.project.create({
      data: {
        code: `${code}${T}`,
        name: `Project ${code} ${tag}`,
        status: 'ACTIVE',
        createdById: people.admin,
        ownerId: people.omar,
        mainCompanyId: company,
        companies: { create: { companyId: company } },
        members: { create: members.map((userId) => ({ userId, role: 'MEMBER' as const })) },
      },
    });
    const col = async (name: string, category: 'TODO' | 'IN_PROGRESS' | 'DONE', position: number) =>
      (await prisma.kanbanColumn.create({ data: { projectId: p.id, name, category, position } })).id;
    columns[p.id] = { todo: await col('To Do', 'TODO', 0), doing: await col('Doing', 'IN_PROGRESS', 1), done: await col('Done', 'DONE', 2) };
    return p.id;
  };
  const projects = { P1: await project('P1', [people.zara]), P2: await project('P2', []), P3: await project('P3', [people.zara]) };

  let n = 0;
  const task = async (projectId: string, title: string, opts: { shown: boolean; done?: boolean; description?: string }) =>
    (
      await prisma.task.create({
        data: {
          key: `T${T}-${++n}`,
          title,
          description: opts.description ?? null,
          projectId,
          columnId: opts.done ? columns[projectId]!.done : columns[projectId]!.doing,
          completedAt: opts.done ? new Date(Date.now() - 3_600_000) : null,
          progress: opts.done ? 100 : 0,
          clientVisible: opts.shown,
          createdById: people.omar,
          assignees: { create: { userId: people.omar } },
        },
      })
    ).id;
  const tasks = {
    S1: await task(projects.P1, 'Install pump', { shown: true, description: 'ZZDESC pump spec' }),
    D1: await task(projects.P1, 'Survey site', { shown: true, done: true }),
    H1: await task(projects.P1, 'ZZHIDDEN budget review', { shown: false, description: 'ZZHIDDEN' }),
    S2: await task(projects.P2, 'Order parts', { shown: true }),
    H2: await task(projects.P2, 'ZZHIDDEN supplier dispute', { shown: false }),
    S3: await task(projects.P3, 'Paint tanks P3only', { shown: true }),
  };

  const comment = async (userId: string, body: string, extra: { parentId?: string; fromClient?: boolean; clientVisible?: boolean } = {}) =>
    (await prisma.comment.create({ data: { taskId: tasks.S1, userId, body, ...extra } })).id;
  const staffComment = await comment(people.omar, 'ZZSTAFF internal note on S1');
  const c1Comment = await comment(people.c1, 'When will the pump arrive?', { fromClient: true });
  const comments = {
    staff: staffComment,
    c1: c1Comment,
    shownReply: await comment(people.omar, 'Visible reply: Monday', { parentId: c1Comment, clientVisible: true }),
    internalReply: await comment(people.zara, 'ZZSTAFF check stock first', { parentId: c1Comment }),
    c2: await comment(people.c2, 'ZZOTHER question from Cleo', { fromClient: true }),
  };

  const startAt = new Date(Date.now() + 86_400_000);
  const meeting = async (projectId: string, title: string, invite: string[], minutes?: { shown: boolean }) =>
    (
      await prisma.meeting.create({
        data: {
          title,
          projectId,
          organizerId: people.omar,
          createdById: people.omar,
          startAt,
          status: 'SCHEDULED',
          location: 'ZZPLACE site office',
          attendees: { create: [people.omar, ...invite].map((userId) => ({ userId, invitedAt: new Date() })) },
          ...(minutes
            ? { minutes: { create: { content: FINAL(minutes.shown ? 'ZZSHOWN' : 'ZZHIDDEN'), status: 'APPROVED', approvedAt: new Date(), approvedById: people.omar, clientVisible: minutes.shown, clientVisibleProjectId: minutes.shown ? projectId : null } } }
            : {}),
        },
      })
    ).id;
  const meetings = {
    M1: await meeting(projects.P1, 'M1 weekly', [people.c1]),
    M1S: await meeting(projects.P1, 'M1S review', [], { shown: true }),
    M1N: await meeting(projects.P1, 'ZZHIDDEN M1N internal', [], { shown: false }),
    M2: await meeting(projects.P2, 'M2 planning', [people.c2]),
    M2S: await meeting(projects.P2, 'M2S review', [], { shown: true }),
    M3: await meeting(projects.P3, 'M3 P3only meeting', [people.c1]),
  };
  await prisma.agendaItem.create({ data: { meetingId: meetings.M1, title: 'Pump status', ownerId: people.omar, position: 0 } });
  await prisma.meetingNote.create({ data: { meetingId: meetings.M1, authorId: people.omar, body: 'ZZSTAFF live note' } });
  const attendeeOf = async (meetingId: string, userId: string) => (await prisma.meetingAttendee.findFirstOrThrow({ where: { meetingId, userId } })).id;
  const attendees = { M1_c1: await attendeeOf(meetings.M1, people.c1), M2_c2: await attendeeOf(meetings.M2, people.c2) };
  const item = async (meetingId: string, projectId: string, assigneeId: string, description: string) =>
    (await prisma.actionItem.create({ data: { meetingId, projectId, description, assigneeId, createdById: people.omar } })).id;
  const actionItems = {
    M1_c1: await item(meetings.M1, projects.P1, people.c1, 'Send the drawings'),
    M1_omar: await item(meetings.M1, projects.P1, people.omar, 'ZZSTAFF order the crane'),
    M2_c2: await item(meetings.M2, projects.P2, people.c2, 'Sign the change order'),
  };

  const grant = (userId: string, projectId: string, g: Partial<Record<'progress' | 'meetings' | 'canComment' | 'canSignOff' | 'canRespond' | 'canDownload', boolean>>) =>
    prisma.clientProjectGrant.create({ data: { userId, projectId, createdById: people.admin, ...g } });
  await grant(people.c1, projects.P1, { progress: true, meetings: true, canComment: true, canSignOff: true, canRespond: true, canDownload: true });
  await grant(people.c1, projects.P2, { progress: true });
  await grant(people.c2, projects.P1, { progress: true, canComment: true });
  await grant(people.c2, projects.P2, { meetings: true, canRespond: true, canDownload: true });

  return { tag, company, people, as, projects, columns, tasks, comments, meetings, attendees, actionItems };
}

export async function dropClientWorld(prisma: PrismaClient, world: ClientWorld): Promise<void> {
  const userIds = Object.values(world.people);
  const projectIds = Object.values(world.projects);
  await prisma.actionItem.deleteMany({ where: { OR: [{ projectId: { in: projectIds } }, { assigneeId: { in: userIds } }] } });
  await prisma.meeting.deleteMany({ where: { OR: [{ projectId: { in: projectIds } }, { organizerId: { in: userIds } }] } });
  await prisma.activity.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { projectId: { in: projectIds } }] } });
  await prisma.comment.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { task: { projectId: { in: projectIds } } }] } });
  await prisma.task.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { OR: [{ id: { in: userIds } }, { email: { endsWith: `.${world.tag}@cw.test` } }] } });
  await prisma.projectCompany.deleteMany({ where: { companyId: world.company } });
  await prisma.company.deleteMany({ where: { id: world.company } });
}
