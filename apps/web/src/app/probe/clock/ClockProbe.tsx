"use client";

/**
 * ClockProbe — full-screen millisecond UTC clock, driven by requestAnimationFrame.
 *
 * Implementation notes:
 *  - rAF loop syncs to display vsync (≈16.67 ms @ 60 fps). NO setInterval.
 *  - Date.now() → toISOString().slice(11,23) gives "HH:MM:SS.mmm" in UTC.
 *  - performance.now() tracks frame delta (Δ) for jitter diagnosis.
 *  - font-variant-numeric: tabular-nums prevents layout shift when digits change.
 *  - Fullscreen requires a user gesture — a button is provided.
 *  - cancelAnimationFrame in cleanup prevents ghost loops after unmount.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { JetBrains_Mono } from "next/font/google";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-jbmono",
});

// ── helpers ──────────────────────────────────────────────────────────────────

/** UTC wall clock: "HH:MM:SS.mmm" */
function utcTimeString(): string {
  return new Date().toISOString().slice(11, 23);
}

// ── component ────────────────────────────────────────────────────────────────

export function ClockProbe() {
  const [timeStr, setTimeStr]     = useState("--:--:--.---");
  const [frame, setFrame]         = useState(0);
  const [deltaMs, setDeltaMs]     = useState(0);
  const [isFullscreen, setIsFs]   = useState(false);
  const [inverted, setInverted]   = useState(false);

  const rafRef       = useRef<number>(0);
  const frameRef     = useRef<number>(0);
  const lastPerfRef  = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // rAF loop — fires once per display frame, never throttled.
  const tick = useCallback((perfNow: number) => {
    const delta = lastPerfRef.current > 0 ? perfNow - lastPerfRef.current : 0;
    lastPerfRef.current = perfNow;
    frameRef.current   += 1;

    // Batch all state updates in one render.
    setTimeStr(utcTimeString());
    setFrame(frameRef.current);
    setDeltaMs(delta);

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  // Keep button label in sync with native fullscreen state.
  useEffect(() => {
    const onFsChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  async function toggleFullscreen() {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  }

  const monoStyle: React.CSSProperties = {
    fontFamily:         "var(--font-jbmono), ui-monospace, monospace",
    fontVariantNumeric: "tabular-nums",
  };

  // Color scheme: default = white-on-black; inverted = black-on-white (some
  // cameras with HDR / auto-exposure focus better against bright backgrounds).
  const bg = inverted ? "#ffffff" : "#000000";
  const fg = inverted ? "#000000" : "#ffffff";
  const dim = inverted ? "#555555" : "#888888";

  // Sub-second progress: 0 → 1 within each second, advanced per rAF so the
  // bar moves visibly smooth — helps the operator verify motion clarity.
  const subSecond = Number(timeStr.slice(9, 12)) / 1000 || 0;

  return (
    <div
      ref={containerRef}
      className={`${jetbrainsMono.variable} fixed inset-0 flex flex-col items-center justify-center select-none overflow-hidden`}
      style={{ background: bg, color: fg }}
    >
      {/* ── High-contrast registration frame (helps camera focus + alignment) ── */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: 8,
          left: 8,
          right: 8,
          bottom: 8,
          border: `2px dashed ${dim}`,
          borderRadius: 8,
        }}
      />
      {/* ── Corner registration marks (high-contrast solid squares) ── */}
      {[
        { top: 0, left: 0 },
        { top: 0, right: 0 },
        { bottom: 0, left: 0 },
        { bottom: 0, right: 0 },
      ].map((pos, i) => (
        <div
          key={i}
          className="absolute pointer-events-none"
          style={{ ...pos, width: 24, height: 24, background: fg }}
        />
      ))}

      {/* ── UTC millisecond clock ── */}
      <time
        dateTime={timeStr}
        style={{
          ...monoStyle,
          fontSize:      "clamp(3rem, 12vw, 35vh)",
          letterSpacing: "-0.02em",
          lineHeight:    1,
          color:         fg,
        }}
      >
        {timeStr}
      </time>

      {/* ── Sub-second progress bar (smooth motion to verify shutter capture) ── */}
      <div
        className="mt-4 rounded-full overflow-hidden"
        style={{
          width:  "min(60vw, 600px)",
          height: 8,
          background: dim,
        }}
      >
        <div
          style={{
            width:      `${subSecond * 100}%`,
            height:     "100%",
            background: fg,
            transition: "none",
          }}
        />
      </div>

      {/* ── Frame counter + delta ── */}
      <div
        className="mt-6"
        style={{
          ...monoStyle,
          fontSize: "clamp(0.8rem, 2vw, 1.5rem)",
          color: dim,
        }}
      >
        Frame:&nbsp;{frame.toLocaleString("en-US")}
        &nbsp;&nbsp;·&nbsp;&nbsp;
        Δ:&nbsp;{deltaMs.toFixed(1)}&nbsp;ms
      </div>

      {/* ── Controls (hidden in fullscreen for clean capture) ── */}
      {!isFullscreen && (
        <div className="mt-10 flex flex-wrap gap-3 justify-center">
          <button
            onClick={toggleFullscreen}
            className="px-6 py-2.5 rounded-full border text-sm tracking-widest uppercase transition-colors"
            style={{
              ...monoStyle,
              borderColor: dim,
              color: fg,
            }}
          >
            Enter Fullscreen
          </button>
          <button
            onClick={() => setInverted((v) => !v)}
            className="px-6 py-2.5 rounded-full border text-sm tracking-widest uppercase transition-colors"
            style={{
              ...monoStyle,
              borderColor: dim,
              color: fg,
            }}
          >
            {inverted ? "Dark Mode" : "Light Mode"}
          </button>
        </div>
      )}

      {/* ── UTC badge top-right ── */}
      <span
        className="absolute top-8 right-12 uppercase tracking-widest text-[0.6rem]"
        style={{ ...monoStyle, color: dim }}
      >
        UTC
      </span>

      {/* ── Probe label bottom-right ── */}
      <p
        className="absolute bottom-8 right-12 text-[0.6rem]"
        style={{ ...monoStyle, color: dim }}
      >
        G2G probe · point camera at this screen · capture both clocks · diff = G2G latency
      </p>
    </div>
  );
}
