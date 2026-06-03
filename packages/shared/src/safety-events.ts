/**
 * Safety event messages — Edge Agent → Operator UI via Livekit DataChannel.
 *
 * Direction & channel: reuses the Livekit DataChannel (reliable), discriminated
 * by `kind: "safety_event"` (telemetry uses `kind: "telemetry"`, control
 * commands use `type` discriminator).
 *
 * Source spec: openspec/features/c5-disconnect-safety-log.md
 *              openspec/decisions/ADR-009-manual-recovery-flow.md
 */
import { z } from "zod";

export const SafetyEventName = z.enum([
  "edge_online",          // Edge Agent connected to room
  "safe_mode_entered",    // Edge entered safe_mode (with reason)
  "safe_mode_left",       // Edge accepted operator resume_control
  "emergency_stop_acked", // Edge processed an emergency_stop command
  "edge_disconnecting",   // Edge intentionally shutting down (graceful)
  "fatal",                // Unrecoverable — admin intervention required
]);

export type SafetyEventName = z.infer<typeof SafetyEventName>;

export const SafetyEvent = z.object({
  kind: z.literal("safety_event"),
  v: z.literal(1),
  ts: z.number().int().nonnegative(), // Edge UTC ms
  vehicleId: z.string().min(1),
  sessionId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  event: SafetyEventName,
  /** Machine-readable reason code, e.g. "boot_default", "heartbeat_timeout", "emergency_stop", "room_disconnected" */
  reason: z.string().optional(),
  /** Optional human-readable description (e.g. localized text). */
  message: z.string().optional(),
});

export type SafetyEvent = z.infer<typeof SafetyEvent>;

export function encodeSafetyEvent(e: SafetyEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(e));
}

/** Decode + validate. Returns null if payload is not a SafetyEvent. */
export function decodeSafetyEvent(bytes: Uint8Array): SafetyEvent | null {
  try {
    const text = new TextDecoder().decode(bytes);
    const json: unknown = JSON.parse(text);
    const parsed = SafetyEvent.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
