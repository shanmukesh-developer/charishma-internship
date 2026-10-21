import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

// The OS "Reduce motion" / "Remove animations" setting, read once at startup and kept live.
// Shared animation components (components/AnimatedSection.tsx) render their final state at once
// and skip looping effects while it is on.
let reduceMotion = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((cb) => { try { cb(); } catch {} });

try {
  AccessibilityInfo.isReduceMotionEnabled()
    .then((on) => { reduceMotion = !!on; emit(); })
    .catch(() => {});
  AccessibilityInfo.addEventListener('reduceMotionChanged', (on: boolean) => { reduceMotion = !!on; emit(); });
} catch {
  // not available on this platform: animations stay on
}

/** Current value (false until the OS answers, which is right after startup). */
export const isReduceMotionOn = (): boolean => reduceMotion;

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};

/** true while the OS asks for less motion; re-renders when the setting changes. */
export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, isReduceMotionOn, () => false);
}
