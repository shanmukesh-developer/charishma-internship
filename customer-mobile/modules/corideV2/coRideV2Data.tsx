/**
 * Co-Ride v2 data: ONE provider for every screen. Reads the real endpoints only (no invented data):
 *   GET /api/bikepool/posts      open rides (offers and lift requests), host name / gender / photo
 *   GET /api/bikepool/my-rides   rides I host or asked to join, with requests (phones only once approved)
 *   GET /api/auto-ride/status, /routes, /on-charge   ZCS Auto: on/off, route fare ranges, union queue board
 *   user.karmaPoints             Karma (+50 per completed ride for host and every approved rider, server rule)
 * Writes go through `act` and call the same endpoints the app used before (join, approve, reject, complete,
 * cancel, post; ZCS Auto hold + confirm with cash). Layout samples exist only behind a hidden __DEV__ flag
 * (globalThis.__ZCS_CORIDE_SAMPLES = true in a dev build); production never shows them.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch, readJson, SERVER_BUSY_MESSAGE, NETWORK_ERROR_MESSAGE } from '../../utils/auth';
import { ENDPOINTS, API_URL } from '../../constants/api';
import { useConnectionState, type ConnectionState } from '../../utils/offlineStatus';
import { autoRideApi, AutoRideError, newIdempotencyKey, type ChargeLine, type RouteFull, type Booking } from '../../modules/autoRide/autoRideApi';
import { groupMyRides, myRideInfo, topDestinations } from '../../modules/coride/coRideFormat';
import { useAutoRideLive } from '../../modules/autoRide/ui';
import { coRideApi, friendly, type Template } from './coRideV2Api';
import { sampleRides, sampleMyRides, sampleAutoLines } from './coRideV2Samples';

export type Ride = any;
export type Demo = null | 'empty' | 'loading' | 'offline' | 'waking' | 'error' | 'samples';
export const KARMA_PER_RIDE = 50; // backend/routes/bikePoolRoutes.js: karmaReward = 50
/** Seat caps per vehicle: bike 1 pillion, car up to 4 (the server accepts 1 to 6). */
export const maxSeatsFor = (v: string) => (v === 'Car' ? 4 : 1);
/** Quick places (carried over from the old "Post a ride" sheet). */
export const FROM_PICKS = ['Campus Gate', 'Hostel Sector', 'Amaravathi Center', 'Vijayawada Stn', 'Guntur Bus Stand'];
export const TO_PICKS = ['PVP Square Mall', 'Vijayawada Stn', 'Gannavaram Airport', 'Trendset Mall', 'Mangalagiri D-Mart', 'Main Campus'];

const errText = (res: Response | null, data: any, fallback: string) => {
  if (res && res.status >= 502 && res.status <= 504) return 'The server is starting up. Try again in a few seconds.';
  if (res && res.status >= 500) return 'Something went wrong on our side. Try again in a moment.';
  if (data && typeof data.code === 'string' && ['WOMEN_ONLY', 'WOMEN_ONLY_HOST'].includes(data.code)) return friendly(data.code);
  const msg = data && typeof data.message === 'string' ? data.message.trim() : '';
  if (!msg || msg === 'Unauthorized') return fallback;
  if (/gender preferences mismatch/i.test(msg)) return 'This ride is set to same-gender riders only, so you cannot join it.';
  return msg;
};

async function getList(url: string, fallback: string): Promise<{ list: any[] | null; error: string | null }> {
  try {
    const res = await apiFetch(url);
    const data = await readJson(res);
    if (!data && res.ok) return { list: null, error: SERVER_BUSY_MESSAGE };
    if (res.ok) return { list: Array.isArray(data) ? data : [], error: null };
    return { list: null, error: errText(res, data, fallback) };
  } catch {
    return { list: null, error: NETWORK_ERROR_MESSAGE };
  }
}

// ── Derived, honest numbers ────────────────────────────────────────────────
/** Per-person share of one ride: max = you and the host; min = every open seat taken. Null = no fuel split. */
export function shareOf(ride: Ride): { min: number; max: number } | null {
  const fuel = Number(ride?.estimatedFuelCost) || 0;
  if (fuel <= 0) return null;
  const seats = Math.max(1, Number(ride?.availableSeats) || 1);
  return { min: Math.ceil(fuel / (seats + 1)), max: Math.ceil(fuel / 2) };
}
/** "₹10 – ₹40 / person" for the pool card: lowest and highest share across the live offers. */
export function poolRange(rides: Ride[]): { min: number; max: number } | null {
  const shares = rides.filter((r) => r.creatorRole !== 'passenger').map(shareOf).filter(Boolean) as { min: number; max: number }[];
  if (!shares.length) return null;
  return { min: Math.min(...shares.map((s) => s.min)), max: Math.max(...shares.map((s) => s.max)) };
}
/** Shared auto seat fare range from the active routes (admin-set seatFareMin / Max), else the stands' fares. */
export function autoRange(routes: RouteFull[], lines: ChargeLine[]): { min: number; max: number } | null {
  const vals: number[] = [];
  routes.filter((r) => r.isActive !== false).forEach((r) => { if (r.seatFareMin) vals.push(r.seatFareMin); if (r.seatFareMax) vals.push(r.seatFareMax); });
  if (!vals.length) lines.forEach((l) => { const f = l.onCharge?.seatFare || l.seatFare; if (f) vals.push(f); });
  return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
}
/** Women-only = the host is a woman and accepts same-gender riders only (server-enforced on join). */
/** Women-only rides: the server's womenOnly flag (only Female hosts can set it; only Female riders can join). */
export const isWomenOnly = (r: Ride) => r?.womenOnly === true;
export const isSameGenderOnly = (r: Ride) => r?.genderPreference === 'Same Gender Only';
export const isOffer = (r: Ride) => r?.creatorRole !== 'passenger';
/** Vehicle details stay masked until the seat is confirmed: digits (plate numbers) become dots. */
export const maskVehicle = (t: any, confirmed: boolean) => {
  const s = String(t || '').trim();
  return !s ? '' : confirmed ? s : s.replace(/\d/g, '•');
};

// ── Actions ────────────────────────────────────────────────────────────────
export type ActKind = 'join' | 'approve' | 'reject' | 'complete' | 'cancel' | 'post' | 'bookAuto';
export type ActResult = { ok: boolean; message?: string; data?: any; code?: string };

interface Ctx {
  myId: string;
  signedIn: boolean;
  karma: number;
  demo: Demo;
  setDemo: (d: Demo) => void;
  connection: ConnectionState;
  rides: Ride[];
  ridesLoading: boolean;
  ridesError: string | null;
  myRides: Ride[];
  myGroups: { upcoming: Ride[]; past: Ride[] };
  myLoading: boolean;
  myError: string | null;
  joinStatus: Record<string, string>;
  isSampleMode: boolean;
  /** Profile gender ('' when not set): women-only posting needs Female. */
  gender: string;
  templates: Template[] | null;
  templatesError: string | null;
  reloadTemplates: () => void;
  places: string[];
  pool: { min: number; max: number } | null;
  autoOn: boolean | null;
  autoLines: ChargeLine[] | null;
  autoError: string | null;
  autoMaxSeats: number;
  autoFare: { min: number; max: number } | null;
  autoRoutes: RouteFull[];
  reload: () => void;
  reloadAuto: () => void;
  act: (kind: ActKind, args: any) => Promise<ActResult>;
  busy: string | null;
}
const CoRideV2Context = createContext<Ctx | null>(null);
export const useCoRide = () => {
  const c = useContext(CoRideV2Context);
  if (!c) throw new Error('useCoRide outside CoRideV2Provider');
  return c;
};

// Last good lists, shared by every Co-Ride screen of this session (no skeleton flash when moving between them).
const cache: { rides: Ride[] | null; myRides: Ride[] | null; autoOn: boolean | null; lines: ChargeLine[] | null; routes: RouteFull[]; maxSeats: number; user: string; templates: Template[] | null } = {
  rides: null, myRides: null, autoOn: null, lines: null, routes: [], maxSeats: 4, user: '', templates: null,
};
const devSamples = () => (typeof __DEV__ !== 'undefined' && __DEV__ && (globalThis as any).__ZCS_CORIDE_SAMPLES === true ? 'samples' : null) as Demo;

export function CoRideV2Provider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const myId = String((user as any)?._id || user?.id || '');
  const liveConnection = useConnectionState();
  if (cache.user !== myId) { cache.rides = null; cache.myRides = null; cache.templates = null; cache.user = myId; }
  const [demo, setDemo] = useState<Demo>(devSamples);
  const [rides, setRides] = useState<Ride[]>(cache.rides || []);
  const [ridesLoading, setRidesLoading] = useState(!cache.rides);
  const [ridesError, setRidesError] = useState<string | null>(null);
  const [myRides, setMyRides] = useState<Ride[]>(cache.myRides || []);
  const [myLoading, setMyLoading] = useState(!cache.myRides);
  const [myError, setMyError] = useState<string | null>(null);
  const [autoOn, setAutoOn] = useState<boolean | null>(cache.autoOn);
  const [autoLines, setAutoLines] = useState<ChargeLine[] | null>(cache.lines);
  const [autoRoutes, setAutoRoutes] = useState<RouteFull[]>(cache.routes);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [autoMaxSeats, setAutoMaxSeats] = useState(cache.maxSeats);
  const [busy, setBusy] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(cache.templates);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const reload = useCallback(() => {
    if (!myId) { setRidesLoading(false); setMyLoading(false); return; }
    setRidesLoading(true); setMyLoading(true);
    getList(ENDPOINTS.bikepoolPosts, 'We could not load rides right now.').then(({ list, error }) => {
      if (!alive.current) return;
      if (list) { setRides(list); cache.rides = list; }
      setRidesError(error); setRidesLoading(false);
    });
    getList(ENDPOINTS.bikepoolMyRides, 'We could not load your rides right now.').then(({ list, error }) => {
      if (!alive.current) return;
      if (list) { setMyRides(list); cache.myRides = list; }
      setMyError(error); setMyLoading(false);
    });
  }, [myId]);

  const reloadAuto = useCallback(() => {
    autoRideApi.status().then((s) => {
      if (!alive.current) return;
      setAutoOn(!!s.enabled); cache.autoOn = !!s.enabled;
      if (!s.enabled) return;
      autoRideApi.routes().then((r) => { cache.routes = r.routes || []; if (alive.current) setAutoRoutes(cache.routes); }).catch(() => {});
      autoRideApi.onCharge().then((b) => {
        if (!alive.current) return;
        cache.lines = b.lines || []; cache.maxSeats = Math.max(1, Number(b.maxSeatsPerBooking) || 1);
        setAutoLines(cache.lines); setAutoMaxSeats(cache.maxSeats); setAutoError(null);
      }).catch((e: any) => alive.current && setAutoError(e?.message || 'Could not load the autos.'));
    }).catch((e: any) => { if (alive.current) { setAutoOn(null); setAutoError(e?.message || NETWORK_ERROR_MESSAGE); } });
  }, []);

  const reloadTemplates = useCallback(() => {
    if (!myId) return;
    coRideApi.templates().then((r) => {
      if (!alive.current) return;
      if (r.ok) { cache.templates = r.data.templates || []; setTemplates(cache.templates); setTemplatesError(null); }
      else setTemplatesError(r.message);
    });
  }, [myId]);
  useEffect(() => { reload(); reloadAuto(); reloadTemplates(); }, [reload, reloadAuto, reloadTemplates]);
  // Live: the ZCS Auto socket (debounced in useAutoRideLive) refreshes the board; a reconnect also refetches
  // the rides, at most once per 15 s (same limit as the Others screen's reconnect catch-up).
  const lastCatchUp = useRef(0);
  useAutoRideLive((e) => {
    reloadAuto();
    if (e?.kind === 'reconnect' && Date.now() - lastCatchUp.current > 15000) { lastCatchUp.current = Date.now(); reload(); }
  }, !!myId);

  const joinStatus = useMemo(() => {
    const out: Record<string, string> = {};
    (demo === 'samples' ? sampleMyRides(myId) : myRides).forEach((r) => { const i = myRideInfo(r, myId); if (!i.isCreator && i.myStatus) out[String(r.id)] = i.myStatus; });
    return out;
  }, [myRides, myId, demo]);

  const act = useCallback(async (kind: ActKind, args: any): Promise<ActResult> => {
    const key = String(args?.rideId || args?.auto?.id || kind);
    setBusy(key);
    try {
      if (kind === 'bookAuto') {
        // Same as ChargeBoard: hold (with riderGender when the profile has none), confirm with cash; a hold that
        // could not be confirmed is released at once (unless the network dropped: the retry reuses it).
        let heldId: string | null = null;
        try {
          const h = await autoRideApi.hold(args.auto.id, { seatCount: args.count, ...(args.riderGender ? { riderGender: args.riderGender } : {}) }, newIdempotencyKey());
          let b: Booking = h.booking;
          if (b.status === 'HELD') { heldId = b.id; b = (await autoRideApi.confirm(b.id, 'CASH', newIdempotencyKey())).booking; heldId = null; }
          reloadAuto();
          return { ok: true, data: b };
        } catch (e: any) {
          if (heldId && !(e instanceof AutoRideError && e.isNetwork)) autoRideApi.release(heldId).catch(() => {});
          reloadAuto();
          return { ok: false, code: e?.code, message: e?.message || NETWORK_ERROR_MESSAGE };
        }
      }
      const P = `${API_URL}/api/bikepool/posts`;
      const url = kind === 'join' ? ENDPOINTS.bikepoolJoin(args.rideId)
        : kind === 'complete' ? ENDPOINTS.bikepoolComplete(args.rideId)
          : kind === 'cancel' ? ENDPOINTS.bikepoolCancel(args.rideId)
            : kind === 'approve' ? `${P}/${args.rideId}/requests/${args.requestId}/approve`
              : kind === 'reject' ? `${P}/${args.rideId}/requests/${args.requestId}/reject`
                : ENDPOINTS.bikepoolPosts;
      const res = await apiFetch(url, { method: 'POST', ...(kind === 'post' ? { body: JSON.stringify(args.body) } : {}) });
      const data = await readJson(res);
      if (!res.ok) return { ok: false, message: errText(res, data, 'Could not update the ride.') };
      reload();
      return { ok: true, data, message: data?.message };
    } catch (e: any) {
      return { ok: false, message: e?.message && e?.code ? e.message : NETWORK_ERROR_MESSAGE };
    } finally {
      if (alive.current) setBusy(null);
    }
  }, [reload, reloadAuto]);

  const value = useMemo<Ctx>(() => {
    const d = demo;
    const shownRides = d === 'samples' ? sampleRides() : d === 'empty' || d === 'loading' || d === 'error' || d === 'offline' ? [] : rides;
    const shownMine = d === 'samples' ? sampleMyRides(myId) : d === 'empty' || d === 'loading' || d === 'error' || d === 'offline' ? [] : myRides;
    const demoErr = d === 'error' ? 'Something went wrong on our side. Try again in a moment.' : d === 'offline' ? NETWORK_ERROR_MESSAGE : null;
    const places = Array.from(new Set([...topDestinations(rides, 6), ...topDestinations(rides.map((r) => ({ destination: r.origin })), 6), ...FROM_PICKS, ...TO_PICKS]));
    return {
      myId, signedIn: !!myId, karma: Number(user?.karmaPoints) || 0, demo, setDemo,
      connection: d === 'offline' ? 'offline' : d === 'waking' ? 'waking' : liveConnection,
      rides: shownRides,
      ridesLoading: d === 'loading' || d === 'waking' || (d !== 'samples' && ridesLoading && !rides.length),
      ridesError: demoErr || (rides.length ? null : ridesError),
      myRides: shownMine,
      myGroups: groupMyRides(shownMine, myId),
      myLoading: d === 'loading' || d === 'waking' || (d !== 'samples' && myLoading && !myRides.length),
      myError: demoErr || (myRides.length ? null : myError),
      joinStatus, places, pool: poolRange(shownRides),
      isSampleMode: d === 'samples',
      gender: String((user as any)?.gender || ''),
      templates, templatesError, reloadTemplates,
      autoOn: d === 'samples' ? true : d === 'error' || d === 'offline' ? null : autoOn,
      autoLines: d === 'samples' ? sampleAutoLines() : d === 'loading' || d === 'waking' ? null : d === 'empty' ? [] : autoLines,
      autoError: demoErr || autoError,
      autoMaxSeats, autoFare: autoRange(autoRoutes, autoLines || []), autoRoutes: d === 'error' || d === 'offline' ? [] : autoRoutes,
      reload, reloadAuto, act, busy,
    };
  }, [demo, rides, myRides, ridesLoading, ridesError, myLoading, myError, myId, user, liveConnection, joinStatus, autoOn, autoLines, autoError, autoMaxSeats, autoRoutes, reload, reloadAuto, act, busy, templates, templatesError, reloadTemplates]);

  return <CoRideV2Context.Provider value={value}>{children}</CoRideV2Context.Provider>;
}
