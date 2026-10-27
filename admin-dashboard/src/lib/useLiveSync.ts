"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdminSocket } from '@/components/AdminSocketProvider';

/**
 * Realtime sync (see backend/utils/realtime.js).
 * The backend sends IDs-only change events:
 *  - `data:changed`  to every socket (store, product, config, announcement, coupon, pg, wall, campus)
 *  - `admin:changed` to admin-room only (order, ticket, verification, pg_booking, wall_submission, …)
 * Pages subscribe to the types they show and refetch via REST. Events are coalesced here too, and a
 * reconnect triggers one refetch because events sent while offline are not replayed.
 */
export type LiveType =
  | 'store' | 'product' | 'config' | 'announcement' | 'coupon' | 'pg' | 'wall' | 'campus'
  | 'order' | 'ticket' | 'verification' | 'pg_booking' | 'wall_submission' | 'service_booking' | 'rider' | 'user'
  // Zenvy Friends moderation (admin room only)
  | 'friends_report' | 'friends_appeal' | 'friends_review'
  // Student vehicle rentals (public 'rental' + admin queues)
  | 'rental' | 'rental_listing' | 'rental_licence' | 'rental_booking' | 'rental_report' | 'rental_dispute'
  // Zenvy Auto-Ride (public 'auto_trip' + admin queues)
  | 'auto_trip' | 'auto_driver' | 'auto_vehicle' | 'auto_route' | 'auto_booking' | 'auto_private_request' | 'auto_incident'
  // Zenvy Campus Events (public 'campus_event' + admin 'campus_event_admin')
  | 'campus_event' | 'campus_event_admin'
  // In-Campus Booking (admin room): pickup bookings paid straight to the stall
  | 'campus_booking';

export interface LiveEvent {
  type: LiveType | string;
  action: 'created' | 'updated' | 'deleted';
  id: string | number | null;
  storeId?: string | number;
  scope?: string;
  bulk?: boolean;
  count?: number;
  at?: string;
}

/** Called once per coalesced batch. `events` is empty when the trigger was a socket reconnect. */
export type LiveHandler = (events: LiveEvent[], meta: { reconnect: boolean }) => void;

interface Options {
  /** Coalescing window for bursts (ms). Default 400. */
  debounceMs?: number;
  /** Turn the subscription off (e.g. until signed in). Default true. */
  enabled?: boolean;
}

const isLiveEvent = (v: unknown): v is LiveEvent =>
  !!v && typeof v === 'object' && typeof (v as LiveEvent).type === 'string';

export function useLiveSync(types: readonly string[], handler: LiveHandler, opts: Options = {}) {
  const { socket } = useAdminSocket();
  const { debounceMs = 400, enabled = true } = opts;

  // Keep the latest handler without re-subscribing on every render.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const typesKey = types.join('|');

  useEffect(() => {
    if (!socket || !enabled) return;
    const wanted = new Set(typesKey.split('|').filter(Boolean));
    let buffer: LiveEvent[] = [];
    let reconnect = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let wasDisconnected = false;

    const flush = () => {
      timer = null;
      const events = buffer;
      const meta = { reconnect };
      buffer = [];
      reconnect = false;
      try { handlerRef.current(events, meta); } catch (err) { console.warn('[LIVE_SYNC] handler failed', err); }
    };
    // Fixed window (not reset per event) so a steady stream of events still flushes regularly.
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(flush, debounceMs);
    };

    const onChange = (e: unknown) => {
      if (!isLiveEvent(e) || !wanted.has(e.type)) return;
      buffer.push(e);
      schedule();
    };
    const onDisconnect = () => { wasDisconnected = true; };
    const onConnect = () => {
      if (!wasDisconnected) return; // first connect: the page already loaded its data
      wasDisconnected = false;
      reconnect = true;
      schedule();
    };

    socket.on('data:changed', onChange);
    socket.on('admin:changed', onChange);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    return () => {
      socket.off('data:changed', onChange);
      socket.off('admin:changed', onChange);
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
      if (timer) clearTimeout(timer);
    };
  }, [socket, enabled, typesKey, debounceMs]);
}

/** Ids of rows that just arrived / changed, for a short "new" highlight. */
export function useFreshIds(ttlMs = 6000) {
  const [fresh, setFresh] = useState<Record<string, number>>({});
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const set = timers.current;
    return () => { set.forEach(clearTimeout); set.clear(); };
  }, []);

  const mark = useCallback((ids: Array<string | number | null | undefined>) => {
    const clean = ids.filter((v): v is string | number => v !== null && v !== undefined && v !== '').map(String);
    if (!clean.length) return;
    const stamp = Date.now();
    setFresh(prev => {
      const next = { ...prev };
      clean.forEach(id => { next[id] = stamp; });
      return next;
    });
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setFresh(prev => {
        const next = { ...prev };
        clean.forEach(id => { if (next[id] === stamp) delete next[id]; });
        return next;
      });
    }, ttlMs);
    timers.current.add(timer);
  }, [ttlMs]);

  const isFresh = useCallback((id: string | number | null | undefined) => id !== null && id !== undefined && String(id) in fresh, [fresh]);

  return { mark, isFresh };
}

/** Tailwind classes for a row highlighted by useFreshIds. */
export const FRESH_ROW_CLASS = 'bg-success-soft transition-colors duration-700';

/** Human label for a toast, e.g. "New order" / "Ticket updated". */
export function liveLabel(events: LiveEvent[], noun: string): string | null {
  if (!events.length) return null;
  const created = events.filter(e => e.action === 'created').length;
  if (created > 1) return `${created} new ${noun}s`;
  if (created === 1) return `New ${noun}`;
  if (events.some(e => e.bulk)) return `${noun[0].toUpperCase()}${noun.slice(1)}s refreshed`;
  return `${noun[0].toUpperCase()}${noun.slice(1)} updated`;
}
