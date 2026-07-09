"use client";
import { useState, useEffect, useMemo, useRef } from 'react';
import { useWorldTransition } from '@/context/WorldTransitionContext';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import RestaurantCard from '@/components/RestaurantCard';
import { motion, AnimatePresence } from 'framer-motion';
import SafeImage from '@/components/SafeImage';
import PromoCarousel from '@/components/PromoCarousel';

// Heavy Components Dynamic Import
const ConciergeDrawer = dynamic(() => import('@/components/ConciergeDrawer'), { ssr: false });
const SearchOverlay = dynamic(() => import('@/components/SearchOverlay'), { ssr: false });
const IntroOverlay = dynamic(() => import('@/components/IntroOverlay'), { ssr: false });
const ZenvyVault = dynamic(() => import('@/components/ZenvyVault'), { ssr: false });
const NexusExplorer = dynamic(() => import('@/components/NexusExplorer'), { ssr: false });
const CampusBitesSection = dynamic(() => import('@/components/CampusBitesSection'), { ssr: false });
import LiveOrderStatusBar from '@/components/LiveOrderStatusBar';
import ScrollProgressIndicator from '@/components/ScrollProgressIndicator';
import Magnetic from '@/components/Magnetic';
import { calculateRoadDistance } from '@/utils/logistics';
import SupportModal from '@/components/SupportModal';
import RatingModal from '@/components/RatingModal';
import ZenvyModal from '@/components/ZenvyModal';
import Tilt from '@/components/Tilt';
import socket from '@/utils/socket';
import { Restaurant, User, NexusItem } from '@/types';
import RewardsPanel from '@/components/RewardsPanel';
import NexusLeaderboard from '@/components/NexusLeaderboard';
import SurgeBanner from '@/components/SurgeBanner';
// import GlobalAnnouncement from '@/components/GlobalAnnouncement';
import Navbar from '@/components/Navbar';
import RecentlyViewed from '@/components/RecentlyViewed';
import { API_URL } from '@/utils/api';
// QRCodeSVG removed to resolve linting errors

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

interface RentalItem {
  id?: string;
  name?: string;
  price?: number;
  imageUrl?: string;
  tags?: string[];
  restaurantName?: string;
  category?: string;
  specs?: { engine?: string; topSpeed?: string; power?: string; fuel?: string };
  ownerName?: string;
  ownerPhone?: string;
}

interface Order {
  _id: string;
  id?: string;
  status: string;
  totalPrice?: number;
  items?: { name: string; quantity: number; image?: string }[];
  restaurant?: string;
  restaurantId?: string;
  deliverySlot?: string;
  cancelSecondsLeft?: number;
  createdAt?: string;
}

export default function Home() {
  const { triggerTransition } = useWorldTransition();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { cart: _cart } = useCart();
  const [filter, setFilter] = useState<'all' | 'budget' | 'veg' | 'jain' | 'eggless' | 'rating' | 'fastest' | 'premium'>('all');
  const [liveRestaurants, setLiveRestaurants] = useState<Restaurant[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [userName, setUserName] = useState('');
  const [notifications, setNotifications] = useState<Array<{ id: number; title: string; message: string; time: string; type: 'promo' | 'info' | 'system' }>>([
    { id: 1, title: 'Welcome to Zenvy!', message: 'Explore the best gourmet picks in Amaravathi.', time: 'Just now', type: 'system' },
    { id: 2, title: 'Elite Membership', message: 'You are now a Verified Gourmet. Upgrade to Elite for free delivery!', time: '2h ago', type: 'promo' }
  ]);
  const [isAfter9] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showIntro, setShowIntro] = useState<boolean | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isElite, setIsElite] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [activeCategory, _setActiveCategory] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRental, setSelectedRental] = useState<RentalItem | null>(null);
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [cancelSecondsLeft, setCancelSecondsLeft] = useState(0);
  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);
  const [aiPicks, setAiPicks] = useState<any[]>([]);
  // favorites moved down for grouping
  const [sortBy, setSortBy] = useState<'default' | 'price-asc' | 'price-desc' | 'rating' | 'fastest'>('default');
  const [favSort, setFavSort] = useState<'default' | 'price-asc' | 'price-desc' | 'name'>('default');
  const [restaurantSearch, setRestaurantSearch] = useState('');
  const [showConcierge, setShowConcierge] = useState(false);
  const [systemStatus, setSystemStatus] = useState<{ maintenance: boolean; campusOpen: boolean }>({ maintenance: false, campusOpen: true });
  const gymMode = false;
  
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
    onConfirm?: () => void;
    confirmLabel?: string;
    cancelLabel?: string;
  }>({
    isOpen: false,
    title: '',
    message: '',
  });

  const showModal = (
    title: string, 
    message: string, 
    type: 'info' | 'success' | 'warning' | 'error' = 'info',
    onConfirm?: () => void,
    confirmLabel?: string,
    cancelLabel?: string
  ) => {
    setModalConfig({ isOpen: true, title, message, type, onConfirm, confirmLabel, cancelLabel });
  };

  const hasFetchedRef = useRef(false);
  const userRef = useRef<User | null>(user);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    
    setMounted(true);
    // Check if user has seen the cinematic intro this session
    const hasSeenIntro = sessionStorage.getItem('zenvy_intro_seen');
    setShowIntro(!hasSeenIntro);

    // Initial mount hydration
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.name) setUserName(parsed.name);
        setIsElite(parsed.isElite || false);
        setUser(parsed);
      }
      const storedFavs = localStorage.getItem('zenvy_favorites');
      if (storedFavs) setFavorites(JSON.parse(storedFavs));
    } catch { /* ignore */ }

    // Check backend mode and active orders
    const checkStatus = async () => {
      try {
        const token = 'cookie-managed';
        if (!token) return;
        
        const res = await fetch(`${API_URL}/api/users/profile`, {
          });

        if (res.status === 401) {
          const data = await res.json();
          if (data.message && (data.message.includes('Account not found') || data.message.includes('token failed'))) {
            // Grace period: Render cold-start can cause a spurious 401.
            // Wait 4s and retry once before logging the user out.
            setTimeout(async () => {
              try {
                const retry = await fetch(`${API_URL}/api/users/profile`, {
                  });
                if (retry.status === 401) {
                  console.error('[AUTH] Session confirmed invalid. Clearing.');
                  
                  localStorage.removeItem('user');
                  window.location.href = '/login/?error=session_expired';
                }
              } catch { /* network error — keep session alive */ }
            }, 4000);
          }
        }
      } catch (_err) {
        console.warn('[AUTH_CHECK] Background status check failed:', _err);
      }
    };

    checkStatus();
    
    // Asset Discovery Engine: Sync with Nexus Command Center
    const fetchLiveAssets = async () => {
      try {
        const res = await fetch(`${API_URL}/api/users/restaurants`);
        const data = await res.json();
        if (Array.isArray(data)) setLiveRestaurants(data);
      } catch (_err) {
        console.error('[ASSET_SYNC_ERROR]', _err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchLiveAssets();

    // F11: Fetch AI Picks
    const fetchAIPicks = async () => {
      try {
        const token = 'cookie-managed';
        if (!token) return;
        const res = await fetch(`${API_URL}/api/features/recommendations`, {
        });
        const data = await res.json();
        if (data.picks && Array.isArray(data.picks)) {
          setAiPicks(data.picks);
        }
      } catch (err) {
        console.warn('[AI_PICKS_ERROR]', err);
      }
    };
    fetchAIPicks();
    
    // Simulate finding an active order (for UX demo)
    const storedOrder = localStorage.getItem('last_order');
    if (storedOrder) {
      const parsed = JSON.parse(storedOrder);
      setActiveOrder(parsed);
      // Calculate remaining cancellation window (2 min = 120s)
      if (parsed.createdAt) {
        const elapsed = (Date.now() - new Date(parsed.createdAt).getTime()) / 1000;
        const remaining = Math.max(0, 120 - Math.round(elapsed));
        setCancelSecondsLeft(remaining);
      } else {
        setCancelSecondsLeft(120);
      }
    }

    // Simulate loading for UX polish


    // Fetch Global Configuration
    const fetchConfig = async () => {
      try {
        const res = await fetch(`${API_URL}/api/users/config`);
        const data = await res.json();
        if (Array.isArray(data)) {
          const maintenance = data.find(c => c.key === 'maintenance_mode')?.value === true;
          const campusOpen = data.find(c => c.key === 'campus_open')?.value !== false;
          setSystemStatus({ maintenance, campusOpen });
        }
      } catch (err) { console.error('[CONFIG_SYNC_ERROR]', err); }
    };
    fetchConfig();

    return () => {

    };
  }, []);


  useEffect(() => {
    const handleSystemUpdate = (payload: { type: string; data: any }) => {
      const currentUser = userRef.current;
      if (!currentUser) return;
      
      if (payload.type === 'USER_ELITE_STATUS') {
        const userId = currentUser._id || currentUser.id;
        if (payload.data.userId === userId) {
          setIsElite(payload.data.isElite);
          const stored = localStorage.getItem('user');
          if (stored) {
            const parsed = JSON.parse(stored);
            parsed.isElite = payload.data.isElite;
            localStorage.setItem('user', JSON.stringify(parsed));
          }
        }
      } else if (payload.type === 'USER_UPDATED') {
        const userId = currentUser._id || currentUser.id;
        if (payload.data.userId === userId) {
          // Re-fetch full profile to ensure data integrity and avoid "vanishing info"
          fetch(`${API_URL}/api/users/profile`).then(res => res.json()).then(data => {
            if (data && (data._id || data.id)) {
              // Ensure we have BOTH id and _id to prevent vanishing info in components
              const normalizedUser = { ...data, id: data.id || data._id, _id: data._id || data.id };
              setUser(normalizedUser);
              localStorage.setItem('user', JSON.stringify(normalizedUser));
            }
          }).catch(err => console.error('[WALLET_SYNC_ERROR]', err));
        }
      } else if (payload.type === 'RESTAURANT_CREATED') {
        const newRes = payload.data as Restaurant;
        setLiveRestaurants(prev => {
          const exists = prev.some(r => (r._id || r.id) === (newRes._id || newRes.id));
          if (exists) return prev;
          return [...prev, newRes];
        });
      } else if (payload.type === 'RESTAURANT_UPDATED') {
        const updatedRes = payload.data as Restaurant;
        setLiveRestaurants(prev => prev.map(r => 
          (r._id || r.id) === (updatedRes._id || updatedRes.id) ? updatedRes : r
        ));
      }
    };

    const handleGlobalConfigUpdate = (payload: { key: string; value: any }) => {
      if (payload.key === 'maintenance_mode') {
        setSystemStatus(prev => ({ ...prev, maintenance: payload.value === true }));
      } else if (payload.key === 'campus_open') {
        setSystemStatus(prev => ({ ...prev, campusOpen: payload.value !== false }));
      }
    };

    socket.on('systemUpdate', handleSystemUpdate);
    socket.on('GLOBAL_CONFIG_UPDATED', handleGlobalConfigUpdate);
    return () => { 
      socket.off('systemUpdate', handleSystemUpdate); 
      socket.off('GLOBAL_CONFIG_UPDATED', handleGlobalConfigUpdate);
    };
  }, []);

  // Tick down cancellation countdown removed from Home to avoid global re-renders

  const cancelActiveOrder = async () => {
    if (!activeOrder) return;
    
    // We compute elapsed inline rather than relying on heavy global state tick
    const elapsed = activeOrder.createdAt ? (Date.now() - new Date(activeOrder.createdAt).getTime()) / 1000 : 0;
    if (elapsed > 120) {
      showModal('Cannot Cancel', 'The 2-minute cancellation window has closed.', 'warning');
      return;
    }
    
    showModal(
      'Cancel Order?', 
      'Are you sure you want to cancel your current order? This action cannot be undone.',
      'warning',
      async () => {
        try {
          const orderId = activeOrder?._id || activeOrder?.id;
          if (orderId) {
            await fetch(`${API_URL}/api/orders/${orderId}/cancel`, {
              method: 'PUT',
              headers: {  'Content-Type': 'application/json' }
            });
          }
        } catch (_err) {
          console.warn('[CANCEL_ORDER] Backend cancellation failed:', _err);
        }
        setActiveOrder(null);
        setCancelSecondsLeft(0);
        localStorage.removeItem('last_order');
      },
      'Yes, Cancel',
      'Keep Order'
    );
  };

  const handleRatingSubmit = async (rating: number, review: string) => {
    try {
      const orderId = activeOrder?._id || activeOrder?.id;
      if (!orderId) return;

      await fetch(`${API_URL}/api/orders/${orderId}/rate`, {
        method: 'PUT',
        headers: { 
          
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ rating, review })
      });

      // Update local wallet/points for UX
      if (user) {
        const updatedUser = { ...user, zenPoints: (user.zenPoints || 0) + 10 };
        setUser(updatedUser);
        localStorage.setItem('user', JSON.stringify(updatedUser));
      }
    } catch (_err) {
      console.error('[RATING_ERROR] Rating failed:', _err);
    }
  };

  const handleJoinElite = async () => {
    try {
      const token = 'cookie-managed';
      if (!token) {
        showModal('Login Required', 'Please login to join Zenvy Elite!', 'error');
        return;
      }

      const res = await fetch(`${API_URL}/api/users/profile`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          },
        body: JSON.stringify({ isElite: true })
      });
      const data = await res.json();
      if (res.ok) {
        setIsElite(true);
        setUser(data);
        localStorage.setItem('user', JSON.stringify(data));
        showModal('Welcome to Elite! 💎', 'You have successfully joined Zenvy Elite. Enjoy unlimited free delivery on all orders.', 'success');
      }
    } catch (_err) {
      console.error('[ELITE_ERROR] Failed to join elite:', _err);
    }
  };

  // Lock body scroll when rental modal is open
  useEffect(() => {
    if (selectedRental) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [selectedRental]);

  const handleIntroComplete = () => {
    sessionStorage.setItem('zenvy_intro_seen', 'true');
    setShowIntro(false);
  };

  const handlePrizeWin = (prize: { type: string; value: string | number }) => {
    if (prize.type === 'points') {
      const updatedUser = user ? { ...user, zenPoints: (user.zenPoints || 0) + (prize.value as number) } : null;
      if (updatedUser) {
        setUser(updatedUser);
        localStorage.setItem('user', JSON.stringify(updatedUser));
      }
      showModal(`Congratulations! 🏆`, `You won ${prize.value} ZenPoints. Your new balance is ${updatedUser?.zenPoints || 0}.`, 'success');
    } else {
      showModal(`Exclusive Coupon! 🏷️`, `You've unlocked the code [${prize.value}]. It's been copied to your clipboard!`, 'success');
      navigator.clipboard.writeText(prize.value as string);
    }
  };

  const toggleFavorite = (idOrItem: string | Record<string, unknown>) => {
    const id = (typeof idOrItem === 'string' ? idOrItem : (idOrItem?.id || idOrItem?._id)) as string;
    if (!id) return;
    setFavorites(prev => {
      const next = prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id];
      localStorage.setItem('zenvy_favorites', JSON.stringify(next));
      return next;
    });
  };

  // --- Smart Market Engine: Unified Tag-Based Catalog (NO DIET FILTER here) ---
  // This powers pharmacy, laundry, gym, drinks etc. — diet filter must NOT affect them.
  const allProducts = useMemo(() => {
    return liveRestaurants.flatMap(res => 
      (res.menu || []).map(item => {
        const itemPrice = Number(item.price) || 0;
        const isVeg = !!(item.isVegetarian || String(item.isVegetarian) === 'true' || Number(item.isVegetarian) === 1 || item.tags?.includes('veg') || item.tags?.includes('fruits'));
        
        return { 
          ...item, 
          price: itemPrice,
          isVegetarian: isVeg,
          restaurantName: res.name, 
          restaurantId: res._id || res.id,
          vendorType: res.vendorType,
          tags: Array.isArray(item.tags) ? item.tags : []
        };
      })
    ).filter(p => {
      // Only remove unavailable items globally — dietary filter is NOT applied here
      if (p.isAvailable === false || String(p.isAvailable) === 'false') return false;
      return true;
    }).sort((a, b) => {
      if (sortBy === 'price-asc') return a.price - b.price;
      if (sortBy === 'price-desc') return b.price - a.price;
      return 0;
    });
  }, [liveRestaurants, sortBy]);

  // Grouped Collections Driven by Tags (Optimized Single-Pass Engine)
  const groupedCollections = useMemo(() => {
    const collections: Record<string, typeof allProducts> = {
      fruits: [], rentals: [], sweets: [], seasonal: [], drinks: [],
      gym: [], laundry: [], pharmacy: [], stationary: [], all: allProducts
    };

    allProducts.forEach(p => {
      const tags = p.tags || [];
      const vt = p.vendorType;
      if (tags.includes('fruits') || vt === 'GROCERY') collections.fruits.push(p);
      if (tags.includes('rental') || vt === 'RENTAL') collections.rentals.push(p);
      if (tags.includes('sweets') || vt === 'SWEETS') collections.sweets.push(p);
      if (tags.includes('seasonal') || vt === 'SEASONAL') collections.seasonal.push(p);
      if (tags.includes('drinks') || vt === 'DRINKS') collections.drinks.push(p);
      if (tags.includes('gym') || tags.includes('high-protein') || vt === 'GYM') collections.gym.push(p);
      if (tags.includes('laundry') || tags.includes('dry-wash') || vt === 'LAUNDRY') collections.laundry.push(p);
      if (tags.includes('medicine') || tags.includes('pharmacy') || vt === 'PHARMACY') collections.pharmacy.push(p);
      if (tags.includes('stationary') || tags.includes('books') || tags.includes('print') || vt === 'STATIONARY') collections.stationary.push(p);
    });

    return collections;
  }, [allProducts]);
  
  const favoriteItems = useMemo(() => {
    return allProducts
      .filter(p => favorites.includes(p.id!))
      .sort((a, b) => {
        if (favSort === 'price-asc') return (a.price || 0) - (b.price || 0);
        if (favSort === 'price-desc') return (b.price || 0) - (a.price || 0);
        if (favSort === 'name') return (a.name || '').localeCompare(b.name || '');
        return 0;
      });
  }, [allProducts, favorites, favSort]);

  const chefPicks = useMemo(() => groupedCollections.all.slice(0, 8), [groupedCollections.all]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const filteredByCategory = useMemo(() => {
    return allProducts
      .filter(p => {
        if (!activeCategory) return false;
        const cat = activeCategory.toLowerCase();
        const tags = Array.isArray(p.tags) ? p.tags : [];
        return (
          (p.category || '').toLowerCase().includes(cat) ||
          tags.some(t => t.toLowerCase().includes(cat)) ||
          (p.name || '').toLowerCase().includes(cat)
        );
      })
      .sort((a, b) => {
        if (sortBy === 'price-asc') return (a.price || 0) - (b.price || 0);
        if (sortBy === 'price-desc') return (b.price || 0) - (a.price || 0);
        return 0;
      });
  }, [allProducts, activeCategory, sortBy]);

  const displayRestaurants = useMemo(() => {
    // Strictly show ONLY food restaurants in the main feed
    let list = liveRestaurants.filter(res => {
      const type = res.vendorType?.toUpperCase() || '';
      return type === 'FOOD' || type === 'RESTAURANT';
    });

    // Apply Hard Filters (Dietary/Type)
    if (filter === 'veg') list = list.filter(res => (res.menu || []).some(item => item.isVegetarian));
    if (filter === 'jain') list = list.filter(res => (res.menu || []).some(item => item.tags?.includes('jain')));
    if (filter === 'eggless') list = list.filter(res => (res.menu || []).some(item => item.tags?.includes('eggless')));
    if (filter === 'budget') list = list.filter(res => (res.menu || []).some(item => item.price < 150));
    if (filter === 'premium') list = list.filter(res => (res.menu || []).some(item => item.price > 500));

    if (gymMode) {
      list = list.filter(res => {
        const hasHealthyTags = res.tags?.includes('healthy') || res.tags?.includes('gym');
        if (hasHealthyTags) return true;
        return (res.menu || []).some(item => item.tags?.includes('healthy') || item.tags?.includes('high-protein'));
      });
    }

    if (restaurantSearch) {
      const query = restaurantSearch.toLowerCase();
      list = list.filter(res => {
        const matchesName = (res.name || '').toLowerCase().includes(query);
        const matchesMenu = (res.menu || []).some(i => (i.name || '').toLowerCase().includes(query));
        return matchesName || matchesMenu;
      });
    }

    const enrichedList = list.map(res => {
      let d = 5;
      let mins = 40;
      if (user?.defaultAddress || true) {
        try {
          const rCoords = { lat: Number(res.lat) || 16.4632, lon: Number(res.lon) || 80.5064 };
          const uCoords = { lat: 16.5062, lon: 80.6480 }; 
          d = calculateRoadDistance(rCoords.lat, rCoords.lon, uCoords.lat, uCoords.lon);
          mins = Math.round(d * 3 + 12);
        } catch (e) {
          console.error("Telemetry error:", e);
        }
      }
      
      const rating = Number(res.rating) || 4.0;
      const smartScore = (rating * 10) + (30 / (d + 1)) + (30 / (mins / 10 + 1));
      
      return { ...res, smartScore, calculatedTime: `${mins}-${mins+10} min`, distance: d, rating };
    });

    return enrichedList.sort((a, b) => {
      if (sortBy === 'price-asc') {
        const aMin = Math.min(...(a.menu || []).map(i => Number(i.price) || 9999), 9999);
        const bMin = Math.min(...(b.menu || []).map(i => Number(i.price) || 9999), 9999);
        return aMin - bMin;
      }
      if (sortBy === 'price-desc') {
        const aMax = Math.max(...(a.menu || []).map(i => Number(i.price) || 0), 0);
        const bMax = Math.max(...(b.menu || []).map(i => Number(i.price) || 0), 0);
        return bMax - aMax;
      }
      if (sortBy === 'rating') {
        return b.rating - a.rating;
      }
      if (sortBy === 'fastest') {
        const timeA = parseInt(String(a.calculatedTime || "40")) || 40;
        const timeB = parseInt(String(b.calculatedTime || "40")) || 40;
        return timeA - timeB;
      }
      
      return b.smartScore - a.smartScore;
    });
  }, [liveRestaurants, filter, gymMode, restaurantSearch, sortBy, user]);

  if (showIntro === null) return <div className="min-h-screen bg-black" />;

  return (
    <>
    <ScrollProgressIndicator />
    <main className={`min-h-screen pb-32 relative text-white light:text-gray-900 transition-colors duration-500 ${isAfter9 ? 'bg-[#050507] light:bg-[#F3F4F6]' : 'bg-[#0A0A0B] light:bg-white'}`}>
      {/* Background VFX Layer - Minimalist Optimized */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className={`absolute inset-0 opacity-60 transition-colors duration-1000 ${isAfter9 ? 'bg-[radial-gradient(circle_at_50%_0%,rgba(201,168,76,0.15),transparent_70%)]' : 'bg-[radial-gradient(circle_at_50%_0%,rgba(16,185,129,0.08),transparent_70%)]'}`} />
        
        {/* Cinematic Film Overlay */}
        <div className={`absolute inset-0 transition-opacity duration-1000 ${isAfter9 ? 'opacity-100' : 'opacity-0'}`}>
          <div className="film-grain" />
          <div className="luxury-mesh-overlay" />
          <div className="vfx-shimmer-ray" />
        </div>
        {/* Note: Global VFXParticles and Meteors are handled by the Root Layout */}
      </div>

      <SurgeBanner />
      {showIntro && <IntroOverlay onComplete={handleIntroComplete} />}
      
      {/* 🔒 System Lock Overlay (Maintenance/Closed) */}
      <AnimatePresence>
        {(systemStatus.maintenance || !systemStatus.campusOpen) && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-[#0A0A0B]/90 light:bg-white/90 backdrop-blur-2xl flex flex-col items-center justify-center p-8 text-center"
          >
            <div className="w-24 h-24 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-4xl mb-8 animate-pulse">
              {systemStatus.maintenance ? '🛠️' : '🌙'}
            </div>
            <h2 className="text-3xl font-black text-white italic uppercase tracking-tighter mb-4" style={{ fontFamily: "'Syne', sans-serif" }}>
              {systemStatus.maintenance ? 'Nexus Maintenance' : 'Campus Closed'}
            </h2>
            <p className="text-gray-400 text-sm font-bold uppercase tracking-widest max-w-sm leading-relaxed mb-10">
              {systemStatus.maintenance 
                ? 'We are currently upgrading the Nexus pipeline. Order transmission is temporarily suspended.' 
                : 'Campus operations are currently offline. We will resume at 09:00 AM.'}
            </p>
            <div className="flex flex-col gap-4 w-full max-w-xs">
              <button 
                onClick={() => window.location.reload()}
                className="w-full py-4 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] text-white hover:bg-white/10"
              >
                Retry Link Status
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Container for main content - simple opacity transition */}
      <div className={`min-h-screen transition-opacity duration-700 ${showIntro === false ? 'opacity-100' : 'opacity-0'} ${isAfter9 ? 'midnight-portal' : ''}`}>
        
        {/* Ambient Background Orbs */}
        <div className="fixed inset-0 pointer-events-none z-0">
          <div className={`absolute -top-40 -right-40 w-96 h-96 rounded-full blur-[120px] ${isAfter9 ? 'bg-[#C9A84C]/[0.06]' : 'bg-[#C9A84C]/[0.04]'}`} />
          <div className={`absolute top-1/3 -left-32 w-80 h-80 rounded-full blur-[100px] ${isAfter9 ? 'bg-[#C9A84C]/[0.05]' : 'bg-[#C9A84C]/[0.03]'}`} />
        </div>

        {/* Layout Grid: Content */}
        <div className="w-full relative z-10">
          {/* Main Feed Content */}
          <div className="w-full px-4 pt-10 pt-safe pb-4">
            <Navbar />
            
            <div className="mt-1 relative">
              {/* Tactical Background Decals */}
              <div className="absolute -top-16 left-0 flex flex-col gap-1 opacity-20 pointer-events-none hidden md:flex">
                <span className="text-[6px] font-black tracking-[0.4em] text-primary-yellow">SYS_OPERATIVE_LINK: ACTIVE</span>
                <span className="text-[6px] font-black tracking-[0.4em] text-white">LAT: 16.5062° N | LONG: 80.6480° E</span>
              </div>

              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
                <div className="flex flex-col">
                  <Link href="/profile" className="flex items-center gap-3 mb-2 group">
                    <div className={`w-12 h-12 rounded-2xl bg-[#1a1a1c] light:bg-white flex items-center justify-center border transition-all duration-300 group-hover:scale-105 overflow-hidden shadow-lg light:shadow-sm ${isElite ? 'vip-gold-halo border-transparent' : 'border-[#C9A84C]/40 light:border-[#C9A84C]/60 shadow-[0_0_15px_rgba(201,168,76,0.1)]'}`}>
                      {user?.profileImage && user.profileImage !== 'null' && user.profileImage !== 'undefined' ? (
                        <SafeImage src={user.profileImage} alt="Profile" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[14px] font-black text-[#C9A84C] tracking-tighter">
                          {userName ? userName.replace(/^(OP_|op_|Op_)/g, '').split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase() : 'ZM'}
                        </span>
                      )}
                    </div>
                    <div>
                      <h2 className="text-[9px] font-black uppercase tracking-[0.3em] text-secondary-text mb-0.5">
                        {mounted ? getGreeting() : 'Initializing...'}
                      </h2>
                      <div className="flex items-center gap-2 pr-32 md:pr-0">
                        <h1 className="text-2xl font-black tracking-widest uppercase truncate max-w-[200px] md:max-w-none bg-gradient-to-t from-orange-600 via-red-500 to-yellow-400 text-transparent bg-clip-text drop-shadow-[0_2px_10px_rgba(239,68,68,0.3)] animate-pulse" style={{ fontFamily: "'Syne', sans-serif" }}>
                          {userName ? userName.replace(/^(OP_|op_|Op_)/g, '').split(' ')[0].toUpperCase() : 'GUEST'}
                        </h1>
                        {isElite && (
                          <span className="bg-primary-yellow/10 text-primary-yellow text-[8px] font-black px-2 py-0.5 rounded-full border border-primary-yellow/20 tracking-tighter shrink-0">ELITE</span>
                        )}
                      </div>
                    </div>
                  </Link>
                </div>


              </div>
            </div>

            {/* Promo Carousel (Ads and Offers) */}
            <PromoCarousel 
              offers={[
                { 
                  id: '0', 
                  imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?q=80&w=1974&auto=format&fit=crop', 
                  tagline: 'MEGA BASKET', 
                  title1: 'YOUR ESSENTIALS', 
                  title2: 'DELIVERED TODAY', 
                  description: 'CREATE A CUSTOM SHOPPING LIST AND HAVE OUR PERSONAL SHOPPERS BUY AND DELIVER YOUR DAILY NEEDS.', 
                  buttonText: 'CREATE BASKET', 
                  isActive: true 
                },
                { 
                  id: '1', 
                  imageUrl: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=2070&auto=format&fit=crop', 
                  tagline: 'CENTRAL COMMAND', 
                  title1: "LET'S CLEAR", 
                  title2: 'YOUR CRAVING', 
                  description: 'MISSION-CRITICAL SPEED. ZERO FRICTION. DELIVERING ACROSS AMARAVATHI.', 
                  buttonText: 'IDENTIFY RESTAURANTS', 
                  isActive: true 
                },
                { 

                  id: '2', 
                  imageUrl: 'https://images.unsplash.com/photo-1618331835717-801e976710b2?q=80&w=2070&auto=format&fit=crop', 
                  tagline: 'NEXUS OFFERS', 
                  title1: 'UNLIMITED', 
                  title2: 'FREE DELIVERY', 
                  description: 'JOIN ZENVY ELITE TODAY. ZERO DELIVERY CHARGES ON ALL GOURMET ORDERS.', 
                  buttonText: 'CLAIM ELITE', 
                  isActive: true 
                },
                { 
                  id: '3', 
                  imageUrl: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?q=80&w=2070&auto=format&fit=crop', 
                  tagline: 'ZENVY CO-RIDE', 
                  title1: 'SPLIT THE RIDE', 
                  title2: 'SAVE THE FARE', 
                  description: 'CONNECT WITH CAMPUS PEERS FOR INSTANT BIKE POOLING. SECURE AND VERIFIED.', 
                  buttonText: 'FIND A RIDE', 
                  isActive: true 
                },
                { 
                  id: '4', 
                  imageUrl: 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?q=80&w=2069&auto=format&fit=crop', 
                  tagline: 'PREMIUM STAYS', 
                  title1: 'YOUR NEXT', 
                  title2: 'CAMPUS HOME', 
                  description: 'DISCOVER VERIFIED HOSTELS AND PG ACCOMMODATIONS. ZERO BROKERAGE, FULL TRANSPARENCY.', 
                  buttonText: 'EXPLORE HOSTELS', 
                  isActive: true 
                },
                { 
                  id: '5', 
                  imageUrl: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?q=80&w=2070&auto=format&fit=crop', 
                  tagline: 'ZENVY AI', 
                  title1: 'SMART BITES', 
                  title2: 'CURATED FOR YOU', 
                  description: "CAN'T DECIDE? LET OUR AI SUGGEST THE PERFECT MEAL BASED ON YOUR TASTE PROFILE.", 
                  buttonText: 'TRY AI PICKS', 
                  isActive: true 
                }
              ]} 
            />

            {/* Premium Category Grid */}
            <div className="grid grid-cols-4 gap-2 md:gap-4 mb-4 relative z-20">
               <a href="/" onClick={(e) => { e.preventDefault(); triggerTransition('/', 'food'); }} className="relative flex flex-row items-center justify-center md:justify-start md:px-4 gap-1.5 sm:gap-2.5 py-3 sm:py-4 rounded-[18px] bg-[#141416]/80 light:bg-white backdrop-blur-2xl border border-white/5 light:border-white shadow-lg light:shadow-[0_12px_24px_-8px_rgba(0,0,0,0.06)] hover:shadow-xl hover:-translate-y-0.5 active:scale-95 transition-all duration-400 group overflow-hidden cursor-pointer">
                  <div className="absolute inset-0 bg-gradient-to-r from-white/[0.02] to-transparent light:from-orange-50/40 light:to-transparent pointer-events-none" />
                  <div className="relative w-8 h-8 sm:w-12 sm:h-12 rounded-full bg-white light:bg-white border-2 border-[#C9A84C]/60 light:border-[#C9A84C] flex items-center justify-center group-hover:scale-110 group-hover:-rotate-3 transition-all duration-500 shadow-[0_0_10px_rgba(201,168,76,0.3)] overflow-hidden">
                    <SafeImage src="/assets/3d-burger.png" alt="Food" fill style={{ objectFit: 'cover' }} />
                  </div>
                  <span className="text-[7px] sm:text-[10px] font-black uppercase tracking-wider text-white light:text-gray-900 relative z-10 group-hover:text-gray-300 light:group-hover:text-[#EF4F5F] transition-colors truncate">Food</span>
               </a>
               <a href="/mega-basket" onClick={(e) => { e.preventDefault(); triggerTransition('/mega-basket', 'mega-basket'); }} className="relative flex flex-row items-center justify-center md:justify-start md:px-4 gap-1.5 sm:gap-2.5 py-3 sm:py-4 rounded-[18px] bg-[#141416]/80 light:bg-white backdrop-blur-2xl border border-white/5 light:border-white shadow-lg light:shadow-[0_12px_24px_-8px_rgba(0,0,0,0.06)] hover:shadow-xl hover:-translate-y-0.5 active:scale-95 transition-all duration-400 group overflow-hidden cursor-pointer">
                  <div className="absolute inset-0 bg-gradient-to-r from-white/[0.02] to-transparent light:from-emerald-50/40 light:to-transparent pointer-events-none" />
                  <div className="relative w-8 h-8 sm:w-12 sm:h-12 rounded-full bg-white light:bg-white border-2 border-[#C9A84C]/60 light:border-[#C9A84C] flex items-center justify-center group-hover:scale-110 group-hover:rotate-3 transition-all duration-500 shadow-[0_0_10px_rgba(201,168,76,0.3)] overflow-hidden text-lg sm:text-2xl">
                    🧺
                  </div>
                  <span className="text-[7px] sm:text-[10px] font-black uppercase tracking-wider text-white light:text-gray-900 relative z-10 group-hover:text-gray-300 light:group-hover:text-emerald-600 transition-colors truncate">Basket</span>
               </a>
               <a href="/pg" onClick={(e) => { e.preventDefault(); triggerTransition('/pg', 'pg'); }} className="relative flex flex-row items-center justify-center md:justify-start md:px-4 gap-1.5 sm:gap-2.5 py-3 sm:py-4 rounded-[18px] bg-[#141416]/80 light:bg-white backdrop-blur-2xl border border-white/5 light:border-white shadow-lg light:shadow-[0_12px_24px_-8px_rgba(0,0,0,0.06)] hover:shadow-xl hover:-translate-y-0.5 active:scale-95 transition-all duration-400 group overflow-hidden cursor-pointer">
                  <div className="absolute inset-0 bg-gradient-to-r from-white/[0.02] to-transparent light:from-blue-50/40 light:to-transparent pointer-events-none" />
                  <div className="relative w-8 h-8 sm:w-12 sm:h-12 rounded-full bg-white light:bg-white border-2 border-[#C9A84C]/60 light:border-[#C9A84C] flex items-center justify-center group-hover:scale-110 group-hover:rotate-3 transition-all duration-500 shadow-[0_0_10px_rgba(201,168,76,0.3)] overflow-hidden">
                    <SafeImage src="/assets/3d-hostel.png" alt="Hostels" fill style={{ objectFit: 'cover' }} />
                  </div>
                  <span className="text-[7px] sm:text-[10px] font-black uppercase tracking-wider text-white light:text-gray-900 relative z-10 group-hover:text-gray-300 light:group-hover:text-blue-600 transition-colors truncate">Hostels</span>
               </a>
               <a href="/bikepool" onClick={(e) => { e.preventDefault(); triggerTransition('/bikepool', 'bikepool'); }} className="relative flex flex-row items-center justify-center md:justify-start md:px-4 gap-1.5 sm:gap-2.5 py-3 sm:py-4 rounded-[18px] bg-[#141416]/80 light:bg-white backdrop-blur-2xl border border-white/5 light:border-white shadow-lg light:shadow-[0_12px_24px_-8px_rgba(0,0,0,0.06)] hover:shadow-xl hover:-translate-y-0.5 active:scale-95 transition-all duration-400 group overflow-hidden cursor-pointer">
                  <div className="absolute inset-0 bg-gradient-to-r from-white/[0.02] to-transparent light:from-purple-50/40 light:to-transparent pointer-events-none" />
                  <div className="relative w-8 h-8 sm:w-12 sm:h-12 rounded-full bg-white light:bg-white border-2 border-[#C9A84C]/60 light:border-[#C9A84C] flex items-center justify-center group-hover:scale-110 group-hover:-rotate-3 transition-all duration-500 shadow-[0_0_10px_rgba(201,168,76,0.3)] overflow-hidden">
                    <SafeImage src="/assets/3d-bike.png" alt="Co-Ride" fill style={{ objectFit: 'cover' }} />
                  </div>
                  <span className="text-[7px] sm:text-[10px] font-black uppercase tracking-wider text-white light:text-gray-900 relative z-10 group-hover:text-gray-300 light:group-hover:text-purple-600 transition-colors truncate">Co-Ride</span>
               </a>
            </div>

            <SearchOverlay isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
            <motion.div 
             whileTap={{ scale: 0.98 }}
             className="relative mb-2" 
             onClick={() => setIsSearchOpen(true)}
            >
             <Magnetic>
                <div className="w-full bg-[#141416]/80 light:bg-white py-6 pl-12 pr-4 text-xs text-white light:text-gray-500 font-black uppercase tracking-widest cursor-pointer rounded-3xl border-2 border-[#C9A84C] light:border-[#C9A84C] group shadow-2xl hover:shadow-[0_0_15px_rgba(201,168,76,0.3)] transition-all duration-300 relative overflow-hidden">
                   <div className="absolute inset-0 bg-[#C9A84C]/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                   <div className="flex items-center gap-4 relative z-10">
                      <span className="text-lg opacity-40 group-hover:opacity-100 group-hover:text-primary-yellow transition-all">🔍</span>
                      <span className="opacity-40 group-hover:opacity-100 transition-opacity">Search for dishes or restaurants...</span>
                   </div>
                </div>
             </Magnetic>
           </motion.div>

          {/* THE CLASSICS */}
          <div className="mt-8 mb-4 px-2">
            <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-400 light:text-gray-500 mb-5 px-2">The Classics</h3>
            <div className="flex gap-5 overflow-x-auto scrollbar-hide pb-2 px-2 snap-x">
              {[
                { name: 'Biryani', img: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=200&auto=format&fit=crop' },
                { name: 'Pizza', img: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?q=80&w=200&auto=format&fit=crop' },
                { name: 'Burgers', img: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?q=80&w=200&auto=format&fit=crop' },
                { name: 'South Indian', img: 'https://images.unsplash.com/photo-1610192131976-96b6c00e12cc?q=80&w=200&auto=format&fit=crop' },
                { name: 'Drinks', img: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?q=80&w=200&auto=format&fit=crop' },
                { name: 'Chinese', img: 'https://images.unsplash.com/photo-1585032226651-759b368d7246?q=80&w=200&auto=format&fit=crop' }
              ].map(classic => (
                <button 
                  key={classic.name}
                  onClick={() => { 
                    window.dispatchEvent(new CustomEvent('change-nexus-category', { detail: classic.name }));
                    document.getElementById('nexus-catalog')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="flex flex-col items-center gap-3 shrink-0 snap-start group"
                >
                  <div className="w-[72px] h-[72px] sm:w-[88px] sm:h-[88px] rounded-full overflow-hidden border-2 border-[#C9A84C]/40 light:border-[#C9A84C] group-hover:border-[#C9A84C] group-hover:shadow-[0_0_15px_rgba(201,168,76,0.3)] transition-all shadow-md bg-gray-100">
                    <SafeImage src={classic.img} alt={classic.name} width={88} height={88} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                  </div>
                  <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-gray-500 group-hover:text-white light:group-hover:text-black transition-colors">{classic.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 🔍 Nexus Explorer: Advanced Discovery Engine */}
          <div id="nexus-catalog" className="scroll-mt-24 mt-1">
            <NexusExplorer 
              restaurants={liveRestaurants}
              onSelectItem={(item: NexusItem) => {
                if (item && item.id) {
                  router.push(`/products/${item.id}`);
                }
              }}
              favorites={favorites}
              toggleFavorite={toggleFavorite}
            />
          </div>

          {/* 🔒 The Zenvy Vault (Daily FOMO Scarcity) */}
          <motion.section 
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mb-10"
          >
             <ZenvyVault />
          </motion.section>

          {/* All Restaurants List & Advanced Filters */}
          <div className="mb-8 px-6 space-y-4 pt-4">
              <div className="mb-4">
                 <h2 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight italic">All Restaurants</h2>
                 <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-0.5">Discover your campus favorites</p>
              </div>
              {/* Category Chips */}
              <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2">
                {['All', 'Veg', 'Premium', 'Budget', 'Jain', 'Eggless'].map(cat => (
                  <button 
                    key={cat}
                    onClick={() => setFilter(cat.toLowerCase() as 'all' | 'budget' | 'veg' | 'jain' | 'eggless' | 'rating' | 'fastest' | 'premium')}
                    className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all border ${filter === cat.toLowerCase() ? 'bg-primary-yellow text-black border-primary-yellow' : 'bg-white/5 text-secondary-text border-white/10 hover:border-white/20'}`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Search & Sort Controls */}
              <div className="flex flex-col md:flex-row gap-3">
                <div className="relative flex-1 group">
                  <input 
                    type="text"
                    placeholder="Instant search for restaurants or dishes..."
                    value={restaurantSearch}
                    onChange={(e) => setRestaurantSearch(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-xs font-bold tracking-wide outline-none focus:border-primary-yellow/40 transition-all placeholder:text-white/30 shadow-lg"
                  />
                  <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30 group-focus-within:text-primary-yellow/40 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                </div>
                
                <div className="relative shrink-0">
                  <select 
                    value={sortBy} 
                    onChange={(e) => setSortBy(e.target.value as 'default' | 'price-asc' | 'price-desc' | 'rating' | 'fastest')}
                    className="w-full md:w-auto h-full text-[10px] font-black uppercase tracking-widest bg-white/5 border border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-primary-yellow/40 appearance-none pr-10 text-white"
                    style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%23C9A84C\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M19 9l-7 7-7-7\' /%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 16px center', backgroundSize: '12px' }}
                  >
                    <option value="default" className="bg-[#141416]">Sort: Smart</option>
                    <option value="rating" className="bg-[#141416]">Top Rated</option>
                    <option value="fastest" className="bg-[#141416]">Fastest Delivery</option>
                    <option value="price-asc" className="bg-[#141416]">Price: Low to High</option>
                    <option value="price-desc" className="bg-[#141416]">Price: High to Low</option>
                  </select>
                </div>
              </div>
          </div>

          <section id="restaurant-feed" className="pb-20 scroll-mt-24">
            <div className="grid grid-cols-2 gap-3 md:gap-4 px-6">
              {[...displayRestaurants]
                .sort((a, b) => (b.isFeatured ? 1 : 0) - (a.isFeatured ? 1 : 0))
                .map((res, index) => (
                <div key={res._id || res.id} className="animate-slide-up" style={{ animationDelay: `${index * 0.05}s`, animationFillMode: 'both' }}>
                  <RestaurantCard 
                    id={res._id || res.id || ''}
                    name={res.name} 
                    rating={String(res.rating || "4.5")} 
                    time={res.calculatedTime || res.time || "30-50 min"}
                    imageUrl={res.imageUrl || "/assets/placeholder_premium.png"} 
                    imagePosition={index % 2 === 0 ? 'left' : 'right'}
                    isFeatured={res.isFeatured}
                    featuredBadge={res.featuredBadge}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* 🏪 CampusBites: Local Vendor Stalls */}
          <CampusBitesSection restaurants={liveRestaurants} />



          





        <div className="fixed bottom-28 right-6 z-[100] sm:hidden">
          <Link href="/community" onClick={(e) => { e.preventDefault(); triggerTransition('/community', 'comms'); }} className="w-14 h-14 rounded-full bg-black light:bg-white text-white light:text-gray-900 shadow-[0_8px_30px_rgba(0,0,0,0.2)] light:shadow-[0_8px_30px_rgba(0,0,0,0.1)] flex items-center justify-center hover:scale-110 active:scale-95 transition-transform group border-2 border-red-500 light:border-red-500 relative focus:outline-none">
            <svg className="w-6 h-6 group-hover:animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" /></svg>
            <div className="absolute top-0 right-0 w-3.5 h-3.5 bg-rose-500 rounded-full border-2 border-black light:border-white"></div>
          </Link>
        </div>
        <footer className="fixed bottom-0 left-0 right-0 h-[5.5rem] bg-black text-white border-t border-white/10 flex items-center justify-around sm:hidden z-[100] pb-safe shadow-none">
          <Magnetic>
            <Link href="/" className="flex flex-col items-center gap-1.5 text-[#EF4F5F]">
              <div className="tab-pill text-[#EF4F5F]">
                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
              </div>
              <span className="text-[12px] font-black uppercase tracking-widest text-[#EF4F5F]">Home</span>
            </Link>
          </Magnetic>
          <Magnetic>
            <Link href="/others" onClick={(e) => { e.preventDefault(); triggerTransition('/others', 'others'); }} className="flex flex-col items-center gap-1.5 text-gray-400 hover:text-white transition-colors">
               <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
               <span className="text-[12px] font-bold">Others</span>
            </Link>
          </Magnetic>
          <Magnetic>
            <Link href="/orders" className="flex flex-col items-center gap-1.5 text-gray-400 hover:text-white transition-colors">
               <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
               <span className="text-[12px] font-bold">Orders</span>
            </Link>
          </Magnetic>
          <Magnetic>
            <Link href="/basket" className="flex flex-col items-center gap-1.5 text-gray-400 hover:text-white transition-colors">
               <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>
               <span className="text-[12px] font-bold">Basket</span>
            </Link>
          </Magnetic>
          <Magnetic>
            <Link href="/profile" className="flex flex-col items-center gap-1.5 text-gray-400 hover:text-white transition-colors">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                <span className="text-[12px] font-bold">Profile</span>
            </Link>
          </Magnetic>
        </footer>

        {/* 🛵 Live Order Status Bar */}
        {activeOrder && (
          <LiveOrderStatusBar
            orderId={activeOrder._id || activeOrder.id || 'SRM_DEV_ORDER_1'}
            initialStatus={activeOrder.status || 'Pending'}
            cancelSecondsLeft={cancelSecondsLeft}
            onCancel={cancelActiveOrder}
            onDelivered={() => setIsRatingModalOpen(true)}
          />
        )}

        <RatingModal
          isOpen={isRatingModalOpen}
          onClose={() => setIsRatingModalOpen(false)}
          onSubmit={handleRatingSubmit}
        />

       <ZenvyModal 
          {...modalConfig} 
          onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))} 
        />

        {/* ─── Notification Drawer ─── */}
        {typeof document !== 'undefined' && showNotifications && createPortal(
          <div className="fixed inset-0 z-[1000] flex justify-end">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowNotifications(false)} />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="w-full max-w-[320px] bg-[#0A0A0B] light:bg-white border-l border-white/5 light:border-gray-200 h-full relative z-10 p-6 shadow-2xl flex flex-col"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-sm font-black uppercase tracking-[0.3em] text-gold-gradient">Nexus Alerts</h3>
                <button onClick={() => setShowNotifications(false)} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-xs">✕</button>
              </div>
              
              <div className="flex-1 space-y-4 overflow-y-auto pr-2 custom-scrollbar">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 opacity-20">
                    <span className="text-4xl mb-2">🔭</span>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-center leading-relaxed">System frequency clear.<br/>No pending alerts.</p>
                  </div>
                ) : (
                  notifications.map(n => (
                    <div key={n.id} className="glass-card p-4 border-white/5 hover:border-[#C9A84C]/20 transition-all group">
                      <div className="flex justify-between items-start mb-1">
                        <span className={`text-[7px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${n.type === 'promo' ? 'bg-[#C9A84C]/10 text-[#C9A84C]' : 'bg-white/5 text-white/40'}`}>{n.type}</span>
                        <span className="text-[7px] font-bold text-white/20">{n.time}</span>
                      </div>
                      <h4 className="text-[11px] font-black text-white mb-1 group-hover:text-[#C9A84C] transition-colors">{n.title}</h4>
                      <p className="text-[9px] text-secondary-text leading-relaxed">{n.message}</p>
                    </div>
                  ))
                )}
              </div>
              
              <button onClick={() => setNotifications([])} className="mt-6 w-full py-3 bg-white/5 hover:bg-white/10 rounded-xl text-[9px] font-black uppercase tracking-widest text-white/40 transition-all">Clear All</button>
            </motion.div>
          </div>
        , document.body)}


        {/* 👑 Priority Concierge FAB (Elite Only) */}
        <AnimatePresence>
          {isElite && (
            <motion.button
              initial={{ scale: 0, rotate: -45 }}
              animate={{ scale: 1, rotate: 0 }}
              whileHover={{ scale: 1.1, rotate: 5 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowConcierge(true)}
              className="fixed bottom-32 right-6 w-14 h-14 rounded-2xl bg-gradient-to-br from-[#C9A84C] via-[#E6C983] to-[#C9A84C] text-black shadow-[0_0_20px_rgba(201,168,76,0.5)] z-50 flex items-center justify-center border-2 border-white/20 group overflow-hidden"
            >
               <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 skew-x-[-45deg]" />
               <svg className="w-8 h-8 text-black relative z-10" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M25 25 L75 25 L25 75 L75 75" />
               </svg>
            </motion.button>
          )}
        </AnimatePresence>

        </div> {/* End Main Feed Content (Opened at 456) */}

        {/* 🏷️ Leaderboard & Metrics Panel (Now Mobile Visible) */}
        <div className="w-full px-4 mt-12 space-y-8 pb-32">
            <NexusLeaderboard />
            
            {/* Extra Desktop Side-space Polish */}
            <div className="glass-card p-6 rounded-[34px] border border-white/5 opacity-40 hover:opacity-100 transition-opacity">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-secondary-text mb-2">Nexus Metrics</p>
                <div className="flex items-end gap-2">
                  <p className="text-2xl font-black text-white">4.9/5</p>
                  <span className="text-[10px] text-emerald-400 font-black mb-1">↑ 2%</span>
                </div>
                <p className="text-[8px] font-bold text-secondary-text uppercase tracking-widest mt-1">Average Driver Rating</p>
            </div>
        </div>

      </div> {/* End Layout Grid */}
    </div> {/* End Intro Visibility Wrapper */}
    </main>

      <ConciergeDrawer 
        isOpen={showConcierge} 
        onClose={() => setShowConcierge(false)} 
        user={user}
      />

      <SupportModal isOpen={showSupport} onClose={() => setShowSupport(false)} />

      {/* 🚗 Rental Mediator Modal */}
      {selectedRental && typeof document !== 'undefined' && createPortal(
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[99998]"
            onClick={() => setSelectedRental(null)}
          />
          {/* Card Wrapper */}
          <div className="fixed inset-0 flex items-center justify-center p-4 z-[99999] pointer-events-none">
            {/* Responsive Card */}
            <div className="w-full max-w-[380px] max-h-[90vh] overflow-y-auto bg-[#141416] border border-white/10 rounded-3xl p-5 md:p-6 pointer-events-auto shadow-2xl relative">
              {/* Header */}
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1 pr-2">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="text-[8px] font-black text-[#141416] bg-[#C9A84C] px-2 py-0.5 rounded uppercase tracking-widest leading-tight">Campus Rental</span>
                    <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest leading-tight truncate">{selectedRental?.category || 'Rental'}</span>
                  </div>
                  <h3 className="text-lg md:text-xl font-black text-white leading-tight break-words">{selectedRental?.name}</h3>
                </div>
                <button
                  onClick={() => setSelectedRental(null)}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white flex items-center justify-center shrink-0 transition-colors"
                >×</button>
              </div>

              {/* Image */}
              <div className="w-full aspect-[16/9] relative rounded-2xl overflow-hidden mb-5 border border-white/5">
                <SafeImage src={selectedRental?.imageUrl || "/assets/placeholder.png"} alt={selectedRental?.name || "Rental"} fill style={{ objectFit: 'cover' }} />
              </div>

              {/* Description & Mission */}
              <div className="mb-5">
                <p className="text-xs text-gray-400 leading-relaxed m-0">
                  Zenvy acting as a <strong className="text-white">Mediator</strong>. Please review the details below and interact directly with the owner to finalize your rental agreement.
                </p>
              </div>

              {/* Price Info Grid */}
              <div className="p-4 rounded-2xl bg-[#C9A84C]/5 border border-[#C9A84C]/10 mb-5 flex flex-wrap justify-between items-center gap-3">
                 <div>
                    <span className="text-[9px] uppercase font-bold text-[#C9A84C] block mb-0.5 tracking-wide">Rental Rate</span>
                    <div className="flex items-baseline gap-1">
                       <span className="text-2xl font-black text-white">₹{selectedRental?.price}</span>
                       <span className="text-xs text-gray-400">/ day</span>
                    </div>
                 </div>
                 <div className="text-right">
                    <span className="text-[8px] uppercase font-bold text-gray-400 block mb-0.5 tracking-wide">Security Deposit</span>
                    <span className="text-sm font-black text-white">₹{Math.round((selectedRental?.price || 0) * 3)}</span>
                 </div>
              </div>

              {/* Specs Grid */}
              {selectedRental?.specs && (selectedRental.specs.engine || selectedRental.specs.topSpeed) && (
                <div className="grid grid-cols-2 gap-3 mb-6">
                  {selectedRental.specs.engine && (
                    <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                      <span className="text-[7px] font-black text-gray-500 uppercase tracking-widest block mb-1">Power Source</span>
                      <span className="text-[10px] font-bold text-white uppercase">{selectedRental.specs.engine}</span>
                    </div>
                  )}
                  {selectedRental.specs.topSpeed && (
                    <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                      <span className="text-[7px] font-black text-gray-500 uppercase tracking-widest block mb-1">Velocity Cap</span>
                      <span className="text-[10px] font-bold text-white uppercase">{selectedRental.specs.topSpeed} km/h</span>
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 relative">
                <span className="text-[9px] uppercase font-bold text-gray-400 mb-1 tracking-wide block">
                  {selectedRental?.ownerName ? `Owner: ${selectedRental.ownerName}` : 'Direct Owner Contact'}
                </span>
                {/* 2-Box Responsive Layout for Contacts */}
                <div className="grid grid-cols-2 gap-2 md:gap-3">
                  <a
                    href={`tel:${selectedRental?.ownerPhone || '+919391955674'}`}
                    className="flex items-center justify-center gap-1.5 md:gap-2 px-2 py-3.5 bg-sky-400/10 border border-sky-400/20 text-sky-400 font-black text-[11px] md:text-xs rounded-xl hover:bg-sky-400/20 transition-colors text-center truncate"
                  >
                    📞 Phone
                  </a>
                  <a
                    href={`https://wa.me/${selectedRental?.ownerPhone || '919391955674'}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 md:gap-2 px-2 py-3.5 bg-green-500/10 border border-green-500/20 text-green-500 font-black text-[11px] md:text-xs rounded-xl hover:bg-green-500/20 transition-colors text-center truncate"
                  >
                    💬 WhatsApp
                  </a>
                </div>
                <button
                  onClick={() => setSelectedRental(null)}
                  className="w-full mt-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

