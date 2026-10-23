import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';
import { API_URL, SOCKET_URL } from '../constants/api';
import { apiFetch, getToken } from '../utils/auth';
import { socketVersionAuth } from '../utils/forceUpdate';
import { useLiveSync, affectsAny } from '../utils/useLiveSync';
import { useAuth } from './AuthContext';
import { isLocalVendorType, isLocalVendor } from '../utils/localVendor';

export interface Customizations {
  size?: string;
  flavor?: string;
  crust?: string;
  slices?: number;
  spiceLevel?: string;
  sugarLevel?: string;
  temperature?: string;
  toppings?: string[];
  addons?: { name: string; price: number }[];
  specialInstructions?: string;
  cakeMessage?: string;
  eggPreference?: string;
  weight?: string;
  clothesType?: string;
  clothesCount?: string;
  rentalDetails?: string;
  rentalDriverContact?: string;
}

/**
 * Three baskets live side by side, each with its own checkout (one order is still one store):
 * restaurants (the group basket works on this one), the campus store (Others: groceries, toys, seeds,
 * electronics + Mega Basket shopping requests) and local stalls (CampusBites, cash to the stall).
 */
export type BasketKind = 'restaurant' | 'store' | 'stall';
export const BASKET_KINDS: BasketKind[] = ['restaurant', 'store', 'stall'];
export const BASKET_LABELS: Record<BasketKind, string> = { restaurant: 'Restaurants', store: 'Campus store', stall: 'Local stalls' };
export const BASKET_ORDER_TITLES: Record<BasketKind, string> = { restaurant: 'Restaurant order', store: 'Campus store order', stall: 'Local stall order' };
export const isBasketKind = (v: any): v is BasketKind => v === 'restaurant' || v === 'store' || v === 'stall';
/** Mega Basket shopping requests use this pseudo store id. */
export const MEGA_BASKET_VENDOR_ID = 'mega-basket-vendor';
// Shops ordered through the Others section (booking-only services never reach the basket).
const STORE_VENDOR_TYPES = ['GROCERY', 'GROCERIES', 'MART', 'KIRANA', 'TOYS', 'SEEDS', 'ELECTRONICS', 'HOME_ESSENTIALS',
  'STATIONERY', 'STATIONARY', 'PHARMACY', 'MATTRESS', 'MATTRESSES'];

/** The basket a store's items go to, from its vendorType. */
export const basketKindFromVendorType = (vendorType: any): BasketKind => {
  if (isLocalVendorType(vendorType)) return 'stall';
  return STORE_VENDOR_TYPES.includes(String(vendorType || '').toUpperCase()) ? 'store' : 'restaurant';
};

/** The single rule for which basket an item belongs to. */
export function basketKindOf(item: { id?: any; restaurantId?: any; isStall?: boolean; vendorType?: any; basket?: any; fulfilment?: any }): BasketKind {
  if (isBasketKind(item.basket)) return item.basket;
  if (String(item.id || '').startsWith('custom-') || String(item.restaurantId || '') === MEGA_BASKET_VENDOR_ID) return 'store';
  if (item.isStall || String(item.fulfilment || '').toUpperCase() === 'VENDOR') return 'stall';
  return basketKindFromVendorType(item.vendorType);
}

export interface CartItem {
  id: string;
  /** Which of the three baskets the line is in (set from basketKindOf when added). */
  basket: BasketKind;
  /** The store's vendorType when the adding screen knew it. */
  vendorType?: string;
  /** When the line was first added (ms): the Basket tab opens on the most recent basket. */
  addedAt?: number;
  /** Saved by the one-basket build: the store's type is still being looked up. */
  legacyBasket?: boolean;
  cartKey: string;
  name: string;
  price: number;
  basePrice: number;
  quantity: number;
  image: string;
  imageUrl?: string;
  restaurantId: string;
  restaurantName: string;
  /** Checkout add-ons (EXTRAS store): they ride along with the main store's order. */
  isAddOn?: boolean;
  /** CampusBites stall item (vendorType LOCAL_VENDOR): the stall delivers it, cash on delivery to the stall. */
  isStall?: boolean;
  isCake?: boolean;
  customName?: string;
  customizations?: Customizations;
  addedBy?: string;
  addedById?: string;
}

type AddableItem = Omit<CartItem, 'quantity' | 'cartKey' | 'basePrice' | 'addedBy' | 'addedById' | 'basket' | 'legacyBasket'> & {
  /** Force a basket (checkout add-ons ride with the basket being checked out). */
  basket?: BasketKind;
  quantity?: number;
  basePrice?: number;
  addedBy?: string;
  addedById?: string;
};

/** Live state of the roommate group-cart room. */
export type RoomStatus = 'idle' | 'connecting' | 'live' | 'waiting' | 'error';

interface CartContextType {
  /** Every line in all three baskets (back-compat). */
  cart: CartItem[];
  baskets: Record<BasketKind, CartItem[]>;
  basketCounts: Record<BasketKind, number>;
  basketTotals: Record<BasketKind, number>;
  /** The basket the Basket tab / checkout shows. */
  activeBasket: BasketKind;
  setActiveBasket: (kind: BasketKind) => void;
  /** The basket that got the most recent new line (null when all are empty). */
  lastAddedBasket: BasketKind | null;
  lastAddedAt: number;
  /** True once the saved baskets have been read from storage (before that every basket looks empty). */
  cartLoaded: boolean;
  /** Empties one basket only. */
  clearBasket: (kind: BasketKind) => void;
  /** Adds the item to its basket. Returns false when that basket holds another store's items (a "Replace basket?" prompt is shown instead). */
  addToCart: (item: AddableItem) => boolean;
  removeFromCart: (cartKey: string) => void;
  updateQuantity: (cartKey: string, qty: number) => void;
  updateCustomName: (cartKey: string, name: string) => void;
  /** Removes every line whose item id or name matches (used for items the server says are unavailable), in one basket when given. */
  removeItems: (match: { ids?: string[]; names?: string[]; basket?: BasketKind }) => void;
  /** Empties all three baskets. */
  clearCart: () => void;
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  /** Total quantity of one menu item across all its basket lines (customized lines included). */
  quantityOf: (itemId: string) => number;
  /** Items across all three baskets (tab bar badge). */
  totalItems: number;
  /** Sum of all basket line prices (shown as an estimate only — the server quote is the bill). */
  totalPrice: number;
  roomCode: string;
  isHosting: boolean;
  isJoined: boolean;
  roomStatus: RoomStatus;
  roomMessage: string | null;
  handleHostRoom: () => void;
  handleJoinRoom: (code: string) => void;
  handleDisconnect: () => void;
}

/** Stable functions only: their identity never changes, so a component that only adds/removes never re-renders on a basket change. */
export type CartActions = Pick<CartContextType,
  'addToCart' | 'removeFromCart' | 'updateQuantity' | 'updateCustomName' | 'removeItems' | 'clearCart' | 'setCart'
  | 'clearBasket' | 'setActiveBasket' | 'handleHostRoom' | 'handleJoinRoom' | 'handleDisconnect'>;
/** Values that change with the basket / group-cart room. */
export type CartState = Omit<CartContextType, keyof CartActions>;

const CartActionsContext = createContext<CartActions | undefined>(undefined);
const CartStateContext = createContext<CartState | undefined>(undefined);

export const MAX_ITEM_QTY = 20;
// Codes from older builds (4-8 characters) still work; new rooms get 10 characters (server accepts 4-12).
const ROOM_CODE_RE = /^ZN-[A-Z0-9]{4,12}$/;

/** Mega Basket "custom request" lines (free-text items a rider shops for). They are placed via /api/mega-basket, never /api/orders. */
export const isCustomRequest = (item: Pick<CartItem, 'id'>) => String(item.id || '').startsWith('custom-');

/** The store a line belongs to for the one-store-per-order rule (add-ons and custom requests ride along). */
const storeKeyOf = (item: Pick<CartItem, 'id' | 'restaurantId' | 'isAddOn'>): string | null => {
  if (item.isAddOn || isCustomRequest(item)) return null;
  return item.restaurantId ? String(item.restaurantId) : null;
};

function generateCartKey(id: string, customizations?: Customizations): string {
  if (!customizations || Object.keys(customizations).length === 0) return id;
  const sig = JSON.stringify(customizations);
  let hash = 0;
  for (let i = 0; i < sig.length; i++) {
    hash = ((hash << 5) - hash) + sig.charCodeAt(i);
    hash |= 0;
  }
  return `${id}-${hash.toString(36)}`;
}

function areCartsEqual(cartA: CartItem[], cartB: CartItem[]): boolean {
  if (!Array.isArray(cartA) || !Array.isArray(cartB)) return false;
  if (cartA.length !== cartB.length) return false;
  for (let i = 0; i < cartA.length; i++) {
    const a = cartA[i];
    const b = cartB[i];
    if (!a || !b) return false;
    if (a.cartKey !== b.cartKey) return false;
    if (a.quantity !== b.quantity) return false;
    if (a.price !== b.price) return false;
    if (a.name !== b.name) return false;
    if (JSON.stringify(a.customizations) !== JSON.stringify(b.customizations)) return false;
  }
  return true;
}

/** Group basket (restaurants only): lines from other builds that belong to another basket are ignored. */
const sanitizeIncomingCart = (incoming: any): CartItem[] | null => {
  if (!Array.isArray(incoming)) return null;
  return incoming
    .filter((i: any) => i && i.id && i.name && basketKindOf(i) === 'restaurant')
    .map((i: any) => ({
      ...i,
      basket: 'restaurant' as const,
      cartKey: i.cartKey || String(i.id),
      quantity: Math.min(MAX_ITEM_QTY, Math.max(1, parseInt(i.quantity, 10) || 1)),
      price: Number(i.price) || 0,
      basePrice: Number(i.basePrice) || Number(i.price) || 0,
      image: i.image || i.imageUrl || '',
      restaurantName: i.restaurantName || '',
    }));
};

const mergeInto = (prev: CartItem[], line: CartItem): CartItem[] => {
  const existing = prev.find((i) => i.cartKey === line.cartKey);
  if (existing) {
    return prev.map((i) =>
      i.cartKey === line.cartKey
        ? { ...i, quantity: Math.min(MAX_ITEM_QTY, i.quantity + line.quantity) }
        : i
    );
  }
  return [...prev, line];
};

const restaurantLinesOf = (list: CartItem[]) => list.filter((i) => i.basket === 'restaurant');
const emptyBaskets = (): Record<BasketKind, CartItem[]> => ({ restaurant: [], store: [], stall: [] });

/**
 * Saved baskets from the one-basket build carry no basket tag. The old rule kept one store per order,
 * so the whole saved basket goes to that store's basket: stall flag / shopping request / known
 * vendorType decide; plain lines start in Restaurants and are looked up (legacyBasket) after load.
 * Add-ons follow the store they rode with.
 */
export function splitLegacyBasket(lines: any[]): CartItem[] {
  const untagged = lines.filter((l) => !isBasketKind(l.basket));
  const main = untagged.find((l) => !l.isAddOn && !isCustomRequest(l));
  const guess = (l: any): BasketKind => {
    const k = basketKindOf(l);
    if (k === 'restaurant' && /^(campus store|shopping list)$/i.test(String(l.restaurantName || '').trim())) return 'store';
    return k;
  };
  const mainKind: BasketKind = main ? guess(main) : 'restaurant';
  const mainUnknown = !!main && mainKind === 'restaurant' && !main.vendorType;
  return lines
    .map((l) => {
      if (isBasketKind(l.basket)) return l as CartItem;
      if (l.isAddOn) {
        if (mainKind === 'stall') return null; // stall orders take no add-ons
        return { ...l, basket: mainKind, ...(mainUnknown ? { legacyBasket: true } : {}) } as CartItem;
      }
      const kind = guess(l);
      const unknown = kind === 'restaurant' && !l.vendorType && !isCustomRequest(l);
      return { ...l, basket: kind, ...(unknown ? { legacyBasket: true } : {}) } as CartItem;
    })
    .filter(Boolean) as CartItem[];
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [cart, setCartState] = useState<CartItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeBasket, setActiveBasketState] = useState<BasketKind>('restaurant');
  const activeBasketRef = useRef<BasketKind>('restaurant');
  const setActiveBasket = useCallback((kind: BasketKind) => {
    if (!isBasketKind(kind)) return;
    activeBasketRef.current = kind;
    setActiveBasketState(kind);
  }, []);

  // Always-current copy of the basket, so several quick adds in one tick see each other.
  const cartRef = useRef<CartItem[]>([]);
  const setCart: React.Dispatch<React.SetStateAction<CartItem[]>> = useCallback((action) => {
    setCartState((prev) => {
      const next = typeof action === 'function' ? (action as (p: CartItem[]) => CartItem[])(prev) : action;
      cartRef.current = next;
      return next;
    });
  }, []);

  // Collab Sync state
  const [roomCode, setRoomCode] = useState('');
  const [isHosting, setIsHosting] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [roomStatus, setRoomStatus] = useState<RoomStatus>('idle');
  const [roomMessage, setRoomMessage] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const isIncomingUpdateRef = useRef(false);
  const incomingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedCartRef = useRef<CartItem[]>([]);

  // "Replace basket?" prompt: items waiting for the user's answer
  const pendingItemsRef = useRef<CartItem[]>([]);
  const promptOpenRef = useRef(false);
  const promptKindRef = useRef<BasketKind | null>(null);

  const userName = user?.name || 'Guest';
  const userId = String((user as any)?._id || (user as any)?.id || 'guest');
  // The stable actions read the signed-in name/id from refs (never a stale closure).
  const userNameRef = useRef(userName);
  userNameRef.current = userName;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  // Sync local changes to Room (the group basket is the restaurant basket only)
  useEffect(() => {
    if (roomCode && socketRef.current) {
      const shared = restaurantLinesOf(cart);
      if (!isIncomingUpdateRef.current && !areCartsEqual(shared, lastSyncedCartRef.current)) {
        lastSyncedCartRef.current = shared;
        socketRef.current.emit('cart_change', { roomCode, cart: shared });
      }
    }
  }, [cart, roomCode]);

  useEffect(() => {
    return () => {
      if (incomingTimerRef.current) clearTimeout(incomingTimerRef.current);
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  const initializeSocket = useCallback(async (code: string, role: 'host' | 'join') => {
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setRoomStatus('connecting');
    setRoomMessage(null);
    try {
      const token = await getToken();
      const socket = io(SOCKET_URL, {
        withCredentials: true,
        transports: ['websocket', 'polling'],
        auth: token ? { token, ...socketVersionAuth() } : { ...socketVersionAuth() },
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('joinRoom', code, (ack: any) => {
          if (socketRef.current !== socket) return;
          if (ack && ack.ok === false) {
            setRoomStatus('error');
            setRoomMessage(ack.message || "Couldn't connect to this basket. Check the code and try again.");
            return;
          }
          if (role === 'join' && ack && ack.exists === false) {
            setRoomStatus('waiting');
            setRoomMessage('No live basket with this code yet. Ask your roommate to open their basket, or check the code.');
            return;
          }
          // The host opened a fresh room: share the basket they already have, so a roommate who
          // joins sees it straight away (the server only replays the last cart_change it received).
          if (role === 'host' && ack && ack.exists === false && !isIncomingUpdateRef.current) {
            const shared = restaurantLinesOf(cartRef.current);
            lastSyncedCartRef.current = shared;
            socket.emit('cart_change', { roomCode: code, cart: shared });
          }
          setRoomStatus('live');
          setRoomMessage(null);
        });
      });

      socket.on('connect_error', () => {
        if (socketRef.current !== socket) return;
        setRoomStatus('error');
        setRoomMessage("Can't reach the shared basket right now. We'll keep trying.");
      });

      socket.on('cart_updated', (incoming: any) => {
        const incomingCart = sanitizeIncomingCart(incoming);
        if (!incomingCart) return;
        setRoomStatus('live');
        setRoomMessage(null);
        if (!areCartsEqual(restaurantLinesOf(cartRef.current), incomingCart)) {
          lastSyncedCartRef.current = incomingCart;
          isIncomingUpdateRef.current = true;
          // Only the restaurant basket is shared: the campus store and stall baskets stay as they are.
          setCart((prev) => [...prev.filter((i) => i.basket !== 'restaurant'), ...incomingCart]);
          if (incomingTimerRef.current) clearTimeout(incomingTimerRef.current);
          incomingTimerRef.current = setTimeout(() => {
            isIncomingUpdateRef.current = false;
          }, 100);
        }
      });
    } catch (err) {
      console.warn('[COLLAB_CART_SOCKET_ERROR]', err);
      setRoomStatus('error');
      setRoomMessage("Couldn't open the shared basket. Please try again.");
    }
  }, [setCart]);

  const handleHostRoom = useCallback(async () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'ZN-';
    // 10 characters (~1e15 codes) so live baskets can't be found by guessing codes (the server also
    // rate-limits joins).
    for (let i = 0; i < 10; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setRoomCode(code);
    setIsHosting(true);
    setIsJoined(false);
    try { await AsyncStorage.setItem('zenvy_collab_session', JSON.stringify({ code, role: 'host' })); } catch {}
    initializeSocket(code, 'host');
  }, [initializeSocket]);

  const handleJoinRoom = useCallback(async (inputCode: string) => {
    if (!inputCode) return;
    let formatted = inputCode.trim().toUpperCase().replace(/\s+/g, '');
    if (!formatted.startsWith('ZN-')) formatted = `ZN-${formatted.replace(/^ZN/, '')}`;
    if (!ROOM_CODE_RE.test(formatted)) {
      Alert.alert('Check the code', 'Room codes look like ZN-8B2A4KQ7XM. Please check with your roommate and try again.');
      return;
    }
    setRoomCode(formatted);
    setIsJoined(true);
    setIsHosting(false);
    try { await AsyncStorage.setItem('zenvy_collab_session', JSON.stringify({ code: formatted, role: 'join' })); } catch {}
    initializeSocket(formatted, 'join');
  }, [initializeSocket]);

  const handleDisconnect = useCallback(async () => {
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setRoomCode('');
    setIsHosting(false);
    setIsJoined(false);
    setRoomStatus('idle');
    setRoomMessage(null);
    lastSyncedCartRef.current = [];
    try { await AsyncStorage.removeItem('zenvy_collab_session'); } catch {}
  }, []);

  // A basket saved by the one-basket build: its store's type decides which basket it moves to.
  // Lines with no type on them stay in Restaurants until /api/users/restaurants/:id answers.
  const resolveLegacyStores = useCallback(async (lines: CartItem[]) => {
    const ids = [...new Set(lines.filter((l) => l.legacyBasket && !l.isAddOn && !isCustomRequest(l)).map((l) => String(l.restaurantId)).filter(Boolean))];
    for (const storeId of ids) {
      let kind: BasketKind | null = null;
      try {
        const res = await apiFetch(`/api/users/restaurants/${encodeURIComponent(storeId)}`);
        if (res.ok) {
          const data = await res.json().catch(() => null);
          kind = data ? (isLocalVendor(data) ? 'stall' : basketKindFromVendorType(data.vendorType)) : 'restaurant';
        } else if (res.status === 404) {
          kind = 'restaurant';
        }
      } catch {
        kind = null; // offline: try again on the next start
      }
      if (!kind) continue;
      const target = kind;
      setCart((prev) => {
        const owned = new Set(prev.filter((l) => l.legacyBasket && (String(l.restaurantId) === storeId || l.isAddOn)).map((l) => l.cartKey));
        if (owned.size === 0) return prev;
        // The target basket already has another store: leave these lines where they are.
        const busy = target !== 'restaurant' && prev.some((l) => l.basket === target && !l.legacyBasket
          && storeKeyOf(l) !== null && storeKeyOf(l) !== storeId);
        const move = target !== 'restaurant' && !busy;
        const next: CartItem[] = [];
        prev.forEach((l) => {
          if (!owned.has(l.cartKey)) { next.push(l); return; }
          const { legacyBasket: _legacy, ...rest } = l;
          if (!move) { next.push(rest); return; }
          if (l.isAddOn && target === 'stall') return; // stall orders take no add-ons
          next.push({ ...rest, basket: target, vendorType: rest.vendorType });
        });
        return next;
      });
    }
  }, [setCart]);

  // Load cart and collab state on start
  useEffect(() => {
    const loadState = async () => {
      try {
        const saved = await AsyncStorage.getItem('zenvy_cart');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            const normalized = parsed
              .filter((item: any) => item && item.id)
              .map((item: any) => ({
                ...item,
                cartKey: item.cartKey || item.id,
                basePrice: item.basePrice || item.price,
                quantity: Math.min(MAX_ITEM_QTY, Math.max(1, parseInt(item.quantity, 10) || 1)),
                image: item.image || item.imageUrl || '',
                restaurantName: item.restaurantName || '',
                // Old installs added checkout extras as `extra-<id>` lines
                isAddOn: item.isAddOn || String(item.id).startsWith('extra-'),
              }));
            // One-basket installs: split the saved basket into the three baskets.
            const migrated = splitLegacyBasket(normalized);
            // Items added before storage finished loading (deep link, fast tap) are kept: in each
            // basket they win over the saved lines when they are from another store (one store per order).
            setCart((prev) => {
              if (prev.length === 0) return migrated;
              let next: CartItem[] = [];
              for (const kind of BASKET_KINDS) {
                const p = prev.filter((l) => l.basket === kind);
                const m = migrated.filter((l) => l.basket === kind);
                const prevStores = new Set(p.map(storeKeyOf).filter(Boolean));
                const savedStores = new Set(m.map(storeKeyOf).filter(Boolean));
                const clash = [...savedStores].some((k) => prevStores.size > 0 && !prevStores.has(k));
                next = next.concat(clash ? p : p.reduce((acc, l) => mergeInto(acc, l), m));
              }
              return next;
            });
            resolveLegacyStores(migrated);
          }
        }

        const savedCollab = await AsyncStorage.getItem('zenvy_collab_session');
        if (savedCollab) {
          const { code, role } = JSON.parse(savedCollab);
          if (code && ROOM_CODE_RE.test(code)) {
            setRoomCode(code);
            if (role === 'host') {
              setIsHosting(true);
            } else {
              setIsJoined(true);
            }
            initializeSocket(code, role === 'host' ? 'host' : 'join');
          }
        }
      } catch (e) {
        console.warn('[CART] failed to load async storage', e);
      } finally {
        setIsLoaded(true);
      }
    };
    loadState();
  }, [initializeSocket, setCart, resolveLegacyStores]);

  // Save cart changes
  useEffect(() => {
    if (isLoaded) {
      AsyncStorage.setItem('zenvy_cart', JSON.stringify(cart)).catch(() => {});
    }
  }, [cart, isLoaded]);

  const addToCart = useCallback((item: AddableItem): boolean => {
    const id = String(item.id);
    // Add-ons ride with the basket being checked out (never a stall order); everything else follows basketKindOf.
    const kind: BasketKind = item.basket && isBasketKind(item.basket)
      ? item.basket
      : item.isAddOn
        ? (activeBasketRef.current === 'stall' ? 'restaurant' : activeBasketRef.current)
        : basketKindOf(item);
    const baseKey = generateCartKey(id, item.customizations);
    // Add-on keys are per basket, so the same extra can ride with two baskets.
    const cartKey = item.isAddOn && kind !== 'restaurant' ? `${kind}:${baseKey}` : baseKey;
    const basePrice = item.basePrice || item.price;

    const line: CartItem = {
      ...item,
      id,
      basket: kind,
      cartKey,
      basePrice,
      quantity: Math.min(MAX_ITEM_QTY, Math.max(1, item.quantity || 1)),
      image: item.image || item.imageUrl || '',
      restaurantName: item.restaurantName || '',
      addedBy: item.addedBy || userNameRef.current,
      addedById: item.addedById || userIdRef.current,
      addedAt: Date.now(),
    };

    const current = cartRef.current;
    const existingLine = current.find((i) => i.cartKey === cartKey);
    if (existingLine && existingLine.quantity >= MAX_ITEM_QTY) {
      Alert.alert('That’s the limit', `You can order up to ${MAX_ITEM_QTY} of one item per order.`);
      return false;
    }
    // Only lines in the same basket take part in the one-store rule.
    const same = current.filter((i) => i.basket === kind);

    // CampusBites stall orders are paid in cash to the stall: no checkout add-ons ride along (ADDONS_NOT_FOR_STALL).
    if (line.isAddOn && kind === 'stall') {
      const stallName = same.find((i) => i.isStall)?.restaurantName || 'the stall';
      Alert.alert('Not for stall orders', `Add-ons can't be added to an order from ${stallName}. You pay the stall in cash for just their items.`);
      return false;
    }

    // One store per order, inside this basket only (Swiggy-style "Replace basket?")
    const newStore = storeKeyOf(line);
    const otherStoreLine = newStore
      ? same.find((i) => {
          const k = storeKeyOf(i);
          return k !== null && k !== newStore;
        })
      : undefined;

    if (otherStoreLine) {
      // A prompt for another basket is already open: ignore this tap rather than mixing the two.
      if (promptOpenRef.current && promptKindRef.current !== kind) return false;
      pendingItemsRef.current = [...pendingItemsRef.current, line];
      if (!promptOpenRef.current) {
        promptOpenRef.current = true;
        promptKindRef.current = kind;
        const fromName = otherStoreLine.restaurantName || 'another store';
        const toName = line.restaurantName || 'this store';
        const finish = () => {
          promptOpenRef.current = false;
          promptKindRef.current = null;
          pendingItemsRef.current = [];
        };
        Alert.alert(
          'Replace basket?',
          `Your ${BASKET_LABELS[kind]} basket has items from ${fromName}. Each order comes from one place — start a fresh basket with ${toName}?`,
          [
            { text: 'No', style: 'cancel', onPress: finish },
            {
              text: 'Replace',
              style: 'destructive',
              onPress: () => {
                const pending = pendingItemsRef.current;
                finish();
                // A store order and a Mega Basket shopping request are placed separately,
                // so a fresh store basket drops custom requests and the old store's add-ons.
                // The other two baskets are never touched.
                setCart((prev) => {
                  const inKind = prev.filter((i) => i.basket === kind);
                  const keep = pending.every(isCustomRequest) ? inKind.filter(isCustomRequest) : [];
                  return [...prev.filter((i) => i.basket !== kind), ...pending.reduce((acc, l) => mergeInto(acc, l), keep)];
                });
              },
            },
          ],
          { cancelable: true, onDismiss: finish }
        );
      }
      return false;
    }

    // Update the ref now so another add in the same tick sees this line, then queue the real update.
    cartRef.current = mergeInto(current, line);
    setCart((prev) => mergeInto(prev, line));
    return true;
  }, [setCart]);

  const removeFromCart = useCallback((cartKey: string) => {
    setCart((prev) => prev.filter((i) => i.cartKey !== cartKey));
  }, [setCart]);

  const updateQuantity = useCallback((cartKey: string, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((i) => i.cartKey !== cartKey));
      return;
    }
    if (qty > MAX_ITEM_QTY) {
      Alert.alert('That’s the limit', `You can order up to ${MAX_ITEM_QTY} of one item per order.`);
      qty = MAX_ITEM_QTY;
    }
    setCart((prev) => prev.map((i) => (i.cartKey === cartKey ? { ...i, quantity: qty } : i)));
  }, [setCart]);

  const updateCustomName = useCallback((cartKey: string, name: string) => {
    setCart((prev) => prev.map((i) =>
      i.cartKey === cartKey ? { ...i, customName: name, customizations: { ...i.customizations, cakeMessage: name } } : i
    ));
  }, [setCart]);

  const removeItems = useCallback(({ ids = [], names = [], basket }: { ids?: string[]; names?: string[]; basket?: BasketKind }) => {
    const idSet = new Set(ids.filter(Boolean).map(String));
    const nameSet = new Set(names.filter(Boolean).map((n) => String(n).trim().toLowerCase()));
    setCart((prev) => prev.filter((i) => (!!basket && i.basket !== basket)
      || (!idSet.has(String(i.id)) && !nameSet.has(String(i.name).trim().toLowerCase()))));
  }, [setCart]);

  const clearCart = useCallback(() => setCart([]), [setCart]);
  const clearBasket = useCallback((kind: BasketKind) => setCart((prev) => prev.filter((i) => i.basket !== kind)), [setCart]);

  // Logout or account switch: the basket and group-cart session belong to the previous account.
  // A guest who signs in keeps the basket they built.
  const prevUserIdRef = useRef(userId);
  useEffect(() => {
    const prev = prevUserIdRef.current;
    prevUserIdRef.current = userId;
    if (prev !== 'guest' && prev !== userId) {
      clearCart();
      handleDisconnect();
      AsyncStorage.multiRemove(['zenvy_cart', 'zenvy_collab_session']).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const quantityOf = useCallback((itemId: string) =>
    cart.reduce((acc, i) => (String(i.id) === String(itemId) ? acc + i.quantity : acc), 0), [cart]);

  const totalItems = useMemo(() => cart.reduce((acc, item) => acc + item.quantity, 0), [cart]);
  const totalPrice = useMemo(
    () => Math.round(cart.reduce((acc, item) => acc + item.price * item.quantity, 0) * 100) / 100,
    [cart]
  );

  const { baskets, basketCounts, basketTotals, lastAddedBasket, lastAddedAt } = useMemo(() => {
    const b = emptyBaskets();
    cart.forEach((l) => { b[isBasketKind(l.basket) ? l.basket : basketKindOf(l)].push(l); });
    const counts: Record<BasketKind, number> = { restaurant: 0, store: 0, stall: 0 };
    const totals: Record<BasketKind, number> = { restaurant: 0, store: 0, stall: 0 };
    let last: BasketKind | null = null;
    let lastAt = -1;
    for (const kind of BASKET_KINDS) {
      counts[kind] = b[kind].reduce((acc, l) => acc + l.quantity, 0);
      totals[kind] = Math.round(b[kind].reduce((acc, l) => acc + l.price * l.quantity, 0) * 100) / 100;
      b[kind].forEach((l) => {
        const at = Number(l.addedAt) || 0;
        if (at > lastAt) { lastAt = at; last = kind; }
      });
    }
    return { baskets: b, basketCounts: counts, basketTotals: totals, lastAddedBasket: last as BasketKind | null, lastAddedAt: Math.max(0, lastAt) };
  }, [cart]);

  const actions = useMemo<CartActions>(() => ({
    addToCart, removeFromCart, updateQuantity, updateCustomName, removeItems, clearCart, setCart,
    clearBasket, setActiveBasket, handleHostRoom, handleJoinRoom, handleDisconnect,
  }), [addToCart, removeFromCart, updateQuantity, updateCustomName, removeItems, clearCart, setCart,
    clearBasket, setActiveBasket, handleHostRoom, handleJoinRoom, handleDisconnect]);

  const state = useMemo<CartState>(() => ({
    cart, quantityOf, totalItems, totalPrice,
    baskets, basketCounts, basketTotals, activeBasket, lastAddedBasket, lastAddedAt, cartLoaded: isLoaded,
    roomCode, isHosting, isJoined, roomStatus, roomMessage,
  }), [cart, quantityOf, totalItems, totalPrice, baskets, basketCounts, basketTotals, activeBasket, lastAddedBasket, lastAddedAt, isLoaded,
    roomCode, isHosting, isJoined, roomStatus, roomMessage]);

  return (
    <CartActionsContext.Provider value={actions}>
      <CartStateContext.Provider value={state}>
        {children}
      </CartStateContext.Provider>
    </CartActionsContext.Provider>
  );
}

/** Basket actions only (stable identities): a component using just this never re-renders when the basket changes. */
export const useCartActions = (): CartActions => {
  const context = useContext(CartActionsContext);
  if (!context) throw new Error('useCartActions must be used within CartProvider');
  return context;
};

/** Basket contents, totals and group-cart room state (re-renders on every basket change). */
export const useCartState = (): CartState => {
  const context = useContext(CartStateContext);
  if (!context) throw new Error('useCartState must be used within CartProvider');
  return context;
};

/** Everything (state + actions). Re-renders on every basket change; prefer useCartActions where it is enough. */
export const useCart = (): CartContextType => {
  const actions = useCartActions();
  const state = useCartState();
  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
};

// ── Server pricing (POST /api/orders/quote) ─────────────────────────────────

export interface QuoteLine {
  menuItemId: string;
  name: string;
  quantity: number;
  basePrice: number;
  addOnPrice: number;
  unitPrice: number;
  lineTotal: number;
  isAddOn: boolean;
  customizations: any;
  image?: string;
}

export interface OrderQuote {
  currency: string;
  store: { id: string; name: string; vendorType: string; isOffline: boolean; zone?: string; location?: string; whatsappNumber?: string | null; minOrderValue?: number; fssaiLicenseNumber?: string | null };
  /** 'VENDOR' = a CampusBites stall delivers it (cash to the stall, no rider, no PIN). */
  fulfilment?: 'VENDOR' | 'ZENVY';
  lines: QuoteLine[];
  subtotal: number;
  deliveryFee: number;
  packagingFee: number;
  taxes: number;
  discounts: { type: string; label: string; amount: number }[];
  totalDiscount: number;
  finalPrice: number;
  coupon: { code: string; type: string; discount: number } | null;
  serviceability?: { open: boolean; reopensAt?: string; message?: string };
  paymentMethods?: string[];
  walletBalance?: number;
  canPayWithWallet?: boolean;
}

export interface QuoteError {
  message: string;
  code?: string;
  body?: any;
  network?: boolean;
}

/** The order line the server prices (it never trusts client prices). */
export const toOrderLine = (i: CartItem) => ({
  menuItemId: i.id,
  quantity: i.quantity,
  name: i.name,
  ...(i.customizations && Object.keys(i.customizations).length > 0 ? { customizations: i.customizations } : {}),
});

export const friendlyNetworkMessage = "We couldn't reach Zenvy. Check your internet and try again.";

/**
 * Live bill for one basket (default: the active one) from POST /api/orders/quote. Custom Mega Basket requests are not part of it.
 * `enabled` should be false for guests (the quote needs a signed-in customer).
 */
export function useBasketQuote(couponCode: string | null | undefined, enabled: boolean, active: boolean = true, basket?: BasketKind) {
  const { baskets, activeBasket } = useCartState();
  const kind: BasketKind = basket || activeBasket;
  const cart = baskets[kind];
  const orderLines = useMemo(() => cart.filter((i) => !isCustomRequest(i)), [cart]);
  const signature = useMemo(
    () => JSON.stringify(orderLines.map((l) => [l.id, l.quantity, l.customizations || null])),
    [orderLines]
  );

  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<QuoteError | null>(null);
  // Which basket the quote / error above belongs to: switching baskets must never show the other
  // basket's bill (or its error) while the new quote is on its way.
  const [resultKind, setResultKind] = useState<BasketKind | null>(null);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  // Live-sync refreshes run silently: the current bill stays on screen (no "Calculating…" flash)
  const silentRef = useRef(false);
  const lastQuoteSigRef = useRef<string | null>(null);

  // Live sync: an admin / store edit to a basket item's price or stock, or its store's status,
  // re-quotes the bill so the customer never checks out against a stale price.
  const linesRef = useRef(orderLines);
  linesRef.current = orderLines;
  useLiveSync({
    types: ['store', 'product'],
    enabled: enabled && active && orderLines.length > 0,
    onChange: (events) => {
      const lines = linesRef.current;
      if (!lines.length) return;
      if (affectsAny(events, lines.map((l) => l.id), lines.map((l) => l.restaurantId).filter(Boolean))) {
        silentRef.current = true;
        setNonce((n) => n + 1);
      }
    },
  });

  useEffect(() => {
    if (!enabled || orderLines.length === 0) {
      setQuote(null);
      setError(null);
      setResultKind(null);
      setLoading(false);
      return;
    }
    // Screen in the background (e.g. the Basket tab under Checkout): keep the last bill, ask again on return.
    if (!active) return;
    let cancelled = false;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    // A silent (live-sync) re-quote only keeps the old bill on screen when the basket and coupon are
    // unchanged; if they changed in the same render, the old bill no longer matches and must not be placeable.
    const requestSig = `${kind}|${signature}|${couponCode || ''}`;
    const silent = silentRef.current && lastQuoteSigRef.current === requestSig;
    silentRef.current = false;
    lastQuoteSigRef.current = requestSig;
    if (!silent) setLoading(true);
    // The quote has its own abort signal, so apiFetch's default timeout does not apply: add one here
    // (a Render cold start must end in "try again", not an endless "Calculating your bill…").
    let timedOut = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(async () => {
      timeoutTimer = setTimeout(() => { timedOut = true; try { controller?.abort(); } catch {} }, 30000);
      try {
        const res = await apiFetch('/api/orders/quote', {
          method: 'POST',
          body: JSON.stringify({ items: orderLines.map(toOrderLine), ...(couponCode ? { couponCode } : {}) }),
          ...(controller ? { signal: controller.signal } : {}),
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        setResultKind(kind);
        if (res.ok && data && typeof data.finalPrice === 'number') {
          setQuote(data);
          setError(null);
        } else {
          setQuote(null);
          setError({
            message: (data && typeof data.message === 'string' && data.message) || 'We could not calculate your bill right now. Please try again.',
            code: data?.code,
            body: data,
          });
        }
      } catch (e: any) {
        if (cancelled || (e?.name === 'AbortError' && !timedOut)) return;
        if (silent) return; // background re-quote hit a network blip: keep the bill we have
        setResultKind(kind);
        setQuote(null);
        setError({ message: friendlyNetworkMessage, network: true });
      } finally {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      try { controller?.abort(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, couponCode, enabled, nonce, active, kind]);

  // Only this basket's result counts; until it arrives the caller sees "loading" (a skeleton), not the
  // last basket's bill.
  const fresh = resultKind === kind;
  const waitingForThisBasket = !fresh && enabled && orderLines.length > 0;
  return {
    quote: fresh ? quote : null,
    loading: loading || waitingForThisBasket,
    error: fresh ? error : null,
    refresh,
    hasOrderLines: orderLines.length > 0,
  };
}

/** GET /api/orders/serviceability — is campus ordering open right now? */
export function useServiceability() {
  const [state, setState] = useState<{ open: boolean; reopensAt?: string; message?: string; storeAcceptTimeoutMin?: number } | null>(null);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/api/orders/serviceability`);
        const data = await res.json().catch(() => null);
        if (!cancelled && res.ok && data && typeof data.open === 'boolean') setState(data);
      } catch {
        // Unknown is fine: the quote / order call reports closing hours too.
      }
    })();
    return () => { cancelled = true; };
  }, [nonce]);

  return { serviceability: state, refresh };
}

// ── Delivery notes (chosen on the Basket tab, sent with the order's delivery address) ──

export const DELIVERY_INSTRUCTIONS_KEY = 'zenvy_delivery_instruction';

export const DELIVERY_INSTRUCTIONS: { id: string; label: string; note: string }[] = [
  { id: 'no_cutlery', label: '🌱 No Plastic Cutlery', note: 'No plastic cutlery' },
  { id: 'call_arrival', label: '📞 Call Upon Arrival', note: 'Call on arrival' },
  { id: 'guard_desk', label: '🛡️ Leave at Hostel Guard', note: 'Leave at the hostel guard desk' },
  { id: 'quiet_knock', label: '🚪 Knock Gently', note: 'Knock gently' },
];

/** A fresh Idempotency-Key for one checkout attempt (RFC 4122 v4 layout). */
export const newIdempotencyKey = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
