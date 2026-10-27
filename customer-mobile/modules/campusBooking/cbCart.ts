/**
 * In-Campus Booking cart: one small cart PER STALL, kept apart from the app's three delivery baskets (others,
 * restaurant, local vendor in context/CartContext). Nothing here reads or writes CartContext, so a pickup booking
 * can never mix with a delivery order or change a delivery checkout.
 * Saved on the phone (AsyncStorage) so a cart survives leaving the screen. Prices / names are only for showing;
 * the server prices every booking again from the stall menu.
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'zcs.campusBooking.carts.v1';
const MAX_QTY = 10;
const MAX_LINES = 20;
/** Carts untouched for a day are dropped (menus and prices move on). */
const STALE_MS = 24 * 3600 * 1000;

export interface CbCartLine { menuItemId: string; name: string; price: number; isVeg: boolean; quantity: number; category?: string | null }
interface CbCartData { lines: CbCartLine[]; at: number }
type Store = Record<string, CbCartData>;

let store: Store = {};
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

const loading = AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (!raw) return;
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return;
    const now = Date.now();
    for (const [k, c] of Object.entries(v as Store)) {
      if (c && Array.isArray(c.lines) && now - Number(c.at || 0) < STALE_MS) store[k] = { lines: c.lines.filter((l) => l && l.menuItemId && l.quantity > 0), at: c.at };
    }
  })
  .catch(() => { /* unreadable: start empty */ })
  .finally(() => { loaded = true; emit(); });

const save = () => { AsyncStorage.setItem(KEY, JSON.stringify(store)).catch(() => {}); };

const write = (stallId: string, lines: CbCartLine[]) => {
  const next = { ...store };
  if (lines.length) next[stallId] = { lines, at: Date.now() };
  else delete next[stallId];
  store = next;
  save();
  emit();
};

export const cbCart = {
  lines: (stallId: string): CbCartLine[] => (store[stallId] ? store[stallId].lines : []),
  qty: (stallId: string, menuItemId: string) => (store[stallId]?.lines.find((l) => l.menuItemId === menuItemId)?.quantity || 0),
  /** +1 / -1 (or any delta) for one item. Returns false when a limit stopped it. */
  change: (stallId: string, item: Omit<CbCartLine, 'quantity'>, delta: number): boolean => {
    const lines = [...cbCart.lines(stallId)];
    const i = lines.findIndex((l) => l.menuItemId === item.menuItemId);
    const cur = i >= 0 ? lines[i].quantity : 0;
    const q = Math.max(0, Math.min(MAX_QTY, cur + delta));
    if (q === cur) return false;
    if (i < 0 && lines.length >= MAX_LINES) return false;
    if (q === 0) lines.splice(i, 1);
    else if (i >= 0) lines[i] = { ...lines[i], ...item, quantity: q };
    else lines.push({ ...item, quantity: q });
    write(stallId, lines);
    return true;
  },
  /** Fresh names / prices from the menu; items no longer on it are removed. Returns the removed names. */
  refresh: (stallId: string, menu: { id: string; name: string; price: number; isVeg: boolean; isAvailable: boolean; category?: string | null }[]): string[] => {
    const byId = new Map(menu.map((m) => [m.id, m]));
    const removed: string[] = [];
    const lines: CbCartLine[] = [];
    for (const l of cbCart.lines(stallId)) {
      const m = byId.get(l.menuItemId);
      if (!m) { removed.push(l.name); continue; }
      lines.push({ ...l, name: m.name, price: m.price, isVeg: m.isVeg, category: m.category ?? null });
    }
    const before = JSON.stringify(cbCart.lines(stallId));
    if (JSON.stringify(lines) !== before) write(stallId, lines);
    return removed;
  },
  remove: (stallId: string, menuItemId: string) => write(stallId, cbCart.lines(stallId).filter((l) => l.menuItemId !== menuItemId)),
  clear: (stallId: string) => write(stallId, []),
  /** The stall cart changed most recently (for the "View cart" bar on the stall list), or null. */
  latest: (): { stallId: string; lines: CbCartLine[] } | null => {
    let best: { stallId: string; lines: CbCartLine[]; at: number } | null = null;
    for (const [stallId, c] of Object.entries(store)) if (c.lines.length && (!best || c.at > best.at)) best = { stallId, lines: c.lines, at: c.at };
    return best ? { stallId: best.stallId, lines: best.lines } : null;
  },
  MAX_QTY,
};

export const cartTotals = (lines: CbCartLine[]) => ({
  count: lines.reduce((s, l) => s + l.quantity, 0),
  total: Math.round(lines.reduce((s, l) => s + l.price * 100 * l.quantity, 0)) / 100,
});

/** Non-food products (stationery, toiletries...) carry no veg mark (same rule as the Home stall section). */
export const NON_FOOD_CATEGORY = /stationery|xerox|print|toiletr|laundry|household|electronic/i;
export const isNonFood = (category?: string | null) => NON_FOOD_CATEGORY.test(String(category || ''));

/** Re-renders on every cart change (any stall). */
export function useCbCartTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    if (!loaded) void loading.then(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return loaded;
}

/** Live cart lines of one stall (re-renders on every change, from any screen). */
export function useCbCart(stallId: string | null | undefined) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    if (!loaded) void loading.then(fn);
    return () => { listeners.delete(fn); };
  }, []);
  const lines = stallId ? cbCart.lines(stallId) : [];
  return { lines, ...cartTotals(lines), loaded };
}
