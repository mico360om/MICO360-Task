import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyWorld, dropCompanyWorld, sorted, type CompanyWorld } from './company-world';
import { buildPeopleApp } from './company-people-app';
import { inspectPdf } from '../../src/lib/pdf-inspect';
import { createPrismaMeetingReminderSource } from '../../src/modules/meetings/prisma-meeting-reminders';
import { reminderRecipients } from '../../src/modules/meetings/meeting-reminders';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// Meetings and companies: a meeting without a project belongs to a company; an invitation lets
// someone from outside the project's companies see that one meeting — its people, agenda, approved
// minutes and their own action items — and nothing else of the project (spec §8.8, §9).
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
const ids = (rows: { id: string }[]) => sorted(rows.map((r) => r.id).filter((id) => worldIds().includes(id)));
const tomorrow = () => new Date(Date.now() + 2 * 86_400_000).toISOString();
const standalone = () => ({ title: 'Standalone sync', startAt: tomorrow() });
const pdfText = (body: string | Buffer) => inspectPdf(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1')).pages.flat().join('\n');
const FINAL = { summary: 'Agreed ZZFINAL', discussion: [], decisions: ['Go ahead'], risks: [], nextSteps: [] };

async function pdfOf(viewer: CompanyWorld['as'][keyof CompanyWorld['as']], url: string) {
  const authorization = `Bearer ${h.tokenFor(viewer)}`;
  const res = await h.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { authorization } });
  return { status: res.statusCode, body: res.rawPayload };
}

describe('Meetings follow companies (integration)', () => {
  it('bob, invited to MA, sees MA, its approved minutes and his own action items — nothing else of PA', async () => {
    const { MA } = w.meetings;
    const meeting = await h.get(w.as.bob, `/meetings/${MA}`);
    expect(meeting).toMatchObject({ status: 200, data: { id: MA, view: 'invitee', canEdit: false, transcript: null } });
    expect(await h.get(w.as.bob, `/meetings/${MA}/notes`)).toMatchObject({ status: 403, error: { code: 'INVITEE_ONLY', message: 'You can see this meeting because you were invited; its notes stay with the project’s team.' } });
    expect((await h.get(w.as.bob, `/meetings/${MA}/attendees`)).status).toBe(200);
    expect((await h.get(w.as.bob, `/meetings/${MA}/agenda`)).status).toBe(200);
    expect((await h.get(w.as.bob, `/meetings/${MA}/final-minutes`)).status).toBe(404);
    expect((await pdfOf(w.as.bob, `/meetings/${MA}/minutes.pdf`)).status).toBe(404);

    // The organizer marks the minutes final.
    expect((await h.post(w.as.ana, `/meetings/${MA}/final-minutes/approve`, { content: FINAL })).status).toBe(200);
    try {
      const minutes = await h.get(w.as.bob, `/meetings/${MA}/final-minutes`);
      expect(minutes).toMatchObject({ status: 200, data: { status: 'FINAL', content: { summary: 'Agreed ZZFINAL' }, canEdit: false } });
      const pdf = await pdfOf(w.as.bob, `/meetings/${MA}/minutes.pdf`);
      expect(pdf.status).toBe(200);
      const text = pdfText(pdf.body);
      expect(text).toContain('Agreed ZZFINAL');
      expect(text).not.toContain('ZZALPHA note'); // the live notes stay with the team
      expect(text).not.toContain(`ZZALPHA action for ${w.people.ana}`); // so do other people's action items
      expect(text).toContain(`ZZALPHA action for ${w.people.bob}`);
      // The team's own copy still has everything.
      expect(pdfText((await pdfOf(w.as.ana, `/meetings/${MA}/minutes.pdf`)).body)).toContain('ZZALPHA note');
    } finally {
      await h.post(w.as.ana, `/meetings/${MA}/final-minutes/reopen`);
    }

    const items = await h.get(w.as.bob, `/meetings/${MA}/action-items`);
    expect(items.data.map((a: { assigneeId: string }) => a.assigneeId)).toEqual([w.people.bob]);
    expect(items.data[0]).toMatchObject({ taskId: null, taskKey: null });
    expect((await h.patch(w.as.bob, `/action-items/${w.actionItems.MA_bob}`, { status: 'IN_PROGRESS' })).status).toBe(200);
    expect(await h.patch(w.as.bob, `/action-items/${w.actionItems.MA_ana}`, { status: 'IN_PROGRESS' })).toMatchObject({ status: 403, error: { code: 'INVITEE_ONLY' } });

    // His own answer to the invitation, nothing more.
    const mine = (await h.get(w.as.bob, `/meetings/${MA}/attendees`)).data.find((a: { userId: string }) => a.userId === w.people.bob);
    expect((await h.patch(w.as.bob, `/meetings/${MA}/attendees/${mine.id}`, { response: 'ACCEPTED' })).status).toBe(200);
    const anas = (await h.get(w.as.bob, `/meetings/${MA}/attendees`)).data.find((a: { userId: string }) => a.userId === w.people.ana);
    expect(await h.patch(w.as.bob, `/meetings/${MA}/attendees/${anas.id}`, { response: 'DECLINED' })).toMatchObject({ status: 403, error: { code: 'INVITEE_ONLY' } });
    expect(await h.patch(w.as.bob, `/meetings/${MA}/attendees/${mine.id}`, { role: 'OPTIONAL' })).toMatchObject({ status: 403, error: { code: 'INVITEE_ONLY' } });

    // Everything else of the meeting is the team's.
    for (const [method, path, body] of [
      ['POST', `/meetings/${MA}/notes`, { body: 'hi' }],
      ['PUT', `/meetings/${MA}`, { title: 'Renamed' }],
      ['GET', `/meetings/${MA}/invites/preview`, undefined],
      ['GET', `/meetings/${MA}/minutes/preview`, undefined],
      ['POST', `/meetings/${MA}/final-minutes/draft`, { source: 'notes' }],
      ['POST', `/meetings/${MA}/agenda`, { title: 'More' }],
      ['POST', `/meetings/${MA}/attendees`, { userId: w.people.ben }],
      ['GET', `/meetings/${MA}/attendees/suggestions`, undefined],
      ['POST', `/meetings/${MA}/action-items`, { description: 'Mine' }],
    ] as const) {
      const r = method === 'GET' ? await h.get(w.as.bob, path) : method === 'PUT' ? await h.put(w.as.bob, path, body) : await h.post(w.as.bob, path, body);
      expect(r, `${method} ${path}`).toMatchObject({ status: 403, error: { code: 'INVITEE_ONLY' } });
    }

    // And nothing of the project.
    expect((await h.get(w.as.bob, `/projects/${w.projects.PA}`)).status).toBe(404);
    expect((await h.get(w.as.bob, `/tasks/${w.tasks.TA1}`)).status).toBe(404);
    expect((await h.get(w.as.bob, `/projects/${w.projects.PA}/meetings-overview`)).status).toBe(403);
    expect((await h.get(w.as.bob, `/projects/${w.projects.PA}/chat`)).status).toBe(403);
    const seen = JSON.stringify([meeting.data, items.data, (await h.get(w.as.bob, `/meetings/${MA}/attendees`)).data, (await h.get(w.as.bob, `/meetings/${MA}/agenda`)).data]);
    expect(seen).not.toMatch(/ZZALPHA note|ZZALPHA channel|ZZALPHA task|ZZALPHA comment/);
    expect(seen).not.toContain(`ZZALPHA action for ${w.people.ana}`);
  });

  it('the minutes email: bob, invited from Beta, gets his own copy once the minutes are final — the team the full one', async () => {
    const { MA } = w.meetings;
    const { ana, bob } = w.people;
    const copies = new Map<string, Buffer | null | undefined>();
    const notify = {
      async sendMinutes(_id: string, _pdf: Buffer, opts?: { attachmentFor?: (userId: string) => Promise<Buffer | null | undefined> }) {
        for (const userId of [ana, bob]) copies.set(userId, opts?.attachmentFor ? await opts.attachmentFor(userId) : undefined);
        return { sent: 2, failed: 0 };
      },
      async previewMinutes() { return {}; },
    };
    const mailing = await buildPeopleApp(prisma, { meetingNotifyService: notify as never });
    try {
      // Not final yet: bob is sent nothing (in the app he can't open them yet either); ana the shared PDF.
      expect((await mailing.post(w.as.ana, `/meetings/${MA}/minutes/send`, {})).status).toBe(200);
      expect(copies.get(bob)).toBeNull();
      expect(copies.get(ana)).toBeUndefined();
      // Final: bob's own copy — the final minutes and his action items; not the live notes or ana's items.
      expect((await mailing.post(w.as.ana, `/meetings/${MA}/final-minutes/approve`, { content: FINAL })).status).toBe(200);
      expect((await mailing.post(w.as.ana, `/meetings/${MA}/minutes/send`, {})).status).toBe(200);
      const theirs = copies.get(bob);
      expect(Buffer.isBuffer(theirs)).toBe(true);
      const text = pdfText(theirs as Buffer);
      expect(text).toContain('Agreed ZZFINAL');
      expect(text).toContain(`ZZALPHA action for ${bob}`);
      expect(text).not.toContain('ZZALPHA note');
      expect(text).not.toContain(`ZZALPHA action for ${ana}`);
      expect(copies.get(ana)).toBeUndefined();
    } finally {
      await mailing.post(w.as.ana, `/meetings/${MA}/final-minutes/reopen`);
      await mailing.close();
    }
  });

  it('ana (same company, on the team) and administrators keep the full view; a stranger sees nothing', async () => {
    expect((await h.get(w.as.ana, `/meetings/${w.meetings.MA}`)).data.view).toBe('full');
    expect((await h.get(w.as.ana, `/meetings/${w.meetings.MA}/notes`)).status).toBe(200);
    expect((await h.get(w.as.cat, `/meetings/${w.meetings.MA}`)).data.view).toBe('full'); // on PA's team, not invited
    expect((await h.get(w.as.admin, `/meetings/${w.meetings.MA}`)).data.view).toBe('full');
    expect((await h.get(w.as.ana, `/meetings/${w.meetings.MA}/action-items`)).data).toHaveLength(2);
    expect((await h.get(w.as.amy, `/meetings/${w.meetings.MA}`)).status).toBe(404);
    expect((await h.get(w.as.ana, `/meetings/${w.meetings.MN_A}`)).data).toMatchObject({ view: 'full', companyId: w.companies.A });
  });

  it('a meeting without a project needs a company', async () => {
    expect(await h.post(w.as.admin, '/meetings', standalone())).toMatchObject({ status: 400, error: { message: 'Pick the company this meeting belongs to.' } });
    expect((await h.post(w.as.amy, '/meetings', standalone())).data.companyId).toBe(w.companies.A); // primary
    expect((await h.post(w.as.cat, '/meetings', standalone())).data.companyId).toBe(w.companies.B); // cat's primary is Beta…
    expect((await h.post(w.as.cat, '/meetings', standalone(), { 'x-company-id': w.companies.A })).data.companyId).toBe(w.companies.A); // …the picked company wins
    expect(await h.post(w.as.ana, '/meetings', { ...standalone(), companyId: w.companies.B })).toMatchObject({ status: 403, error: { code: 'COMPANY_NOT_AVAILABLE' } });
    expect((await h.post(w.as.admin, '/meetings', { ...standalone(), companyId: w.companies.B })).data.companyId).toBe(w.companies.B);
    const inProject = await h.post(w.as.ana, '/meetings', { ...standalone(), projectId: w.projects.PA });
    expect(inProject.data.companyId).toBeNull();
    // Taken out of its project it needs a company again (the organizer's primary); into one, none.
    expect((await h.put(w.as.ana, `/meetings/${inProject.data.id}`, { projectId: null })).data.companyId).toBe(w.companies.A);
    expect((await h.put(w.as.ana, `/meetings/${inProject.data.id}`, { projectId: w.projects.PA })).data.companyId).toBeNull();
    expect(await h.put(w.as.amy, `/meetings/${w.meetings.MN_A}`, { companyId: w.companies.B })).toMatchObject({ status: 403, error: { code: 'COMPANY_NOT_AVAILABLE' } });
  });

  it('a repeating standalone meeting’s later meetings keep its company', async () => {
    const r = await h.post(w.as.amy, '/meetings', { ...standalone(), recurrenceRule: { freq: 'WEEKLY', interval: 1, count: 3 } });
    expect(r.status).toBe(201);
    const series = await prisma.meeting.findMany({ where: { OR: [{ id: r.data.id }, { recurrenceParentId: r.data.id }] }, select: { companyId: true } });
    expect(series.length).toBe(3);
    expect(series.every((m) => m.companyId === w.companies.A)).toBe(true);
  });

  it('invite candidates: the project’s companies, as far as the inviter can see', async () => {
    const { ana, amy, cat, ben, bob, gus } = w.people;
    expect(ids((await h.get(w.as.ana, `/meetings/invite-candidates?projectId=${w.projects.PAB}`)).data)).toEqual(sorted([ana, amy, cat, ben])); // ben: teammate; bob: not
    expect(ids((await h.get(w.as.admin, `/meetings/invite-candidates?projectId=${w.projects.PAB}`)).data)).toEqual(sorted([ana, amy, cat, ben, bob]));
    expect((await h.get(w.as.ana, `/meetings/invite-candidates?projectId=${w.projects.PB}`)).status).toBe(404);
    expect(ids((await h.get(w.as.ana, `/meetings/invite-candidates?companyId=${w.companies.A}`)).data)).toEqual(sorted([ana, amy, cat]));
    expect(await h.get(w.as.ana, `/meetings/invite-candidates?companyId=${w.companies.B}`)).toMatchObject({ status: 403, error: { code: 'COMPANY_NOT_AVAILABLE' } });
    expect((await h.get(w.as.ana, '/meetings/invite-candidates')).status).toBe(400);

    expect(await h.post(w.as.ana, `/meetings/${w.meetings.MA}/attendees`, { userId: gus })).toMatchObject({ status: 400, error: { message: 'Gus Gammaonly can’t be invited: they aren’t in this meeting’s companies.' } });
    expect(await h.post(w.as.ana, '/meetings', { ...standalone(), attendees: [{ userId: bob }] })).toMatchObject({ status: 400, error: { message: 'Bob Betaonly can’t be invited: they aren’t in this meeting’s companies.' } });
    expect((await h.post(w.as.ana, '/meetings', { ...standalone(), attendees: [{ userId: amy }, { externalEmail: 'guest@outside.test' }] })).status).toBe(201); // guests by email, as before
    const added = await h.post(w.as.ana, `/meetings/${w.meetings.MA}/attendees`, { userId: amy });
    expect(added.status).toBe(201);
    await h.del(w.as.ana, `/meetings/${w.meetings.MA}/attendees/${added.data.id}`);
    // Suggestions from earlier meetings offer only people who could be invited.
    expect((await h.get(w.as.admin, `/meetings/${w.meetings.MA}/attendees/suggestions?from=${w.meetings.MB}`)).data).not.toContain(ben);
  });

  it('free times ignore people the asker doesn’t know', async () => {
    const r = await h.post(w.as.ana, '/meetings/free-times', { userIds: [w.people.amy, w.people.bob], startAt: tomorrow(), minutes: 30 });
    expect(r.status).toBe(200);
    expect(r.data.day.map((d: { userId: string }) => d.userId)).toEqual([w.people.amy]);
  });

  it('reminders go to the people the meeting is still open to: its organizer and invitees, from any company', async () => {
    const source = createPrismaMeetingReminderSource(prisma);
    const due = (await source.dueMeetings([{ from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 3 * 86_400_000) }])).find((m) => m.id === w.meetings.MA)!;
    const people = await source.people([due.organizerId, ...due.attendees.flatMap((a) => (a.userId ? [a.userId] : []))]);
    const userIds = reminderRecipients(due, due.attendees, people).flatMap((r) => (r.kind === 'user' ? [r.userId] : []));
    expect(sorted(userIds)).toEqual(sorted([w.people.ana, w.people.bob]));
    for (const id of userIds) expect((await h.get({ id, roles: ['EMPLOYEE'] }, `/meetings/${w.meetings.MA}`)).status).toBe(200);
  });
});
