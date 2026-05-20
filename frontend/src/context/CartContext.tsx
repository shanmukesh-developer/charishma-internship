"use client";
import React, { createContext, useContext, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

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
  cartKey: string; // unique key = id + customization hash
  name: string;
  price: number; // base price + addon adjustments
  basePrice: number;
  quantity: number;
  image: string;
  restaurantId: string;
  restaurantName?: string;
  isCake?: boolean;
  customName?: string;
  customizations?: Customizations;
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
  // Live Basket Collaborative Sync
  roomCode: string;
  isHosting: boolean;
  isJoined: boolean;
  handleHostRoom: () => void;
  handleJoinRoom: (code: string) => void;
  handleDisconnect: () => void;
}

function generateCartKey(id: string, customizations?: Customizations): string {
  if (!customizations) return id;
  const sig = JSON.stringify(customizations);
  // Simple hash
  let hash = 0;
  for (let i = 0; i < sig.length; i++) {
    hash = ((hash << 5) - hash) + sig.charCodeAt(i);
    hash |= 0;
  }
  return `${id}_${Math.abs(hash).toString(36)}`;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider = ({ children }: { children: React.ReactNode }) => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Live Basket Collaborative Sync state
  const [roomCode, setRoomCode] = useState('');
  const [isHosting, setIsHosting] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  
  const socketRef = useRef<Socket | null>(null);
  const isIncomingUpdateRef = useRef(false);

  // Sync state changes to room
  React.useEffect(() => {
    if (roomCode && socketRef.current && !isIncomingUpdateRef.current) {
      socketRef.current.emit('cart_change', { roomCode, cart });
    }
  }, [cart, roomCode]);

  // Clean up socket on deep unmount
  React.useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const initializeSocket = (code: string) => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    try {
      // Establish live WebSocket connection with the port 5005 backend
      const socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005', {
        withCredentials: true,
        transports: ['websocket', 'polling'] 
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('joinRoom', code);
      });

      socket.on('cart_updated', (incomingCart: any) => {
        isIncomingUpdateRef.current = true;
        setCart(incomingCart);
        // Temporary lock reset
        setTimeout(() => {
          isIncomingUpdateRef.current = false;
        }, 100);
      });
    } catch (err) {
      console.error('[COLLAB_CART_SOCKET_ERROR]', err);
    }
  };

  const handleHostRoom = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'ZN-';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setRoomCode(code);
    setIsHosting(true);
    initializeSocket(code);
  };

  const handleJoinRoom = (inputCode: string) => {
    if (!inputCode) return;
    const formatted = inputCode.trim().toUpperCase();
    setRoomCode(formatted);
    setIsJoined(true);
    initializeSocket(formatted);
  };

  const handleDisconnect = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    setRoomCode('');
    setIsHosting(false);
    setIsJoined(false);
  };

  React.useEffect(() => {
    const saved = localStorage.getItem('zenvy_cart');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Migration: add cartKey to old items that don't have one
        const migrated = parsed.map((item: any) => ({
          ...item,
          cartKey: item.cartKey || item.id,
          basePrice: item.basePrice || item.price,
        }));
        setCart(migrated);
      } catch {}
    }
    setIsLoaded(true);
  }, []);

  React.useEffect(() => {
    if (isLoaded) {
      localStorage.setItem('zenvy_cart', JSON.stringify(cart));
    }
  }, [cart, isLoaded]);

  const addToCart = (item: Omit<CartItem, 'quantity' | 'cartKey' | 'basePrice'> & { quantity?: number; basePrice?: number; imageUrl?: string }) => {
    const cartKey = generateCartKey(item.id, item.customizations);
    const basePrice = item.basePrice || item.price;
    const itemWithQty: CartItem = {
      ...item,
      cartKey,
      basePrice,
      quantity: item.quantity || 1,
      image: item.image || (item as any).imageUrl || '',
    };

    // Multi-restaurant is now allowed — delivery fee scales with restaurant count

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
      // Remove item when quantity hits 0
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
  const deliveryFee = uniqueRestaurants * 30;

  return (
    <CartContext.Provider value={{ cart, addToCart, removeFromCart, updateQuantity, updateCustomName, clearCart, setCart, totalItems, totalPrice, uniqueRestaurants, deliveryFee, roomCode, isHosting, isJoined, handleHostRoom, handleJoinRoom, handleDisconnect }}>
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within CartProvider');
  return context;
};
