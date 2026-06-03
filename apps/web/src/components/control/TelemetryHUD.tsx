"use client";

import type { TelemetryMessage } from "@rvep/shared";

/**
 * Tesla-style HUD overlay panel displaying live vehicle telemetry.
 *
 * Source: telemetry messages published by Edge Agent at 5 Hz over the
 * Livekit DataChannel (topic="telemetry").
 */

interface Props {
  telemetry: TelemetryMessage | null;
  /** ms since last telemetry — used to grey out HUD if stale */
  staleMs: number;
}

export function TelemetryHUD({ telemetry, staleMs }: Props) {
  const stale = staleMs > 1500;
  const noData = !telemetry;

  return (
    <div
      className={`pointer-events-none flex flex-col gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-black/65 backdrop-blur-md p-3 text-xs font-mono w-[220px] transition-opacity ${
        stale || noData ? "opacity-40" : "opacity-100"
      }`}
      data-testid="telemetry-hud"
    >
      {/* GPS block */}
      <Block label="GPS">
        {telemetry?.gps ? (
          <>
            <Row k="緯度" v={fmtCoord(telemetry.gps.lat, "N", "S")} />
            <Row k="經度" v={fmtCoord(telemetry.gps.lng, "E", "W")} />
            <Row
              k="速度"
              v={`${(telemetry.gps.speedMs ?? 0).toFixed(1)} m/s`}
            />
            <Row
              k="方位"
              v={`${(telemetry.gps.headingDeg ?? 0).toFixed(0)}°`}
            />
          </>
        ) : (
          <Row k="" v="無 GPS 訊號" />
        )}
      </Block>

      {/* Battery */}
      <Block label="電池">
        {telemetry?.battery ? (
          <>
            <BatteryBar pct={telemetry.battery.pct} />
            <Row
              k="電壓"
              v={`${(telemetry.battery.voltage ?? 0).toFixed(1)} V`}
            />
            <Row
              k="溫度"
              v={`${(telemetry.battery.tempC ?? 0).toFixed(0)} °C`}
            />
          </>
        ) : (
          <Row k="" v="無資料" />
        )}
      </Block>

      {/* Network */}
      <Block label="網路">
        {telemetry?.network ? (
          <>
            <Row k="RTT" v={`${telemetry.network.rttMs.toFixed(0)} ms`} />
            <Row
              k="抖動"
              v={`${(telemetry.network.jitterMs ?? 0).toFixed(1)} ms`}
            />
            <Row
              k="↑"
              v={`${((telemetry.network.kbpsUp ?? 0) / 1000).toFixed(1)} Mb/s`}
            />
          </>
        ) : (
          <Row k="" v="無資料" />
        )}
      </Block>

      {/* 🆕 Velocity (closed-loop feedback — bridge fills from /odom_combined) */}
      {telemetry?.velocity && (
        <Block label="實際速度">
          <Row
            k="linear"
            v={`${telemetry.velocity.linearX.toFixed(2)} m/s`}
          />
          <Row
            k="angular"
            v={`${telemetry.velocity.angularZ.toFixed(2)} rad/s`}
          />
        </Block>
      )}

      {/* 🆕 Odom pose */}
      {telemetry?.odom && (
        <Block label="位置">
          <Row
            k="x,y"
            v={`(${telemetry.odom.x.toFixed(2)}, ${telemetry.odom.y.toFixed(2)})`}
          />
          <Row
            k="yaw"
            v={`${((telemetry.odom.yaw * 180) / Math.PI).toFixed(0)}°`}
          />
        </Block>
      )}

      {/* Vehicle mode */}
      {telemetry?.vehicle && (
        <Block label="狀態">
          <Row
            k="模式"
            v={
              <span
                className={
                  telemetry.vehicle.mode === "manual"
                    ? "text-emerald-400"
                    : telemetry.vehicle.mode === "safe"
                      ? "text-amber-400"
                      : "text-neutral-400"
                }
              >
                {modeLabel(telemetry.vehicle.mode)}
              </span>
            }
          />
        </Block>
      )}

      {/* 🆕 Other Sensors — extension map dump (任意載具自訂 sensor) */}
      {telemetry?.sensors && Object.keys(telemetry.sensors).length > 0 && (
        <Block label="其他感測">
          {Object.entries(telemetry.sensors).slice(0, 6).map(([key, val]) => (
            <Row
              key={key}
              k={key.length > 18 ? key.slice(0, 16) + "…" : key}
              v={fmtSensorValue(val)}
            />
          ))}
          {Object.keys(telemetry.sensors).length > 6 && (
            <div className="text-[9px] text-neutral-600 text-right mt-0.5">
              … +{Object.keys(telemetry.sensors).length - 6} 項
            </div>
          )}
        </Block>
      )}

      <div className="text-[10px] text-neutral-500 mt-1 flex justify-between">
        <span>seq {telemetry?.seq ?? "—"}</span>
        <span>{stale ? `stale ${(staleMs / 1000).toFixed(1)}s` : "live"}</span>
      </div>
    </div>
  );
}

function fmtSensorValue(v: unknown): string {
  if (typeof v === "number") return v.toFixed(2);
  if (typeof v === "boolean") return v ? "✓" : "✗";
  if (v === null) return "—";
  if (typeof v === "string") return v.length > 14 ? v.slice(0, 12) + "…" : v;
  return JSON.stringify(v).slice(0, 14);
}

function Block(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--border-subtle)] last:border-b-0 pb-1.5 last:pb-0">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-0.5">
        {props.label}
      </div>
      <div className="space-y-0.5">{props.children}</div>
    </div>
  );
}

function Row(props: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 text-neutral-200">
      <span className="text-neutral-500 min-w-[40px]">{props.k}</span>
      <span className="tabular-nums">{props.v}</span>
    </div>
  );
}

function BatteryBar({ pct }: { pct: number }) {
  const color =
    pct > 50
      ? "bg-emerald-500"
      : pct > 20
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-neutral-800 rounded-sm overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="tabular-nums text-neutral-200 min-w-[30px] text-right">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

function fmtCoord(v: number, pos: string, neg: string) {
  const abs = Math.abs(v);
  return `${abs.toFixed(5)}°${v >= 0 ? pos : neg}`;
}

function modeLabel(m: "manual" | "safe" | "off" | "calibrating") {
  switch (m) {
    case "manual":
      return "手動駕駛";
    case "safe":
      return "安全模式";
    case "off":
      return "離線";
    case "calibrating":
      return "校正中";
  }
}
