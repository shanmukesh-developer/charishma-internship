"use client";
import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart, Customizations } from '@/context/CartContext';
import SafeImage from '@/components/SafeImage';
import SuccessOverlay from '@/components/SuccessOverlay';
import CustomizeDrawer, { summarizeCustomizations } from '@/components/CustomizeDrawer';
import { Restaurant, MenuItem } from '@/types';
import Tilt from '@/components/Tilt';
import Magnetic from '@/components/Magnetic';
import { saveRecentlyViewed } from '@/components/RecentlyViewed';
import { motion, AnimatePresence } from 'framer-motion';
import { API_URL } from '@/utils/api';
import ZenvyLoader from '@/components/ZenvyLoader';
import BrandTakeoverSplash from '@/components/BrandTakeoverSplash';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || API_URL;

export default function RestaurantMenuClient({ restaurantId }: { restaurantId: string }) {
  const router = useRouter();
  // Legacy Redirect Map
  const legacyIdMap: Record<string, string> = {
    'sweet-shop': 'ca3f99e1-8f1f-4f3e-a209-ed78ff638cf5',
    'boutique-sweets-elite': 'ca3f99e1-8f1f-4f3e-a209-ed78ff638cf5',
    'zenvy-bakery': 'bef0fa4b-1c1d-4f22-ae74-d32df31e2d37',
    'boutique-bakery-elite': 'bef0fa4b-1c1d-4f22-ae74-d32df31e2d37',
    'summer-specials': 'e9eb9d54-3a51-422d-b070-e66975a6b68e',
    'boutique-summer-elite': 'e9eb9d54-3a51-422d-b070-e66975a6b68e',
    'fruit-shop': '296ec3cf-4eee-44e7-9454-1d4e563e1687',
    'boutique-fruits-elite': '296ec3cf-4eee-44e7-9454-1d4e563e1687',
    'biryani-hub': '8467dbf0-1b1b-4ae5-88b6-0fccbfcb1cbb',
    'burger-club': '5beef15a-8b83-49cc-8514-6ef26db12345',
    'pizza-paradise': '706822c4-2eb3-43b4-ad86-91a252ea9108',
    'subway-fresh': 'a5124e4d-1768-45d2-b062-8178cd901234',
    'la-pinoz': 'c6142c67-62f7-4148-963d-4952de123456',
    'gym-1': '0c5de1a2-cb3d-4007-aaef-6789db123456',
    'gym-2': '1d5de1b3-db4d-4008-bbfe-7890db123456',
    'gym-gear': '2e5de1c4-ec5d-4009-ccff-8901db123456'
  };

  const effectiveId = (legacyIdMap[restaurantId] || restaurantId).replace(/\/$/, "");
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [showTakeoverSplash, setShowTakeoverSplash] = useState(false);
  const [takeoverDone, setTakeoverDone] = useState(false);
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
  const [clickCoords, setClickCoords] = useState<{ x: number; y: number } | null>(null);
  const [flyingItem, setFlyingItem] = useState<{ imageUrl: string; startX: number; startY: number } | null>(null);
  const [cartBounce, setCartBounce] = useState(false);
  const [tiltX, setTiltX] = useState(0);
  const [tiltY, setTiltY] = useState(0);
  const [shineX, setShineX] = useState(50);
  const [shineY, setShineY] = useState(50);

  const onBucketMouseMove = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    setTiltX((py - 0.5) * -24);
    setTiltY((px - 0.5) * 24);
    setShineX(px * 100);
    setShineY(py * 100);
  };

  const onBucketMouseLeave = () => {
    setTiltX(0);
    setTiltY(0);
    setShineX(50);
    setShineY(50);
  };

  const isLocalVendor = restaurant?.vendorType === 'LOCAL_VENDOR';

  const getWhatsAppLink = (itemName?: string) => {
    if (!restaurant) return '';
    const phone = restaurant.whatsappNumber || '919391955674';
    const campus = restaurant.campus || 'Campus';
    let msg = `Hi! I'd like to order from ${restaurant.name} via CampusBites (Zenvy). My campus: ${campus}.`;
    if (itemName) msg += `\n\nItem: ${itemName}`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  };

  const getCallLink = () => {
    if (!restaurant) return '';
    const phone = restaurant.whatsappNumber || '919391955674';
    return `tel:+${phone}`;
  };

  useEffect(() => {
    fetch(`${API_URL}/api/users/restaurants/${effectiveId}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.name) {
          setRestaurant(data);
          if (data.brandTheme) {
            setShowTakeoverSplash(true);
          }
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
      transports: ['websocket', 'polling'],
      withCredentials: true
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

  if (loading) return <ZenvyLoader message="Fetching Gourmet Menu..." />;
  if (!restaurant) return <div className="p-8 text-white light:text-gray-900 min-h-screen pt-20 text-center font-bold">Restaurant not found.</div>;

  const filteredMenu = (restaurant.menu || []).filter(item => {
    // Category Filter
    if (activeCategory !== 'All') {
      const activeLower = activeCategory.toLowerCase().trim();
      const matchCategory = item.category?.toLowerCase().includes(activeLower);
      const matchTag = Array.isArray(item.tags) && item.tags.some(tag => tag.toLowerCase().includes(activeLower));
      const matchName = item.name?.toLowerCase().includes(activeLower);
      
      if (!matchCategory && !matchTag && !matchName) return false;
    }

    // Diet Filter
    if (dietMode === 'veg' && item.isVegetarian !== true) return false;
    if (dietMode === 'egg' && item.category?.toLowerCase() !== 'egg' && item.isVegetarian !== true) {
       // Simple check: if not veg and doesn't mention egg in category, hide it
       if (!item.name.toLowerCase().includes('egg')) return false;
    }

    return true;
  });

  const handleAddToCart = (item: MenuItem) => {
    try {
      addToCart({
        id: item.id || item._id || "",
        name: item.name,
        price: item.price,
        basePrice: item.price,
        image: item.image || item.imageUrl || "",
        restaurantId: restaurant.id || restaurant._id,
        restaurantName: restaurant.name,
        customizations: {},
      });
      setAddedId(item.id || item._id || null);
      if (clickCoords) {
        setFlyingItem({
          imageUrl: item.image || item.imageUrl || "",
          startX: clickCoords.x,
          startY: clickCoords.y
        });
      }
      setTimeout(() => setAddedId(null), 800);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'MULTIPLE_RESTAURANTS') {
        setOverlay({
          isOpen: true,
          title: 'Clear Basket?',
          message: 'Your basket contains items from another restaurant. Clear it to add this item?',
          type: 'error',
          actionLabel: 'Clear & Add',
          onAction: () => {
            clearCart();
            setTimeout(() => {
              addToCart({
                id: item.id || item._id || "",
                name: item.name,
                price: item.price,
                basePrice: item.price,
                image: item.image || item.imageUrl || "",
                restaurantId: restaurant.id || restaurant._id,
                restaurantName: restaurant.name,
                customizations: {},
              });
              setAddedId(item.id || item._id || null);
              if (clickCoords) {
                setFlyingItem({
                  imageUrl: item.image || item.imageUrl || "",
                  startX: clickCoords.x,
                  startY: clickCoords.y
                });
              }
              setTimeout(() => setAddedId(null), 800);
            }, 100);
          }
        });
      }
    }
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
      if (clickCoords) {
        setFlyingItem({
          imageUrl: item.image || item.imageUrl || "",
          startX: clickCoords.x,
          startY: clickCoords.y
        });
      }
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

  const brand = restaurant?.brandTheme
    ? (typeof restaurant.brandTheme === 'string' ? JSON.parse(restaurant.brandTheme) : restaurant.brandTheme)
    : null;

  return (
    <main 
      ref={mainRef} 
      className={`min-h-screen pb-48 overflow-y-auto overflow-x-hidden relative transition-all duration-1000 ${
        brand 
          ? 'text-white' 
          : 'bg-background text-white light:text-gray-900 light:bg-gradient-to-b light:from-[#f8f8fa] light:to-white'
      }`}
      style={brand ? { 
        background: brand.gradient || brand.primaryColor,
        color: brand.fontColor || '#ffffff'
      } : {}}
    >
      {brand && (
        <style dangerouslySetInnerHTML={{__html: `
          .brand-takeover-card {
            border-color: rgba(255, 255, 255, 0.05) !important;
            background-color: rgba(0, 0, 0, 0.6) !important;
          }
          .brand-takeover-card:hover {
            border-color: ${brand.accentColor} !important;
            box-shadow: 0 0 20px ${brand.accentColor}30 !important;
          }
          .brand-takeover-card:hover h3 {
            color: ${brand.accentColor} !important;
          }
          .brand-takeover-btn {
            background-color: ${brand.accentColor} !important;
            color: ${brand.secondaryColor || '#000000'} !important;
            border-color: ${brand.accentColor} !important;
          }
          .brand-takeover-btn:hover {
            opacity: 0.9;
          }
        `}} />
      )}
      <AnimatePresence>
        {showTakeoverSplash && brand && (
          <BrandTakeoverSplash
            brandName={restaurant.name}
            logoAnimationType={brand.logoAnimationType}
            logoUrl={brand.logoUrl}
            onComplete={() => {
              setShowTakeoverSplash(false);
              setTakeoverDone(true);
            }}
          />
        )}
      </AnimatePresence>
      {isMaintenance && (
        <div className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center p-8 text-center animate-fade-in">
          <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center text-3xl mb-6 animate-pulse">🛠️</div>
          <h2 className="text-3xl font-black text-white light:text-gray-900 uppercase tracking-tighter mb-4">Nexus Maintenance <br /><span className="text-amber-500">Protocol Active</span></h2>
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
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0B] via-[#0A0A0B]/60 to-transparent light:from-[#fdfdfd] light:via-[#fdfdfd]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 to-transparent h-32 light:from-black" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(201,168,76,0.1),transparent_70%)] light:hidden" />

        {/* Back button */}
        <button 
          onClick={() => {
            if (typeof window !== 'undefined' && window.history.length > 1) {
              router.back();
            } else {
              router.push('/');
            }
          }}
          className="absolute top-12 left-6 w-10 h-10 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center z-20 outline-none light:bg-white light:shadow-md light:border-gray-200 light:shadow-[0_4px_15px_rgba(0,0,0,0.05)] light:text-black"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Restaurant Info Overlay with Tilt */}
        <div className="absolute bottom-6 md:bottom-10 left-4 md:left-6 right-4 md:right-6 z-10">
          <Tilt scale={1.02}>
            <div className={`p-4 md:p-6 rounded-[24px] md:rounded-[32px] backdrop-blur-xl border shadow-2xl transition-all duration-500 ${
              brand 
                ? 'border-white/10 bg-black/60 shadow-[0_0_30px_rgba(0,0,0,0.5)]' 
                : 'bg-black/40 border border-white/5 light:bg-white light:border-gray-200 light:shadow-[0_4px_15px_rgba(0,0,0,0.05)] light:shadow-md'
            }`}>
              <div className="w-full px-4 pt-10 pt-safe md:px-10 lg:px-14 pb-4">
                {isSurge ? (
                  <span className="bg-red-500 text-white light:text-gray-900 text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-wider animate-pulse flex items-center gap-1 shadow-[0_0_15px_rgba(239,68,68,0.3)]">
                    🔥 High Demand (Surge)
                  </span>
                ) : (
                  <span className="bg-primary-yellow text-black text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-wider shadow-[0_0_15px_rgba(250,204,21,0.3)] light:bg-[#EF4F5F] light:text-white light:text-gray-900">Top Rated</span>
                )}
                <span className="text-xs font-bold text-white light:text-gray-900/50 light:text-black">⭐ {restaurant.rating}</span>
              </div>

              <div className="flex items-center gap-3 mb-1">
                {brand && brand.logoUrl && (
                  <div className="relative w-8 h-8 shrink-0">
                    <SafeImage src={brand.logoUrl} alt={`${restaurant.name} logo`} fill style={{ objectFit: 'contain' }} />
                  </div>
                )}
                <h1 
                  className={`text-2xl md:text-3xl font-black text-gold-shimmer ${brand ? '' : 'light:text-black'}`}
                  style={brand ? { color: brand.accentColor, textShadow: `0 0 15px ${brand.accentColor}30` } : {}}
                >
                  {restaurant.name}
                </h1>
              </div>

              <p className="text-secondary-text text-[11px] font-medium leading-relaxed light:text-black">{restaurant.description || restaurant.stallDescription}</p>
              
              {isLocalVendor && (
                <div className="mt-2 inline-flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 rounded-xl px-3 py-1">
                  <span className="text-[10px] font-black text-orange-400 uppercase tracking-widest">🏪 CampusBites Local Vendor</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-4 mt-4">
                <div className="flex gap-4">
                  <div className="text-[9px] font-black uppercase tracking-widest text-secondary-text flex items-center gap-1  light:opacity-100 light:text-black">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    {isLocalVendor ? (restaurant.operatingHours ? `${restaurant.operatingHours.start || '19:00'} - ${restaurant.operatingHours.end || '00:00'}` : 'Hours vary') : restaurant.time}
                  </div>
                  <div className="text-[9px] font-black uppercase tracking-widest text-secondary-text  light:opacity-100 light:text-black">
                    {isLocalVendor ? (restaurant.campus || 'Campus Stall') : 'Min ₹99'}
                  </div>
                </div>
                
                {isLocalVendor && (
                  <div className="flex gap-2">
                    <a
                      href={getCallLink()}
                      onClick={() => {
                        fetch(`${API_URL}/api/restaurants/${restaurant.id || restaurant._id}/click`, { method: 'POST' }).catch(() => {});
                      }}
                      className="flex items-center gap-1.5 bg-blue-600 text-white light:text-gray-900 hover:bg-blue-500 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-blue-600/25"
                    >
                      📞 Call Stall
                    </a>
                    <a
                      href={getWhatsAppLink()}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        fetch(`${API_URL}/api/restaurants/${restaurant.id || restaurant._id}/click`, { method: 'POST' }).catch(() => {});
                      }}
                      className="flex items-center gap-1.5 bg-emerald-500 text-black hover:bg-emerald-400 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-500/20"
                    >
                      💬 Order via WhatsApp
                    </a>
                  </div>
                )}
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
          {['All', ...(restaurant.categories?.length ? restaurant.categories : (restaurant.tags || []))].map((cat) => (
            <Magnetic key={cat}>
              <button 
                onClick={() => setActiveCategory(cat)}
                className={`px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all duration-300 shadow-xl ${activeCategory === cat ? 'bg-[#EF4F5F] text-white light:text-gray-900 shadow-[#EF4F5F]/20 scale-105' : 'bg-white/5 border border-white/5 text-secondary-text hover:text-white light:text-gray-900 hover:bg-white/10 light:bg-black light:border-gray-200 light:shadow-[0_4px_15px_rgba(0,0,0,0.05)] light:text-black light:hover:text-black light:hover:bg-black/10'}`}
                style={brand ? (
                  activeCategory === cat
                    ? { backgroundColor: brand.accentColor, color: brand.secondaryColor || '#000000', boxShadow: `0 0 15px ${brand.accentColor}30` }
                    : { backgroundColor: 'rgba(255, 255, 255, 0.08)', color: '#ffffff', borderColor: 'rgba(255,255,255,0.1)' }
                ) : {}}
              >
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
            
            const cardContent = (
              <div className={`flex gap-4 items-start bg-black/40 backdrop-blur-xl p-4 md:p-5 rounded-[24px] md:rounded-[32px] border border-white/5 hover:border-red-500/25 transition-all duration-500 group relative overflow-hidden light:bg-white light:border-gray-200 light:shadow-[0_4px_15px_rgba(0,0,0,0.05)] light:hover:border-black/15 light:shadow-md ${isSoldOut || isEliteRestricted ? ' grayscale' : ''} ${isEliteRestricted ? 'pointer-events-none' : ''} ${brand ? 'brand-takeover-card' : ''}`}>
                {/* Glow Layer */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_var(--mouse-x,50%)_var(--mouse-y,50%),rgba(239,79,95,0.03)_0%,transparent_80%)] pointer-events-none" />
                
                {/* Left Side: Dish Details */}
                <div className="flex-1 min-w-0 pr-2">
                   {/* Veg/Non-veg Dot Indicator */}
                   <div className="flex items-center gap-2 mb-1.5">
                      {item.isVegetarian ? (
                        <div className="w-4 h-4 border border-emerald-500 flex items-center justify-center p-[2.5px] rounded bg-transparent shrink-0">
                          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                        </div>
                      ) : (
                        <div className="w-4 h-4 border border-red-500 flex items-center justify-center p-[2.5px] rounded bg-transparent shrink-0">
                          <div className="w-0 h-0 border-l-[3.5px] border-l-transparent border-r-[3.5px] border-r-transparent border-b-[7px] border-b-red-500" />
                        </div>
                      )}
                      
                      {item.isEliteOnly && (
                        <span className="text-[7px] font-black text-[#C9A84C] border border-[#C9A84C]/25 bg-[#C9A84C]/10 px-1.5 py-0.5 rounded uppercase tracking-wider">
                          Elite
                        </span>
                      )}
                      {item.isBestseller && (
                        <span className="text-[7px] font-black text-rose-500 border border-rose-500/25 bg-rose-500/10 px-1.5 py-0.5 rounded uppercase tracking-wider">
                          Bestseller
                        </span>
                      )}
                   </div>

                   <h3 className="font-black text-[15px] md:text-[17px] text-white light:text-gray-900/95 group-hover:text-primary-yellow transition-colors tracking-tight line-clamp-1 mb-1 light:text-black light:group-hover:text-[#EF4F5F]">
                     {item.name}
                   </h3>

                   {/* Price and Surge details */}
                   <div className="flex items-center gap-2 mb-2">
                      <span className="font-black text-[#EF4F5F] text-base tracking-tight">
                        ₹{Math.round(item.price * surgeMultiplier)}
                      </span>
                      {surgeMultiplier > 1 && (
                        <span className="flex items-center gap-1 shrink-0 bg-red-500/10 px-1.5 py-0.5 rounded">
                          <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-ping" />
                          <span className="text-[7px] text-red-400 font-bold uppercase tracking-widest">Surge</span>
                        </span>
                      )}
                   </div>

                   {isSoldOut && <span className="inline-block text-[8px] font-black text-red-500 uppercase tracking-widest bg-red-500/10 px-2 py-0.5 rounded mb-2">Sold Out</span>}
                   {isEliteRestricted && <span className="inline-block text-[8px] font-black text-[#C9A84C] uppercase tracking-widest bg-[#C9A84C]/10 px-2 py-0.5 rounded mb-2">Locked Asset</span>}
                   
                   <p className="text-[11px] text-white light:text-gray-900/40 line-clamp-2 leading-relaxed font-medium light:text-black">
                     {item.description || `Exquisitely prepared fresh dish from the kitchens of ${restaurant.name}.`}
                   </p>
                </div>

                {/* Right Side: Square/Rect Image with Floating ADD Button */}
                <div className="w-24 h-24 md:w-28 md:h-28 rounded-2xl overflow-hidden border border-white/10 bg-black/20 flex-shrink-0 relative group-hover:scale-[1.02] transition-transform duration-300 shadow-lg flex flex-col justify-end items-center pb-2.5">
                   <SafeImage 
                     src={item.image || item.imageUrl || ""} 
                     alt={item.name} 
                     fill
                     className="object-cover group-hover:scale-105 transition-transform duration-700"
                   />
                   
                   {/* Lock overlay for Elite */}
                   {isEliteRestricted && (
                     <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-2 text-center z-10">
                       <span className="text-xl mb-1">💎</span>
                       <span className="text-[8px] font-black text-[#C9A84C] uppercase tracking-tighter">Elite Req</span>
                     </div>
                   )}

                   {/* Floating ADD button at the bottom center of the image */}
                   <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 z-20">
                     {isLocalVendor ? (
                       <button
                         onClick={(e) => {
                           e.stopPropagation();
                           window.open(getWhatsAppLink(item.name), '_blank');
                           fetch(`${API_URL}/api/restaurants/${restaurant.id || restaurant._id}/click`, { method: 'POST' }).catch(() => {});
                         }}
                         className="px-4 py-1 rounded-xl bg-emerald-500 text-white light:text-gray-900 hover:bg-emerald-600 font-black text-[10px] uppercase tracking-widest shadow-md transition-all block text-center border border-emerald-400"
                       >
                         Order
                       </button>
                     ) : (
                       <button
                         onClick={(e) => { 
                           e.preventDefault(); 
                           e.stopPropagation(); 
                           if(!isSoldOut && !isEliteRestricted) {
                             setClickCoords({ x: e.clientX, y: e.clientY });
                             handleAddToCart(item);
                           }
                         }}
                         disabled={isSoldOut || isEliteRestricted}
                         className={`px-6 py-1.5 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-md transition-all duration-300 border ${
                           isSoldOut ? 'bg-red-500/10 text-red-500 border-red-500/25 cursor-not-allowed' :
                           isEliteRestricted ? 'bg-white/5 text-white light:text-gray-900/20 border-white/5 cursor-not-allowed' :
                           addedId === itemId
                             ? 'bg-[#EF4F5F] text-white light:text-gray-900 border-[#EF4F5F] scale-105 shadow-[0_0_15px_rgba(239,79,95,0.4)]'
                             : 'bg-[#FFF5F6] border-[#EF4F5F]/60 text-[#EF4F5F] hover:bg-[#FFE3E5]'
                         }`}
                       >
                         {isSoldOut ? '✕' : isEliteRestricted ? '🔒' : addedId === itemId ? '✓ Added' : 'ADD'}
                       </button>
                     )}
                   </div>
                </div>
              </div>
            );

            return (
              <Tilt key={itemId} scale={1.01}>
                {isLocalVendor ? (
                  <div
                    onClick={() => {
                      window.open(getWhatsAppLink(item.name), '_blank');
                      fetch(`${API_URL}/api/restaurants/${restaurant.id || restaurant._id}/click`, { method: 'POST' }).catch(() => {});
                    }}
                    className="block cursor-pointer animate-fade-in"
                  >
                    {cardContent}
                  </div>
                ) : (
                  <Link href={`/products/${itemId}`}>
                    {cardContent}
                  </Link>
                )}
              </Tilt>
            );
          })}
        </div>
      </div>

      {/* 🍟 Flying Item Animation */}
      {flyingItem && (
        <motion.div
          className="fixed z-[9999] pointer-events-none rounded-full overflow-hidden bg-white border border-[#E4002B]/20 shadow-lg flex items-center justify-center"
          initial={{
            x: flyingItem.startX - 24,
            y: flyingItem.startY - 24,
            scale: 1,
            opacity: 1
          }}
          animate={{
            x: typeof window !== 'undefined' ? window.innerWidth / 2 - 24 : 200,
            y: typeof window !== 'undefined' ? window.innerHeight - 80 : 600,
            scale: 0.2,
            opacity: [1, 0.8, 0.4, 0]
          }}
          transition={{
            duration: 1.0,
            ease: [0.25, 1, 0.5, 1]
          }}
          onAnimationComplete={() => {
            setFlyingItem(null);
            setCartBounce(true);
            setTimeout(() => setCartBounce(false), 500);
          }}
          style={{ width: 48, height: 48 }}
        >
          <img
            src={flyingItem.imageUrl}
            alt="Flying Item"
            className="w-full h-full object-cover"
          />
        </motion.div>
      )}

      {/* Floating Cart */}
      <AnimatePresence>
        {!isLocalVendor && (totalItems > 0 || restaurant.name.toLowerCase().includes('kfc')) && (
          <motion.div
            initial={{ y: 250, opacity: 0 }}
            animate={{ 
              y: 0, 
              opacity: 1,
              scale: cartBounce ? [1, 1.15, 0.95, 1.05, 1] : 1
            }}
            exit={{ y: 250, opacity: 0 }}
            transition={{
              y: { type: 'spring', damping: 15, stiffness: 180 },
              scale: { duration: 0.5, ease: "easeInOut" }
            }}
            className={restaurant.name.toLowerCase().includes('kfc')
              ? "fixed bottom-0 left-1/2 -translate-x-1/2 z-50 pointer-events-auto flex justify-center pb-2"
              : "fixed bottom-6 right-6 left-6 z-50 pointer-events-auto"
            }
          >
            {restaurant.name.toLowerCase().includes('kfc') ? (
              /* ═══════════════════════════════════════
                 ANIMATED CSS KFC BUCKET — realistic
                 ═══════════════════════════════════════ */
              <Link
                href="/basket"
                onMouseMove={onBucketMouseMove}
                onMouseLeave={onBucketMouseLeave}
                className="relative flex flex-col items-center justify-end w-52 h-64 mx-auto cursor-pointer select-none"
                style={{ perspective: 1200 }}
              >
                {/* ── Steam wisps ── */}
                <div className="absolute top-6 left-1/2 -translate-x-1/2 flex gap-3 pointer-events-none z-20">
                  {[
                    { delay: 0,   dur: 2.2, x: [0,-8,8,0]  },
                    { delay: 0.6, dur: 2.6, x: [0, 9,-9,0] },
                    { delay: 0.3, dur: 2.0, x: [0,-6,6,0]  },
                  ].map((s, i) => (
                    <motion.div
                      key={i}
                      className="w-1 h-10 bg-white/35 rounded-full"
                      style={{ filter: 'blur(3px)' }}
                      animate={{ y: [-4, -36], x: s.x, opacity: [0, 0.85, 0.4, 0] }}
                      transition={{ repeat: Infinity, duration: s.dur, delay: s.delay, ease: 'easeInOut' }}
                    />
                  ))}
                </div>

                {/* ── Particle burst on item drop ── */}
                {cartBounce && (
                  <div className="absolute top-12 left-1/2 -translate-x-1/2 pointer-events-none z-30">
                    {[...Array(18)].map((_, i) => {
                      const a = (i / 18) * Math.PI * 2;
                      const v = 45 + Math.random() * 75;
                      return (
                        <motion.div key={i}
                          className="absolute rounded-full"
                          style={{
                            width: 6 + Math.random() * 4,
                            height: 6 + Math.random() * 4,
                            background: i % 3 === 0 ? '#E4002B' : i % 3 === 1 ? '#fff' : '#ffd700',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.3)'
                          }}
                          initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
                          animate={{ x: Math.cos(a)*v, y: -Math.sin(a)*v - 30, scale: [1,1.3,0], opacity: [1,0.8,0] }}
                          transition={{ duration: 0.65, ease: 'easeOut' }}
                        />
                      );
                    })}
                  </div>
                )}

                {/* ── Contact shadow ── */}
                <motion.div
                  className="absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full pointer-events-none -z-10"
                  style={{ width: 110, height: 12, background: 'rgba(0,0,0,0.5)', filter: 'blur(7px)' }}
                  animate={{ scaleX: cartBounce ? 1.35 : 1, opacity: cartBounce ? 0.8 : 0.38 }}
                  transition={{ duration: 0.3 }}
                />

                {/* ══ 3D TILT WRAPPER ══ */}
                <motion.div
                  animate={{
                    rotateX: tiltX,
                    rotateY: tiltY,
                    scaleX: cartBounce ? [1, 1.16, 0.88, 1.05, 1] : 1,
                    scaleY: cartBounce ? [1, 0.82, 1.13, 0.95, 1] : 1,
                    rotateZ: cartBounce ? [0, -4, 4, -1.5, 0] : 0,
                  }}
                  transition={{
                    rotateX: { type: 'spring', damping: 22, stiffness: 230 },
                    rotateY: { type: 'spring', damping: 22, stiffness: 230 },
                    default: { duration: 0.55, ease: 'easeInOut' },
                  }}
                  style={{ transformStyle: 'preserve-3d', filter: 'drop-shadow(0 20px 30px rgba(0,0,0,0.6))' }}
                  className="relative flex flex-col items-center"
                >
                  {/* ── Metal handle (CSS arc via border-radius + overflow clip) ── */}
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      top: -28,
                      width: 120,
                      height: 50,
                      border: '3px solid #b0b0b0',
                      borderBottom: 'none',
                      borderRadius: '60px 60px 0 0',
                      background: 'transparent',
                      boxShadow: 'inset 0 6px 8px rgba(255,255,255,0.4)',
                    }}
                  />

                  {/* ── Rim (top ellipse / opening) ── */}
                  <div
                    className="relative z-20"
                    style={{
                      width: 152,
                      height: 22,
                      background: 'linear-gradient(180deg, #e8e8e8 0%, #c0c0c0 100%)',
                      borderRadius: '50%',
                      marginBottom: -6,
                      boxShadow: '0 3px 8px rgba(0,0,0,0.3), inset 0 -3px 6px rgba(0,0,0,0.2)',
                      border: '1px solid #aaa',
                    }}
                  >
                    {/* dark hollow inside */}
                    <div
                      className="absolute inset-[3px] rounded-full overflow-hidden"
                      style={{ background: 'radial-gradient(ellipse at center, rgba(180,100,0,0.25) 0%, #0a0a0a 70%)' }}
                    />
                  </div>

                  {/* ══ BUCKET BODY — matches reference: white with left+right red edge stripes ══ */}
                  <div
                    className="relative overflow-hidden"
                    style={{
                      width: 152,
                      height: 148,
                      clipPath: 'polygon(5% 0%, 95% 0%, 100% 100%, 0% 100%)',
                      background: 'linear-gradient(90deg, #d0d0d0 0%, #f8f8f8 8%, #ffffff 18%, #ffffff 82%, #f5f5f5 92%, #c8c8c8 100%)',
                    }}
                  >
                    {/* LEFT red band — on the far left edge of bucket */}
                    <div
                      className="absolute top-0 bottom-0"
                      style={{
                        left: 0,
                        width: '22%',
                        background: 'linear-gradient(90deg, #b8001a 0%, #E4002B 70%, #E4002B 100%)',
                        transform: 'skewX(-2deg)',
                        transformOrigin: 'top',
                      }}
                    />

                    {/* RIGHT red band — on the far right edge of bucket */}
                    <div
                      className="absolute top-0 bottom-0"
                      style={{
                        right: 0,
                        width: '22%',
                        background: 'linear-gradient(90deg, #E4002B 0%, #E4002B 30%, #b8001a 100%)',
                        transform: 'skewX(2deg)',
                        transformOrigin: 'top',
                      }}
                    />

                    {/* ── Colonel Sanders logo (large, centred) ── */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center z-10" style={{ gap: 2 }}>
                      <img
                        src="/assets/kfc_logo.png"
                        alt="KFC"
                        className="object-contain"
                        style={{ width: 68, height: 68, filter: 'contrast(1.3) brightness(0.85)' }}
                        draggable={false}
                      />
                      <span
                        style={{
                          fontFamily: "Georgia, 'Times New Roman', serif",
                          fontStyle: 'italic',
                          fontWeight: 900,
                          fontSize: 17,
                          color: '#0d0d0d',
                          letterSpacing: 4,
                          lineHeight: 1,
                        }}
                      >
                        KFC
                      </span>
                    </div>

                    {/* ── Animated gloss sweep ── */}
                    <motion.div
                      className="absolute inset-0 pointer-events-none z-20"
                      style={{
                        background: 'linear-gradient(118deg, transparent 22%, rgba(255,255,255,0.65) 48%, rgba(255,255,255,0.65) 52%, transparent 78%)',
                      }}
                      animate={{ x: ['-130%', '130%'], opacity: [0, 0.9, 0] }}
                      transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut', repeatDelay: 2.5 }}
                    />

                    {/* ── Cursor specular highlight ── */}
                    <div
                      className="absolute inset-0 pointer-events-none z-20"
                      style={{
                        background: `radial-gradient(circle at ${shineX}% ${shineY}%, rgba(255,255,255,0.55) 0%, transparent 48%)`,
                        mixBlendMode: 'overlay',
                      }}
                    />

                    {/* Bottom edge shadow */}
                    <div
                      className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none"
                      style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.1))' }}
                    />
                  </div>
                </motion.div>

                {/* ── Status bar ── */}
                <motion.div
                  className="mt-3 bg-black/90 backdrop-blur-md text-white px-5 py-2 rounded-2xl border border-white/10 flex items-center gap-3 z-20"
                  style={{ boxShadow: '0 5px 20px rgba(0,0,0,0.6)' }}
                  animate={{ scale: cartBounce ? [1, 1.08, 1] : 1 }}
                  transition={{ duration: 0.4 }}
                >
                  <motion.span
                    className="bg-[#E4002B] text-white text-[10px] font-black rounded-full w-5 h-5 flex items-center justify-center border border-white/20"
                    animate={{ scale: cartBounce ? [1, 1.6, 1] : 1 }}
                    transition={{ duration: 0.4 }}
                  >
                    {totalItems}
                  </motion.span>
                  <span className="text-[9px] font-black uppercase tracking-[0.22em] whitespace-nowrap">
                    View Basket
                  </span>
                </motion.div>
              </Link>
            ) : (
              /* Default Premium Cart Bar */
              <Link
                href="/basket"
                className={`h-16 text-black rounded-full flex items-center justify-between px-8 shadow-2xl active:scale-95 transition-all ${
                  brand
                    ? 'shadow-black/50'
                    : 'bg-gradient-to-r from-[#C9A84C] via-[#E8D18C] to-[#C9A84C] shadow-[#C9A84C]/30'
                }`}
                style={brand ? {
                  background: `linear-gradient(90deg, ${brand.primaryColor}, ${brand.accentColor})`,
                  color: brand.secondaryColor || '#000000'
                } : {}}
              >
                <div className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-black text-white light:text-gray-900 text-[11px] font-black flex items-center justify-center">{totalItems}</span>
                  <span className="font-black uppercase tracking-widest text-[11px]">View Basket</span>
                </div>
                <span className="font-black text-sm">Proceed →</span>
              </Link>
            )}
          </motion.div>
        )}
      </AnimatePresence>

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
