"use client";

import { useEffect, useRef, useState } from "react";
import type { ControlChannel } from "@/lib/control-channel";

/**
 * Gamepad API hook — polls Web Gamepad API at 30 Hz and dispatches movement
 * + emergency_stop commands through the given ControlChannel.
 *
 * Mapping（PS / Xbox controller 慣例 → universal control schema）：
 * - 左搖桿 Y 軸 → forward（−ly，向前推為正）
 * - 左搖桿 X 軸 → lateral（holonomic 才會用到；diff-drive 車邊忽略）
 * - 右搖桿 X 軸 → yaw（−rx，向左推為正）
 * - Button 1（A / X / Cross）→ emergency_stop
 *
 * Dead zone：每軸 0.10（防 stick drift）。
 *
 * Spec: openspec/control/universal-control-command.md
 * C6 enhancement, 2026-05-22.
 */
export interface UseGamepadOptions {
  channel: ControlChannel | null;
  /** Disable polling when not in active control state. */
  enabled: boolean;
}

export interface GamepadState {
  connected: boolean;
  gamepadName: string;
  /** Last raw axis values [LX, LY, RX, RY] for debug overlay. */
  axes: [number, number, number, number];
}

const DEAD_ZONE = 0.1;
const SEND_THROTTLE_MS = 33; // ~30 Hz, matches Joystick rate

export function useGamepad({ channel, enabled }: UseGamepadOptions): GamepadState {
  const [state, setState] = useState<GamepadState>({
    connected: false,
    gamepadName: "",
    axes: [0, 0, 0, 0],
  });

  const lastSendRef = useRef(0);
  const lastBtn1Ref = useRef(false);

  useEffect(() => {
    if (!enabled || !channel) {
      setState((s) => ({ ...s, connected: false }));
      return;
    }

    let raf = 0;
    const tick = () => {
      const pads = navigator.getGamepads?.() ?? [];
      const gp = pads.find((p): p is Gamepad => p !== null && p.connected);

      if (!gp) {
        setState((s) => (s.connected ? { ...s, connected: false } : s));
        raf = requestAnimationFrame(tick);
        return;
      }

      const lx = gp.axes[0] ?? 0;
      const ly = gp.axes[1] ?? 0;
      const rx = gp.axes[2] ?? 0;
      const ry = gp.axes[3] ?? 0;

      setState({
        connected: true,
        gamepadName: gp.id,
        axes: [lx, ly, rx, ry],
      });

      // Throttle send to ~30 Hz
      const now = performance.now();
      if (now - lastSendRef.current >= SEND_THROTTLE_MS) {
        lastSendRef.current = now;

        // Apply dead zone + sign convention
        // ly inverted: stick up = -1 in HW, we want forward = +1
        const forward = Math.abs(ly) > DEAD_ZONE ? -ly : 0;
        const yaw = Math.abs(rx) > DEAD_ZONE ? -rx : 0;
        const lateral = Math.abs(lx) > DEAD_ZONE ? lx : 0;

        // Always send when in dead zone too — so the vehicle decelerates
        // smoothly when the operator returns sticks to center (parity with
        // virtual Joystick onRelease behavior). Otherwise the last non-zero
        // command would keep the vehicle drifting until heartbeat timeout.
        if (forward !== 0 || yaw !== 0 || lateral !== 0) {
          channel.sendMovement({ forward, lateral, yaw }).catch(() => {});
        }
      }

      // Emergency stop on button 1 (A / Cross) — rising edge only
      const btn1 = gp.buttons[1]?.pressed ?? false;
      if (btn1 && !lastBtn1Ref.current) {
        channel.sendEmergencyStop().catch(() => {});
      }
      lastBtn1Ref.current = btn1;

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [channel, enabled]);

  return state;
}
