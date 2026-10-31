import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Viewer } from '../../src/modules/companies/company-access';

/**
 * The companies test world (MC1 Task 2), shared by every company-access DB test:
 *   Companies  A "Alpha <tag>", B "Beta <tag>", C "Gamma <tag>" (archived).
 *   People     admin (ADMIN, no company), ana (A), amy (A, "Amy Alphaonly"), ben (B), bob (B, "Bob Betaonly"),
 *              cat (A+B, primary B), gus (C only, "Gus Gammaonly").
 *   Projects   PA (A; team ana, cat), PB (B; owner ben, cat), PAB (A+B, main A; team ana, ben), PC (C; team gus).
 *   Tasks      TA1 (PA, ana), TA2 (PA, cat), TB1 (PB, ben), TB2 (PB, cat), TAB1 (PAB, ben), TC1 (PC, gus);
 *              each with one comment by its assignee.
 *   Meetings   MA (PA; organizer ana; attendees ana, bob; one note; action items for ana and bob), MB (PB; ben),
 *              MN_A (no project, company A, organizer amy, invitee ana), MN_B (no project, company B, organizer ben).
 *   Chats      direct ana–amy, ana–ben (they share no company), cat–ana; channels for PA, PB and PAB.
 * Markers: every PA, A-only and MA text holds ZZALPHA; PB ZZBETA; PC ZZGAMMA; PAB ZZSHARED (the ana–ben
 * chat ZZDIRECT). Project names hold no marker.
 * Each test file builds its own world with a fresh tag; a test that changes memberships or project
 * companies builds a second world, or puts things back in afterEach.
 */
export interface CompanyWorld {
  tag: string;
  companies: { A: string; B: string; C: string };
  people: { admin: string; ana: string; amy: string; ben: string; bob: string; cat: string; gus: string };
  /** The people as the access service sees a signed-in request (id + roles). */
  as: { admin: Viewer; ana: Viewer; amy: Viewer; ben: Viewer; bob: Viewer; cat: Viewer; gus: Viewer };
  projects: { PA: string; PB: string; PAB: string; PC: string };
  tasks: { TA1: string; TA2: string; TB1: string; TB2: string; TAB1: string; TC1: string };
  meetings: { MA: string; MB: string; MN_A: string; MN_B: string };
  notes: { MA: string };
  actionItems: { MA_ana: string; MA_bob: string };
  chats: { anaAmy: string; anaBen: string; catAna: string; PA: string; PB: string; PAB: string };
}

type Person = keyof CompanyWorld['people'];

export async function buildCompanyWorld(prisma: PrismaClient, tag: string = randomBytes(3).toString('hex')): Promise<CompanyWorld> {
  const T = tag.toUpperCase();
  const company = async (name: string, letter: string, archived = false) =>
    (await prisma.company.create({ data: { name: `${name} ${tag}`, code: `${letter}${T}`, ...(archived ? { status: 'ARCHIVED' as const, archivedAt: new Date() } : {}) } })).id;
  const companies = { A: await company('Alpha', 'A'), B: await company('Beta', 'B'), C: await company('Gamma', 'C', true) };

  const roles = {
    ADMIN: (await prisma.role.upsert({ where: { name: 'ADMIN' }, update: {}, create: { name: 'ADMIN' } })).id,
    EMPLOYEE: (await prisma.role.upsert({ where: { name: 'EMPLOYEE' }, update: {}, create: { name: 'EMPLOYEE' } })).id,
  };
  const person = async (name: Person, last: string, companyIds: string[], primary: string | null, role: 'ADMIN' | 'EMPLOYEE' = 'EMPLOYEE') =>
    (
      await prisma.user.create({
        data: {
          email: `${name}.${tag}@world.test`,
          username: `${name}_${tag}`,
          passwordHash: 'x',
          firstName: name.charAt(0).toUpperCase() + name.slice(1),
          lastName: last,
          roles: { create: { roleId: roles[role] } },
          primaryCompanyId: primary,
          companies: { create: companyIds.map((companyId) => ({ companyId })) },
        },
      })
    ).id;
  const people = {
    admin: await person('admin', `World ${tag}`, [], null, 'ADMIN'),
    ana: await person('ana', `Alpha ${tag}`, [companies.A], companies.A),
    amy: await person('amy', 'Alphaonly', [companies.A], companies.A),
    ben: await person('ben', `Beta ${tag}`, [companies.B], companies.B),
    bob: await person('bob', 'Betaonly', [companies.B], companies.B),
    cat: await person('cat', `Both ${tag}`, [companies.A, companies.B], companies.B),
    gus: await person('gus', 'Gammaonly', [companies.C], companies.C),
  };
  const as = Object.fromEntries(
    Object.entries(people).map(([name, id]) => [name, { id, roles: [name === 'admin' ? 'ADMIN' : 'EMPLOYEE'] }]),
  ) as CompanyWorld['as'];

  const columns: Record<string, string> = {};
  const project = async (code: string, companyIds: string[], team: { owner?: string; members: string[] }) => {
    const p = await prisma.project.create({
      data: {
        code: `${code}${T}`,
        name: `Project ${code} ${tag}`,
        status: 'ACTIVE',
        createdById: people.admin,
        ownerId: team.owner ?? null,
        mainCompanyId: companyIds[0]!,
        companies: { create: companyIds.map((companyId) => ({ companyId })) },
        members: { create: team.members.map((userId) => ({ userId, role: 'MEMBER' as const })) },
      },
    });
    columns[p.id] = (await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'To Do', category: 'TODO', position: 0 } })).id;
    return p.id;
  };
  const projects = {
    PA: await project('PA', [companies.A], { members: [people.ana, people.cat] }),
    PB: await project('PB', [companies.B], { owner: people.ben, members: [people.cat] }),
    PAB: await project('PAB', [companies.A, companies.B], { members: [people.ana, people.ben] }),
    PC: await project('PC', [companies.C], { members: [people.gus] }),
  };

  const task = async (name: string, projectId: string, assignee: string, marker: string) => {
    const t = await prisma.task.create({
      data: {
        key: `${name}${T}-1`,
        title: `${name} ${marker} task`,
        description: `${marker} description`,
        projectId,
        columnId: columns[projectId]!,
        createdById: assignee,
        assignees: { create: { userId: assignee } },
      },
    });
    await prisma.comment.create({ data: { taskId: t.id, userId: assignee, body: `${marker} comment on ${name}` } });
    return t.id;
  };
  const tasks = {
    TA1: await task('TA1', projects.PA, people.ana, 'ZZALPHA'),
    TA2: await task('TA2', projects.PA, people.cat, 'ZZALPHA'),
    TB1: await task('TB1', projects.PB, people.ben, 'ZZBETA'),
    TB2: await task('TB2', projects.PB, people.cat, 'ZZBETA'),
    TAB1: await task('TAB1', projects.PAB, people.ben, 'ZZSHARED'),
    TC1: await task('TC1', projects.PC, people.gus, 'ZZGAMMA'),
  };

  const startAt = new Date(Date.now() + 86_400_000);
  const meeting = async (title: string, data: { projectId?: string; companyId?: string; organizer: string; attendees: string[] }) =>
    (
      await prisma.meeting.create({
        data: {
          title,
          projectId: data.projectId ?? null,
          companyId: data.companyId ?? null,
          organizerId: data.organizer,
          createdById: data.organizer,
          startAt,
          status: 'SCHEDULED',
          attendees: { create: data.attendees.map((userId) => ({ userId, invitedAt: new Date() })) },
        },
      })
    ).id;
  const meetings = {
    MA: await meeting('MA ZZALPHA meeting', { projectId: projects.PA, organizer: people.ana, attendees: [people.ana, people.bob] }),
    MB: await meeting('MB ZZBETA meeting', { projectId: projects.PB, organizer: people.ben, attendees: [people.ben] }),
    MN_A: await meeting('MN_A ZZALPHA meeting', { companyId: companies.A, organizer: people.amy, attendees: [people.amy, people.ana] }),
    MN_B: await meeting('MN_B ZZBETA meeting', { companyId: companies.B, organizer: people.ben, attendees: [people.ben] }),
  };
  const notes = { MA: (await prisma.meetingNote.create({ data: { meetingId: meetings.MA, authorId: people.ana, body: 'ZZALPHA note' } })).id };
  const actionItem = async (assigneeId: string) =>
    (await prisma.actionItem.create({ data: { meetingId: meetings.MA, projectId: projects.PA, description: `ZZALPHA action for ${assigneeId}`, assigneeId, createdById: people.ana } })).id;
  const actionItems = { MA_ana: await actionItem(people.ana), MA_bob: await actionItem(people.bob) };

  const chat = async (kind: 'DIRECT' | 'PROJECT', members: string[], body: string, projectId?: string) => {
    const c = await prisma.conversation.create({
      data: { kind, projectId: projectId ?? null, participants: { create: members.map((userId) => ({ userId })) } },
    });
    await prisma.chatMessage.create({ data: { conversationId: c.id, userId: members[0]!, body } });
    return c.id;
  };
  const chats = {
    anaAmy: await chat('DIRECT', [people.ana, people.amy], 'ZZALPHA direct'),
    anaBen: await chat('DIRECT', [people.ana, people.ben], 'ZZDIRECT hello from before'),
    catAna: await chat('DIRECT', [people.cat, people.ana], 'ZZALPHA direct'),
    PA: await chat('PROJECT', [people.ana, people.cat], 'ZZALPHA channel', projects.PA),
    PB: await chat('PROJECT', [people.ben, people.cat], 'ZZBETA channel', projects.PB),
    PAB: await chat('PROJECT', [people.ana, people.ben], 'ZZSHARED channel', projects.PAB),
  };

  return { tag, companies, people, as, projects, tasks, meetings, notes, actionItems, chats };
}

/** Removes everything the world made (and what tests added for its people and projects). */
export async function dropCompanyWorld(prisma: PrismaClient, world: CompanyWorld): Promise<void> {
  const userIds = Object.values(world.people);
  const projectIds = Object.values(world.projects);
  const meetingIds = Object.values(world.meetings);
  const companyIds = Object.values(world.companies);
  await prisma.conversation.deleteMany({ where: { OR: [{ id: { in: Object.values(world.chats) } }, { projectId: { in: projectIds } }, { participants: { some: { userId: { in: userIds } } } }] } });
  await prisma.actionItem.deleteMany({ where: { OR: [{ meetingId: { in: meetingIds } }, { projectId: { in: projectIds } }] } });
  await prisma.meeting.deleteMany({ where: { OR: [{ id: { in: meetingIds } }, { projectId: { in: projectIds } }, { organizerId: { in: userIds } }] } });
  await prisma.activity.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { projectId: { in: projectIds } }] } });
  await prisma.comment.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { task: { projectId: { in: projectIds } } }] } });
  await prisma.task.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.projectCompany.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
}

export const sorted = (ids: readonly string[]): string[] => [...ids].sort();
