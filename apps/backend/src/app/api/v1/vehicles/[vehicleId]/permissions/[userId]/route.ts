import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthContext } from "@/lib/auth-context";
import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api-response";
import { AppError, Forbidden, NotFound } from "@/lib/errors";
import { Role } from "@prisma/client";

interface Params {
  params: Promise<{ vehicleId: string; userId: string }>;
}

/**
 * DELETE /api/v1/vehicles/{vehicleId}/permissions/{userId}
 * Admin only: revoke a user's permission for a vehicle.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const ctx = await getAuthContext(request);
    const { vehicleId, userId } = await params;

    if (ctx.role !== Role.ADMIN) {
      throw new Forbidden("forbidden");
    }

    const vehicle = await prisma.vehicle.findUnique({ where: { vehicleId } });
    if (!vehicle) {
      return fail("vehicle_not_found", 404);
    }

    const permission = await prisma.vehiclePermission.findUnique({
      where: { userId_vehicleId: { userId, vehicleId: vehicle.id } },
    });

    if (!permission) {
      throw new NotFound("permission_not_found");
    }

    await prisma.vehiclePermission.delete({
      where: { id: permission.id },
    });

    await audit({
      eventName: "permission_revoked",
      userId: ctx.userId,
      vehicleId: vehicle.id,
      payload: {
        targetUserId: userId,
        role: permission.role,
        permissionId: permission.id,
      },
    });

    return ok({ ok: true });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, err.status, err.extra);
    }
    console.error("[vehicle/permissions DELETE]", err);
    return fail("internal_error", 500);
  }
}
