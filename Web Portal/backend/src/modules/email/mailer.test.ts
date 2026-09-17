import { describe, it, expect } from 'vitest';
import { createMailjetTransport } from './mailer';

describe('Mailjet transport', () => {
  it('posts a message to the Mailjet Send API and reports success', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const transport = createMailjetTransport({ apiKey: 'k', secretKey: 's', from: 'MICO360 Tasks <no-reply@mico360.test>', fetchImpl: fakeFetch });
    const res = await transport.send({ to: 'ada@x.co', subject: 'Hi', html: '<p>x</p>' });

    expect(res.ok).toBe(true);
    expect(calls[0]!.url).toContain('mailjet.com');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.Messages[0].To[0].Email).toBe('ada@x.co');
    expect(body.Messages[0].Subject).toBe('Hi');
    expect(body.Messages[0].From.Email).toBe('no-reply@mico360.test');
    expect(String((calls[0]!.init.headers as Record<string, string>).Authorization)).toMatch(/^Basic /);
  });
});
