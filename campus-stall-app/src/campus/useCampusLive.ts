// Live In-Campus Booking updates for the stall: the server sends `campusbooking:changed` { id, status } to this
// stall's room (restaurant_<id>) on every change. Screens refetch through REST (payloads are ids only), and
// again after every reconnect (connectCount), so nothing is missed while the phone was offline.
import { useEffect, useRef } from 'react';
import { useSocket } from '../state/SocketProvider';

export function useCampusLive(onChange: (e: { id?: string; status?: string }) => void) {
  const { socket, connectCount } = useSocket();
  const ref = useRef(onChange);
  ref.current = onChange;
  useEffect(() => {
    if (!socket) return;
    const fn = (e: any) => { try { ref.current(e && typeof e === 'object' ? e : {}); } catch { /* screen gone */ } };
    socket.on('campusbooking:changed', fn);
    return () => { socket.off('campusbooking:changed', fn); };
  }, [socket]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    ref.current({});
  }, [connectCount]);
}
