import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../shared/config/env';

// jose uses Uint8Array keys, not plain strings
const accessSecret  = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshSecret = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

export interface JwtPayload {
  userId: string;
  email:  string;
  plan:   string;
  [key: string]: unknown; // required by jose's JWTPayload
}

// ── Access token — short lived (15m default) ──────────────────────────────────
// Sent in every API request from the dashboard
// Short expiry means a stolen token expires quickly

export async function signAccessToken(payload: JwtPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_EXPIRES_IN)
    .sign(accessSecret);
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, accessSecret);
  return payload as unknown as JwtPayload;
}

// ── Refresh token — long lived (7d default) ───────────────────────────────────
// Stored hashed in DB, used only to issue a new access token
// Rotated on every use (old one revoked, new one issued)
// Same pattern as food-delivery-core-service

export async function signRefreshToken(payload: JwtPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(env.JWT_REFRESH_EXPIRES_IN)
    .sign(refreshSecret);
}

export async function verifyRefreshToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, refreshSecret);
  return payload as unknown as JwtPayload;
}
