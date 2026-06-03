import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  verifyRefreshToken,
  signAccessToken,
  signRefreshToken,
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
} from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api-response";
import { AppError } from "@/lib/errors";

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value;

    if (!refreshToken) {
      await audit({ eventName: "refresh_token_invalid", payload: { reason: "missing_cookie" } });
      return fail("refresh_token_invalid", 401);
    }

    // 1. Verify token signature and expiry.
    let payload: Awaited<ReturnType<typeof verifyRefreshToken>>;
    try {
      payload = await verifyRefreshToken(refreshToken);
    } catch (err) {
      const isExpired =
        err instanceof Error && err.message.toLowerCase().includes("expired");
      const eventName = isExpired ? "refresh_token_expired" : "refresh_token_invalid";
      await audit({
        eventName,
        payload: { reason: err instanceof Error ? err.message : String(err) },
      });
      return fail(isExpired ? "refresh_token_expired" : "refresh_token_invalid", 401);
    }

    // 2. Transaction: verify version, bump version, issue new tokens atomically.
    //    This prevents race conditions where two concurrent refreshes both succeed.
    let newAccess: Awaited<ReturnType<typeof signAccessToken>>;
    let newRefresh: string;
    let userId: string;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: payload.sub } });

        if (!user) {
          return null;
        }

        // Version mismatch means this token has already been rotated (or revoked).
        if ((payload.ver ?? -1) !== user.refreshTokenVersion) {
          return "version_mismatch" as const;
        }

        // Bump version to invalidate this token immediately.
        const updated = await tx.user.update({
          where: { id: user.id },
          data: { refreshTokenVersion: { increment: 1 } },
        });

        return { user, newVersion: updated.refreshTokenVersion };
      });

      if (result === null) {
        await audit({
          eventName: "refresh_token_invalid",
          userId: payload.sub,
          payload: { reason: "user_not_found" },
        });
        return fail("refresh_token_invalid", 401);
      }

      if (result === "version_mismatch") {
        await audit({
          eventName: "refresh_token_invalid",
          userId: payload.sub,
          payload: { reason: "version_mismatch" },
        });
        return fail("refresh_token_invalid", 401);
      }

      const { user, newVersion } = result;
      userId = user.id;

      [newAccess, newRefresh] = await Promise.all([
        signAccessToken(user.id, user.role),
        signRefreshToken(user.id, user.role, newVersion),
      ]);
    } catch (txErr) {
      console.error("[auth/refresh] transaction error", txErr);
      return fail("internal_error", 500);
    }

    await audit({ eventName: "token_refreshed", userId });

    const response = ok(
      {
        accessToken: newAccess.token,
        expiresAt: newAccess.expiresAt.toISOString(),
      },
      200,
    );

    response.cookies.set(REFRESH_COOKIE_NAME, newRefresh, refreshCookieOptions());
    return response;
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, err.status, err.extra);
    }
    console.error("[auth/refresh]", err);
    return fail("internal_error", 500);
  }
}
