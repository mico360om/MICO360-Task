import { describe, it, expect } from 'vitest';
import { createEmailService } from './email-service';
import { createMailjetTransport, type SendEmailInput, type Transport } from './mailer';

describe('emails carrying a secret link are never click-tracked', () => {
  it('the Mailjet transport turns click tracking off for such an email (and leaves others to the account)', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)).Messages[0]);
      return new Response(JSON.stringify({ Messages: [{ Status: 'success', To: [{ MessageID: 1 }] }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const transport = createMailjetTransport({ apiKey: 'k', secretKey: 's', from: 'x@y.z', fetchImpl });
    await transport.send({ to: 'a@x.co', subject: 'S', html: 'h', secretLinks: true });
    await transport.send({ to: 'a@x.co', subject: 'S', html: 'h' });
    expect(bodies[0]!.TrackClicks).toBe('disabled');
    expect(bodies[1]).not.toHaveProperty('TrackClicks');
  });

  it('the client invitation and code, password reset, welcome, activation and sign-in code emails ask for it', async () => {
    const sent: SendEmailInput[] = [];
    const transport: Transport = { async send(input) { sent.push(input); return { ok: true, status: 200 }; } };
    const email = createEmailService({ transport });
    const params = { clientName: 'F', sharedByName: 'O', projectName: 'P', link: 'https://t.example/client/x', email: 'f@x.co' };
    await email.sendClientInvitation('f@x.co', params);
    await email.sendClientCode('f@x.co', { code: '123456', projectName: 'P', expiresInMinutes: 10 });
    await email.sendPasswordReset('a@x.co', 'https://t.example/reset?token=x');
    await email.sendWelcome('a@x.co', { firstName: 'A', username: 'a', setPasswordLink: 'https://t.example/reset?token=y&welcome=1', expiresInDays: 7 });
    await email.sendActivation('a@x.co', 'a', 'https://t.example/activate?token=z');
    await email.sendLoginCode('a@x.co', '654321');
    expect(sent.map((s) => s.secretLinks)).toEqual([true, true, true, true, true, true]);
    // Ordinary mail is left to the account's settings.
    await email.sendTaskAssigned('a@x.co', 'T', 'K-1');
    expect(sent.at(-1)!.secretLinks).toBeUndefined();
  });
});
