import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JwtPayload {
  sub: string;    // userId
  role: Role;
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload extends JwtPayload {
  ver: number;  // refreshTokenVersion for rotation validation
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function getSigningKey(): Uint8Array {
  const raw = process.env.JWT_SIGNING_KEY;
  if (!raw) throw new Error("JWT_SIGNING_KEY is not set");
  return Buffer.from(raw, "base64");
}

function getRefreshKey(): Uint8Array {
  const raw = process.env.JWT_REFRESH_KEY;
  if (!raw) throw new Error("JWT_REFRESH_KEY is not set");
  return Buffer.from(raw, "base64");
}

// ---------------------------------------------------------------------------
// Token sign / verify
// ---------------------------------------------------------------------------

const ACCESS_TTL_SECONDS = 60 * 60;        // 1 hour
const REFRESH_TTL_SECONDS = 14 * 24 * 3600; // 14 days

export async function signAccessToken(
  userId: string,
  role: Role,
): Promise<{ token: string; expiresAt: Date }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ACCESS_TTL_SECONDS;

  const token = await new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(getSigningKey());

  return { token, expiresAt: new Date(exp * 1000) };
}

export async function signRefreshToken(
  userId: string,
  role: Role,
  version: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + REFRESH_TTL_SECONDS;

  return new SignJWT({ role, ver: version })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(getRefreshKey());
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, getSigningKey(), {
    algorithms: ["HS256"],
  });
  return payload as unknown as JwtPayload;
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, getRefreshKey(), {
    algorithms: ["HS256"],
  });
  return payload as unknown as RefreshTokenPayload;
}

export async function issueTokenPair(
  userId: string,
  role: Role,
  refreshTokenVersion: number,
): Promise<TokenPair> {
  const [access, refresh] = await Promise.all([
    signAccessToken(userId, role),
    signRefreshToken(userId, role, refreshTokenVersion),
  ]);
  return {
    accessToken: access.token,
    refreshToken: refresh,
    expiresAt: access.expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Bcrypt helpers
// ---------------------------------------------------------------------------

function getBcryptRounds(): number {
  const raw = process.env.BCRYPT_ROUNDS;
  const n = raw ? parseInt(raw, 10) : 12;
  return isNaN(n) ? 12 : n;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, getBcryptRounds());
}

export async function comparePassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ---------------------------------------------------------------------------
// Role / grants helpers
// ---------------------------------------------------------------------------

const ROLE_HIERARCHY: Record<Role, number> = {
  VIEWER: 0,
  OPERATOR: 1,
  ADMIN: 2,
};

/** Returns true if `userRole` is at least `requiredRole`. */
export function hasRole(userRole: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

// ---------------------------------------------------------------------------
// Refresh token cookie helpers
// ---------------------------------------------------------------------------

const COOKIE_NAME = "refresh_token";
const COOKIE_PATH = "/api/v1/auth";

export interface CookieOptions {
  maxAge: number;
  httpOnly: true;
  secure: boolean;
  sameSite: "strict";
  path: string;
}

export function refreshCookieOptions(maxAge?: number): CookieOptions {
  return {
    maxAge: maxAge ?? REFRESH_TTL_SECONDS,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: COOKIE_PATH,
  };
}

export { COOKIE_NAME as REFRESH_COOKIE_NAME };
