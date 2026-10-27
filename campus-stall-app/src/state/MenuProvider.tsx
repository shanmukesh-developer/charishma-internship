// ZCS Campus Stall: the stall menu (the same menu students book from). Availability switches, whole-category
// stock, add / edit / delete items. Taken from ZCS Vendor's StoreProvider (menu part only), same server routes.
// Never optimistic for writes that can fail: the list changes once the server said yes.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../lib/api';
import { ApiError, NetworkError, errorMessage } from '../lib/http';
import { isEggTag } from '../lib/model';
import { useToast } from '../ui/Toast';
import { useSession } from './SessionProvider';
import { useSocket } from './SocketProvider';
import type { ItemInput, MenuItem } from '../types';

export type DeleteResult = { ok: true } | { ok: false; error: string };

interface MenuCtx {
  menu: MenuItem[] | null;
  menuError: string | null;
  menuLoading: boolean;
  menuPending: Record<string, boolean>;
  categoryPending: Record<string, boolean>;
  refreshMenu: () => Promise<void>;
  setStock: (item: MenuItem, isAvailable: boolean) => Promise<boolean>;
  setCategoryStock: (category: string, isAvailable: boolean) => Promise<boolean>;
  saveItem: (input: ItemInput, editing: MenuItem | null) => Promise<MenuItem>;
  deleteItem: (item: MenuItem) => Promise<DeleteResult>;
}

const Ctx = createContext<MenuCtx | null>(null);
const newIdempotencyKey = (rid: string) => `${rid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function MenuProvider({ children }: { children: React.ReactNode }) {
  const { restaurant } = useSession();
  const rid = restaurant ? restaurant.id : '';
  const toast = useToast();
  const { socket } = useSocket();
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuPending, setMenuPending] = useState<Record<string, boolean>>({});
  const [categoryPending, setCategoryPending] = useState<Record<string, boolean>>({});
  const menuPendingRef = useRef<Record<string, boolean>>({});
  const categoryPendingRef = useRef<Record<string, boolean>>({});
  const menuRef = useRef<MenuItem[] | null>(null);
  menuRef.current = menu;
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const inFlight = useRef(false);
  const refreshMenu = useCallback(async () => {
    if (inFlight.current || !rid) return;
    inFlight.current = true;
    setMenuLoading(true);
    try {
      const m = await api.getMenu(rid);
      if (!alive.current) return;
      setMenu(m);
      setMenuError(null);
    } catch (e) {
      if (alive.current) setMenuError(errorMessage(e, "Couldn't load your menu."));
    } finally {
      inFlight.current = false;
      if (alive.current) setMenuLoading(false);
    }
  }, [rid]);
  useEffect(() => { void refreshMenu(); }, [refreshMenu]);

  // A product changed elsewhere (ZCS admin, the Vendor app): refetch (ids-only `data:changed`).
  useEffect(() => {
    if (!socket) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const fn = (e: any) => {
      if (!e || e.type !== 'product' || (e.storeId !== rid && !(e.bulk && !e.storeId))) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => { void refreshMenu(); }, 600);
    };
    socket.on('data:changed', fn);
    return () => { if (t) clearTimeout(t); socket.off('data:changed', fn); };
  }, [socket, rid, refreshMenu]);

  const setStock = useCallback(async (item: MenuItem, isAvailable: boolean) => {
    if (menuPendingRef.current[item.id]) return false;
    menuPendingRef.current = { ...menuPendingRef.current, [item.id]: true };
    setMenuPending(menuPendingRef.current);
    try {
      const res = await api.setAvailability(item.id, isAvailable);
      const now = typeof res?.isAvailable === 'boolean' ? res.isAvailable : isAvailable;
      setMenu((prev) => prev && prev.map((m) => (m.id === item.id ? { ...m, isAvailable: now } : m)));
      toast.show(`${item.name}: ${now ? 'available' : 'not available'}`, now ? 'success' : 'info');
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        toast.show('That item no longer exists. Refreshing your menu.', 'error');
        void refreshMenu();
      } else if (!(e instanceof ApiError && e.status === 401)) {
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
    };
    if (!editing || input.isAvailable !== editing.isAvailable) body.isAvailable = input.isAvailable;
    if (editing && input.diet !== 'egg' && editing.tags.some(isEggTag)) body.tags = editing.tags.filter((t) => !isEggTag(t));
    let saved: MenuItem;
    if (editing) {
      const res = await api.updateMenuItem(editing.id, body);
      saved = res || {
        ...editing, ...body, category: input.category || 'Other', description: input.description || null,
        tags: body.tags ?? editing.tags, isAvailable: body.isAvailable ?? editing.isAvailable,
      };
    } else {
      // One key per "Add" attempt for the same input: a retry after a timeout reuses it.
      const sig = JSON.stringify(body);
      const key = createKeys.current[sig] || (createKeys.current[sig] = newIdempotencyKey(rid));
      const before = menuRef.current ? new Set(menuRef.current.map((m) => m.id)) : null;
      try {
        saved = await api.createMenuItem(body, key);
      } catch (e) {
        if (!(e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)) || !before) throw e;
        // Timed out / dropped: the item may have been saved anyway. Reload before the stall retries.
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
    return saved;
  }, [rid, toast, upsertLocal]);

  const deleteItem = useCallback(async (item: MenuItem): Promise<DeleteResult> => {
    try {
      await api.deleteMenuItem(item.id);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) return { ok: false, error: errorMessage(e, "Couldn't delete the item. Try again.") };
    }
    setMenu((prev) => prev && prev.filter((m) => m.id !== item.id));
    toast.show(`${item.name} deleted`, 'success');
    return { ok: true };
  }, [toast]);

  const setCategoryStock = useCallback(async (category: string, isAvailable: boolean) => {
    if (categoryPendingRef.current[category]) return false;
    categoryPendingRef.current = { ...categoryPendingRef.current, [category]: true };
    setCategoryPending(categoryPendingRef.current);
    try {
      const res = await api.setCategoryStock(rid, category, isAvailable);
      const changed = new Map((res?.items || []).map((x) => [String(x.id), x]));
      setMenu((prev) => prev && prev.map((m) => {
        const x = changed.get(m.id);
        return x ? { ...m, isAvailable: x.isAvailable } : m;
      }));
      const n = typeof res?.total === 'number' ? res.total : changed.size;
      toast.show(`${category}: ${n} item${n === 1 ? '' : 's'} ${isAvailable ? 'in stock' : 'out of stock'}`, isAvailable ? 'success' : 'info');
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && e.code === 'CATEGORY_NOT_FOUND') {
        toast.show('That category has changed. Refreshing your menu.', 'error');
        void refreshMenu();
      } else if (!(e instanceof ApiError && e.status === 401)) {
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

  const value = useMemo<MenuCtx>(() => ({
    menu, menuError, menuLoading, menuPending, categoryPending, refreshMenu, setStock, setCategoryStock, saveItem, deleteItem,
  }), [menu, menuError, menuLoading, menuPending, categoryPending, refreshMenu, setStock, setCategoryStock, saveItem, deleteItem]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMenu() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMenu outside MenuProvider');
  return v;
}
