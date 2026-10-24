import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useIsFocused } from 'expo-router';

/**
 * One shared AppState subscription for every UI timer (rotating hints, carousels, countdowns).
 * Timers gated on it stop while the app is in the background instead of waking the JS thread
 * every few seconds, and pick up again on return.
 */
let current: AppStateStatus = AppState.currentState || 'active';
const listeners = new Set<() => void>();
let sub: { remove: () => void } | null = null;

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  if (!sub) {
    current = AppState.currentState || current;
    sub = AppState.addEventListener('change', (next) => {
      if (next === current) return;
      current = next;
      listeners.forEach((l) => l());
    });
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && sub) {
      sub.remove();
      sub = null;
    }
  };
};
// 'unknown' (iOS start-up) and 'inactive' (iOS app switcher) still count as on screen.
// With nobody subscribed the cached value may be stale, so read AppState directly.
const getActive = () => (sub ? current : (AppState.currentState || current)) !== 'background';

/** False while the app is in the background. */
export function useAppActive(): boolean {
  return useSyncExternalStore(subscribe, getActive, getActive);
}

/** True only while this screen is focused AND the app is in the foreground (for UI-only timers). */
export function useScreenActive(): boolean {
  const focused = useIsFocused();
  const active = useAppActive();
  return focused && active;
}
