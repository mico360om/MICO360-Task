import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AuthService } from './auth-service';
import type { TokenService } from './token-service';
import type { OtpService } from './otp-service';
import type { PasswordResetService } from './password-reset-service';

export interface AuthRouteDeps {
  authService: AuthService;
  tokenService: TokenService;
  otpService?: OtpService;
  passwordResetService?: PasswordResetService;
}

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});
const otpRequestSchema = z.object({ identifier: z.string().min(1) });
const otpVerifySchema = z.object({ identifier: z.string().min(1), code: z.string().min(1) });
const forgotSchema = z.object({ identifier: z.string().min(1) });
const resetSchema = z.object({ token: z.string().min(1), password: z.string().min(1) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });

export async function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): Promise<void> {
  app.post('/auth/login', async (req, reply) => {
    const { identifier, password } = loginSchema.parse(req.body);
    const user = await deps.authService.login(identifier, password);
    const tokens = await deps.tokenService.issueTokens({ id: user.id, roles: user.roles });
    return reply.send({ data: { user, ...tokens } });
  });

  // Exchange a valid refresh token for a fresh access+refresh pair (A2.1 mobile refresh).
  // The presented token is single-use: it must still be live in the store (not revoked, rotated-away,
  // or reused) and is rotated out once a new pair is issued.
  app.post('/auth/refresh', async (req, reply) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    const invalid = { error: { code: 'INVALID_REFRESH_TOKEN', message: 'Session expired. Please sign in again.' } };
    let userId: string;
    try {
      userId = deps.tokenService.verifyRefresh(refreshToken).sub as string;
    } catch {
      return reply.status(401).send(invalid);
    }
    // Signature alone is not enough — a revoked/rotated/reused token must be rejected.
    if (!(await deps.tokenService.refreshTokenValid(refreshToken))) {
      return reply.status(401).send(invalid);
    }
    const user = await deps.authService.getUserForSession(userId);
    const tokens = await deps.tokenService.issueTokens({ id: user.id, roles: user.roles });
    // Rotate: invalidate the token we just spent so it cannot be replayed.
    await deps.tokenService.revokeRefreshToken(refreshToken);
    return reply.send({ data: { user, ...tokens } });
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
      const tokens = await deps.tokenService.issueTokens({ id: user.id, roles: user.roles });
      return reply.send({ data: { user, ...tokens } });
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
