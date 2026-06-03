import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { verifyAccessToken, JwtPayload } from "@/lib/auth";
import { Unauthenticated } from "@/lib/errors";

export interface AuthContext {
  userId: string;
  role: Role;
}

/**
 * Extract and verify the Bearer JWT from the request.
 * Throws Unauthenticated (401) if missing or invalid.
 *
 * Routes can also call this directly when middleware injection is unavailable
 * (e.g. during tests without the full Next.js runtime).
 */
export async function getAuthContext(
  request: NextRequest | Request,
): Promise<AuthContext> {
  // Prefer middleware-injected headers (fast path, avoids re-verify).
  const injectedUserId =
    request instanceof NextRequest
      ? request.headers.get("x-user-id")
      : (request as Request).headers.get("x-user-id");

  const injectedRole =
    request instanceof NextRequest
      ? request.headers.get("x-user-role")
      : (request as Request).headers.get("x-user-role");

  if (injectedUserId && injectedRole && isRole(injectedRole)) {
    return { userId: injectedUserId, role: injectedRole };
  }

  // Fallback: verify token directly (useful in tests / direct calls).
  const authHeader =
    request instanceof NextRequest
      ? request.headers.get("authorization")
      : (request as Request).headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    throw new Unauthenticated();
  }

  const token = authHeader.slice(7);
  let payload: JwtPayload;
  try {
    payload = await verifyAccessToken(token);
  } catch {
    throw new Unauthenticated();
  }

  if (!isRole(payload.role)) {
    throw new Unauthenticated();
  }

  return { userId: payload.sub, role: payload.role };
}

function isRole(value: string): value is Role {
  return value === "ADMIN" || value === "OPERATOR" || value === "VIEWER";
}
