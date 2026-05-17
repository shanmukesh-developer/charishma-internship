"use client";
import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import Link from 'next/link';
import { useCart, Customizations } from '@/context/CartContext';
import SafeImage from '@/components/SafeImage';
import SuccessOverlay from '@/components/SuccessOverlay';
import CustomizeDrawer, { summarizeCustomizations } from '@/components/CustomizeDrawer';
import { Restaurant, MenuItem } from '@/types';
import Tilt from '@/components/Tilt';
import Magnetic from '@/components/Magnetic';
import { saveRecentlyViewed } from '@/components/RecentlyViewed';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || API_URL;

export default function RestaurantMenuClient({ restaurantId }: { restaurantId: string }) {
  // Legacy Redirect Map
  const legacyIdMap: Record<string, string> = {
    'sweet-shop': 'boutique-sweets-elite',
    'zenvy-bakery': 'boutique-bakery-elite',
    'summer-specials': 'boutique-summer-elite',
    'fruit-shop': 'boutique-fruits-elite',
    'biryani-hub': '8467dbf0-1b1b-4ae5-88b6-0fccbfcb1cbb'
  };

  const effectiveId = (legacyIdMap[restaurantId] || restaurantId).replace(/\/$/, "");
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [soldOutItems, setSoldOutItems] = useState<Set<string>>(new Set());
  const { totalItems, addToCart, clearCart } = useCart();
  const [scrollY, setScrollY] = useState(0);
  const [overlay, setOverlay] = useState<{ isOpen: boolean; title: string; message: string; type?: 'success' | 'error'; actionLabel?: string; onAction?: () => void }>({
    isOpen: false,
    title: '',
    message: '',
  });
  const [addedId, setAddedId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [dietMode, setDietMode] = useState<'all' | 'veg' | 'non-veg' | 'egg'>('all');
  const [isUserElite, setIsUserElite] = useState(false);
  const [surgeMultiplier, setSurgeMultiplier] = useState(1.0);
  const [isMaintenance, setIsMaintenance] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const [customizingItem, setCustomizingItem] = useState<MenuItem | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/users/restaurants/${effectiveId}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.name) {
          setRestaurant(data);
          saveRecentlyViewed({
            id: effectiveId,
            name: data.name,
            image: data.imageUrl || "",
            type: 'restaurant'
          });
          const unavailable = (data.menu || [])
            .filter((i: MenuItem) => i.isAvailable === false)
            .map((i: MenuItem) => i.id || i._id);
          setSoldOutItems(new Set(unavailable));
        }
        setLoading(false);
      })
      .catch(_err => {
        console.error('[FETCH_ERROR]', _err);
        setLoading(false);
      });
    const diet = localStorage.getItem('zenvy_diet_prefs');
    if (diet) {
      const parsed = JSON.parse(diet);
      setDietMode(parsed.mode || 'all');
    }

    const userData = localStorage.getItem('user');
    if (userData) {
      const parsed = JSON.parse(userData);
      setIsUserElite(parsed.isElite || false);
    }

    // Fetch Global Config for Initial State
    fetch(`${API_URL}/api/users/config`)
      .then(res => res.json())
      .then(data => {
        const surge = data.find((c: any) => c.key === 'surge_multiplier')?.value;
        if (surge) setSurgeMultiplier(Number(surge));
        
        const maintenance = data.find((c: any) => c.key === 'maintenance_mode')?.value;
        if (maintenance === true) setIsMaintenance(true);
      })
      .catch(() => {});
  }, [effectiveId]);

  const [isSurge, setIsSurge] = useState(false);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket']
    });
    socket.on('inventory_updated', (data: { itemId: string; isAvailable: boolean }) => {
      setSoldOutItems(prev => {
        const next = new Set(prev);
        if (!data.isAvailable) next.add(data.itemId);
        else next.delete(data.itemId);
        return next;
      });
    });

    socket.on('surge_active', (data: { multiplier: number }) => {
      setIsSurge(true);
      setSurgeMultiplier(data.multiplier);
      console.log(`[SURGE] Pricing active: ${data.multiplier}x`);
    });

    socket.on('config_updated', (data: { key: string; value: any }) => {
      if (data.key === 'surge_multiplier') setSurgeMultiplier(Number(data.value));
      if (data.key === 'maintenance_mode') setIsMaintenance(data.value === true);
    });

    socket.on('surge_ended', () => {
      setIsSurge(false);
    });

    return () => { socket.disconnect(); };
  }, []);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const handleScroll = () => setScrollY(el.scrollTop);
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  if (loading) return <div className="p-8 text-white min-h-screen text-center animate-pulse pt-20">Loading Menu...</div>;
  if (!restaurant) return <div className="p-8 text-white min-h-screen pt-20 text-center font-bold">Restaurant not found.</div>;

  const filteredMenu = (restaurant.menu || []).filter(item => {
    // Category Filter
    if (activeCategory !== 'All' && item.category !== activeCategory) return false;

    // Diet Filter
    if (dietMode === 'veg' && item.isVegetarian !== true) return false;
    if (dietMode === 'egg' && item.category?.toLowerCase() !== 'egg' && item.isVegetarian !== true) {
       // Simple check: if not veg and doesn't mention egg in category, hide it
       if (!item.name.toLowerCase().includes('egg')) return false;
    }

    return true;
  });

  const handleAddToCart = (item: MenuItem) => {
    setCustomizingItem(item);
  };

  const handleCustomizeConfirm = (customizations: Customizations, finalPrice: number) => {
    const item = customizingItem;
    if (!item) return;
    setCustomizingItem(null);
    try {
      addToCart({
        id: item.id || item._id || "",
        name: item.name,
        price: finalPrice,
        basePrice: item.price,
        image: item.image || item.imageUrl || "",
        restaurantId: restaurant.id || restaurant._id,
        restaurantName: restaurant.name,
        customizations,
      });
      setAddedId(item.id || item._id || null);
      setOverlay({
        isOpen: true,
        title: 'Added to Basket',
        message: `${item.name} (${summarizeCustomizations(customizations) || 'default'}) added!`,
        type: 'success'
      });
      setTimeout(() => setAddedId(null), 800);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'MULTIPLE_RESTAURANTS') {
        setOverlay({
          isOpen: true,
          title: 'Clear Basket?',
          message: 'Your basket contains items from another restaurant. Clear it to add this item?',
          type: 'error',
          actionLabel: 'Clear \u0026 Add',
          onAction: () => {
            clearCart();
            setCustomizingItem(item);
          }
        });
      }
    }
  };

  return (
    <main ref={mainRef} className="min-h-screen bg-background text-white overflow-y-auto overflow-x-hidden relative">
      {isMaintenance && (
        <div className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center p-8 text-center animate-fade-in">
          <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center text-3xl mb-6 animate-pulse">🛠️</div>
          <h2 className="text-3xl font-black text-white uppercase tracking-tighter mb-4">Nexus Maintenance <br /><span className="text-amber-500">Protocol Active</span></h2>
          <p className="text-gray-400 text-sm font-bold uppercase tracking-widest leading-relaxed max-w-xs">We are currently optimizing the delivery matrix. Order placement is temporarily frozen.</p>
          <Link href="/" className="mt-10 px-8 py-3 bg-white/5 border border-white/10 rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Return to Lobby</Link>
        </div>
      )}
      <SuccessOverlay 
        isOpen={overlay.isOpen}
        onClose={() => setOverlay(prev => ({ ...prev, isOpen: false }))}
        title={overlay.title}
        message={overlay.message}
        type={overlay.type}
        actionLabel={overlay.actionLabel}
        onAction={overlay.onAction}
      />
      {/* ── Hero Image ── */}
      <div className="relative h-[320px] overflow-hidden">
        <div
          className="absolute inset-0"
        >
          <SafeImage
            src={restaurant.imageUrl || ""} 
            alt={restaurant.name}
            fill
            style={{ objectFit: 'cover' }}
            priority
          />
        </div>
        {/* Gradient overlays & Cinematic Mist */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0B] via-[#0A0A0B]/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 to-transparent h-32" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(201,168,76,0.1),transparent_70%)]" />

        {/* Back button */}
        <Link href="/" className="absolute top-12 left-6 w-10 h-10 glass-card rounded-full flex items-center justify-center z-20">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>

        {/* Restaurant Info Overlay with Tilt */}
        <div className="absolute bottom-6 md:bottom-10 left-4 md:left-6 right-4 md:right-6 z-10">
          <Tilt scale={1.02}>
            <div className="p-4 md:p-6 rounded-[24px] md:rounded-[32px] bg-black/40 backdrop-blur-xl border border-white/5 shadow-2xl">
              <div className="w-full px-4 pt-10 pt-safe md:px-10 lg:px-14 pb-4">
                {isSurge ? (
                  <span className="bg-red-500 text-white text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-wider animate-pulse flex items-center gap-1 shadow-[0_0_15px_rgba(239,68,68,0.3)]">
                    🔥 High Demand (Surge)
                  </span>
                ) : (
                  <span className="bg-primary-yellow text-black text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-wider shadow-[0_0_15px_rgba(250,204,21,0.3)]">Top Rated</span>
                )}
                <span className="text-xs font-bold text-white/50">⭐ {restaurant.rating}</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-black mb-1 text-gold-shimmer">{restaurant.name}</h1>
              <p className="text-secondary-text text-[11px] font-medium leading-relaxed">{restaurant.description}</p>
              <div className="flex gap-4 mt-4">
                <div className="text-[9px] font-black uppercase tracking-widest text-secondary-text flex items-center gap-1 opacity-60">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  {restaurant.time}
                </div>
                <div className="text-[9px] font-black uppercase tracking-widest text-secondary-text opacity-60">Min ₹99</div>
              </div>
            </div>
          </Tilt>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="px-4 md:px-6 pb-24 -mt-4 relative z-10">
        <div className="gold-line mb-8" />

        {/* Category Pills */}
        <div className="flex gap-2.5 overflow-x-auto scrollbar-hide mb-8 pb-1 -mx-4 px-4 md:-mx-6 md:px-6">
          {['All', ...(restaurant.categories || [])].map((cat) => (
            <Magnetic key={cat}>
              <button 
                onClick={() => setActiveCategory(cat)}
                className={`px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all duration-300 shadow-xl ${activeCategory === cat ? 'bg-primary-yellow text-black shadow-primary-yellow/20 scale-105' : 'bg-white/5 border border-white/5 text-secondary-text hover:text-white hover:bg-white/10'}`}>
                {cat}
              </button>
            </Magnetic>
          ))}
        </div>

        {/* Menu Items */}
        <div className="space-y-4">
          {filteredMenu.map((item) => {
            const itemId = item.id || item._id || '';
            const isSoldOut = soldOutItems.has(itemId);
            const isEliteRestricted = item.isEliteOnly && !isUserElite;
            
            return (
            <Tilt key={itemId} scale={1.01}>
              <Link href={`/products/${itemId}`} className={`flex gap-4 md:gap-5 items-center bg-black/40 backdrop-blur-xl p-3.5 md:p-5 rounded-[24px] md:rounded-[32px] border border-white/5 hover:border-[#C9A84C]/25 transition-all duration-500 group cursor-pointer active:scale-[0.98] relative overflow-hidden ${isSoldOut || isEliteRestricted ? 'opacity-50 grayscale' : ''} ${isEliteRestricted ? 'pointer-events-none' : ''}`}>
                {/* Glow Layer */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_var(--mouse-x,50%)_var(--mouse-y,50%),rgba(201,168,76,0.05)_0%,transparent_80%)] pointer-events-none" />
                
                <div className="w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden border-2 border-[#C9A84C]/20 bg-black flex-shrink-0 relative group-hover:scale-105 transition-transform duration-500 shadow-2xl">
                   <SafeImage 
                     src={item.image || item.imageUrl || ""} 
                     alt={item.name} 
                     fill
                     style={{ objectFit: 'cover' }}
                   />
                   <div className="absolute inset-0 bg-gradient-to-tr from-[#C9A84C]/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                   {isEliteRestricted && <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-2 text-center"><span className="text-xl mb-1">💎</span><span className="text-[7px] font-black text-[#C9A84C] uppercase tracking-tighter">Elite Required</span></div>}
                </div>
                <div className="flex-1">
                   <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-black text-[14px] md:text-[15px] text-white/95 group-hover:text-primary-yellow transition-colors tracking-tight line-clamp-1">{item.name}</h3>
                      {item.isVegetarian && (
                        <div className="w-2.5 h-2.5 border border-emerald-500/50 flex items-center justify-center p-[0.5px] rounded-[1px] shrink-0">
                          <div className="w-full h-full bg-emerald-500 rounded-full" />
                        </div>
                      )}
                   </div>
                   {isSoldOut && <span className="text-[9px] font-black text-red-500 uppercase tracking-widest bg-red-500/10 px-2 py-0.5 rounded">Sold Out</span>}
                   {isEliteRestricted && <span className="text-[9px] font-black text-[#C9A84C] uppercase tracking-widest bg-[#C9A84C]/10 px-2 py-0.5 rounded">Locked Asset</span>}
                   <p className="text-[10px] md:text-[11px] text-white/40 line-clamp-1 mb-2 font-medium">{item.description || `Exquisitely crafted by ${restaurant.name}`}</p>
                   <div className="flex justify-between items-center">
                      <span className="font-black text-primary-yellow text-sm md:text-base tracking-tighter shadow-sm">
                        ₹{Math.round(item.price * surgeMultiplier)}
                        {surgeMultiplier > 1 && <span className="text-[7px] text-red-500 ml-1 opacity-60">SURGE</span>}
                      </span>
                      <Magnetic>
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); if(!isSoldOut && !isEliteRestricted) handleAddToCart(item); }}
                          disabled={isSoldOut || isEliteRestricted}
                          className={`w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center text-base md:text-lg font-black transition-all duration-500 z-10 ${
                            isSoldOut ? 'bg-red-500/10 text-red-500 cursor-not-allowed' :
                            isEliteRestricted ? 'bg-white/5 text-white/20 cursor-not-allowed border-white/5' :
                            addedId === itemId
                              ? 'bg-primary-yellow text-black animate-gold-pulse scale-110 shadow-[0_0_20px_rgba(250,204,21,0.4)]'
                              : 'bg-white/5 border border-white/10 text-white hover:border-[#C9A84C]/40 hover:bg-[#C9A84C]/15 hover:text-primary-yellow'
                          }`}
                        >
                          {isSoldOut ? '✕' : isEliteRestricted ? '🔒' : addedId === itemId ? '✓' : '+'}
                        </button>
                      </Magnetic>
                   </div>
                </div>
              </Link>
            </Tilt>
            );
          })}
        </div>
      </div>

      {/* Floating Cart */}
      {totalItems > 0 && (
        <Link href="/basket" className="fixed bottom-6 right-6 left-6 h-16 bg-gradient-to-r from-[#C9A84C] via-[#E8D18C] to-[#C9A84C] text-black rounded-full flex items-center justify-between px-8 z-50 shadow-2xl shadow-[#C9A84C]/30 active:scale-95 transition-all">
           <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-black text-white text-[11px] font-black flex items-center justify-center">{totalItems}</span>
              <span className="font-black uppercase tracking-widest text-[11px]">View Basket</span>
           </div>
           <span className="font-black text-sm">Proceed →</span>
        </Link>
      )}
      {/* Customize Drawer */}
      {customizingItem && (
        <CustomizeDrawer
          isOpen={!!customizingItem}
          onClose={() => setCustomizingItem(null)}
          onConfirm={handleCustomizeConfirm}
          itemName={customizingItem.name}
          basePrice={customizingItem.price}
          tags={customizingItem.tags}
          category={customizingItem.category}
        />
      )}

    </main>
  );
}
