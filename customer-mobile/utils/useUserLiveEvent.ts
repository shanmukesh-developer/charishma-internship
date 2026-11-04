import { useEffect, useRef } from 'react';
import { connectSocket } from './socket';

/**
 * Calls `onEvent` when the server tells this user's own sockets that something changed (e.g. 'coride:changed',
 * 'pg:changed'; ids only), and after a reconnect (the app closes its socket in the background, so changes made
 * meanwhile were never delivered). Bursts collapse into one call per `debounceMs`; reconnect catch-ups at most every
 * 15 s. Added 31 Oct 2026 so My rides and My PG bookings update while open.
 */
export function useUserLiveEvent(event: string, onEvent: () => void, enabled = true, debounceMs = 500) {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => {
    if (!enabled) return;
    let socket: ReturnType<typeof connectSocket>;
    try { socket = connectSocket(); } catch { return; }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; try { ref.current(); } catch { /* screen gone */ } }, debounceMs);
    };
    let connectedOnce = socket.connected;
    let lastCatchUp = 0;
    const onConnect = () => {
      const now = Date.now();
      if (connectedOnce && now - lastCatchUp > 15000) { lastCatchUp = now; fire(); }
      connectedOnce = true;
    };
    socket.on(event, fire);
    socket.on('connect', onConnect);
    return () => {
      if (timer) clearTimeout(timer);
      socket.off(event, fire);
      socket.off('connect', onConnect);
    };
  }, [event, enabled, debounceMs]);
}
