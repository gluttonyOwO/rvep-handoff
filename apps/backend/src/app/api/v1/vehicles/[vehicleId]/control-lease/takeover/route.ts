import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthContext } from "@/lib/auth-context";
import { audit } from "@/lib/audit";
import { validateBody } from "@/lib/validation";
import { takeoverLeaseSchema } from "@/lib/zod-schemas/permissions";
import { ok, fail } from "@/lib/api-response";
import { AppError, Forbidden, NotFound } from "@/lib/errors";
import { LeaseStatus, Role, SessionStatus } from "@prisma/client";

interface Params {
  params: Promise<{ vehicleId: string }>;
}

const LEASE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * POST /api/v1/vehicles/{vehicleId}/control-lease/takeover
 * Admin-only: revoke the existing lease and assign a new one to newOperatorId.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const ctx = await getAuthContext(request);
    const { vehicleId } = await params;
    const body = await validateBody(request, takeoverLeaseSchema);

    // 1. Only ADMIN may takeover.
    if (ctx.role !== Role.ADMIN) {
      throw new Forbidden("forbidden");
    }

    // 2. Resolve vehicle.
    const vehicle = await prisma.vehicle.findUnique({ where: { vehicleId } });
    if (!vehicle) {
      return fail("vehicle_not_found", 404);
    }

    const now = new Date();

    // 3. Find current active lease (if any) to revoke.
    const existingLease = await prisma.controlLease.findFirst({
      where: {
        vehicleId: vehicle.id,
        status: LeaseStatus.ACTIVE,
      },
      orderBy: { createdAt: "desc" },
    });

    const oldOperatorId = existingLease?.operatorId ?? null;

    if (existingLease) {
      await prisma.controlLease.update({
        where: { id: existingLease.id },
        data: { status: LeaseStatus.REVOKED, revokedAt: now },
      });
    }

    // 4. Verify new operator exists and has vehicle permission.
    const newOperator = await prisma.user.findUnique({
      where: { id: body.newOperatorId },
    });
    if (!newOperator) {
      throw new NotFound("user_not_found");
    }

    // Resolve or find an appropriate session for the new operator.
    const newOperatorSession = await prisma.session.findFirst({
      where: {
        vehicleId: vehicle.id,
        userId: body.newOperatorId,
        status: SessionStatus.ACTIVE,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!newOperatorSession) {
      throw new NotFound("session_not_found");
    }

    // 5. Create new lease for new operator.
    const newLease = await prisma.controlLease.create({
      data: {
        vehicleId: vehicle.id,
        operatorId: body.newOperatorId,
        sessionId: newOperatorSession.id,
        connectionEpoch: newOperatorSession.connectionEpoch,
        status: LeaseStatus.ACTIVE,
        expiresAt: new Date(now.getTime() + LEASE_TTL_MS),
      },
    });

    await audit({
      eventName: "control_takeover",
      userId: ctx.userId,
      vehicleId: vehicle.id,
      sessionId: newOperatorSession.id,
      payload: {
        oldOperatorId,
        newOperatorId: body.newOperatorId,
        reason: body.reason,
        newLeaseId: newLease.id,
      },
    });

    return ok({
      vehicleId: vehicleId,
      operatorId: newLease.operatorId,
      sessionId: newOperatorSession.sessionId,
      connectionEpoch: newLease.connectionEpoch.toString(),
      status: newLease.status.toLowerCase(),
      expiresAt: newLease.expiresAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, err.status, err.extra);
    }
    console.error("[control-lease/takeover]", err);
    return fail("internal_error", 500);
  }
}
