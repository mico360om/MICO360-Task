import { describe, it, expect } from 'vitest';
import { createMailjetTransport } from './mailer';
import { EmailNotConfiguredError } from './delivery-error';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('Mailjet transport', () => {
  it('posts a message to the Mailjet Send API and reports success with the message id', async () => {
    const { impl, calls } = fakeFetch(200, { Messages: [{ Status: 'success', To: [{ Email: 'ada@x.co', MessageID: 1152921500000000 }] }] });
    const transport = createMailjetTransport({ apiKey: 'k', secretKey: 's', from: 'MICO360 Tasks <no-reply@mico360.test>', fetchImpl: impl });
    const res = await transport.send({ to: 'ada@x.co', subject: 'Hi', html: '<p>x</p>' });

    expect(res.ok).toBe(true);
    expect(res.messageId).toBe('1152921500000000');
    expect(calls[0]!.url).toContain('mailjet.com');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.Messages[0].To[0].Email).toBe('ada@x.co');
    expect(body.Messages[0].Subject).toBe('Hi');
    expect(body.Messages[0].From.Email).toBe('no-reply@mico360.test');
    expect(String((calls[0]!.init.headers as Record<string, string>).Authorization)).toMatch(/^Basic /);
    expect(calls[0]!.init.signal).toBeDefined(); // requests time out
  });

  it('reports a non-2xx answer as a failure with the provider’s error text', async () => {
    const { impl } = fakeFetch(401, { ErrorMessage: 'API key authentication/authorization failure' });
    const transport = createMailjetTransport({ apiKey: 'k', secretKey: 's', from: 'x@y.z', fetchImpl: impl });
    const res = await transport.send({ to: 'ada@x.co', subject: 'Hi', html: 'x' });
    expect(res).toMatchObject({ ok: false, status: 401, error: 'API key authentication/authorization failure' });
  });

  it('treats a per-message "error" status as a failure even on HTTP 200', async () => {
    const { impl } = fakeFetch(200, { Messages: [{ Status: 'error', Errors: [{ ErrorMessage: 'Invalid email' }] }] });
    const transport = createMailjetTransport({ apiKey: 'k', secretKey: 's', from: 'x@y.z', fetchImpl: impl });
    expect(await transport.send({ to: 'bad', subject: 'Hi', html: 'x' })).toMatchObject({ ok: false, error: 'Invalid email' });
  });

  it('copes with a non-JSON body', async () => {
    const { impl } = fakeFetch(502, '<html>Bad gateway</html>');
    const transport = createMailjetTransport({ apiKey: 'k', secretKey: 's', from: 'x@y.z', fetchImpl: impl });
    expect(await transport.send({ to: 'a@b.c', subject: 'Hi', html: 'x' })).toMatchObject({ ok: false, status: 502 });
  });

  it('is not configured without keys and refuses to send', async () => {
    const { impl, calls } = fakeFetch(200, {});
    const transport = createMailjetTransport({ apiKey: '', secretKey: ' ', from: 'x@y.z', fetchImpl: impl });
    expect(transport.configured).toBe(false);
    await expect(transport.send({ to: 'a@b.c', subject: 'Hi', html: 'x' })).rejects.toBeInstanceOf(EmailNotConfiguredError);
    expect(calls).toHaveLength(0);
  });
});
