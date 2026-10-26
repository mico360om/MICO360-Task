import { describe, it, expect, beforeEach } from 'vitest';
import { createClientAccessService, type ClientAccessService, type ClientMailer } from './client-access-service';
import { createMemoryClientShareStore, type ClientShareStore } from './client-share-store';
import { createMemoryClientViewSource, type MemoryClientViewSource } from './memory-client-view-source';
import { ClientCodeInvalidError, ClientLinkEndedError, ClientSignInRequiredError } from './client-view-errors';
import { hashToken } from './client-tokens';
import { inspectPdf } from '../../lib/pdf-inspect';
import type { ClientCodeParams, ClientInvitationParams } from '../email/email-templates';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const LINK_OF = /\/client\/([A-Za-z0-9_-]{43})$/;

let clock: number;
let store: ClientShareStore;
let source: MemoryClientViewSource;
let invitations: { email: string; params: ClientInvitationParams }[];
let codes: { email: string; params: ClientCodeParams }[];
let audited: { userId?: string | null; action: string; entityId?: string | null; newValue?: unknown }[];
let pending: Promise<void>[];
let mail: { configured: boolean; blocked: Set<string>; failInvites: boolean };
let svc: ClientAccessService;

function makeService() {
  const mailer: ClientMailer = {
    isConfigured: () => mail.configured,
    async sendClientInvitation(email, params) {
      if (mail.failInvites) throw new Error('provider down');
      if (mail.blocked.has(email)) return 'suppressed';
      invitations.push({ email, params });
      return 'sent';
    },
    async sendClientCode(email, params) {
      codes.push({ email, params });
    },
  };
  return createClientAccessService({
    store,
    source,
    mailer,
    userName: async (id) => (id === 'u-omar' ? 'Omar Ahmed' : null),
    appUrl: 'https://task.mico360.test/',
    assetUrl: 'https://task.mico360.test',
    timeZone: 'Asia/Muscat',
    audit: { record: async (e) => void audited.push(e) },
    now: () => new Date(clock),
    runInBackground: (task) => void pending.push(task()),
  });
}

const settle = async () => {
  while (pending.length) await Promise.all(pending.splice(0));
};
const lastLink = () => LINK_OF.exec(invitations[invitations.length - 1]!.params.link)![1]!;
const lastCode = () => codes[codes.length - 1]!.params.code;

/** Shares project P1 with Fatma and returns her link. */
async function shareWithFatma(email = 'Fatma@Client.example ') {
  await svc.share({ projectId: 'p1', name: ' Fatma Al Harthy ', email, actorId: 'u-omar', ip: '10.0.0.1' });
  return lastLink();
}

/** Signs Fatma in through the link; returns the session token. */
async function signIn(link: string, email = 'fatma@client.example') {
  await svc.requestCode(link, email, { ip: '1.2.3.4' });
  await settle();
  return (await svc.verifyCode(link, email, lastCode(), { ip: '1.2.3.4' })).token;
}

const sessionOf = (token: string) => () => token;
const noSession = () => null;

beforeEach(() => {
  clock = Date.parse('2026-10-26T08:00:00Z');
  store = createMemoryClientShareStore(() => new Date(clock));
  source = createMemoryClientViewSource();
  source.addProject('p1', { name: 'Rig 7 Inspection', code: 'RIG', number: 'OD-2231', clientName: 'Oman Drilling Co.', status: 'ACTIVE', color: '#1E6B8B', icon: null, imageUrl: '/uploads/p/rig.png', startDate: null, targetDate: null });
  source.addProject('p2', { name: 'Secret Other Project', code: 'SOP', number: null, clientName: null, status: 'ACTIVE', color: '#000000', icon: null, imageUrl: null, startDate: null, targetDate: null });
  invitations = [];
  codes = [];
  audited = [];
  pending = [];
  mail = { configured: true, blocked: new Set(), failInvites: false };
  svc = makeService();
});

describe('sharing a project with a client (staff side)', () => {
  it('keeps the client (address trimmed, lower case) and emails them a private link from the person sharing', async () => {
    const summary = await svc.share({ projectId: 'p1', name: ' Fatma Al Harthy ', email: ' Fatma@Client.EXAMPLE ', actorId: 'u-omar', ip: '10.0.0.1' });
    expect(summary).toEqual({ id: expect.any(String), name: 'Fatma Al Harthy', email: 'fatma@client.example', createdAt: new Date(clock), linkSentAt: new Date(clock), lastViewedAt: null });
    expect(invitations).toHaveLength(1);
    const { email, params } = invitations[0]!;
    expect(email).toBe('fatma@client.example');
    expect(params).toMatchObject({
      clientName: 'Fatma Al Harthy',
      sharedByName: 'Omar Ahmed',
      projectName: 'Rig 7 Inspection',
      projectDetails: ['RIG', 'Oman Drilling Co.'],
      projectImageUrl: 'https://task.mico360.test/uploads/p/rig.png',
      email: 'fatma@client.example',
    });
    expect(params.link).toMatch(/^https:\/\/task\.mico360\.test\/client\/[A-Za-z0-9_-]{43}$/);
    // Only the link's hash is kept.
    const kept = (await store.listForProject('p1'))[0]!;
    expect(kept.linkHash).toBe(hashToken(lastLink()));
    expect(JSON.stringify(summary)).not.toContain(kept.linkHash);
    expect(audited).toEqual([{ userId: 'u-omar', ip: '10.0.0.1', module: 'client-view', action: 'client-view.share.add', entityId: summary.id, newValue: { projectId: 'p1', name: 'Fatma Al Harthy', email: 'fatma@client.example' } }]);
  });

  it('refuses a second share with the same address (any case)', async () => {
    await shareWithFatma();
    await expect(svc.share({ projectId: 'p1', name: 'F', email: 'FATMA@client.example', actorId: 'u-omar' })).rejects.toMatchObject({ status: 409, code: 'CLIENT_ALREADY_SHARED' });
  });

  it('refuses an archived or deleted project', async () => {
    source.setStatus('p1', 'ARCHIVED');
    await expect(svc.share({ projectId: 'p1', name: 'F', email: 'f@x.example', actorId: 'u-omar' })).rejects.toMatchObject({ status: 409, code: 'PROJECT_ARCHIVED' });
    source.setGone('p2');
    await expect(svc.share({ projectId: 'p2', name: 'F', email: 'f@x.example', actorId: 'u-omar' })).rejects.toMatchObject({ status: 404 });
    expect(invitations).toHaveLength(0);
  });

  it('keeps nothing when the invitation can’t be sent (or the address is blocked), and says so', async () => {
    mail.failInvites = true;
    await expect(svc.share({ projectId: 'p1', name: 'F', email: 'f@x.example', actorId: 'u-omar' })).rejects.toMatchObject({ status: 502, code: 'EMAIL_FAILED' });
    expect(await store.listForProject('p1')).toEqual([]);
    mail.failInvites = false;
    mail.blocked.add('f@x.example');
    await expect(svc.share({ projectId: 'p1', name: 'F', email: 'f@x.example', actorId: 'u-omar' })).rejects.toMatchObject({ status: 409, code: 'EMAIL_BLOCKED' });
    expect(await store.listForProject('p1')).toEqual([]);
    expect(audited).toEqual([]);
  });

  it('can’t share while email is off: the client could never get a code', async () => {
    mail.configured = false;
    await expect(svc.share({ projectId: 'p1', name: 'F', email: 'f@x.example', actorId: 'u-omar' })).rejects.toMatchObject({ status: 503, code: 'EMAIL_NOT_CONFIGURED' });
    expect(await store.listForProject('p1')).toEqual([]);
  });

  it('lists the project’s clients with when they last viewed it (never their link)', async () => {
    const link = await shareWithFatma();
    const token = await signIn(link);
    clock += 5 * MIN;
    await svc.view(link, sessionOf(token));
    const [row] = await svc.listShares('p1');
    expect(row).toEqual({ id: expect.any(String), name: 'Fatma Al Harthy', email: 'fatma@client.example', createdAt: expect.any(Date), linkSentAt: expect.any(Date), lastViewedAt: new Date(clock) });
    expect(await svc.listShares('p2')).toEqual([]);
  });
});

describe('a client opens the link and enters the emailed code', () => {
  it('emails a 6-digit code (valid 10 minutes) to the shared address, whatever case it was typed in', async () => {
    const link = await shareWithFatma();
    expect(await svc.requestCode(link, '  FATMA@client.example ', { ip: '1.2.3.4' })).toEqual({ sent: true });
    await settle();
    expect(codes).toHaveLength(1);
    expect(codes[0]).toEqual({ email: 'fatma@client.example', params: { code: expect.stringMatching(/^\d{6}$/), projectName: 'Rig 7 Inspection', expiresInMinutes: 10 } });
  });

  it('a forwarded link typed with another address sends nothing, and answers exactly the same', async () => {
    const link = await shareWithFatma();
    expect(await svc.requestCode(link, 'someone.else@client.example', { ip: '1.2.3.4' })).toEqual({ sent: true });
    await settle();
    expect(codes).toEqual([]);
  });

  it('codes are kept only as a hash', async () => {
    const link = await shareWithFatma();
    await svc.requestCode(link, 'fatma@client.example', {});
    await settle();
    const share = (await store.listForProject('p1'))[0]!;
    const stored = (await store.latestOpenCode(share.id))!;
    expect(stored.codeHash).not.toContain(lastCode());
    expect(stored.codeHash.length).toBeGreaterThan(20);
  });

  it('sends at most one code a minute and five an hour to an address (the rest are quietly dropped)', async () => {
    const link = await shareWithFatma();
    await svc.requestCode(link, 'fatma@client.example', {});
    await svc.requestCode(link, 'fatma@client.example', {});
    await settle();
    expect(codes).toHaveLength(1);
    for (let i = 0; i < 6; i++) {
      clock += MIN + 1;
      await svc.requestCode(link, 'fatma@client.example', {});
      await settle();
    }
    expect(codes).toHaveLength(5);
  });

  it('the right address and the newest code sign the device in (an audit line, no staff account)', async () => {
    const link = await shareWithFatma();
    await svc.requestCode(link, 'fatma@client.example', {});
    await settle();
    const res = await svc.verifyCode(link, ' Fatma@client.example', lastCode(), { ip: '1.2.3.4' });
    expect(res.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.maxAgeSeconds).toBe(30 * 24 * 3600);
    const share = (await store.listForProject('p1'))[0]!;
    expect(res.shareId).toBe(share.id);
    expect(await store.findSession(hashToken(res.token))).toEqual({ shareId: share.id, expiresAt: new Date(clock + 30 * DAY) });
    expect(audited.at(-1)).toEqual({ userId: null, ip: '1.2.3.4', module: 'client-view', action: 'client-view.sign-in', entityId: share.id, newValue: { projectId: 'p1', email: 'fatma@client.example' } });
  });

  it('a code works once', async () => {
    const link = await shareWithFatma();
    await signIn(link);
    await expect(svc.verifyCode(link, 'fatma@client.example', lastCode(), {})).rejects.toBeInstanceOf(ClientCodeInvalidError);
  });

  it('the wrong address never signs in, even with the right code — and doesn’t use up the client’s tries', async () => {
    const link = await shareWithFatma();
    await svc.requestCode(link, 'fatma@client.example', {});
    await settle();
    for (let i = 0; i < 8; i++) await expect(svc.verifyCode(link, 'eve@attacker.example', lastCode(), {})).rejects.toBeInstanceOf(ClientCodeInvalidError);
    await expect(svc.verifyCode(link, 'fatma@client.example', lastCode(), {})).resolves.toMatchObject({ token: expect.any(String) });
  });

  it('five wrong tries end the code: the right one then fails too', async () => {
    const link = await shareWithFatma();
    await svc.requestCode(link, 'fatma@client.example', {});
    await settle();
    const right = lastCode();
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await expect(svc.verifyCode(link, 'fatma@client.example', wrong, {})).rejects.toBeInstanceOf(ClientCodeInvalidError);
    await expect(svc.verifyCode(link, 'fatma@client.example', right, {})).rejects.toBeInstanceOf(ClientCodeInvalidError);
  });

  it('a code expires after 10 minutes', async () => {
    const link = await shareWithFatma();
    await svc.requestCode(link, 'fatma@client.example', {});
    await settle();
    clock += 10 * MIN;
    await expect(svc.verifyCode(link, 'fatma@client.example', lastCode(), {})).rejects.toBeInstanceOf(ClientCodeInvalidError);
  });

  it('caps wrong tries per client across new codes (15 an hour)', async () => {
    const link = await shareWithFatma();
    for (let round = 0; round < 3; round++) {
      clock += MIN + 1;
      await svc.requestCode(link, 'fatma@client.example', {});
      await settle();
      const wrong = lastCode() === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) await expect(svc.verifyCode(link, 'fatma@client.example', wrong, {})).rejects.toBeInstanceOf(ClientCodeInvalidError);
    }
    clock += MIN + 1;
    await svc.requestCode(link, 'fatma@client.example', {});
    await settle();
    await expect(svc.verifyCode(link, 'fatma@client.example', lastCode(), {})).rejects.toBeInstanceOf(ClientCodeInvalidError);
  });

  it('every refusal reads the same, so nobody learns whether an address is on the list', async () => {
    const link = await shareWithFatma();
    await svc.requestCode(link, 'fatma@client.example', {});
    await settle();
    const refusals: unknown[] = [];
    const attempt = (email: string, code: string) => svc.verifyCode(link, email, code, {}).catch((e: unknown) => refusals.push(e));
    await attempt('nobody@client.example', '123456'); // not on the list
    await attempt('fatma@client.example', lastCode() === '000000' ? '111111' : '000000'); // wrong code
    clock += 11 * MIN;
    await attempt('fatma@client.example', lastCode()); // expired
    const shapes = refusals.map((e) => {
      const err = e as ClientCodeInvalidError;
      return [err.status, err.code, err.message];
    });
    expect(shapes).toHaveLength(3);
    expect(new Set(shapes.map((s) => JSON.stringify(s))).size).toBe(1);
    expect(shapes[0]![1]).toBe('CLIENT_CODE_INVALID');
  });

  it('can’t send codes while email is off', async () => {
    const link = await shareWithFatma();
    mail.configured = false;
    await expect(svc.requestCode(link, 'fatma@client.example', {})).rejects.toMatchObject({ status: 503, code: 'EMAIL_NOT_CONFIGURED' });
  });
});

describe('the page itself', () => {
  beforeEach(() => {
    source.addTask('p1', { title: 'Site survey', isMilestone: true, clientVisible: true, columnCategory: 'DONE', completedAt: null, dueDate: null });
    source.addTask('p1', { title: 'Unmarked internal task', isMilestone: false, clientVisible: false, columnCategory: 'TODO', completedAt: null, dueDate: null });
    source.addTask('p2', { title: 'Other project task', isMilestone: false, clientVisible: true, columnCategory: 'TODO', completedAt: null, dueDate: null });
  });

  it('needs a signed-in device: the link alone opens nothing', async () => {
    const link = await shareWithFatma();
    await expect(svc.view(link, noSession)).rejects.toBeInstanceOf(ClientSignInRequiredError);
    await expect(svc.view(link, () => 'x'.repeat(43))).rejects.toBeInstanceOf(ClientSignInRequiredError);
  });

  it('shows that project’s marked items, and nothing of another project', async () => {
    const link = await shareWithFatma();
    const view = await svc.view(link, sessionOf(await signIn(link)));
    expect(view.project.name).toBe('Rig 7 Inspection');
    expect(view.milestones.map((m) => m.title)).toEqual(['Site survey']);
    const json = JSON.stringify(view);
    expect(json).not.toContain('Unmarked internal task');
    expect(json).not.toContain('Other project');
    expect(json).not.toContain('Secret Other Project');
    expect(view.progress.percentDone).toBe(50);
  });

  it('a session opens only its own client’s page: another project’s link with it is refused', async () => {
    const link = await shareWithFatma();
    const token = await signIn(link);
    await svc.share({ projectId: 'p2', name: 'Eve', email: 'eve@client.example', actorId: 'u-omar' });
    const otherLink = lastLink();
    await expect(svc.view(otherLink, sessionOf(token))).rejects.toBeInstanceOf(ClientSignInRequiredError);
  });

  it('stays signed in for 30 days, then asks for a code again', async () => {
    const link = await shareWithFatma();
    const token = await signIn(link);
    clock += 30 * DAY - MIN;
    await expect(svc.view(link, sessionOf(token))).resolves.toBeTruthy();
    clock += 2 * MIN;
    await expect(svc.view(link, sessionOf(token))).rejects.toBeInstanceOf(ClientSignInRequiredError);
  });

  it('Remove ends every session at once, and the link with them', async () => {
    const link = await shareWithFatma();
    const token = await signIn(link);
    const share = (await store.listForProject('p1'))[0]!;
    await svc.remove({ projectId: 'p1', shareId: share.id, actorId: 'u-omar', ip: '10.0.0.1' });
    await expect(svc.view(link, sessionOf(token))).rejects.toBeInstanceOf(ClientLinkEndedError);
    await expect(svc.requestCode(link, 'fatma@client.example', {})).rejects.toBeInstanceOf(ClientLinkEndedError);
    expect(await store.findSession(hashToken(token))).toBeNull();
    expect(audited.at(-1)).toMatchObject({ userId: 'u-omar', action: 'client-view.share.remove', entityId: share.id, newValue: { projectId: 'p1', email: 'fatma@client.example' } });
  });

  it('a share is removed only through its own project', async () => {
    await shareWithFatma();
    const share = (await store.listForProject('p1'))[0]!;
    await expect(svc.remove({ projectId: 'p2', shareId: share.id, actorId: 'u-omar' })).rejects.toMatchObject({ status: 404 });
    expect(await store.findById(share.id)).not.toBeNull();
  });

  it('Resend: a new link works; the old link and its code stop working; a signed-in device stays signed in', async () => {
    const oldLink = await shareWithFatma();
    const token = await signIn(oldLink);
    clock += 2 * MIN;
    await svc.requestCode(oldLink, 'fatma@client.example', {});
    await settle();
    const oldCode = lastCode();
    const share = (await store.listForProject('p1'))[0]!;
    await svc.resend({ projectId: 'p1', shareId: share.id, actorId: 'u-omar', ip: '10.0.0.1' });
    const newLink = lastLink();
    expect(newLink).not.toBe(oldLink);
    await expect(svc.view(oldLink, sessionOf(token))).rejects.toBeInstanceOf(ClientLinkEndedError);
    await expect(svc.verifyCode(oldLink, 'fatma@client.example', oldCode, {})).rejects.toBeInstanceOf(ClientLinkEndedError);
    await expect(svc.view(newLink, sessionOf(token))).resolves.toBeTruthy();
    expect(audited.at(-1)).toMatchObject({ userId: 'u-omar', action: 'client-view.share.resend', entityId: share.id });
  });

  it('a Resend whose email fails keeps the old link working', async () => {
    const oldLink = await shareWithFatma();
    const share = (await store.listForProject('p1'))[0]!;
    mail.failInvites = true;
    await expect(svc.resend({ projectId: 'p1', shareId: share.id, actorId: 'u-omar' })).rejects.toMatchObject({ status: 502 });
    await expect(svc.requestCode(oldLink, 'fatma@client.example', {})).resolves.toEqual({ sent: true });
  });

  it('an archived or deleted project reads as no longer shared', async () => {
    const link = await shareWithFatma();
    const token = await signIn(link);
    source.setStatus('p1', 'ARCHIVED');
    await expect(svc.view(link, sessionOf(token))).rejects.toBeInstanceOf(ClientLinkEndedError);
    source.setStatus('p1', 'ACTIVE');
    source.setGone('p1');
    await expect(svc.view(link, sessionOf(token))).rejects.toBeInstanceOf(ClientLinkEndedError);
  });

  it('an unknown or malformed link reads as ended', async () => {
    await expect(svc.view('A'.repeat(43), noSession)).rejects.toBeInstanceOf(ClientLinkEndedError);
    await expect(svc.requestCode('../../etc', 'x@y.example', {})).rejects.toBeInstanceOf(ClientLinkEndedError);
  });

  it('signing out ends that device’s session', async () => {
    const link = await shareWithFatma();
    const token = await signIn(link);
    await svc.signOut(link, sessionOf(token));
    await expect(svc.view(link, sessionOf(token))).rejects.toBeInstanceOf(ClientSignInRequiredError);
  });
});

describe('the minutes PDF a client downloads', () => {
  const content = { summary: 'Agreed the plan.', discussion: [], decisions: ['Go ahead'], risks: [], nextSteps: [] };
  beforeEach(() => {
    const base = { title: 'Kick-off', startAt: new Date('2026-10-05T06:00:00Z'), timeZone: 'Asia/Muscat', status: 'APPROVED' as const, clientVisible: true, approvedAt: new Date('2026-10-06T06:00:00Z'), content };
    source.addMinutes('p1', { ...base, meetingId: 'm-shown' });
    source.addMinutes('p1', { ...base, meetingId: 'm-hidden', title: 'Hidden', clientVisible: false });
    source.addMinutes('p2', { ...base, meetingId: 'm-other', title: 'Other' });
  });

  it('is the client copy of a shown meeting’s approved minutes', async () => {
    const link = await shareWithFatma();
    const { pdf, fileName } = await svc.minutesPdf(link, sessionOf(await signIn(link)), 'm-shown');
    expect(fileName).toBe('minutes-kick-off.pdf');
    const text = inspectPdf(pdf).pages.flat().join('\n');
    expect(text).toContain('Agreed the plan.');
    expect(text).not.toMatch(/Approved by|Organizer|Attendees/);
  });

  it('isn’t there for minutes not shown, or of another project, and needs a session', async () => {
    const link = await shareWithFatma();
    const token = await signIn(link);
    for (const id of ['m-hidden', 'm-other', 'nope']) await expect(svc.minutesPdf(link, sessionOf(token), id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.minutesPdf(link, noSession, 'm-shown')).rejects.toBeInstanceOf(ClientSignInRequiredError);
  });
});
