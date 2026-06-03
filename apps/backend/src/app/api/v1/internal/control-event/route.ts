import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api-response";
import { validateBody } from "@/lib/validation";

/**
 * Internal endpoint called by the Edge Agent (real or mock) to report
 * safety / control events. Not for end-user clients.
 *
 * Auth: shared secret via `x-internal-token` header.
 * In production this should be replaced with mTLS or signed JWT (slice 7).
 */

const eventSchema = z.object({
  vehicleId: z.string().min(1),
  eventName: z.string().min(1),
  payload: z.unknown().optional(),
  ts: z.string().datetime().optional(),
});

const INTERNAL_TOKEN =
  process.env.EDGE_INTERNAL_TOKEN ?? "internal-dev-token";

export async function POST(request: NextRequest) {
  const presented = request.headers.get("x-internal-token");
  if (presented !== INTERNAL_TOKEN) {
    return fail("unauthorized_internal", 401);
  }

  try {
    const body = await validateBody(request, eventSchema);

    // Resolve internal vehicle UUID (logs use FK to Vehicle.vehicleId business key
    // in some tables and Vehicle.id UUID in others; EventLog uses raw string).
    const vehicle = await prisma.vehicle.findUnique({
      where: { vehicleId: body.vehicleId },
    });
    if (!vehicle) {
      return fail("vehicle_not_found", 404);
    }

    await audit({
      eventName: body.eventName,
      vehicleId: body.vehicleId,
      payload: (body.payload ?? {}) as Record<string, unknown>,
    });

    return ok({ recorded: true });
  } catch (err) {
    console.error("[internal/control-event]", err);
    return fail("internal_error", 500);
  }
}
