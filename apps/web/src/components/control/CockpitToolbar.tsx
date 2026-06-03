"use client";

import { useState } from "react";

interface Props {
  /** Returns [count of snapshots saved] for UI toast. */
  onSnapshot: () => Promise<number>;
  /** PTT push start (called on pointer-down). */
  onPTTStart: () => Promise<void>;
  /** PTT push end (called on pointer-up / cancel). */
  onPTTEnd: () => Promise<void>;
  /** True when audio track is being published. */
  pttActive: boolean;
  /** Disable PTT when not in active control. */
  disabled?: boolean;
}

/**
 * Floating cockpit toolbar — snapshot + PTT.
 * Source spec: openspec/features/c1-video-audio-streaming.md (audio publish)
 *              openspec/features/c2-realtime-control.md (cockpit UX)
 */
export function CockpitToolbar({
  onSnapshot,
  onPTTStart,
  onPTTEnd,
  pttActive,
  disabled = false,
}: Props) {
  const [snapToast, setSnapToast] = useState<string | null>(null);
  const [snapping, setSnapping] = useState(false);

  async function handleSnapshot() {
    if (snapping) return;
    setSnapping(true);
    try {
      const n = await onSnapshot();
      setSnapToast(n > 0 ? `已下載 ${n} 張快照` : "無可擷取的畫面");
      setTimeout(() => setSnapToast(null), 2500);
    } catch (err) {
      setSnapToast(`快照失敗：${(err as Error).message}`);
      setTimeout(() => setSnapToast(null), 3000);
    } finally {
      setSnapping(false);
    }
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center z-20">
      <div className="pointer-events-auto flex items-center gap-2 px-2 py-2 rounded-full bg-black/65 border border-[var(--border-subtle)] backdrop-blur-md">
        {/* Snapshot button */}
        <button
          type="button"
          onClick={handleSnapshot}
          disabled={snapping}
          data-testid="snapshot-btn"
          className="flex items-center gap-1.5 px-3 py-2 rounded-full text-sm text-neutral-200 hover:bg-white/10 disabled:opacity-50 transition"
          aria-label="擷取畫面"
          title="擷取畫面（所有相機）"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          <span className="text-xs">{snapping ? "擷取中…" : "快照"}</span>
        </button>

        {/* PTT button */}
        <button
          type="button"
          disabled={disabled}
          data-testid="ptt-btn"
          aria-pressed={pttActive}
          aria-label="按住說話"
          title="按住說話 — 鬆開即停止"
          onPointerDown={(e) => {
            if (disabled) return;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            void onPTTStart();
          }}
          onPointerUp={() => void onPTTEnd()}
          onPointerCancel={() => void onPTTEnd()}
          onPointerLeave={() => {
            if (pttActive) void onPTTEnd();
          }}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm transition select-none ${
            disabled
              ? "opacity-30 cursor-not-allowed text-neutral-400"
              : pttActive
                ? "bg-red-500 text-white shadow-[0_0_18px_rgba(239,68,68,0.5)]"
                : "text-neutral-200 hover:bg-white/10"
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
          </svg>
          <span className="text-xs font-medium">
            {pttActive ? "說話中…" : "按住說話"}
          </span>
        </button>
      </div>

      {snapToast && (
        <div
          className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-sm text-emerald-200 backdrop-blur whitespace-nowrap"
          data-testid="snap-toast"
        >
          ✓ {snapToast}
        </div>
      )}
    </div>
  );
}
