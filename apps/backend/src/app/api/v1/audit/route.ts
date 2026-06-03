import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthContext } from "@/lib/auth-context";
import { ok, fail } from "@/lib/api-response";
import { AppError, Forbidden } from "@/lib/errors";
import { Role } from "@prisma/client";

/**
 * GET /api/v1/audit?vehicleId=...&limit=100
 *
 * Returns recent EventLog entries.  Admin sees everything; non-admin sees
 * only events for vehicles they have a permission on.
 *
 * Source spec: openspec/features/c5-disconnect-safety-log.md (event.log)
 */

const querySchema = z.object({
  vehicleId: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 100))
    .pipe(z.number().int().positive().max(500)),
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthContext(request);
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      vehicleId: url.searchParams.get("vehicleId") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return fail("invalid_query", 400, { issues: parsed.error.flatten() });
    }
    const { vehicleId, limit } = parsed.data;

    // Authorization: admin sees all; others must have permission on the vehicle.
    if (ctx.role !== Role.ADMIN) {
      if (!vehicleId) {
        // non-admins must scope to a specific vehicle they have permission on
        throw new Forbidden("vehicle_scope_required");
      }
      const vehicle = await prisma.vehicle.findUnique({ where: { vehicleId } });
      if (!vehicle) return fail("vehicle_not_found", 404);
      const perm = await prisma.vehiclePermission.findFirst({
        where: { userId: ctx.userId, vehicleId: vehicle.id },
      });
      if (!perm) throw new Forbidden("no_vehicle_permission");
    }

    const entries = await prisma.eventLog.findMany({
      where: vehicleId ? { vehicleId } : {},
      orderBy: { ts: "desc" },
      take: limit,
      select: {
        id: true,
        vehicleId: true,
        sessionId: true,
        userId: true,
        eventName: true,
        ts: true,
        payload: true,
      },
    });

    return ok(
      entries.map((e) => ({
        id: e.id.toString(),
        vehicleId: e.vehicleId,
        sessionId: e.sessionId,
        userId: e.userId,
        eventName: e.eventName,
        ts: e.ts.toISOString(),
        payload: e.payload as Record<string, unknown> | null,
      })),
    );
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, err.status, err.extra);
    }
    console.error("[audit/list]", err);
    return fail("internal_error", 500);
  }
}
