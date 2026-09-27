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
    await expect(svc.sendWelcome('ada@x.co', 'ada')).rejects.toBeInstanceOf(EmailDeliveryError);
  });
});
