"use client";

import type { SafetyEventName } from "@rvep/shared";

interface Props {
  /** "active" = system fully operational; "safe_mode" = edge is in safe state; "lost" = edge disconnected. */
  safetyState: "active" | "safe_mode" | "lost" | "unknown";
  /** Machine-readable reason from edge (boot_default, heartbeat_timeout, emergency_stop, room_disconnected, …) */
  reason?: string;
  /** Latest safety event name — used for fine-grained labels. */
  lastEvent?: SafetyEventName;
}

const reasonLabel: Record<string, string> = {
  boot_default: "邊緣端剛啟動，等待操作員確認控制權",
  heartbeat_timeout: "心跳逾時 3 秒，已自動切換到安全模式",
  emergency_stop: "已執行緊急停止",
  room_disconnected: "失去 LiveKit 連線，車輛已停止",
  operator_resume: "正在恢復控制權…",
  shutdown: "邊緣端正常關閉中",
};

export function SafetyBanner({ safetyState, reason, lastEvent }: Props) {
  if (safetyState === "active") return null;

  const isLost = safetyState === "lost";
  const isUnknown = safetyState === "unknown";

  const tone = isLost
    ? "border-red-500/60 bg-red-500/15 text-red-200"
    : isUnknown
      ? "border-neutral-500/60 bg-neutral-500/15 text-neutral-200"
      : "border-amber-500/60 bg-amber-500/15 text-amber-200";

  const title = isLost
    ? "與車輛失去連線"
    : isUnknown
      ? "等待車輛狀態..."
      : "車輛處於安全模式";

  const detail = reason
    ? reasonLabel[reason] ?? `原因：${reason}`
    : lastEvent
      ? `事件：${lastEvent}`
      : "等待邊緣端訊號";

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={`z-30 flex items-center justify-center gap-3 px-4 py-2 border-b text-sm font-medium backdrop-blur ${tone}`}
      data-testid="safety-banner"
      data-state={safetyState}
    >
      <span className="text-base leading-none">{isLost ? "⚠" : isUnknown ? "…" : "⚠"}</span>
      <span className="font-semibold">{title}</span>
      <span className="text-neutral-400">·</span>
      <span className="text-neutral-300">{detail}</span>
    </div>
  );
}
