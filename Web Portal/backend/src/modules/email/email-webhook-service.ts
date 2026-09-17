export type EmailStatusName = 'SENT' | 'OPENED' | 'CLICKED' | 'BOUNCED' | 'SPAM' | 'BLOCKED';

/** Statuses that mean we should stop emailing an address. */
export const SUPPRESSING: EmailStatusName[] = ['BOUNCED', 'SPAM', 'BLOCKED'];

/** Map a Mailjet Event-API event name to our EmailStatus (null = ignore). */
export function mapMailjetEvent(event: string): EmailStatusName | null {
  switch (event) {
    case 'sent': return 'SENT';
    case 'open': return 'OPENED';
    case 'click': return 'CLICKED';
    case 'bounce': return 'BOUNCED';
    case 'spam': return 'SPAM';
    case 'blocked': return 'BLOCKED';
    case 'unsub': return 'BLOCKED';
    default: return null;
  }
}

export interface EmailEvent {
  event: string;
  email: string;
  MessageID?: string | number;
}

export interface EmailEventStore {
  record(e: { toAddress: string; status: EmailStatusName; providerMessageId?: string }): Promise<void>;
}

export function createEmailWebhookService({ store }: { store: EmailEventStore }) {
  /** Record a batch of Mailjet events; hard bounces/spam/blocks become suppression signals (T20.5). */
  async function handleEvents(events: EmailEvent[]): Promise<{ recorded: number }> {
    let recorded = 0;
    for (const ev of events) {
      const status = mapMailjetEvent(ev.event);
      if (!status || !ev.email) continue;
      await store.record({
        toAddress: ev.email,
        status,
        providerMessageId: ev.MessageID != null ? String(ev.MessageID) : undefined,
      });
      recorded++;
    }
    return { recorded };
  }

  return { handleEvents };
}

export type EmailWebhookService = ReturnType<typeof createEmailWebhookService>;
