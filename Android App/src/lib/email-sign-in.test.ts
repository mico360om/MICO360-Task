import { describe, it, expect } from 'vitest';
import { fetchEmailEnabled, resendWaitSeconds, resendLabel, normaliseCode, isCodeComplete, RESEND_AFTER_SECONDS } from './email-sign-in';

const respond = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('fetchEmailEnabled (whether the server can email codes and reset links)', () => {
  it('reads the server’s own answer', async () => {
    expect(await fetchEmailEnabled('https://x.co/api/v1', respond(200, { data: { emailEnabled: true } }))).toBe(true);
    expect(await fetchEmailEnabled('https://x.co/api/v1', respond(200, { data: { emailEnabled: false } }))).toBe(false);
  });

  it('asks the /config address of the chosen server', async () => {
    const asked: string[] = [];
    const impl = (async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify({ data: { emailEnabled: true } }), { status: 200 });
    }) as unknown as typeof fetch;
    await fetchEmailEnabled('http://192.168.1.20:4000/api/v1', impl);
    expect(asked).toEqual(['http://192.168.1.20:4000/api/v1/config']);
  });

  it('says "unknown" (null) when the server cannot be asked or does not say', async () => {
    expect(await fetchEmailEnabled('https://x.co/api/v1', respond(500, {}))).toBeNull();
    expect(await fetchEmailEnabled('https://x.co/api/v1', respond(200, { data: {} }))).toBeNull();
    const offline = (async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch;
    expect(await fetchEmailEnabled('https://x.co/api/v1', offline)).toBeNull();
  });
});

describe('resending a code', () => {
  it('waits a minute after a code was sent, as the server does', () => {
    const sentAt = 1_000_000;
    expect(RESEND_AFTER_SECONDS).toBe(60);
    expect(resendWaitSeconds(sentAt, sentAt)).toBe(60);
    expect(resendWaitSeconds(sentAt, sentAt + 18_000)).toBe(42);
    expect(resendWaitSeconds(sentAt, sentAt + 59_500)).toBe(1);
    expect(resendWaitSeconds(sentAt, sentAt + 60_000)).toBe(0);
    expect(resendWaitSeconds(null, sentAt)).toBe(0);
  });

  it('labels the button with the time left', () => {
    expect(resendLabel(60)).toBe('Resend code in 1:00');
    expect(resendLabel(42)).toBe('Resend code in 0:42');
    expect(resendLabel(0)).toBe('Resend code');
  });
});

describe('the code box', () => {
  it('keeps digits only, up to 10 (the longest code the server can send)', () => {
    expect(normaliseCode('123 456')).toBe('123456');
    expect(normaliseCode('12-34-56-78-90-12')).toBe('1234567890');
    expect(normaliseCode('abc')).toBe('');
  });

  it('accepts a code of 4 to 10 digits', () => {
    expect(isCodeComplete('123')).toBe(false);
    expect(isCodeComplete('1234')).toBe(true);
    expect(isCodeComplete('123456')).toBe(true);
  });
});

describe('the code box — Arabic digits', () => {
  it('turns Arabic-Indic and Persian digits into the code', () => {
    expect(normaliseCode('١٢٣٤٥٦')).toBe('123456');
    expect(normaliseCode('۱۲۳ ۴۵۶')).toBe('123456');
  });
});
