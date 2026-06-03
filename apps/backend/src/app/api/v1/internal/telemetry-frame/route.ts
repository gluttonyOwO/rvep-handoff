import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/api-response";
import { validateBody } from "@/lib/validation";
import { AppError } from "@/lib/errors";

/**
 * Internal endpoint called by Edge Agent to persist a telemetry snapshot.
 *
 * Phase 1 contract: edge publishes telemetry at 5 Hz over Livekit DataChannel
 * (operator UI consumes those). To avoid hammering the DB, the edge **samples
 * 1 frame per second** and POSTs here for audit / replay.
 *
 * Source spec: openspec/features/c3-telemetry-status.md
 * Auth: shared secret via `x-internal-token` header (same convention as control-event).
 */

const telemetrySchema = z.object({
  vehicleId: z.string().min(1),
  sessionId: z.string().min(1),
  connectionEpoch: z.number().int().nonnegative().optional(),
  ts: z.string().datetime(),
  monotonicNs: z.number().optional(),
  gps: z.record(z.string(), z.unknown()).optional(),
  imu: z.record(z.string(), z.unknown()).optional(),
  battery: z.record(z.string(), z.unknown()).optional(),
  network: z.record(z.string(), z.unknown()).optional(),
  mode: z.string().optional(),
});

const INTERNAL_TOKEN = process.env.EDGE_INTERNAL_TOKEN ?? "internal-dev-token";

export async function POST(request: NextRequest) {
  if (request.headers.get("x-internal-token") !== INTERNAL_TOKEN) {
    return fail("unauthorized_internal", 401);
  }

  try {
    const body = await validateBody(request, telemetrySchema);

    const vehicle = await prisma.vehicle.findUnique({
      where: { vehicleId: body.vehicleId },
    });
    if (!vehicle) return fail("vehicle_not_found", 404);

    await prisma.telemetryFrame.create({
      data: {
        vehicleId: body.vehicleId,
        sessionId: body.sessionId,
        ts: new Date(body.ts),
        monotonicNs: body.monotonicNs ? BigInt(body.monotonicNs) : null,
        connectionEpoch: BigInt(body.connectionEpoch ?? 0),
        gps: body.gps as object | undefined,
        imu: body.imu as object | undefined,
        battery: body.battery as object | undefined,
        network: body.network as object | undefined,
        mode: body.mode,
      },
    });

    return ok({ recorded: true });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, err.status, err.extra);
    }
    if (err instanceof z.ZodError) {
      return fail("invalid_telemetry_payload", 400, { issues: err.errors });
    }
    console.error("[telemetry-frame] internal error:", err);
    return fail("internal_error", 500);
  }
}
