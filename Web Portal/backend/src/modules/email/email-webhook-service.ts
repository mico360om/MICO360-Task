export type EmailStatusName = 'SENT' | 'OPENED' | 'CLICKED' | 'BOUNCED' | 'SPAM' | 'BLOCKED' | 'FAILED';

/**
 * Statuses that mean we should stop emailing an address: hard bounces and spam complaints only.
 * Soft bounces (mailbox full, greylisting) are recorded as FAILED and never suppress.
 */
export const SUPPRESSING: EmailStatusName[] = ['BOUNCED', 'SPAM'];

/** Map a Mailjet Event-API event name to our EmailStatus (null = ignore). */
export function mapMailjetEvent(event: string, hardBounce = false): EmailStatusName | null {
  switch (event) {
    case 'sent': return 'SENT';
    case 'open': return 'OPENED';
    case 'click': return 'CLICKED';
    case 'bounce': return hardBounce ? 'BOUNCED' : 'FAILED';
    case 'spam': return 'SPAM';
    case 'blocked': return 'BLOCKED';
    // Unsubscribes come from marketing lists; our mail is transactional (codes, invitations).
    default: return null;
  }
}

export interface EmailEvent {
  event: string;
  email: string;
  MessageID?: string | number;
  /** Mailjet bounce events: true for a permanent failure. */
  hard_bounce?: boolean;
  error?: string;
  error_related_to?: string;
}

export interface EmailEventStore {
  record(e: { toAddress: string; status: EmailStatusName; providerMessageId?: string; detail?: string }): Promise<void>;
}

export function createEmailWebhookService({ store }: { store: EmailEventStore }) {
  /** Record a batch of Mailjet events; hard bounces and spam complaints become suppression signals (T20.5). */
  async function handleEvents(events: EmailEvent[]): Promise<{ recorded: number }> {
    let recorded = 0;
    for (const ev of events) {
      if (!ev || typeof ev !== 'object' || typeof ev.event !== 'string' || typeof ev.email !== 'string') continue;
      const status = mapMailjetEvent(ev.event, ev.hard_bounce === true);
      if (!status || !ev.email) continue;
      const detail = [ev.error_related_to, ev.error].filter(Boolean).join(': ');
      await store.record({
        toAddress: ev.email,
        status,
        providerMessageId: ev.MessageID != null ? String(ev.MessageID) : undefined,
        ...(detail ? { detail } : {}),
      });
      recorded++;
    }
    return { recorded };
  }

  return { handleEvents };
}

export type EmailWebhookService = ReturnType<typeof createEmailWebhookService>;
