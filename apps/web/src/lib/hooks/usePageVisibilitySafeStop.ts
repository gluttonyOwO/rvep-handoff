"use client";

import { useEffect, useRef } from "react";

export type SafeStopReason = "hidden" | "pagehide" | "blur" | "freeze";

interface Options {
  enabled: boolean;
  onStop: (reason: SafeStopReason) => void;
  /** Also stop when the window loses focus (Alt-Tab / app switcher). */
  includeBlur?: boolean;
}

/**
 * ISO-13850-spirit safety gate for mobile teleop: any time the operator's
 * attention demonstrably leaves the page (tab hidden, switched apps, screen
 * locked, page evicted by mobile OS), fire `onStop` synchronously so the
 * vehicle goes safe before the OS suspends our JS context.
 *
 * Why all four events?
 *   - `visibilitychange` → hidden    : tab switch, screen lock, app switch
 *   - `pagehide`                     : navigation away, BFCache eviction
 *   - `blur`                         : window loses focus (optional — some
 *                                      desktops fire this for hover-out)
 *   - `freeze`                       : Chrome / Android tab freeze (proposed)
 *
 * The handler is intentionally synchronous: mobile OS may kill our JS within
 * milliseconds of `visibilitychange`, so we must call `onStop` *before* any
 * await, network round-trip, or async lifecycle hook.
 */
export function usePageVisibilitySafeStop({
  enabled,
  onStop,
  includeBlur = false,
}: Options): void {
  // Latest onStop in a ref so we don't re-bind listeners every render.
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  useEffect(() => {
    if (!enabled) return;
    if (typeof document === "undefined") return;

    const fire = (reason: SafeStopReason) => onStopRef.current(reason);

    const onVis = () => {
      if (document.visibilityState === "hidden") fire("hidden");
    };
    const onHide = () => fire("pagehide");
    const onBlur = () => fire("blur");
    const onFreeze = () => fire("freeze");

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("freeze", onFreeze as EventListener);
    if (includeBlur) window.addEventListener("blur", onBlur);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("freeze", onFreeze as EventListener);
      if (includeBlur) window.removeEventListener("blur", onBlur);
    };
  }, [enabled, includeBlur]);
}
