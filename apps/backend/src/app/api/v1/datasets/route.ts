import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthContext } from "@/lib/auth-context";
import { ok, fail } from "@/lib/api-response";
import { AppError, Forbidden } from "@/lib/errors";
import { Role } from "@prisma/client";

/**
 * GET /api/v1/datasets?vehicleId=...&limit=100
 *
 * Lists recent DatasetAsset rows, joined with Session metadata.
 * - Admin: all vehicles
 * - Non-admin: must scope to a vehicle they hold a VehiclePermission on
 *
 * Source spec: openspec/features/c4-ai-training-data-storage.md
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

    if (ctx.role !== Role.ADMIN) {
      if (!vehicleId) throw new Forbidden("vehicle_scope_required");
      const vehicle = await prisma.vehicle.findUnique({ where: { vehicleId } });
      if (!vehicle) return fail("vehicle_not_found", 404);
      const perm = await prisma.vehiclePermission.findFirst({
        where: { userId: ctx.userId, vehicleId: vehicle.id },
      });
      if (!perm) throw new Forbidden("no_vehicle_permission");
    }

    const assets = await prisma.datasetAsset.findMany({
      where: vehicleId ? { vehicleId } : {},
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        session: {
          select: { sessionId: true, purpose: true, status: true, createdAt: true, closedAt: true },
        },
      },
    });

    return ok(
      assets.map((a) => ({
        id: a.id,
        vehicleId: a.vehicleId,
        sessionId: a.session.sessionId,
        sessionPurpose: a.session.purpose,
        sessionStatus: a.session.status,
        cameraId: a.cameraId,
        kind: a.kind,
        source: a.source,
        path: a.path,
        sizeBytes: a.sizeBytes ? Number(a.sizeBytes) : null,
        durationMs: a.durationMs ? Number(a.durationMs) : null,
        sha256: a.sha256,
        retentionTier: a.retentionTier,
        createdAt: a.createdAt.toISOString(),
        syncedAt: a.syncedAt?.toISOString() ?? null,
        metadata: a.metadata,
      })),
    );
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, err.status, err.extra);
    }
    console.error("[datasets/list]", err);
    return fail("internal_error", 500);
  }
}
