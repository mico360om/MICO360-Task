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

export async function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): Promise<void> {
  app.post('/auth/login', async (req, reply) => {
    const { identifier, password } = loginSchema.parse(req.body);
    const user = await deps.authService.login(identifier, password);
    const tokens = await deps.tokenService.issueTokens(user);
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
    const tokens = await deps.tokenService.issueTokens(user, { familyId: spent.familyId });
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
