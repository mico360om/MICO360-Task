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
}

/** Transport abstraction — Mailjet in prod, a fake in tests. */
export interface Transport {
  send(input: SendEmailInput): Promise<SendResult>;
}

export interface MailjetConfig {
  apiKey: string;
  secretKey: string;
  from: string; // "Name <email@domain>" or "email@domain"
  fetchImpl?: typeof fetch;
}

function parseFrom(from: string): { Email: string; Name?: string } {
  const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) return { Email: match[2]!.trim(), Name: match[1]!.trim() || undefined };
  return { Email: from.trim() };
}

/** Mailjet Send API v3.1 transport. */
export function createMailjetTransport(config: MailjetConfig): Transport {
  const doFetch = config.fetchImpl ?? fetch;
  const from = parseFrom(config.from);
  return {
    async send(input: SendEmailInput): Promise<SendResult> {
      const auth = Buffer.from(`${config.apiKey}:${config.secretKey}`).toString('base64');
      const res = await doFetch('https://api.mailjet.com/v3.1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
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
      return { ok: res.ok, status: res.status };
    },
  };
}
