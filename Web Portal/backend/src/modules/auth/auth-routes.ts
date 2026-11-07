import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { toPublicUser, type AuthService } from './auth-service';
import type { TokenService } from './token-service';
import type { OtpService } from './otp-service';
import type { PasswordResetService } from './password-reset-service';
import type { SignInChallenges } from './sign-in-challenge';
import type { EmailVerification } from './email-verification';
import type { FirstPassword } from './first-password';
import { EmailNotVerifiedError, SignInExpiredError } from './errors';

export interface AuthRouteDeps {
  authService: AuthService;
  tokenService: TokenService;
  otpService?: OtpService;
  passwordResetService?: PasswordResetService;
  /**
   * Onboarding: an account whose email address isn't confirmed enters an emailed code before a session
   * (the website asks for it with `acceptChallenge`; other callers are refused with plain words).
   */
  signInChallenges?: SignInChallenges;
  emailVerification?: EmailVerification;
  /**
   * 1.23.6: a temporary password signs in only as far as "Choose your own password" (the website says it
   * can take that step with `acceptPasswordChange`; other callers are told to use the website first).
   */
  firstPassword?: FirstPassword;
  /** 1.23.6: "changed at first sign-in" goes to the audit log (never a password). */
  auditService?: { record(entry: { userId: string | null; ip: string | null; module: string; action: string; entityId: string | null; newValue?: unknown }): Promise<unknown> };
}

const identifier = z.string().trim().min(1).max(191);
const loginSchema = z.object({
  identifier,
  password: z.string().min(1).max(200),
  // Onboarding: the website can take the emailed-code step (the app and the extension can't, yet).
  acceptChallenge: z.boolean().optional(),
  // 1.23.6: and the "Choose your own password" step after a temporary password.
  acceptPasswordChange: z.boolean().optional(),
});
const challengeToken = z.string().trim().min(1).max(200);
const challengeVerifySchema = z.object({ challenge: challengeToken, code: z.string().trim().min(1).max(20), acceptPasswordChange: z.boolean().optional() });
const challengeResendSchema = z.object({ challenge: challengeToken });
const otpRequestSchema = z.object({ identifier });
const otpVerifySchema = z.object({ identifier, code: z.string().trim().min(1).max(20), acceptPasswordChange: z.boolean().optional() });
const firstChangeSchema = z.object({ ticket: z.string().min(1).max(600), password: z.string().min(1).max(200) });
const forgotSchema = z.object({ identifier });
const resetSchema = z.object({ token: z.string().min(1).max(200), password: z.string().min(1).max(200) });
const linkStatusSchema = z.object({ token: z.string().min(1).max(200) });
const refreshSchema = z.object({ refreshToken: z.string().min(1).max(2000) });
const biometricSignInSchema = z.object({ credential: z.string().min(1).max(2000) });
const biometricRevokeSchema = z.object({ refreshToken: z.string().min(1).max(2000), keyId: z.string().regex(/^[0-9a-f]{64}$/) });
const SESSION_EXPIRED = { code: 'INVALID_REFRESH_TOKEN', message: 'Session expired. Please sign in again.' };

export async function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): Promise<void> {
  const challenges = deps.signInChallenges;
  const verification = deps.emailVerification;
  const firstPassword = deps.firstPassword;
  /** 1.23.6: a temporary password still to change: the step (website) or the plain refusal; null: go on. */
  const passwordStep = async (userId: string, website: boolean | undefined, opts: { viaEmailCode?: boolean } = {}) =>
    firstPassword ? firstPassword.gate(userId, website === true, opts) : null;

  app.post('/auth/login', async (req, reply) => {
    const { identifier, password, acceptChallenge, acceptPasswordChange } = loginSchema.parse(req.body);
    const user = await deps.authService.login(identifier, password);
    // 1.23.6: a cancelled invitation signs nobody in (the same answer as a wrong password); an unused
    // temporary password past its lifetime stops (said only after the right password).
    await firstPassword?.refuseUnusable(user.id);
    // Onboarding: the right password, but the address isn't confirmed yet (and email works): the code
    // step first. Said only now, after the password, like an inactive account.
    if (verification && (await verification.needsCode(user.id))) {
      if (!acceptChallenge || !challenges) throw new EmailNotVerifiedError();
      const challenge = await challenges.start({ id: user.id, email: user.email }, 'VERIFY_EMAIL');
      return reply.send({ data: { challenge } });
    }
    const changePassword = await passwordStep(user.id, acceptPasswordChange);
    if (changePassword) return reply.send({ data: { changePassword } });
    const tokens = await deps.tokenService.issueTokens(user);
    await deps.authService.recordSignIn(user.id);
    return reply.send({ data: { user: toPublicUser(user), ...tokens } });
  });

  if (challenges) {
    // The code from the email: the session (the same answer as a password sign-in). A VERIFY_EMAIL
    // challenge confirms the address it went to — only while the account still has that address.
    app.post('/auth/challenge/verify', async (req, reply) => {
      const { challenge, code, acceptPasswordChange } = challengeVerifySchema.parse(req.body);
      const done = await challenges.verify(challenge, code);
      const user = await deps.authService.getUserForSession(done.userId);
      if (done.kind === 'VERIFY_EMAIL') {
        if (user.email.trim().toLowerCase() !== done.sentTo.trim().toLowerCase()) throw new SignInExpiredError();
        const outcome = await verification?.confirm(user.id, 'code', { email: done.sentTo, actorId: user.id, ip: req.ip ?? null });
        if (outcome === 'address-changed' || outcome === 'not-found') throw new SignInExpiredError();
      }
      const changePassword = await passwordStep(user.id, acceptPasswordChange);
      if (changePassword) return reply.send({ data: { changePassword } });
      const tokens = await deps.tokenService.issueTokens(user);
      await deps.authService.recordSignIn(user.id);
      return reply.send({ data: { user: toPublicUser(user), ...tokens } });
    });

    // "Send another code": one a minute (else the seconds to wait), five an hour.
    app.post('/auth/challenge/resend', async (req, reply) => {
      const { challenge } = challengeResendSchema.parse(req.body);
      return reply.send({ data: await challenges.resend(challenge) });
    });
  }

  // Exchange a valid refresh token for a fresh access+refresh pair (A2.1 mobile refresh).
  // The presented token is spent atomically, so of two concurrent refreshes only one wins; the
  // loser (another tab, within a short grace window) gets 401 and should re-read the stored
  // token. Replaying an older, already-rotated token revokes that whole sign-in (XP-04).
  app.post('/auth/refresh', async (req, reply) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    const spent = await deps.tokenService.rotateRefreshToken(refreshToken);
    if (!spent.ok) {
      return reply.status(401).send({ error: { code: 'INVALID_REFRESH_TOKEN', message: 'Session expired. Please sign in again.' } });
    }
    const user = await deps.authService.getUserForSession(spent.userId);
    // A retry after a lost reply: the same refresh token it was rotated to, with a fresh access token.
    if (spent.replay) {
      return reply.send({ data: { user: toPublicUser(user), accessToken: deps.tokenService.issueAccessToken(user), refreshToken: spent.replay.refreshToken } });
    }
    const tokens = await deps.tokenService.issueTokens(user, { familyId: spent.familyId });
    await deps.tokenService.recordSuccessor(refreshToken, tokens.refreshToken);
    return reply.send({ data: { user: toPublicUser(user), ...tokens } });
  });

  // Fingerprint sign-in on a phone: a refresh token in a rotation family of its own, kept by the
  // phone apart from its session. Silent refreshes never spend it, so it still works after the session
  // ends; a password change or an admin reset revokes it with every other sign-in. Made only with the
  // phone's live session refresh token (checked, not spent) — an access token alone, which lives
  // in web pages too, can't turn 15 minutes into a lasting key. `keyId` lets the phone cancel it.
  app.post('/auth/biometric-credential', async (req, reply) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    const userId = await deps.tokenService.sessionOwner(refreshToken);
    if (!userId) return reply.status(401).send({ error: SESSION_EXPIRED });
    const user = await deps.authService.getUserForSession(userId);
    const { key, keyId } = await deps.tokenService.issueBiometricKey(user);
    return reply.status(201).send({ data: { refreshToken: key, keyId } });
  });

  // Turned off on the phone (or replaced, or its prompt was cancelled): cancel that key here too.
  app.post('/auth/biometric-credential/revoke', async (req, reply) => {
    const { refreshToken, keyId } = biometricRevokeSchema.parse(req.body);
    const userId = await deps.tokenService.sessionOwner(refreshToken);
    if (!userId) return reply.status(401).send({ error: SESSION_EXPIRED });
    await deps.tokenService.revokeBiometricKey(userId, keyId);
    return reply.send({ data: { ok: true } });
  });

  // Sign in with a fingerprint key: a new session, and the key is NOT spent (the phone keeps it
  // behind its biometric-bound keystore). Only keys made by /auth/biometric-credential work here.
  app.post('/auth/biometric-sign-in', async (req, reply) => {
    const { credential } = biometricSignInSchema.parse(req.body);
    const owner = await deps.tokenService.verifyBiometricKey(credential);
    if (!owner) {
      return reply.status(401).send({
        error: {
          code: 'INVALID_BIOMETRIC_KEY',
          message: 'Fingerprint sign-in has stopped: your password was changed, or the app wasn’t used for 30 days. Sign in with your password, then turn it on again in Settings.',
        },
      });
    }
    const user = await deps.authService.getUserForSession(owner.userId);
    // 1.23.6: the app can't take the "choose your own password" step (it is told to use the website).
    await passwordStep(user.id, false);
    const tokens = await deps.tokenService.issueTokens(user);
    await deps.authService.recordSignIn(user.id);
    return reply.send({ data: { user: toPublicUser(user), ...tokens } });
  });

  // Server-side logout: revoke the presented refresh token so it can no longer mint sessions.
  // Idempotent and non-enumerating — always 200, even for an unknown token.
  app.post('/auth/logout', async (req, reply) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    await deps.tokenService.revokeRefreshToken(refreshToken);
    return reply.send({ data: { ok: true } });
  });

  const otp = deps.otpService;
  if (otp) {
    app.post('/auth/otp/request', async (req, reply) => {
      const { identifier } = otpRequestSchema.parse(req.body);
      const result = await otp.requestLoginOtp(identifier);
      return reply.send({ data: result });
    });

    app.post('/auth/otp/verify', async (req, reply) => {
      const { identifier, code, acceptPasswordChange } = otpVerifySchema.parse(req.body);
      const user = await otp.verifyLoginOtp(identifier, code);
      // Onboarding: a code that reached the mailbox proves it — the email-code sign-in (here and on the
      // app) confirms the address. Bookkeeping: a failure never fails the sign-in.
      await verification?.confirm(user.id, 'sign-in code', { email: user.email, actorId: user.id, ip: req.ip ?? null }).catch(() => undefined);
      // The mailbox is proven (as with Forgot password): the step is given even past the lifetime.
      const changePassword = await passwordStep(user.id, acceptPasswordChange, { viaEmailCode: true });
      if (changePassword) return reply.send({ data: { changePassword } });
      const tokens = await deps.tokenService.issueTokens(user);
      await deps.authService.recordSignIn(user.id);
      // Same user shape as password sign-in (username + avatar for the header straight away).
      return reply.send({ data: { user: toPublicUser(user), ...tokens } });
    });
  }

  // 1.23.6 "Choose your own password" after a temporary one: the step ticket from a sign-in and the new
  // password (the rules; not the temporary one). Then the session, as a sign-in gives.
  if (firstPassword) {
    app.post('/auth/password/first-change', async (req, reply) => {
      const { ticket, password } = firstChangeSchema.parse(req.body);
      const userId = await firstPassword.change(ticket, password);
      const user = await deps.authService.getUserForSession(userId);
      await deps.auditService
        ?.record({ userId, ip: req.ip ?? null, module: 'users', action: 'user.password.changed_first_sign_in', entityId: userId })
        .catch(() => undefined);
      const tokens = await deps.tokenService.issueTokens(user);
      await deps.authService.recordSignIn(user.id);
      return reply.send({ data: { user: toPublicUser(user), ...tokens } });
    });
  }

  const reset = deps.passwordResetService;
  if (reset) {
    app.post('/auth/password/forgot', async (req, reply) => {
      const { identifier } = forgotSchema.parse(req.body);
      const result = await reset.requestReset(identifier);
      return reply.send({ data: result });
    });

    app.post('/auth/password/reset', async (req, reply) => {
      const { token, password } = resetSchema.parse(req.body);
      const result = await reset.resetPassword(token, password);
      return reply.send({ data: result });
    });

    // Onboarding: what a set-password link is, asked by its page before a password is typed — "This
    // invitation has expired — ask <company> to send a new one". The token comes in the body (never an
    // address that a log could keep); only its state and the company's name come back.
    app.post('/auth/password/link-status', async (req, reply) => {
      const { token } = linkStatusSchema.parse(req.body);
      return reply.send({ data: await reset.linkStatus(token) });
    });
  }
}
