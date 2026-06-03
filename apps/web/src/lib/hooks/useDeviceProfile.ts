"use client";

import { useEffect, useState } from "react";

export type DeviceClass = "desktop" | "tablet" | "phone";
export type OrientationKind = "portrait" | "landscape";

export interface DeviceProfile {
  /** Coarse pointer (touch panel, no precise mouse). */
  touch: boolean;
  /** Hover capability — false on most touch devices. */
  hover: boolean;
  /** Best-effort form-factor classification from viewport + UA hints. */
  deviceClass: DeviceClass;
  orientation: OrientationKind;
  /** Visible viewport in CSS pixels (dvh-aware). */
  viewportWidth: number;
  viewportHeight: number;
  /** PWA running in fullscreen/standalone display mode. */
  standalone: boolean;
  /** Screen wake-lock supported (mobile cockpit safety prerequisite). */
  wakeLockSupported: boolean;
  /** screen.orientation.lock supported (force landscape on phones). */
  orientationLockSupported: boolean;
}

const SSR_PROFILE: DeviceProfile = {
  touch: false,
  hover: true,
  deviceClass: "desktop",
  orientation: "landscape",
  viewportWidth: 1920,
  viewportHeight: 1080,
  standalone: false,
  wakeLockSupported: false,
  orientationLockSupported: false,
};

function classify(width: number, touch: boolean): DeviceClass {
  if (!touch && width >= 1024) return "desktop";
  if (touch && width >= 820) return "tablet";
  return "phone";
}

function snapshot(): DeviceProfile {
  if (typeof window === "undefined") return SSR_PROFILE;

  const touch =
    window.matchMedia("(hover: none) and (pointer: coarse)").matches ||
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0;

  const hover = window.matchMedia("(hover: hover)").matches;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const orientation: OrientationKind = w >= h ? "landscape" : "portrait";

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    // iOS Safari legacy
    (navigator as unknown as { standalone?: boolean }).standalone === true;

  return {
    touch,
    hover,
    deviceClass: classify(w, touch),
    orientation,
    viewportWidth: w,
    viewportHeight: h,
    standalone,
    wakeLockSupported: "wakeLock" in navigator,
    orientationLockSupported:
      typeof screen !== "undefined" &&
      "orientation" in screen &&
      typeof (screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      }).lock === "function",
  };
}

/**
 * Reactive snapshot of touch / hover / orientation / viewport. Re-renders only
 * when the underlying media-query or resize event would change classification.
 */
export function useDeviceProfile(): DeviceProfile {
  const [profile, setProfile] = useState<DeviceProfile>(SSR_PROFILE);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setProfile(snapshot()));
    };
    update();

    const mqTouch = window.matchMedia("(hover: none) and (pointer: coarse)");
    const mqStandalone = window.matchMedia("(display-mode: standalone)");
    mqTouch.addEventListener("change", update);
    mqStandalone.addEventListener("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    return () => {
      cancelAnimationFrame(raf);
      mqTouch.removeEventListener("change", update);
      mqStandalone.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return profile;
}
