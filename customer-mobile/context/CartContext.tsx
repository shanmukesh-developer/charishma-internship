import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';
import { API_URL } from '../constants/api';

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
  isCake?: boolean;
  customName?: string;
  customizations?: Customizations;
  addedBy?: string;
  addedById?: string;
}

interface CartContextType {
  cart: CartItem[];
  addToCart: (item: Omit<CartItem, 'quantity' | 'cartKey' | 'basePrice'> & { quantity?: number; basePrice?: number }) => void;
  removeFromCart: (cartKey: string) => void;
  updateQuantity: (cartKey: string, qty: number) => void;
  updateCustomName: (cartKey: string, name: string) => void;
  clearCart: () => void;
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  totalItems: number;
  totalPrice: number;
  uniqueRestaurants: number;
  deliveryFee: number;
  roomCode: string;
  isHosting: boolean;
  isJoined: boolean;
  handleHostRoom: () => void;
  handleJoinRoom: (code: string) => void;
  handleDisconnect: () => void;
  isRoomOrder: boolean;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

function generateCartKey(id: string, customizations?: Customizations): string {
  if (!customizations) return id;
  const sig = JSON.stringify(customizations);
  let hash = 0;
  for (let i = 0; i < sig.length; i++) {
    hash = ((hash << 5) - hash) + sig.charCodeAt(i);
    hash |= 0;
  }
  return `${id}-${hash.toString(36)}`;
}

function areCartsEqual(cartA: CartItem[], cartB: CartItem[]): boolean {
  if (!cartA || !cartB) return false;
  if (cartA.length !== cartB.length) return false;
  for (let i = 0; i < cartA.length; i++) {
    const a = cartA[i];
    const b = cartB[i];
    if (a.cartKey !== b.cartKey) return false;
    if (a.quantity !== b.quantity) return false;
    if (a.price !== b.price) return false;
    if (a.name !== b.name) return false;
    if (JSON.stringify(a.customizations) !== JSON.stringify(b.customizations)) return false;
  }
  return true;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Collab Sync state
  const [roomCode, setRoomCode] = useState('');
  const [isHosting, setIsHosting] = useState(false);
  const [isJoined, setIsJoined] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const isIncomingUpdateRef = useRef(false);
  const lastSyncedCartRef = useRef<CartItem[]>([]);

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
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const initializeSocket = async (code: string) => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    try {
      const storedUser = await AsyncStorage.getItem('user');
      let token = null;
      if (storedUser) {
        token = JSON.parse(storedUser).token || null;
      }

      const socket = io(API_URL, {
        withCredentials: true,
        transports: ['websocket', 'polling'],
        auth: { token }
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('joinRoom', code);
      });

      socket.on('cart_updated', (incomingCart: any) => {
        if (!areCartsEqual(cart, incomingCart)) {
          lastSyncedCartRef.current = incomingCart;
          isIncomingUpdateRef.current = true;
          setCart(incomingCart);
          setTimeout(() => {
            isIncomingUpdateRef.current = false;
          }, 100);
        }
      });
    } catch (err) {
      console.error('[COLLAB_CART_SOCKET_ERROR]', err);
    }
  };

  const handleHostRoom = async () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'ZN-';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setRoomCode(code);
    setIsHosting(true);
    await AsyncStorage.setItem('zenvy_collab_session', JSON.stringify({ code, role: 'host' }));
    initializeSocket(code);
  };

  const handleJoinRoom = async (inputCode: string) => {
    if (!inputCode) return;
    const formatted = inputCode.trim().toUpperCase();
    setRoomCode(formatted);
    setIsJoined(true);
    await AsyncStorage.setItem('zenvy_collab_session', JSON.stringify({ code: formatted, role: 'join' }));
    initializeSocket(formatted);
  };

  const handleDisconnect = async () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    setRoomCode('');
    setIsHosting(false);
    setIsJoined(false);
    lastSyncedCartRef.current = [];
    await AsyncStorage.removeItem('zenvy_collab_session');
  };

  // Load cart and collab state on start
  useEffect(() => {
    const loadState = async () => {
      try {
        const saved = await AsyncStorage.getItem('zenvy_cart');
        if (saved) {
          const parsed = JSON.parse(saved);
          const migrated = parsed.map((item: any) => ({
            ...item,
            cartKey: item.cartKey || item.id,
            basePrice: item.basePrice || item.price,
            image: item.image || item.imageUrl || '',
            restaurantName: item.restaurantName || 'Zenvy Partner'
          }));
          setCart(migrated);
        }

        const savedCollab = await AsyncStorage.getItem('zenvy_collab_session');
        if (savedCollab) {
          const { code, role } = JSON.parse(savedCollab);
          if (code) {
            setRoomCode(code);
            if (role === 'host') {
              setIsHosting(true);
            } else {
              setIsJoined(true);
            }
            initializeSocket(code);
          }
        }
      } catch (e) {
        console.error('[CART] failed to load async storage', e);
      } finally {
        setIsLoaded(true);
      }
    };
    loadState();
  }, []);

  // Save cart changes
  useEffect(() => {
    if (isLoaded) {
      AsyncStorage.setItem('zenvy_cart', JSON.stringify(cart));
    }
  }, [cart, isLoaded]);

  const addToCart = async (item: Omit<CartItem, 'quantity' | 'cartKey' | 'basePrice' | 'addedBy' | 'addedById'> & { quantity?: number; basePrice?: number; addedBy?: string; addedById?: string }) => {
    const cartKey = generateCartKey(item.id, item.customizations);
    const basePrice = item.basePrice || item.price;

    let userName = 'Guest Roommate';
    let userId = 'guest';
    try {
      const stored = await AsyncStorage.getItem('user');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.name) userName = parsed.name;
        if (parsed._id) userId = parsed._id;
      }
    } catch {}

    const itemWithQty: CartItem = {
      ...item,
      cartKey,
      basePrice,
      quantity: item.quantity || 1,
      image: item.image || item.imageUrl || '',
      restaurantName: item.restaurantName || 'Zenvy Partner',
      addedBy: item.addedBy || userName,
      addedById: item.addedById || userId,
    };

    setCart((prev) => {
      const existing = prev.find((i) => i.cartKey === cartKey);
      if (existing) {
        return prev.map((i) =>
          i.cartKey === cartKey
            ? { ...i, quantity: i.quantity + itemWithQty.quantity }
            : i
        );
      }
      return [...prev, itemWithQty];
    });
  };

  const removeFromCart = (cartKey: string) => {
    setCart((prev) => prev.filter((i) => i.cartKey !== cartKey && i.id !== cartKey));
  };

  const updateQuantity = (cartKey: string, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((i) => i.cartKey !== cartKey && i.id !== cartKey));
      return;
    }
    setCart((prev) => prev.map((i) =>
      (i.cartKey === cartKey || i.id === cartKey) ? { ...i, quantity: qty } : i
    ));
  };

  const updateCustomName = (cartKey: string, name: string) => {
    setCart((prev) => prev.map((i) =>
      (i.cartKey === cartKey || i.id === cartKey) ? { ...i, customName: name, customizations: { ...i.customizations, cakeMessage: name } } : i
    ));
  };

  const clearCart = () => setCart([]);

  const totalItems = cart.reduce((acc, item) => acc + item.quantity, 0);
  const totalPrice = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const uniqueRestaurants = new Set(cart.map(i => i.restaurantId)).size;
  const isRoomOrder = !!(roomCode || isHosting || isJoined);
  const deliveryFee = isRoomOrder ? 50 : (uniqueRestaurants * 30);

  return (
    <CartContext.Provider value={{
      cart, addToCart, removeFromCart, updateQuantity, updateCustomName, clearCart, setCart,
      totalItems, totalPrice, uniqueRestaurants, deliveryFee,
      roomCode, isHosting, isJoined, handleHostRoom, handleJoinRoom, handleDisconnect, isRoomOrder
    }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within CartProvider');
  return context;
};
