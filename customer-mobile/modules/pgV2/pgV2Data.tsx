/**
 * Real data for PG v2. Read-only use of the app's API helpers:
 *   GET  /api/pg/home (falls back to GET /api/pg)   list of PGs
 *   GET  /api/pg/:id                                 detail (rooms, room types, photos, mess, location)
 *   GET  /api/pg/bookings/mine                       the signed-in student's requests
 *   POST /api/pg/:roomId/book  { checkInDate }       send a request (the housing team confirms it)
 *   PUT  /api/pg/bookings/:id/cancel                 withdraw a request
 * Nothing is invented: blocks whose data is missing are hidden by the screens.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL, ENDPOINTS } from '../../constants/api';
import { apiFetch, readJson } from '../../utils/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanAmenities } from '../../modules/pg/ui';
import { genderKey, inr, type MyPgBooking, type PgDetail, type PgListItem, type PgRoomType } from '../../modules/pg/pgApi';
import type { GenderKey } from './pgV2Theme';
import { applyDemo } from './pgV2Demo';

export type LoadState = 'loading' | 'ready' | 'error';

interface Store {
  list: PgListItem[];
  listState: LoadState;
  reloadList: () => void;
  saved: Set<string>;
  toggleSaved: (id: string) => void;
  recent: string[];
  addRecent: (q: string) => void;
}
const Ctx = createContext<Store | null>(null);

// ── Session store shared by every PG screen (each route mounts its own provider) ─────────────────
type Snap = { list: PgListItem[]; listState: LoadState; saved: Set<string>; recent: string[] };
let snap: Snap = { list: [], listState: 'loading', saved: new Set(), recent: [] };
let fetchedOnce = false;
let inflight: Promise<void> | null = null;
const subs = new Set<(s: Snap) => void>();
const emit = (patch: Partial<Snap>) => { snap = { ...snap, ...patch }; subs.forEach((f) => f(snap)); };

// Saved PGs are kept on this device (3 Nov 2026: they lived in memory only and were gone after a restart). Read once,
// written on every heart tap; the backend has no saved-PG list yet.
const SAVED_KEY = 'zcs_pg_saved_v1';
let savedLoaded = false;
const loadSavedPgs = async () => {
  if (savedLoaded) return;
  savedLoaded = true;
  try {
    const ids = JSON.parse((await AsyncStorage.getItem(SAVED_KEY)) || '[]');
    if (Array.isArray(ids) && ids.length) emit({ saved: new Set([...ids.map(String), ...snap.saved]) });
  } catch { /* unreadable: start empty */ }
};

/** (Re)load the PG list. `silent` keeps the current list on screen while it refreshes. */
export const reloadPgV2List = (opts?: { silent?: boolean }): Promise<void> => {
  if (inflight) return inflight;
  if (!opts?.silent || !snap.list.length) emit({ listState: snap.list.length ? snap.listState : 'loading' });
  inflight = (async () => {
    try {
      let res = await apiFetch(`${API_URL}/api/pg/home`);
      let data = await readJson(res);
      let pgs: PgListItem[] | null = res.ok && data && Array.isArray(data.pgs) ? data.pgs : null;
      if (!pgs) {
        res = await apiFetch(ENDPOINTS.pgList);
        data = await readJson(res);
        pgs = res.ok && Array.isArray(data) ? data : null;
      }
      if (pgs) emit({ list: pgs.map((p) => ({ ...p, amenities: cleanAmenities(p.amenities) })), listState: 'ready' });
      else if (!snap.list.length) emit({ listState: 'error' });
    } catch {
      if (!snap.list.length) emit({ listState: 'error' });
    } finally {
      fetchedOnce = true;
      inflight = null;
    }
  })();
  return inflight;
};

export function PgV2DataProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<Snap>(snap);
  useEffect(() => {
    subs.add(setS);
    setS(snap);
    if (!fetchedOnce) reloadPgV2List();
    loadSavedPgs();
    return () => { subs.delete(setS); };
  }, []);
  const load = useCallback(() => { reloadPgV2List(); }, []);
  const toggleSaved = useCallback((id: string) => {
    const next = new Set(snap.saved);
    if (next.has(id)) next.delete(id); else next.add(id);
    emit({ saved: next });
    AsyncStorage.setItem(SAVED_KEY, JSON.stringify([...next])).catch(() => { /* storage full: this session still has it */ });
  }, []);
  const addRecent = useCallback((q: string) => {
    const v = q.trim();
    if (!v) return;
    emit({ recent: [v, ...snap.recent.filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, 6) });
  }, []);
  const value = useMemo(() => ({ list: s.list, listState: s.listState, reloadList: load, saved: s.saved, toggleSaved, recent: s.recent, addRecent }), [s, load, toggleSaved, addRecent]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePgV2 = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePgV2 outside PgV2DataProvider');
  return v;
};

// ── Detail (cached per id for the session) ───────────────────────────────────────────────────────
const detailCache = new Map<string, PgDetail>();
const detailInflight = new Map<string, Promise<PgDetail | null>>();

export const fetchPgDetail = (id: string): Promise<PgDetail | null> => {
  const hit = detailCache.get(id);
  if (hit) return Promise.resolve(hit);
  let p = detailInflight.get(id);
  if (!p) {
    p = (async () => {
      try {
        const res = await apiFetch(ENDPOINTS.pgDetail(id));
        const data = await readJson(res);
        if (!res.ok || !data || !data.id) return null;
        // Demo content fills what the listing lacks (pgV2Demo.ts: one switch, real data wins).
        const pg: PgDetail = applyDemo({ ...data, amenities: cleanAmenities(data.amenities) });
        detailCache.set(id, pg);
        return pg;
      } catch {
        return null;
      } finally {
        detailInflight.delete(id);
      }
    })();
    detailInflight.set(id, p);
  }
  return p;
};

export function usePgDetail(id: string | null) {
  // Without an id yet (the list is still loading) keep showing loading.
  const listState = useContext(Ctx)?.listState ?? 'ready';
  const [pg, setPg] = useState<PgDetail | null>(() => (id ? detailCache.get(id) || null : null));
  const [state, setState] = useState<LoadState>(id && detailCache.has(id) ? 'ready' : 'loading');
  useEffect(() => {
    let live = true;
    if (!id) { setPg(null); setState(listState === 'loading' ? 'loading' : 'error'); return undefined; }
    const hit = detailCache.get(id);
    if (hit) { setPg(hit); setState('ready'); return undefined; }
    setState('loading');
    fetchPgDetail(id).then((d) => { if (live) { setPg(d); setState(d ? 'ready' : 'error'); } });
    return () => { live = false; };
  }, [id, listState]);
  return { pg, state };
}

/** Details of many PGs (the cross-building Rooms screen). */
export function usePgDetails(ids: string[]) {
  const key = ids.join(',');
  const [map, setMap] = useState<Record<string, PgDetail>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all(ids.map(fetchPgDetail)).then((rows) => {
      if (!live) return;
      const m: Record<string, PgDetail> = {};
      rows.forEach((d) => { if (d) m[d.id] = d; });
      setMap(m);
      setLoading(false);
    });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { map, loading };
}

// ── My bookings ──────────────────────────────────────────────────────────────────────────────────
export function useMyBookings(enabled: boolean) {
  const [items, setItems] = useState<MyPgBooking[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const load = useCallback(async () => {
    if (!enabled) { setItems([]); setState('ready'); return; }
    setState('loading');
    try {
      const res = await apiFetch(`${API_URL}/api/pg/bookings/mine`);
      const data = await readJson(res);
      if (!live.current) return;
      if (res.ok && Array.isArray(data)) { setItems(data); setState('ready'); } else setState('error');
    } catch {
      if (live.current) setState('error');
    }
  }, [enabled]);
  useEffect(() => { load(); }, [load]);
  return { items, state, reload: load };
}

/** Server copy may still say "Zenvy" or "ZCS" in places; the app brand is ZenWe (4 Nov 2026). */
const brand = (m: string) => m.replace(/\bZenvy\b|\bZCS\b/g, 'ZenWe');

export type SendResult = { ok: true; message: string; whatsappUrl?: string } | { ok: false; status: number; code?: string; message: string };

/** Real booking request. Only called from the Send Request button. */
export const sendBookingRequest = async (roomId: string, checkInDate: string): Promise<SendResult> => {
  try {
    const res = await apiFetch(ENDPOINTS.pgBook(roomId), { method: 'POST', body: JSON.stringify({ checkInDate }) });
    const data = await readJson(res);
    if (res.ok) return { ok: true, message: brand(data?.message || 'Request sent. The ZenWe housing team will confirm it with you.'), whatsappUrl: data?.whatsappUrl };
    return { ok: false, status: res.status, code: data?.code, message: brand(data?.message || 'Please try again.') };
  } catch {
    return { ok: false, status: 0, message: 'Check your internet and try again.' };
  }
};

export const cancelBookingRequest = async (bookingId: string): Promise<{ ok: boolean; message: string }> => {
  try {
    const res = await apiFetch(`${API_URL}/api/pg/bookings/${bookingId}/cancel`, { method: 'PUT' });
    const data = await readJson(res);
    return { ok: res.ok, message: brand(data?.message || (res.ok ? 'Booking request cancelled.' : 'Please try again.')) };
  } catch {
    return { ok: false, message: 'Check your internet and try again.' };
  }
};

// ── Formatters ──────────────────────────────────────────────────────────────────────────────────
export const gKey = (g?: string | null) => genderKey(g) as GenderKey;
export const genderPillText = (g?: string | null) => `${gKey(g)} PG`;

/** "₹5,000 – ₹7,500" from the room types (or the PG's starting rent). Empty when unknown. */
export const rentRange = (pg: { roomTypes?: PgRoomType[]; rentFrom?: number | null; baseRent?: number }) => {
  const prices: number[] = [];
  (pg.roomTypes || []).forEach((t) => {
    if (typeof t.rentFrom === 'number') prices.push(t.rentFrom);
    if (typeof t.rentTo === 'number') prices.push(t.rentTo);
  });
  if (prices.length) {
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    return lo === hi ? inr(lo) : `${inr(lo)} – ${inr(hi)}`;
  }
  const from = pg.rentFrom ?? pg.baseRent;
  return typeof from === 'number' && from > 0 ? inr(from) : '';
};
export const rentFromText = (pg: PgListItem) => {
  const v = pg.rentFrom ?? pg.baseRent;
  return typeof v === 'number' && v > 0 ? inr(v) : '';
};

/** "0.3 km" / "450 m" from campus. */
export const kmText = (km?: number | null) => {
  const v = Number(km);
  if (!Number.isFinite(v) || v <= 0) return '';
  return v < 1 ? `${Math.round(v * 1000)} m` : `${v % 1 === 0 ? v : v.toFixed(1)} km`;
};

/** Room-type title the way the reference words it: Single Room, Double Sharing, Triple Sharing, Dormitory. */
export const roomTypeName = (sharing: number) => {
  if (sharing <= 1) return 'Single Room';
  if (sharing === 2) return 'Double Sharing';
  if (sharing === 3) return 'Triple Sharing';
  return `${sharing} Sharing Dormitory`;
};
export const sharingFilterKey = (sharing: number) => (sharing <= 1 ? 'single' : sharing === 2 ? 'double' : sharing === 3 ? 'triple' : 'dorm');
export const bedsText = (n: number) => `${n} Bed${n === 1 ? '' : 's'}`;
export const bathText = (t: PgRoomType) => (t.hasAttachedBathroom ? 'Attached Bath' : 'Common Bath');

/** Short place line: the PG's area when set, else the first part of its address. */
export const placeText = (pg: { area?: string | null; address?: string }) => {
  if (pg.area) return pg.area;
  const a = String(pg.address || '').split(',').map((x) => x.trim()).filter(Boolean);
  return a[0] || '';
};

/** "1 Aug 2026". */
export const dayText = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

// ── Home search filters (monthly rent per bed, from the listing's starting rent) ─────────────────
export const BUDGETS: { key: 'any' | 'u6' | '6to10' | 'o10'; label: string }[] = [
  { key: 'any', label: 'Any budget' },
  { key: 'u6', label: 'Up to ₹6,000' },
  { key: '6to10', label: '₹6,000–10,000' },
  { key: 'o10', label: '₹10,000+' },
];
export const inBudget = (pg: PgListItem, key?: string) => {
  const rent = Number(pg.rentFrom ?? pg.baseRent);
  if (!key || key === 'any' || !Number.isFinite(rent)) return true;
  if (key === 'u6') return rent <= 6000;
  if (key === '6to10') return rent > 6000 && rent <= 10000;
  return rent > 10000;
};

/** "₹7,500" or "₹7,500–9,000" for a room type's rent per bed. */
export const rentText = (t: PgRoomType) => (t.rentFrom === null ? '' : t.rentTo !== null && t.rentTo !== t.rentFrom ? `${inr(t.rentFrom)}–${inr(t.rentTo).slice(1)}` : inr(t.rentFrom));
