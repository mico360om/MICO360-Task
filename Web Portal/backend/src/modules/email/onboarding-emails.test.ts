import { describe, it, expect } from 'vitest';
import { emailChangedEmail, passwordResetEmail, signInCodeEmail, trustedBrowserEmail } from './email-templates';

/** Onboarding's emails, in the existing templates' look: the code, the administrator's reset link, "your email was changed". */
describe('The sign-in code email (confirm your email address)', () => {
  it('carries the code in the body only — never in the subject (the email log keeps subjects)', () => {
    const e = signInCodeEmail('042917', { kind: 'VERIFY_EMAIL', expiresInMinutes: 10, brand: { productName: 'MICO360 Tasks' } });
    expect(e.subject).toBe('Confirm your email address for MICO360 Tasks');
    expect(e.subject).not.toContain('042917');
    expect(e.html).toContain('042917');
    expect(e.text).toContain('042917');
    expect(e.text).toContain('It expires in 10 minutes and works once.');
    expect(e.text).toContain('If you didn’t just sign in, someone may know your password');
  });
});

describe('Password reset sent by an administrator', () => {
  it('says an administrator sent it, that it works for an hour, and that nothing changes until it is used', () => {
    const e = passwordResetEmail('https://t.test/reset?token=abc', { byAdministrator: true, expiresInMinutes: 60 });
    expect(e.subject).toBe('Reset your MICO360 Tasks password');
    expect(e.text).toContain('Your administrator sent you this link to choose a new password.');
    expect(e.text).toContain('It works once and expires in 60 minutes.');
    expect(e.text).toContain('Until you use it, your current password keeps working.');
    expect(e.html).toContain('https://t.test/reset?token=abc');
  });

  it('a "Forgot password?" request keeps its own words', () => {
    expect(passwordResetEmail('https://t.test/reset?token=abc').text).toContain('We received a request to reset your password.');
  });
});

describe('“Your email address was changed” (to the old address)', () => {
  it('names the new address masked, who changed it, and what to do if it was a mistake', () => {
    const e = emailChangedEmail({ firstName: 'Saif', newEmailMasked: 's•••@new.com' }, { brand: { productName: 'MICO360 Tasks' } });
    expect(e.subject).toBe('Your MICO360 Tasks email address was changed');
    expect(e.text).toContain('Hi Saif, an administrator changed the email address on your MICO360 Tasks account to s•••@new.com.');
    expect(e.text).toContain('If you didn’t expect this, contact your administrator.');
    // No secret: no code and no link.
    expect(e.text).not.toMatch(/\b\d{6}\b|token=/);
  });

  it('escapes the name', () => {
    expect(emailChangedEmail({ firstName: '<b>x</b>', newEmailMasked: 'a•••@b.c' }).html).not.toContain('<b>x</b>');
  });
});

// 1.24 two-step sign-in for administrators.
describe('The two-step sign-in code email (1.24)', () => {
  it('has its own subject — "Your MICO360 Tasks sign-in code" — and the code in the body only', () => {
    const e = signInCodeEmail('042917', { kind: 'TWO_STEP', expiresInMinutes: 10, brand: { productName: 'MICO360 Tasks' } });
    expect(e.subject).toBe('Your MICO360 Tasks sign-in code');
    expect(e.subject).not.toContain('042917');
    expect(e.html).toContain('042917');
    expect(e.text).toContain('042917');
    expect(e.text).toContain('Enter this code on the sign-in page to finish signing in to MICO360 Tasks. It expires in 10 minutes and works once.');
    expect(e.text).toContain('If you didn’t just sign in, someone may know your password: change it now.');
    expect(e.text).not.toContain('confirm');
  });
});

describe('“New trusted browser for your admin account” (1.24)', () => {
  it('names the browser and when, and says what to do if it wasn’t them — never a code or a link with a secret', () => {
    const e = trustedBrowserEmail({ browser: 'Chrome on Windows', when: '14 Nov 10:12' }, { brand: { productName: 'MICO360 Tasks' } });
    expect(e.subject).toBe('New trusted browser for your MICO360 Tasks admin account');
    expect(e.text).toContain('New trusted browser for your admin account: Chrome on Windows, 14 Nov 10:12.');
    expect(e.text).toContain('It won’t be asked for a sign-in code for 30 days.');
    expect(e.text).toContain('If this wasn’t you, change your password.');
    expect(e.text).not.toMatch(/\b\d{6}\b|token=/);
  });
});
