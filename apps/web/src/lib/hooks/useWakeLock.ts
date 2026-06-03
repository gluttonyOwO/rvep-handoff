"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type WakeLockSentinel = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", l: () => void) => void;
  removeEventListener: (type: "release", l: () => void) => void;
};
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
};

export interface UseWakeLockResult {
  /** True while we currently hold a screen wake lock. */
  active: boolean;
  /** True if `navigator.wakeLock` exists on this device. */
  supported: boolean;
  /** Last error from the OS / browser, if any (NotAllowedError, etc). */
  error: string | null;
  request: () => Promise<void>;
  release: () => Promise<void>;
}

/**
 * Screen Wake Lock — prevents the device screen from sleeping while operator
 * is actively driving. Re-acquires automatically when the page returns from
 * background (browsers always release the sentinel on visibility=hidden).
 *
 * `enabled` gates the whole lifecycle so cockpit page can drop the lock when
 * control is handed off or the safe_mode banner is active.
 */
export function useWakeLock(enabled: boolean): UseWakeLockResult {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const supported =
    typeof navigator !== "undefined" && "wakeLock" in navigator;

  // Track listener so we can remove it — W3C spec keeps a strong ref to the
  // sentinel while a release listener is attached, so a missing remove leaks
  // sentinels across visibility cycles.
  const releaseListenerRef = useRef<(() => void) | null>(null);

  const detachReleaseListener = useCallback(() => {
    const s = sentinelRef.current;
    const l = releaseListenerRef.current;
    if (s && l) {
      try {
        s.removeEventListener("release", l);
      } catch {
        // best-effort; sentinel may already be GC'd
      }
    }
    releaseListenerRef.current = null;
  }, []);

  const request = useCallback(async () => {
    if (typeof navigator === "undefined") return;
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock) {
      setError("wake-lock-unsupported");
      return;
    }
    if (sentinelRef.current && !sentinelRef.current.released) return;
    try {
      const sentinel = await nav.wakeLock.request("screen");
      sentinelRef.current = sentinel;
      setActive(true);
      setError(null);

      const onRelease = () => {
        // Sentinel is fully released — clear ref and detach listener so the
        // browser can GC the sentinel object.
        if (sentinelRef.current === sentinel) sentinelRef.current = null;
        if (releaseListenerRef.current === onRelease) {
          releaseListenerRef.current = null;
          sentinel.removeEventListener("release", onRelease);
        }
        setActive(false);
      };
      releaseListenerRef.current = onRelease;
      sentinel.addEventListener("release", onRelease);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setActive(false);
    }
  }, []);

  const release = useCallback(async () => {
    const s = sentinelRef.current;
    if (!s || s.released) {
      detachReleaseListener();
      return;
    }
    try {
      await s.release();
    } catch {
      // ignore — browser will GC the sentinel.
    } finally {
      detachReleaseListener();
      sentinelRef.current = null;
      setActive(false);
    }
  }, [detachReleaseListener]);

  // Acquire on enable, release on disable / unmount.
  useEffect(() => {
    if (enabled) void request();
    else void release();
    return () => {
      void release();
    };
  }, [enabled, request, release]);

  // Re-acquire after returning from background — browsers always release
  // wake locks when the document becomes hidden, so we must re-request.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible" && enabledRef.current) {
        void request();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [request]);

  return { active, supported, error, request, release };
}
