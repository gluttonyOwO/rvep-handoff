"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  open: boolean;
  reason?: string;
  /** Returns true on success, false on rejection (UI keeps modal open). */
  onConfirm: () => Promise<boolean>;
}

const reasonExplanation: Record<string, string> = {
  boot_default: "邊緣端剛啟動",
  heartbeat_timeout: "與邊緣端心跳逾時",
  emergency_stop: "曾觸發緊急停止",
  room_disconnected: "曾與 LiveKit 失聯",
  operator_resume: "正在處理你的恢復請求",
};

/**
 * Full-screen interstitial that blocks operator interaction until they
 * explicitly confirm taking control back from safe_mode.
 *
 * Per c5 spec: 不可自動恢復 movement，必須由 operator 手動確認。
 */
export function RecoveryModal({ open, reason, onConfirm }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // Focus trap: move focus into dialog when it opens, restore when it closes.
  useEffect(() => {
    if (!open) return;
    // Auto-focus the confirm button when modal opens.
    const timer = setTimeout(() => confirmBtnRef.current?.focus(), 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!open) return null;

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      const ok = await onConfirm();
      if (!ok) setError("邊緣端拒絕了恢復請求，請稍候再試");
    } catch {
      setError("傳送失敗，請檢查連線");
    } finally {
      setPending(false);
    }
  }

  const detail = reason ? reasonExplanation[reason] ?? `原因：${reason}` : "等待邊緣端訊號";

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      data-testid="recovery-modal"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-modal-title"
        aria-describedby="recovery-modal-desc"
        className="w-[min(420px,90vw)] rounded-2xl border border-amber-500/40 bg-neutral-950 p-6 shadow-2xl"
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="h-10 w-10 rounded-full bg-amber-500/20 border border-amber-500/50 flex items-center justify-center text-amber-400 text-xl">
            ⚠
          </div>
          <div>
            <div id="recovery-modal-title" className="text-base font-semibold text-amber-200">
              需要手動恢復控制權
            </div>
            <div className="text-xs text-neutral-400 mt-0.5">{detail}</div>
          </div>
        </div>

        <p id="recovery-modal-desc" className="text-sm text-neutral-300 leading-relaxed mb-5">
          車輛目前處於安全模式，搖桿與動作指令已暫停。
          確認周圍環境安全並準備好手動駕駛後，請按下下方按鈕恢復控制權。
        </p>

        {error && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/40 text-sm text-red-200">
            {error}
          </div>
        )}

        <button
          ref={confirmBtnRef}
          type="button"
          onClick={handleConfirm}
          disabled={pending}
          className="w-full px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold text-base transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          data-testid="recovery-confirm"
        >
          {pending ? "處理中…" : "我已準備好 — 恢復控制權"}
        </button>

        <p className="mt-3 text-[11px] text-neutral-500 text-center">
          緊急停止按鈕在任何狀態下都可使用
        </p>
      </div>
    </div>
  );
}
