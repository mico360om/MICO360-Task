import jwt, { type JwtPayload } from 'jsonwebtoken';

export type TokenClaims = JwtPayload & {
  sub?: string;
  type?: 'access' | 'refresh';
};

/** Sign a JWT with an expiry given in seconds from now. */
export function signToken(payload: object, secret: string, ttlSeconds: number): string {
  return jwt.sign(payload, secret, { expiresIn: ttlSeconds });
}

/** Verify a JWT; throws if the signature is invalid or the token has expired. */
export function verifyToken(token: string, secret: string): TokenClaims {
  return jwt.verify(token, secret) as TokenClaims;
}
