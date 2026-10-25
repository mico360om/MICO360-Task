import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { toPublicUser, type AuthService } from './auth-service';
import type { TokenService } from './token-service';
import type { OtpService } from './otp-service';
import type { PasswordResetService } from './password-reset-service';

export interface AuthRouteDeps {
  authService: AuthService;
  tokenService: TokenService;
  otpService?: OtpService;
  passwordResetService?: PasswordResetService;
}

const identifier = z.string().trim().min(1).max(191);
const loginSchema = z.object({
  identifier,
  password: z.string().min(1).max(200),
});
const otpRequestSchema = z.object({ identifier });
const otpVerifySchema = z.object({ identifier, code: z.string().trim().min(1).max(20) });
const forgotSchema = z.object({ identifier });
const resetSchema = z.object({ token: z.string().min(1).max(200), password: z.string().min(1).max(200) });
const refreshSchema = z.object({ refreshToken: z.string().min(1).max(2000) });
const biometricSignInSchema = z.object({ credential: z.string().min(1).max(2000) });
const biometricRevokeSchema = z.object({ refreshToken: z.string().min(1).max(2000), keyId: z.string().regex(/^[0-9a-f]{64}$/) });
const SESSION_EXPIRED = { code: 'INVALID_REFRESH_TOKEN', message: 'Session expired. Please sign in again.' };

export async function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): Promise<void> {
  app.post('/auth/login', async (req, reply) => {
    const { identifier, password } = loginSchema.parse(req.body);
    const user = await deps.authService.login(identifier, password);
    const tokens = await deps.tokenService.issueTokens(user);
    await deps.authService.recordSignIn(user.id);
    return reply.send({ data: { user: toPublicUser(user), ...tokens } });
  });

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
      const { identifier, code } = otpVerifySchema.parse(req.body);
      const user = await otp.verifyLoginOtp(identifier, code);
      const tokens = await deps.tokenService.issueTokens(user);
      await deps.authService.recordSignIn(user.id);
      // Same user shape as password sign-in (username + avatar for the header straight away).
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
  }
}
