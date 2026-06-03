import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthContext } from "@/lib/auth-context";
import { ok, fail } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { LeaseStatus } from "@prisma/client";

interface Params {
  params: Promise<{ vehicleId: string }>;
}

function formatLease(lease: {
  vehicleId: string;
  operatorId: string;
  sessionId: string;
  connectionEpoch: bigint;
  status: LeaseStatus;
  expiresAt: Date;
}) {
  return {
    vehicleId: lease.vehicleId,
    operatorId: lease.operatorId,
    sessionId: lease.sessionId,
    connectionEpoch: lease.connectionEpoch.toString(),
    status: lease.status.toLowerCase(),
    expiresAt: lease.expiresAt.toISOString(),
  };
}

/**
 * GET /api/v1/vehicles/{vehicleId}/control-lease
 * Returns the current active lease for the vehicle, or 404 if none.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    await getAuthContext(request);
    const { vehicleId } = await params;

    // Resolve internal vehicle ID.
    const vehicle = await prisma.vehicle.findUnique({
      where: { vehicleId },
    });
    if (!vehicle) {
      return fail("vehicle_not_found", 404);
    }

    const now = new Date();
    const lease = await prisma.controlLease.findFirst({
      where: {
        vehicleId: vehicle.id,
        status: LeaseStatus.ACTIVE,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!lease) {
      return fail("lease_not_found", 404);
    }

    return ok(formatLease(lease));
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, err.status, err.extra);
    }
    console.error("[control-lease GET]", err);
    return fail("internal_error", 500);
  }
}
