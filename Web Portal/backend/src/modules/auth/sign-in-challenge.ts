import { randomUUID } from 'node:crypto';
import { codeMatches, generateSignInCode, hashChallengeToken, hashSignInCode, maskEmail, newChallengeToken } from '../../lib/sign-in-code';
import type { TemplateOptions } from '../email/email-templates';
import { CodeNotSentError, SignInExpiredError, TooManyCodesError, TooManyWrongCodesError, WrongCodeError } from './errors';

/**
 * Onboarding: ONE reusable sign-in challenge — the password was right, a 6-digit code goes to the
 * account's email address, and the code finishes the sign-in. Today it confirms an email address
 * (VERIFY_EMAIL); two-step sign-in (1.24) adds its own kind and reuses everything here.
 *
 * Rules: a code is 6 digits, lives 10 minutes from its send, works once, and is compared in constant
 * time (lib/sign-in-code). A challenge lives 30 minutes at most and dies after 5 wrong codes; an account
 * gets at most 10 wrong codes an hour across challenges, one code a minute and 5 an hour. Signing in
 * again while a challenge is open reuses it — a new token, the same code, no new email — so a double
 * click or a reload never voids the code already in the inbox. Codes and tokens are never logged.
 */
export type ChallengeKind = 'VERIFY_EMAIL';

export interface ChallengeRow {
  id: string;
  userId: string;
  kind: ChallengeKind;
  tokenHash: string;
  codeHash: string;
  /** The address the code went to: an email change ends the challenge. */
  sentTo: string;
  attempts: number;
  sends: number;
  lastSentAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface SignInChallengeStore {
  /** The newest open (unused, unexpired) challenge of this kind for the person to this address. */
  findOpen(userId: string, kind: ChallengeKind, sentTo: string, now: Date): Promise<ChallengeRow | null>;
  create(row: Omit<ChallengeRow, 'attempts' | 'consumedAt'>): Promise<void>;
  /** A new sign-in while it is open: it answers to a new token (the old one stops). False if it ended meanwhile. */
  rotateToken(id: string, tokenHash: string): Promise<boolean>;
  findByTokenHash(tokenHash: string): Promise<ChallengeRow | null>;
  /** A new code went: its hash and times, sends + 1. Only while unused. */
  recordSend(id: string, send: { codeHash: string; at: Date; expiresAt: Date }): Promise<boolean>;
  /** Codes sent to the person since `since` (every send of every challenge last sent since then). */
  sendsSince(userId: string, since: Date): Promise<number>;
  /** Wrong codes the person typed in challenges made since `since`. */
  failuresSince(userId: string, since: Date): Promise<number>;
  /** Count a guess: attempts + 1 while attempts < max and unused. False when it has run out. */
  claimAttempt(id: string, max: number): Promise<boolean>;
  /** Mark it used (and un-count the right guess). False if it was already used. */
  consume(id: string, at: Date): Promise<boolean>;
  /** End every open challenge of the person (their email changed, the account stopped). */
  endAll(userId: string, at: Date): Promise<void>;
}

export interface ChallengeMailer {
  /** False when no mail provider is configured at all. */
  isConfigured(): boolean;
  sendSignInCode(email: string, code: string, opts: { kind: ChallengeKind; expiresInMinutes: number } & TemplateOptions): Promise<unknown>;
}

export interface SignInChallengeDeps {
  store: SignInChallengeStore;
  mailer: ChallengeMailer;
  /** The server's secret the codes are keyed with (never a code itself). */
  key: string;
  now?: () => Date;
  logger?: { warn(msg: string, ctx?: Record<string, unknown>): void };
  /** Companies: the person's company brand on the email. */
  emailOptions?: (userId: string) => Promise<TemplateOptions | undefined>;
}

/** What the website is told about a challenge (never the code; the token only when it is new). */
export interface ChallengeView {
  /** The secret the website sends back with the code (or to ask for another). */
  token: string;
  kind: ChallengeKind;
  /** "a•••@oxy.com" */
  sentTo: string;
  /** False when signing in again reused the open challenge: the code already sent still works. */
  codeSent: boolean;
  /** When another code may be asked for (ISO). */
  resendAt: string;
  /** When the newest code stops working (ISO). */
  expiresAt: string;
}

export interface ResendResult {
  codeSent: boolean;
  resendAt: string;
  expiresAt: string;
  /** When nothing was sent (asked within the minute): the seconds to wait. */
  retryAfterSeconds?: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const CODE_TTL_MS = 10 * MINUTE;
export const CHALLENGE_MAX_LIFE_MS = 30 * MINUTE;
export const RESEND_GAP_MS = MINUTE;
export const WRONG_CODES_PER_CHALLENGE = 5;
export const WRONG_CODES_PER_HOUR = 10;
export const CODES_PER_HOUR = 5;

export function createSignInChallenges(deps: SignInChallengeDeps) {
  const now = deps.now ?? (() => new Date());
  const { store, key } = deps;
  if (!key) throw new Error('sign-in challenges need a key');

  const iso = (d: Date) => d.toISOString();
  const resendAtOf = (row: Pick<ChallengeRow, 'lastSentAt'>) => new Date(row.lastSentAt.getTime() + RESEND_GAP_MS);
  const codeExpiry = (at: Date, createdAt: Date) => new Date(Math.min(at.getTime() + CODE_TTL_MS, createdAt.getTime() + CHALLENGE_MAX_LIFE_MS));
  const isOpen = (row: ChallengeRow, at: Date) => row.consumedAt === null && row.expiresAt.getTime() > at.getTime();

  async function underHourlyLimit(userId: string, at: Date): Promise<boolean> {
    return (await store.sendsSince(userId, new Date(at.getTime() - HOUR))) < CODES_PER_HOUR;
  }

  /** Email a code. A failure is only its words in the log (never the code), and an error for the caller. */
  async function send(row: Pick<ChallengeRow, 'userId' | 'kind' | 'sentTo'>, code: string): Promise<void> {
    const brand = await deps.emailOptions?.(row.userId).catch(() => undefined);
    try {
      await deps.mailer.sendSignInCode(row.sentTo, code, { kind: row.kind, expiresInMinutes: CODE_TTL_MS / MINUTE, ...brand });
    } catch (err) {
      deps.logger?.warn('sign-in code could not be sent', { userId: row.userId, error: err instanceof Error ? err.message : String(err) });
      throw new CodeNotSentError();
    }
  }

  /**
   * The password was right and this sign-in needs a code: email one (or reuse the open challenge, whose
   * code is already in the inbox). Throws TooManyCodesError past the hourly allowance, CodeNotSentError
   * when the email can't go (the challenge is then ended: no one could finish it).
   */
  async function start(user: { id: string; email: string }, kind: ChallengeKind): Promise<ChallengeView> {
    const at = now();
    const sentTo = user.email.trim();
    const { token, tokenHash } = newChallengeToken();
    const open = await store.findOpen(user.id, kind, sentTo, at);
    if (open && isOpen(open, at) && (await store.rotateToken(open.id, tokenHash))) {
      return { token, kind, sentTo: maskEmail(sentTo), codeSent: false, resendAt: iso(resendAtOf(open)), expiresAt: iso(open.expiresAt) };
    }
    if (!(await underHourlyLimit(user.id, at))) throw new TooManyCodesError();
    const id = randomUUID();
    const code = generateSignInCode();
    const row = { id, userId: user.id, kind, tokenHash, codeHash: hashSignInCode(code, key, id), sentTo, sends: 1, lastSentAt: at, expiresAt: codeExpiry(at, at), createdAt: at };
    await store.create(row);
    try {
      await send(row, code);
    } catch (err) {
      await store.consume(id, at).catch(() => undefined);
      throw err;
    }
    return { token, kind, sentTo: maskEmail(sentTo), codeSent: true, resendAt: iso(resendAtOf(row)), expiresAt: iso(row.expiresAt) };
  }

  async function openByToken(token: string, at: Date): Promise<ChallengeRow> {
    const row = await store.findByTokenHash(hashChallengeToken(token));
    if (!row || !isOpen(row, at)) throw new SignInExpiredError();
    return row;
  }

  /** "Send another code": a new code (the earlier one stops), at most one a minute and 5 an hour. */
  async function resend(token: string): Promise<ResendResult> {
    const at = now();
    const row = await openByToken(token, at);
    const resendAt = resendAtOf(row);
    if (resendAt.getTime() > at.getTime()) {
      return { codeSent: false, resendAt: iso(resendAt), expiresAt: iso(row.expiresAt), retryAfterSeconds: Math.max(1, Math.ceil((resendAt.getTime() - at.getTime()) / 1000)) };
    }
    if (row.createdAt.getTime() + CHALLENGE_MAX_LIFE_MS <= at.getTime()) throw new SignInExpiredError();
    if (!(await underHourlyLimit(row.userId, at))) throw new TooManyCodesError();
    const code = generateSignInCode();
    const expiresAt = codeExpiry(at, row.createdAt);
    if (!(await store.recordSend(row.id, { codeHash: hashSignInCode(code, key, row.id), at, expiresAt }))) throw new SignInExpiredError();
    await send(row, code);
    return { codeSent: true, resendAt: iso(new Date(at.getTime() + RESEND_GAP_MS)), expiresAt: iso(expiresAt) };
  }

  /**
   * The code for this challenge: right → the challenge is used up and its person and kind come back
   * (the caller finishes the sign-in). Every guess is counted before it is compared.
   */
  async function verify(token: string, code: string): Promise<{ userId: string; kind: ChallengeKind; sentTo: string }> {
    const at = now();
    const row = await store.findByTokenHash(hashChallengeToken(token));
    if (!row || !isOpen(row, at)) {
      // The same work as a real comparison, so a dead token answers as fast as a live one.
      codeMatches(code, '0'.repeat(64), key, 'none');
      throw new SignInExpiredError();
    }
    if ((await store.failuresSince(row.userId, new Date(at.getTime() - HOUR))) >= WRONG_CODES_PER_HOUR) {
      throw new TooManyWrongCodesError('Too many wrong codes in the last hour. Try again later, or ask your administrator for help.');
    }
    if (!(await store.claimAttempt(row.id, WRONG_CODES_PER_CHALLENGE))) throw new TooManyWrongCodesError();
    if (!codeMatches(code, row.codeHash, key, row.id)) throw new WrongCodeError();
    if (!(await store.consume(row.id, at))) throw new SignInExpiredError();
    return { userId: row.userId, kind: row.kind, sentTo: row.sentTo };
  }

  /** End the person's open challenges (their email changed, their account stopped). */
  async function endAll(userId: string): Promise<void> {
    await store.endAll(userId, now());
  }

  const isConfigured = () => deps.mailer.isConfigured();

  return { start, resend, verify, endAll, isConfigured };
}

export type SignInChallenges = ReturnType<typeof createSignInChallenges>;
