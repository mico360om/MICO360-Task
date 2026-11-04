import { EmailNotConfiguredError } from './delivery-error';

export interface EmailAttachment {
  filename: string;
  contentType: string;
  /** Raw bytes; encoded as Base64 for the transport. */
  content: Buffer;
}

/** One address on an email's To or Cc line, with the name shown beside it. */
export interface EmailAddress {
  email: string;
  name?: string | null;
}

export interface SendEmailInput {
  to: string;
  /**
   * One email to several people, everyone seeing who got it: every To address with its name (`to` is
   * the first one's address) and the Cc line. Omitted: the email goes to `to` alone, as before.
   */
  toAll?: EmailAddress[];
  cc?: EmailAddress[];
  subject: string;
  html: string;
  /** Optional plain-text alternative (improves deliverability + accessibility). */
  text?: string;
  /** File attachments (e.g. a calendar .ics invite or a minutes PDF). */
  attachments?: EmailAttachment[];
  /**
   * It carries a secret link or code (sign-in, password, a client's private page): the provider must
   * not rewrite its links through a click tracker, which would log the secret and hand it on.
   */
  secretLinks?: boolean;
  /** The sender's name for this email (a company's sender name); the address stays MAIL_FROM's. Omitted = MAIL_FROM's name. */
  fromName?: string;
}

export interface SendResult {
  ok: boolean;
  status: number;
  /** Provider message id, when the provider returned one. */
  messageId?: string;
  /** An email to several people: each address's own message id (lower-cased address → id), when given. */
  messageIds?: Record<string, string>;
  /** Provider error text for a failed send. */
  error?: string;
}

/** Transport abstraction — Mailjet in prod, a fake in tests. */
export interface Transport {
  send(input: SendEmailInput): Promise<SendResult>;
  /** False when the transport has no credentials and cannot send anything. Omitted = configured. */
  readonly configured?: boolean;
}

export interface MailjetConfig {
  apiKey: string;
  secretKey: string;
  from: string; // "Name <email@domain>" or "email@domain"
  fetchImpl?: typeof fetch;
  /** Give up on a hung request after this long. Default 15 seconds. */
  timeoutMs?: number;
}

function parseFrom(from: string): { Email: string; Name?: string } {
  const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) return { Email: match[2]!.trim(), Name: match[1]!.trim() || undefined };
  return { Email: from.trim() };
}

type MailjetRecipient = { Email?: string; MessageID?: string | number };

interface MailjetResponse {
  Messages?: Array<{ Status?: string; To?: MailjetRecipient[]; Cc?: MailjetRecipient[]; Errors?: Array<{ ErrorMessage?: string }> }>;
  ErrorMessage?: string;
}

/** A name on one line: no line breaks or other control characters (they could start a header of their own). */
export const oneLineName = (name: string | null | undefined): string =>
  // eslint-disable-next-line no-control-regex
  (name ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

const mailjetAddress = (a: EmailAddress): { Email: string; Name?: string } => {
  const name = oneLineName(a.name);
  return name ? { Email: a.email, Name: name } : { Email: a.email };
};

/** Mailjet Send API v3.1 transport. */
export function createMailjetTransport(config: MailjetConfig): Transport {
  const doFetch = config.fetchImpl ?? fetch;
  const from = parseFrom(config.from);
  const configured = Boolean(config.apiKey?.trim() && config.secretKey?.trim());
  return {
    configured,
    async send(input: SendEmailInput): Promise<SendResult> {
      if (!configured) throw new EmailNotConfiguredError(input.to);
      const auth = Buffer.from(`${config.apiKey}:${config.secretKey}`).toString('base64');
      const res = await doFetch('https://api.mailjet.com/v3.1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(config.timeoutMs ?? 15_000),
        body: JSON.stringify({
          Messages: [
            {
              From: input.fromName ? { ...from, Name: input.fromName } : from,
              To: input.toAll?.length ? input.toAll.map(mailjetAddress) : [{ Email: input.to }],
              ...(input.cc?.length ? { Cc: input.cc.map(mailjetAddress) } : {}),
              Subject: input.subject,
              HTMLPart: input.html,
              ...(input.text ? { TextPart: input.text } : {}),
              ...(input.secretLinks ? { TrackClicks: 'disabled' } : {}),
              ...(input.attachments && input.attachments.length
                ? {
                    Attachments: input.attachments.map((a) => ({
                      ContentType: a.contentType,
                      Filename: a.filename,
                      Base64Content: a.content.toString('base64'),
                    })),
                  }
                : {}),
            },
          ],
        }),
      });
      let body: MailjetResponse = {};
      try {
        body = (await res.json()) as MailjetResponse;
      } catch {
        // Non-JSON body — the HTTP status decides.
      }
      const message = body.Messages?.[0];
      // v3.1 reports per-message status; a 2xx with Status "error" is still a failure.
      const ok = res.ok && (!message?.Status || message.Status === 'success');
      const messageId = message?.To?.[0]?.MessageID;
      const messageIds: Record<string, string> = {};
      for (const r of [...(message?.To ?? []), ...(message?.Cc ?? [])]) {
        if (r.Email && r.MessageID != null) messageIds[r.Email.toLowerCase()] = String(r.MessageID);
      }
      const error = ok ? undefined : message?.Errors?.map((e) => e.ErrorMessage).filter(Boolean).join('; ') || body.ErrorMessage || `HTTP ${res.status}`;
      return {
        ok,
        status: res.status,
        ...(messageId != null ? { messageId: String(messageId) } : {}),
        ...(input.toAll?.length && Object.keys(messageIds).length ? { messageIds } : {}),
        ...(error ? { error } : {}),
      };
    },
  };
}
