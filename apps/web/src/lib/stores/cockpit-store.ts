"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type CockpitMode = "immersive" | "standard" | "mission";
export type JoystickSide = "left" | "right";
export type Brightness = "auto" | "outdoor" | "indoor";

export interface CockpitState {
  mode: CockpitMode;
  hudVisible: boolean;
  joystickSide: JoystickSide;
  brightness: Brightness;

  setMode: (m: CockpitMode) => void;
  toggleHud: () => void;
  setJoystickSide: (s: JoystickSide) => void;
  setBrightness: (b: Brightness) => void;
  reset: () => void;
}

const initial: Omit<
  CockpitState,
  "setMode" | "toggleHud" | "setJoystickSide" | "setBrightness" | "reset"
> = {
  mode: "standard",
  hudVisible: true,
  joystickSide: "left",
  brightness: "auto",
};

export const useCockpitStore = create<CockpitState>()(
  persist(
    (set) => ({
      ...initial,
      setMode: (mode) => set({ mode }),
      toggleHud: () => set((s) => ({ hudVisible: !s.hudVisible })),
      setJoystickSide: (joystickSide) => set({ joystickSide }),
      setBrightness: (brightness) => set({ brightness }),
      reset: () => set({ ...initial }),
    }),
    {
      name: "rvep-cockpit-prefs",
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);
