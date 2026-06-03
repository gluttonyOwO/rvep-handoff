"use client";

import { useEffect, useState } from "react";
import type { ControlChannel, ControlStats } from "@/lib/control-channel";

/**
 * Live Control Data panel — 浮動面板顯示 cmd_vel 數值 + Rate + 上次指令時間
 * 給合作方 demo 看「DataChannel 控制資料正在流動」的視覺證據。
 *
 * C6 enhancement, 2026-05-22.
 */
export interface LiveControlPanelProps {
  channel: ControlChannel | null;
  /** True when WebRTC DataChannel is established. */
  channelConnected: boolean;
  /** True when a gamepad is detected. */
  gamepadConnected: boolean;
  gamepadName?: string;
}

const FRESH_MS = 250; // ms within which we consider "active sending"

export function LiveControlPanel({
  channel,
  channelConnected,
  gamepadConnected,
  gamepadName,
}: LiveControlPanelProps) {
  const [stats, setStats] = useState<ControlStats | null>(null);

  useEffect(() => {
    if (!channel) {
      setStats(null);
      return;
    }
    const tick = () => setStats(channel.getStats());
    tick();
    const t = setInterval(tick, 100); // 10 Hz refresh
    return () => clearInterval(t);
  }, [channel]);

  if (!stats) return null;

  const isFresh = stats.lastCmdAgoMs < FRESH_MS;
  const tone = isFresh ? "var(--accent-green)" : "var(--fg-muted)";

  return (
    <aside
      data-cockpit-layer="L2"
      data-testid="live-control-panel"
      aria-label="即時控制資料"
      className="fixed left-4 bottom-44 z-30 w-[260px] rounded-lg border border-[var(--border-subtle)] bg-black/70 backdrop-blur px-3 py-2.5 text-[10px] uppercase tracking-[0.12em] text-neutral-300 shadow-lg pointer-events-none"
    >
      <header className="flex items-center justify-between mb-1.5 pb-1.5 border-b border-white/10">
        <span className="font-semibold text-neutral-100 text-[10.5px] tracking-[0.18em]">
          Live Control Data
        </span>
        <span
          className="text-[9px] tracking-[0.18em]"
          style={{ color: channelConnected ? "#4ade80" : "#f87171" }}
        >
          {channelConnected ? "● ON-AIR" : "○ OFFLINE"}
        </span>
      </header>

      <ul className="space-y-0.5 cockpit tabular-nums normal-case">
        <Row label="forward" value={stats.forward.toFixed(2)} unit="−1..1" tone={tone} />
        <Row label="lateral" value={stats.lateral.toFixed(2)} unit="−1..1" tone={tone} dim={Math.abs(stats.lateral) < 0.01} />
        <Row label="yaw" value={stats.yaw.toFixed(2)} unit="−1..1" tone={tone} />
        <Row label="rate" value={stats.rateHz.toString()} unit="Hz" tone={stats.rateHz > 0 ? "var(--accent-green)" : "var(--fg-muted)"} />
        <Row
          label="last cmd"
          value={
            stats.lastCmdAgoMs === Number.POSITIVE_INFINITY
              ? "—"
              : stats.lastCmdAgoMs < 1000
                ? `${stats.lastCmdAgoMs.toFixed(0)} ms`
                : `${(stats.lastCmdAgoMs / 1000).toFixed(1)} s`
          }
          tone={isFresh ? "var(--accent-green)" : "var(--fg-muted)"}
        />
        <Row label="total sent" value={stats.totalCommands.toLocaleString()} />
      </ul>

      <footer className="mt-1.5 pt-1.5 border-t border-white/10 flex items-center justify-between text-[9px] tracking-[0.16em] text-neutral-400">
        <span>gamepad</span>
        <span
          style={{ color: gamepadConnected ? "#4ade80" : "#94a3b8" }}
          className="truncate ml-2"
          title={gamepadName}
        >
          {gamepadConnected ? `✓ ${shortName(gamepadName ?? "")}` : "— none"}
        </span>
      </footer>
    </aside>
  );
}

function Row({
  label,
  value,
  unit,
  tone,
  dim,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
  dim?: boolean;
}) {
  return (
    <li className={`flex items-center justify-between ${dim ? "opacity-40" : ""}`}>
      <span className="text-neutral-500">{label}</span>
      <span style={{ color: tone }} className="font-medium tabular-nums">
        {value}
        {unit ? <span className="text-[9px] text-neutral-500 ml-1">{unit}</span> : null}
      </span>
    </li>
  );
}

/** Trim gamepad id to a friendly name for the chip. */
function shortName(id: string): string {
  if (!id) return "—";
  // Common pattern: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)"
  const m = id.match(/^([^(]+)/);
  return (m ? m[1] : id).trim().slice(0, 18);
}
