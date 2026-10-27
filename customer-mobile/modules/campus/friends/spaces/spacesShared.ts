import { createContext, useContext } from 'react';
import type { Space, SpaceEndReason, SpaceRole, SpacesMeta } from '../api/spacesApi';
import type { FriendsIdentity } from '../api/core';

// ── In-memory cache (instant re-open, offline fallback) ──────────────────────
const cache = new Map<string, any>();
export const spaceCache = {
  get: <T>(key: string): T | undefined => cache.get(key),
  set: (key: string, value: any) => {
    cache.delete(key);
    cache.set(key, value);
    if (cache.size > 60) cache.delete(cache.keys().next().value as string);
  },
  clear: () => cache.clear(),
};

// ── Bus: a Space changed here (lists merge the fresh copy) ───────────────────
type SpaceListener = (s: Space) => void;
type StaleListener = () => void;
const spaceListeners = new Set<SpaceListener>();
const staleListeners = new Set<StaleListener>();
export const spaceBus = {
  emit: (s: Space) => {
    spaceCache.set(`space:${s.id}`, s);
    spaceListeners.forEach((l) => l(s));
  },
  on: (l: SpaceListener) => {
    spaceListeners.add(l);
    return () => {
      spaceListeners.delete(l);
    };
  },
  /** Lists refetch quietly (a Space started, ended, or someone was blocked). */
  emitStale: () => staleListeners.forEach((l) => l()),
  onStale: (l: StaleListener) => {
    staleListeners.add(l);
    return () => {
      staleListeners.delete(l);
    };
  },
};

// ── Navigation inside Friends > Spaces ───────────────────────────────────────
export type SpacesRoute = { name: 'space'; id: string; space?: Space | null };

export interface SpacesNav {
  push: (r: SpacesRoute) => void;
  back: () => void;
  openComposer: (edit?: Space | null) => void;
  /** Enter (or return to) the live room. */
  openRoom: (space: Space) => void;
  /** The Space whose room I'm in right now (null when none). */
  roomSpaceId: string | null;
  onGateError: (e: any) => void;
  onBlocked: (userId: string) => void;
  meta: SpacesMeta | null;
  me: string | null;
}

const noop = () => {};
export const SpacesNavContext = createContext<SpacesNav>({
  push: noop,
  back: noop,
  openComposer: noop,
  openRoom: noop,
  roomSpaceId: null,
  onGateError: noop,
  onBlocked: noop,
  meta: null,
  me: null,
});
export const useSpacesNav = () => useContext(SpacesNavContext);

// ── Labels and formatting ────────────────────────────────────────────────────
export const spaceLink = (spaceId: string) => `zenvy://friends?tab=friends&sub=spaces&id=${encodeURIComponent(spaceId)}`;

export const ROLE_LABEL: Record<SpaceRole, string> = {
  host: 'Host',
  cohost: 'Co-host',
  speaker: 'Speaker',
  listener: 'Listener',
};

export const isOnStage = (r: SpaceRole | null | undefined) => r === 'host' || r === 'cohost' || r === 'speaker';
export const isRoomMod = (r: SpaceRole | null | undefined) => r === 'host' || r === 'cohost';

export const END_REASON_LABEL: Record<SpaceEndReason, string> = {
  host_ended: 'The host ended this Space.',
  host_left: 'The host left, so the Space ended.',
  empty: 'Everyone left, so the Space ended.',
  server_restart: 'The Space ended after a server restart.',
  moderation: 'This Space was ended by moderators.',
  admin: 'This Space was ended by the ZCS team.',
  cancelled: 'The host cancelled this Space.',
  expired: "This Space didn't start in time.",
};

export const endReasonText = (r: string | null | undefined) => (r && (END_REASON_LABEL as any)[r]) || 'This Space has ended.';

export const hostName = (h: FriendsIdentity | null | undefined) => {
  if (!h || (h as any).anonymous) return 'the host';
  const n: any = h;
  return n.entity?.name || n.name || 'the host';
};
export const hostUserId = (h: FriendsIdentity | null | undefined): string | null => {
  if (!h || (h as any).anonymous) return null;
  return (h as any).userId || null;
};

/** "Today 7:30 PM", "Tomorrow 6 PM", "Sat 19 Oct, 6:00 PM" in the device's time zone. */
export const formatSpaceTime = (iso: string | null | undefined, now = Date.now()): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  const tmr = new Date(now);
  tmr.setDate(tmr.getDate() + 1);
  if (d.toDateString() === tmr.toDateString()) return `Tomorrow ${time}`;
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' });
};

/** "in 12 min", "in 3 h", "in 2 days", "starting now". */
export const formatCountdown = (iso: string | null | undefined, now = Date.now()): string => {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return '';
  if (ms <= 60 * 1000) return 'starting now';
  const min = Math.round(ms / 60000);
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  if (h < 36) return `in ${h} h`;
  return `in ${Math.round(h / 24)} days`;
};

/** Live for "12 min" / "1 h 5 min". */
export const formatLiveFor = (iso: string | null | undefined, now = Date.now()): string => {
  if (!iso) return '';
  const ms = now - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just started';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
};

export const statusLabel = (s: Space): string => {
  switch (s.status) {
    case 'live':
      return 'Live';
    case 'scheduled':
      return s.underReview ? 'Waiting for review' : 'Scheduled';
    case 'ended':
      return 'Ended';
    case 'cancelled':
      return 'Cancelled';
    case 'expired':
      return 'Expired';
    default:
      return '';
  }
};

/** Local device timezone label, e.g. "GMT+5:30", shown next to scheduled times. */
export const localZoneLabel = (): string => {
  const off = -new Date().getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
