import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthContext } from "@/lib/auth-context";
import { ok, fail } from "@/lib/api-response";
import { AppError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthContext(request);

    // Fetch per-vehicle permissions for this user.
    const vehiclePermissions = await prisma.vehiclePermission.findMany({
      where: { userId: ctx.userId },
      select: { vehicleId: true, role: true },
    });

    return ok({
      userId: ctx.userId,
      role: ctx.role,
      vehiclePermissions: vehiclePermissions.map((p) => ({
        vehicleId: p.vehicleId,
        role: p.role,
      })),
    });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, err.status, err.extra);
    }
    console.error("[permissions/me]", err);
    return fail("internal_error", 500);
  }
}
