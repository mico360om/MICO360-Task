import { describe, it, expect } from 'vitest';
import { createEmailService } from './email-service';
import type { SendEmailInput, Transport } from './mailer';

function fakeTransport() {
  const sent: SendEmailInput[] = [];
  const transport: Transport = {
    async send(input) {
      sent.push(input);
      return { ok: true, status: 200 };
    },
  };
  return { transport, sent };
}

describe('EmailService', () => {
  it('sendLoginCode emails the OTP code', async () => {
    const { transport, sent } = fakeTransport();
    await createEmailService({ transport }).sendLoginCode('ada@x.co', '123456');
    expect(sent[0]!.to).toBe('ada@x.co');
    expect(sent[0]!.html).toContain('123456');
  });

  it('sendTaskAssigned emails the task key', async () => {
    const { transport, sent } = fakeTransport();
    await createEmailService({ transport }).sendTaskAssigned('ada@x.co', 'Prepare report', 'MICO-1');
    expect(sent[0]!.html).toContain('MICO-1');
  });

  it('does not email a suppressed address', async () => {
    const { transport, sent } = fakeTransport();
    const svc = createEmailService({ transport, isSuppressed: async (email) => email === 'bounced@x.co' });
    await svc.sendLoginCode('bounced@x.co', '123456');
    expect(sent).toHaveLength(0);
    await svc.sendLoginCode('ok@x.co', '654321');
    expect(sent).toHaveLength(1);
  });
});
