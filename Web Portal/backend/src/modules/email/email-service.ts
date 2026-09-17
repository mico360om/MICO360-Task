import type { Transport, EmailAttachment } from './mailer';
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

export interface EmailServiceDeps {
  transport: Transport;
  /** Optional check to skip addresses that hard-bounced / marked spam (T20.5). */
  isSuppressed?: (email: string) => Promise<boolean>;
}

/** High-level email sender. Every method renders a branded template and sends HTML + text. */
export function createEmailService({ transport, isSuppressed }: EmailServiceDeps) {
  async function deliver(email: string, content: EmailContent, attachments?: EmailAttachment[]): Promise<void> {
    if (isSuppressed && (await isSuppressed(email))) return; // don't email suppressed addresses
    await transport.send({ to: email, subject: content.subject, html: content.html, text: content.text, ...(attachments?.length ? { attachments } : {}) });
  }

  return {
    // Auth & account
    sendLoginCode: (email: string, code: string, opts?: TemplateOptions) => deliver(email, otpCodeEmail(code, opts)),
    sendPasswordReset: (email: string, link: string, opts?: TemplateOptions) => deliver(email, passwordResetEmail(link, opts)),
    sendActivation: (email: string, username: string, link: string, opts?: TemplateOptions) =>
      deliver(email, accountActivationEmail(username, link, opts)),
    sendWelcome: (email: string, username: string, opts?: TemplateOptions) => deliver(email, welcomeEmail(username, opts)),
    sendPasswordChanged: (email: string, username: string, opts?: TemplateOptions) =>
      deliver(email, passwordChangedEmail(username, opts)),
    sendAccountLocked: (email: string, username: string, resetLink: string, opts?: TemplateOptions) =>
      deliver(email, accountLockedEmail(username, resetLink, opts)),

    // Collaboration & workflow
    sendTaskAssigned: (email: string, taskTitle: string, taskKey: string, opts?: TemplateOptions & { link?: string }) =>
      deliver(email, taskAssignedEmail(taskTitle, taskKey, opts)),
    sendMention: (email: string, params: Parameters<typeof mentionEmail>[0], opts?: TemplateOptions) =>
      deliver(email, mentionEmail(params, opts)),
    sendInvitation: (email: string, params: Parameters<typeof invitationEmail>[0], opts?: TemplateOptions) =>
      deliver(email, invitationEmail(params, opts)),
    sendApproval: (email: string, params: Parameters<typeof approvalEmail>[0], opts?: TemplateOptions) =>
      deliver(email, approvalEmail(params, opts)),
    sendRejection: (email: string, params: Parameters<typeof rejectionEmail>[0], opts?: TemplateOptions) =>
      deliver(email, rejectionEmail(params, opts)),
    sendReminder: (email: string, params: Parameters<typeof reminderEmail>[0], opts?: TemplateOptions) =>
      deliver(email, reminderEmail(params, opts)),
    sendWorkflowNotification: (email: string, params: Parameters<typeof workflowNotificationEmail>[0], opts?: TemplateOptions) =>
      deliver(email, workflowNotificationEmail(params, opts)),

    // Reports & alerts
    sendReport: (email: string, params: Parameters<typeof reportReadyEmail>[0], opts?: TemplateOptions) =>
      deliver(email, reportReadyEmail(params, opts)),
    sendAlert: (email: string, params: Parameters<typeof alertEmail>[0], opts?: TemplateOptions) =>
      deliver(email, alertEmail(params, opts)),
    sendNotification: (email: string, params: Parameters<typeof genericNotificationEmail>[0], opts?: TemplateOptions) =>
      deliver(email, genericNotificationEmail(params, opts)),

    // Meetings — invitations, reminders, cancellations, minutes (with .ics / PDF attachments)
    sendMeetingInvite: (email: string, params: MeetingEmailParams, ics: EmailAttachment, opts?: TemplateOptions) =>
      deliver(email, meetingInviteEmail(params, opts), [ics]),
    sendMeetingReminder: (email: string, params: MeetingEmailParams & { startsInLabel: string }, opts?: TemplateOptions) =>
      deliver(email, meetingReminderEmail(params, opts)),
    sendMeetingCancelled: (email: string, params: MeetingEmailParams, ics: EmailAttachment, opts?: TemplateOptions) =>
      deliver(email, meetingCancelledEmail(params, opts), [ics]),
    sendMeetingMinutes: (email: string, params: MeetingEmailParams, pdf: EmailAttachment, opts?: TemplateOptions) =>
      deliver(email, meetingMinutesEmail(params, opts), [pdf]),
  };
}

export type EmailService = ReturnType<typeof createEmailService>;
