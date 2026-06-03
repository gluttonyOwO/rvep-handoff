import * as fs from "fs";
import * as path from "path";

/**
 * Phase 1 dataset metadata writer.
 *
 * Appends per-frame metadata to local JSONL (one file per session).  On
 * `finalize()` it (a) closes the file and (b) reports the artefact to the
 * backend so it can be registered as a `DatasetAsset` row.
 *
 * Spec sources:
 *   - openspec/features/c4-ai-training-data-storage.md
 *   - openspec/data/metadata-jsonl.md (frame identity SSOT)
 *
 * Phase 1 simplifications:
 *   - No actual video files — only metadata
 *   - cameraId / frameNo are placeholders since we don't yet own video frames
 *   - One JSONL per session covers both telemetry samples + safety events
 */

export interface MetadataFrame {
  ts: string;                // ISO 8601 UTC ms
  monotonicNs: number;
  vehicleId: string;
  sessionId: string;
  connectionEpoch: number;
  cameraId: string;          // "front" / "rear" / "all" (phase 1 uses "all")
  frameNo: number;
  datasetVersion: "v1";
  gps?: unknown;
  imu?: unknown;
  battery?: unknown;
  network?: unknown;
  mode?: string;
  control?: unknown;
  event?: string | null;
  operatorId?: string;
}

export interface MetadataWriterOptions {
  rootDir: string;           // e.g. "/var/lib/rvep/datasets"
  vehicleId: string;
  sessionId: string;         // business sessionId string
  backendUrl: string;
  internalToken: string;
}

export class MetadataWriter {
  private readonly filePath: string;
  private fd: number | null = null;
  private frameNo = 0;
  private startedAt = Date.now();
  private bytesWritten = 0;

  constructor(private readonly opts: MetadataWriterOptions) {
    const dir = path.join(
      opts.rootDir,
      sanitize(opts.vehicleId),
      sanitize(opts.sessionId),
    );
    fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, "metadata.jsonl");
  }

  open() {
    if (this.fd !== null) return;
    this.fd = fs.openSync(this.filePath, "a");
    console.log(`[dataset] writing metadata to ${this.filePath}`);
  }

  /** Append one frame; returns the assigned frameNo. */
  append(partial: Partial<MetadataFrame>): number {
    if (this.fd === null) this.open();
    this.frameNo += 1;
    const frame: MetadataFrame = {
      ts: new Date().toISOString(),
      monotonicNs: Number(process.hrtime.bigint()),
      vehicleId: this.opts.vehicleId,
      sessionId: this.opts.sessionId,
      connectionEpoch: 1,
      cameraId: "all",
      frameNo: this.frameNo,
      datasetVersion: "v1",
      ...partial,
    };
    const line = JSON.stringify(frame) + "\n";
    const bytes = Buffer.byteLength(line, "utf8");
    fs.writeSync(this.fd!, line);
    this.bytesWritten += bytes;
    return this.frameNo;
  }

  filePathRel(): string {
    return this.filePath;
  }

  /** Closes the file and POSTs a DatasetAsset record to backend. */
  async finalize(): Promise<void> {
    if (this.fd === null) return;
    try {
      fs.closeSync(this.fd);
    } catch {
      /* ignore */
    }
    this.fd = null;
    const durationMs = Date.now() - this.startedAt;
    console.log(
      `[dataset] finalised ${this.filePath} (${this.frameNo} frames, ${this.bytesWritten} bytes, ${durationMs}ms)`,
    );

    try {
      const res = await fetch(`${this.opts.backendUrl}/api/v1/internal/dataset-asset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": this.opts.internalToken,
        },
        body: JSON.stringify({
          vehicleId: this.opts.vehicleId,
          sessionId: this.opts.sessionId,
          cameraId: null,
          kind: "METADATA",
          source: "ORIN_LOCAL",
          path: this.filePath,
          sizeBytes: this.bytesWritten,
          durationMs,
          metadata: { frameCount: this.frameNo, datasetVersion: "v1" },
        }),
      });
      if (!res.ok) {
        console.warn(
          `[dataset] backend rejected manifest: ${res.status} ${await res.text()}`,
        );
      } else {
        console.log("[dataset] manifest registered");
      }
    } catch (err) {
      console.warn("[dataset] failed to register manifest:", (err as Error).message);
    }
  }
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}
