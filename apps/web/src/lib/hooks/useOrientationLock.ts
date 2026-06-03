"use client";

import { useEffect, useState } from "react";

export type LockOrientation = "landscape" | "portrait" | "landscape-primary";

interface Result {
  /** True once a lock attempt has succeeded for the current mount. */
  locked: boolean;
  /** Browser refused (most desktop browsers, iOS Safari outside PWA). */
  unsupported: boolean;
  /** Last error message, if any (NotAllowedError when not in fullscreen). */
  error: string | null;
}

/**
 * Best-effort orientation lock. Spec note: in most browsers `screen.orientation.lock`
 * requires the document to be in fullscreen first — caller should request
 * fullscreen on user gesture before relying on this. Failures are *silent*
 * (we just expose them via `error`) so we never break desktop or iOS Safari.
 */
export function useOrientationLock(
  target: LockOrientation = "landscape",
  enabled: boolean = true,
): Result {
  const [state, setState] = useState<Result>({
    locked: false,
    unsupported: false,
    error: null,
  });

  useEffect(() => {
    if (!enabled) return;
    if (typeof screen === "undefined" || !("orientation" in screen)) {
      setState({ locked: false, unsupported: true, error: null });
      return;
    }
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    if (typeof orientation.lock !== "function") {
      setState({ locked: false, unsupported: true, error: null });
      return;
    }

    let cancelled = false;
    orientation
      .lock(target)
      .then(() => {
        if (!cancelled) setState({ locked: true, unsupported: false, error: null });
      })
      .catch((err: Error) => {
        if (!cancelled)
          setState({ locked: false, unsupported: false, error: err.message });
      });

    return () => {
      cancelled = true;
      try {
        orientation.unlock?.();
      } catch {
        // ignore — some browsers throw if not locked.
      }
    };
  }, [target, enabled]);

  return state;
}
