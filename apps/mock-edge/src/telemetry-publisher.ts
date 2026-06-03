/**
 * Mock telemetry publisher.
 *
 * Publishes a TelemetryMessage at 5 Hz on the Livekit DataChannel (reliable)
 * so every subscribed operator UI receives it.  Phase 1 values are all mocked
 * with plausible noise (Taipei coordinates, slow battery drain, random IMU).
 *
 * Source spec: openspec/features/c3-telemetry-status.md
 * Channel decision: ADR-008 — telemetry reuses control DataChannel.
 */
import { Room, DataPacket_Kind } from "@livekit/rtc-node";
import {
  encodeTelemetry,
  type TelemetryMessage,
  type VehicleStatus,
} from "@rvep/shared";

export interface TelemetryPublisherOptions {
  vehicleId: string;
  sessionId: string;
  room: Room;
  rateHz?: number; // default 5
  /** Returns current vehicle mode + lease holder, evaluated each tick. */
  getVehicleStatus: () => VehicleStatus;
  /** Optional: when set, every Nth message is POSTed for backend audit (default: every 5th = 1 Hz). */
  auditSink?: {
    backendUrl: string;
    internalToken: string;
    everyN?: number;
  };
}

export class MockTelemetryPublisher {
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;

  // Mock state (Taipei 101 area, slow random walk)
  private lat = 25.03386;
  private lng = 121.56455;
  private headingDeg = 87;
  private batteryPct = 78;
  private batteryVoltage = 24.8;
  private startedAt = Date.now();

  constructor(private readonly opts: TelemetryPublisherOptions) {}

  start() {
    if (this.timer) return;
    const intervalMs = 1000 / (this.opts.rateHz ?? 5);
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  async stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    const msg = this.composeMessage();
    try {
      const bytes = encodeTelemetry(msg);
      // publishData signature in @livekit/rtc-node v0.13 accepts
      // (data: Uint8Array, kind: DataPacket_Kind, opts?: { destinationIdentities?: string[]; topic?: string })
      // We send reliable to all (omit destinationIdentities) so any subscribed UI receives it.
      await this.opts.room.localParticipant?.publishData(bytes, {
        reliable: true,
        topic: "telemetry",
      });
    } catch (err) {
      // Single-tick publish failure is non-fatal; next tick will retry.
      console.warn("[telemetry] publish failed:", (err as Error).message);
    }

    // Sampled backend audit (default 1 Hz = every 5th of 5 Hz stream).
    const sink = this.opts.auditSink;
    if (sink && this.seq % (sink.everyN ?? 5) === 0) {
      void this.postAudit(msg, sink);
    }
  }

  private async postAudit(
    msg: TelemetryMessage,
    sink: NonNullable<TelemetryPublisherOptions["auditSink"]>,
  ) {
    try {
      await fetch(`${sink.backendUrl}/api/v1/internal/telemetry-frame`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": sink.internalToken,
        },
        body: JSON.stringify({
          vehicleId: msg.vehicleId,
          sessionId: msg.sessionId,
          ts: new Date(msg.ts).toISOString(),
          gps: msg.gps,
          imu: msg.imu,
          battery: msg.battery,
          network: msg.network,
          mode: msg.vehicle?.mode,
        }),
      });
    } catch (err) {
      // Audit failures are silent (UI already has the data; we'll retry next tick).
      console.warn("[telemetry] audit POST failed:", (err as Error).message);
    }
  }

  private composeMessage(): TelemetryMessage {
    this.seq += 1;
    const now = Date.now();
    const elapsedSec = (now - this.startedAt) / 1000;

    // Slow random walk: ~1 m/s lateral noise around Taipei 101 origin.
    this.lat += (Math.random() - 0.5) * 0.00001;
    this.lng += (Math.random() - 0.5) * 0.00001;
    this.headingDeg = (this.headingDeg + (Math.random() - 0.5) * 2 + 360) % 360;

    // Battery drains ~0.5% per minute (overly slow on purpose so demo doesn't die).
    this.batteryPct = Math.max(20, 78 - elapsedSec / 120);
    this.batteryVoltage = 22 + (this.batteryPct / 100) * 4;

    return {
      kind: "telemetry",
      v: 1,
      ts: now,
      vehicleId: this.opts.vehicleId,
      sessionId: this.opts.sessionId,
      seq: this.seq,

      gps: {
        lat: this.lat,
        lng: this.lng,
        altM: 12 + Math.sin(elapsedSec / 10) * 2,
        hAccM: 1.4,
        speedMs: 1.2 + Math.sin(elapsedSec / 5) * 0.8,
        headingDeg: this.headingDeg,
        fix: "3d",
      },
      imu: {
        ax: (Math.random() - 0.5) * 0.4,
        ay: (Math.random() - 0.5) * 0.4,
        az: 9.81 + (Math.random() - 0.5) * 0.2, // gravity
        gx: (Math.random() - 0.5) * 0.05,
        gy: (Math.random() - 0.5) * 0.05,
        gz: (Math.random() - 0.5) * 0.05,
      },
      battery: {
        pct: this.batteryPct,
        voltage: this.batteryVoltage,
        currentA: -2.1,
        tempC: 32 + Math.sin(elapsedSec / 20) * 2,
        mode: "discharging",
      },
      network: {
        // Phase 1: mocked RTT estimate. Phase 2 will derive from Livekit stats.
        rttMs: 22 + Math.random() * 18,
        jitterMs: 1 + Math.random() * 3,
        lossPct: Math.random() < 0.1 ? Math.random() * 0.5 : 0,
        kbpsUp: 4200 + Math.random() * 400,
        kbpsDown: 100 + Math.random() * 50,
      },
      vehicle: this.opts.getVehicleStatus(),
    };
  }
}
