import { generateOtpCode, hashOtp, verifyOtp } from '../../lib/otp';
import { ConflictError, HttpError, NotFoundError } from '../../lib/http-errors';
import { resolveBrand } from '../email/brand';
import type { CreateAuditData } from '../audit/audit-repository';
import type { ClientCodeParams, ClientInvitationParams } from '../email/email-templates';
import { ClientShareExistsError, type ClientShareRecord, type ClientShareStore } from './client-share-store';
import type { ClientViewSource } from './client-view-source';
import { buildClientView, type ClientProjectSource, type ClientView } from './client-view-payload';
import { buildClientMinutesPdf } from './client-minutes-pdf';
import type { ClientInspection, ClientInspectionSummary } from '../inspections/inspection-client-copy';
import { buildInspectionPdf, inspectionPdfFileName, reportBrand } from '../inspections/inspection-report-pdf';
import { clientMinutesContent } from './client-minutes-content';
import { hashToken, isWellFormedToken, newToken, normalizeEmail, sameText } from './client-tokens';
import { ClientCodeInvalidError, ClientEmailUnavailableError, ClientLinkEndedError, ClientSignInRequiredError } from './client-view-errors';

/**
 * Client view: a project's owner, managers and admins share it with a client by name and email.
 * The client gets a private link; the link opens the page only with a one-time code emailed to that
 * address, and the device then stays signed in to that one page for 30 days. Nothing here is a
 * staff account or session: the codes, sessions and links are this module's own, and they open
 * this project's client page and nothing else. Removing a client ends their sessions at once;
 * Resend replaces the link (the old link and its code stop working).
 *
 * Who may share, remove and resend is checked by the routes (the project's runners and admins).
 */
export const CLIENT_ACCESS_LIMITS = {
  codeLength: 6,
  codeTtlMinutes: 10,
  triesPerCode: 5,
  codesPerMinute: 1,
  codesPerHour: 5,
  /** Wrong tries per client per hour across every code (asking for new codes doesn't reset it). */
  failuresPerHour: 15,
  sessionDays: 30,
  /** Signed-in devices kept per client (the oldest beyond this are signed out). */
  sessionsPerClient: 20,
};
export type ClientAccessLimits = typeof CLIENT_ACCESS_LIMITS;

export interface ClientMailer {
  isConfigured(): boolean;
  /** 'suppressed': the address is blocked (it bounced or was marked as spam), nothing was sent. */
  sendClientInvitation(email: string, params: ClientInvitationParams): Promise<'sent' | 'suppressed'>;
  sendClientCode(email: string, params: ClientCodeParams): Promise<void>;
}

export interface ClientAccessDeps {
  store: ClientShareStore;
  source: ClientViewSource;
  mailer: ClientMailer;
  /** The name of the staff member sharing ("{who} shared the project …"). */
  userName: (userId: string) => Promise<string | null>;
  /** The web app's address: links are `${appUrl}/client/<token>`. */
  appUrl: string;
  /** Where uploads are served (the project's picture in the invitation). */
  assetUrl: string;
  /** The company time zone (today, due days). */
  timeZone: string;
  audit?: { record(entry: CreateAuditData): Promise<unknown> };
  /** A project picture's bytes in a form the PDF can print (null: its icon or initials are drawn). */
  projectImage?: (imageUrl: string) => Promise<Buffer | null>;
  now?: () => Date;
  /** Issues and emails a code off the request path, so every address answers alike. */
  runInBackground?: (task: () => Promise<void>) => void;
  logger?: { warn(msg: string, ctx?: Record<string, unknown>): void };
  limits?: Partial<ClientAccessLimits>;
  /** Finished inspection reports marked "Show to client" (the inspections module decides which). */
  inspections?: {
    /** Summaries (the page's list). */
    list(projectId: string): Promise<ClientInspectionSummary[]>;
    /** One report with its items and signatures (opened on the page, and its PDF). */
    one(projectId: string, inspectionId: string): Promise<ClientInspection | null>;
  };
}

/** A client on the Share with client panel (never their link). */
export interface ShareSummary {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  linkSentAt: Date | null;
  lastViewedAt: Date | null;
}

/** Reads the session token a request carries for a share (its cookie), or null. */
export type SessionReader = (shareId: string) => string | null;

interface Meta {
  ip?: string | null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const summary = (s: ClientShareRecord): ShareSummary => ({ id: s.id, name: s.name, email: s.email, createdAt: s.createdAt, linkSentAt: s.linkSentAt, lastViewedAt: s.lastViewedAt });

function slugify(title: string): string {
  const s = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return s || 'meeting';
}

// Compared against when there is no code to compare with, so a refusal takes as long either way.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashOtp(generateOtpCode(8)));

export function createClientAccessService(deps: ClientAccessDeps) {
  const { store, source, mailer } = deps;
  const limits = { ...CLIENT_ACCESS_LIMITS, ...deps.limits };
  const now = deps.now ?? (() => new Date());
  const appUrl = deps.appUrl.replace(/\/+$/, '');
  const assetUrl = deps.assetUrl.replace(/\/+$/, '');
  const runInBackground =
    deps.runInBackground ??
    ((task: () => Promise<void>) => {
      void task().catch((err) => deps.logger?.warn('client view: a code could not be sent', { err }));
    });
  // Shares with a code being issued right now: a burst of requests is throttled here, before the
  // database count (which can't see a code that hasn't been stored yet).
  const issuing = new Set<string>();

  async function audit(entry: Omit<CreateAuditData, 'module'>): Promise<void> {
    try {
      await deps.audit?.record({ module: 'client-view', ...entry });
    } catch (err) {
      deps.logger?.warn('client view: the audit line could not be written', { err, action: entry.action });
    }
  }

  const picture = (url: string | null) => (!url ? null : /^https?:\/\//i.test(url) ? url : url.startsWith('/') ? `${assetUrl}${url}` : null);

  /** A project that may still be shown to its clients: there, not deleted, not archived. */
  async function liveProject(projectId: string): Promise<ClientProjectSource | null> {
    const p = await source.project(projectId);
    return p && !p.gone && p.status !== 'ARCHIVED' ? p : null;
  }

  /** The project a staff member is sharing (404 when gone, 409 when archived). */
  async function projectToShare(projectId: string): Promise<ClientProjectSource> {
    const p = await source.project(projectId);
    if (!p || p.gone) throw new NotFoundError('Project not found.');
    if (p.status === 'ARCHIVED') throw new ConflictError('This project is archived, so it can’t be shared with a client. Reopen it first.', 'PROJECT_ARCHIVED');
    return p;
  }

  function requireEmail(): void {
    if (!mailer.isConfigured()) {
      throw new ClientEmailUnavailableError('Email isn’t set up on this server, so a client could never get their code. Ask an administrator to set up email first.');
    }
  }

  async function invite(share: ClientShareRecord, project: ClientProjectSource, token: string, actorId: string, failed: string): Promise<Date> {
    const sharedByName = (await deps.userName(actorId).catch(() => null)) || `The ${resolveBrand().companyName} team`;
    let result: 'sent' | 'suppressed';
    try {
      result = await mailer.sendClientInvitation(share.email, {
        clientName: share.name,
        sharedByName,
        projectName: project.name,
        projectDetails: [project.code, project.clientName].filter((d): d is string => Boolean(d)),
        projectImageUrl: picture(project.imageUrl),
        projectColor: project.color,
        link: `${appUrl}/client/${token}`,
        email: share.email,
      });
    } catch (err) {
      deps.logger?.warn('client view: an invitation could not be sent', { err, shareId: share.id });
      throw new HttpError(failed, 'EMAIL_FAILED', 502);
    }
    if (result === 'suppressed') {
      throw new ConflictError('Emails to this address are blocked (an earlier email bounced or was marked as spam). Check the address.', 'EMAIL_BLOCKED');
    }
    const sentAt = now();
    await store.markSent(share.id, sentAt);
    return sentAt;
  }

  /** The share a link opens, while it is active (else the link has ended). */
  async function openLink(link: unknown): Promise<{ share: ClientShareRecord; project: ClientProjectSource }> {
    if (!isWellFormedToken(link)) throw new ClientLinkEndedError();
    const share = await store.findByLinkHash(hashToken(link));
    if (!share) throw new ClientLinkEndedError();
    const project = await liveProject(share.projectId);
    if (!project) throw new ClientLinkEndedError();
    return { share, project };
  }

  /** …and this device's session for it: its own, not expired. */
  async function openSession(link: unknown, readSession: SessionReader) {
    const opened = await openLink(link);
    const token = readSession(opened.share.id);
    if (!isWellFormedToken(token)) throw new ClientSignInRequiredError();
    const tokenHash = hashToken(token);
    const session = await store.findSession(tokenHash);
    if (!session || session.shareId !== opened.share.id || session.expiresAt.getTime() <= now().getTime()) throw new ClientSignInRequiredError();
    return { ...opened, tokenHash };
  }

  /** An abuse signal (too many wrong codes, too many code requests): one audit line per client an hour. */
  async function noteLockout(share: ClientShareRecord, reason: 'too-many-wrong-codes' | 'too-many-code-requests', ip: string | null): Promise<void> {
    try {
      if (!(await store.noteLockout(share.id, now(), HOUR))) return;
    } catch (err) {
      deps.logger?.warn('client view: a lockout could not be noted', { err, shareId: share.id });
      return;
    }
    await audit({ userId: null, ip, action: 'client-view.lockout', entityId: share.id, newValue: { projectId: share.projectId, reason } });
  }

  async function issueCode(share: ClientShareRecord, projectName: string, ip: string | null): Promise<void> {
    if (issuing.has(share.id)) return;
    issuing.add(share.id);
    try {
      const at = now().getTime();
      const [lastMinute, lastHour] = await Promise.all([
        store.countCodesSince(share.id, new Date(at - MINUTE)),
        store.countCodesSince(share.id, new Date(at - HOUR)),
      ]);
      if (lastMinute >= limits.codesPerMinute || lastHour >= limits.codesPerHour) {
        deps.logger?.warn('client view: code request throttled', { shareId: share.id });
        await noteLockout(share, 'too-many-code-requests', ip);
        return;
      }
      const code = generateOtpCode(limits.codeLength);
      await store.createCode({ shareId: share.id, codeHash: await hashOtp(code), expiresAt: new Date(at + limits.codeTtlMinutes * MINUTE) });
      await mailer.sendClientCode(share.email, { code, projectName, expiresInMinutes: limits.codeTtlMinutes });
    } finally {
      issuing.delete(share.id);
    }
  }

  return {
    limits,

    // ── Staff side ──────────────────────────────────────────────────────────

    async listShares(projectId: string): Promise<ShareSummary[]> {
      return (await store.listForProject(projectId)).map(summary);
    },

    async share(input: { projectId: string; name: string; email: string; actorId: string; ip?: string | null }): Promise<ShareSummary> {
      requireEmail();
      const project = await projectToShare(input.projectId);
      const name = input.name.trim();
      const email = normalizeEmail(input.email);
      const { token, hash } = newToken();
      let share: ClientShareRecord;
      try {
        share = await store.create({ projectId: input.projectId, name, email, linkHash: hash, createdById: input.actorId });
      } catch (err) {
        if (err instanceof ClientShareExistsError) {
          throw new ConflictError('This project is already shared with that address. Use Resend to send the link again.', 'CLIENT_ALREADY_SHARED');
        }
        throw err;
      }
      let sentAt: Date;
      try {
        sentAt = await invite(share, project, token, input.actorId, 'The invitation couldn’t be sent, so the project wasn’t shared. Please try again.');
      } catch (err) {
        await store.delete(share.id);
        throw err;
      }
      await audit({ userId: input.actorId, ip: input.ip ?? null, action: 'client-view.share.add', entityId: share.id, newValue: { projectId: input.projectId, name, email } });
      return summary({ ...share, linkSentAt: sentAt });
    },

    /**
     * A new link by email; the old link, any code sent with it and every signed-in device stop working
     * (the client opens the new link with a new code). If the email can't be sent, nothing changes.
     */
    async resend(input: { projectId: string; shareId: string; actorId: string; ip?: string | null }): Promise<ShareSummary> {
      requireEmail();
      const share = await store.findById(input.shareId);
      if (!share || share.projectId !== input.projectId) throw new NotFoundError('That client isn’t on this project.');
      const project = await projectToShare(input.projectId);
      const { token, hash } = newToken();
      if (!(await store.replaceLink(share.id, share.linkHash, hash))) throw new ConflictError('This client changed meanwhile. Please try again.', 'CLIENT_CHANGED');
      let sentAt: Date;
      try {
        sentAt = await invite(share, project, token, input.actorId, 'The email couldn’t be sent. The earlier link still works; please try again.');
      } catch (err) {
        await store.replaceLink(share.id, hash, share.linkHash);
        throw err;
      }
      await store.deleteSessionsFor(share.id);
      await audit({ userId: input.actorId, ip: input.ip ?? null, action: 'client-view.share.resend', entityId: share.id, newValue: { projectId: input.projectId, email: share.email } });
      return summary({ ...share, linkHash: hash, linkSentAt: sentAt });
    },

    /** Ends the client's access: their link, codes and every signed-in device, at once. */
    async remove(input: { projectId: string; shareId: string; actorId: string; ip?: string | null }): Promise<void> {
      const share = await store.findById(input.shareId);
      if (!share || share.projectId !== input.projectId) throw new NotFoundError('That client isn’t on this project.');
      await store.delete(share.id);
      await audit({ userId: input.actorId, ip: input.ip ?? null, action: 'client-view.share.remove', entityId: share.id, newValue: { projectId: input.projectId, name: share.name, email: share.email } });
    },

    /** Housekeeping (the daily sweep): codes over a day old and expired sessions. */
    async prune(): Promise<void> {
      await store.prune(now());
    },

    // ── Client side ─────────────────────────────────────────────────────────

    /**
     * Emails a code when the address is the one the link was shared with. The answer is the same,
     * and as fast, whatever address is typed: nobody learns who is on the list.
     */
    async requestCode(link: unknown, email: unknown, meta: Meta): Promise<{ sent: true }> {
      const { share, project } = await openLink(link);
      if (!mailer.isConfigured()) throw new ClientEmailUnavailableError();
      if (typeof email === 'string' && sameText(normalizeEmail(email), share.email)) {
        runInBackground(() => issueCode(share, project.name, meta.ip ?? null));
      }
      return { sent: true };
    },

    /** The shared address and its newest code sign this device in to this page (30 days). */
    async verifyCode(link: unknown, email: unknown, code: unknown, meta: Meta): Promise<{ shareId: string; token: string; maxAgeSeconds: number }> {
      const { share } = await openLink(link);
      const refuse = async (): Promise<never> => {
        await verifyOtp(typeof code === 'string' ? code : '', await getDummyHash());
        throw new ClientCodeInvalidError();
      };
      const at = now();
      const entered = typeof code === 'string' ? code.trim() : '';
      const rightAddress = typeof email === 'string' && sameText(normalizeEmail(email), share.email);
      // Read the same things whatever address was typed, so the time taken doesn't tell either.
      const [failures, open] = await Promise.all([store.countFailuresSince(share.id, new Date(at.getTime() - HOUR)), store.latestOpenCode(share.id)]);
      if (!rightAddress || !/^\d{4,10}$/.test(entered)) return refuse();
      if (failures >= limits.failuresPerHour) {
        await noteLockout(share, 'too-many-wrong-codes', meta.ip ?? null);
        return refuse();
      }
      if (!open || open.expiresAt.getTime() <= at.getTime()) return refuse();
      // Counted before the (slow) comparison, so parallel guesses can't all get past the limit.
      if (!(await store.claimAttempt(open.id, limits.triesPerCode))) return refuse();
      if (!(await verifyOtp(entered, open.codeHash))) throw new ClientCodeInvalidError();
      if (!(await store.consumeCode(open.id))) throw new ClientCodeInvalidError();

      const { token, hash } = newToken();
      await store.createSession({ shareId: share.id, tokenHash: hash, expiresAt: new Date(at.getTime() + limits.sessionDays * 24 * HOUR) });
      await store.pruneSessions(share.id, at, limits.sessionsPerClient);
      await audit({ userId: null, ip: meta.ip ?? null, action: 'client-view.sign-in', entityId: share.id, newValue: { projectId: share.projectId, email: share.email } });
      return { shareId: share.id, token, maxAgeSeconds: limits.sessionDays * 24 * 3600 };
    },

    /** The page: only this project's allow-listed fields and marked items. */
    async view(link: unknown, readSession: SessionReader): Promise<ClientView> {
      const { share, project } = await openSession(link, readSession);
      const at = now();
      if (!share.lastViewedAt || at.getTime() - share.lastViewedAt.getTime() >= MINUTE) await store.markViewed(share.id, at);
      const [counts, items, minutes, inspections] = await Promise.all([
        source.counts(share.projectId),
        source.items(share.projectId),
        source.minutes(share.projectId),
        deps.inspections ? deps.inspections.list(share.projectId) : Promise.resolve([]),
      ]);
      return buildClientView({ viewer: { name: share.name, email: share.email }, project, counts, items, minutes, inspections, timeZone: deps.timeZone, now: at });
    },

    /** The client copy of a shown meeting's approved minutes (never the staff PDF). */
    async minutesPdf(link: unknown, readSession: SessionReader, meetingId: unknown): Promise<{ pdf: Buffer; fileName: string }> {
      const { share, project } = await openSession(link, readSession);
      const m = typeof meetingId === 'string' && meetingId ? await source.minutesOf(share.projectId, meetingId) : null;
      if (!m || m.status !== 'APPROVED' || !m.clientVisible) throw new NotFoundError('These minutes aren’t shared with you.');
      const brand = resolveBrand();
      const image = project.imageUrl && deps.projectImage ? await deps.projectImage(project.imageUrl).catch(() => null) : null;
      const pdf = buildClientMinutesPdf({
        brand: {
          productName: brand.productName,
          companyName: brand.companyName,
          websiteUrl: brand.websiteUrl,
          supportEmail: brand.supportEmail,
          companyAddress: brand.companyAddress,
          colors: { brand: brand.colors.brand, ink: brand.colors.ink, muted: brand.colors.ink2, line: brand.colors.line },
        },
        project: { name: project.name, code: project.code, number: project.number, clientName: project.clientName, color: project.color, icon: project.icon, image },
        meeting: { title: m.title, startAt: m.startAt.toISOString(), endAt: m.endAt ? m.endAt.toISOString() : null, timeZone: m.timeZone },
        approvedAt: m.approvedAt ? m.approvedAt.toISOString() : null,
        content: clientMinutesContent(m.content, { names: m.people ?? [], includeRisks: m.showRisks === true }),
        companyTimeZone: deps.timeZone,
        generatedAt: now().toISOString(),
      });
      return { pdf, fileName: `minutes-${slugify(m.title)}.pdf` };
    },

    /** The share a link opens (null when it opens none): the PDF limit counts per share and device. */
    async shareIdOf(link: unknown): Promise<string | null> {
      if (!isWellFormedToken(link)) return null;
      return (await store.findByLinkHash(hashToken(link)))?.id ?? null;
    },

    /** One shown report's details and signatures, when the client opens it on the page. */
    async inspection(link: unknown, readSession: SessionReader, inspectionId: unknown): Promise<ClientInspection> {
      const { share } = await openSession(link, readSession);
      const report = typeof inspectionId === 'string' && inspectionId && deps.inspections ? await deps.inspections.one(share.projectId, inspectionId) : null;
      if (!report) throw new NotFoundError('This inspection report isn’t shared with you.');
      return report;
    },

    /** The client copy of a shown inspection report (never the staff PDF: no staff names but the signers'). */
    async inspectionPdf(link: unknown, readSession: SessionReader, inspectionId: unknown): Promise<{ pdf: Buffer; fileName: string }> {
      const { share, project } = await openSession(link, readSession);
      const report = typeof inspectionId === 'string' && inspectionId && deps.inspections ? await deps.inspections.one(share.projectId, inspectionId) : null;
      if (!report) throw new NotFoundError('This inspection report isn’t shared with you.');
      const image = project.imageUrl && deps.projectImage ? await deps.projectImage(project.imageUrl).catch(() => null) : null;
      const pdf = buildInspectionPdf({
        brand: reportBrand(),
        project: { name: project.name, code: project.code, number: project.number, clientName: project.clientName, color: project.color, icon: project.icon, image },
        report,
        timeZone: deps.timeZone,
        generatedAt: now().toISOString(),
      });
      return { pdf, fileName: inspectionPdfFileName(report.title, report.date) };
    },

    /** Signs this device out of the page; returns the share, so its cookie can be cleared. */
    async signOut(link: unknown, readSession: SessionReader): Promise<{ shareId: string }> {
      const { share } = await openLink(link);
      const token = readSession(share.id);
      if (isWellFormedToken(token)) {
        const tokenHash = hashToken(token);
        const session = await store.findSession(tokenHash);
        if (session?.shareId === share.id) await store.deleteSession(tokenHash);
      }
      return { shareId: share.id };
    },
  };
}

export type ClientAccessService = ReturnType<typeof createClientAccessService>;
