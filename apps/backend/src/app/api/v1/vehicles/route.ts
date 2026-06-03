import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthContext } from "@/lib/auth-context";
import { ok, fail } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { Role } from "@prisma/client";

/**
 * GET /api/v1/vehicles
 * Returns the list of vehicles the caller has any permission on.
 * Admins see all vehicles. Operators/Viewers only see their permitted vehicles.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthContext(request);

    const vehicles =
      ctx.role === Role.ADMIN
        ? await prisma.vehicle.findMany({
            orderBy: { vehicleId: "asc" },
            select: vehicleSelect,
          })
        : await prisma.vehicle.findMany({
            where: { vehiclePermissions: { some: { userId: ctx.userId } } },
            orderBy: { vehicleId: "asc" },
            select: vehicleSelect,
          });

    return ok(vehicles, 200);
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, err.status, err.extra);
    }
    console.error("[vehicles/list]", err);
    return fail("internal_error", 500);
  }
}

const vehicleSelect = {
  vehicleId: true,
  displayName: true,
  vehicleType: true,
  status: true,
} as const;
