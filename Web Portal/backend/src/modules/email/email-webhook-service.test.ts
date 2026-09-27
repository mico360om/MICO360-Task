import { describe, it, expect } from 'vitest';
import { mapMailjetEvent, createEmailWebhookService, SUPPRESSING } from './email-webhook-service';

describe('mapMailjetEvent', () => {
  it('maps known events and ignores unknown ones', () => {
    expect(mapMailjetEvent('sent')).toBe('SENT');
    expect(mapMailjetEvent('bounce', true)).toBe('BOUNCED');
    expect(mapMailjetEvent('spam')).toBe('SPAM');
    expect(mapMailjetEvent('blocked')).toBe('BLOCKED');
    expect(mapMailjetEvent('mystery')).toBeNull();
  });

  it('records a soft bounce as FAILED, not as a (suppressing) bounce', () => {
    expect(mapMailjetEvent('bounce')).toBe('FAILED');
    expect(mapMailjetEvent('bounce', false)).toBe('FAILED');
  });

  it('ignores unsubscribes (transactional mail)', () => {
    expect(mapMailjetEvent('unsub')).toBeNull();
  });

  it('suppresses only hard bounces and spam complaints', () => {
    expect([...SUPPRESSING].sort()).toEqual(['BOUNCED', 'SPAM']);
  });
});

describe('EmailWebhookService.handleEvents', () => {
  it('records mapped events (with the message id) and skips unknown/empty ones', async () => {
    const recorded: unknown[] = [];
    const svc = createEmailWebhookService({ store: { async record(e) { recorded.push(e); } } });
    const result = await svc.handleEvents([
      { event: 'bounce', email: 'a@x.com', MessageID: 123, hard_bounce: true, error_related_to: 'recipient', error: 'user unknown' },
      { event: 'bounce', email: 'full@x.com', hard_bounce: false },
      { event: 'open', email: 'b@x.com' },
      { event: 'mystery', email: 'c@x.com' }, // ignored
      { event: 'spam', email: '' }, // ignored (no address)
      null as never, // ignored (malformed)
    ]);
    expect(result).toEqual({ recorded: 3 });
    expect(recorded).toEqual([
      { toAddress: 'a@x.com', status: 'BOUNCED', providerMessageId: '123', detail: 'recipient: user unknown' },
      { toAddress: 'full@x.com', status: 'FAILED', providerMessageId: undefined },
      { toAddress: 'b@x.com', status: 'OPENED', providerMessageId: undefined },
    ]);
  });
});
