/**
 * GoPublisherManager — spawn & lifecycle management for the Go video publisher sidecar.
 *
 * Responsibilities:
 *  - Create Unix socket server at /var/run/rvep/{vehicleId}/publisher-{cameraId}.sock
 *  - Spawn the rvep-publisher Go binary with the correct env vars
 *  - Drive the IPC handshake: hello → start (with Livekit token)
 *  - Monitor heartbeat (3-second watchdog) → kill + restart on timeout
 *  - Handle error messages: fatal=true → restart, fatal=false → log only
 *  - Implement exponential back-off restart: 1s→2s→4s→8s→16s→30s cap
 *  - Stop after 10 consecutive failures → emit "failed" and give up
 *  - Provide stop() for graceful shutdown (send stop msg → wait → SIGKILL after 5s)
 *
 * Spec: openspec/edge/ipc-protocol.md, openspec/decisions/ADR-006-go-video-publisher.md
 */

import { EventEmitter } from "events";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { spawn, type ChildProcess } from "child_process";

import {
  parsePublisherMessage,
  type HelloMessage,
  type HeartbeatMessage,
  type ErrorMessage,
  type StartMessage,
  type StopMessage,
  type StopReason,
} from "./ipc-types.js";
import { mintPublisherToken } from "./livekit-publisher-token.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const HEARTBEAT_TIMEOUT_MS = 3_000;
const HEARTBEAT_CHECK_INTERVAL_MS = 500;
const STOP_GRACEFUL_TIMEOUT_MS = 5_000;
const MAX_RESTART_ATTEMPTS = 10;

const BACKOFF_STEPS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

function backoffMs(attempt: number): number {
  const idx = Math.min(attempt, BACKOFF_STEPS_MS.length - 1);
  return BACKOFF_STEPS_MS[idx];
}

// ── Camera / launch config ────────────────────────────────────────────────────

export interface CameraProfile {
  /** e.g. "front" or "rear" */
  cameraId: string;
  /** Absolute path to the camera YAML profile */
  cameraProfilePath: string;
  /** Video profile ID passed to the publisher in the start message */
  videoProfileId: string;
}

export interface GoPublisherManagerConfig {
  vehicleId: string;
  camera: CameraProfile;

  /** Livekit connection info */
  livekitUrl: string;
  apiKey: string;
  apiSecret: string;

  /** Full room name, e.g. "ugv-vehicle-001" */
  roomName: string;

  /**
   * Override for publisher binary path.
   * Defaults to RVEP_PUBLISHER_BIN env var or /usr/local/bin/rvep-publisher.
   */
  publisherBin?: string;
}

// ── Typed events ──────────────────────────────────────────────────────────────

export interface GoPublisherManagerEvents {
  /** Fired every time a heartbeat arrives from the publisher */
  heartbeat: [msg: HeartbeatMessage];
  /** Fired when the manager's internal state changes */
  stateChange: [state: ManagerState];
  /** Non-fatal error from publisher or internal manager error */
  error: [err: Error];
  /** Publisher process exited unexpectedly */
  crashed: [code: number | null, signal: NodeJS.Signals | null];
  /** Publisher was successfully restarted after a crash */
  restarted: [attempt: number];
  /** Max restart attempts exhausted — human intervention required */
  failed: [];
}

export type ManagerState =
  | "idle"
  | "starting"         // socket server up, spawning process
  | "handshaking"      // waiting for hello
  | "running"          // received hello, sent start, receiving heartbeats
  | "stopping"         // stop() called, waiting for graceful exit
  | "restarting"       // in back-off delay before re-spawn
  | "failed";          // max retries exhausted

// ── Main class ────────────────────────────────────────────────────────────────

export class GoPublisherManager extends EventEmitter {
  private readonly cfg: Required<GoPublisherManagerConfig>;
  private readonly socketPath: string;

  private state: ManagerState = "idle";
  private server: net.Server | null = null;
  private child: ChildProcess | null = null;
  private connection: net.Socket | null = null;

  /** Agent-side outgoing sequence counter (separate from publisher's seq) */
  private outSeq = 0;

  private lastHeartbeatTs = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private consecutiveFailures = 0;
  private stopRequested = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(cfg: GoPublisherManagerConfig) {
    super();

    const publisherBin =
      cfg.publisherBin ??
      process.env["RVEP_PUBLISHER_BIN"] ??
      "/usr/local/bin/rvep-publisher";

    this.cfg = { ...cfg, publisherBin };

    this.socketPath = `/var/run/rvep/${cfg.vehicleId}/publisher-${cfg.camera.cameraId}.sock`;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Start the Unix socket server and spawn the publisher for the first time. */
  async start(): Promise<void> {
    if (this.state !== "idle") {
      throw new Error(`GoPublisherManager[${this.cfg.camera.cameraId}]: already started`);
    }
    await this.ensureSocketDir();
    await this.startSocketServer();
    this.spawnPublisher();
  }

  /**
   * Gracefully stop the publisher.
   * Sends a "stop" message, waits up to 5 s for the process to exit,
   * then SIGKILL if still alive. Also closes the socket server.
   */
  async stop(): Promise<void> {
    this.stopRequested = true;
    this.setState("stopping");

    // Cancel any pending restart
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    this.stopHeartbeatWatcher();

    if (this.connection) {
      this.sendMessage<StopMessage>({ type: "stop", reason: "shutdown" });
    }

    if (this.child) {
      await this.waitForExit(this.child, STOP_GRACEFUL_TIMEOUT_MS);
    }

    this.closeServer();
    this.setState("idle");
  }

  // ── EventEmitter typed overrides ────────────────────────────────────────────

  on<K extends keyof GoPublisherManagerEvents>(
    event: K,
    listener: (...args: GoPublisherManagerEvents[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof GoPublisherManagerEvents>(
    event: K,
    ...args: GoPublisherManagerEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  // ── Internal: state helpers ─────────────────────────────────────────────────

  private setState(s: ManagerState): void {
    if (this.state === s) return;
    this.state = s;
    this.emit("stateChange", s);
  }

  // ── Internal: socket directory ──────────────────────────────────────────────

  private async ensureSocketDir(): Promise<void> {
    const dir = path.dirname(this.socketPath);
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  }

  // ── Internal: Unix socket server ────────────────────────────────────────────

  private async startSocketServer(): Promise<void> {
    // Remove stale socket file if present (avoids EADDRINUSE on restart)
    await this.unlinkSocket();

    this.server = net.createServer((socket) => {
      this.onPublisherConnected(socket);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.on("error", (err) => {
        this.emitError(`socket server error: ${err.message}`, err);
        reject(err);
      });
      this.server!.listen({ path: this.socketPath }, () => {
        // Restrict socket to owner only (0600)
        try {
          fs.chmodSync(this.socketPath, 0o600);
        } catch {
          // Non-fatal; file permission best-effort
        }
        resolve();
      });
    });

    console.log(
      `[publisher-mgr:${this.cfg.camera.cameraId}] listening on ${this.socketPath}`,
    );
  }

  private closeServer(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    void this.unlinkSocket();
  }

  private async unlinkSocket(): Promise<void> {
    try {
      await fs.promises.unlink(this.socketPath);
    } catch {
      // File might not exist — that is fine
    }
  }

  // ── Internal: connection handling ───────────────────────────────────────────

  private onPublisherConnected(socket: net.Socket): void {
    console.log(`[publisher-mgr:${this.cfg.camera.cameraId}] publisher connected`);
    this.connection = socket;
    this.setState("handshaking");

    socket.on("close", () => {
      this.connection = null;
    });
    socket.on("error", (err) => {
      this.emitError(`publisher socket error: ${err.message}`, err);
      this.connection = null;
    });

    const rl = readline.createInterface({ input: socket, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      this.handleIncomingLine(line);
    });
    rl.on("close", () => {
      // Socket closed by publisher side
      this.connection = null;
    });
  }

  private handleIncomingLine(line: string): void {
    let msg;
    try {
      msg = parsePublisherMessage(line);
    } catch (err) {
      this.emitError(`malformed IPC message: ${(err as Error).message}`);
      return;
    }

    switch (msg.type) {
      case "hello":
        void this.onHello(msg);
        break;
      case "heartbeat":
        this.onHeartbeat(msg);
        break;
      case "error":
        this.onPublisherError(msg);
        break;
    }
  }

  // ── Internal: IPC message handlers ─────────────────────────────────────────

  private async onHello(msg: HelloMessage): Promise<void> {
    console.log(
      `[publisher-mgr:${this.cfg.camera.cameraId}] hello pid=${msg.pid} version=${msg.version}`,
    );

    let token: string;
    try {
      token = await mintPublisherToken({
        apiKey: this.cfg.apiKey,
        apiSecret: this.cfg.apiSecret,
        room: this.cfg.roomName,
        identity: `edge-${this.cfg.camera.cameraId}`,
        ttlSeconds: 3600,
      });
    } catch (err) {
      this.emitError(`failed to mint publisher token: ${(err as Error).message}`, err as Error);
      return;
    }

    this.sendMessage<StartMessage>({
      type: "start",
      livekitUrl: this.cfg.livekitUrl,
      livekitToken: token,
      roomName: this.cfg.roomName,
      identity: `edge-${this.cfg.camera.cameraId}`,
      videoProfileId: this.cfg.camera.videoProfileId,
      pipelineOverride: null,
    });

    this.setState("running");
    this.lastHeartbeatTs = Date.now();
    this.startHeartbeatWatcher();

    console.log(
      `[publisher-mgr:${this.cfg.camera.cameraId}] sent start, pipeline running`,
    );
  }

  private onHeartbeat(msg: HeartbeatMessage): void {
    this.lastHeartbeatTs = Date.now();
    this.emit("heartbeat", msg);
  }

  private onPublisherError(msg: ErrorMessage): void {
    if (msg.fatal) {
      console.error(
        `[publisher-mgr:${this.cfg.camera.cameraId}] fatal error code=${msg.code}: ${msg.message}`,
      );
      // Publisher will exit; crash handler will schedule restart
    } else {
      console.warn(
        `[publisher-mgr:${this.cfg.camera.cameraId}] non-fatal error code=${msg.code}: ${msg.message}`,
      );
      this.emitError(`publisher error [${msg.code}]: ${msg.message}`);
    }
  }

  // ── Internal: heartbeat watchdog ────────────────────────────────────────────

  private startHeartbeatWatcher(): void {
    this.stopHeartbeatWatcher();
    this.heartbeatTimer = setInterval(() => {
      if (this.state !== "running") return;
      if (this.lastHeartbeatTs === 0) return;
      const age = Date.now() - this.lastHeartbeatTs;
      if (age > HEARTBEAT_TIMEOUT_MS) {
        console.warn(
          `[publisher-mgr:${this.cfg.camera.cameraId}] heartbeat timeout (${age}ms), killing publisher`,
        );
        this.killChild();
        // Restart will be scheduled by onChildExit
      }
    }, HEARTBEAT_CHECK_INTERVAL_MS);
  }

  private stopHeartbeatWatcher(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Internal: spawn & restart ────────────────────────────────────────────────

  private spawnPublisher(): void {
    if (this.stopRequested) return;

    this.setState("starting");
    this.lastHeartbeatTs = 0;

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      RVEP_SOCKET_PATH: this.socketPath,
      RVEP_CAMERA_PROFILE: this.cfg.camera.cameraProfilePath,
    };

    console.log(
      `[publisher-mgr:${this.cfg.camera.cameraId}] spawning ${this.cfg.publisherBin}`,
    );

    const child = spawn(this.cfg.publisherBin, [], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    this.child = child;

    // Forward publisher stdout/stderr to our console
    child.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(`[publisher:${this.cfg.camera.cameraId}] ${chunk.toString()}`);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[publisher:${this.cfg.camera.cameraId}] ${chunk.toString()}`);
    });

    child.on("exit", (code, signal) => {
      this.onChildExit(code, signal);
    });

    child.on("error", (err) => {
      this.emitError(`failed to spawn publisher: ${err.message}`, err);
    });
  }

  private onChildExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = null;
    this.connection = null;
    this.stopHeartbeatWatcher();

    if (this.stopRequested) {
      // Intentional stop — do not restart
      return;
    }

    this.emit("crashed", code, signal);
    console.warn(
      `[publisher-mgr:${this.cfg.camera.cameraId}] publisher exited code=${code} signal=${signal}`,
    );

    this.consecutiveFailures++;

    if (this.consecutiveFailures > MAX_RESTART_ATTEMPTS) {
      console.error(
        `[publisher-mgr:${this.cfg.camera.cameraId}] max restart attempts (${MAX_RESTART_ATTEMPTS}) exhausted — giving up`,
      );
      this.setState("failed");
      this.emit("failed");
      this.closeServer();
      return;
    }

    const delay = backoffMs(this.consecutiveFailures - 1);
    console.log(
      `[publisher-mgr:${this.cfg.camera.cameraId}] restarting in ${delay}ms (attempt ${this.consecutiveFailures}/${MAX_RESTART_ATTEMPTS})`,
    );
    this.setState("restarting");

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.stopRequested) return;
      this.emit("restarted", this.consecutiveFailures);
      this.spawnPublisher();
    }, delay);
  }

  // ── Internal: send message to publisher ────────────────────────────────────

  private sendMessage<T extends { type: string }>(
    payload: Omit<T, "ts" | "seq">,
  ): void {
    if (!this.connection || this.connection.destroyed) return;

    this.outSeq++;
    const msg = {
      ...payload,
      ts: new Date().toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z"),
      seq: this.outSeq,
    };

    const line = JSON.stringify(msg) + "\n";
    this.connection.write(line, (err) => {
      if (err) {
        this.emitError(`failed to write to publisher socket: ${err.message}`, err);
      }
    });
  }

  // ── Internal: kill child ────────────────────────────────────────────────────

  private killChild(): void {
    if (!this.child) return;
    try {
      this.child.kill("SIGKILL");
    } catch {
      // Process already gone
    }
  }

  // ── Internal: wait for process exit with timeout ────────────────────────────

  private waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          try { child.kill("SIGKILL"); } catch { /* already gone */ }
          resolve();
        }
      }, timeoutMs);

      child.once("exit", () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }

  // ── Internal: emit typed error ──────────────────────────────────────────────

  private emitError(message: string, cause?: Error): void {
    const err = cause ?? new Error(message);
    if (!cause) err.message = message;
    this.emit("error", err);
  }
}
