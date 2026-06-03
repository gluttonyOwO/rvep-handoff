"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listVehicles,
  getVehicleStatus,
  logout,
  ApiError,
  Vehicle,
  VehicleStatus,
} from "@/lib/api-client";
import {
  classifyDevice,
  compareByOnlineRecency,
  fleetToCsv,
  triggerDownload,
  type DeviceClass,
} from "@/lib/device-profile";
import { Brand } from "@/components/ui/Brand";
import { Button } from "@/components/ui/Button";
import { CardButton } from "@/components/ui/Card";
import { StatusDot } from "@/components/ui/Stat";

export default function VehiclesPage() {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, VehicleStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [csvToast, setCsvToast] = useState<string | null>(null);

  useEffect(() => {
    listVehicles()
      .then(setVehicles)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        setError(err instanceof ApiError ? err.code : "network_error");
      });
  }, [router]);

  // Poll each vehicle's aggregated status every 2 s — light enough for Phase 1.
  useEffect(() => {
    if (!vehicles || vehicles.length === 0) return;
    let cancelled = false;

    async function pollAll() {
      const results = await Promise.all(
        (vehicles ?? []).map(async (v) => {
          try {
            const s = await getVehicleStatus(v.vehicleId);
            return [v.vehicleId, s] as const;
          } catch {
            return [v.vehicleId, null] as const;
          }
        }),
      );
      if (cancelled) return;
      setStatuses((prev) => {
        const next = { ...prev };
        for (const [id, s] of results) {
          if (s) next[id] = s;
        }
        return next;
      });
    }

    void pollAll();
    const t = setInterval(pollAll, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [vehicles]);

  async function onLogout() {
    await logout();
    router.replace("/login");
  }

  // Online-first ordering for predictable demo: live devices float to the top.
  const sortedVehicles = useMemo(() => {
    if (!vehicles) return null;
    return [...vehicles].sort((a, b) => compareByOnlineRecency(a, b, statuses));
  }, [vehicles, statuses]);

  function onExportCsv() {
    if (!vehicles) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `rvep-fleet-${stamp}.csv`;
    triggerDownload(filename, fleetToCsv(vehicles, statuses));
    // P0-9: toast feedback after CSV download
    setCsvToast(`已下載 ${filename}`);
    setTimeout(() => setCsvToast(null), 3000);
  }

  return (
    <main className="min-h-screen max-w-5xl mx-auto p-6 sm:p-10">
      {/* P0-9: CSV download toast */}
      {csvToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-sm text-emerald-200 backdrop-blur whitespace-nowrap shadow-lg"
          data-testid="csv-toast"
        >
          ✓ {csvToast}
        </div>
      )}

      <header className="flex items-center justify-between mb-12">
        <Brand size="md" />
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/admin/audit")}
            data-testid="audit-link"
          >
            事件審計
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/admin/datasets")}
            data-testid="datasets-link"
          >
            Dataset
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onExportCsv}
            data-testid="export-csv"
            disabled={!vehicles || vehicles.length === 0}
          >
            匯出 CSV
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} data-testid="logout-btn">
            登出
          </Button>
        </div>
      </header>

      <section className="mb-8">
        <h1 className="text-4xl font-semibold tracking-tight">Fleet</h1>
        <p className="mt-2 text-sm text-neutral-400">
          選擇一台車輛開始操作或監看
        </p>
      </section>

      {error && (
        <p className="text-sm text-[var(--accent-red)] mb-4">錯誤：{error}</p>
      )}

      {vehicles === null && !error && (
        <p className="text-sm text-neutral-500">載入中…</p>
      )}

      <ul className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="vehicle-list">
        {sortedVehicles?.map((v) => (
          <li key={v.vehicleId}>
            <VehicleCard
              vehicle={v}
              status={statuses[v.vehicleId] ?? null}
              onClick={() => router.push(`/control/${v.vehicleId}`)}
            />
          </li>
        ))}
        {sortedVehicles?.length === 0 && (
          <p className="text-sm text-neutral-500 col-span-full">沒有可控制的車輛</p>
        )}
      </ul>
    </main>
  );
}

function VehicleCard({
  vehicle,
  status,
  onClick,
}: {
  vehicle: Vehicle;
  status: VehicleStatus | null;
  onClick: () => void;
}) {
  // Prefer live telemetry mode → fallback to db `status` field.
  const live = status?.online === true;
  const mode = status?.telemetry?.mode;
  const tone = !live
    ? "offline"
    : mode === "manual"
      ? "online"
      : mode === "safe"
        ? "warning"
        : "offline";

  const modeLabel: Record<string, string> = {
    manual: "手動駕駛",
    safe: "安全模式",
    off: "離線",
    calibrating: "校正中",
  };
  const statusText = live
    ? mode
      ? modeLabel[mode] ?? mode
      : "已連線"
    : status
      ? "離線"
      : "未知";

  const lastSeen = status?.lastSeenMs;
  const lastSeenText =
    lastSeen === null || lastSeen === undefined
      ? "—"
      : lastSeen < 5000
        ? "即時"
        : lastSeen < 60_000
          ? `${Math.floor(lastSeen / 1000)} 秒前`
          : `${Math.floor(lastSeen / 60_000)} 分前`;

  return (
    <CardButton
      onClick={onClick}
      data-testid={`vehicle-${vehicle.vehicleId}`}
      className="p-6 sm:p-7 group"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">
              {vehicle.vehicleId}
            </p>
            <DeviceBadge kind={classifyDevice(vehicle)} />
          </div>
          <h3 className="text-2xl font-semibold tracking-tight mt-1">
            {vehicle.displayName}
          </h3>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 border border-[var(--border-subtle)]">
          <StatusDot tone={tone} />
          <span className="text-xs text-neutral-300">{statusText}</span>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-neutral-500">類型</dt>
        <dd className="text-neutral-300 text-right">{vehicle.vehicleType}</dd>

        <dt className="text-neutral-500">操作員</dt>
        <dd className="text-neutral-300 text-right">
          {status?.lease?.operatorName ?? <span className="text-neutral-600">— 無</span>}
        </dd>

        <dt className="text-neutral-500">電量</dt>
        <dd className="text-neutral-300 text-right tabular-nums">
          {status?.telemetry?.batteryPct != null
            ? `${status.telemetry.batteryPct.toFixed(0)}%`
            : "—"}
        </dd>

        <dt className="text-neutral-500">RTT</dt>
        <dd className="text-neutral-300 text-right tabular-nums">
          {status?.telemetry?.networkRttMs != null
            ? `${status.telemetry.networkRttMs.toFixed(0)} ms`
            : "—"}
        </dd>

        <dt className="text-neutral-500">最後訊號</dt>
        <dd className="text-neutral-300 text-right">{lastSeenText}</dd>
      </dl>

      <div className="flex items-end justify-end mt-4">
        <span className="text-sm text-neutral-500 group-hover:text-white transition-colors">
          進入駕駛艙 →
        </span>
      </div>
    </CardButton>
  );
}

function DeviceBadge({ kind }: { kind: DeviceClass }) {
  const label = kind === "EDGE_NODE" ? "EDGE" : "VEHICLE";
  const tone =
    kind === "EDGE_NODE"
      ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] border-[var(--accent-blue)]/40"
      : "bg-[var(--accent-green)]/15 text-[var(--accent-green)] border-[var(--accent-green)]/40";
  return (
    <span
      data-testid={`device-badge-${kind}`}
      className={`text-[11px] uppercase tracking-[0.16em] px-1.5 py-0.5 rounded border ${tone}`}
    >
      {label}
    </span>
  );
}
