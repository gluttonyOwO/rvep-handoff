import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthContext } from "@/lib/auth-context";
import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api-response";
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from "@/lib/auth";
import { AppError } from "@/lib/errors";

export async function POST(request: NextRequest) {
  try {
    // Best-effort: try to read userId for the audit log and version bump.
    let userId: string | undefined;
    try {
      const ctx = await getAuthContext(request);
      userId = ctx.userId;
    } catch {
      // Ignore auth errors on logout — always clear the cookie.
    }

    // Increment refreshTokenVersion to invalidate all existing refresh tokens.
    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: { refreshTokenVersion: { increment: 1 } },
      });
    }

    await audit({ eventName: "logout", userId });

    const response = ok({ ok: true }, 200);

    response.cookies.set(REFRESH_COOKIE_NAME, "", {
      ...refreshCookieOptions(0),
      maxAge: 0,
    });

    return response;
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, err.status, err.extra);
    }
    console.error("[auth/logout]", err);
    return fail("internal_error", 500);
  }
}
