import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthContext } from "@/lib/auth-context";
import { ok, fail } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { LeaseStatus } from "@prisma/client";

interface Params {
  params: Promise<{ vehicleId: string }>;
}

type Json = Record<string, unknown>;

/**
 * GET /api/v1/vehicles/{vehicleId}/status
 *
 * Aggregated dashboard payload — single fetch that powers the Fleet card:
 * - vehicle identity / type / status
 * - current control lease (if active)
 * - most-recent telemetry frame (mode, battery%, network RTT, last GPS)
 * - last_seen_ms (age of latest telemetry, used to show online/offline)
 *
 * Phase 1 baseline; future revisions may stream over WebSocket / Livekit.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    await getAuthContext(request);
    const { vehicleId } = await params;

    const vehicle = await prisma.vehicle.findUnique({ where: { vehicleId } });
    if (!vehicle) return fail("vehicle_not_found", 404);

    const now = new Date();
    const [lease, latestTelemetry] = await Promise.all([
      prisma.controlLease.findFirst({
        where: {
          vehicleId: vehicle.id,
          status: LeaseStatus.ACTIVE,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: "desc" },
        include: { operator: { select: { id: true, email: true } } },
      }),
      prisma.telemetryFrame.findFirst({
        where: { vehicleId },
        orderBy: { ts: "desc" },
        select: {
          ts: true,
          mode: true,
          gps: true,
          battery: true,
          network: true,
          sessionId: true,
        },
      }),
    ]);

    const lastSeenMs = latestTelemetry?.ts
      ? Date.now() - latestTelemetry.ts.getTime()
      : null;

    const battery = latestTelemetry?.battery as Json | null;
    const network = latestTelemetry?.network as Json | null;
    const gps = latestTelemetry?.gps as Json | null;

    return ok({
      vehicleId: vehicle.vehicleId,
      displayName: vehicle.displayName,
      vehicleType: vehicle.vehicleType,
      status: vehicle.status,
      lease: lease
        ? {
            operatorId: lease.operatorId,
            operatorName: lease.operator.email,
            sessionId: lease.sessionId,
            status: lease.status.toLowerCase(),
            expiresAt: lease.expiresAt.toISOString(),
          }
        : null,
      telemetry: latestTelemetry
        ? {
            ts: latestTelemetry.ts.toISOString(),
            sessionId: latestTelemetry.sessionId,
            mode: latestTelemetry.mode ?? null,
            batteryPct: battery && typeof battery["pct"] === "number" ? (battery["pct"] as number) : null,
            networkRttMs: network && typeof network["rttMs"] === "number" ? (network["rttMs"] as number) : null,
            gps:
              gps && typeof gps["lat"] === "number" && typeof gps["lng"] === "number"
                ? { lat: gps["lat"] as number, lng: gps["lng"] as number }
                : null,
          }
        : null,
      lastSeenMs,
      // Aggregated "online" rule: telemetry seen in last 5 s.
      online: lastSeenMs !== null && lastSeenMs < 5000,
    });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, err.status, err.extra);
    }
    console.error("[vehicles/status]", err);
    return fail("internal_error", 500);
  }
}
