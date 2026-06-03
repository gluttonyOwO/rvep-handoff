"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listAudit, listVehicles, ApiError, AuditEntry, Vehicle } from "@/lib/api-client";
import { Brand } from "@/components/ui/Brand";
import { Button } from "@/components/ui/Button";

/**
 * Admin audit log viewer.  Reads /api/v1/audit and presents a sortable table
 * filtered by vehicle.  Authorization is server-side (admin sees all,
 * permission-scoped users see their own vehicles).
 */
export default function AuditLogPage() {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listVehicles()
      .then(setVehicles)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
        }
      });
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await listAudit(filter || undefined, 200);
        if (!cancelled) setEntries(data);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        setError(err instanceof ApiError ? err.code : "network_error");
      }
    }
    void load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [filter, router]);

  return (
    <main className="min-h-screen max-w-6xl mx-auto p-6 sm:p-10">
      <header className="flex items-center justify-between mb-8">
        <Brand size="md" />
        <Button variant="ghost" size="sm" onClick={() => router.push("/vehicles")}>
          ← 回 Fleet
        </Button>
      </header>

      <section className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">事件審計</h1>
        <p className="mt-2 text-sm text-neutral-400">
          所有 safe_mode 進入、緊急停止、控制交接、邊緣端連線事件
        </p>
      </section>

      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="vehicle-filter" className="text-sm text-neutral-400">
          車輛
        </label>
        <select
          id="vehicle-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="px-3 py-1.5 rounded-md bg-black/40 border border-[var(--border-subtle)] text-sm text-neutral-200"
          data-testid="audit-filter"
        >
          <option value="">所有車輛</option>
          {vehicles.map((v) => (
            <option key={v.vehicleId} value={v.vehicleId}>
              {v.displayName} ({v.vehicleId})
            </option>
          ))}
        </select>
        <span className="text-xs text-neutral-500">每 5 秒自動刷新</span>
      </div>

      {error && (
        <p className="text-sm text-[var(--accent-red)] mb-4" data-testid="audit-error">
          錯誤：{error}
        </p>
      )}

      {entries === null ? (
        <p className="text-sm text-neutral-500">載入中…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-neutral-500">無資料</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
          <table className="w-full text-sm" data-testid="audit-table">
            <thead className="bg-black/40 text-neutral-400 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2 font-medium">時間</th>
                <th className="text-left px-3 py-2 font-medium">車輛</th>
                <th className="text-left px-3 py-2 font-medium">事件</th>
                <th className="text-left px-3 py-2 font-medium">使用者</th>
                <th className="text-left px-3 py-2 font-medium">詳情</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.id}
                  className="border-t border-[var(--border-subtle)] hover:bg-white/5 transition"
                >
                  <td className="px-3 py-2 text-neutral-300 font-mono whitespace-nowrap">
                    {new Date(e.ts).toLocaleString("zh-TW", { hour12: false })}
                  </td>
                  <td className="px-3 py-2 text-neutral-300">{e.vehicleId ?? "—"}</td>
                  <td className="px-3 py-2">
                    <EventBadge name={e.eventName} />
                  </td>
                  <td className="px-3 py-2 text-neutral-400">{e.userId ?? "system"}</td>
                  <td className="px-3 py-2 text-neutral-500 font-mono text-xs truncate max-w-md">
                    {e.payload ? JSON.stringify(e.payload) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function EventBadge({ name }: { name: string }) {
  const danger = name.includes("emergency") || name.includes("fatal") || name.includes("failed");
  const warn = name.includes("safe_mode") || name.includes("denied") || name.includes("crashed");
  const ok = name.includes("online") || name.includes("recovery") || name.includes("track_published");
  const tone = danger
    ? "bg-red-500/15 text-red-300 border-red-500/30"
    : warn
      ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
      : ok
        ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
        : "bg-neutral-500/15 text-neutral-300 border-neutral-500/30";
  return (
    <span
      className={`px-2 py-0.5 rounded-md border text-xs font-mono ${tone}`}
    >
      {name}
    </span>
  );
}
