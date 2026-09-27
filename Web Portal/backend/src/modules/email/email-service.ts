import type { Transport, EmailAttachment } from './mailer';
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
  type EmailContent,
  type TemplateOptions,
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

interface DeliverOptions {
  attachments?: EmailAttachment[];
  /** Sign-in and recovery mail: never silently dropped because of an old bounce. */
  essential?: boolean;
}

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

  async function deliver(template: string, email: string, content: EmailContent, opts: DeliverOptions = {}): Promise<void> {
    const base = { toAddress: email, template, subject: content.subject };
    if (!isConfigured()) {
      await record({ ...base, status: 'FAILED', error: 'Email sending is not configured.' });
      throw new EmailNotConfiguredError(email);
    }
    if (isSuppressed && (await isSuppressed(email))) {
      if (!opts.essential) {
        logger?.info('email skipped: address is suppressed', { template, to: email });
        return;
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
  }

  return {
    /** False when no mail provider is configured, so nothing can be sent. */
    isConfigured,

    // Auth & account
    sendLoginCode: (email: string, code: string, opts?: TemplateOptions) => deliver('otp', email, otpCodeEmail(code, opts), { essential: true }),
    sendPasswordReset: (email: string, link: string, opts?: TemplateOptions) =>
      deliver('password-reset', email, passwordResetEmail(link, opts), { essential: true }),
    sendActivation: (email: string, username: string, link: string, opts?: TemplateOptions) =>
      deliver('activation', email, accountActivationEmail(username, link, opts), { essential: true }),
    sendWelcome: (email: string, username: string, opts?: TemplateOptions) => deliver('welcome', email, welcomeEmail(username, opts)),
    sendPasswordChanged: (email: string, username: string, opts?: TemplateOptions) =>
      deliver('password-changed', email, passwordChangedEmail(username, opts)),
    sendAccountLocked: (email: string, username: string, resetLink: string, opts?: TemplateOptions) =>
      deliver('account-locked', email, accountLockedEmail(username, resetLink, opts)),

    // Collaboration & workflow
    sendTaskAssigned: (email: string, taskTitle: string, taskKey: string, opts?: TemplateOptions & { link?: string }) =>
      deliver('task-assigned', email, taskAssignedEmail(taskTitle, taskKey, opts)),
    sendMention: (email: string, params: Parameters<typeof mentionEmail>[0], opts?: TemplateOptions) =>
      deliver('mention', email, mentionEmail(params, opts)),
    sendInvitation: (email: string, params: Parameters<typeof invitationEmail>[0], opts?: TemplateOptions) =>
      deliver('invitation', email, invitationEmail(params, opts)),
    sendApproval: (email: string, params: Parameters<typeof approvalEmail>[0], opts?: TemplateOptions) =>
      deliver('approval', email, approvalEmail(params, opts)),
    sendRejection: (email: string, params: Parameters<typeof rejectionEmail>[0], opts?: TemplateOptions) =>
      deliver('rejection', email, rejectionEmail(params, opts)),
    sendReminder: (email: string, params: Parameters<typeof reminderEmail>[0], opts?: TemplateOptions) =>
      deliver('reminder', email, reminderEmail(params, opts)),
    sendWorkflowNotification: (email: string, params: Parameters<typeof workflowNotificationEmail>[0], opts?: TemplateOptions) =>
      deliver('workflow', email, workflowNotificationEmail(params, opts)),

    // Reports & alerts
    sendReport: (email: string, params: Parameters<typeof reportReadyEmail>[0], opts?: TemplateOptions) =>
      deliver('report', email, reportReadyEmail(params, opts)),
    sendAlert: (email: string, params: Parameters<typeof alertEmail>[0], opts?: TemplateOptions) =>
      deliver('alert', email, alertEmail(params, opts)),
    sendNotification: (email: string, params: Parameters<typeof genericNotificationEmail>[0], opts?: TemplateOptions) =>
      deliver('notification', email, genericNotificationEmail(params, opts)),

    // Meetings — invitations, reminders, cancellations, minutes (with .ics / PDF attachments)
    sendMeetingInvite: (email: string, params: MeetingEmailParams, ics: EmailAttachment, opts?: TemplateOptions) =>
      deliver('meeting-invite', email, meetingInviteEmail(params, opts), { attachments: [ics] }),
    sendMeetingReminder: (email: string, params: MeetingEmailParams & { startsInLabel: string }, opts?: TemplateOptions) =>
      deliver('meeting-reminder', email, meetingReminderEmail(params, opts)),
    sendMeetingCancelled: (email: string, params: MeetingEmailParams, ics: EmailAttachment, opts?: TemplateOptions) =>
      deliver('meeting-cancelled', email, meetingCancelledEmail(params, opts), { attachments: [ics] }),
    sendMeetingMinutes: (email: string, params: MeetingEmailParams, pdf: EmailAttachment, opts?: TemplateOptions) =>
      deliver('meeting-minutes', email, meetingMinutesEmail(params, opts), { attachments: [pdf] }),
  };
}

export type EmailService = ReturnType<typeof createEmailService>;
