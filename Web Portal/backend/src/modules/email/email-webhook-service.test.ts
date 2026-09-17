import { describe, it, expect } from 'vitest';
import { mapMailjetEvent, createEmailWebhookService, SUPPRESSING } from './email-webhook-service';

describe('mapMailjetEvent', () => {
  it('maps known events and ignores unknown ones', () => {
    expect(mapMailjetEvent('sent')).toBe('SENT');
    expect(mapMailjetEvent('bounce')).toBe('BOUNCED');
    expect(mapMailjetEvent('spam')).toBe('SPAM');
    expect(mapMailjetEvent('blocked')).toBe('BLOCKED');
    expect(mapMailjetEvent('unsub')).toBe('BLOCKED');
    expect(mapMailjetEvent('mystery')).toBeNull();
  });
  it('flags the suppressing statuses', () => {
    expect(SUPPRESSING).toEqual(expect.arrayContaining(['BOUNCED', 'SPAM', 'BLOCKED']));
  });
});

describe('EmailWebhookService.handleEvents', () => {
  it('records mapped events (with the message id) and skips unknown/empty ones', async () => {
    const recorded: unknown[] = [];
    const svc = createEmailWebhookService({ store: { async record(e) { recorded.push(e); } } });
    const result = await svc.handleEvents([
      { event: 'bounce', email: 'a@x.com', MessageID: 123 },
      { event: 'open', email: 'b@x.com' },
      { event: 'mystery', email: 'c@x.com' }, // ignored
      { event: 'spam', email: '' }, // ignored (no address)
    ]);
    expect(result).toEqual({ recorded: 2 });
    expect(recorded).toEqual([
      { toAddress: 'a@x.com', status: 'BOUNCED', providerMessageId: '123' },
      { toAddress: 'b@x.com', status: 'OPENED', providerMessageId: undefined },
    ]);
  });
});
