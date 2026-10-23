/**
 * App-wide "device is offline" flag, published by the global offline banner (components/OfflineBanner.tsx,
 * which decides only after two failed checks and no answer from the server for 20 s), so screens can show
 * an offline state instead of a generic error. Together with utils/serverWake (cold start) this gives
 * useConnectionState(): 'offline' | 'waking' | 'online'.
 */
import { useSyncExternalStore } from 'react';
import { lastNetworkFailureAt, lastServerResponseAt, useServerWaking } from './serverWake';

let offline = false;
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const get = () => offline;

/** Called by OfflineBanner whenever its verdict changes. */
export const setOfflineStatus = (v: boolean) => {
  if (offline === v) return;
  offline = v;
  listeners.forEach((cb) => { try { cb(); } catch { /* ignore */ } });
};

/** True while the offline banner says the device is offline. */
export const useOfflineStatus = (): boolean => useSyncExternalStore(subscribe, get, get);

export type ConnectionState = 'offline' | 'waking' | 'online';

/**
 * 'offline' when the banner says so, or when the latest request got no answer at all and nothing has
 * answered for 20 s; 'waking' while a request waits for the server to finish starting; else 'online'.
 */
export const useConnectionState = (): ConnectionState => {
  const bannerOffline = useOfflineStatus();
  const waking = useServerWaking();
  if (bannerOffline) return 'offline';
  if (waking) return 'waking';
  const failAt = lastNetworkFailureAt();
  const okAt = lastServerResponseAt();
  if (failAt > okAt && Date.now() - okAt > 20000) return 'offline';
  return 'online';
};
