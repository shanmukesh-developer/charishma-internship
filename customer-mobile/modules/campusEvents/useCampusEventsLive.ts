/**
 * Live updates for Campus Events screens. The backend (modules/campusEvents/services/notify.js) sends ids only:
 *   `campus_event:changed` { kind: 'registration' | 'event' | 'team' ..., id, status? }   to the student's own room
 *   `data:changed` { type: 'campus_event', id }                                          public listing changed
 * Screens refetch through REST. Bursts are coalesced (350 ms) and a reconnect also fires once.
 */
import { useEffect, useRef } from 'react';
import { connectSocket } from '../../utils/socket';

export type CampusEventLiveEvent = { kind?: string; id?: string | null; status?: string };

export function useCampusEventsLive(onChange: (e: CampusEventLiveEvent) => void, enabled = true) {
  const ref = useRef(onChange);
  ref.current = onChange;
  useEffect(() => {
    if (!enabled) return;
    let socket: ReturnType<typeof connectSocket>;
    try { socket = connectSocket(); } catch { return; }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last: CampusEventLiveEvent = {};
    let lastRank = -1;
    // One call per window with its most important event: reconnect (2) over the student's own update (1) over a
    // public change (0); keeping only the latest let a public change hide the student's own update (31 Oct 2026).
    const fire = (e: CampusEventLiveEvent, rank: number) => {
      if (rank >= lastRank) { last = e || {}; lastRank = rank; }
      if (timer) return;
      timer = setTimeout(() => { timer = null; const ev = last; lastRank = -1; try { ref.current(ev); } catch { /* screen gone */ } }, 350);
    };
    const onMine = (e: any) => fire(e && typeof e === 'object' ? e : {}, 1);
    const onData = (e: any) => { if (e && e.type === 'campus_event') fire({ kind: 'event', id: e.id || null }, 0); };
    let connectedOnce = socket.connected;
    // Catch up after a reconnect at most once per 15 s: a flapping connection must not turn into a request storm.
    let lastReconnectFire = 0;
    const onConnect = () => {
      const now = Date.now();
      if (connectedOnce && now - lastReconnectFire >= 15000) { lastReconnectFire = now; fire({ kind: 'reconnect' }, 2); }
      connectedOnce = true;
    };
    socket.on('campus_event:changed', onMine);
    socket.on('data:changed', onData);
    socket.on('connect', onConnect);
    return () => {
      if (timer) clearTimeout(timer);
      socket.off('campus_event:changed', onMine);
      socket.off('data:changed', onData);
      socket.off('connect', onConnect);
    };
  }, [enabled]);
}
