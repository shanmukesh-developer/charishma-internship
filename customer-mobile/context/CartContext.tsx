import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';
import { API_URL, SOCKET_URL } from '../constants/api';
import { apiFetch, getToken } from '../utils/auth';
import { socketVersionAuth } from '../utils/forceUpdate';
import { useLiveSync, affectsAny } from '../utils/useLiveSync';
import { useAuth } from './AuthContext';

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

export interface CartItem {
  id: string;
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

type AddableItem = Omit<CartItem, 'quantity' | 'cartKey' | 'basePrice' | 'addedBy' | 'addedById'> & {
  quantity?: number;
  basePrice?: number;
  addedBy?: string;
  addedById?: string;
};

/** Live state of the roommate group-cart room. */
export type RoomStatus = 'idle' | 'connecting' | 'live' | 'waiting' | 'error';

interface CartContextType {
  cart: CartItem[];
  /** Adds the item. Returns false when the basket holds another store's items (a "Replace basket?" prompt is shown instead). */
  addToCart: (item: AddableItem) => boolean;
  removeFromCart: (cartKey: string) => void;
  updateQuantity: (cartKey: string, qty: number) => void;
  updateCustomName: (cartKey: string, name: string) => void;
  /** Removes every line whose item id or name matches (used for items the server says are unavailable). */
  removeItems: (match: { ids?: string[]; names?: string[] }) => void;
  clearCart: () => void;
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  /** Total quantity of one menu item across all its basket lines (customized lines included). */
  quantityOf: (itemId: string) => number;
  totalItems: number;
  /** Sum of the basket line prices (shown as an estimate only — the server quote is the bill). */
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
  | 'handleHostRoom' | 'handleJoinRoom' | 'handleDisconnect'>;
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

const sanitizeIncomingCart = (incoming: any): CartItem[] | null => {
  if (!Array.isArray(incoming)) return null;
  return incoming
    .filter((i: any) => i && i.id && i.name)
    .map((i: any) => ({
      ...i,
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

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [cart, setCartState] = useState<CartItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

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

  const userName = user?.name || 'Guest';
  const userId = String((user as any)?._id || (user as any)?.id || 'guest');
  // The stable actions read the signed-in name/id from refs (never a stale closure).
  const userNameRef = useRef(userName);
  userNameRef.current = userName;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  // Sync local changes to Room
  useEffect(() => {
    if (roomCode && socketRef.current) {
      if (!isIncomingUpdateRef.current && !areCartsEqual(cart, lastSyncedCartRef.current)) {
        lastSyncedCartRef.current = cart;
        socketRef.current.emit('cart_change', { roomCode, cart });
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
            lastSyncedCartRef.current = cartRef.current;
            socket.emit('cart_change', { roomCode: code, cart: cartRef.current });
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
        if (!areCartsEqual(cartRef.current, incomingCart)) {
          lastSyncedCartRef.current = incomingCart;
          isIncomingUpdateRef.current = true;
          setCart(incomingCart);
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

  // Load cart and collab state on start
  useEffect(() => {
    const loadState = async () => {
      try {
        const saved = await AsyncStorage.getItem('zenvy_cart');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            const migrated = parsed
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
            // Items added before storage finished loading (deep link, fast tap) are kept: they win
            // over the saved basket when they are from another store (one store per order).
            setCart((prev) => {
              if (prev.length === 0) return migrated;
              const prevStores = new Set(prev.map(storeKeyOf).filter(Boolean));
              const savedStores = new Set(migrated.map(storeKeyOf).filter(Boolean));
              const clash = [...savedStores].some((k) => prevStores.size > 0 && !prevStores.has(k));
              if (clash) return prev;
              return prev.reduce((acc, l) => mergeInto(acc, l), migrated as CartItem[]);
            });
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
  }, [initializeSocket, setCart]);

  // Save cart changes
  useEffect(() => {
    if (isLoaded) {
      AsyncStorage.setItem('zenvy_cart', JSON.stringify(cart)).catch(() => {});
    }
  }, [cart, isLoaded]);

  const addToCart = useCallback((item: AddableItem): boolean => {
    const id = String(item.id);
    const cartKey = generateCartKey(id, item.customizations);
    const basePrice = item.basePrice || item.price;

    const line: CartItem = {
      ...item,
      id,
      cartKey,
      basePrice,
      quantity: Math.min(MAX_ITEM_QTY, Math.max(1, item.quantity || 1)),
      image: item.image || item.imageUrl || '',
      restaurantName: item.restaurantName || '',
      addedBy: item.addedBy || userNameRef.current,
      addedById: item.addedById || userIdRef.current,
    };

    const current = cartRef.current;
    const existingLine = current.find((i) => i.cartKey === cartKey);
    if (existingLine && existingLine.quantity >= MAX_ITEM_QTY) {
      Alert.alert('That’s the limit', `You can order up to ${MAX_ITEM_QTY} of one item per order.`);
      return false;
    }

    // CampusBites stall orders are paid in cash to the stall: no checkout add-ons ride along (ADDONS_NOT_FOR_STALL).
    if (line.isAddOn && current.some((i) => i.isStall && !isCustomRequest(i))) {
      const stallName = current.find((i) => i.isStall)?.restaurantName || 'the stall';
      Alert.alert('Not for stall orders', `Add-ons can't be added to an order from ${stallName}. You pay the stall in cash for just their items.`);
      return false;
    }

    // One store per order (Swiggy-style "Replace basket?")
    const newStore = storeKeyOf(line);
    const otherStoreLine = newStore
      ? current.find((i) => {
          const k = storeKeyOf(i);
          return k !== null && k !== newStore;
        })
      : undefined;

    if (otherStoreLine) {
      pendingItemsRef.current = [...pendingItemsRef.current, line];
      if (!promptOpenRef.current) {
        promptOpenRef.current = true;
        const fromName = otherStoreLine.restaurantName || 'another store';
        const toName = line.restaurantName || 'this store';
        const finish = () => {
          promptOpenRef.current = false;
          pendingItemsRef.current = [];
        };
        Alert.alert(
          'Replace basket?',
          `Your basket has items from ${fromName}. Each order comes from one place — start a fresh basket with ${toName}?`,
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
                const keep = pending.every(isCustomRequest) ? cartRef.current.filter(isCustomRequest) : [];
                setCart(pending.reduce((acc, l) => mergeInto(acc, l), keep));
              },
            },
          ],
          { cancelable: true, onDismiss: finish }
        );
      }
      return false;
    }

    // A stall item drops any leftover checkout add-ons (stall orders take none).
    const withoutStallAddOns = (list: CartItem[]) => (line.isStall ? list.filter((i) => !i.isAddOn) : list);
    // Update the ref now so another add in the same tick sees this line, then queue the real update.
    cartRef.current = mergeInto(withoutStallAddOns(current), line);
    setCart((prev) => mergeInto(withoutStallAddOns(prev), line));
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

  const removeItems = useCallback(({ ids = [], names = [] }: { ids?: string[]; names?: string[] }) => {
    const idSet = new Set(ids.filter(Boolean).map(String));
    const nameSet = new Set(names.filter(Boolean).map((n) => String(n).trim().toLowerCase()));
    setCart((prev) => prev.filter((i) => !idSet.has(String(i.id)) && !nameSet.has(String(i.name).trim().toLowerCase())));
  }, [setCart]);

  const clearCart = useCallback(() => setCart([]), [setCart]);

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

  const actions = useMemo<CartActions>(() => ({
    addToCart, removeFromCart, updateQuantity, updateCustomName, removeItems, clearCart, setCart,
    handleHostRoom, handleJoinRoom, handleDisconnect,
  }), [addToCart, removeFromCart, updateQuantity, updateCustomName, removeItems, clearCart, setCart,
    handleHostRoom, handleJoinRoom, handleDisconnect]);

  const state = useMemo<CartState>(() => ({
    cart, quantityOf, totalItems, totalPrice,
    roomCode, isHosting, isJoined, roomStatus, roomMessage,
  }), [cart, quantityOf, totalItems, totalPrice, roomCode, isHosting, isJoined, roomStatus, roomMessage]);

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
 * Live bill for the basket from POST /api/orders/quote. Custom Mega Basket requests are not part of it.
 * `enabled` should be false for guests (the quote needs a signed-in customer).
 */
export function useBasketQuote(couponCode: string | null | undefined, enabled: boolean, active: boolean = true) {
  const { cart } = useCart();
  const orderLines = useMemo(() => cart.filter((i) => !isCustomRequest(i)), [cart]);
  const signature = useMemo(
    () => JSON.stringify(orderLines.map((l) => [l.id, l.quantity, l.customizations || null])),
    [orderLines]
  );

  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<QuoteError | null>(null);
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
      setLoading(false);
      return;
    }
    // Screen in the background (e.g. the Basket tab under Checkout): keep the last bill, ask again on return.
    if (!active) return;
    let cancelled = false;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    // A silent (live-sync) re-quote only keeps the old bill on screen when the basket and coupon are
    // unchanged; if they changed in the same render, the old bill no longer matches and must not be placeable.
    const requestSig = `${signature}|${couponCode || ''}`;
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
  }, [signature, couponCode, enabled, nonce, active]);

  return { quote, loading, error, refresh, hasOrderLines: orderLines.length > 0 };
}

/** GET /api/orders/serviceability — is campus ordering open right now? */
export function useServiceability() {
  const [state, setState] = useState<{ open: boolean; reopensAt?: string; message?: string } | null>(null);
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
