import type { Vehicle, VehicleStatus } from "@/lib/api-client";

/**
 * Two-tier capability taxonomy used by the fleet view (S19).
 *
 *   EDGE_NODE — stationary compute attached to fixed sensors (eg. ZED-X test
 *               rig on a workbench, Orin DevKit with no chassis). Cannot
 *               accept movement commands; cockpit shows it as observe-only.
 *   VEHICLE   — mobile platform with drive-by-wire chassis. Cockpit shows
 *               joystick + STOP and full telemetry HUD.
 *
 * Until the backend exposes a proper `capabilities` field on /vehicles, we
 * derive the class from `vehicleType` strings + vehicleId prefix. Conservative
 * default: anything we don't recognise is treated as VEHICLE (driveable) so
 * we never accidentally hide the STOP button on a real chassis.
 */
export type DeviceClass = "EDGE_NODE" | "VEHICLE";

const EDGE_TYPE_PATTERNS = [
  /^edge[-_]/i,
  /^sensor[-_]/i,
  /^observation[-_]/i,
  /^bench[-_]/i,
];
const EDGE_ID_PATTERNS = [
  /^edge-/i,
  /^bench-/i,
  /^obs-/i,
];

export function classifyDevice(v: { vehicleId: string; vehicleType: string }): DeviceClass {
  if (EDGE_TYPE_PATTERNS.some((re) => re.test(v.vehicleType))) return "EDGE_NODE";
  if (EDGE_ID_PATTERNS.some((re) => re.test(v.vehicleId))) return "EDGE_NODE";
  return "VEHICLE";
}

/**
 * Sort comparator: online first, then most-recently-seen first, then by id.
 * Designed for stable display in the fleet grid.
 */
export function compareByOnlineRecency(
  a: { vehicleId: string },
  b: { vehicleId: string },
  statuses: Record<string, VehicleStatus | null | undefined>,
): number {
  const sa = statuses[a.vehicleId];
  const sb = statuses[b.vehicleId];
  const onlineA = sa?.online === true;
  const onlineB = sb?.online === true;
  if (onlineA !== onlineB) return onlineA ? -1 : 1;

  // Both online or both offline: prefer more recent lastSeenMs (smaller = newer).
  const lsA = sa?.lastSeenMs ?? Number.POSITIVE_INFINITY;
  const lsB = sb?.lastSeenMs ?? Number.POSITIVE_INFINITY;
  if (lsA !== lsB) return lsA - lsB;

  return a.vehicleId.localeCompare(b.vehicleId);
}

/**
 * Stable CSV export for a fleet snapshot. Used by the Export CSV button.
 * Returns a UTF-8 BOM-prefixed string so Excel + Numbers open it correctly.
 */
export function fleetToCsv(
  vehicles: Vehicle[],
  statuses: Record<string, VehicleStatus | null | undefined>,
): string {
  const header = [
    "vehicleId",
    "displayName",
    "vehicleType",
    "deviceClass",
    "online",
    "lastSeenMs",
    "operator",
    "mode",
    "batteryPct",
    "rttMs",
    "lat",
    "lng",
  ];
  const rows = vehicles.map((v) => {
    const s = statuses[v.vehicleId];
    const t = s?.telemetry ?? null;
    return [
      v.vehicleId,
      v.displayName,
      v.vehicleType,
      classifyDevice(v),
      s?.online === true ? "true" : "false",
      s?.lastSeenMs ?? "",
      s?.lease?.operatorName ?? "",
      t?.mode ?? "",
      t?.batteryPct ?? "",
      t?.networkRttMs ?? "",
      t?.gps?.lat ?? "",
      t?.gps?.lng ?? "",
    ];
  });
  const escape = (cell: unknown): string => {
    const s = String(cell ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header, ...rows].map((row) => row.map(escape).join(","));
  return "﻿" + lines.join("\n");
}

export function triggerDownload(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the click can resolve in slower browsers.
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
