import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthContext } from "@/lib/auth-context";
import { issueLivekitToken } from "@/lib/livekit";
import { audit } from "@/lib/audit";
import { validateBody } from "@/lib/validation";
import { livekitTokenSchema } from "@/lib/zod-schemas/livekit";
import { ok, fail } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { Role, LeaseStatus } from "@prisma/client";

export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext(request);
    const body = await validateBody(request, livekitTokenSchema);

    // 1. Verify vehicle exists.
    const vehicle = await prisma.vehicle.findUnique({
      where: { vehicleId: body.vehicleId },
    });
    if (!vehicle) {
      await audit({
        eventName: "livekit_token_denied",
        userId: ctx.userId,
        payload: { vehicleId: body.vehicleId, reason: "vehicle_not_found" },
      });
      return fail("vehicle_not_found", 404);
    }

    // 2. Admin requesting admin token: skip permission and lease checks entirely.
    if (body.role === "admin") {
      if (ctx.role !== Role.ADMIN) {
        await audit({
          eventName: "livekit_token_denied",
          userId: ctx.userId,
          vehicleId: vehicle.id,
          payload: { vehicleId: body.vehicleId, role: body.role, reason: "forbidden_role" },
        });
        return fail("forbidden_vehicle", 403);
      }
      return issueAndRespond(ctx.userId, body.vehicleId, vehicle.id, body.role);
    }

    // 3. Non-admin: verify explicit per-vehicle permission.
    const permission = await prisma.vehiclePermission.findUnique({
      where: { userId_vehicleId: { userId: ctx.userId, vehicleId: vehicle.id } },
    });

    if (!permission) {
      await audit({
        eventName: "livekit_token_denied",
        userId: ctx.userId,
        vehicleId: vehicle.id,
        payload: { vehicleId: body.vehicleId, role: body.role, reason: "forbidden_vehicle" },
      });
      return fail("forbidden_vehicle", 403);
    }

    // 4. Operator token requires OPERATOR or higher permission.
    if (
      body.role === "operator" &&
      permission.role !== Role.OPERATOR &&
      permission.role !== Role.ADMIN
    ) {
      await audit({
        eventName: "livekit_token_denied",
        userId: ctx.userId,
        vehicleId: vehicle.id,
        payload: { vehicleId: body.vehicleId, role: body.role, reason: "forbidden_role" },
      });
      return fail("forbidden_vehicle", 403);
    }

    // 5. For operator role: verify no active lease held by someone else.
    if (body.role === "operator") {
      const now = new Date();
      const activeLease = await prisma.controlLease.findFirst({
        where: {
          vehicleId: vehicle.id,
          status: LeaseStatus.ACTIVE,
          expiresAt: { gt: now },
        },
      });

      if (activeLease && activeLease.operatorId !== ctx.userId) {
        await audit({
          eventName: "livekit_token_denied",
          userId: ctx.userId,
          vehicleId: vehicle.id,
          payload: {
            vehicleId: body.vehicleId,
            role: body.role,
            reason: "control_lease_taken",
            currentOperatorId: activeLease.operatorId,
          },
        });
        return fail("control_lease_taken", 409, {
          currentOperatorId: activeLease.operatorId,
        });
      }
    }

    return issueAndRespond(ctx.userId, body.vehicleId, vehicle.id, body.role);
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, err.status, err.extra);
    }
    console.error("[livekit/token]", err);
    return fail("internal_error", 500);
  }
}

async function issueAndRespond(
  userId: string,
  vehicleBusinessId: string,
  vehicleInternalId: string,
  role: "operator" | "viewer" | "admin",
) {
  const result = await issueLivekitToken(userId, vehicleBusinessId, role);

  await audit({
    eventName: "livekit_token_issued",
    userId,
    vehicleId: vehicleInternalId,
    payload: {
      role,
      roomName: result.roomName,
      identity: result.identity,
    },
  });

  return ok({
    token: result.token,
    url: result.url,
    roomName: result.roomName,
    identity: result.identity,
    expiresAt: result.expiresAt.toISOString(),
  });
}
