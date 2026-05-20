"use client";
import { useState, useEffect, useRef } from 'react';
import { useCart } from '@/context/CartContext';
import { summarizeCustomizations } from '@/components/CustomizeDrawer';
import Link from 'next/link';
import SafeImage from '@/components/SafeImage';
import Tilt from '@/components/Tilt';
import Magnetic from '@/components/Magnetic';
import { io } from 'socket.io-client';

interface CartItem {
  id: string;
  cartKey: string;
  name: string;
  price: number;
  basePrice?: number;
  image?: string;
  imageUrl?: string;
  restaurantName?: string;
  restaurantId: string;
  quantity: number;
  isCake?: boolean;
  customName?: string;
  customizations?: Record<string, any>;
}

interface BasketItemProps {
  item: CartItem;
  updateQuantity: (cartKey: string, q: number) => void;
  removeFromCart: (cartKey: string) => void;
  updateCustomName: (cartKey: string, name: string) => void;
}

function BasketItem({ item, updateQuantity, removeFromCart, updateCustomName }: BasketItemProps) {
  const [localName, setLocalName] = useState(item.customizations?.cakeMessage || item.customName || '');
  const key = item.cartKey || item.id;
  const summary = summarizeCustomizations(item.customizations);

  const handleNameChange = (val: string) => {
    setLocalName(val);
    updateCustomName(key, val);
  };

  return (
    <div className="flex flex-col bg-card-bg p-4 md:p-6 rounded-[28px] md:rounded-[35px] border border-white/5 transition-all hover:border-white/10 group">
      <div className="flex gap-4 md:gap-6 items-center">
        <div className="w-24 h-24 relative flex-shrink-0">
          <SafeImage 
            src={item.image || item.imageUrl} 
            alt={item.name} 
            fill
            className="rounded-full border-2 border-primary-yellow shadow-2xl" 
          />
        </div>
        <div className="flex-1">
          <h3 className="font-black text-base text-white group-hover:text-primary-yellow transition-colors">{item.name}</h3>
          <p className="text-secondary-text text-xs mt-0.5 mb-1">from {item.restaurantName || "Zenvy Elite"}</p>

          {/* Customization summary */}
          {summary && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {summary.split(' • ').map((part, i) => (
                <span key={i} className="text-[9px] font-bold bg-[#38BDF8]/10 text-[#38BDF8]/70 px-2 py-0.5 rounded-lg border border-[#38BDF8]/10">
                  {part}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <p className="text-primary-yellow font-black text-lg">₹{item.price}</p>
              {item.basePrice && item.price !== item.basePrice && (
                <p className="text-[10px] text-white/20 line-through">₹{item.basePrice}</p>
              )}
            </div>
            <div className="flex items-center gap-4 bg-white/5 px-4 py-2 rounded-full border border-white/5">
              <button onClick={() => updateQuantity(key, item.quantity - 1)} className="w-6 h-6 flex items-center justify-center font-bold text-secondary-text hover:text-white">-</button>
              <span className="font-black text-sm w-4 text-center">{item.quantity}</span>
              <button onClick={() => updateQuantity(key, item.quantity + 1)} className="w-6 h-6 flex items-center justify-center font-bold text-secondary-text hover:text-white">+</button>
            </div>
          </div>
        </div>
        <button onClick={() => removeFromCart(key)} className="p-2 opacity-20 hover:opacity-100 hover:text-red-500 transition-all">
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>

      {/* Cake message input */}
      {item.customizations?.cakeMessage !== undefined && (
        <div className="mt-5 pt-5 border-t border-white/5">
          <label className="text-[10px] font-black uppercase tracking-widest text-primary-yellow/60 block mb-3">Message on Cake</label>
          <div className="relative">
            <input 
              type="text"
              placeholder="e.g. Happy Birthday Shanmukh"
              value={localName}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full stardust-search rounded-2xl px-5 py-4 text-sm font-black text-white placeholder:text-white/20 focus:outline-none transition-all"
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-primary-yellow opacity-40">✍️</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BasketPage() {
  const { cart, updateQuantity, removeFromCart, updateCustomName, totalPrice, uniqueRestaurants, deliveryFee, setCart } = useCart();

  const [roomCode, setRoomCode] = useState('');
  const [isHosting, setIsHosting] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [alertMsg, setAlertMsg] = useState('');

  const socketRef = useRef<any>(null);
  const isIncomingUpdateRef = useRef(false);

  // Sync state changes to roommate room
  useEffect(() => {
    if (roomCode && socketRef.current && !isIncomingUpdateRef.current) {
      socketRef.current.emit('cart_change', { roomCode, cart });
    }
  }, [cart, roomCode]);

  // Clean up socket on unmount
  useEffect(() => {
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
      const storedUser = localStorage.getItem('user');
      let token = '';
      if (storedUser) {
        const parsed = JSON.parse(storedUser);
        token = parsed.token || '';
      }

      // Establish live WebSocket connection with the port 5005 backend
      const socket = io('http://localhost:5005', {
        auth: { token },
        transports: ['websocket']
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

  const handleJoinRoom = () => {
    if (!inputCode) return;
    const formatted = inputCode.trim().toUpperCase();
    setRoomCode(formatted);
    setIsJoined(true);
    initializeSocket(formatted);
    setIsJoinOpen(false);
  };

  const handleDisconnect = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    setRoomCode('');
    setIsHosting(false);
    setIsJoined(false);
    setInputCode('');
  };

  // Group items by restaurant for display
  const groupedByRestaurant = cart.reduce<Record<string, { name: string; items: CartItem[] }>>((acc, item) => {
    const rId = item.restaurantId;
    if (!acc[rId]) acc[rId] = { name: item.restaurantName || 'Unknown', items: [] };
    acc[rId].items.push(item as CartItem);
    return acc;
  }, {});

  const grandTotal = totalPrice + deliveryFee;

  return (
    <main className="min-h-screen bg-[#0A0A0B] text-white p-4 md:p-8 relative overflow-x-hidden">
      {/* Cinematic Background */}
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(201,168,76,0.05)_0%,transparent_50%)] pointer-events-none" />
      <div className="fixed inset-0 bg-gradient-to-b from-black via-transparent to-black pointer-events-none opacity-40" />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-8">
          <Magnetic>
            <Link href="/" className="w-12 h-12 bg-white/5 backdrop-blur-xl rounded-full flex items-center justify-center border border-white/10 hover:bg-white/10 transition-all">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
          </Magnetic>
          <h1 className="text-xl font-black uppercase tracking-[0.3em] text-gold-shimmer">My Basket</h1>
          <div className="w-12" />
        </div>

        {/* Roommate Multiplayer Cart Hub */}
        <div className="mb-8 glass-card p-5 md:p-6 border-white/5 rounded-[30px] bg-black/40 backdrop-blur-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
            <span className="text-5xl font-black italic">ROOM</span>
          </div>

          {!roomCode ? (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-black text-primary-yellow uppercase tracking-widest mb-1">Roommate Group Cart</p>
                <h4 className="text-xs font-black text-white uppercase tracking-wider">Order together with your roommates and split the bill</h4>
              </div>
              <div className="flex gap-3 w-full sm:w-auto">
                <button
                  onClick={handleHostRoom}
                  className="flex-1 sm:flex-none px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-wider text-white transition-all"
                >
                  📡 Host Cart
                </button>
                <button
                  onClick={() => setIsJoinOpen(!isJoinOpen)}
                  className="flex-1 sm:flex-none px-5 py-2.5 bg-primary-yellow text-black hover:bg-primary-yellow/90 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                >
                  👥 Join Cart
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center text-sm animate-pulse">
                  🟢
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Live Room Active</p>
                    <span className="text-[8px] px-2 py-0.5 bg-white/5 rounded-full text-white/50 uppercase font-black">
                      {isHosting ? 'Host' : 'Joined'}
                    </span>
                  </div>
                  <h4 className="text-sm font-black text-white uppercase tracking-widest mt-0.5">
                    Room Code: <span className="text-primary-yellow font-black text-base">{roomCode}</span>
                  </h4>
                </div>
              </div>
              <button
                onClick={handleDisconnect}
                className="w-full sm:w-auto px-5 py-2.5 bg-red-500/10 hover:bg-red-500/25 border border-red-500/20 text-red-500 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
              >
                🚫 Disconnect
              </button>
            </div>
          )}

          {isJoinOpen && !roomCode && (
            <div className="mt-5 pt-5 border-t border-white/5 animate-in slide-in-from-top-3 duration-300">
              <label className="text-[9px] font-black uppercase tracking-wider text-primary-yellow block mb-2">Enter Roommate Code</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. ZN-8B2A"
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value)}
                  className="flex-1 stardust-search rounded-xl px-4 py-3 text-xs font-black text-white placeholder:text-white/20 focus:outline-none transition-all uppercase"
                />
                <button
                  onClick={handleJoinRoom}
                  className="px-6 bg-white text-black hover:bg-white/90 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                >
                  Connect
                </button>
              </div>
            </div>
          )}
        </div>

        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-32 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="w-full flex justify-center mb-10">
               <div className="w-40 h-40 bg-white/5 rounded-full flex items-center justify-center text-6xl shadow-2xl border border-white/5">🛒</div>
            </div>
            <p className="text-secondary-text font-black uppercase tracking-widest mb-12 opacity-40">Your basket is currently empty</p>
            <Magnetic>
              <Link href="/" className="px-12 py-4 bg-primary-yellow text-black rounded-2xl font-black uppercase tracking-widest text-xs shadow-[0_15px_30px_-10px_rgba(201,168,76,0.3)]">Explore Canteens</Link>
            </Magnetic>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
              {/* Group by restaurant */}
              {Object.entries(groupedByRestaurant).map(([rId, group]) => (
                <div key={rId} className="mb-6">
                  {uniqueRestaurants > 1 && (
                    <div className="flex items-center gap-2 mb-3 px-1">
                      <div className="w-2 h-2 bg-[#38BDF8] rounded-full" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-[#38BDF8]/60">{group.name}</span>
                      <div className="flex-1 h-px bg-white/5" />
                      <span className="text-[9px] font-bold text-white/20">₹30 delivery</span>
                    </div>
                  )}
                  {group.items.map((item) => (
                    <Tilt key={item.cartKey || item.id} scale={1.01} className="mb-4">
                      <BasketItem 
                        item={item} 
                        updateQuantity={updateQuantity} 
                        removeFromCart={removeFromCart} 
                        updateCustomName={updateCustomName} 
                      />
                    </Tilt>
                  ))}
                </div>
              ))}
            </div>

            <div className="pt-12 space-y-4 animate-in fade-in duration-1000 delay-300">
               <div className="flex justify-between items-center text-xs font-black uppercase tracking-widest text-white/30">
                 <span>Items Subtotal</span>
                 <span>₹{totalPrice}</span>
               </div>
               <div className="flex justify-between items-center text-xs font-black uppercase tracking-widest text-white/30">
                 <span className="flex items-center gap-2">
                   Delivery Fee
                   {uniqueRestaurants > 1 && (
                     <span className="text-[9px] normal-case tracking-normal text-[#38BDF8]/40 font-bold">
                       ({uniqueRestaurants} restaurants × ₹30)
                     </span>
                   )}
                 </span>
                 <span>₹{deliveryFee}</span>
               </div>
               <div className="h-[1px] bg-white/5" />
               <div className="flex justify-between items-center text-white text-2xl md:text-3xl font-black tracking-tighter">
                 <span className="text-gold-shimmer uppercase text-[10px] md:text-base tracking-widest">Grand Total</span>
                 <span className="text-primary-yellow">₹{grandTotal}</span>
               </div>
            </div>

            <Magnetic>
              <Link href="/checkout" className="w-full btn-yellow mt-12 flex justify-center py-6 text-[13px] font-black uppercase tracking-[0.2em] relative overflow-hidden group shadow-[0_20px_50px_rgba(201,168,76,0.25)]">
                <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-12" />
                Proceed to Checkout
              </Link>
            </Magnetic>
          </div>
        )}
      </div>
    </main>
  );
}
