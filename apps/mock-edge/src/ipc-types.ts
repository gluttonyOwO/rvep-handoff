/**
 * IPC type definitions for the RVEP Edge Agent ↔ Go Publisher protocol.
 *
 * These types MUST stay aligned with:
 *   apps/edge-publisher-go/internal/ipc/protocol.go
 *
 * Transport: Unix domain socket, JSON Lines (\n delimited).
 * Phase 1 message set:
 *   publisher → agent : hello, heartbeat, error
 *   agent → publisher : start, stop
 *
 * Spec: openspec/edge/ipc-protocol.md
 */

import { z } from "zod";

// ── Shared base ───────────────────────────────────────────────────────────────

/** Mirrors Go ipc.Base */
export interface BaseMessage {
  /** Message type discriminator */
  type: string;
  /** ISO 8601 UTC with millisecond precision, e.g. "2026-05-17T10:00:00.000Z" */
  ts: string;
  /** Per-sender monotonically increasing sequence number */
  seq: number;
}

// ── Publisher → Agent ─────────────────────────────────────────────────────────

/** Mirrors Go ipc.HelloMsg */
export interface HelloMessage extends BaseMessage {
  type: "hello";
  /** Semver string, e.g. "0.1.0" */
  version: string;
  /** OS PID of the publisher process */
  pid: number;
  /** Camera identifier, e.g. "front" or "rear" */
  cameraId: string;
  /** Platform identifier, e.g. "jetson-agx-orin" */
  platformId: string;
}

/** Mirrors Go ipc.PublisherState constants */
export type PublisherState = "starting" | "publishing" | "reconnecting" | "error";

/** Mirrors Go ipc.HeartbeatMetrics */
export interface HeartbeatMetrics {
  fps: number;
  encodeLatencyMs: number;
  bitrateBps: number;
  framesPublished: number;
  framesDropped: number;
  nvencSessionId: number;
}

/** Mirrors Go ipc.HeartbeatMsg */
export interface HeartbeatMessage extends BaseMessage {
  type: "heartbeat";
  publisherState: PublisherState;
  metrics: HeartbeatMetrics;
}

/** Mirrors Go ipc.ErrorCode constants */
export type ErrorCode =
  | "gst_pipeline_failed"
  | "nvenc_unavailable"
  | "livekit_auth_failed"
  | "socket_closed";

/** Mirrors Go ipc.ErrorMsg */
export interface ErrorMessage extends BaseMessage {
  type: "error";
  code: ErrorCode;
  message: string;
  /** true → publisher is about to exit; Edge Agent must schedule a respawn */
  fatal: boolean;
}

// ── Agent → Publisher ─────────────────────────────────────────────────────────

/** Mirrors Go ipc.StartMsg */
export interface StartMessage extends BaseMessage {
  type: "start";
  livekitUrl: string;
  livekitToken: string;
  roomName: string;
  identity: string;
  videoProfileId: string;
  /** null → publisher uses profile-default pipeline */
  pipelineOverride: string | null;
}

/** Mirrors Go ipc.StopReason constants */
export type StopReason = "user_request" | "safe_mode" | "shutdown";

/** Mirrors Go ipc.StopMsg */
export interface StopMessage extends BaseMessage {
  type: "stop";
  reason: StopReason;
}

// ── Discriminated union ───────────────────────────────────────────────────────

/** All messages the publisher can send to the agent */
export type PublisherToAgentMessage = HelloMessage | HeartbeatMessage | ErrorMessage;

/** All messages the agent can send to the publisher */
export type AgentToPublisherMessage = StartMessage | StopMessage;

/** Any IPC message */
export type IPCMessage = PublisherToAgentMessage | AgentToPublisherMessage;

// ── Zod runtime validators ────────────────────────────────────────────────────
// Used to validate incoming messages from the Go publisher at runtime.

const baseSchema = z.object({
  type: z.string(),
  ts: z.string(),
  seq: z.number().int(),
});

const heartbeatMetricsSchema = z.object({
  fps: z.number(),
  encodeLatencyMs: z.number(),
  bitrateBps: z.number(),
  framesPublished: z.number(),
  framesDropped: z.number(),
  nvencSessionId: z.number().int(),
});

export const helloSchema = baseSchema.extend({
  type: z.literal("hello"),
  version: z.string(),
  pid: z.number().int().positive(),
  cameraId: z.string().min(1),
  platformId: z.string().min(1),
});

export const heartbeatSchema = baseSchema.extend({
  type: z.literal("heartbeat"),
  publisherState: z.enum(["starting", "publishing", "reconnecting", "error"]),
  metrics: heartbeatMetricsSchema,
});

export const errorSchema = baseSchema.extend({
  type: z.literal("error"),
  code: z.enum([
    "gst_pipeline_failed",
    "nvenc_unavailable",
    "livekit_auth_failed",
    "socket_closed",
  ]),
  message: z.string(),
  fatal: z.boolean(),
});

/**
 * Parse and validate an incoming JSON Line from the publisher.
 * Returns a typed PublisherToAgentMessage or throws ZodError.
 */
export function parsePublisherMessage(raw: string): PublisherToAgentMessage {
  const obj: unknown = JSON.parse(raw);
  const base = baseSchema.parse(obj);

  switch (base.type) {
    case "hello":
      return helloSchema.parse(obj) as HelloMessage;
    case "heartbeat":
      return heartbeatSchema.parse(obj) as HeartbeatMessage;
    case "error":
      return errorSchema.parse(obj) as ErrorMessage;
    default:
      throw new Error(`ipc-types: unknown publisher message type: ${base.type}`);
  }
}
