import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { buildClientWorld, dropClientWorld, type ClientWorld } from './client-world';
import { buildClientPortalApp } from './client-portal-app';
import { createPrismaClientViewSource } from '../../src/modules/client-view/client-view-source';
import { NOT_SENT_WORDS } from '../../src/modules/clients/client-notices';

// 1.23.7 Granular Client Portal permissions, on the real database: the upgrade of existing grants, roles,
// every permission checked per request (uploads and notifications too), "Show to client" on files, the
// notification switches and the bell, and Preview as client never writing or sending anything.
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
  if (w) {
    await prisma.clientNoticeSettings.deleteMany({ where: { userId: { in: Object.values(w.people) } } });
    await dropClientWorld(prisma, w);
  }
  await prisma.$disconnect();
});

type GrantData = Prisma.ClientProjectGrantUncheckedUpdateInput;
const NONE = { progress: false, meetings: false, canComment: false, canSignOff: false, canRespond: false, canDownload: false, canUpload: false, canNotify: false };
const ALL = { progress: true, meetings: true, canComment: true, canSignOff: true, canRespond: true, canDownload: true, canUpload: true, canNotify: true };
const setGrant = (userId: string, projectId: string, data: GrantData) =>
  prisma.clientProjectGrant.upsert({ where: { userId_projectId: { userId, projectId } }, update: data, create: { userId, projectId, ...(data as object) } as Prisma.ClientProjectGrantUncheckedCreateInput });
const bell = async (who: { id: string; roles: string[] }) => (await a.get(who, '/portal/notifications')).data as { items: { id: string; kind: string; title: string; body: string | null; taskId: string | null; meetingId: string | null; read: boolean }[]; unread: number };

const BOUNDARY = '----permboundary';
const multipart = (filename: string, mime: string, content: string) =>
  [`--${BOUNDARY}`, `Content-Disposition: form-data; name="file"; filename="${filename}"`, `Content-Type: ${mime}`, '', content, `--${BOUNDARY}--`, ''].join('\r\n');
async function upload(who: { id: string; roles: string[] }, projectId: string, taskId: string, filename = 'site-photo-notes.txt', mime = 'text/plain', content = 'ZZUPLOAD from the client') {
  const res = await a.app.inject({
    method: 'POST',
    url: `/api/v1/portal/projects/${projectId}/tasks/${taskId}/files`,
    headers: { authorization: `Bearer ${a.tokenFor(who)}`, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: multipart(filename, mime, content),
  });
  return { status: res.statusCode, json: res.statusCode < 500 ? res.json() : null };
}

describe('the upgrade of existing grants (backfill migration)', () => {
  it('every grant from before 1.23.7 becomes Custom with exactly its current access, notifications on, upload off — and running it again changes nothing', async () => {
    const ours = { userId: { in: [w.people.c1, w.people.c2] } };
    const before = await prisma.clientProjectGrant.findMany({ where: ours, orderBy: [{ userId: 'asc' }, { projectId: 'asc' }] });
    expect(before.every((g) => g.role === null && !g.canNotify && !g.canUpload)).toBe(true);
    // Before the backfill reaches it, a grant reads as Custom with its ticks (the admin's view).
    const pre = await a.get(w.as.admin, `/clients/${w.people.c1}`);
    expect(pre.data.projects.find((p: { projectId: string }) => p.projectId === w.projects.P1)).toMatchObject({ role: 'CUSTOM', actions: { comment: true, signOff: true, upload: false, notify: false } });

    const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261108100100_client_permissions_backfill/migration.sql'), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    await prisma.$executeRawUnsafe(sql);
    const after = await prisma.clientProjectGrant.findMany({ where: ours, orderBy: [{ userId: 'asc' }, { projectId: 'asc' }] });
    const ticks = (g: (typeof before)[number]) => [g.userId, g.projectId, g.progress, g.meetings, g.canComment, g.canSignOff, g.canRespond, g.canDownload];
    expect(after.map(ticks)).toEqual(before.map(ticks)); // nobody gains or loses access
    expect(after.every((g) => g.role === 'CUSTOM' && g.canNotify && !g.canUpload)).toBe(true);

    // A later choice survives a second run.
    await setGrant(w.people.c2, w.projects.P1, { role: 'VIEWER', canNotify: false });
    await prisma.$executeRawUnsafe(sql);
    expect(await prisma.clientProjectGrant.findUnique({ where: { userId_projectId: { userId: w.people.c2, projectId: w.projects.P1 } } })).toMatchObject({ role: 'VIEWER', canNotify: false });
    await setGrant(w.people.c2, w.projects.P1, { role: 'CUSTOM', canNotify: true });
  });
});

describe('roles through the Clients API', () => {
  it('a role stores its set (whatever ticks came with it); Custom stores its own; the audit log names them', async () => {
    const r = await a.put(w.as.admin, `/clients/${w.people.c2}`, {
      projects: [
        { projectId: w.projects.P1, role: 'CONTRIBUTOR', modules: { progress: false }, actions: { signOff: true } },
        { projectId: w.projects.P2, role: 'CUSTOM', modules: { meetings: true }, actions: { respond: true, download: true, notify: true, upload: true } },
      ],
    });
    expect(r.status).toBe(200);
    const p1 = r.data.projects.find((p: { projectId: string }) => p.projectId === w.projects.P1);
    expect(p1).toMatchObject({ role: 'CONTRIBUTOR', modules: { progress: true, meetings: true }, actions: { comment: true, upload: true, respond: true, download: true, notify: true, signOff: false } });
    const p2 = r.data.projects.find((p: { projectId: string }) => p.projectId === w.projects.P2);
    expect(p2).toMatchObject({ role: 'CUSTOM', modules: { progress: false, meetings: true }, actions: { respond: true, download: true, notify: true, upload: false } });
    const line = a.audited.filter((e) => e.action === 'client.projects').at(-1)!;
    expect(JSON.stringify(line.newValue)).toContain('Contributor');
    // "Clients with access" shows each client's role (read-only for managers).
    const list = await a.get(w.as.omar, `/projects/${w.projects.P1}/clients`);
    expect(list.data.clients.find((c: { id: string }) => c.id === w.people.c2)).toMatchObject({ role: 'CONTRIBUTOR' });
    expect(list.data.canChange).toBe(false);
  });

  it('a Custom row with no view is refused (400); an unknown role too', async () => {
    expect((await a.put(w.as.admin, `/clients/${w.people.c2}`, { projects: [{ projectId: w.projects.P1, role: 'CUSTOM', actions: { comment: true } }] })).status).toBe(400);
    expect((await a.put(w.as.admin, `/clients/${w.people.c2}`, { projects: [{ projectId: w.projects.P1, role: 'OWNER' }] })).status).toBe(400);
  });
});

describe('every permission is checked on every request', () => {
  const P1 = () => w.projects.P1;
  it('View tasks off: no progress, no task, no file, no upload (404 — the tab isn’t there)', async () => {
    await setGrant(w.people.c1, P1(), { ...ALL, progress: false, role: 'CUSTOM' });
    expect((await a.get(w.as.c1, `/portal/projects/${P1()}`)).data.progress).toBeNull();
    expect((await a.get(w.as.c1, `/portal/projects/${P1()}/tasks/${w.tasks.S1}`)).status).toBe(404);
    expect((await upload(w.as.c1, P1(), w.tasks.S1)).status).toBe(404);
    expect(await prisma.attachment.count({ where: { taskId: w.tasks.S1 } })).toBe(0);
  });

  it('View meetings off: no meetings (404)', async () => {
    await setGrant(w.people.c1, P1(), { ...ALL, meetings: false, canRespond: false, role: 'CUSTOM' });
    expect((await a.get(w.as.c1, `/portal/projects/${P1()}/meetings`)).status).toBe(404);
    expect((await a.get(w.as.c1, `/portal/projects/${P1()}/meetings/${w.meetings.M1}`)).status).toBe(404);
  });

  it('each action without its permission is refused (403), and nothing is written', async () => {
    const tries: [keyof typeof ALL, () => Promise<{ status: number }>][] = [
      ['canDownload', () => a.get(w.as.c1, `/portal/projects/${P1()}/tasks.pdf`)],
      ['canComment', () => a.post(w.as.c1, `/portal/projects/${P1()}/tasks/${w.tasks.S1}/comments`, { body: 'ZZNOPE' })],
      ['canUpload', () => upload(w.as.c1, P1(), w.tasks.S1)],
      ['canRespond', () => a.post(w.as.c1, `/portal/projects/${P1()}/meetings/${w.meetings.M1}/response`, { response: 'ACCEPTED' })],
      ['canSignOff', () => a.post(w.as.c1, `/portal/projects/${P1()}/tasks/${w.tasks.D1}/accept`)],
    ];
    for (const [off, attempt] of tries) {
      await setGrant(w.people.c1, P1(), { ...ALL, [off]: false, role: 'CUSTOM' });
      expect((await attempt()).status, off).toBe(403);
    }
    expect(await prisma.comment.count({ where: { body: 'ZZNOPE' } })).toBe(0);
    expect(await prisma.attachment.count({ where: { taskId: w.tasks.S1 } })).toBe(0);
    expect(await prisma.task.count({ where: { id: w.tasks.D1, clientAcceptedAt: { not: null } } })).toBe(0);
  });

  it('the portal says what each project allows (upload and notify too)', async () => {
    await setGrant(w.people.c1, P1(), { ...ALL, role: 'APPROVER' });
    const me = await a.get(w.as.c1, '/portal/me');
    expect(me.data.projects.find((p: { id: string }) => p.id === P1()).actions).toEqual({ comment: true, signOff: true, respond: true, download: true, upload: true, notify: true });
  });
});

let uploadedId = '';
describe('uploads and files', () => {
  it('a Contributor uploads to a shared task: the team sees it "from client" and is told; it is audited', async () => {
    await setGrant(w.people.c1, w.projects.P1, { ...ALL, canSignOff: false, role: 'CONTRIBUTOR' });
    const r = await upload(w.as.c1, w.projects.P1, w.tasks.S1);
    expect(r.status).toBe(201);
    expect(r.json.data.files).toEqual([expect.objectContaining({ name: 'site-photo-notes.txt', from: 'you', type: 'text/plain' })]);
    uploadedId = r.json.data.files[0].id;
    expect(JSON.stringify(r.json)).not.toMatch(/uploads\/|storageKey/);
    const staff = await a.get(w.as.omar, `/tasks/${w.tasks.S1}/attachments`);
    expect(staff.data.find((f: { id: string }) => f.id === uploadedId)).toMatchObject({ fromClient: true, clientVisible: false, uploadedById: w.people.c1 });
    expect(a.notices.at(-1)).toMatchObject({ type: 'TASK_COMMENT', title: 'A client uploaded a document', taskId: w.tasks.S1 });
    expect(a.audited.at(-1)).toMatchObject({ module: 'client-portal', action: 'portal.file.upload', userId: w.people.c1 });
  });

  it('the same rules as a staff upload: type, contents, empty', async () => {
    expect((await upload(w.as.c1, w.projects.P1, w.tasks.S1, 'x.html', 'text/html', '<b>hi</b>')).status).toBe(400);
    expect((await upload(w.as.c1, w.projects.P1, w.tasks.S1, 'fake.png', 'image/png', 'not a picture')).status).toBe(400);
    expect((await upload(w.as.c1, w.projects.P1, w.tasks.S1, 'empty.txt', 'text/plain', '')).status).toBe(400);
    expect(await prisma.attachment.count({ where: { taskId: w.tasks.S1 } })).toBe(1);
  });

  it('a client’s file can’t pretend to be a program or another type (security review): it ends in its checked type', async () => {
    const r = await upload(w.as.c1, w.projects.P1, w.tasks.S1, `invoice${String.fromCharCode(0x202e)}fdp.exe`, 'text/plain', 'not a program');
    expect(r.status).toBe(201);
    const kept = await prisma.attachment.findFirstOrThrow({ where: { taskId: w.tasks.S1, fromClient: true }, orderBy: { createdAt: 'desc' } });
    expect(kept.filename).toBe('invoicefdp.exe.txt');
    await prisma.attachment.delete({ where: { id: kept.id } });
  });

  it('only shared tasks of their own project take uploads (404 otherwise)', async () => {
    expect((await upload(w.as.c1, w.projects.P1, w.tasks.H1)).status).toBe(404);
    expect((await upload(w.as.c1, w.projects.P1, w.tasks.S2)).status).toBe(404);
    expect((await upload(w.as.c1, w.projects.P3, w.tasks.S3)).status).toBe(404);
  });

  it('another client of the project doesn’t see an upload until the team shows it', async () => {
    await setGrant(w.people.c2, w.projects.P1, { ...NONE, progress: true, canNotify: true, role: 'CUSTOM' });
    const t = await a.get(w.as.c2, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.S1}`);
    expect(t.data.files).toEqual([]);
    expect((await a.get(w.as.c2, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.S1}/files/${uploadedId}`)).status).toBe(404);
    // Their own upload: they download it.
    const own = await a.app.inject({ method: 'GET', url: `/api/v1/portal/projects/${w.projects.P1}/tasks/${w.tasks.S1}/files/${uploadedId}`, headers: { authorization: `Bearer ${a.tokenFor(w.as.c1)}` } });
    expect(own.statusCode).toBe(200);
    expect(own.body).toBe('ZZUPLOAD from the client');
    expect(own.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('"Show to client": who runs the project ticks it; then every client of the project with View tasks sees it, and is told', async () => {
    expect((await a.put(w.as.zara, `/tasks/${w.tasks.S1}/attachments/${uploadedId}/client-visible`, { visible: true })).status).toBe(403);
    const before = a.emails.length;
    const r = await a.put(w.as.omar, `/tasks/${w.tasks.S1}/attachments/${uploadedId}/client-visible`, { visible: true });
    expect(r.status).toBe(200);
    expect(r.data.clientVisible).toBe(true);
    const t = await a.get(w.as.c2, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.S1}`);
    expect(t.data.files).toEqual([expect.objectContaining({ id: uploadedId, from: 'team' })]);
    expect((await a.get(w.as.c2, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.S1}/files/${uploadedId}`)).status).toBe(200);
    // c2 is told (the bell and an email); c1 uploaded it, so isn't.
    expect((await bell(w.as.c2)).items.map((n) => [n.kind, n.body])).toContainEqual(['document', 'site-photo-notes.txt']);
    expect((await bell(w.as.c1)).items.filter((n) => n.kind === 'document')).toEqual([]);
    expect(a.emails.slice(before).map((e) => [e.to, e.kind])).toEqual([[`c2.${w.tag}@cw.test`, 'client-document']]);
  });

  it('a file never reaches the account-less share-link page', async () => {
    const items = await createPrismaClientViewSource(prisma).items(w.projects.P1);
    expect(items.length).toBeGreaterThan(0);
    expect(JSON.stringify(items)).not.toContain('site-photo-notes');
  });

  it('a file only through its own task and project (404 otherwise)', async () => {
    for (const url of [
      `/portal/projects/${w.projects.P2}/tasks/${w.tasks.S1}/files/${uploadedId}`,
      `/portal/projects/${w.projects.P1}/tasks/${w.tasks.D1}/files/${uploadedId}`,
      `/portal/projects/${w.projects.P1}/tasks/${w.tasks.H1}/files/${uploadedId}`,
      `/portal/projects/${w.projects.P1}/tasks/${w.tasks.S1}/files/no-such-file`,
    ]) {
      expect((await a.get(w.as.c1, url)).status, url).toBe(404);
    }
  });
});

let replyNotice = '';
describe('notifications: the bell, emails and switches', () => {
  it('a reply marked "Visible to client": the bell and an email', async () => {
    await setGrant(w.people.c1, w.projects.P1, { ...ALL, role: 'APPROVER' });
    const before = a.emails.length;
    expect((await a.post(w.as.omar, `/tasks/${w.tasks.S1}/comments`, { body: 'ZZREPLY one', parentId: w.comments.c1, clientVisible: true })).status).toBe(201);
    const b = await bell(w.as.c1);
    const n = b.items.find((x) => x.kind === 'reply')!;
    expect(n).toMatchObject({ taskId: w.tasks.S1, read: false, body: null });
    expect(n.title).toContain('replied to your comment');
    replyNotice = n.id;
    expect(a.emails.slice(before).map((e) => e.kind)).toEqual(['client-reply']);
  });

  it('the client switches replies off: nothing more (bell or email); the team turning notifications off does the same', async () => {
    const s = await a.put(w.as.c1, '/portal/settings/notifications', { reply: false });
    expect(s.data.settings).toEqual({ reply: false, signOff: true, minutes: true, document: true });
    const count = async () => (await prisma.clientNotice.count({ where: { userId: w.people.c1, kind: 'REPLY' } }));
    const n0 = await count();
    const e0 = a.emails.length;
    await a.post(w.as.omar, `/tasks/${w.tasks.S1}/comments`, { body: 'ZZREPLY two', parentId: w.comments.c1, clientVisible: true });
    expect(await count()).toBe(n0);
    await a.put(w.as.c1, '/portal/settings/notifications', { reply: true });
    await setGrant(w.people.c1, w.projects.P1, { canNotify: false, role: 'CUSTOM' });
    await a.post(w.as.omar, `/tasks/${w.tasks.S1}/comments`, { body: 'ZZREPLY three', parentId: w.comments.c1, clientVisible: true });
    expect(await count()).toBe(n0);
    expect(a.emails.length).toBe(e0);
    const settings = await a.get(w.as.c1, '/portal/settings/notifications');
    expect(settings.data.projects.find((p: { id: string }) => p.id === w.projects.P1)).toMatchObject({ notify: false });
    await setGrant(w.people.c1, w.projects.P1, { ...ALL, role: 'APPROVER' });
  });

  it('a finished shared task: Approvers are told it is ready for their sign-off; others aren’t', async () => {
    await setGrant(w.people.c2, w.projects.P1, { ...NONE, progress: true, canComment: true, canNotify: true, role: 'CUSTOM' });
    const before = a.emails.length;
    await a.clientNotices.signOffReady(w.tasks.D1);
    expect((await bell(w.as.c1)).items.some((n) => n.kind === 'signOff' && n.taskId === w.tasks.D1)).toBe(true);
    expect((await bell(w.as.c2)).items.some((n) => n.kind === 'signOff')).toBe(false);
    expect(a.emails.slice(before).map((e) => [e.to, e.kind])).toEqual([[`c1.${w.tag}@cw.test`, 'client-sign-off']]);
    // Not finished, or not shared: nothing.
    const n = await prisma.clientNotice.count({ where: { kind: 'SIGN_OFF' } });
    await a.clientNotices.signOffReady(w.tasks.S1);
    await a.clientNotices.signOffReady(w.tasks.H1);
    expect(await prisma.clientNotice.count({ where: { kind: 'SIGN_OFF' } })).toBe(n);
  });

  it('approved minutes: why a client gets none (their switch, or the team’s), and the bell when they did', async () => {
    expect(await a.clientNotices.minutesNotSent(w.meetings.M1S, w.people.c1)).toBeNull();
    await a.put(w.as.c1, '/portal/settings/notifications', { minutes: false });
    expect(await a.clientNotices.minutesNotSent(w.meetings.M1S, w.people.c1)).toBe(NOT_SENT_WORDS['client-off']);
    await a.put(w.as.c1, '/portal/settings/notifications', { minutes: true });
    await setGrant(w.people.c1, w.projects.P1, { canNotify: false, role: 'CUSTOM' });
    expect(await a.clientNotices.minutesNotSent(w.meetings.M1S, w.people.c1)).toBe(NOT_SENT_WORDS['team-off']);
    await setGrant(w.people.c1, w.projects.P1, { ...ALL, role: 'APPROVER' });
    await a.clientNotices.minutesSent(w.meetings.M1S, w.people.c1);
    expect((await bell(w.as.c1)).items.some((n) => n.kind === 'minutes' && n.meetingId === w.meetings.M1S)).toBe(true);
  });

  it('an invitation: a client on the meeting’s project sees it on the bell (always — no switch); staff get no client notice', async () => {
    await a.put(w.as.c1, '/portal/settings/notifications', { reply: false, signOff: false, minutes: false, document: false });
    await a.clientNotices.invited(w.meetings.M1, [w.people.c1, w.people.omar]);
    expect((await bell(w.as.c1)).items.some((n) => n.kind === 'invitation' && n.meetingId === w.meetings.M1)).toBe(true);
    expect(await prisma.clientNotice.count({ where: { userId: w.people.omar } })).toBe(0);
    await a.put(w.as.c1, '/portal/settings/notifications', { reply: true, signOff: true, minutes: true, document: true });
  });

  it('the bell shows a notice only while its item can be opened: hide the task and it goes, show it and it is back', async () => {
    expect((await bell(w.as.c1)).items.some((n) => n.id === replyNotice)).toBe(true);
    await a.put(w.as.omar, `/tasks/${w.tasks.S1}/client-visible`, { visible: false });
    expect((await bell(w.as.c1)).items.some((n) => n.taskId === w.tasks.S1)).toBe(false);
    await a.put(w.as.omar, `/tasks/${w.tasks.S1}/client-visible`, { visible: true });
    expect((await bell(w.as.c1)).items.some((n) => n.id === replyNotice)).toBe(true);
    // A notice needs what its kind needs: a reply goes with Comment (review minor 7).
    await setGrant(w.people.c1, w.projects.P1, { ...ALL, canComment: false, role: 'CUSTOM' });
    expect((await bell(w.as.c1)).items.some((n) => n.kind === 'reply')).toBe(false);
    await setGrant(w.people.c1, w.projects.P1, { ...ALL, role: 'APPROVER' });
    expect((await bell(w.as.c1)).items.some((n) => n.id === replyNotice)).toBe(true);
    // A project taken away takes its notices with it.
    await setGrant(w.people.c1, w.projects.P1, { ...ALL, progress: false, role: 'CUSTOM' });
    expect((await bell(w.as.c1)).items.some((n) => n.taskId !== null)).toBe(false);
    await setGrant(w.people.c1, w.projects.P1, { ...ALL, role: 'APPROVER' });
  });

  it('read one, read all; another client can’t touch someone else’s notice (404)', async () => {
    const b0 = await bell(w.as.c1);
    expect(b0.unread).toBeGreaterThan(0);
    expect((await a.post(w.as.c2, `/portal/notifications/${replyNotice}/read`)).status).toBe(404);
    const one = await a.post(w.as.c1, `/portal/notifications/${replyNotice}/read`);
    expect(one.data.unread).toBe(b0.unread - 1);
    expect((await a.post(w.as.c1, '/portal/notifications/read-all')).data.unread).toBe(0);
    expect((await bell(w.as.c1)).unread).toBe(0);
  });
});

describe('Preview as client', () => {
  const snapshot = async () => ({
    comments: await prisma.comment.count(),
    attachments: await prisma.attachment.findMany({ select: { id: true, clientVisible: true }, orderBy: { id: 'asc' } }),
    notices: await prisma.clientNotice.findMany({ select: { id: true, readAt: true }, orderBy: { id: 'asc' } }),
    staffNotices: await prisma.notification.count(),
    activity: await prisma.activity.count(),
    grants: JSON.stringify(await prisma.clientProjectGrant.findMany({ orderBy: [{ userId: 'asc' }, { projectId: 'asc' }] })),
    tasks: JSON.stringify(await prisma.task.findMany({ where: { projectId: { in: Object.values(w.projects) } }, select: { id: true, updatedAt: true, clientAcceptedAt: true, columnId: true }, orderBy: { id: 'asc' } })),
    attendees: JSON.stringify(await prisma.meetingAttendee.findMany({ where: { userId: { in: [w.people.c1, w.people.c2] } }, select: { id: true, response: true } })),
    settings: JSON.stringify(await prisma.clientNoticeSettings.findMany({ orderBy: { userId: 'asc' } })),
    emails: a.emails.length,
    teamNotices: a.notices.length,
  });

  it('shows the portal with the matrix on screen — before it is saved — and writes or sends nothing but its audit line', async () => {
    await setGrant(w.people.c1, w.projects.P1, { ...ALL, role: 'APPROVER' });
    const before = await snapshot();
    const audits = a.audited.length;
    const spec = { clientId: w.people.c1, projects: [{ projectId: w.projects.P1, role: 'VIEWER' }] };
    const home = await a.post(w.as.admin, '/clients/preview/me', spec);
    expect(home.status).toBe(200);
    expect(home.data.projects.map((p: { id: string }) => p.id)).toEqual([w.projects.P1]);
    expect(home.data.projects[0].actions).toEqual({ comment: false, signOff: false, respond: false, download: true, upload: false, notify: true });
    const task = await a.post(w.as.admin, `/clients/preview/projects/${w.projects.P1}/tasks/${w.tasks.S1}`, spec);
    expect(task.data.comments).toBeNull(); // a Viewer has no thread
    expect(task.data.can).toEqual({ comment: false, signOff: false, upload: false });
    expect(task.data.files.map((f: { id: string }) => f.id)).toEqual([uploadedId]);
    const contributor = await a.post(w.as.admin, `/clients/preview/projects/${w.projects.P1}/tasks/${w.tasks.S1}`, { ...spec, projects: [{ projectId: w.projects.P1, role: 'CONTRIBUTOR' }] });
    expect(contributor.data.comments.map((c: { body: string }) => c.body)).toContain('When will the pump arrive?');
    for (const url of [`/clients/preview/projects/${w.projects.P1}`, `/clients/preview/projects/${w.projects.P1}/meetings`, `/clients/preview/projects/${w.projects.P1}/meetings/${w.meetings.M1}`, '/clients/preview/notifications', '/clients/preview/settings']) {
      expect((await a.post(w.as.admin, url, spec)).status, url).toBe(200);
    }
    // A project not in the matrix is not there.
    expect((await a.post(w.as.admin, `/clients/preview/projects/${w.projects.P2}`, spec)).status).toBe(404);
    expect(await snapshot()).toEqual(before);
    // Its only writes are audit lines: the home, and each page of a saved client's preview.
    const lines = a.audited.slice(audits);
    expect(new Set(lines.map((e) => e.action))).toEqual(new Set(['client.preview']));
    expect(lines.map((e) => (e.newValue as { view: string }).view)).toEqual(['home', 'task', 'task', 'project', 'meetings', 'meeting', 'notifications', 'settings']); // the refused P2 page read nothing
    expect(lines[0]).toMatchObject({ module: 'clients', userId: w.people.admin, entityId: w.people.c1, newValue: { view: 'home', clientId: w.people.c1, unsaved: true } });
  });

  it('a client not saved yet: their typed name, the shared tasks, nothing of anyone else’s', async () => {
    const r = await a.post(w.as.admin, '/clients/preview/me', { firstName: 'Nadia', lastName: 'New', organisation: 'Gulf Co', projects: [{ projectId: w.projects.P1, role: 'APPROVER' }] });
    expect(r.data.me).toEqual({ name: 'Nadia New', email: '', organisation: 'Gulf Co' });
    const t = await a.post(w.as.admin, `/clients/preview/projects/${w.projects.P1}/tasks/${w.tasks.S1}`, { projects: [{ projectId: w.projects.P1, role: 'APPROVER' }] });
    expect(t.data.comments).toEqual([]);
    expect(t.body).not.toMatch(/pump arrive|ZZOTHER|ZZSTAFF/);
    const m = await a.post(w.as.admin, `/clients/preview/projects/${w.projects.P1}/meetings`, { projects: [{ projectId: w.projects.P1, role: 'APPROVER' }] });
    expect(m.data.every((x: { invited: boolean }) => !x.invited)).toBe(true);
  });

  it('administrators only; never a client; a staff account or an unknown project is refused', async () => {
    const spec = { clientId: w.people.c1 };
    expect((await a.post(w.as.omar, '/clients/preview/me', spec)).status).toBe(403);
    expect((await a.post(w.as.c1, '/clients/preview/me', spec)).status).toBe(403);
    expect((await a.post(w.as.admin, '/clients/preview/me', { clientId: w.people.omar })).status).toBe(404);
    expect((await a.post(w.as.admin, '/clients/preview/me', { projects: [{ projectId: 'no-such-project', role: 'VIEWER' }] })).status).toBe(400);
    expect((await a.post(w.as.admin, '/clients/preview/me', { clientId: w.people.c1, projects: [{ projectId: w.projects.P1, role: 'VIEWER' }], firstName: 'x'.repeat(200) })).status).toBe(400);
  });
});

describe('the leak matrix: the new routes, both ways', () => {
  it('a client session can’t reach the staff side of files, previews or the client list', async () => {
    for (const [method, url] of [
      ['GET', `/tasks/${w.tasks.S1}/attachments`],
      ['PUT', `/tasks/${w.tasks.S1}/attachments/${uploadedId}/client-visible`],
      ['POST', '/clients/preview/me'],
      ['POST', `/clients/preview/projects/${w.projects.P1}/tasks/${w.tasks.S1}`],
      ['GET', `/projects/${w.projects.P1}/clients`],
    ] as const) {
      const r = method === 'GET' ? await a.get(w.as.c1, url) : method === 'PUT' ? await a.put(w.as.c1, url, { visible: false }) : await a.post(w.as.c1, url, {});
      expect(r.status, `${method} ${url}`).toBe(403);
      expect(r.body).not.toContain('site-photo-notes');
    }
  });

  it('a staff session can’t use the portal’s files, bell or switches', async () => {
    for (const url of [`/portal/projects/${w.projects.P1}/tasks/${w.tasks.S1}/files/${uploadedId}`, '/portal/notifications', '/portal/settings/notifications']) {
      expect((await a.get(w.as.admin, url)).status, url).toBe(403);
    }
    expect((await upload(w.as.omar, w.projects.P1, w.tasks.S1)).status).toBe(403);
  });

  it('a client with no grant learns nothing from the new routes', async () => {
    for (const url of [`/portal/projects/${w.projects.P3}/tasks/${w.tasks.S3}/files/${uploadedId}`, `/portal/projects/no-such/tasks/${w.tasks.S1}/files/${uploadedId}`]) {
      const r = await a.get(w.as.c1, url);
      expect(r.status, url).toBe(404);
      expect(r.body).not.toMatch(/site-photo|P3only/);
    }
  });
});
