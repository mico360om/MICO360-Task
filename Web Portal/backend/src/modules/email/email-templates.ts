import { renderEmail, type Block, type Tone } from './email-layout';
import { resolveBrand, type Brand } from './brand';
import type { Locale } from './i18n';

export interface EmailContent {
  subject: string;
  html: string;
  /** Plain-text alternative (deliverability + accessibility). */
  text: string;
}

export interface TemplateOptions {
  brand?: Partial<Brand>;
  locale?: Locale;
}

/** Compose subject + rendered HTML/text from a heading, preheader and content blocks. */
function build(
  subject: string,
  preheader: string,
  heading: string,
  blocks: Block[],
  opts: TemplateOptions = {},
): EmailContent {
  const { html, text } = renderEmail({ preheader, heading, blocks, brand: opts.brand, locale: opts.locale });
  return { subject, html, text };
}

const productName = (opts?: TemplateOptions) => resolveBrand(opts?.brand).productName;

/** A "copy/paste this link" fallback block for links behind a button. */
function linkFallback(url: string): Block {
  return { kind: 'text', text: `Or copy and paste this link into your browser: ${url}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// Authentication & account
// ─────────────────────────────────────────────────────────────────────────────

export function otpCodeEmail(code: string, opts?: TemplateOptions): EmailContent {
  return build(
    `Your ${productName(opts)} login code`,
    `Your one-time login code is ${code}`,
    'Your login code',
    [
      { kind: 'text', text: 'Use this one-time code to finish signing in. It expires in 10 minutes.' },
      { kind: 'code', code, note: 'Never share this code with anyone.' },
      { kind: 'callout', text: 'If you didn’t try to sign in, you can safely ignore this email — your account is still secure.', tone: 'info' },
    ],
    opts,
  );
}

export function passwordResetEmail(link: string, opts?: TemplateOptions): EmailContent {
  return build(
    `Reset your ${productName(opts)} password`,
    'Reset your password to regain access to your account',
    'Reset your password',
    [
      { kind: 'text', text: 'We received a request to reset your password. Click the button below to choose a new one. This link expires in 60 minutes.' },
      { kind: 'button', label: 'Reset password', href: link },
      linkFallback(link),
      { kind: 'callout', text: 'Didn’t request this? You can ignore this email and your password will stay the same.', tone: 'warning' },
    ],
    opts,
  );
}

export function accountActivationEmail(username: string, activationLink: string, opts?: TemplateOptions): EmailContent {
  return build(
    `Activate your ${productName(opts)} account`,
    `Welcome ${username} — activate your account to get started`,
    'Activate your account',
    [
      { kind: 'text', text: `Hi ${username}, welcome to ${productName(opts)}! Confirm your email address to activate your account and start collaborating.` },
      { kind: 'button', label: 'Activate account', href: activationLink },
      linkFallback(activationLink),
    ],
    opts,
  );
}

export function welcomeEmail(username: string, opts?: TemplateOptions): EmailContent {
  const brand = resolveBrand(opts?.brand);
  return build(
    `Welcome to ${brand.productName}`,
    `Your ${brand.productName} account is ready`,
    'Welcome aboard',
    [
      { kind: 'text', text: `Hi ${username}, your ${brand.productName} account is ready. Jump in to see your boards, tasks and projects.` },
      { kind: 'button', label: 'Open the app', href: brand.appUrl },
      { kind: 'list', items: ['Track work on Kanban boards', 'Get notified about assignments and mentions', 'See due dates on your calendar'] },
    ],
    opts,
  );
}

export function passwordChangedEmail(username: string, opts?: TemplateOptions): EmailContent {
  const brand = resolveBrand(opts?.brand);
  return build(
    `Your ${brand.productName} password was changed`,
    'Security notice: your password was updated',
    'Your password was changed',
    [
      { kind: 'text', text: `Hi ${username}, this is a confirmation that your ${brand.productName} password was just changed.` },
      { kind: 'callout', text: `If this wasn’t you, reset your password immediately and contact ${brand.supportEmail}.`, tone: 'danger' },
    ],
    opts,
  );
}

export function accountLockedEmail(username: string, resetLink: string, opts?: TemplateOptions): EmailContent {
  return build(
    `Your ${productName(opts)} account is locked`,
    'Your account was locked after too many sign-in attempts',
    'Account temporarily locked',
    [
      { kind: 'text', text: `Hi ${username}, your account was locked after several failed sign-in attempts to protect it.` },
      { kind: 'text', text: 'Reset your password to unlock your account and sign in again.' },
      { kind: 'button', label: 'Reset password & unlock', href: resetLink },
      linkFallback(resetLink),
    ],
    opts,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Collaboration & workflow
// ─────────────────────────────────────────────────────────────────────────────

export function invitationEmail(
  params: { inviterName: string; orgName: string; role: string; acceptLink: string },
  opts?: TemplateOptions,
): EmailContent {
  return build(
    `${params.inviterName} invited you to ${params.orgName}`,
    `Join ${params.orgName} on ${productName(opts)}`,
    'You’ve been invited',
    [
      { kind: 'text', text: `${params.inviterName} has invited you to collaborate on ${params.orgName} in ${productName(opts)}.` },
      { kind: 'details', rows: [['Workspace', params.orgName], ['Invited by', params.inviterName], ['Your role', params.role]] },
      { kind: 'button', label: 'Accept invitation', href: params.acceptLink },
      linkFallback(params.acceptLink),
    ],
    opts,
  );
}

export function taskAssignedEmail(taskTitle: string, taskKey: string, opts?: TemplateOptions & { link?: string }): EmailContent {
  const brand = resolveBrand(opts?.brand);
  const link = opts?.link ?? brand.appUrl;
  return build(
    `You were assigned ${taskKey}`,
    `New task assigned to you: ${taskTitle}`,
    'New task assigned',
    [
      { kind: 'text', text: 'A task has been assigned to you. Here are the details:' },
      { kind: 'details', rows: [['Task', taskTitle], ['Reference', taskKey]] },
      { kind: 'button', label: 'View task', href: link },
    ],
    opts,
  );
}

export function mentionEmail(
  params: { mentionedBy: string; taskTitle: string; taskKey: string; snippet: string; link: string },
  opts?: TemplateOptions,
): EmailContent {
  return build(
    `${params.mentionedBy} mentioned you on ${params.taskKey}`,
    `${params.mentionedBy} mentioned you in a comment`,
    'You were mentioned',
    [
      { kind: 'text', text: `${params.mentionedBy} mentioned you on ${params.taskTitle} (${params.taskKey}):` },
      { kind: 'callout', text: params.snippet, tone: 'info' },
      { kind: 'button', label: 'Reply', href: params.link },
    ],
    opts,
  );
}

export function approvalEmail(
  params: { itemName: string; itemType: string; approverName: string; link: string },
  opts?: TemplateOptions,
): EmailContent {
  return build(
    `Approved: ${params.itemName}`,
    `${params.itemType} approved by ${params.approverName}`,
    `${params.itemType} approved`,
    [
      { kind: 'text', text: `Good news — your ${params.itemType.toLowerCase()} “${params.itemName}” was approved by ${params.approverName}.` },
      { kind: 'callout', text: 'Approved', tone: 'success' },
      { kind: 'button', label: 'View details', href: params.link },
    ],
    opts,
  );
}

export function rejectionEmail(
  params: { itemName: string; itemType: string; reason?: string; link: string },
  opts?: TemplateOptions,
): EmailContent {
  const blocks: Block[] = [
    { kind: 'text', text: `Your ${params.itemType.toLowerCase()} “${params.itemName}” was not approved.` },
  ];
  if (params.reason) blocks.push({ kind: 'callout', text: `Reason: ${params.reason}`, tone: 'danger' });
  blocks.push({ kind: 'button', label: 'Review & resubmit', href: params.link });
  return build(`Update on ${params.itemName}`, `${params.itemType} was not approved`, `${params.itemType} not approved`, blocks, opts);
}

export function reminderEmail(
  params: { taskTitle: string; taskKey: string; dueDate: string; link: string },
  opts?: TemplateOptions,
): EmailContent {
  return build(
    `Reminder: ${params.taskKey} is due ${params.dueDate}`,
    `${params.taskTitle} is due soon`,
    'Task due soon',
    [
      { kind: 'text', text: 'This is a friendly reminder that a task assigned to you is due soon.' },
      { kind: 'details', rows: [['Task', params.taskTitle], ['Reference', params.taskKey], ['Due', params.dueDate]] },
      { kind: 'button', label: 'Open task', href: params.link },
    ],
    opts,
  );
}

/** Generic workflow-event notification (status change, comment, etc.). */
export function workflowNotificationEmail(
  params: { title: string; message: string; details?: Array<[string, string]>; actionLabel?: string; actionLink?: string },
  opts?: TemplateOptions,
): EmailContent {
  const blocks: Block[] = [{ kind: 'text', text: params.message }];
  if (params.details?.length) blocks.push({ kind: 'details', rows: params.details });
  if (params.actionLabel && params.actionLink) blocks.push({ kind: 'button', label: params.actionLabel, href: params.actionLink });
  return build(params.title, params.message, params.title, blocks, opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reports & alerts
// ─────────────────────────────────────────────────────────────────────────────

export function reportReadyEmail(
  params: { reportName: string; period: string; downloadLink: string; summary?: Array<[string, string]> },
  opts?: TemplateOptions,
): EmailContent {
  const blocks: Block[] = [
    { kind: 'text', text: `Your report “${params.reportName}” for ${params.period} is ready.` },
  ];
  if (params.summary?.length) blocks.push({ kind: 'details', rows: params.summary });
  blocks.push({ kind: 'button', label: 'Download report', href: params.downloadLink });
  return build(`Your report is ready: ${params.reportName}`, `${params.reportName} (${params.period}) is ready to download`, 'Your report is ready', blocks, opts);
}

export function alertEmail(
  params: { title: string; message: string; tone?: Tone; actionLabel?: string; actionLink?: string },
  opts?: TemplateOptions,
): EmailContent {
  const blocks: Block[] = [
    { kind: 'callout', text: params.message, tone: params.tone ?? 'warning' },
  ];
  if (params.actionLabel && params.actionLink) blocks.push({ kind: 'button', label: params.actionLabel, href: params.actionLink });
  return build(`Alert: ${params.title}`, params.message, params.title, blocks, opts);
}

/** Catch-all branded notification for any automated email not covered above. */
export function genericNotificationEmail(
  params: { heading: string; message: string; preheader?: string; actionLabel?: string; actionLink?: string },
  opts?: TemplateOptions,
): EmailContent {
  const blocks: Block[] = [{ kind: 'text', text: params.message }];
  if (params.actionLabel && params.actionLink) blocks.push({ kind: 'button', label: params.actionLabel, href: params.actionLink });
  return build(params.heading, params.preheader ?? params.message, params.heading, blocks, opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Meetings — invitations, reminders, cancellations, minutes
// ─────────────────────────────────────────────────────────────────────────────

export interface MeetingEmailParams {
  title: string;
  whenLabel: string;
  location?: string | null;
  onlineLink?: string | null;
  organizerName?: string | null;
  projectName?: string | null;
  description?: string | null;
  /** Link to open the meeting in the app. */
  link?: string;
}

function meetingRows(p: MeetingEmailParams): Array<[string, string]> {
  const rows: Array<[string, string]> = [['When', p.whenLabel]];
  if (p.location) rows.push(['Where', p.location]);
  if (p.onlineLink) rows.push(['Online', p.onlineLink]);
  if (p.organizerName) rows.push(['Organizer', p.organizerName]);
  rows.push(['Project', p.projectName ?? 'Standalone meeting']);
  return rows;
}

/** Invitation with an .ics calendar file attached (METHOD:REQUEST). */
export function meetingInviteEmail(params: MeetingEmailParams, opts?: TemplateOptions): EmailContent {
  const blocks: Block[] = [
    { kind: 'text', text: `You have been invited to a meeting${params.organizerName ? ` by ${params.organizerName}` : ''}.` },
    { kind: 'details', rows: meetingRows(params) },
  ];
  if (params.description) blocks.push({ kind: 'text', text: params.description });
  if (params.link) blocks.push({ kind: 'button', label: `Open in ${productName(opts)}`, href: params.link });
  blocks.push({ kind: 'callout', text: 'A calendar invitation is attached — open it to add this meeting to your calendar.', tone: 'info' });
  return build(`Invitation: ${params.title}`, `You're invited: ${params.title} — ${params.whenLabel}`, `You're invited: ${params.title}`, blocks, opts);
}

/** A friendly "starts soon" reminder. */
export function meetingReminderEmail(params: MeetingEmailParams & { startsInLabel: string }, opts?: TemplateOptions): EmailContent {
  const blocks: Block[] = [
    { kind: 'text', text: `This is a reminder that "${params.title}" ${params.startsInLabel}.` },
    { kind: 'details', rows: meetingRows(params) },
  ];
  if (params.onlineLink) blocks.push({ kind: 'button', label: 'Join online', href: params.onlineLink });
  else if (params.link) blocks.push({ kind: 'button', label: `Open in ${productName(opts)}`, href: params.link });
  return build(`Reminder: ${params.title}`, `${params.title} ${params.startsInLabel}`, `${params.title} ${params.startsInLabel}`, blocks, opts);
}

/** Cancellation notice with a cancelling .ics attached (METHOD:CANCEL). */
export function meetingCancelledEmail(params: MeetingEmailParams, opts?: TemplateOptions): EmailContent {
  const blocks: Block[] = [
    { kind: 'callout', text: `This meeting has been cancelled${params.organizerName ? ` by ${params.organizerName}` : ''}.`, tone: 'danger' },
    { kind: 'details', rows: meetingRows(params) },
    { kind: 'text', text: 'The attached calendar update will remove this meeting from your calendar.' },
  ];
  return build(`Cancelled: ${params.title}`, `Cancelled: ${params.title} — ${params.whenLabel}`, `Meeting cancelled: ${params.title}`, blocks, opts);
}

/** Minutes distribution with the branded PDF attached. */
export function meetingMinutesEmail(params: MeetingEmailParams, opts?: TemplateOptions): EmailContent {
  const blocks: Block[] = [
    { kind: 'text', text: `The minutes for "${params.title}" are ready. The full document is attached as a PDF.` },
    { kind: 'details', rows: meetingRows(params) },
  ];
  if (params.link) blocks.push({ kind: 'button', label: `Open in ${productName(opts)}`, href: params.link });
  return build(`Minutes: ${params.title}`, `Minutes of ${params.title}`, `Minutes of meeting: ${params.title}`, blocks, opts);
}
