import type { Prisma, PrismaClient } from '@prisma/client';
import { ARCHIVE_SELECT, archivedOf } from '../companies/project-archive';
import { CLIENT_ROLE } from './client-kind';
import { canSignOff, currentAcceptance } from './sign-off';

/**
 * 1.23.7 Client notifications (owner, 7 Nov 2026: "email + a bell in the portal, the client chooses which").
 *
 * Kinds, and what each needs on the client's grant for the project (besides an active client account on a
 * live project — never anything they can't see):
 *   REPLY       a team reply marked "Visible to client" on their comment   View tasks + Comment
 *   SIGN_OFF    a shared task finished and waiting for their sign-off      View tasks + Sign off
 *   DOCUMENT    a file on a shared task shown to them ("Show to client")   View tasks
 *   MINUTES     approved minutes sent to them (their client copy)          View meetings
 *   INVITATION  a meeting invitation                                       View meetings
 * The first four need "Receive notifications" on the grant and the client's own switch for the kind (their
 * portal settings; all on until switched off). Invitations always go — part of being invited, like staff
 * (owner's call 1) — so they have no switch and don't need "Receive notifications".
 *
 * Each notice goes to the bell (client_notices) and, for REPLY / SIGN_OFF / DOCUMENT, by email here; the
 * minutes and invitation emails are sent where they always were (the meeting's own sends), and only their
 * bell line is written here.
 */
export const NOTICE_KINDS = ['REPLY', 'SIGN_OFF', 'DOCUMENT', 'MINUTES', 'INVITATION'] as const;
export type ClientNoticeKind = (typeof NOTICE_KINDS)[number];

/** The switches a client has (their portal settings). */
export const NOTICE_SWITCHES = ['reply', 'signOff', 'minutes', 'document'] as const;
export type NoticeSwitch = (typeof NOTICE_SWITCHES)[number];
export type NoticeSettings = Record<NoticeSwitch, boolean>;
export const ALL_ON: NoticeSettings = { reply: true, signOff: true, minutes: true, document: true };

export const SWITCH_OF: Readonly<Record<Exclude<ClientNoticeKind, 'INVITATION'>, NoticeSwitch>> = { REPLY: 'reply', SIGN_OFF: 'signOff', DOCUMENT: 'document', MINUTES: 'minutes' };

/** What each kind needs on the grant (the module and action, without "Receive notifications"). */
export const KIND_NEEDS: Readonly<Record<ClientNoticeKind, Prisma.ClientProjectGrantWhereInput>> = {
  REPLY: { progress: true, canComment: true },
  SIGN_OFF: { progress: true, canSignOff: true },
  DOCUMENT: { progress: true },
  MINUTES: { meetings: true },
  INVITATION: { meetings: true },
};

/**
 * Whether a kind of notice reaches a client about a project now: yes; not sent because the client turned
 * these off; not sent because the team turned notifications off for them on this project; or they have no
 * access to it (nothing is said — they can't see it).
 */
export type NoticeReach = 'yes' | 'client-off' | 'team-off' | 'no-access';

/** The words the minutes send report and log show beside a client who gets no copy (owner's call 1). */
export const NOT_SENT_WORDS = {
  'client-off': 'not sent — the client turned these off',
  'team-off': 'not sent — notifications are off for this client on this project',
} as const;

const ACTIVE_CLIENT: Prisma.UserWhereInput = { deletedAt: null, status: 'ACTIVE', roles: { some: { role: { name: CLIENT_ROLE } } } };
/** At most this many notices are kept per client (the oldest go first). */
export const MAX_NOTICES_PER_CLIENT = 300;

export interface ClientNoticeEmails {
  isConfigured(): boolean;
  sendClientReply(email: string, params: { clientName: string; projectName: string; taskKey: string; taskTitle: string; reply: string; link: string }, opts?: unknown): Promise<unknown>;
  sendClientNotice(
    email: string,
    kind: 'client-sign-off' | 'client-document',
    params: { clientName: string; projectName: string; headline: string; lead: string; item: string; buttonLabel: string; link: string; settingsLink: string },
    opts?: unknown,
  ): Promise<unknown>;
}

export interface ClientNoticesDeps {
  prisma: PrismaClient;
  /** The site's address (links in emails point into the Client portal there). */
  appUrl: string;
  email?: ClientNoticeEmails;
  /** The project's brand for its emails (its company's), when there is one. */
  emailOptions?: (projectId: string) => Promise<unknown>;
  now?: () => Date;
  logger?: { error(msg: string, ctx?: Record<string, unknown>): void };
}

export interface NewNotice {
  kind: ClientNoticeKind;
  projectId: string;
  taskId?: string | null;
  meetingId?: string | null;
  attachmentId?: string | null;
  title: string;
  body?: string | null;
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function createClientNotices(deps: ClientNoticesDeps) {
  const { prisma } = deps;
  const base = deps.appUrl.replace(/\/+$/, '');
  const portalLink = (path: string) => `${base}/portal${path}`;

  async function settingsOf(userId: string): Promise<NoticeSettings> {
    const row = await prisma.clientNoticeSettings.findUnique({ where: { userId }, select: { reply: true, signOff: true, minutes: true, document: true } });
    return row ? { reply: row.reply, signOff: row.signOff, minutes: row.minutes, document: row.document } : { ...ALL_ON };
  }

  async function setSettings(userId: string, patch: Partial<NoticeSettings>): Promise<NoticeSettings> {
    const data = Object.fromEntries(NOTICE_SWITCHES.filter((k) => typeof patch[k] === 'boolean').map((k) => [k, patch[k]])) as Partial<NoticeSettings>;
    await prisma.clientNoticeSettings.upsert({ where: { userId }, create: { userId, ...ALL_ON, ...data }, update: data });
    return settingsOf(userId);
  }

  /** The client's grant on a live project, when they are an active client (null otherwise). */
  async function liveGrant(userId: string, projectId: string) {
    const g = await prisma.clientProjectGrant.findFirst({
      where: { userId, projectId, user: ACTIVE_CLIENT, project: { deletedAt: null } },
      select: { progress: true, meetings: true, canComment: true, canSignOff: true, canNotify: true, project: { select: ARCHIVE_SELECT } },
    });
    return g && !archivedOf(g.project) ? g : null;
  }

  /** Does this kind of notice reach this client about this project now (see NoticeReach)? */
  async function reach(kind: ClientNoticeKind, userId: string, projectId: string): Promise<NoticeReach> {
    const g = await liveGrant(userId, projectId);
    if (!g) return 'no-access';
    const needs = KIND_NEEDS[kind] as Record<string, boolean>;
    if (Object.entries(needs).some(([k, v]) => (g as Record<string, unknown>)[k] !== v)) return 'no-access';
    if (kind === 'INVITATION') return 'yes';
    if (!g.canNotify) return 'team-off';
    return (await settingsOf(userId))[SWITCH_OF[kind]] ? 'yes' : 'client-off';
  }

  /** The clients of a project this kind reaches now (a live project, active clients, the grant, their switch). */
  async function recipients(kind: ClientNoticeKind, projectId: string): Promise<{ id: string; email: string; name: string }[]> {
    const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: ARCHIVE_SELECT });
    if (!project || archivedOf(project)) return [];
    const rows = await prisma.clientProjectGrant.findMany({
      where: { projectId, ...KIND_NEEDS[kind], ...(kind === 'INVITATION' ? {} : { canNotify: true }), user: ACTIVE_CLIENT },
      select: { user: { select: { id: true, email: true, firstName: true, username: true, clientNoticeSettings: { select: { reply: true, signOff: true, minutes: true, document: true } } } } },
      take: 500,
    });
    return rows
      .filter((r) => kind === 'INVITATION' || (r.user.clientNoticeSettings ?? ALL_ON)[SWITCH_OF[kind]])
      .map((r) => ({ id: r.user.id, email: r.user.email, name: r.user.firstName || r.user.username }));
  }

  /** Write bell lines (best effort is the caller's: this throws on a database error). */
  async function add(userIds: readonly string[], n: NewNotice): Promise<void> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return;
    await prisma.clientNotice.createMany({
      data: ids.map((userId) => ({
        userId,
        kind: n.kind,
        projectId: n.projectId,
        taskId: n.taskId ?? null,
        meetingId: n.meetingId ?? null,
        attachmentId: n.attachmentId ?? null,
        title: cut(n.title, 191),
        body: n.body ? cut(n.body, 500) : null,
      })),
    });
    // Keep each bell short: the oldest beyond the limit go.
    for (const userId of ids) {
      const old = await prisma.clientNotice.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: MAX_NOTICES_PER_CLIENT, select: { id: true }, take: 100 });
      if (old.length) await prisma.clientNotice.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    }
  }

  const fail = (what: string, err: unknown, ctx: Record<string, unknown>) => deps.logger?.error(`client notices: ${what} failed`, { err, ...ctx });
  const emailOptions = async (projectId: string) => (deps.emailOptions ? await deps.emailOptions(projectId).catch(() => undefined) : undefined);

  /** A shared task as the notices name it (null when it isn't shared any more). */
  async function sharedTask(taskId: string) {
    return prisma.task.findFirst({
      where: { id: taskId, deletedAt: null, clientVisible: true },
      select: { id: true, key: true, title: true, projectId: true, completedAt: true, approvalRequestedAt: true, clientAcceptedAt: true, column: { select: { category: true } }, project: { select: { name: true } } },
    });
  }

  return {
    settingsOf,
    setSettings,
    reach,
    recipients,
    add,

    /**
     * A team reply marked "Visible to client" on a client's comment: the bell and an email to the client whose
     * comment it answers — while they may see the thread (View tasks + Comment), "Receive notifications" is on
     * and they haven't switched replies off.
     */
    async taskReply(reply: { id: string; taskId: string; parentId: string | null; body: string }): Promise<void> {
      try {
        if (!reply.parentId) return;
        const parent = await prisma.comment.findFirst({ where: { id: reply.parentId, fromClient: true, deletedAt: null }, select: { userId: true } });
        const task = await sharedTask(reply.taskId);
        if (!parent || !task) return;
        if ((await reach('REPLY', parent.userId, task.projectId)) !== 'yes') return;
        const item = `${task.key} ${task.title}`.trim();
        await add([parent.userId], { kind: 'REPLY', projectId: task.projectId, taskId: task.id, title: `The project team replied to your comment on ${item}`, body: reply.body });
        if (!deps.email?.isConfigured()) return;
        const client = await prisma.user.findUnique({ where: { id: parent.userId }, select: { email: true, firstName: true, username: true } });
        if (!client?.email) return;
        await deps.email.sendClientReply(
          client.email,
          { clientName: client.firstName || client.username, projectName: task.project.name, taskKey: task.key, taskTitle: task.title, reply: reply.body, link: portalLink(`/projects/${task.projectId}/tasks/${task.id}`) },
          await emailOptions(task.projectId),
        );
      } catch (err) {
        fail('a reply notice', err, { commentId: reply.id });
      }
    },

    /**
     * A shared task now finished and waiting for sign-off (in a Done column, not waiting for the team's own
     * approval, not accepted yet): the bell and an email to each client who may sign it off.
     */
    async signOffReady(taskId: string): Promise<void> {
      try {
        const t = await sharedTask(taskId);
        if (!t) return;
        const src = { columnCategory: t.column?.category ?? null, completedAt: t.completedAt, approvalRequestedAt: t.approvalRequestedAt, clientAcceptedAt: t.clientAcceptedAt };
        if (!canSignOff(src) || currentAcceptance(src)) return;
        const people = await recipients('SIGN_OFF', t.projectId);
        if (people.length === 0) return;
        const item = `${t.key} ${t.title}`.trim();
        await add(people.map((p) => p.id), { kind: 'SIGN_OFF', projectId: t.projectId, taskId: t.id, title: `Ready for your sign-off: ${item}`, body: null });
        if (!deps.email?.isConfigured()) return;
        const opts = await emailOptions(t.projectId);
        for (const p of people) {
          await deps.email
            .sendClientNotice(
              p.email,
              'client-sign-off',
              { clientName: p.name, projectName: t.project.name, headline: 'Ready for your sign-off', lead: 'the project team has finished a task and asks you to sign it off (Accept, or Send back with a reason):', item, buttonLabel: 'Open the task', link: portalLink(`/projects/${t.projectId}/tasks/${t.id}`), settingsLink: portalLink('/settings') },
              opts,
            )
            .catch((err) => fail('a sign-off email', err, { taskId }));
        }
      } catch (err) {
        fail('a sign-off notice', err, { taskId });
      }
    },

    /**
     * A file on a shared task was shown to clients ("Show to client"): the bell and an email to each client
     * of the project who may view tasks — not the client who uploaded it (it was already theirs).
     */
    async documentShown(attachmentId: string): Promise<void> {
      try {
        const f = await prisma.attachment.findFirst({ where: { id: attachmentId, clientVisible: true }, select: { id: true, filename: true, taskId: true, uploadedById: true, fromClient: true } });
        if (!f) return;
        const t = await sharedTask(f.taskId);
        if (!t) return;
        const people = (await recipients('DOCUMENT', t.projectId)).filter((p) => !(f.fromClient && p.id === f.uploadedById));
        if (people.length === 0) return;
        const item = `${t.key} ${t.title}`.trim();
        await add(people.map((p) => p.id), { kind: 'DOCUMENT', projectId: t.projectId, taskId: t.id, attachmentId: f.id, title: `New document on ${item}`, body: f.filename });
        if (!deps.email?.isConfigured()) return;
        const opts = await emailOptions(t.projectId);
        for (const p of people) {
          await deps.email
            .sendClientNotice(
              p.email,
              'client-document',
              { clientName: p.name, projectName: t.project.name, headline: 'New document', lead: `the project team shared a document with you on ${item}:`, item: f.filename, buttonLabel: 'Open the task', link: portalLink(`/projects/${t.projectId}/tasks/${t.id}`), settingsLink: portalLink('/settings') },
              opts,
            )
            .catch((err) => fail('a document email', err, { attachmentId }));
        }
      } catch (err) {
        fail('a document notice', err, { attachmentId });
      }
    },

    /**
     * Why a client who may have a meeting's approved minutes gets no copy: they switched minutes off, or the
     * team turned notifications off on their grant (the send report and log show it); null: they get it.
     */
    async minutesNotSent(meetingId: string, userId: string): Promise<string | null> {
      const m = await prisma.meeting.findFirst({ where: { id: meetingId, deletedAt: null }, select: { projectId: true } });
      if (!m?.projectId) return null;
      const r = await reach('MINUTES', userId, m.projectId);
      return r === 'client-off' || r === 'team-off' ? NOT_SENT_WORDS[r] : null;
    },

    /** Their client copy of approved minutes was emailed to them: its bell line (the email itself went). */
    async minutesSent(meetingId: string, userId: string): Promise<void> {
      try {
        const m = await prisma.meeting.findFirst({ where: { id: meetingId, deletedAt: null }, select: { id: true, title: true, projectId: true } });
        if (!m?.projectId || (await reach('MINUTES', userId, m.projectId)) !== 'yes') return;
        await add([userId], { kind: 'MINUTES', projectId: m.projectId, meetingId: m.id, title: `Minutes of ${m.title}`, body: null });
      } catch (err) {
        fail('a minutes notice', err, { meetingId });
      }
    },

    /** Invitations went out: a bell line for each client among them who may see the meeting's project meetings. */
    async invited(meetingId: string, userIds: readonly string[]): Promise<void> {
      try {
        if (userIds.length === 0) return;
        const m = await prisma.meeting.findFirst({ where: { id: meetingId, deletedAt: null, status: { not: 'DRAFT' } }, select: { id: true, title: true, projectId: true } });
        if (!m?.projectId) return;
        const clients = (await recipients('INVITATION', m.projectId)).filter((p) => userIds.includes(p.id));
        await add(clients.map((c) => c.id), { kind: 'INVITATION', projectId: m.projectId, meetingId: m.id, title: `You’re invited: ${m.title}`, body: null });
      } catch (err) {
        fail('an invitation notice', err, { meetingId });
      }
    },
  };
}

export type ClientNotices = ReturnType<typeof createClientNotices>;
