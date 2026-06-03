import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthContext } from "@/lib/auth-context";
import { audit } from "@/lib/audit";
import { validateBody } from "@/lib/validation";
import { grantPermissionSchema } from "@/lib/zod-schemas/permissions";
import { ok, fail } from "@/lib/api-response";
import { AppError, Forbidden } from "@/lib/errors";
import { Role } from "@prisma/client";

interface Params {
  params: Promise<{ vehicleId: string }>;
}

/**
 * GET /api/v1/vehicles/{vehicleId}/permissions
 * Admin only: list all permissions for a vehicle.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const ctx = await getAuthContext(request);
    const { vehicleId } = await params;

    if (ctx.role !== Role.ADMIN) {
      throw new Forbidden("forbidden");
    }

    const vehicle = await prisma.vehicle.findUnique({ where: { vehicleId } });
    if (!vehicle) {
      return fail("vehicle_not_found", 404);
    }

    const permissions = await prisma.vehiclePermission.findMany({
      where: { vehicleId: vehicle.id },
      select: {
        id: true,
        userId: true,
        vehicleId: true,
        role: true,
        grantedBy: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return ok(permissions.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })));
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, err.status, err.extra);
    }
    console.error("[vehicle/permissions GET]", err);
    return fail("internal_error", 500);
  }
}

/**
 * POST /api/v1/vehicles/{vehicleId}/permissions
 * Admin only: grant (or update) a permission for a user on a vehicle.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const ctx = await getAuthContext(request);
    const { vehicleId } = await params;
    const body = await validateBody(request, grantPermissionSchema);

    if (ctx.role !== Role.ADMIN) {
      throw new Forbidden("forbidden");
    }

    const vehicle = await prisma.vehicle.findUnique({ where: { vehicleId } });
    if (!vehicle) {
      return fail("vehicle_not_found", 404);
    }

    // Verify target user exists.
    const targetUser = await prisma.user.findUnique({ where: { id: body.userId } });
    if (!targetUser) {
      return fail("user_not_found", 404);
    }

    // Upsert: vehicleId + userId is unique.
    const permission = await prisma.vehiclePermission.upsert({
      where: { userId_vehicleId: { userId: body.userId, vehicleId: vehicle.id } },
      create: {
        userId: body.userId,
        vehicleId: vehicle.id,
        role: body.role as Role,
        grantedBy: ctx.userId,
      },
      update: {
        role: body.role as Role,
        grantedBy: ctx.userId,
      },
    });

    await audit({
      eventName: "permission_granted",
      userId: ctx.userId,
      vehicleId: vehicle.id,
      payload: {
        targetUserId: body.userId,
        role: body.role,
        permissionId: permission.id,
      },
    });

    return ok(
      {
        id: permission.id,
        userId: permission.userId,
        vehicleId: vehicleId,
        role: permission.role,
        grantedBy: permission.grantedBy,
        createdAt: permission.createdAt.toISOString(),
      },
      201,
    );
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, err.status, err.extra);
    }
    console.error("[vehicle/permissions POST]", err);
    return fail("internal_error", 500);
  }
}
