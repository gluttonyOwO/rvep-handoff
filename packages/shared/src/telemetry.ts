/**
 * Vehicle telemetry messages — Edge Agent → Web UI via Livekit DataChannel.
 *
 * Source spec: openspec/features/c3-telemetry-status.md
 *
 * Direction: reverse of ControlCommand (which is operator → vehicle).
 * Telemetry is published reliably on the same DataChannel, distinguished by
 * its top-level `kind: "telemetry"` discriminator.
 *
 * Phase 1: all values mocked from Edge Agent; schema reserves real-hardware fields.
 * Phase 2+: real GPS / IMU / battery / network metrics.
 */
import { z } from "zod";

// Each sub-block is optional so a publisher can send partial frames when a
// particular sensor is unavailable (e.g. indoor → no GPS fix).

export const GpsFix = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  altM: z.number().optional(),
  hAccM: z.number().nonnegative().optional(), // horizontal accuracy
  speedMs: z.number().nonnegative().optional(), // ground speed m/s
  headingDeg: z.number().min(0).max(360).optional(),
  fix: z.enum(["none", "2d", "3d", "rtk"]).optional(),
});

export const Imu = z.object({
  // Linear acceleration m/s² (right-handed, X forward / Y left / Z up)
  ax: z.number(),
  ay: z.number(),
  az: z.number(),
  // Angular velocity rad/s
  gx: z.number(),
  gy: z.number(),
  gz: z.number(),
  // Orientation quaternion (optional, derived if AHRS available)
  oriQuat: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});

export const Battery = z.object({
  pct: z.number().min(0).max(100),
  voltage: z.number().nonnegative().optional(),
  currentA: z.number().optional(), // negative = discharging
  tempC: z.number().optional(),
  mode: z.enum(["charging", "discharging", "idle"]).optional(),
});

export const NetworkQuality = z.object({
  rttMs: z.number().nonnegative(),
  jitterMs: z.number().nonnegative().optional(),
  lossPct: z.number().min(0).max(100).optional(),
  kbpsUp: z.number().nonnegative().optional(),
  kbpsDown: z.number().nonnegative().optional(),
});

export const VehicleStatus = z.object({
  mode: z.enum(["manual", "safe", "off", "calibrating"]),
  controlLeaseHolder: z.string().optional(), // operator identity, null if none
});

// 🆕 Actual measured velocity (closed-loop feedback vs operator setpoint).
// Edge typically derives from /odom_combined.twist for diff-drive AMRs.
export const Velocity = z.object({
  linearX: z.number(),            // m/s — forward
  linearY: z.number().optional(), // m/s — lateral (holonomic only)
  angularZ: z.number(),           // rad/s — yaw rate
});

// 🆕 Odometry pose (where the vehicle thinks it is). Mainly for mini-map.
export const Odom = z.object({
  x: z.number(),                  // m
  y: z.number(),                  // m
  yaw: z.number(),                // rad
  frame: z.enum(["odom", "map"]).optional(),
});

export const TelemetryMessage = z.object({
  kind: z.literal("telemetry"),
  v: z.literal(1),
  ts: z.number().int().nonnegative(), // Edge UTC ms (authoritative clock)
  vehicleId: z.string().min(1),
  sessionId: z.string().min(1),
  seq: z.number().int().nonnegative(),

  // ── Core sensors (strict, version-controlled, cockpit has dedicated widget)
  // Each subsystem is optional — publisher omits blocks it has no data for.
  gps: GpsFix.optional(),
  imu: Imu.optional(),
  battery: Battery.optional(),
  network: NetworkQuality.optional(),
  vehicle: VehicleStatus.optional(),
  velocity: Velocity.optional(),
  odom: Odom.optional(),

  // ── Open extension (vehicle-agnostic sensor catch-all).
  // Use VSS-inspired dotted-path keys, e.g.:
  //   "wheels.frontLeft.speedMs", "battery.cells[3].voltage",
  //   "manipulator.joint[0].angleRad", "thermal.cpuC",
  //   "control.csm.source.state", "control.csm.active_source"
  // Cockpit renders these in a generic "Other Sensors" debug table.
  // Spec: see project_rvep_telemetry_architecture memory for naming convention.
  sensors: z.record(z.string(), z.union([
    z.number(),
    z.string(),
    z.boolean(),
    z.null(),
    z.record(z.string(), z.unknown()),
  ])).optional(),

  // 🆕 Capability advertisement — bridge declares which sensors it CAN publish.
  // Cockpit caches this on first frame and uses it to decide which widgets to
  // mount. Subsequent frames may omit (caller treats as unchanged).
  capabilities: z.array(z.string()).optional(),
});

export type GpsFix = z.infer<typeof GpsFix>;
export type Imu = z.infer<typeof Imu>;
export type Battery = z.infer<typeof Battery>;
export type NetworkQuality = z.infer<typeof NetworkQuality>;
export type VehicleStatus = z.infer<typeof VehicleStatus>;
export type Velocity = z.infer<typeof Velocity>;
export type Odom = z.infer<typeof Odom>;
export type TelemetryMessage = z.infer<typeof TelemetryMessage>;

/** Encode telemetry to UTF-8 bytes for DataChannel publishData(). */
export function encodeTelemetry(t: TelemetryMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(t));
}

/**
 * Decode and validate a DataChannel payload as a TelemetryMessage.
 * Returns null when payload is not telemetry-shaped (caller can fall through
 * to ControlCommand decoding without throwing).
 */
export function decodeTelemetry(bytes: Uint8Array): TelemetryMessage | null {
  try {
    const text = new TextDecoder().decode(bytes);
    const json: unknown = JSON.parse(text);
    const parsed = TelemetryMessage.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
