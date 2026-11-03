import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { buildPeopleApp } from './company-people-app';
import { createPrismaMinutesSendRepository } from '../../src/modules/meetings/minutes-send-repository';
import { createMeetingNotifyService } from '../../src/modules/meetings/meeting-notify-service';
import { createPrismaMeetingRepository } from '../../src/modules/meetings/prisma-meeting-repository';
import { createPrismaAttendeeRepository } from '../../src/modules/meetings/prisma-attendee-repository';
import { createAuditService } from '../../src/modules/audit/audit-service';
import { createPrismaAuditRepository } from '../../src/modules/audit/prisma-audit-repository';
import { inspectPdf } from '../../src/lib/pdf-inspect';
import type { MailLines } from '../../src/modules/email/email-service';

// The minutes email's To, Cc and sent log (1.22) in MySQL, over HTTP in the companies world.
// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let w: CompanyWorld;

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
});
afterAll(async () => {
  if (w) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: Object.values(w.meetings) } } });
    await dropCompanyWorld(prisma, w);
  }
  await prisma.$disconnect();
});

const emailOf = (who: keyof CompanyWorld['people']) => `${who}.${w.tag}@world.test`;
const pdfText = (b: Buffer) => inspectPdf(b).pages.flat().join('\n');
const FINAL = { summary: 'Agreed ZZFINAL', discussion: [], decisions: ['Go ahead'], risks: [], nextSteps: [] };

/** The people app with the real minutes email (its mailer only notes each email's lines and PDF). */
async function mailingApp() {
  const outbox: Array<{ to: string[]; cc: string[]; pdf: Buffer }> = [];
  const attendeeRepository = createPrismaAttendeeRepository(prisma);
  const person = (u: { id: string; email: string; firstName: string; lastName: string; username: string }) => ({ id: u.id, email: u.email, name: `${u.firstName} ${u.lastName}`.trim() || u.username });
  const notify = createMeetingNotifyService({
    meetings: createPrismaMeetingRepository(prisma),
    attendees: { listByMeeting: (id) => attendeeRepository.listByMeeting(id) },
    email: {
      sendMeetingInvite: async () => {},
      sendMeetingCancelled: async () => {},
      sendMeetingMinutes: async (lines: MailLines, _params, pdf) => {
        outbox.push({ to: lines.to.map((a) => a.email.toLowerCase()), cc: lines.cc.map((a) => a.email.toLowerCase()), pdf: pdf.content });
        return { suppressed: [] };
      },
    },
    resolveUser: async (id) => {
      const u = await prisma.user.findUnique({ where: { id } });
      return u ? { name: person(u).name, email: u.email } : null;
    },
    findUserByEmail: async (email) => {
      const u = await prisma.user.findFirst({ where: { email, deletedAt: null, status: 'ACTIVE' } });
      return u ? person(u) : null;
    },
    appUrl: 'https://app.test',
  });
  const h = await buildPeopleApp(prisma, {
    meetingNotifyService: notify,
    minutesSendRepository: createPrismaMinutesSendRepository(prisma),
    auditService: createAuditService({ audit: createPrismaAuditRepository(prisma) }),
  });
  return { h, outbox };
}

describe('the minutes email in the companies world: one email, real To and Cc; another company’s invitee apart', () => {
  it('not final: bob (invited from Beta) gets nothing; the team, an added colleague and typed addresses get ONE email', async () => {
    const { h, outbox } = await mailingApp();
    try {
      const res = await h.post(w.as.ana, `/meetings/${w.meetings.MA}/minutes/send`, {
        to: [{ email: emailOf('ana') }, { email: emailOf('bob') }, { userId: w.people.cat }, { email: 'client@outside.co' }],
        cc: [{ email: 'boss@outside.co' }, { email: emailOf('amy').toUpperCase() }],
      });
      expect(res.status).toBe(200);
      expect(outbox).toEqual([{ to: [emailOf('ana'), emailOf('cat'), 'client@outside.co'], cc: ['boss@outside.co', emailOf('amy')], pdf: expect.any(Buffer) }]);
      expect(res.data.skipped).toEqual([{ name: 'Bob Betaonly', reason: 'can’t get these minutes yet' }]);
      // Typed addresses are recipients only: nobody was added to the meeting.
      expect(await prisma.meetingAttendee.count({ where: { meetingId: w.meetings.MA } })).toBe(2);
    } finally {
      await h.close();
    }
  });

  it('final: bob, and ben typed in Cc (Beta, not on it), each get their own email with their own copy — the shared email never lists them', async () => {
    const { h, outbox } = await mailingApp();
    try {
      expect((await h.post(w.as.ana, `/meetings/${w.meetings.MA}/final-minutes/approve`, { content: FINAL })).status).toBe(200);
      const res = await h.post(w.as.ana, `/meetings/${w.meetings.MA}/minutes/send`, {
        to: [{ email: emailOf('ana') }, { email: emailOf('bob') }],
        cc: [{ email: 'client@outside.co' }, { email: emailOf('ben') }],
      });
      expect(res.status).toBe(200);
      expect(outbox.map((m) => ({ to: m.to, cc: m.cc }))).toEqual([
        { to: [emailOf('ana')], cc: ['client@outside.co'] },
        { to: [emailOf('bob')], cc: [] },
        { to: [emailOf('ben')], cc: [] },
      ]);
      const shared = pdfText(outbox[0]!.pdf);
      expect(shared).toContain('ZZALPHA note');
      const bobs = pdfText(outbox[1]!.pdf);
      expect(bobs).toContain('Agreed ZZFINAL');
      expect(bobs).toContain(`ZZALPHA action for ${w.people.bob}`);
      expect(bobs).not.toContain('ZZALPHA note');
      expect(pdfText(outbox[2]!.pdf)).not.toContain('ZZALPHA note');
      expect(res.data.recipients.map((r: { email: string; line: string; copy: string }) => [r.email.toLowerCase(), r.line, r.copy])).toEqual([
        [emailOf('ana'), 'to', 'shared'],
        [emailOf('bob'), 'to', 'own'],
        ['client@outside.co', 'cc', 'shared'],
        [emailOf('ben'), 'cc', 'own'],
      ]);
    } finally {
      await h.post(w.as.ana, `/meetings/${w.meetings.MA}/final-minutes/reopen`);
      await h.close();
    }
  });

  it('a colleague picked by name must be one the invite picker offers: gus (Gamma) is refused, bob (on the meeting) is fine', async () => {
    const { h, outbox } = await mailingApp();
    try {
      const refused = await h.post(w.as.ana, `/meetings/${w.meetings.MA}/minutes/send`, { to: [{ email: emailOf('ana') }], cc: [{ userId: w.people.gus }] });
      expect(refused.status).toBe(400);
      expect(outbox).toEqual([]);
      expect((await h.post(w.as.ana, `/meetings/${w.meetings.MA}/minutes/send`, { to: [{ email: emailOf('ana') }], cc: [{ userId: w.people.bob }] })).status).toBe(200);
    } finally {
      await h.close();
    }
  });

  it('the "Sent" log lists the sends newest first; it, and the Cc suggestions, are for those who may send; each send is audited', async () => {
    const { h } = await mailingApp();
    try {
      const log = await h.get(w.as.ana, `/meetings/${w.meetings.MA}/minutes/sends`);
      expect(log.status).toBe(200);
      const sends = log.data as Array<{ sentAt: string; final: boolean; sentBy: { name: string }; to: Array<{ email: string; copy: string; ok: boolean }>; cc: Array<{ email: string }> }>;
      expect(sends.length).toBeGreaterThanOrEqual(3);
      expect(sends.map((s) => s.sentAt)).toEqual([...sends.map((s) => s.sentAt)].sort().reverse());
      const finalSend = sends.find((s) => s.final)!;
      expect(finalSend.sentBy.name).toBe(`Ana Alpha ${w.tag}`);
      expect(finalSend.to.map((a) => [a.email.toLowerCase(), a.copy, a.ok])).toEqual([[emailOf('ana'), 'shared', true], [emailOf('bob'), 'own', true]]);
      // bob is on the meeting, not one who may send.
      expect((await h.get(w.as.bob, `/meetings/${w.meetings.MA}/minutes/sends`)).status).toBe(403);
      expect((await h.get(w.as.cat, `/meetings/${w.meetings.MA}/minutes/sends`)).status).toBe(403);
      const audited = await prisma.auditLog.count({ where: { entityId: w.meetings.MA, action: 'meeting.minutes.send', module: 'meetings', userId: w.people.ana } });
      expect(audited).toBe(sends.length);
      // Another PA meeting is offered the addresses used before — never another company's own-copy people.
      const other = await prisma.meeting.create({ data: { title: 'Next PA meeting', projectId: w.projects.PA, organizerId: w.people.ana, createdById: w.people.ana, startAt: new Date() } });
      try {
        const suggested = ((await h.get(w.as.ana, `/meetings/${other.id}/minutes/suggestions`)).data as Array<{ email: string }>).map((a) => a.email);
        expect(suggested).toEqual(expect.arrayContaining([emailOf('ana'), 'client@outside.co', 'boss@outside.co', emailOf('amy'), emailOf('cat')]));
        expect(suggested).not.toContain(emailOf('bob'));
        expect(suggested).not.toContain(emailOf('ben'));
      } finally {
        await prisma.meeting.delete({ where: { id: other.id } });
      }
    } finally {
      await h.close();
    }
  });
});

describe('meeting_minutes_sends', () => {
  it('keeps each send — To, Cc and each address’s result — and lists a meeting’s sends newest first', async () => {
    const repo = createPrismaMinutesSendRepository(prisma);
    const first = await repo.create({
      meetingId: w.meetings.MB,
      sentById: w.people.ana,
      final: false,
      to: [{ email: 'ana@world.test', name: 'Ana Alpha', userId: w.people.ana, copy: 'shared' }],
      cc: [],
      results: [{ email: 'ana@world.test', ok: true }],
      sentAt: new Date('2026-11-03T08:00:00Z'),
    });
    const second = await repo.create({
      meetingId: w.meetings.MB,
      sentById: w.people.ana,
      final: true,
      to: [
        { email: 'ana@world.test', name: 'Ana Alpha', userId: w.people.ana, copy: 'shared' },
        { email: 'bob@world.test', name: 'Bob Betaonly', userId: w.people.bob, copy: 'own' },
      ],
      cc: [{ email: 'client@outside.co', name: null, copy: 'shared' }],
      results: [
        { email: 'ana@world.test', ok: true },
        { email: 'bob@world.test', ok: true },
        { email: 'client@outside.co', ok: false, error: 'The mail server didn’t accept it.' },
      ],
      sentAt: new Date('2026-11-03T09:00:00Z'),
    });
    const listed = await repo.listByMeeting(w.meetings.MB);
    expect(listed.map((s) => s.id)).toEqual([second.id, first.id]);
    expect(listed[0]).toEqual(second);
    expect(listed[0]).toMatchObject({ final: true, sentById: w.people.ana, cc: [{ email: 'client@outside.co', name: null, copy: 'shared' }] });
    expect(await repo.listByMeeting(w.meetings.MN_B)).toEqual([]);
  });

  it('suggests addresses from earlier sends of the same project’s meetings, never another company’s own-copy people', async () => {
    const repo = createPrismaMinutesSendRepository(prisma);
    const other = await prisma.meeting.create({ data: { title: 'Another PB meeting', projectId: w.projects.PB, organizerId: w.people.ana, createdById: w.people.ana, startAt: new Date() } });
    try {
      const emails = (await repo.recentAddresses(other.id)).map((a) => a.email);
      expect(emails).toEqual(['ana@world.test', 'client@outside.co']);
      // MN_B (no project) has no sends of its own.
      expect(await repo.recentAddresses(w.meetings.MN_B)).toEqual([]);
    } finally {
      await prisma.meeting.delete({ where: { id: other.id } });
    }
  });

  it('goes with its meeting', async () => {
    const repo = createPrismaMinutesSendRepository(prisma);
    const gone = await prisma.meeting.create({ data: { title: 'Short-lived', organizerId: w.people.ana, createdById: w.people.ana, startAt: new Date() } });
    await repo.create({ meetingId: gone.id, sentById: w.people.ana, final: false, to: [{ email: 'a@x.co', name: null, copy: 'shared' }], cc: [], results: [{ email: 'a@x.co', ok: true }] });
    await prisma.meeting.delete({ where: { id: gone.id } });
    expect(await prisma.meetingMinutesSend.count({ where: { meetingId: gone.id } })).toBe(0);
  });
});
