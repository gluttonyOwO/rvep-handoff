import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthContext } from "@/lib/auth-context";
import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api-response";
import { AppError, Forbidden, NotFound } from "@/lib/errors";
import { LeaseStatus } from "@prisma/client";

interface Params {
  params: Promise<{ vehicleId: string }>;
}

/**
 * POST /api/v1/vehicles/{vehicleId}/control-lease/release
 * Release the control lease. Only the current lease owner may release.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const ctx = await getAuthContext(request);
    const { vehicleId } = await params;

    // Resolve vehicle.
    const vehicle = await prisma.vehicle.findUnique({ where: { vehicleId } });
    if (!vehicle) {
      return fail("vehicle_not_found", 404);
    }

    const now = new Date();

    // Find current active lease.
    const lease = await prisma.controlLease.findFirst({
      where: {
        vehicleId: vehicle.id,
        status: LeaseStatus.ACTIVE,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!lease) {
      throw new NotFound("lease_not_found");
    }

    // Only the lease owner may release.
    if (lease.operatorId !== ctx.userId) {
      throw new Forbidden("forbidden");
    }

    // Release.
    await prisma.controlLease.update({
      where: { id: lease.id },
      data: { status: LeaseStatus.RELEASED, releasedAt: now },
    });

    await audit({
      eventName: "control_released",
      userId: ctx.userId,
      vehicleId: vehicle.id,
      sessionId: lease.sessionId,
      payload: { leaseId: lease.id },
    });

    return ok({ ok: true });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, err.status, err.extra);
    }
    console.error("[control-lease/release]", err);
    return fail("internal_error", 500);
  }
}
