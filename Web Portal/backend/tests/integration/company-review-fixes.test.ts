import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { createCompanyAccess } from '../../src/modules/companies/company-access';
import { projectRunnerIds } from '../../src/modules/projects/prisma-member-repository';
import { createPrismaActionItemRepository } from '../../src/modules/meetings/prisma-action-item-repository';
import { createPrismaMeetingInvitees } from '../../src/modules/meetings/meeting-invitees';
import { createPrismaPersonOptions } from '../../src/modules/companies/person-options';
import { buildPeopleApp } from './company-people-app';

// The final review's findings (MC1 Task 17), each a failing test first: escalation recipients, My Action
// Items after a lost company, an organizer off the team inviting. Requires TEST_DATABASE_URL.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let w: CompanyWorld;
let catBetaItem: string;

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
  // cat runs PB (a MANAGER member) and was given an action item in MB (PB's meeting) she wasn't invited to.
  await prisma.projectMember.update({ where: { projectId_userId: { projectId: w.projects.PB, userId: w.people.cat } }, data: { role: 'MANAGER' } });
  catBetaItem = (
    await prisma.actionItem.create({ data: { meetingId: w.meetings.MB, projectId: w.projects.PB, description: 'ZZBETA follow-up for cat', assigneeId: w.people.cat, createdById: w.people.ben } })
  ).id;
  // Then an administrator takes cat out of Beta.
  await prisma.companyMember.delete({ where: { companyId_userId: { companyId: w.companies.B, userId: w.people.cat } } });
});
afterAll(async () => {
  if (w) {
    await prisma.actionItem.deleteMany({ where: { id: catBetaItem } });
    await dropCompanyWorld(prisma, w);
  }
  await prisma.$disconnect();
});

describe('MC1 review findings', () => {
  it('escalation notices: someone who still runs PB but lost Beta is not among its recipients', async () => {
    const access = createCompanyAccess(prisma);
    // She can no longer see PB …
    expect([...(await access.whoCanSeeProject(w.projects.PB, [w.people.cat]))]).toEqual([]);
    // … but the escalation sweep (server.ts runEscalationSweep → projectRunnerIds) still picks her,
    // so "Escalation: PB-… is Blocked" + the task title go to her phone (push) and open pages (notification:new).
    const runners = await projectRunnerIds(prisma, [w.projects.PB]);
    expect(runners.get(w.projects.PB) ?? []).not.toContain(w.people.cat);
  });

  it('My Action Items (no pick): an item of a Beta meeting she was not invited to drops out once cat loses Beta', async () => {
    const repo = createPrismaActionItemRepository(prisma);
    const mine = await repo.listForAssignee(w.people.cat, {});
    expect(mine.map((i) => i.description).join(' | ')).not.toContain('ZZBETA');
  });

  it('an organizer of a project meeting who is not on the project team can still invite a colleague (as in 1.20)', async () => {
    const access = createCompanyAccess(prisma);
    // amy (Alpha) organizes a PA meeting — handed over to her as an attendee, or she left the team since.
    const m = await prisma.meeting.create({
      data: { title: 'PA review', projectId: w.projects.PA, organizerId: w.people.amy, createdById: w.people.ana, startAt: new Date(Date.now() + 2 * 86_400_000), attendees: { create: [{ userId: w.people.amy }] } },
    });
    try {
      // She has the full view of it (same company as PA) …
      expect(await access.meetingView(w.as.amy, { projectId: w.projects.PA, organizerId: w.people.amy, createdById: w.people.ana, attendeeUserIds: [w.people.amy] })).toBe('full');
      // … yet POST /meetings/:id/attendees {userId: ana} now answers 404 "Project not found." (candidateIds → canSeeProject).
      const invitees = createPrismaMeetingInvitees(prisma, { companyAccess: access, personOptions: createPrismaPersonOptions(prisma) });
      await expect(invitees.assertInvitable(w.as.amy, { projectId: w.projects.PA }, [w.people.ana])).resolves.toBeUndefined();
    } finally {
      await prisma.meeting.delete({ where: { id: m.id } });
    }
  });

  it('My Action Items: an assignee off the team keeps their own item inside their company (as in 1.20); an admin sees all', async () => {
    const repo = createPrismaActionItemRepository(prisma);
    // amy (Alpha) was given an item in MA (PA's meeting); she is neither invited nor on PA's team.
    const item = await prisma.actionItem.create({ data: { meetingId: w.meetings.MA, projectId: w.projects.PA, description: 'ZZALPHA for amy', assigneeId: w.people.amy, createdById: w.people.ana } });
    try {
      expect((await repo.listForAssignee(w.people.amy, {})).map((i) => i.description)).toContain('ZZALPHA for amy');
      expect((await repo.listForAssignee(w.people.cat, { admin: true })).map((i) => i.description)).toContain('ZZBETA follow-up for cat');
    } finally {
      await prisma.actionItem.delete({ where: { id: item.id } });
    }
  });

  it('action items: after losing Beta, cat can no longer change or delete her MB item; amy can still change hers in Alpha', async () => {
    const h = await buildPeopleApp(prisma);
    const item = await prisma.actionItem.create({ data: { meetingId: w.meetings.MA, projectId: w.projects.PA, description: 'ZZALPHA for amy', assigneeId: w.people.amy, createdById: w.people.amy } });
    try {
      expect((await h.patch(w.as.cat, `/action-items/${catBetaItem}`, { status: 'IN_PROGRESS' })).status).toBe(403);
      expect((await h.del(w.as.cat, `/action-items/${catBetaItem}`)).status).toBe(403);
      expect((await h.patch(w.as.amy, `/action-items/${item.id}`, { status: 'IN_PROGRESS' })).status).toBe(200);
      expect((await h.del(w.as.amy, `/action-items/${item.id}`)).status).toBe(204);
    } finally {
      await prisma.actionItem.deleteMany({ where: { id: item.id } });
      await h.close();
    }
  });
});
