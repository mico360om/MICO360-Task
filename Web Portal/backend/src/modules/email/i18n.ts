/**
 * Lightweight i18n for email chrome (footer, greeting, disclaimers, button
 * fallbacks). English is complete; add a locale by adding a dictionary entry —
 * missing keys fall back to English, so partial translations are safe.
 */
export type Locale = 'en' | 'ar';

type Key =
  | 'greeting'
  | 'hello'
  | 'buttonFallback'
  | 'reasonAccount'
  | 'help'
  | 'contactSupport'
  | 'visitWebsite'
  | 'preferences'
  | 'rightsReserved'
  | 'disclaimer'
  | 'automatedNotice';

const en: Record<Key, string> = {
  greeting: 'Hi',
  hello: 'Hello',
  buttonFallback: "If the button above doesn't work, copy and paste this link into your browser:",
  reasonAccount: 'You’re receiving this email because you have a {product} account.',
  help: 'Help Center',
  contactSupport: 'Contact support',
  visitWebsite: 'Visit website',
  preferences: 'Notification preferences',
  rightsReserved: 'All rights reserved.',
  disclaimer:
    'This email and any attachments are confidential and intended solely for the addressee. If you received it in error, please delete it and notify us.',
  automatedNotice: 'This is an automated message — please do not reply directly to this email.',
};

// Arabic scaffold (extend as needed; missing keys fall back to English).
const ar: Partial<Record<Key, string>> = {
  hello: 'مرحبًا',
  greeting: 'مرحبًا',
  contactSupport: 'تواصل مع الدعم',
  automatedNotice: 'هذه رسالة آلية — يُرجى عدم الرد على هذا البريد مباشرة.',
};

const DICTS: Record<Locale, Partial<Record<Key, string>>> = { en, ar };

/** True for right-to-left locales (affects the email `dir` attribute). */
export function isRtl(locale: Locale): boolean {
  return locale === 'ar';
}

/** Translate a chrome key with `{var}` interpolation, falling back to English. */
export function t(locale: Locale, key: Key, vars?: Record<string, string>): string {
  const template = DICTS[locale]?.[key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`);
}
