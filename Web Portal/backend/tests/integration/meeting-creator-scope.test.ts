import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createPrismaMeetingRepository } from '../../src/modules/meetings/prisma-meeting-repository';
import { createMeetingAccess } from '../../src/modules/meetings/meeting-access';
import { createMeetingService } from '../../src/modules/meetings/meeting-service';
import { meetingListScope } from '../../src/modules/meetings/meeting-repository';
import { createCompanyAccess } from '../../src/modules/companies/company-access';
import { createSearchScope } from '../../src/modules/search/search-scope';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// Review finding #21 (13 Nov 2026): a meeting's creator may open it (meeting-access.ts), so every list
// and search scope shows it to them too — after they hand it to another organizer, and for a meeting
// they copied with "Duplicate" (its organizer stays the original one: finding N4, not changed here).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const repo = createPrismaMeetingRepository(prisma);
const companies = createCompanyAccess(prisma);
const access = createMeetingAccess({ meetings: repo, meetingView: (v, m) => companies.meetingView(v, m) });
const tag = randomBytes(3).toString('hex');
const people: Record<'org' | 'creator' | 'attendee' | 'outsider' | 'archived', string> = { org: '', creator: '', attendee: '', outsider: '', archived: '' };
let company = '';
let oldCompany = '';
const made: string[] = [];

const listed = async (userId: string, scope: Partial<Parameters<typeof meetingListScope>[0]> = {}) =>
  (await repo.list({ scope: meetingListScope({ userId, projectIds: [], pick: null, admin: false, mineOnly: false, ...scope }) })).map((m) => m.id);
const meeting = async (title: string, organizerId: string, createdById: string, attendees: string[] = []) => {
  const m = await prisma.meeting.create({ data: { title: `${title} ${tag}`, organizerId, createdById, startAt: new Date(), companyId: company, status: 'SCHEDULED' } });
  for (const userId of attendees) await prisma.meetingAttendee.create({ data: { meetingId: m.id, userId } });
  made.push(m.id);
  return m.id;
};

beforeAll(async () => {
  await prisma.$connect();
  const co = await prisma.company.create({ data: { name: `Contoso Engineering ${tag}`, code: `C${tag}`.slice(0, 10) } });
  const old = await prisma.company.create({ data: { name: `Fabrikam Logistics ${tag}`, code: `F${tag}`.slice(0, 10), status: 'ARCHIVED', archivedAt: new Date() } });
  company = co.id;
  oldCompany = old.id;
  for (const key of Object.keys(people) as (keyof typeof people)[]) {
    const u = await prisma.user.create({ data: { email: `${key}-${tag}@sb3.test`, username: `${key}${tag}`, passwordHash: 'x', firstName: key, lastName: 'Test' } });
    people[key] = u.id;
    await prisma.companyMember.create({ data: { companyId: key === 'archived' ? oldCompany : company, userId: u.id } });
  }
});

afterAll(async () => {
  const ids = [...made, ...(await prisma.meeting.findMany({ where: { createdById: { in: Object.values(people) } }, select: { id: true } })).map((m) => m.id)];
  await prisma.meetingAttendee.deleteMany({ where: { meetingId: { in: ids } } });
  await prisma.agendaItem.deleteMany({ where: { meetingId: { in: ids } } });
  await prisma.meeting.deleteMany({ where: { id: { in: ids } } });
  await prisma.companyMember.deleteMany({ where: { userId: { in: Object.values(people) } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(people) } } });
  await prisma.company.deleteMany({ where: { id: { in: [company, oldCompany] } } });
  await prisma.$disconnect();
});

describe('a meeting’s creator sees it wherever they may open it (#21)', () => {
  it('the creator keeps a meeting they handed to another organizer in their meetings list', async () => {
    const id = await meeting('Site handover plan', people.creator, people.creator, [people.org]);
    await repo.update(id, { organizerId: people.org }); // PUT /meetings/:id {organizerId}
    expect(await access.viewOf(people.creator, [], id)).toBe('full');
    expect(await listed(people.creator)).toContain(id);
    // With their company picked, and as an administrator listing like a team member ("Show my projects only").
    expect(await listed(people.creator, { pick: company })).toContain(id);
    expect(await listed(people.creator, { admin: true, mineOnly: true })).toContain(id);
    expect(await listed(people.creator, { admin: true, mineOnly: true, pick: company })).toContain(id);
    // Search everything's scope (the very list scope): the creator sees it in full.
    const scope = createSearchScope({ prisma, accessibleProjectIds: async () => [], manageableProjectIds: async () => new Set() });
    expect((await scope.forViewer({ id: people.creator, roles: ['EMPLOYEE'] })).meetings.full).toContain(id);
  });

  it('a meeting copied with Duplicate shows in the list of whoever copied it (organizer unchanged: N4)', async () => {
    const src = await meeting('Supplier sync', people.org, people.org, [people.attendee]);
    const service = createMeetingService({ meetings: repo, access } as never);
    const copy = await service.duplicateMeeting(src, people.attendee);
    made.push(copy.id);
    expect(copy.organizerId).toBe(people.org);
    expect(copy.createdById).toBe(people.attendee);
    expect(await access.viewOf(people.attendee, [], copy.id)).toBe('full');
    expect(await listed(people.attendee)).toContain(copy.id);
    expect(await listed(people.org)).toContain(copy.id);
  });

  it('lists agree with meeting-access.ts for every person (organizer, creator, attendee, outsider, archived company)', async () => {
    const ids = [
      await meeting('Agreement one', people.org, people.creator, [people.attendee, people.archived]),
      await meeting('Agreement two', people.creator, people.org),
      await meeting('Agreement three', people.org, people.org, [people.attendee]),
      await meeting('Agreement four', people.archived, people.archived),
    ];
    for (const userId of Object.values(people)) {
      const list = new Set(await listed(userId));
      for (const id of ids) {
        const view = await access.viewOf(userId, [], id);
        expect({ userId, id, listed: list.has(id) }).toEqual({ userId, id, listed: view !== null });
      }
    }
  });
});
