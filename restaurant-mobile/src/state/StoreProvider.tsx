// Everything the logged-in store sees and does: live store state, orders, menu, connection, the
// new-order alert list, and the kitchen actions. Each order has an in-flight lock (no double submits);
// accept / reject / ready are never optimistic (the server decides), stock / price update on success.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { FALLBACK_POLL_MS, SAFETY_POLL_MS, STORAGE } from '../config';
import * as api from '../lib/api';
import { ApiError, NetworkError, errorMessage } from '../lib/http';
import { isEggTag, isTodayIST, normalizeOrder, rupees, stageFor, TIMEOUT_REASON_TEXT, todayNumbers } from '../lib/model';
import { onOrderPush, onPushTokenChange, registerStorePush, type PushState } from '../lib/push';
import { safeGet, safeSet } from '../lib/storage';
import { startKitchenService, stopKitchenService } from '../voice/kitchenService';
import { announce, cancelAnnouncements, detectVoices } from '../voice/voice';
import { useToast } from '../ui/Toast';
import { useSocket } from './SocketProvider';
import { useSession } from './SessionProvider';
import type { ConnStatus, ItemInput, MenuItem, OperatingHours, Order, StoreProfile, StoreState } from '../types';

export type StockChange = { isAvailable: true } | { isAvailable: false } | { outOfStockUntil: string };
export type BusyKind = 'accept' | 'reject' | 'ready';
export type DeleteResult = { ok: true } | { ok: false; error: string };

interface StoreCtx {
  restaurant: StoreProfile;
  store: StoreState | null;
  storeError: string | null;
  openToggleSupported: boolean;
  orders: Order[];
  ordersLoaded: boolean;
  ordersError: string | null;
  refreshing: boolean;
  lastSyncedAt: number | null;
  menu: MenuItem[] | null;
  menuError: string | null;
  menuLoading: boolean;
  menuPending: Record<string, boolean>;
  conn: ConnStatus;
  /** Closed-app order alerts: 'blocked' / 'unavailable' = new orders ring only while the app is open. */
  pushState: PushState;
  /** Pending orders not yet accepted / rejected / silenced, oldest first. */
  alertOrders: Order[];
  busy: Record<string, BusyKind>;
  /** Last failed kitchen action per order (shown inline: toasts sit behind the alert / sheet modals). */
  actionErrors: Record<string, string>;
  retryConnection: () => void;
  refreshOrders: (opts?: { pull?: boolean; full?: boolean }) => Promise<void>;
  refreshStore: () => Promise<void>;
  refreshMenu: () => Promise<void>;
  silence: (ids: string[]) => void;
  /** True for a tap on a DIFFERENT order right after an action succeeded (the second tap of a double tap
   *  that landed on the next order once the list / alert moved). Callers ignore such taps. */
  isGhostTap: (orderId: string) => boolean;
  accept: (o: Order, estDuration: number) => Promise<boolean>;
  reject: (o: Order, reason: string) => Promise<boolean>;
  markReady: (o: Order) => Promise<boolean>;
  setOpen: (open: boolean) => Promise<{ ok: boolean; error?: string }>;
  setStock: (item: MenuItem, change: StockChange) => Promise<boolean>;
  /** Every item of one menu category in / out of stock (one tap on the section header). */
  setCategoryStock: (category: string, isAvailable: boolean) => Promise<boolean>;
  /** Categories whose switch is saving. */
  categoryPending: Record<string, boolean>;
  setHours: (hours: OperatingHours) => Promise<{ ok: boolean; error?: string }>;
  setPrice: (item: MenuItem, price: number) => Promise<void>;
  /** Add (editing = null) or edit an item. Throws with a friendly message; the form shows it inline. */
  saveItem: (input: ItemInput, editing: MenuItem | null) => Promise<MenuItem>;
  deleteItem: (item: MenuItem) => Promise<DeleteResult>;
}

const Ctx = createContext<StoreCtx | null>(null);

/** A socket stub that the list does not have yet is kept this long (replication / race). */
const STUB_KEEP_MS = 60000;
/** Stages with something still to do (the service stays on for these even when the store is closed). */
const ACTIVE_STAGES: Order['stage'][] = ['new', 'preparing', 'ready'];
/** "Later" (stop ringing) is remembered across app restarts for this long (the server auto-cancels long before). */
const SILENCE_KEEP_MS = 6 * 60 * 60 * 1000;
/** While closed only by the hours (switch on), re-check the store this often so it reopens on time. */
const CLOSED_STORE_CHECK_MS = 5 * 60 * 1000;
/** The full order list (Past tab, 7-day history) is refetched at most this often; routine polls use ?scope=active. */
const FULL_ORDERS_EVERY_MS = 30 * 60 * 1000;
/** After an order action succeeds, taps on a different order's buttons are ignored this long (ghost double tap). */
const GHOST_TAP_MS = 700;
const newIdempotencyKey = (rid: string) => `${rid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const { restaurant: maybeRestaurant, updateProfile } = useSession();
  // Only mounted with a restaurant; the fallback covers the logout render.
  const restaurant = (maybeRestaurant || { id: '', name: '' }) as StoreProfile;
  const rid = restaurant.id;
  const { socket, status: conn, connectCount, retry } = useSocket();
  const toast = useToast();

  const [store, setStore] = useState<StoreState | null>(null);
  const [pushState, setPushState] = useState<PushState>('unknown');
  const [storeError, setStoreError] = useState<string | null>(null);
  const [openToggleSupported, setOpenToggleSupported] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuPending, setMenuPending] = useState<Record<string, boolean>>({});
  const [silenced, setSilenced] = useState<Record<string, number>>({});
  const [silencedReady, setSilencedReady] = useState(false);
  const [busy, setBusy] = useState<Record<string, BusyKind>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  // Status changes learned locally (our own action or a socket event). A list fetch that was already in
  // flight when they happened carries the older status, so they are re-applied on top of it; otherwise an
  // accepted order would briefly come back as Pending and ring again.
  const localPatches = useRef<Record<string, { at: number; patch: Partial<Order> }>>({});
  const patchOrderRef = useRef<(id: string, patch: Partial<Order>) => void>(() => {});
  const ordersRef = useRef<Order[]>([]);
  ordersRef.current = orders;
  const menuRef = useRef<MenuItem[] | null>(null);
  menuRef.current = menu;
  const busyRef = useRef<Record<string, BusyKind>>({});
  const menuPendingRef = useRef<Record<string, boolean>>({});
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // ── Fetchers (coalesced: a refresh asked for during one in flight runs once more afterwards) ──
  // Routine refreshes (polls, socket events, after an action) ask only for the active orders
  // (?scope=active: open + today's finished). The full latest-200 list (Past tab, 7-day history) is fetched
  // at start, on pull-to-refresh, every FULL_ORDERS_EVERY_MS, and whenever an active order we hold is missing
  // from the active answer (it finished on an earlier day: only the full list has its final status).
  const ordersInFlight = useRef<Promise<void> | null>(null);
  const ordersAgain = useRef(false);
  const fullAgain = useRef(false);
  const lastFullAt = useRef(0);
  const refreshOrdersRef = useRef<(opts?: { pull?: boolean; full?: boolean }) => Promise<void>>(async () => {});
  const refreshOrders = useCallback(async (opts?: { pull?: boolean; full?: boolean }) => {
    if (opts?.pull) setRefreshing(true);
    if (ordersInFlight.current) {
      ordersAgain.current = true;
      if (opts?.pull || opts?.full) fullAgain.current = true;
      return ordersInFlight.current;
    }
    const full = !!(opts?.pull || opts?.full) || !lastFullAt.current || Date.now() - lastFullAt.current > FULL_ORDERS_EVERY_MS;
    const run = (async () => {
      const startedAt = Date.now();
      try {
        const got = await api.getOrders(rid, full ? undefined : 'active');
        if (!alive.current) return;
        let fetched = got;
        if (full) {
          lastFullAt.current = startedAt;
        } else {
          // Keep the older history (finished orders from earlier days) the active answer leaves out.
          const gotIds = new Set(got.map((o) => o.id));
          const kept = ordersRef.current.filter((o) => !o.partial && !gotIds.has(o.id));
          const history = kept.filter((o) => o.stage === 'past' && !isTodayIST(o.createdAt));
          // Any other order we hold that the server left out is no longer active (finished on an earlier day,
          // or a finished order from today after the IST midnight): get its real status from the full list.
          if (kept.length > history.length) { ordersAgain.current = true; fullAgain.current = true; }
          fetched = [...got, ...history]
            .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        }
        const lp = localPatches.current;
        const fresh = fetched.map((o) => {
          const p = lp[o.id];
          if (!p) return o;
          if (p.at < startedAt) { delete lp[o.id]; return o; } // the server already had it
          const merged = { ...o, ...p.patch };
          return { ...merged, stage: stageFor(merged.status, merged.readyAt) };
        });
        const ids = new Set(fresh.map((o) => o.id));
        const now = Date.now();
        for (const k of Object.keys(lp)) if (now - lp[k].at > 5 * 60000) delete lp[k];
        const stubs = ordersRef.current.filter(
          (o) => o.partial && !ids.has(o.id) && now - new Date(o.createdAt || 0).getTime() < STUB_KEEP_MS,
        );
        setOrders([...stubs, ...fresh]);
        setOrdersError(null);
        setOrdersLoaded(true);
        setLastSyncedAt(now);
      } catch (e) {
        if (!alive.current) return;
        const msg = errorMessage(e, "Couldn't load orders.");
        setOrdersError(msg);
        if (opts?.pull) toast.show(msg, 'error');
      } finally {
        ordersInFlight.current = null;
        if (alive.current) setRefreshing(false);
        if (ordersAgain.current && alive.current) {
          ordersAgain.current = false;
          const again = fullAgain.current;
          fullAgain.current = false;
          refreshOrdersRef.current(again ? { full: true } : undefined);
        }
      }
    })();
    ordersInFlight.current = run;
    return run;
  }, [rid, toast]);
  refreshOrdersRef.current = refreshOrders;

  const storeInFlight = useRef(false);
  const refreshStore = useCallback(async () => {
    if (storeInFlight.current) return;
    storeInFlight.current = true;
    try {
      const { store: s, raw } = await api.getStore(rid);
      if (!alive.current) return;
      setStore(s);
      setStoreError(null);
      updateProfile({
        name: typeof raw?.name === 'string' && raw.name ? raw.name : undefined,
        location: s.location,
        campus: typeof raw?.campus === 'string' ? raw.campus : undefined,
        operatingHours: s.operatingHours,
        isOpenNow: s.isOpenNow,
        isOffline: s.isOffline,
        deliveryTime: s.deliveryTime ?? undefined,
      });
    } catch (e) {
      if (alive.current) setStoreError(errorMessage(e, "Couldn't load store status."));
    } finally {
      storeInFlight.current = false;
    }
  }, [rid, updateProfile]);

  const menuInFlight = useRef(false);
  const refreshMenu = useCallback(async () => {
    if (menuInFlight.current) return;
    menuInFlight.current = true;
    setMenuLoading(true);
    try {
      const m = await api.getMenu(rid);
      if (!alive.current) return;
      setMenu(m);
      setMenuError(null);
    } catch (e) {
      if (alive.current) setMenuError(errorMessage(e, "Couldn't load your menu."));
    } finally {
      menuInFlight.current = false;
      if (alive.current) setMenuLoading(false);
    }
  }, [rid]);

  // Debounced refetches after socket events.
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const debounce = useCallback((name: string, ms: number, fn: () => void) => {
    if (timers.current[name]) clearTimeout(timers.current[name]);
    timers.current[name] = setTimeout(() => {
      delete timers.current[name];
      if (alive.current) fn();
    }, ms);
  }, []);
  useEffect(() => () => {
    Object.values(timers.current).forEach(clearTimeout);
    timers.current = {};
  }, []);
  const scheduleOrders = useCallback((ms = 800) => debounce('orders', ms, () => { refreshOrdersRef.current(); }), [debounce]);

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    refreshOrders();
    refreshStore();
    refreshMenu();
    // The kitchen service (and its wakelock) is started / stopped below, from the store's open state.
    // Order pushes while the app is closed (FCM via the server). Best effort: never blocks the app, but
    // a phone that cannot get them shows a banner so the store knows to keep the app open.
    registerStorePush(rid).then((st) => { if (alive.current) setPushState(st); });
    const offToken = onPushTokenChange(rid);
    const offPush = onOrderPush((d) => {
      if (d?.type === 'NEW_ORDER' || d?.type === 'ORDER_CANCELLED' || d?.orderId) scheduleOrders(300);
    });
    return () => { offToken(); offPush(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Back from the phone's settings (or any resume): retry closed-app alerts if they were off.
  // 'unknown' = the token POST failed (network / server waking up): retried too, otherwise a phone that
  // stays open for days never gets closed-app alerts. 'ok' runs too: it is a local check, and re-sends the
  // token to the server once a day (it may have been dropped there).
  const pushStateRef = useRef<PushState>('unknown');
  pushStateRef.current = pushState;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') registerStorePush(rid).then((r) => { if (alive.current) setPushState(r); });
    });
    return () => sub.remove();
  }, [pushState, rid]);

  // After every (re)connect: refetch what may have been missed while offline (events are not replayed).
  useEffect(() => {
    if (connectCount > 0) {
      refreshOrders();
      refreshStore();
      // Never re-asks permission here ('blocked' is retried on resume only).
      if (connectCount > 1 && pushStateRef.current === 'unknown') registerStorePush(rid).then((r) => { if (alive.current) setPushState(r); });
    }
  }, [connectCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling: fast while the socket is down, slow safety net while it is up. In the background it is skipped
  // while the socket is up (the socket and order pushes carry new orders; a poll there only keeps the radio
  // awake) and while the store is closed with nothing in progress.
  const kitchenWantedRef = useRef(true);
  useEffect(() => {
    const t = setInterval(() => {
      if (AppState.currentState !== 'active' && (conn === 'online' || !kitchenWantedRef.current)) return;
      refreshOrdersRef.current();
    }, conn === 'online' ? SAFETY_POLL_MS : FALLBACK_POLL_MS);
    return () => clearInterval(t);
  }, [conn]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        refreshOrdersRef.current();
        refreshStore();
        detectVoices();
        // Android may have stopped the kitchen service while we were away (dataSync time limit, or
        // a start that was not allowed): start it again now that the app is in the foreground.
        if (kitchenWantedRef.current) startKitchenService();
      }
    });
    return () => sub.remove();
  }, [refreshStore]);

  // ── Kitchen service (foreground service + wakelock): only while the store can get orders ──
  // Closed (switched off, or outside its hours) with nothing in progress = no service and no wakelock, so a
  // closed store does not drain the battery overnight. Unknown store state (not loaded yet) keeps it on.
  const hasActive = orders.some((o) => ACTIVE_STAGES.includes(o.stage));
  const kitchenWanted = store === null || store.isOpen || hasActive;
  kitchenWantedRef.current = kitchenWanted;
  const kitchenOn = useRef<boolean | null>(null);
  useEffect(() => {
    if (kitchenOn.current === kitchenWanted) return;
    kitchenOn.current = kitchenWanted;
    if (kitchenWanted) startKitchenService();
    else stopKitchenService();
  }, [kitchenWanted]);

  // Closed only by the hours (switch still on): the server opens it at opensAt without telling the app, so
  // re-check now and then to start the service (and ringing) again on time.
  const closedByHours = !!store && !store.isOpen && store.isOpenNow;
  useEffect(() => {
    if (!closedByHours) return;
    const t = setInterval(() => { refreshStore(); }, CLOSED_STORE_CHECK_MS);
    return () => clearInterval(t);
  }, [closedByHours, refreshStore]);

  // ── Socket events ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    const onNewOrder = (p: any) => {
      const o = normalizeOrder({ ...p, status: p?.status || 'Pending', createdAt: p?.createdAt || new Date().toISOString(), __partial: true });
      if (o) setOrders((prev) => (prev.some((x) => x.id === o.id) ? prev : [o, ...prev]));
      scheduleOrders(300);
    };
    const onStatus = (p: any) => {
      const id = p?.id || p?.orderId;
      const status = typeof p?.status === 'string' ? p.status : null;
      if (!id) return;
      if (status) {
        const patch: Partial<Order> = { status };
        if (status === 'Cancelled' && p?.reason === 'STORE_TIMEOUT') patch.cancellationReason = TIMEOUT_REASON_TEXT;
        patchOrderRef.current(id, patch);
      }
      scheduleOrders(800); // rider name / assignment / reasons come with the full row
    };
    const onCancelled = (p: any) => {
      if (p?.orderId) onStatus({ id: p.orderId, status: 'Cancelled', reason: p.reason });
    };
    const onInventory = (p: any) => {
      const itemId = p?.itemId;
      if (!itemId) return;
      if (p?.restaurantId ? p.restaurantId !== rid : !menuRef.current?.some((m) => m.id === itemId)) return;
      setMenu((prev) => prev && prev.map((m) => (m.id === itemId
        ? { ...m, isAvailable: p.isAvailable !== false, outOfStockUntil: p.isAvailable !== false ? null : m.outOfStockUntil }
        : m)));
    };
    const onStoreStatus = (p: any) => {
      if (!p?.restaurantId || p.restaurantId === rid) debounce('store', 500, refreshStore);
    };
    const onDataChanged = (e: any) => {
      if (!e || typeof e !== 'object') return;
      if (e.type === 'product' && (e.storeId === rid || (e.bulk && !e.storeId))) debounce('menu', 600, refreshMenu);
      if (e.type === 'store' && (e.id === rid || e.id === null)) debounce('store', 600, refreshStore);
    };
    socket.on('restaurant_newOrder', onNewOrder);
    socket.on('statusUpdated', onStatus);
    socket.on('orderCancelled', onCancelled);
    socket.on('inventory_updated', onInventory);
    socket.on('store_status_changed', onStoreStatus);
    socket.on('data:changed', onDataChanged);
    return () => {
      socket.off('restaurant_newOrder', onNewOrder);
      socket.off('statusUpdated', onStatus);
      socket.off('orderCancelled', onCancelled);
      socket.off('inventory_updated', onInventory);
      socket.off('store_status_changed', onStoreStatus);
      socket.off('data:changed', onDataChanged);
    };
  }, [socket, rid, scheduleOrders, debounce, refreshStore, refreshMenu]);

  // ── New-order alert list ──────────────────────────────────────────────────
  // "Later" is persisted per store, so an app restart (or Android killing the app) does not ring an order the
  // owner already put off. Nothing rings until it is loaded (a few ms; the order list takes longer anyway).
  const silencedKey = `${STORAGE.silenced}:${rid}`;
  const silencedRef = useRef<Record<string, number>>({});
  silencedRef.current = silenced;
  useEffect(() => {
    let on = true;
    safeGet(silencedKey).then((raw) => {
      if (!on) return;
      let saved: Record<string, unknown> = {};
      try {
        const v = raw ? JSON.parse(raw) : null;
        if (v && typeof v === 'object') saved = v;
      } catch { /* start empty */ }
      const now = Date.now();
      const kept: Record<string, number> = {};
      for (const [id, at] of Object.entries(saved)) if (typeof at === 'number' && now - at < SILENCE_KEEP_MS) kept[id] = at;
      setSilenced((prev) => ({ ...kept, ...prev }));
      setSilencedReady(true);
    });
    return () => { on = false; };
  }, [silencedKey]);

  const alertOrders = useMemo(
    () => (silencedReady ? orders : [])
      .filter((o) => o.stage === 'new' && !silenced[o.id])
      .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()),
    [orders, silenced, silencedReady],
  );

  // The order an action just finished on, and when. When a step succeeds the card leaves its tab (or the
  // alert shows the next order) and the list moves under the finger: the second tap of a double tap then
  // lands on ANOTHER order's button at the same spot (accepting / rejecting / silencing the wrong order).
  const lastDone = useRef<{ id: string; at: number }>({ id: '', at: 0 });
  const isGhostTap = useCallback((orderId: string) => (
    lastDone.current.id !== orderId && Date.now() - lastDone.current.at < GHOST_TAP_MS
  ), []);

  const silence = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const now = Date.now();
    if (ids.length === 1) lastDone.current = { id: ids[0], at: now };
    const next: Record<string, number> = {};
    for (const [id, at] of Object.entries(silencedRef.current)) if (now - at < SILENCE_KEEP_MS) next[id] = at;
    ids.forEach((id) => { next[id] = now; });
    silencedRef.current = next;
    setSilenced(next);
    safeSet(silencedKey, JSON.stringify(next));
    ids.forEach((id) => cancelAnnouncements(`new:${id}`));
  }, [silencedKey]);

  // ── Kitchen actions ───────────────────────────────────────────────────────
  const patchOrder = useCallback((id: string, patch: Partial<Order>) => {
    const now = Date.now();
    const prevPatch = localPatches.current[id];
    const merged: Partial<Order> = { ...(prevPatch && now - prevPatch.at < 5 * 60000 ? prevPatch.patch : {}), ...patch };
    delete merged.stage;
    localPatches.current[id] = { at: now, patch: merged };
    setOrders((prev) => prev.map((o) => {
      if (o.id !== id) return o;
      const next = { ...o, ...merged };
      return { ...next, stage: stageFor(next.status, next.readyAt) };
    }));
  }, []);
  patchOrderRef.current = patchOrder;

  const runAction = useCallback(async (o: Order, kind: BusyKind, fn: () => Promise<void>) => {
    if (busyRef.current[o.id]) return false; // double tap / two buttons for the same order
    if (isGhostTap(o.id)) return false;
    busyRef.current = { ...busyRef.current, [o.id]: kind };
    setBusy(busyRef.current);
    const setErr = (msg: string | null) => setActionErrors((prev) => {
      if (!msg) {
        if (!prev[o.id]) return prev;
        const n = { ...prev };
        delete n[o.id];
        return n;
      }
      return { ...prev, [o.id]: msg };
    });
    setErr(null);
    try {
      await fn();
      lastDone.current = { id: o.id, at: Date.now() };
      scheduleOrders(500);
      return true;
    } catch (e) {
      let msg = 'Something went wrong. Please try again.';
      // 400 / 404 / 409 here = the order moved on (cancelled by the customer, timed out, already handled
      // on another phone). Not a failure of this phone: refresh right away and say so calmly.
      const conflict = e instanceof ApiError && (e.status === 400 || e.status === 404 || e.status === 409);
      if (e instanceof NetworkError) {
        msg = e.message;
        // A timeout may still have reached the server (accepted / rejected there): reload the order right
        // away, so the card shows its real status before anyone taps again.
        scheduleOrders(300);
      } else if (e instanceof ApiError) {
        msg = e.message;
        scheduleOrders(100); // the order may have been cancelled / taken meanwhile
      }
      if (alive.current && !(e instanceof ApiError && e.status === 401)) {
        setErr(msg);
        toast.show(conflict ? `${msg} Refreshing…` : msg, conflict ? 'info' : 'error');
      }
      return false;
    } finally {
      const next = { ...busyRef.current };
      delete next[o.id];
      busyRef.current = next;
      if (alive.current) setBusy(next);
    }
  }, [scheduleOrders, toast, isGhostTap]);

  const accept = useCallback((o: Order, est: number) => runAction(o, 'accept', async () => {
    const res: any = await api.acceptOrder(o.id, est);
    cancelAnnouncements(`new:${o.id}`);
    if (res?.alreadyAccepted) {
      // Double tap / another phone got there first: keep the server's real status, no second announcement.
      if (typeof res.status === 'string' && res.status) patchOrder(o.id, { status: res.status });
      toast.show(`#${o.shortId} was already accepted`, 'info');
      return;
    }
    announce(`accept:${o.id}`, { kind: 'accepted', mins: est }, { urgent: true });
    patchOrder(o.id, { status: 'Accepted', estDuration: est, acceptedAt: new Date().toISOString() });
    toast.show(`#${o.shortId} accepted · ready in ${est} min`, 'success');
  }), [runAction, patchOrder, toast]);

  const reject = useCallback((o: Order, reason: string) => runAction(o, 'reject', async () => {
    const res = await api.rejectOrder(o.id, reason);
    cancelAnnouncements(`new:${o.id}`);
    // Same key as the "cancelled" announcement, so the status change does not announce twice.
    announce(`cancel:${o.id}`, { kind: 'rejected' });
    patchOrder(o.id, { status: 'Cancelled', cancellationReason: reason });
    const refund = Number(res?.refundedToWallet) || 0;
    toast.show(refund > 0 ? `#${o.shortId} rejected · ${rupees(refund)} refunded to the customer` : `#${o.shortId} rejected`, 'info');
  }), [runAction, patchOrder, toast]);

  const markReady = useCallback((o: Order) => runAction(o, 'ready', async () => {
    const res = await api.markReady(o.id);
    const now = new Date().toISOString();
    if (res?.status === 'Picking') {
      patchOrder(o.id, { status: 'Picking', readyAt: now });
      toast.show(`Rider told #${o.shortId} is packed`, 'success');
    } else if (typeof res?.status === 'string' && res.status !== 'ReadyForPickup') {
      // Retry after the rider already took it (PickedUp / ArrivedAtGate / Delivered): keep the real status.
      patchOrder(o.id, { status: res.status, readyAt: o.readyAt || now });
      toast.show(`#${o.shortId} is already with the rider`, 'info');
    } else {
      patchOrder(o.id, { status: 'ReadyForPickup', readyAt: now });
      toast.show(`#${o.shortId} is ready for pickup`, 'success');
    }
  }), [runAction, patchOrder, toast]);

  const openBusy = useRef(false);
  const setOpen = useCallback(async (open: boolean): Promise<{ ok: boolean; error?: string }> => {
    if (openBusy.current) return { ok: false };
    openBusy.current = true;
    try {
      const s = await api.setOpen(rid, open);
      if (!alive.current) return { ok: true };
      setStore((prev) => ({
        ...(prev || s),
        isOpenNow: s.isOpenNow,
        isOpen: s.isOpen,
        opensAt: s.opensAt,
        closedReason: s.closedReason,
        operatingHours: s.operatingHours || prev?.operatingHours || null,
      }));
      updateProfile({ isOpenNow: s.isOpenNow });
      if (s.isOpenNow) {
        announce('store:open', { kind: 'storeOpen' }, { dedupeMs: 2000 });
        toast.show(s.isOpen ? 'Store open — accepting orders' : 'Switched on — but outside your hours', s.isOpen ? 'success' : 'info');
      } else {
        const t = todayNumbers(ordersRef.current);
        announce('store:closed', { kind: 'storeClosed', orders: t.orders, sales: t.sales }, { dedupeMs: 2000 });
        toast.show("Store closed — customers can't order", 'info');
      }
      return { ok: true };
    } catch (e) {
      if (e instanceof api.OpenToggleUnsupported) {
        setOpenToggleSupported(false);
        const msg = 'Opening and closing from the app is not available yet. Call ZCS support to change it.';
        toast.show(msg, 'info');
        return { ok: false, error: msg };
      }
      if (e instanceof ApiError && e.status === 401) return { ok: false };
      const msg = errorMessage(e, "Couldn't change store status.");
      toast.show(msg, 'error');
      return { ok: false, error: msg };
    } finally {
      openBusy.current = false;
    }
  }, [rid, updateProfile, toast]);

  const setStock = useCallback(async (item: MenuItem, change: StockChange) => {
    if (menuPendingRef.current[item.id]) return false;
    menuPendingRef.current = { ...menuPendingRef.current, [item.id]: true };
    setMenuPending(menuPendingRef.current);
    try {
      const res = await api.setAvailability(item.id, change);
      const isAvailable = typeof res?.isAvailable === 'boolean' ? res.isAvailable : ('isAvailable' in change ? change.isAvailable : false);
      const until = 'outOfStockUntil' in change ? (res?.outOfStockUntil || change.outOfStockUntil) : null;
      setMenu((prev) => prev && prev.map((m) => (m.id === item.id ? { ...m, isAvailable, outOfStockUntil: isAvailable ? null : until } : m)));
      toast.show(`${item.name}: ${isAvailable ? 'in stock' : 'out of stock'}`, isAvailable ? 'success' : 'info');
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // Expired / revoked session: the http layer already logged out with a message.
      } else if (e instanceof ApiError && e.status === 404) {
        toast.show('That item no longer exists. Refreshing your menu.', 'error');
        refreshMenu();
      } else {
        toast.show(errorMessage(e, "Couldn't update the item."), 'error');
      }
      return false;
    } finally {
      const next = { ...menuPendingRef.current };
      delete next[item.id];
      menuPendingRef.current = next;
      if (alive.current) setMenuPending(next);
    }
  }, [refreshMenu, toast]);

  const setPrice = useCallback(async (item: MenuItem, price: number) => {
    await api.setPrice(item.id, price); // throws: the sheet shows the message inline
    setMenu((prev) => prev && prev.map((m) => (m.id === item.id ? { ...m, price } : m)));
    toast.show(`${item.name} is now ${rupees(price)}`, 'success');
  }, [toast]);

  const upsertLocal = useCallback((item: MenuItem) => {
    setMenu((prev) => {
      const list = prev || [];
      return list.some((m) => m.id === item.id) ? list.map((m) => (m.id === item.id ? item : m)) : [...list, item];
    });
  }, []);

  const createKeys = useRef<Record<string, string>>({});
  const saveItem = useCallback(async (input: ItemInput, editing: MenuItem | null): Promise<MenuItem> => {
    const body: api.MenuItemBody = {
      name: input.name,
      price: input.price,
      category: input.category || null,
      description: input.description || null,
      imageUrl: input.imageUrl,
      isVegetarian: input.diet === 'veg',
      dietType: input.diet,
      originalPrice: input.originalPrice,
      isSpecializedCake: input.isSpecializedCake,
    };
    // Stock: always on create; on edit only when it changed (keeps an "out of stock until" timer intact).
    if (!editing || input.isAvailable !== editing.isAvailable) body.isAvailable = input.isAvailable;
    // Older egg dishes carry an "egg" tag: drop it when the dish is no longer egg (dietType is the truth now).
    if (editing && input.diet !== 'egg' && editing.tags.some(isEggTag)) body.tags = editing.tags.filter((t) => !isEggTag(t));
    // One write: name, price, MRP, food type and stock are saved together (never half-saved).
    let saved: MenuItem;
    if (editing) {
      const res = await api.updateMenuItem(editing.id, body);
      saved = res || {
        ...editing, ...body, category: input.category || 'Other', description: input.description || null,
        tags: body.tags ?? editing.tags, isAvailable: body.isAvailable ?? editing.isAvailable,
      };
    } else {
      // One key per "Add" attempt for the same input: a retry after a timeout reuses it (servers that honour
      // Idempotency-Key never create it twice).
      const sig = JSON.stringify(body);
      const key = createKeys.current[sig] || (createKeys.current[sig] = newIdempotencyKey(rid));
      const before = menuRef.current ? new Set(menuRef.current.map((m) => m.id)) : null;
      try {
        saved = await api.createMenuItem(body, key);
      } catch (e) {
        if (!(e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)) || !before) throw e;
        // Timed out / dropped: the item may have been saved anyway. Reload the menu before the owner retries,
        // so a second tap never adds the same item twice.
        const fresh = await api.getMenu(rid).catch(() => null);
        if (!fresh) throw e;
        if (alive.current) setMenu(fresh);
        const name = body.name.trim().toLowerCase();
        const match = fresh.find((m) => !before.has(m.id) && m.name.trim().toLowerCase() === name);
        if (!match) throw e;
        saved = match;
      }
      delete createKeys.current[sig];
    }
    upsertLocal(saved);
    toast.show(editing ? `${saved.name} saved` : `${saved.name} added to your menu`, 'success');
    if (!editing) announce(`menu:add:${saved.id}`, { kind: 'itemAdded' }, { dedupeMs: 0 });
    return saved;
  }, [rid, toast, upsertLocal]);

  const deleteItem = useCallback(async (item: MenuItem): Promise<DeleteResult> => {
    try {
      await api.deleteMenuItem(item.id);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) return { ok: false, error: errorMessage(e, "Couldn't delete the item. Try again.") };
      // 404 for the item itself: it is already gone, just drop it from the list.
    }
    setMenu((prev) => prev && prev.filter((m) => m.id !== item.id));
    toast.show(`${item.name} deleted`, 'success');
    return { ok: true };
  }, [toast]);

  // Whole category in / out of stock (MenuScreen section header). Keyed by the category name.
  const [categoryPending, setCategoryPending] = useState<Record<string, boolean>>({});
  const categoryPendingRef = useRef<Record<string, boolean>>({});
  const setCategoryStock = useCallback(async (category: string, isAvailable: boolean) => {
    if (categoryPendingRef.current[category]) return false;
    categoryPendingRef.current = { ...categoryPendingRef.current, [category]: true };
    setCategoryPending(categoryPendingRef.current);
    try {
      const res = await api.setCategoryStock(rid, category, isAvailable);
      const changed = new Map((res?.items || []).map((x) => [String(x.id), x]));
      setMenu((prev) => prev && prev.map((m) => {
        const x = changed.get(m.id);
        return x ? { ...m, isAvailable: x.isAvailable, outOfStockUntil: x.isAvailable ? null : (x.outOfStockUntil ?? m.outOfStockUntil ?? null) } : m;
      }));
      const n = typeof res?.total === 'number' ? res.total : changed.size;
      toast.show(`${category}: ${n} item${n === 1 ? '' : 's'} ${isAvailable ? 'in stock' : 'out of stock'}`, isAvailable ? 'success' : 'info');
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // Expired / revoked session: the http layer already logged out with a message.
      } else if (e instanceof ApiError && e.status === 404 && e.code === 'CATEGORY_NOT_FOUND') {
        toast.show('That category has changed. Refreshing your menu.', 'error');
        refreshMenu();
      } else if (e instanceof ApiError && e.status === 404) {
        toast.show('Switching a whole category is not available yet. Switch the items one by one.', 'info');
      } else {
        toast.show(errorMessage(e, "Couldn't update this category."), 'error');
      }
      return false;
    } finally {
      const next = { ...categoryPendingRef.current };
      delete next[category];
      categoryPendingRef.current = next;
      if (alive.current) setCategoryPending(next);
    }
  }, [rid, refreshMenu, toast]);

  // Opening hours (Settings; same endpoint and sheet as the vendor app: PUT /api/restaurants/:id/hours).
  const hoursBusy = useRef(false);
  const setHours = useCallback(async (hours: OperatingHours): Promise<{ ok: boolean; error?: string }> => {
    if (hoursBusy.current) return { ok: false }; // double tap on Save: the first save is still running
    hoursBusy.current = true;
    try {
      const s = await api.setHours(rid, hours);
      if (!alive.current) return { ok: true };
      setStore((prev) => ({ ...(prev || s), ...s, operatingHours: s.operatingHours || hours }));
      updateProfile({ operatingHours: s.operatingHours || hours });
      toast.show('Opening hours saved', 'success');
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return { ok: false };
      return { ok: false, error: errorMessage(e, "Couldn't save the hours. Try again.") };
    } finally {
      hoursBusy.current = false;
    }
  }, [rid, updateProfile, toast]);

  const retryConnection = useCallback(() => { retry(); refreshOrdersRef.current({ pull: true }); }, [retry]);

  const value = useMemo<StoreCtx>(() => ({
    restaurant, store, storeError, openToggleSupported, orders, ordersLoaded, ordersError, refreshing, lastSyncedAt,
    menu, menuError, menuLoading, menuPending, conn, pushState, alertOrders, busy, actionErrors, retryConnection, refreshOrders, refreshStore,
    refreshMenu, silence, isGhostTap, accept, reject, markReady, setOpen, setHours, setStock, setCategoryStock, categoryPending, setPrice, saveItem, deleteItem,
  }), [
    restaurant, store, storeError, openToggleSupported, orders, ordersLoaded, ordersError, refreshing, lastSyncedAt,
    menu, menuError, menuLoading, menuPending, conn, pushState, alertOrders, busy, actionErrors, retryConnection, refreshOrders, refreshStore,
    refreshMenu, silence, isGhostTap, accept, reject, markReady, setOpen, setHours, setStock, setCategoryStock, categoryPending, setPrice, saveItem, deleteItem,
  ]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}

/** One shared clock tick for elapsed times / countdowns (instead of one interval per card). */
const NowCtx = createContext<number>(Date.now());
export function NowProvider({ children, everyMs = 15000 }: { children: React.ReactNode; everyMs?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') setNow(Date.now()); });
    return () => { clearInterval(t); sub.remove(); };
  }, [everyMs]);
  return <NowCtx.Provider value={now}>{children}</NowCtx.Provider>;
}
export const useNow = () => useContext(NowCtx);
