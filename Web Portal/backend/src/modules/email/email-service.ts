import type { Transport, EmailAttachment, EmailAddress } from './mailer';
import { EmailDeliveryError, EmailNotConfiguredError } from './delivery-error';
import {
  meetingInviteEmail,
  meetingReminderEmail,
  meetingCancelledEmail,
  meetingMinutesEmail,
  type MeetingEmailParams,
  otpCodeEmail,
  taskAssignedEmail,
  passwordResetEmail,
  welcomeEmail,
  accountActivationEmail,
  invitationEmail,
  approvalEmail,
  rejectionEmail,
  reminderEmail,
  workflowNotificationEmail,
  reportReadyEmail,
  alertEmail,
  mentionEmail,
  passwordChangedEmail,
  accountLockedEmail,
  genericNotificationEmail,
  clientInvitationEmail,
  clientCodeEmail,
  type ClientInvitationParams,
  type ClientCodeParams,
  type EmailContent,
  type TemplateOptions,
  type LoginCodeOptions,
  type WelcomeEmailParams,
} from './email-templates';

/** One row per send attempt in email_log. */
export interface EmailLogEntry {
  toAddress: string;
  template: string;
  subject: string;
  status: 'SENT' | 'FAILED';
  providerMessageId?: string;
  error?: string;
}

export interface EmailLogStore {
  record(entry: EmailLogEntry): Promise<void>;
}

export interface EmailLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
}

export interface EmailServiceDeps {
  transport: Transport;
  /** Optional check to skip addresses that hard-bounced / marked spam (T20.5). */
  isSuppressed?: (email: string) => Promise<boolean>;
  /** Where every send attempt is recorded (SENT / FAILED). */
  log?: EmailLogStore;
  logger?: EmailLogger;
}

/** The To and Cc lines of one email to several people. */
export interface MailLines {
  to: EmailAddress[];
  cc: EmailAddress[];
}

/** How a send went: it went, or the address is blocked (suppressed) and it was skipped. */
export type DeliveryResult = 'sent' | 'suppressed';

interface DeliverOptions {
  attachments?: EmailAttachment[];
  /** Sign-in and recovery mail: never silently dropped because of an old bounce. */
  essential?: boolean;
  /** It carries a secret link or code: the provider must not click-track it (see SendEmailInput). */
  secretLinks?: boolean;
  /** Companies: the sender name it goes out with (a company's); omitted = MAIL_FROM's. */
  fromName?: string;
}

/** Companies: the sender name in a send's options, when one is given (else nothing, as before). */
const sender = (opts?: { fromName?: string }): { fromName?: string } => (opts?.fromName ? { fromName: opts.fromName } : {});

/**
 * High-level email sender. Every method renders a branded template and sends HTML + text.
 * A send that doesn't reach the provider throws — `EmailNotConfiguredError` when no provider is
 * configured, `EmailDeliveryError` when the provider rejects it or can't be reached — so callers
 * can report real outcomes instead of "sent". Suppressed addresses are skipped without an error.
 */
export function createEmailService({ transport, isSuppressed, log, logger }: EmailServiceDeps) {
  const isConfigured = () => transport.configured !== false;

  async function record(entry: EmailLogEntry): Promise<void> {
    try {
      await log?.record(entry);
    } catch (err) {
      logger?.warn('could not write the email log', { err });
    }
  }

  /** Sends one email: 'sent', or 'suppressed' when the address is blocked (and the email was skipped). */
  async function deliverResult(template: string, email: string, content: EmailContent, opts: DeliverOptions = {}): Promise<DeliveryResult> {
    const base = { toAddress: email, template, subject: content.subject };
    if (!isConfigured()) {
      await record({ ...base, status: 'FAILED', error: 'Email sending is not configured.' });
      throw new EmailNotConfiguredError(email);
    }
    if (isSuppressed && (await isSuppressed(email))) {
      if (!opts.essential) {
        logger?.info('email skipped: address is suppressed', { template, to: email });
        return 'suppressed';
      }
      logger?.warn('sending a sign-in email to a suppressed address', { template, to: email });
    }

    let result;
    try {
      result = await transport.send({
        to: email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
        ...(opts.secretLinks ? { secretLinks: true } : {}),
        ...sender(opts),
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await record({ ...base, status: 'FAILED', error });
      logger?.warn('email could not be sent', { template, to: email, error });
      if (err instanceof EmailDeliveryError) throw err;
      throw new EmailDeliveryError(email, undefined, `Email could not be delivered: ${error}`);
    }

    if (!result.ok) {
      const error = result.error ?? `HTTP ${result.status}`;
      await record({ ...base, status: 'FAILED', error });
      logger?.warn('email rejected by the provider', { template, to: email, status: result.status, error });
      throw new EmailDeliveryError(email, result.status, `Email could not be delivered (HTTP ${result.status}).`);
    }
    await record({ ...base, status: 'SENT', ...(result.messageId ? { providerMessageId: result.messageId } : {}) });
    return 'sent';
  }

  async function deliver(template: string, email: string, content: EmailContent, opts: DeliverOptions = {}): Promise<void> {
    await deliverResult(template, email, content, opts);
  }

  /**
   * ONE email to several people, everyone seeing who got it (its To and Cc lines). A blocked address
   * is left out (and returned in `suppressed`); with every To address blocked the Cc line moves up to
   * To. Each address gets its own row in the email log. Throws, as one-person sends do, when it isn't
   * delivered — for every address on it.
   */
  async function deliverToMany(template: string, lines: MailLines, content: EmailContent, opts: DeliverOptions = {}): Promise<{ suppressed: string[] }> {
    const all = [...lines.to, ...lines.cc];
    const rows = (addresses: EmailAddress[], entry: Omit<EmailLogEntry, 'toAddress' | 'template' | 'subject'>, ids: Record<string, string> = {}) =>
      Promise.all(
        addresses.map((a) => {
          const id = ids[a.email.toLowerCase()] ?? entry.providerMessageId;
          return record({ toAddress: a.email, template, subject: content.subject, ...entry, ...(id ? { providerMessageId: id } : {}) });
        }),
      );
    if (!isConfigured()) {
      await rows(all, { status: 'FAILED', error: 'Email sending is not configured.' });
      throw new EmailNotConfiguredError(all[0]?.email ?? '');
    }
    const suppressed: string[] = [];
    const keep = async (addresses: EmailAddress[]) => {
      const kept: EmailAddress[] = [];
      for (const a of addresses) {
        if (isSuppressed && (await isSuppressed(a.email))) {
          logger?.info('email skipped: address is suppressed', { template, to: a.email });
          suppressed.push(a.email);
        } else kept.push(a);
      }
      return kept;
    };
    let to = await keep(lines.to);
    let cc = await keep(lines.cc);
    if (to.length === 0) [to, cc] = [cc, []];
    const first = to[0];
    if (!first) return { suppressed };
    const sent = [...to, ...cc];

    let result;
    try {
      result = await transport.send({
        to: first.email,
        toAll: to,
        cc,
        subject: content.subject,
        html: content.html,
        text: content.text,
        ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
        ...(opts.secretLinks ? { secretLinks: true } : {}),
        ...sender(opts),
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await rows(sent, { status: 'FAILED', error });
      logger?.warn('email could not be sent', { template, to: first.email, recipients: sent.length, error });
      if (err instanceof EmailDeliveryError) throw err;
      throw new EmailDeliveryError(first.email, undefined, `Email could not be delivered: ${error}`);
    }
    if (!result.ok) {
      const error = result.error ?? `HTTP ${result.status}`;
      await rows(sent, { status: 'FAILED', error });
      logger?.warn('email rejected by the provider', { template, to: first.email, recipients: sent.length, status: result.status, error });
      throw new EmailDeliveryError(first.email, result.status, `Email could not be delivered (HTTP ${result.status}).`);
    }
    await rows(sent, { status: 'SENT', ...(result.messageId ? { providerMessageId: result.messageId } : {}) }, result.messageIds);
    return { suppressed };
  }

  return {
    /** False when no mail provider is configured, so nothing can be sent. */
    isConfigured,
    /** True when emails to the address are blocked (it bounced or was marked as spam). */
    isBlocked: async (email: string): Promise<boolean> => (isSuppressed ? isSuppressed(email) : false),

    // Auth & account
    // Secret links and codes are never click-tracked (secretLinks).
    sendLoginCode: (email: string, code: string, opts?: LoginCodeOptions) => deliver('otp', email, otpCodeEmail(code, opts), { ...sender(opts), essential: true, secretLinks: true }),
    sendPasswordReset: (email: string, link: string, opts?: TemplateOptions) =>
      deliver('password-reset', email, passwordResetEmail(link, opts), { ...sender(opts), essential: true, secretLinks: true }),
    sendActivation: (email: string, username: string, link: string, opts?: TemplateOptions) =>
      deliver('activation', email, accountActivationEmail(username, link, opts), { ...sender(opts), essential: true, secretLinks: true }),
    /**
     * An administrator's welcome email with its "Set your password" link: 'sent', or 'suppressed' when
     * the address is blocked (never sent to it). The email log records the subject, never the link.
     */
    sendWelcome: (email: string, params: WelcomeEmailParams, opts?: TemplateOptions): Promise<DeliveryResult> =>
      deliverResult('welcome', email, welcomeEmail(params, opts), { ...sender(opts), secretLinks: true }),
    sendPasswordChanged: (email: string, username: string, opts?: TemplateOptions) =>
      deliver('password-changed', email, passwordChangedEmail(username, opts), sender(opts)),
    sendAccountLocked: (email: string, username: string, resetLink: string, opts?: TemplateOptions) =>
      deliver('account-locked', email, accountLockedEmail(username, resetLink, opts), sender(opts)),

    // Collaboration & workflow
    sendTaskAssigned: (email: string, taskTitle: string, taskKey: string, opts?: TemplateOptions & { link?: string }) =>
      deliver('task-assigned', email, taskAssignedEmail(taskTitle, taskKey, opts), sender(opts)),
    sendMention: (email: string, params: Parameters<typeof mentionEmail>[0], opts?: TemplateOptions) =>
      deliver('mention', email, mentionEmail(params, opts), sender(opts)),
    sendInvitation: (email: string, params: Parameters<typeof invitationEmail>[0], opts?: TemplateOptions) =>
      deliver('invitation', email, invitationEmail(params, opts), sender(opts)),
    sendApproval: (email: string, params: Parameters<typeof approvalEmail>[0], opts?: TemplateOptions) =>
      deliver('approval', email, approvalEmail(params, opts), sender(opts)),
    sendRejection: (email: string, params: Parameters<typeof rejectionEmail>[0], opts?: TemplateOptions) =>
      deliver('rejection', email, rejectionEmail(params, opts), sender(opts)),
    sendReminder: (email: string, params: Parameters<typeof reminderEmail>[0], opts?: TemplateOptions) =>
      deliver('reminder', email, reminderEmail(params, opts), sender(opts)),
    sendWorkflowNotification: (email: string, params: Parameters<typeof workflowNotificationEmail>[0], opts?: TemplateOptions) =>
      deliver('workflow', email, workflowNotificationEmail(params, opts), sender(opts)),

    // Reports & alerts
    sendReport: (email: string, params: Parameters<typeof reportReadyEmail>[0], opts?: TemplateOptions) =>
      deliver('report', email, reportReadyEmail(params, opts), sender(opts)),
    sendAlert: (email: string, params: Parameters<typeof alertEmail>[0], opts?: TemplateOptions) =>
      deliver('alert', email, alertEmail(params, opts), sender(opts)),
    sendNotification: (email: string, params: Parameters<typeof genericNotificationEmail>[0], opts?: TemplateOptions) =>
      deliver('notification', email, genericNotificationEmail(params, opts), sender(opts)),
    /**
     * An email already built elsewhere (the daily task emails), logged under its own template name.
     * 'suppressed': the address is blocked after a bounce or spam complaint, so nothing was sent.
     */
    sendPrepared: (template: string, email: string, content: EmailContent, opts?: { fromName?: string }): Promise<DeliveryResult> =>
      deliverResult(template, email, content, sender(opts)),

    // Meetings — invitations, reminders, cancellations, minutes (with .ics / PDF attachments)
    sendMeetingInvite: (email: string, params: MeetingEmailParams, ics: EmailAttachment, opts?: TemplateOptions) =>
      deliver('meeting-invite', email, meetingInviteEmail(params, opts), { ...sender(opts), attachments: [ics] }),
    sendMeetingReminder: (email: string, params: MeetingEmailParams & { startsInLabel: string }, opts?: TemplateOptions) =>
      deliver('meeting-reminder', email, meetingReminderEmail(params, opts), sender(opts)),
    sendMeetingCancelled: (email: string, params: MeetingEmailParams, ics: EmailAttachment, opts?: TemplateOptions) =>
      deliver('meeting-cancelled', email, meetingCancelledEmail(params, opts), { ...sender(opts), attachments: [ics] }),
    /** The minutes: ONE email to its To and Cc lines (everyone sees who got it); `suppressed`: blocked addresses left out. */
    sendMeetingMinutes: (lines: MailLines, params: MeetingEmailParams, pdf: EmailAttachment, opts?: TemplateOptions) =>
      deliverToMany('meeting-minutes', lines, meetingMinutesEmail(params, opts), { ...sender(opts), attachments: [pdf] }),

    // Client view — a client following one project. The invitation is skipped for a blocked address
    // ('suppressed'); the code is sign-in mail, never dropped because of an old bounce.
    sendClientInvitation: (email: string, params: ClientInvitationParams, opts?: TemplateOptions): Promise<DeliveryResult> =>
      deliverResult('client-invitation', email, clientInvitationEmail(params, opts), { ...sender(opts), secretLinks: true }),
    sendClientCode: (email: string, params: ClientCodeParams, opts?: TemplateOptions) =>
      deliver('client-code', email, clientCodeEmail(params, opts), { ...sender(opts), essential: true, secretLinks: true }),
  };
}

export type EmailService = ReturnType<typeof createEmailService>;
