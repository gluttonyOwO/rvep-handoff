import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

export interface AuditParams {
  eventName: string;
  vehicleId?: string;
  sessionId?: string;
  userId?: string;
  payload?: Record<string, unknown>;
}

/**
 * Write an event to the EventLog table.
 * Errors are intentionally swallowed with console.error —
 * a failed audit write must never crash the main request path.
 */
export async function audit(params: AuditParams): Promise<void> {
  try {
    await prisma.eventLog.create({
      data: {
        eventName: params.eventName,
        vehicleId: params.vehicleId ?? null,
        sessionId: params.sessionId ?? null,
        userId: params.userId ?? null,
        payload: params.payload
          ? (params.payload as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
  } catch (err) {
    console.error("[audit] Failed to write event", params.eventName, err);
  }
}
