"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  /** Called continuously while the joystick is active (8 Hz). */
  onChange: (axes: { forward: number; lateral: number; yaw: number }) => void;
  /** Called when the user releases the joystick. */
  onRelease: () => void;
  /** When true, knob is greyed out and pointer events are ignored. */
  disabled?: boolean;
}

const RADIUS = 56;       // outer ring radius in px (matches w-28 h-28)
const KNOB_R = 22;       // inner knob radius
// Dead zone radius in CSS px. Inside this disc the joystick reports 0 axes —
// prevents jittery hand on touchscreen from sending crawl-speed commands when
// the operator believes the stick is centered. 8 px ≈ 1.7 mm on a 160 dpi
// phone, larger than typical finger micro-tremor while resting on glass.
const DEAD_ZONE = 8;

/**
 * Touch / mouse joystick for landscape cockpit.
 *
 * Output:
 *   - forward: vertical axis (-1 down ... +1 up)
 *   - yaw:     horizontal axis (-1 left ... +1 right)
 *   - lateral: kept 0 for non-mecanum vehicles; future mecanum vehicles can
 *              wire a 2nd joystick or modifier key to drive this axis.
 */
export function Joystick({ onChange, onRelease, disabled = false }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  // Remember whether the previous tick was inside the dead zone, so we can
  // emit a single haptic tick when the stick crosses the dead-zone boundary
  // outward — useful tactile confirmation that the vehicle is now moving.
  const wasInDeadZoneRef = useRef(true);
  // Refs for the 8 Hz interval — keeping knob/onChange in refs prevents the
  // interval from tearing down on every pointermove (which would break the
  // 125 ms cadence). The interval only re-binds when `active` flips.
  const knobRef = useRef(knob);
  knobRef.current = knob;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      const k = knobRef.current;
      const dist = Math.hypot(k.x, k.y);
      if (dist < DEAD_ZONE) {
        onChangeRef.current({ forward: 0, lateral: 0, yaw: 0 });
        return;
      }
      // Remap [DEAD_ZONE, RADIUS] → [0, 1] so the first movement past the
      // dead zone is still smooth and not a step from 0 → DEAD_ZONE/RADIUS.
      const usable = Math.max(0, RADIUS - DEAD_ZONE);
      const scale = (dist - DEAD_ZONE) / usable / dist;
      const fwd = -k.y * scale;   // up = +forward
      const yaw = k.x * scale;
      onChangeRef.current({ forward: clamp(fwd), lateral: 0, yaw: clamp(yaw) });
    }, 125); // 8 Hz
    return () => clearInterval(interval);
  }, [active]);

  function start(clientX: number, clientY: number) {
    setActive(true);
    wasInDeadZoneRef.current = true;
    update(clientX, clientY);
  }

  function update(clientX: number, clientY: number) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > RADIUS) {
      dx = (dx / dist) * RADIUS;
      dy = (dy / dist) * RADIUS;
    }
    // Haptic tick on dead-zone exit (mobile only — desktop has no vibrator).
    const inside = Math.hypot(dx, dy) < DEAD_ZONE;
    if (wasInDeadZoneRef.current && !inside) {
      try {
        navigator.vibrate?.(10);
      } catch {
        // Some browsers (iOS Safari) lack vibrate; ignore silently.
      }
    }
    wasInDeadZoneRef.current = inside;
    setKnob({ x: dx, y: dy });
  }

  function end() {
    setActive(false);
    setKnob({ x: 0, y: 0 });
    onRelease();
  }

  return (
    <div
      ref={ref}
      data-testid="joystick"
      data-disabled={disabled ? "true" : undefined}
      aria-disabled={disabled}
      onPointerDown={
        disabled
          ? undefined
          : (e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              start(e.clientX, e.clientY);
            }
      }
      onPointerMove={
        disabled
          ? undefined
          : (e) => {
              if (active) update(e.clientX, e.clientY);
            }
      }
      onPointerUp={disabled ? undefined : end}
      onPointerCancel={disabled ? undefined : end}
      className={`relative w-28 h-28 rounded-full surface touch-none select-none ${
        disabled
          ? "cursor-not-allowed opacity-40 grayscale"
          : "cursor-grab active:cursor-grabbing"
      }`}
      aria-label="搖桿"
    >
      <div
        className={`absolute rounded-full bg-white/20 border border-white/30 transition-shadow ${active ? "shadow-[0_0_20px_rgba(255,255,255,0.3)]" : ""}`}
        style={{
          width: KNOB_R * 2,
          height: KNOB_R * 2,
          left: `calc(50% - ${KNOB_R}px + ${knob.x}px)`,
          top: `calc(50% - ${KNOB_R}px + ${knob.y}px)`,
        }}
      />
    </div>
  );
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
