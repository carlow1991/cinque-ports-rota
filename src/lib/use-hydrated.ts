"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * false during server render and before hydration, true once React is interactive.
 * Used to keep submit buttons disabled until a tap can actually be handled, so a volunteer on a
 * slow phone connection never taps a button that silently does nothing.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
