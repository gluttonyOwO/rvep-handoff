"use client";

import { useEffect, useState } from "react";

/**
 * Avoids hydration mismatch when reading client-only state (Zustand persist,
 * `window`, navigator, etc.). Returns `true` only after the first mount.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
