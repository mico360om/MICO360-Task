import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildClientWorld, dropClientWorld, type ClientWorld } from './client-world';
import { buildClientPortalApp } from './client-portal-app';
import { inspectPdf } from '../../src/lib/pdf-inspect';

// 1.23 The Client portal over HTTP, on the real database: the leak matrix (two clients, three projects,
// shown and hidden items, each module and action on and off) and the team's side of it.
// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let w: ClientWorld;
let a: Awaited<ReturnType<typeof buildClientPortalApp>>;

beforeAll(async () => {
  await prisma.$connect();
  w = await buildClientWorld(prisma);
  a = await buildClientPortalApp(prisma);
});
afterAll(async () => {
  await a?.close();
  if (w) await dropClientWorld(prisma, w);
  await prisma.$disconnect();
});

const text = (r: { body: string }) => r.body;

describe('the portal home and project pages', () => {
  it('each client sees only their own projects, with what they were given', async () => {
    const one = await a.get(w.as.c1, '/portal/me');
    expect(one.status).toBe(200);
    expect(one.data.projects.map((p: { id: string }) => p.id).sort()).toEqual([w.projects.P1, w.projects.P2].sort());
    const p1 = one.data.projects.find((p: { id: string }) => p.id === w.projects.P1);
    expect(p1).toMatchObject({ modules: { progress: true, meetings: true }, actions: { comment: true, signOff: true, respond: true, download: true }, company: { name: `Alpha ${w.tag}` } });
    expect(p1.percentDone).toBe(33); // 1 of P1's 3 tasks is done (the hidden one counts, unnamed)
    const p2 = one.data.projects.find((p: { id: string }) => p.id === w.projects.P2);
    expect(p2).toMatchObject({ modules: { progress: true, meetings: false }, actions: { comment: false, signOff: false, respond: false, download: false } });
    expect(one.data.me).toEqual({ name: `Cliff One ${w.tag}`, email: `c1.${w.tag}@cw.test`, organisation: `Acme ${w.tag}` });
    const two = await a.get(w.as.c2, '/portal/me');
    expect(two.data.projects.find((p: { id: string }) => p.id === w.projects.P2).percentDone).toBeNull(); // no Progress module
    expect(text(one) + text(two)).not.toMatch(/ZZHIDDEN|P3only|Omar|Zara/);
  });

  it('a project page lists only shown tasks, with no staff names, descriptions or hidden work', async () => {
    const r = await a.get(w.as.c1, `/portal/projects/${w.projects.P1}`);
    expect(r.status).toBe(200);
    expect(r.data.progress.tasks.map((t: { id: string }) => t.id).sort()).toEqual([w.tasks.S1, w.tasks.D1].sort());
    expect(text(r)).not.toMatch(/ZZHIDDEN|ZZDESC|Omar|Zara|Doing|ZZSTAFF/);
  });

  it('a project the client has no grant for, or that doesn’t exist, is 404 — never its data', async () => {
    for (const id of [w.projects.P3, 'no-such-project']) {
      const r = await a.get(w.as.c1, `/portal/projects/${id}`);
      expect(r.status, id).toBe(404);
      expect(text(r)).not.toMatch(/P3only|Project P3/);
    }
  });

  it('without the Progress module there is no progress and no task (404 for a task)', async () => {
    const page = await a.get(w.as.c2, `/portal/projects/${w.projects.P2}`);
    expect(page.status).toBe(200);
    expect(page.data.progress).toBeNull();
    expect(text(page)).not.toContain('Order parts');
    expect((await a.get(w.as.c2, `/portal/projects/${w.projects.P2}/tasks/${w.tasks.S2}`)).status).toBe(404);
  });
});

describe('tasks: only shown ones, only through their own project', () => {
  it('a hidden task, another project’s task, or a task of a project without a grant is 404', async () => {
    const tries = [
      [w.projects.P1, w.tasks.H1],
      [w.projects.P1, w.tasks.S2], // shown, but in P2
      [w.projects.P2, w.tasks.S1], // shown, but in P1
      [w.projects.P2, w.tasks.H2],
      [w.projects.P3, w.tasks.S3], // no grant
      [w.projects.P1, w.tasks.S3],
    ];
    for (const [p, t] of tries) {
      const r = await a.get(w.as.c1, `/portal/projects/${p}/tasks/${t}`);
      expect(r.status, `${p} ${t}`).toBe(404);
      expect(text(r)).not.toMatch(/ZZHIDDEN|P3only|Order parts|Install pump/);
    }
  });

  it('a shown task: its status and number, and the thread of the client’s own comments with the ticked replies', async () => {
    const r = await a.get(w.as.c1, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.S1}`);
    expect(r.status).toBe(200);
    expect(r.data.task).toMatchObject({ id: w.tasks.S1, title: 'Install pump', status: 'In progress', description: null });
    expect(r.data.comments.map((c: { body: string; from: string }) => [c.from, c.body])).toEqual([
      ['you', 'When will the pump arrive?'],
      ['team', 'Visible reply: Monday'],
    ]);
    expect(text(r)).not.toMatch(/ZZSTAFF|ZZOTHER|Omar|Zara|ZZDESC/);
    // c2 sees only their own question on the same task.
    const two = await a.get(w.as.c2, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.S1}`);
    expect(two.data.comments.map((c: { body: string }) => c.body)).toEqual(['ZZOTHER question from Cleo']);
    expect(text(two)).not.toMatch(/pump arrive|Visible reply|ZZSTAFF/);
  });

  it('the description shows once its own tick is on', async () => {
    const on = await a.put(w.as.omar, `/tasks/${w.tasks.S1}/client-visible`, { visible: true, showDescription: true });
    expect(on.status).toBe(200);
    expect(on.data.clientShowDescription).toBe(true);
    expect((await a.get(w.as.c1, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.S1}`)).data.task.description).toBe('ZZDESC pump spec');
    await a.put(w.as.omar, `/tasks/${w.tasks.S1}/client-visible`, { visible: true, showDescription: false });
    expect((await a.get(w.as.c1, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.S1}`)).data.task.description).toBeNull();
  });

  it('commenting needs the Comment action (403), and the team sees the comment marked Client', async () => {
    expect((await a.post(w.as.c1, `/portal/projects/${w.projects.P2}/tasks/${w.tasks.S2}/comments`, { body: 'Hi' })).status).toBe(403);
    const r = await a.post(w.as.c1, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.S1}/comments`, { body: 'Please confirm the date' });
    expect(r.status).toBe(201);
    expect(r.data.comments.at(-1)).toMatchObject({ from: 'you', body: 'Please confirm the date' });
    const staff = await a.get(w.as.omar, `/tasks/${w.tasks.S1}/comments`);
    const mine = staff.data.find((c: { body: string }) => c.body === 'Please confirm the date');
    expect(mine).toMatchObject({ fromClient: true, userId: w.people.c1, clientAuthor: { name: `Cliff One ${w.tag}`, organisation: `Acme ${w.tag}` } });
    expect(a.notices.at(-1)).toMatchObject({ type: 'TASK_COMMENT', taskId: w.tasks.S1, userIds: [w.people.omar] });
    expect(a.audited.at(-1)).toMatchObject({ module: 'client-portal', action: 'portal.comment', userId: w.people.c1 });
    // An empty comment is refused.
    expect((await a.post(w.as.c1, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.S1}/comments`, { body: '   ' })).status).toBe(400);
  });

  it('the team ticks "Visible to client" on a reply to a client’s comment only', async () => {
    const shown = await a.post(w.as.omar, `/tasks/${w.tasks.S1}/comments`, { body: 'Confirmed for Monday', parentId: w.comments.c1, clientVisible: true });
    expect(shown.status).toBe(201);
    expect(shown.data).toMatchObject({ clientVisible: true, parentId: w.comments.c1 });
    expect((await a.post(w.as.omar, `/tasks/${w.tasks.S1}/comments`, { body: 'Top-level', clientVisible: true })).status).toBe(400);
    expect((await a.post(w.as.omar, `/tasks/${w.tasks.S1}/comments`, { body: 'To a staff note', parentId: w.comments.staff, clientVisible: true })).status).toBe(400);
    const r = await a.get(w.as.c1, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.S1}`);
    expect(r.data.comments.map((c: { body: string }) => c.body)).toContain('Confirmed for Monday');
    expect((await a.get(w.as.c2, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.S1}`)).body).not.toContain('Confirmed for Monday');
  });
});

describe('sign off: Accept and Send back', () => {
  it('needs the Sign off action (403) and a finished task (409)', async () => {
    expect((await a.post(w.as.c2, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.D1}/accept`)).status).toBe(403);
    const r = await a.post(w.as.c1, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.S1}/accept`);
    expect(r.status).toBe(409);
    expect(r.error.code).toBe('NOT_DONE');
    expect((await a.post(w.as.c1, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.H1}/accept`)).status).toBe(404);
  });

  it('Accept: "Client accepted · date" for the team, the history says (client), the team is told', async () => {
    const r = await a.post(w.as.c1, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.D1}/accept`);
    expect(r.status).toBe(200);
    expect(r.data.task.acceptedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.data.can.signOff).toBe(false);
    const staff = await a.get(w.as.omar, `/tasks/${w.tasks.D1}`);
    expect(staff.data.clientAcceptedAt).toEqual(expect.any(String));
    const history = await a.get(w.as.omar, `/tasks/${w.tasks.D1}/activity`);
    expect(history.body).toContain(`Cliff One ${w.tag} (client)`);
    expect(a.notices.at(-1)).toMatchObject({ type: 'TASK_CLIENT_SIGN_OFF', title: 'A client accepted a task' });
    expect(a.broadcasts.at(-1)).toEqual({ projectId: w.projects.P1, event: 'task:updated' });
  });

  it('Send back: a reason, back to In progress, the reason as their comment, the acceptance gone', async () => {
    expect((await a.post(w.as.c1, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.D1}/send-back`, { reason: ' ' })).status).toBe(400);
    const r = await a.post(w.as.c1, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.D1}/send-back`, { reason: 'The survey misses the north side' });
    expect(r.status).toBe(200);
    expect(r.data.task).toMatchObject({ status: 'In progress', acceptedOn: null, awaitingSignOff: false });
    const t = await prisma.task.findUniqueOrThrow({ where: { id: w.tasks.D1 } });
    expect(t).toMatchObject({ columnId: w.columns[w.projects.P1]!.doing, completedAt: null, clientAcceptedAt: null });
    const staff = await a.get(w.as.omar, `/tasks/${w.tasks.D1}/comments`);
    expect(staff.data.find((c: { body: string }) => c.body === 'Sent back: The survey misses the north side')).toMatchObject({ fromClient: true });
    expect(a.notices.at(-1)).toMatchObject({ type: 'TASK_CLIENT_SIGN_OFF', title: 'A client sent a task back', userIds: [w.people.omar] });
    // Not done any more: nothing to sign off.
    expect((await a.post(w.as.c1, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.D1}/accept`)).status).toBe(409);
  });
});

describe('meetings and minutes', () => {
  it('the Meetings tab: invited meetings and meetings with shown minutes, of that project only', async () => {
    const one = await a.get(w.as.c1, `/portal/projects/${w.projects.P1}/meetings`);
    expect(one.status).toBe(200);
    expect(one.data.map((m: { id: string }) => m.id).sort()).toEqual([w.meetings.M1, w.meetings.M1S].sort());
    expect(text(one)).not.toMatch(/ZZHIDDEN|P3only|M2/);
    // c1 has no Meetings module on P2; c2 has no Meetings module on P1.
    expect((await a.get(w.as.c1, `/portal/projects/${w.projects.P2}/meetings`)).status).toBe(404);
    expect((await a.get(w.as.c2, `/portal/projects/${w.projects.P1}/meetings`)).status).toBe(404);
    const two = await a.get(w.as.c2, `/portal/projects/${w.projects.P2}/meetings`);
    expect(two.data.map((m: { id: string }) => m.id).sort()).toEqual([w.meetings.M2, w.meetings.M2S].sort());
  });

  it('an invited meeting: the meeting, place and agenda topics; never people, notes or staff items', async () => {
    const r = await a.get(w.as.c1, `/portal/projects/${w.projects.P1}/meetings/${w.meetings.M1}`);
    expect(r.status).toBe(200);
    expect(r.data.meeting).toMatchObject({ id: w.meetings.M1, invited: true, response: 'PENDING', location: 'ZZPLACE site office' });
    expect(r.data.agenda).toEqual([{ title: 'Pump status', minutes: null }]);
    expect(r.data.actionItems.map((i: { id: string }) => i.id)).toEqual([w.actionItems.M1_c1]);
    expect(text(r)).not.toMatch(/ZZSTAFF|Omar|Zara/);
  });

  it('a meeting with shown minutes: the client copy (no risks, owners off), no place', async () => {
    const r = await a.get(w.as.c1, `/portal/projects/${w.projects.P1}/meetings/${w.meetings.M1S}`);
    expect(r.status).toBe(200);
    expect(r.data.meeting).toMatchObject({ invited: false, location: null });
    expect(r.data.minutes.content.summary).toBe('Agreed ZZSHOWN');
    expect(r.data.minutes.content.risks).toEqual([]);
    expect(text(r)).not.toMatch(/ZZRISK|ZZPLACE/);
  });

  it('meetings the client may not see are 404: minutes not shown, another project’s, no grant', async () => {
    for (const [p, m] of [
      [w.projects.P1, w.meetings.M1N],
      [w.projects.P1, w.meetings.M2],
      [w.projects.P1, w.meetings.M3],
      [w.projects.P3, w.meetings.M3],
    ]) {
      const r = await a.get(w.as.c1, `/portal/projects/${p}/meetings/${m}`);
      expect(r.status, `${p} ${m}`).toBe(404);
      expect(text(r)).not.toMatch(/ZZHIDDEN|P3only|M2 planning/);
    }
    // An invitation link's meeting is found only when it is theirs to see.
    expect((await a.get(w.as.c1, `/portal/meetings/${w.meetings.M1}`)).data).toEqual({ projectId: w.projects.P1, meetingId: w.meetings.M1 });
    expect((await a.get(w.as.c1, `/portal/meetings/${w.meetings.M3}`)).status).toBe(404);
    expect((await a.get(w.as.c1, `/portal/meetings/${w.meetings.M1N}`)).status).toBe(404);
  });

  it('reply to an invitation: with the Reply action, invited meetings only', async () => {
    const r = await a.post(w.as.c1, `/portal/projects/${w.projects.P1}/meetings/${w.meetings.M1}/response`, { response: 'ACCEPTED' });
    expect(r.status).toBe(200);
    expect(r.data.meeting.response).toBe('ACCEPTED');
    expect((await prisma.meetingAttendee.findUniqueOrThrow({ where: { id: w.attendees.M1_c1 } })).response).toBe('ACCEPTED');
    expect((await a.post(w.as.c1, `/portal/projects/${w.projects.P1}/meetings/${w.meetings.M1S}/response`, { response: 'ACCEPTED' })).status).toBe(404);
    expect((await a.post(w.as.c1, `/portal/projects/${w.projects.P1}/meetings/${w.meetings.M1}/response`, { response: 'PENDING' })).status).toBe(400);
    expect((await a.post(w.as.c2, `/portal/projects/${w.projects.P2}/meetings/${w.meetings.M2}/response`, { response: 'TENTATIVE' })).status).toBe(200);
  });

  it('mark their own action item done — never someone else’s', async () => {
    expect((await a.post(w.as.c1, `/portal/projects/${w.projects.P1}/action-items/${w.actionItems.M1_omar}/done`)).status).toBe(404);
    expect((await a.post(w.as.c1, `/portal/projects/${w.projects.P1}/action-items/${w.actionItems.M2_c2}/done`)).status).toBe(404);
    expect((await a.post(w.as.c2, `/portal/projects/${w.projects.P2}/action-items/${w.actionItems.M1_c1}/done`)).status).toBe(404);
    const r = await a.post(w.as.c1, `/portal/projects/${w.projects.P1}/action-items/${w.actionItems.M1_c1}/done`);
    expect(r.status).toBe(200);
    expect(r.data.actionItems[0]).toMatchObject({ id: w.actionItems.M1_c1, done: true });
    expect((await prisma.actionItem.findUniqueOrThrow({ where: { id: w.actionItems.M1_omar } })).status).toBe('OPEN');
  });

  it('PDFs need the Download action: the minutes’ client copy and the task list', async () => {
    const pdf = await a.app.inject({ method: 'GET', url: `/api/v1/portal/projects/${w.projects.P1}/meetings/${w.meetings.M1S}/minutes.pdf`, headers: { authorization: `Bearer ${a.tokenFor(w.as.c1)}` } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const minutesText = inspectPdf(pdf.rawPayload).pages.flat().join('\n');
    expect(minutesText).toContain('Agreed ZZSHOWN');
    expect(minutesText).not.toMatch(/ZZRISK|ZZSTAFF/);
    expect((await a.get(w.as.c1, `/portal/projects/${w.projects.P1}/meetings/${w.meetings.M1}/minutes.pdf`)).status).toBe(404); // no minutes shown
    const list = await a.app.inject({ method: 'GET', url: `/api/v1/portal/projects/${w.projects.P1}/tasks.pdf`, headers: { authorization: `Bearer ${a.tokenFor(w.as.c1)}` } });
    expect(list.statusCode).toBe(200);
    const listText = inspectPdf(list.rawPayload).pages.flat().join('\n');
    expect(listText).toContain('Install pump');
    expect(listText).not.toMatch(/ZZHIDDEN|ZZDESC/);
    // No Download action: c1 on P2, c2 on P1.
    expect((await a.get(w.as.c1, `/portal/projects/${w.projects.P2}/tasks.pdf`)).status).toBe(403);
    expect((await a.get(w.as.c2, `/portal/projects/${w.projects.P1}/tasks.pdf`)).status).toBe(403);
    expect((await a.get(w.as.c2, `/portal/projects/${w.projects.P2}/meetings/${w.meetings.M2S}/minutes.pdf`)).status).toBe(200);
  });
});

describe('the one gate: changes take effect on the next request', () => {
  it('a module or action taken away, the account switched off or deleted: refused at once', async () => {
    const c2p2 = { userId_projectId: { userId: w.people.c2, projectId: w.projects.P2 } };
    await prisma.clientProjectGrant.update({ where: c2p2, data: { canRespond: false } });
    expect((await a.post(w.as.c2, `/portal/projects/${w.projects.P2}/meetings/${w.meetings.M2}/response`, { response: 'ACCEPTED' })).status).toBe(403);
    await prisma.clientProjectGrant.update({ where: c2p2, data: { meetings: false } });
    expect((await a.get(w.as.c2, `/portal/projects/${w.projects.P2}/meetings`)).status).toBe(404);
    await prisma.clientProjectGrant.delete({ where: c2p2 });
    expect((await a.get(w.as.c2, `/portal/projects/${w.projects.P2}`)).status).toBe(404);
    await prisma.user.update({ where: { id: w.people.c2 }, data: { status: 'INACTIVE' } });
    // The guard's short account cache may still say active: the portal's own gate reads it live (403).
    const off = await a.get(w.as.c2, '/portal/me');
    expect([401, 403]).toContain(off.status);
    expect(off.body).not.toMatch(/Project P1|Install pump/);
    await prisma.user.update({ where: { id: w.people.c2 }, data: { status: 'ACTIVE' } });
    // A task un-shown is gone from the portal.
    await prisma.task.update({ where: { id: w.tasks.S1 }, data: { clientVisible: false } });
    expect((await a.get(w.as.c2, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.S1}`)).status).toBe(404);
    await prisma.task.update({ where: { id: w.tasks.S1 }, data: { clientVisible: true } });
  });

  it('an archived or deleted project leaves the portal', async () => {
    await prisma.project.update({ where: { id: w.projects.P2 }, data: { status: 'ARCHIVED' } });
    expect((await a.get(w.as.c1, '/portal/me')).data.projects.map((p: { id: string }) => p.id)).toEqual([w.projects.P1]);
    expect((await a.get(w.as.c1, `/portal/projects/${w.projects.P2}`)).status).toBe(404);
    await prisma.project.update({ where: { id: w.projects.P2 }, data: { status: 'ACTIVE' } });
  });
});

describe('sessions: clients only in the portal, staff never in it', () => {
  it('a client’s session is refused on staff routes (403 CLIENT_NOT_ALLOWED), with no data', async () => {
    const urls = [
      '/projects',
      `/projects/${w.projects.P1}`,
      `/tasks/${w.tasks.S1}`,
      `/tasks/${w.tasks.S1}/comments`,
      `/meetings/${w.meetings.M1}`,
      `/meetings/${w.meetings.M1}/attendees`,
      '/users/directory',
      `/people/candidates?projectId=${w.projects.P1}`,
      `/meetings/invite-candidates?projectId=${w.projects.P1}`,
      '/clients',
      `/projects/${w.projects.P1}/clients`,
    ];
    for (const url of urls) {
      const r = await a.get(w.as.c1, url);
      expect(r.status, url).toBe(403);
      expect(r.error.code, url).toBe('CLIENT_NOT_ALLOWED');
      expect(text(r)).not.toMatch(/Install pump|ZZ|Omar/);
    }
    expect((await a.post(w.as.c1, `/tasks/${w.tasks.S1}/comments`, { body: 'sneaky' })).status).toBe(403);
  });

  it('a token that says ADMIN for a client account still counts as a client (the live roles decide)', async () => {
    const r = await a.get({ id: w.people.c1, roles: ['ADMIN'] }, '/users');
    expect(r.status).toBe(403);
    expect(r.error.code).toBe('CLIENT_NOT_ALLOWED');
  });

  it('staff sessions are refused on the portal (403 CLIENTS_ONLY)', async () => {
    for (const who of [w.as.admin, w.as.omar]) {
      const r = await a.get(who, `/portal/projects/${w.projects.P1}`);
      expect(r.status).toBe(403);
      expect(r.error.code).toBe('CLIENTS_ONLY');
    }
  });
});

describe('the team’s side: pickers, Clients with access, invitations', () => {
  it('clients never appear in a staff picker, not even for an administrator', async () => {
    const clients = [w.people.c1, w.people.c2, `Cliff One ${w.tag}`, `Cleo Two ${w.tag}`, 'Cliff', 'Cleo'];
    for (const who of [w.as.admin, w.as.omar]) {
      for (const url of ['/users/directory', `/people/candidates?projectId=${w.projects.P1}`, `/tasks/${w.tasks.S1}/mentionable`, `/tasks/${w.tasks.S1}/assignees`, `/projects/${w.projects.P1}/members`]) {
        const r = await a.get(who, url);
        expect(r.status, url).toBeLessThan(500);
        for (const c of clients) expect(r.body, `${who.id} ${url}`).not.toContain(c);
      }
    }
  });

  it('they can’t be put on a team or a chat', async () => {
    const team = await a.post(w.as.admin, `/projects/${w.projects.P1}/members`, { userIds: [w.people.c1] });
    expect(team.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.projectMember.count({ where: { userId: w.people.c1 } })).toBe(0);
    const dm = await a.post(w.as.admin, '/conversations/direct', { userId: w.people.c1 });
    expect(dm.status).toBeGreaterThanOrEqual(400);
  });

  it('the invite picker offers the project’s clients with the Meetings module, marked Client', async () => {
    const r = await a.get(w.as.omar, `/meetings/invite-candidates?projectId=${w.projects.P1}`);
    expect(r.status).toBe(200);
    const c1 = r.data.find((p: { id: string }) => p.id === w.people.c1);
    expect(c1).toMatchObject({ client: true, organisation: `Acme ${w.tag}` });
    expect(r.data.some((p: { id: string }) => p.id === w.people.c2)).toBe(false); // no Meetings module on P1
    // Inviting: a client with the module can be added; one without is refused.
    expect((await a.post(w.as.omar, `/meetings/${w.meetings.M1S}/attendees`, { userId: w.people.c1 })).status).toBe(201);
    expect((await a.post(w.as.omar, `/meetings/${w.meetings.M1S}/attendees`, { userId: w.people.c2 })).status).toBe(400);
    const roster = await a.get(w.as.omar, `/meetings/${w.meetings.M1}/attendees`);
    expect(roster.data.people ?? roster.body).toBeDefined();
  });

  it('Clients with access: the team reads it, only administrators may change it, outsiders get 404', async () => {
    const team = await a.get(w.as.zara, `/projects/${w.projects.P1}/clients`);
    expect(team.status).toBe(200);
    expect(team.data.canChange).toBe(false);
    expect(team.data.clients.map((c: { name: string }) => c.name)).toEqual([`Cleo Two ${w.tag}`, `Cliff One ${w.tag}`]);
    expect(team.data.clients.find((c: { id: string }) => c.id === w.people.c2).access).toEqual(['Progress, milestones and tasks', 'Comment on tasks']);
    expect((await a.get(w.as.admin, `/projects/${w.projects.P1}/clients`)).data.canChange).toBe(true);
    expect((await a.get(w.as.zara, `/projects/${w.projects.P2}/clients`)).status).toBe(404); // not her project
  });
});

describe('administrators: client accounts', () => {
  it('make a client with its projects (no company, the Client role only), then change it', async () => {
    const created = await a.post(w.as.admin, '/clients', {
      firstName: 'Fatma',
      lastName: `New ${w.tag}`,
      username: `fatma_${w.tag}`,
      email: `fatma.${w.tag}@cw.test`,
      password: 'Password1!',
      organisation: 'Oman Drilling',
      phone: '+968 9000 0000',
      projects: [{ projectId: w.projects.P1, modules: { progress: true }, actions: { comment: true, respond: true } }],
    });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ roles: ['CLIENT'], organisation: 'Oman Drilling', phone: '+968 9000 0000' });
    expect(created.data.projects).toEqual([expect.objectContaining({ projectId: w.projects.P1, modules: { progress: true, meetings: false }, actions: { comment: true, signOff: false, respond: false, download: false } })]);
    const id = created.data.id;
    expect(await prisma.companyMember.count({ where: { userId: id } })).toBe(0);
    expect(a.audited.filter((e) => e.action === 'client.create' && e.entityId === id)).toEqual([expect.objectContaining({ module: 'clients' })]);
    // 1.23.6: a password typed for a client is a temporary one (changed at the first sign-in), audited without its value.
    expect(a.audited.at(-1)).toMatchObject({ module: 'users', action: 'user.password.temporary', entityId: id });
    expect(created.data.mustChangePassword).toBe(true);
    expect(JSON.stringify(a.audited)).not.toContain('Password1!');

    expect((await a.post(w.as.admin, '/clients', { firstName: 'X', lastName: 'Y', username: `x_${w.tag}`, email: `x.${w.tag}@cw.test`, password: 'Password1!', projects: [{ projectId: w.projects.P1 }] })).status).toBe(400); // no module
    expect((await a.post(w.as.admin, '/clients', { firstName: 'X', lastName: 'Y', username: `x_${w.tag}`, email: `x.${w.tag}@cw.test`, password: 'Password1!', projects: [{ projectId: 'nope', modules: { progress: true } }] })).status).toBe(400);

    const changed = await a.put(w.as.admin, `/clients/${id}`, { organisation: 'ODC', projects: [{ projectId: w.projects.P2, modules: { meetings: true }, actions: { respond: true } }] });
    expect(changed.status).toBe(200);
    expect(changed.data.projects.map((p: { projectId: string }) => p.projectId)).toEqual([w.projects.P2]);
    expect(a.audited.map((e) => e.action)).toEqual(expect.arrayContaining(['client.update', 'client.projects']));
    expect((await a.get(w.as.admin, '/clients')).data.some((c: { id: string }) => c.id === id)).toBe(true);
    expect((await a.get(w.as.admin, `/clients/${w.people.omar}`)).status).toBe(404); // staff aren't clients
    expect((await a.get(w.as.omar, '/clients')).status).toBe(403);
    // User Management keeps them clients.
    expect((await a.put(w.as.admin, `/users/${id}`, { roleNames: ['EMPLOYEE'] })).status).toBe(409);
  });
});

// 1.23 security review fixes.
describe('security review: emails, un-sent invitations, staff lists', () => {
  it('a meeting reaches a client only while they have its Meetings module; minutes only as the client copy of shown minutes', async () => {
    const { createClientMeetingRules } = await import('../../src/modules/clients/client-meeting-rules');
    const pdfFor: string[] = [];
    const rules = createClientMeetingRules(prisma, { clientMinutesPdf: async (p, m) => (pdfFor.push(`${p}/${m}`), { pdf: Buffer.from('%PDF-client') }) });
    expect(await rules.reach(w.meetings.M1, w.people.omar)).toBe(true); // staff: always
    expect(await rules.reach(w.meetings.M1, w.people.c1)).toBe(true); // c1 has P1 Meetings
    expect(await rules.reach(w.meetings.M1, w.people.c2)).toBe(false); // c2 has no P1 Meetings
    expect(await rules.reach(w.meetings.M3, w.people.c1)).toBe(false); // no P3 grant at all
    expect(await rules.minutes.mayHave(w.meetings.M1S, w.people.c1)).toBe(true);
    expect(await rules.minutes.mayHave(w.meetings.M1N, w.people.c1)).toBe(false); // not shown
    expect(await rules.minutes.mayHave(w.meetings.M1, w.people.c1)).toBe(false); // no minutes
    expect(await rules.minutes.mayHave(w.meetings.M1S, w.people.omar)).toBe(false); // staff get the team's copy elsewhere
    expect(await rules.minutes.pdf(w.meetings.M1S, w.people.c1)).toEqual(Buffer.from('%PDF-client'));
    expect(pdfFor).toEqual([`${w.projects.P1}/${w.meetings.M1S}`]);
    expect(await rules.minutes.pdf(w.meetings.M1N, w.people.c1)).toBeNull();
    // Switched off: nothing reaches them.
    await prisma.user.update({ where: { id: w.people.c1 }, data: { status: 'INACTIVE' } });
    expect(await rules.reach(w.meetings.M1, w.people.c1)).toBe(false);
    expect(await rules.minutes.mayHave(w.meetings.M1S, w.people.c1)).toBe(false);
    await prisma.user.update({ where: { id: w.people.c1 }, data: { status: 'ACTIVE' } });
  });

  it('a meeting whose invitation hasn’t gone out (or a draft) isn’t in the portal yet', async () => {
    const m = await prisma.meeting.create({
      data: { title: 'ZZDRAFT plan', projectId: w.projects.P1, organizerId: w.people.omar, createdById: w.people.omar, startAt: new Date(Date.now() + 86_400_000), status: 'SCHEDULED', onlineLink: 'https://meet.example/zzdraft', attendees: { create: { userId: w.people.c1 } } },
    });
    const list = await a.get(w.as.c1, `/portal/projects/${w.projects.P1}/meetings`);
    expect(list.body).not.toContain('ZZDRAFT');
    expect((await a.get(w.as.c1, `/portal/projects/${w.projects.P1}/meetings/${m.id}`)).status).toBe(404);
    await prisma.meetingAttendee.updateMany({ where: { meetingId: m.id }, data: { invitedAt: new Date() } });
    expect((await a.get(w.as.c1, `/portal/projects/${w.projects.P1}/meetings/${m.id}`)).status).toBe(200);
    await prisma.meeting.update({ where: { id: m.id }, data: { status: 'DRAFT' } });
    expect((await a.get(w.as.c1, `/portal/projects/${w.projects.P1}/meetings/${m.id}`)).status).toBe(404);
    await prisma.meeting.delete({ where: { id: m.id } });
  });

  it('Reports and Management never list a client as a person', async () => {
    const { createPrismaReportDataSource } = await import('../../src/modules/reports/prisma-report-data-source');
    const users = await createPrismaReportDataSource(prisma).getUsers();
    expect(users.some((u) => u.id === w.people.c1 || u.id === w.people.c2)).toBe(false);
    expect(users.some((u) => u.id === w.people.omar)).toBe(true);
    const { createPrismaManagementSource } = await import('../../src/modules/management/prisma-management-source');
    const people = await createPrismaManagementSource(prisma, 'Asia/Muscat').people([w.people.c1, w.people.omar]);
    expect(people.map((p) => p.id)).toEqual([w.people.omar]);
  });

  it('Send back moves the task before anything else is written (a refused move leaves no comment)', async () => {
    const t = await prisma.task.create({
      data: { key: `T${w.tag.toUpperCase()}-SB`, title: 'Fence', projectId: w.projects.P1, columnId: w.columns[w.projects.P1]!.done, completedAt: new Date(Date.now() - 60_000), clientVisible: true, createdById: w.people.omar },
    });
    // No column to go back to: refused, and no "Sent back" comment is left behind.
    await prisma.kanbanColumn.updateMany({ where: { projectId: w.projects.P1, category: { not: 'DONE' } }, data: { enabled: false } });
    const refused = await a.post(w.as.c1, `/portal/projects/${w.projects.P1}/tasks/${t.id}/send-back`, { reason: 'Gate missing' });
    await prisma.kanbanColumn.updateMany({ where: { projectId: w.projects.P1 }, data: { enabled: true } });
    expect(refused.status).toBe(409);
    expect(await prisma.comment.count({ where: { taskId: t.id } })).toBe(0);
    const ok = await a.post(w.as.c1, `/portal/projects/${w.projects.P1}/tasks/${t.id}/send-back`, { reason: 'Gate missing' });
    expect(ok.status).toBe(200);
    expect(await prisma.comment.count({ where: { taskId: t.id, fromClient: true, body: 'Sent back: Gate missing' } })).toBe(1);
  });
});
