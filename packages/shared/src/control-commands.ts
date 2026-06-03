/**
 * Universal Control Command schemas — shared between web client, backend, and
 * Edge Agent. Source spec: openspec/control/universal-control-command.md
 *
 * All messages share base fields. The discriminator is `type`.
 */
import { z } from "zod";

const baseFields = {
  vehicleId: z.string().min(1),
  sessionId: z.string().min(1),
  connectionEpoch: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  timestamp: z.string().datetime(), // ISO 8601 UTC, millisecond precision
};

export const MovementCommand = z.object({
  type: z.literal("movement"),
  ...baseFields,
  axes: z.object({
    forward: z.number().min(-1).max(1),
    lateral: z.number().min(-1).max(1),
    yaw: z.number().min(-1).max(1),
  }),
});

export const EmergencyStopCommand = z.object({
  type: z.literal("emergency_stop"),
  ...baseFields,
});

export const HeartbeatMessage = z.object({
  type: z.literal("heartbeat"),
  ...baseFields,
});

export const ResumeControlCommand = z.object({
  type: z.literal("resume_control"),
  ...baseFields,
  acknowledgement: z.literal("operator_confirmed"),
});

export const ActionCommand = z.object({
  type: z.literal("action"),
  ...baseFields,
  action: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const ConfigCommand = z.object({
  type: z.literal("config"),
  ...baseFields,
  key: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const ControlCommand = z.discriminatedUnion("type", [
  MovementCommand,
  EmergencyStopCommand,
  HeartbeatMessage,
  ResumeControlCommand,
  ActionCommand,
  ConfigCommand,
]);

export type MovementCommand = z.infer<typeof MovementCommand>;
export type EmergencyStopCommand = z.infer<typeof EmergencyStopCommand>;
export type HeartbeatMessage = z.infer<typeof HeartbeatMessage>;
export type ResumeControlCommand = z.infer<typeof ResumeControlCommand>;
export type ActionCommand = z.infer<typeof ActionCommand>;
export type ConfigCommand = z.infer<typeof ConfigCommand>;
export type ControlCommand = z.infer<typeof ControlCommand>;

/**
 * Encode command to UTF-8 bytes for DataChannel publishData().
 */
export function encodeCommand(cmd: ControlCommand): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(cmd));
}

/**
 * Decode and validate a DataChannel payload. Returns null on parse / validation error.
 */
export function decodeCommand(bytes: Uint8Array): ControlCommand | null {
  try {
    const text = new TextDecoder().decode(bytes);
    const json: unknown = JSON.parse(text);
    const parsed = ControlCommand.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
