import { describe, it, expect } from 'vitest';
import { appSource as src, hasWeb, loadWebTs, readWeb } from '../testing/web-source';
import { createMemoryStore } from './storage';
import {
  askedTooSoon,
  CODE_SENT,
  CODE_STEP_KEY,
  createCodeStepMemory,
  fetchEmailEnabled,
  isCodeComplete,
  NEW_CODE_SENT,
  normaliseCode,
  RESEND_AFTER_MS,
  resendLabel,
  resendWaitSeconds,
  waitFromAnswer,
} from './email-sign-in';

const T0 = 1_800_000_000_000;

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
  it('Resend waits until resendAt', () => {
    expect(resendWaitSeconds(T0 + 30_000, T0)).toBe(30);
    expect(resendWaitSeconds(null, T0)).toBe(0);
    expect(RESEND_AFTER_MS).toBe(60_000);
    expect(resendWaitSeconds(T0 + RESEND_AFTER_MS, T0)).toBe(60);
    expect(resendWaitSeconds(T0 + RESEND_AFTER_MS, T0 + 59_500)).toBe(1);
    expect(resendWaitSeconds(T0 + RESEND_AFTER_MS, T0 + 60_000)).toBe(0);
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

describe('asked too soon, and a step that survives Android closing the app', () => {
  it('a code asked for too soon: the server’s wait, rounded up', () => {
    expect(waitFromAnswer({ sent: false, retryAfterSeconds: 37.2 })).toBe(38);
    expect(waitFromAnswer({ sent: true })).toBeNull();
    expect(waitFromAnswer(undefined)).toBeNull();
    expect(askedTooSoon(38)).toContain('ask again in 38\u00a0s');
  });

  it('the code step survives Android closing the app, for the 10 minutes a code lasts', async () => {
    const store = createMemoryStore();
    const m = createCodeStepMemory(store);
    await m.remember({ identifier: 'sara@mico360.com', resendAt: T0 + 60_000 });
    expect(await createCodeStepMemory(store).recall(T0 + 5 * 60_000)).toEqual({ identifier: 'sara@mico360.com', resendAt: T0 + 60_000 });
    expect(await m.recall(T0 + 10 * 60_000 + 1)).toBeNull();
    expect(await store.getItem(CODE_STEP_KEY)).toBeNull();
    await store.setItem(CODE_STEP_KEY, '{bad');
    expect(await m.recall(T0)).toBeNull();
    await m.remember({ identifier: 'sara@mico360.com', resendAt: T0 + 60_000 });
    await m.forget();
    expect(await m.recall(T0)).toBeNull();
  });

  it('a store that fails never throws', async () => {
    const broken = { getItem: async () => Promise.reject(new Error('disk')), setItem: async () => Promise.reject(new Error('disk')), deleteItem: async () => Promise.reject(new Error('disk')) };
    const m = createCodeStepMemory(broken);
    await expect(m.remember({ identifier: 'a', resendAt: T0 })).resolves.toBeUndefined();
    await expect(m.recall(T0)).resolves.toBeNull();
    await expect(m.forget()).resolves.toBeUndefined();
  });
});

describe.skipIf(!hasWeb('frontend/src/lib/login-code-step.ts', 'frontend/src/pages/LoginPage.tsx'))('the website’s words and rules', () => {
  it('same wait rule, words and resend gap', () => {
    const web = loadWebTs('frontend/src/lib/login-code-step.ts') as Record<string, unknown>;
    for (const a of [{ sent: false, retryAfterSeconds: 0.2 }, { sent: false, retryAfterSeconds: 59 }, { sent: true }, null]) expect(waitFromAnswer(a)).toBe((web.waitFromAnswer as typeof waitFromAnswer)(a));
    expect(askedTooSoon(12)).toBe((web.askedTooSoon as typeof askedTooSoon)(12));
    expect(NEW_CODE_SENT).toBe(web.NEW_CODE_SENT);
    expect(RESEND_AFTER_MS).toBe(web.RESEND_AFTER_MS);
    expect(CODE_STEP_KEY).toBe('mico360.signInCode');
    expect(readWeb('frontend/src/pages/LoginPage.tsx')).toContain(`const CODE_SENT = '${CODE_SENT}';`);
  });
});

it('LoginScreen forgets the step on every sign-in and on going back (Review Focus 5)', () => {
  const s = src('screens/auth/LoginScreen.tsx');
  expect(s).toMatch(/async function afterLogin[^]*?setSession\(s\);\s*await codeSteps\.forget\(\);/);
  expect(s).toMatch(/async function signInWithBiometrics[^]*?setSession\(s\);\s*await codeSteps\.forget\(\);/);
  expect(s).toMatch(/function useDifferentAddress\(\)[^]*?codeSteps\.forget\(\)/);
  expect(s).toMatch(/waitFromAnswer\(/);
  expect(s).toMatch(/const codeSteps = useMemo\(\(\) => createCodeStepMemory\(asyncStore\), \[\]\)/);
  // Kept while /config hasn't answered; only a "no" takes the Email code step away.
  expect(s).toMatch(/emailEnabled === false && mode === 'otp'/);
});
