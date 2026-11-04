import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMailjetTransport, oneLineName, type EmailAddress, type MailjetConfig, type SendEmailInput, type SendResult, type Transport } from './mailer';

/**
 * A local test mailbox: every email is saved as two files instead of being sent — the HTML as the
 * recipient would see it, and a plain-text file with the address, subject and text body — plus any
 * calendar file it carries (to open in a calendar app or check). With it, sign-in codes,
 * password-reset links and invitations can be tried on a computer without a mail provider. It is
 * never used in production (see chooseTransport).
 */
export interface OutboxConfig {
  dir: string;
  now?: () => Date;
}

/** "2026-10-10T08:30:05.123Z" → "20261010-083005123" (sorts in sending order). */
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '').slice(0, 18);
/** A file-name-safe form of the address. */
const slug = (to: string) => to.trim().toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
/** "Ada Lovelace <ada@x.co>" (a name with a comma or the like is quoted), or the bare address. */
const addressText = (a: EmailAddress): string => {
  const name = oneLineName(a.name);
  if (!name) return a.email;
  return `${/[",;<>@]/.test(name) ? `"${name.replace(/"/g, "'")}"` : name} <${a.email}>`;
};

export function createOutboxTransport({ dir, now = () => new Date() }: OutboxConfig): Transport {
  let sequence = 0;
  return {
    configured: true,
    async send(input: SendEmailInput): Promise<SendResult> {
      mkdirSync(dir, { recursive: true });
      const base = `${stamp(now())}${sequence++ ? `-${sequence}` : ''}-${slug(input.to)}`;
      const attachments = (input.attachments ?? []).map((a) => `${a.filename} (${a.contentType}, ${a.content.length} bytes)`);
      const header = [
        // An email to several people: its real To and Cc lines, as each of them sees them.
        `To: ${input.toAll?.length ? input.toAll.map(addressText).join(', ') : input.to}`,
        ...(input.cc?.length ? [`Cc: ${input.cc.map(addressText).join(', ')}`] : []),
        `Subject: ${input.subject}`,
        // companies: the sender name, only when it isn't MAIL_FROM's (a company's own).
        ...(input.fromName ? [`From: ${input.fromName}`] : []),
        ...(attachments.length ? [`Attachments: ${attachments.join(', ')}`] : []),
      ];
      writeFileSync(join(dir, `${base}.html`), `<!-- ${header.join(' · ').replace(/--/g, '- -')} -->\n${input.html}`, 'utf8');
      writeFileSync(join(dir, `${base}.txt`), `${header.join('\n')}\n\n${input.text ?? ''}\n`, 'utf8');
      for (const a of input.attachments ?? []) {
        if (a.contentType.startsWith('text/calendar')) writeFileSync(join(dir, `${base}.${slug(a.filename)}`), a.content);
      }
      return { ok: true, status: 200, messageId: `outbox-${base}` };
    },
  };
}

export interface TransportChoice {
  transport: Transport;
  /** mailjet: real email · outbox: saved to files (development only) · none: email is off. */
  kind: 'mailjet' | 'outbox' | 'none';
  /** An outbox was asked for in production and refused. */
  outboxIgnored: boolean;
}

/**
 * Which way email goes out: Mailjet whenever its keys are set; otherwise the local test mailbox when
 * EMAIL_OUTBOX_DIR is set and this is not production; otherwise nowhere (email features stay off).
 */
export function chooseTransport(opts: { nodeEnv: string; mailjet: MailjetConfig; outboxDir?: string }): TransportChoice {
  const mailjet = createMailjetTransport(opts.mailjet);
  if (mailjet.configured) return { transport: mailjet, kind: 'mailjet', outboxIgnored: false };
  const dir = opts.outboxDir?.trim();
  if (dir && opts.nodeEnv !== 'production') return { transport: createOutboxTransport({ dir }), kind: 'outbox', outboxIgnored: false };
  return { transport: mailjet, kind: 'none', outboxIgnored: Boolean(dir) };
}
