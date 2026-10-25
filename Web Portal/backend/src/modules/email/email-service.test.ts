import { describe, it, expect } from 'vitest';
import { createEmailService, type EmailLogEntry } from './email-service';
import { createMailjetTransport, type SendEmailInput, type SendResult, type Transport } from './mailer';
import { EmailDeliveryError, EmailNotConfiguredError } from './delivery-error';

function fakeTransport(result: SendResult | (() => never) = { ok: true, status: 200, messageId: 'mj-1' }) {
  const sent: SendEmailInput[] = [];
  const transport: Transport = {
    async send(input) {
      sent.push(input);
      if (typeof result === 'function') result();
      return result as SendResult;
    },
  };
  return { transport, sent };
}

function withLog() {
  const entries: EmailLogEntry[] = [];
  return { entries, log: { async record(e: EmailLogEntry) { entries.push(e); } } };
}

describe('EmailService', () => {
  it('sendLoginCode emails the OTP code and logs it as SENT', async () => {
    const { transport, sent } = fakeTransport();
    const { log, entries } = withLog();
    await createEmailService({ transport, log }).sendLoginCode('ada@x.co', '123456');
    expect(sent[0]!.to).toBe('ada@x.co');
    expect(sent[0]!.html).toContain('123456');
    expect(entries).toEqual([{ toAddress: 'ada@x.co', template: 'otp', subject: sent[0]!.subject, status: 'SENT', providerMessageId: 'mj-1' }]);
  });

  it('sendTaskAssigned emails the task key', async () => {
    const { transport, sent } = fakeTransport();
    await createEmailService({ transport }).sendTaskAssigned('ada@x.co', 'Prepare report', 'MICO-1');
    expect(sent[0]!.html).toContain('MICO-1');
  });

  it('does not email a suppressed address (no error) for ordinary mail', async () => {
    const { transport, sent } = fakeTransport();
    const svc = createEmailService({ transport, isSuppressed: async (email) => email === 'bounced@x.co' });
    await expect(svc.sendTaskAssigned('bounced@x.co', 'T', 'K-1')).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
    await svc.sendTaskAssigned('ok@x.co', 'T', 'K-1');
    expect(sent).toHaveLength(1);
  });

  it('never silently suppresses sign-in mail (login codes, reset links)', async () => {
    const { transport, sent } = fakeTransport();
    const warnings: string[] = [];
    const svc = createEmailService({
      transport,
      isSuppressed: async () => true,
      logger: { info() {}, warn: (msg) => void warnings.push(msg) },
    });
    await svc.sendLoginCode('bounced@x.co', '123456');
    await svc.sendPasswordReset('bounced@x.co', 'https://app/reset?token=x');
    expect(sent).toHaveLength(2);
    expect(warnings).toHaveLength(2);
  });

  it('throws EmailDeliveryError and logs FAILED when the provider answers non-2xx', async () => {
    const { transport } = fakeTransport({ ok: false, status: 401, error: 'API key authentication/authorization failure' });
    const { log, entries } = withLog();
    const err = await createEmailService({ transport, log }).sendLoginCode('ada@x.co', '123456').catch((e) => e);
    expect(err).toBeInstanceOf(EmailDeliveryError);
    expect(err.status).toBe(401);
    expect(err.recipient).toBe('ada@x.co');
    expect(entries[0]).toMatchObject({ status: 'FAILED', template: 'otp', error: 'API key authentication/authorization failure' });
  });

  it('throws EmailDeliveryError and logs FAILED when the transport throws (network down)', async () => {
    const { transport } = fakeTransport(() => {
      throw new TypeError('fetch failed');
    });
    const { log, entries } = withLog();
    await expect(createEmailService({ transport, log }).sendNotification('ada@x.co', { heading: 'h', message: 'm' })).rejects.toBeInstanceOf(EmailDeliveryError);
    expect(entries[0]).toMatchObject({ status: 'FAILED', error: 'fetch failed' });
  });

  it('throws EmailNotConfiguredError when no Mailjet keys are set', async () => {
    const transport = createMailjetTransport({ apiKey: '', secretKey: '', from: 'x@y.z' });
    const svc = createEmailService({ transport });
    expect(svc.isConfigured()).toBe(false);
    await expect(svc.sendLoginCode('ada@x.co', '1')).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });

  it('reports configured when keys are present', () => {
    const transport = createMailjetTransport({ apiKey: 'k', secretKey: 's', from: 'x@y.z' });
    expect(createEmailService({ transport }).isConfigured()).toBe(true);
  });

  it('still throws the delivery error when writing the log fails', async () => {
    const { transport } = fakeTransport({ ok: false, status: 500 });
    const svc = createEmailService({ transport, log: { async record() { throw new Error('db down'); } } });
    await expect(svc.sendWelcome('ada@x.co', { firstName: 'Ada', username: 'ada', setPasswordLink: 'https://app.test/reset?token=t1&welcome=1', expiresInDays: 7 })).rejects.toBeInstanceOf(EmailDeliveryError);
  });
});

describe('EmailService.sendWelcome (an administrator’s welcome email)', () => {
  const welcome = { firstName: 'Ada', username: 'ada', setPasswordLink: 'https://app.test/reset?token=t1&welcome=1', expiresInDays: 7 };

  it('sends the set-password email, logged as "welcome" without the link, and says it went', async () => {
    const { transport, sent } = fakeTransport();
    const { log, entries } = withLog();
    const svc = createEmailService({ transport, log });
    expect(await svc.sendWelcome('ada@x.co', welcome)).toBe('sent');
    expect(sent[0]).toMatchObject({ to: 'ada@x.co', subject: expect.stringMatching(/set your password/) });
    expect(sent[0]!.text).toContain('https://app.test/reset?token=t1&welcome=1');
    expect(entries).toEqual([{ toAddress: 'ada@x.co', template: 'welcome', subject: sent[0]!.subject, status: 'SENT', providerMessageId: 'mj-1' }]);
    expect(JSON.stringify(entries)).not.toContain('t1');
  });

  it('never goes to a blocked address (after a bounce or spam complaint): it says so instead', async () => {
    const { transport, sent } = fakeTransport();
    const svc = createEmailService({ transport, isSuppressed: async (email) => email === 'bounced@x.co' });
    expect(await svc.isBlocked('bounced@x.co')).toBe(true);
    expect(await svc.isBlocked('ada@x.co')).toBe(false);
    expect(await svc.sendWelcome('bounced@x.co', welcome)).toBe('suppressed');
    expect(sent).toEqual([]);
  });

  it('nothing is blocked when the server keeps no list of blocked addresses', async () => {
    expect(await createEmailService({ transport: fakeTransport().transport }).isBlocked('ada@x.co')).toBe(false);
  });
});

describe('EmailService.sendPrepared (an email already built, e.g. the daily task emails)', () => {
  it('sends it as it is and logs it under its template', async () => {
    const { transport, sent } = fakeTransport();
    const { log, entries } = withLog();
    await createEmailService({ transport, log }).sendPrepared('daily-pending', 'ada@x.co', { subject: 'Your pending tasks: 2', html: '<p>h</p>', text: 't' });
    expect(sent[0]).toMatchObject({ to: 'ada@x.co', subject: 'Your pending tasks: 2', html: '<p>h</p>', text: 't' });
    expect(entries).toEqual([{ toAddress: 'ada@x.co', template: 'daily-pending', subject: 'Your pending tasks: 2', status: 'SENT', providerMessageId: 'mj-1' }]);
  });

  it('says whether it went or the address is blocked (after a bounce or spam complaint), so the caller never counts that as sent', async () => {
    const { transport, sent } = fakeTransport();
    const svc = createEmailService({ transport, isSuppressed: async (email) => email === 'bounced@x.co' });
    const content = { subject: 's', html: 'h', text: 't' };
    expect(await svc.sendPrepared('daily-pending', 'ada@x.co', content)).toBe('sent');
    expect(await svc.sendPrepared('daily-pending', 'bounced@x.co', content)).toBe('suppressed');
    expect(sent.map((m) => m.to)).toEqual(['ada@x.co']);
  });

  it('throws when it can’t be delivered, so the caller can try again', async () => {
    const { transport } = fakeTransport({ ok: false, status: 503, error: 'busy' });
    await expect(createEmailService({ transport }).sendPrepared('daily-pending', 'ada@x.co', { subject: 's', html: 'h', text: 't' })).rejects.toBeInstanceOf(EmailDeliveryError);
  });
});
