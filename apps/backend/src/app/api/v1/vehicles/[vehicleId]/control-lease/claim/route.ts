import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthContext } from "@/lib/auth-context";
import { audit } from "@/lib/audit";
import { validateBody } from "@/lib/validation";
import { claimLeaseSchema } from "@/lib/zod-schemas/permissions";
import { ok, fail } from "@/lib/api-response";
import { AppError, Forbidden } from "@/lib/errors";
import { hasRole } from "@/lib/auth";
import { LeaseStatus, Role } from "@prisma/client";

interface Params {
  params: Promise<{ vehicleId: string }>;
}

const LEASE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * POST /api/v1/vehicles/{vehicleId}/control-lease/claim
 * Claim or re-claim the control lease for a vehicle.
 * The core check-and-create is wrapped in a serializable transaction
 * to prevent two parallel claims from both succeeding.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const ctx = await getAuthContext(request);
    const { vehicleId } = await params;
    const body = await validateBody(request, claimLeaseSchema);

    // 1. Require at least OPERATOR role.
    if (!hasRole(ctx.role, Role.OPERATOR)) {
      throw new Forbidden("forbidden");
    }

    // 2. Resolve vehicle by business key.
    const vehicle = await prisma.vehicle.findUnique({ where: { vehicleId } });
    if (!vehicle) {
      return fail("vehicle_not_found", 404);
    }

    // 3. Verify user has per-vehicle permission.
    const permission = await prisma.vehiclePermission.findUnique({
      where: { userId_vehicleId: { userId: ctx.userId, vehicleId: vehicle.id } },
    });
    if (!permission || !hasRole(permission.role, Role.OPERATOR)) {
      throw new Forbidden("forbidden");
    }

    // 4. Resolve session.
    const session = await prisma.session.findUnique({
      where: { sessionId: body.sessionId },
    });
    if (!session) {
      return fail("session_not_found", 404);
    }

    const now = new Date();

    // 5. Transaction: check existing lease → release/reject → create new lease.
    //    Serializable isolation prevents two concurrent claims creating two ACTIVE leases.
    type ClaimResult =
      | { kind: "denied"; currentOperatorId: string; currentSessionId: string }
      | { kind: "created"; lease: Awaited<ReturnType<typeof prisma.controlLease.create>> };

    const result = await prisma.$transaction<ClaimResult>(
      async (tx) => {
        // Acquire transaction-scoped advisory lock keyed by vehicleId.
        // Guarantees serial execution of claim attempts on the same vehicle,
        // even when the DB engine's SSI implementation is incomplete (e.g. pglite).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${vehicle.id}, 0))`;

        const existingLease = await tx.controlLease.findFirst({
          where: {
            vehicleId: vehicle.id,
            status: LeaseStatus.ACTIVE,
          },
          orderBy: { createdAt: "desc" },
        });

        if (existingLease) {
          if (existingLease.expiresAt <= now) {
            // Auto-release expired lease.
            await tx.controlLease.update({
              where: { id: existingLease.id },
              data: { status: LeaseStatus.RELEASED, releasedAt: now },
            });
          } else if (existingLease.operatorId !== ctx.userId) {
            // Active lease held by another operator.
            return {
              kind: "denied",
              currentOperatorId: existingLease.operatorId,
              currentSessionId: existingLease.sessionId,
            };
          } else {
            // Same operator re-claiming: release old lease first.
            await tx.controlLease.update({
              where: { id: existingLease.id },
              data: { status: LeaseStatus.RELEASED, releasedAt: now },
            });
          }
        }

        const newLease = await tx.controlLease.create({
          data: {
            vehicleId: vehicle.id,
            operatorId: ctx.userId,
            sessionId: session.id,
            connectionEpoch: session.connectionEpoch,
            status: LeaseStatus.ACTIVE,
            expiresAt: new Date(now.getTime() + LEASE_TTL_MS),
          },
        });

        return { kind: "created", lease: newLease };
      },
      { isolationLevel: "Serializable" },
    );

    if (result.kind === "denied") {
      await audit({
        eventName: "control_lease_denied",
        userId: ctx.userId,
        vehicleId: vehicle.id,
        sessionId: body.sessionId,
        payload: {
          reason: "lease_taken",
          currentOperatorId: result.currentOperatorId,
          currentSessionId: result.currentSessionId,
        },
      });
      return fail("lease_taken", 409, {
        currentOperatorId: result.currentOperatorId,
        currentSessionId: result.currentSessionId,
      });
    }

    const newLease = result.lease;

    await audit({
      eventName: "control_granted",
      userId: ctx.userId,
      vehicleId: vehicle.id,
      sessionId: session.id,
      payload: {
        leaseId: newLease.id,
        connectionEpoch: session.connectionEpoch.toString(),
        expiresAt: newLease.expiresAt.toISOString(),
      },
    });

    return ok(
      {
        vehicleId,
        operatorId: newLease.operatorId,
        sessionId: body.sessionId,
        connectionEpoch: newLease.connectionEpoch.toString(),
        status: newLease.status.toLowerCase(),
        expiresAt: newLease.expiresAt.toISOString(),
      },
      201,
    );
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, err.status, err.extra);
    }
    console.error("[control-lease/claim]", err);
    return fail("internal_error", 500);
  }
}
