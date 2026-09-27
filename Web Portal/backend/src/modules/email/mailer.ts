import { EmailNotConfiguredError } from './delivery-error';

export interface EmailAttachment {
  filename: string;
  contentType: string;
  /** Raw bytes; encoded as Base64 for the transport. */
  content: Buffer;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /** Optional plain-text alternative (improves deliverability + accessibility). */
  text?: string;
  /** File attachments (e.g. a calendar .ics invite or a minutes PDF). */
  attachments?: EmailAttachment[];
}

export interface SendResult {
  ok: boolean;
  status: number;
  /** Provider message id, when the provider returned one. */
  messageId?: string;
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

interface MailjetResponse {
  Messages?: Array<{ Status?: string; To?: Array<{ MessageID?: string | number }>; Errors?: Array<{ ErrorMessage?: string }> }>;
  ErrorMessage?: string;
}

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
              From: from,
              To: [{ Email: input.to }],
              Subject: input.subject,
              HTMLPart: input.html,
              ...(input.text ? { TextPart: input.text } : {}),
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
      const error = ok ? undefined : message?.Errors?.map((e) => e.ErrorMessage).filter(Boolean).join('; ') || body.ErrorMessage || `HTTP ${res.status}`;
      return { ok, status: res.status, ...(messageId != null ? { messageId: String(messageId) } : {}), ...(error ? { error } : {}) };
    },
  };
}
