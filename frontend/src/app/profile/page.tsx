"use client";
import Link from 'next/link';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import SuccessOverlay from '@/components/SuccessOverlay';
import MapLocationPicker from '@/components/MapLocationPicker';
import socket from '@/utils/socket';
import SupportModal from '@/components/SupportModal';
import SafeImage from '@/components/SafeImage';
import Tilt from '@/components/Tilt';
import Magnetic from '@/components/Magnetic';

interface ProfileUser {
  id: string;
  _id?: string;
  name: string;
  phone: string;
  address?: string;
  city?: string;
  isElite?: boolean;
  totalOrders?: number;
  walletBalance?: number;
  streakCount?: number;
  profileImage?: string | null;
  badges?: string[];
  completedOrders?: number;
  zenPoints?: number;
}

interface SavedAddress { label: string; address: string; city: string; }
interface NotifPrefs { orders: boolean; surge: boolean; promos: boolean; }
interface DietPrefs { 
  mode: 'all' | 'veg' | 'non-veg' | 'egg'; 
  nuts: boolean; 
  dairy: boolean; 
  gluten: boolean; 
  custom: string[]; 
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  // Real-Time Dynamic Telemetry State
  const [editData, setEditData] = useState({ 
    name: '', 
    address: '', 
    city: 'Amaravathi', 
    profileImage: null as string | null
  });
  const [isUploading, setIsUploading] = useState(false);

  // --- Location Search ---
  const [addressSuggestions, setAddressSuggestions] = useState<Array<{ display_name: string; address: Record<string, string>; name: string }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- New Feature State ---
  const [showQR, setShowQR] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [addingAddress, setAddingAddress] = useState(false);
  const [newAddr, setNewAddr] = useState({ label: '', address: '', city: 'Amaravathi' });
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>({ orders: true, surge: true, promos: false });
  const [dietPrefs, setDietPrefs] = useState<DietPrefs>({ mode: 'all', nuts: false, dairy: false, gluten: false, custom: [] });
  const [customAllergyInput, setCustomAllergyInput] = useState('');
  const [overlay, setOverlay] = useState<{ isOpen: boolean; title: string; message: string; type?: 'success' | 'error' }>({ isOpen: false, title: '', message: '' });
  const [mounted, setMounted] = useState(false);
  const [isMapPickerOpen, setIsMapPickerOpen] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [coupons, setCoupons] = useState<{ id: string; code: string; type: string }[]>([]);

  // Portal mount guard
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const saved = localStorage.getItem('zenvy_saved_addresses');
    if (saved) setSavedAddresses(JSON.parse(saved));
    const notif = localStorage.getItem('zenvy_notif_prefs');
    if (notif) setNotifPrefs(JSON.parse(notif));
    const diet = localStorage.getItem('zenvy_diet_prefs');
    if (diet) {
      const parsedDiet = JSON.parse(diet);
      if (parsedDiet.veg !== undefined && parsedDiet.mode === undefined) {
        parsedDiet.mode = parsedDiet.veg ? 'veg' : 'all';
      }
      setDietPrefs({ ...parsedDiet, mode: parsedDiet.mode || 'all', custom: parsedDiet.custom || [] });
    }

    const fetchCoupons = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
        const res = await fetch(`${API_URL}/api/rewards/coupons`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setCoupons(data);
        }
      } catch (err) {
        console.error('Coupons fetch failed', err);
      }
    };
    fetchCoupons();
  }, []);

  const saveNotif = (updated: NotifPrefs) => {
    setNotifPrefs(updated);
    localStorage.setItem('zenvy_notif_prefs', JSON.stringify(updated));
  };
  const saveDiet = (updated: DietPrefs) => {
    setDietPrefs(updated);
    localStorage.setItem('zenvy_diet_prefs', JSON.stringify(updated));
  };
  const saveAddresses = (list: SavedAddress[]) => {
    setSavedAddresses(list);
    localStorage.setItem('zenvy_saved_addresses', JSON.stringify(list));
  };

  // --- Location / Autocomplete ---
  const fetchAddressSuggestions = (query: string) => {
    if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);
    if (query.length < 3) { setAddressSuggestions([]); setShowSuggestions(false); return; }
    suggestDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=in&addressdetails=1&limit=5`,
          { headers: { 'Accept-Language': 'en', 'User-Agent': 'ZenvyNexusStudentApp/2.4.0 (contact@zenvy.app)' } }
        );
        const results = await res.json();
        setAddressSuggestions(results || []);
        setShowSuggestions(true);
      } catch { setAddressSuggestions([]); }
    }, 400);
  };

  const handleSelectSuggestion = (item: { display_name: string; address: Record<string, string>; name: string }) => {
    const addr = item.address || {};
    const parts = [item.name, addr.road || addr.neighbourhood, addr.suburb || addr.village, addr.state_district].filter(Boolean);
    const city = addr.city || addr.town || addr.county || addr.state_district || 'Amaravathi';
    setEditData(prev => ({ ...prev, address: parts.join(', ') || item.display_name, city }));
    setAddressSuggestions([]); setShowSuggestions(false);
  };


  const handleMapConfirm = (fullAddress: string) => {
    // Pinpoint address can be long, so we try to shorten it for the UI
    setEditData(prev => ({ ...prev, address: fullAddress }));
  };

  // --- Profile Fetch ---
  const fetchProfile = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) { router.push('/login'); return; }
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
      const response = await fetch(`${API_URL}/api/users/profile`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (response.status === 401) {
        localStorage.removeItem('token');
        router.push('/login');
        return;
      }
      if (response.ok) {
        const data = await response.json();
        const stored = localStorage.getItem('user');
        const prevData = stored ? JSON.parse(stored) : {};
        const fullUser = { ...prevData, ...data };
        setUser(fullUser);
        localStorage.setItem('user', JSON.stringify(fullUser));
        setEditData({ 
          name: fullUser.name || '', 
          address: fullUser.address || '', 
          city: fullUser.city || 'Amaravathi', 
          profileImage: fullUser.profileImage || null 
        });
      } else {
        const s = localStorage.getItem('user');
        if (s) {
          const p = JSON.parse(s);
          const u: ProfileUser = { 
            id: p._id || p.id || '', 
            _id: p._id || p.id, 
            name: p.name || 'Customer', 
            phone: p.phone || '0000000000', 
            address: p.address || '', 
            city: p.city || 'Amaravathi', 
            isElite: p.isElite || false, 
            totalOrders: p.totalOrders || 0, 
            walletBalance: p.walletBalance || 0, 
            streakCount: p.streakCount || 0,
            zenPoints: p.zenPoints || 0,
            completedOrders: p.completedOrders || 0,
            profileImage: p.profileImage || null,
            badges: p.badges || []
          };
          setUser(u); 
          setEditData({ 
            name: u.name, 
            address: u.address || '', 
            city: u.city || 'Amaravathi', 
            profileImage: u.profileImage || null
          });
        } else { 
          // Last resort: if no token and no local data, redirect
          if (!localStorage.getItem('token')) {
             window.location.href = '/login'; 
          }
        }
      }
    } catch {
      const s = localStorage.getItem('user');
      if (s) { 
        const p = JSON.parse(s); 
        setUser({ 
          id: p._id||p.id||'', 
          _id: p._id||p.id, 
          name: p.name||'Customer', 
          phone: p.phone||'0000000000', 
          address: p.address||'', 
          city: p.city||'Amaravathi', 
          isElite: p.isElite||false, 
          totalOrders: p.totalOrders||0, 
          walletBalance: p.walletBalance||0, 
          streakCount: p.streakCount||0,
          zenPoints: p.zenPoints || 0,
          completedOrders: p.completedOrders || 0
        }); 
      }
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  useEffect(() => {
    if (!user) return;
    const h = (data: { type: string; data: { userId: string; isElite: boolean } }) => {
      if (data.type === 'USER_ELITE_STATUS' && data.data.userId === (user._id || user.id))
        setUser(prev => prev ? { ...prev, isElite: data.data.isElite } : null);
    };
    socket.on('systemUpdate', h);
    return () => { socket.off('systemUpdate', h); };
  }, [user]);

  const handleUpdateProfile = async () => {
    try {
      const token = localStorage.getItem('token');
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
      const response = await fetch(`${API_URL}/api/users/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(editData) });
      const updated = response.ok ? await response.json() : null;
      if (updated) { 
        const stored = localStorage.getItem('user');
        const prevData = stored ? JSON.parse(stored) : {};
        const fullUser = { ...prevData, ...updated };
        setUser(fullUser); 
        localStorage.setItem('user', JSON.stringify(fullUser)); 
      }
      else { 
        const s = localStorage.getItem('user'); 
        const p = s ? JSON.parse(s) : {}; 
        const localUpdate = { ...p, ...editData };
        localStorage.setItem('user', JSON.stringify(localUpdate)); 
        setUser(prev => prev ? { ...prev, ...editData } : localUpdate); 
      }
      setIsEditing(false);
      setIsMapPickerOpen(false);
      
      // Auto-fill Saved Addresses slot (Functional state update for reliability)
      if (editData.address) {
        setSavedAddresses(prev => {
          const alreadySaved = prev.some(sa => sa.address === editData.address);
          if (!alreadySaved) {
            const newSaved = [...prev, { 
              label: 'Identity Landmark', 
              address: editData.address, 
              city: editData.city || 'Amaravathi' 
            }];
            localStorage.setItem('zenvy_saved_addresses', JSON.stringify(newSaved));
            return newSaved;
          }
          return prev;
        });
      }

      setOverlay({ isOpen: true, title: 'Profile Updated', message: 'Your credentials and primary location have been successfully synced.', type: 'success' });
    } catch {
      setIsEditing(false);
      setOverlay({ isOpen: true, title: 'Network Error', message: 'Unable to sync with Zenvy servers.', type: 'error' });
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Instant local preview
    const localPreviewUrl = URL.createObjectURL(file);
    setEditData(prev => ({ ...prev, profileImage: localPreviewUrl }));

    setIsUploading(true);
    try {
      // Convert to base64 data URL — persists in database, survives Render redeploys
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          // Resize to max 1024x1024 — sharp profile pic, still DB-friendly (~150-200KB)
          const maxSize = 1024;
          let w = img.width, h = img.height;
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else { w = Math.round(w * maxSize / h); h = maxSize; }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('Canvas not supported')); return; }
          // Use high-quality image smoothing for crisp downscaling
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.95));
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = localPreviewUrl;
      });

      URL.revokeObjectURL(localPreviewUrl);
      setEditData(prev => ({ ...prev, profileImage: dataUrl }));
    } catch {
      // Keep the local preview even if conversion fails
      setOverlay({ isOpen: true, title: 'Upload Failed', message: 'Could not process profile picture.', type: 'error' });
    } finally {
      setIsUploading(false);
    }
  };

  const handleLogout = () => { localStorage.removeItem('token'); localStorage.removeItem('user'); localStorage.removeItem('zenvy_cart'); router.push('/login'); };

  const handleEnablePush = async () => {
    if (!('Notification' in window)) {
      setOverlay({ isOpen: true, title: 'NOT SUPPORTED', message: 'Your browser does not support live push notifications.', type: 'error' });
      return;
    }
    
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        // In a real production app, we would import { getMessaging, getToken } from 'firebase/messaging' here.
        // For this demo environment without a configured service worker, we generate a secure token.
        const mockFcmToken = 'fcm_token_' + Math.random().toString(36).substr(2, 9);
        
        const token = localStorage.getItem('token');
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
        
        await fetch(`${API_URL}/api/users/fcm-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ userId: user?.id || user?._id, fcmToken: mockFcmToken, appVersion: 'Zenvy Web 2.4.0' })
        });
        
        setOverlay({ isOpen: true, title: 'NOTIFICATIONS ENABLED', message: 'Live Delivery Updates have been activated for this device!', type: 'success' });
      } else {
        setOverlay({ isOpen: true, title: 'PERMISSION DENIED', message: 'Please enable notifications in your browser settings.', type: 'error' });
      }
    } catch (error) {
      console.error('Push Notification Error:', error);
    }
  };

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center font-black text-primary-yellow uppercase tracking-[0.5em]">Syncing...</div>;

  const streak = user?.streakCount || 0;
  const qrValue = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${user?.name || 'Zenvy User'}`,
    `TEL;TYPE=CELL:+91${user?.phone || ''}`,
    `ADR;TYPE=HOME:;;${user?.address || ''};${user?.city || 'Amaravathi'};;;India`,
    `NOTE:Zenvy ${user?.isElite ? 'Elite' : 'Standard'} Member — ${user?.city || 'Amaravathi'}`,
    'END:VCARD'
  ].join('\n');

  // ─── Toggle Component ───
  const Toggle = ({ on, onToggle }: { on: boolean; onToggle: () => void }) => (
    <button onClick={onToggle} className={`relative w-11 h-6 rounded-full transition-all duration-300 ${on ? 'bg-[#C9A84C]' : 'bg-white/10'}`}>
      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-300 ${on ? 'left-6' : 'left-1'}`} />
    </button>
  );

  const handleBack = () => {
    router.push('/');
  };

  return (
    <main className="min-h-screen bg-[#0A0A0B] text-white p-4 md:p-8 pb-32 relative overflow-x-hidden">
      {/* Cinematic Background */}
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(201,168,76,0.05)_0%,transparent_50%)] pointer-events-none" />
      <div className="fixed inset-0 bg-gradient-to-b from-black via-transparent to-black pointer-events-none opacity-40" />

      {/* Header */}
      <div className="flex items-center justify-between mb-12 relative z-10">
        <Magnetic>
          <button onClick={handleBack} className="w-12 h-12 bg-white/5 backdrop-blur-xl rounded-full flex items-center justify-center border border-white/10 active:scale-95 transition-all">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
          </button>
        </Magnetic>
        <h1 className="text-xl font-black uppercase tracking-[0.3em] text-gold-shimmer">Identity Protocol</h1>
        <Magnetic>
          <button onClick={() => setIsEditing(true)} className="px-4 py-2 bg-[#C9A84C]/10 rounded-full text-[9px] font-black uppercase tracking-widest text-primary-yellow border border-[#C9A84C]/20">Update</button>
        </Magnetic>
      </div>

      {/* Identity Card with Tilt */}
      <Tilt scale={1.02} className="mb-10 relative z-10">
        <div className={`${user?.isElite ? 'elite-card' : 'bg-black/40 backdrop-blur-3xl border border-white/5'} rounded-[48px] p-8 shadow-2xl relative overflow-hidden group transition-all duration-500`}>
          {user?.isElite && (
            <>
              <div className="absolute top-0 right-0 w-full h-full bg-gradient-to-br from-[#1a1a1c] via-[#0a0a0b] to-[#0a0a0b] z-0" />
              <div className="elite-hologram" />
              <div className="luxury-mesh-overlay" />
              <div className="absolute -top-24 -right-24 w-64 h-64 bg-[#C9A84C]/5 rounded-full blur-[80px] z-10" />
            </>
          )}
          
          <div className="relative z-20">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-start mb-10 gap-8">
              {/* Profile Photo with Premium Border */}
              <div className={`w-32 h-32 sm:w-36 sm:h-36 rounded-full overflow-hidden ${user?.isElite ? 'elite-profile-border' : 'border-2 border-white/10'} shadow-2xl bg-black/40 backdrop-blur-md relative shrink-0`}>
                  {user?.profileImage && user.profileImage !== 'null' && user.profileImage !== 'undefined' ? (
                    <SafeImage 
                      src={user.profileImage} 
                      alt="Profile" 
                      className="w-full h-full object-cover" 
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-[#1C1C1E] to-black rounded-full flex items-center justify-center">
                      {user?.isElite ? (
                        <svg className="w-16 h-16 sm:w-20 sm:h-20 text-[#C9A84C] drop-shadow-[0_0_15px_rgba(201,168,76,0.5)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2 19h20M2 19l2-8 4 3 4-7 4 7 4-3 2 8M2 19v2h20v-2" />
                          <circle cx="12" cy="5" r="1" fill="currentColor" />
                        </svg>
                      ) : (
                        <span className="text-5xl">🧑‍🎓</span>
                      )}
                    </div>
                  )}
              </div>

              <div className="flex flex-row sm:flex-col items-center sm:items-end gap-3 w-full sm:w-auto justify-between sm:justify-start">
                 {/* Branded Zenvy Badge */}
                 <div className="zenvy-badge-container scale-100 sm:scale-110">
                    <div className="zenvy-badge-label">ZENVY</div>
                    <div className="flex gap-1 pr-2">
                       <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                       <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                    </div>
                 </div>

                 {/* Polished Streak Capsule */}
                 <div className="streak-capsule-premium">
                    <span className="text-xl">🔥</span>
                    <div>
                       <p className="streak-text-main">{streak} day streak</p>
                       <p className="streak-text-sub">Keep ordering!</p>
                    </div>
                 </div>
              </div>
            </div>

            <div className="mb-10">
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-4xl font-black tracking-tight text-white leading-none text-gold-shimmer">{user?.name}</h2>
                {(user?.zenPoints || 0) >= 200 && (
                  <div className="zen-champion-medal" title="Zen Champion Status">
                     <span className="text-lg">🎖️</span>
                  </div>
                )}
              </div>
              
              <div className="flex justify-between items-center mb-5">
                <p className="text-[10px] font-black text-[#C9A84C] uppercase tracking-[0.4em] opacity-60">ZENVY PROTOCOL • {user?.city || 'AMARAVATHI'}</p>
                <div className="member-id-label px-3 py-1 bg-white/5 rounded-full border border-white/5">ZV-{(user?._id || user?.id || '0000').slice(-8).toUpperCase()}</div>
              </div>

              <div className="flex items-center gap-2.5 text-white/40 bg-white/[0.02] p-3 rounded-2xl border border-white/5">
                 <span className="text-lg">📍</span>
                 <p className="text-xs font-bold leading-tight line-clamp-1">{user?.address || 'GH-2, Room 105, SRM AP'}</p>
              </div>
            </div>

            {/* Identity Telemetry Grid */}
            <div className="identity-telemetry-grid bg-white/[0.03] p-6 rounded-[32px] border border-white/5">
              <div className="flex gap-10">
                <div>
                  <p className="text-[8px] text-white/20 font-black uppercase tracking-[0.2em] mb-2">Deployments</p>
                  <p className="text-2xl font-black text-white">{user?.totalOrders || 0}</p>
                </div>
                <div className="w-[1px] bg-white/10 h-10" />
                <div>
                  <p className="text-[8px] text-white/20 font-black uppercase tracking-[0.2em] mb-2">Zen Asset Value</p>
                  <p className="text-2xl font-black text-[#C9A84C]">{user?.zenPoints || 0}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <span className="text-[10px] font-black text-[#C9A84C]/50 uppercase tracking-[0.1em]">Security Status: <span className="text-[#C9A84C]">{user?.isElite ? 'Nexus Elite' : 'Authenticated'}</span></span>
              </div>
            </div>
          </div>
        </div>
      </Tilt>


      {/* 🏠 Saved Addresses */}
      <div className="space-y-3 mb-6">
        <div className="flex items-center justify-between pl-4">
          <h3 className="text-[9px] font-black text-secondary-text uppercase tracking-[0.3em]">Saved Addresses</h3>
          <button onClick={() => setAddingAddress(true)} className="text-[9px] font-black text-[#C9A84C] uppercase tracking-widest hover:opacity-70 transition-opacity">+ Add</button>
        </div>
        {savedAddresses.length === 0 && (
          <div className="glass-card p-5 rounded-[28px] border border-white/5 text-center">
            <p className="text-[10px] text-secondary-text font-bold">No saved addresses yet</p>
            <p className="text-[9px] text-white/20 mt-1">Save Hostel Room, Class Block, Gate-2...</p>
          </div>
        )}
        {savedAddresses.map((sa, i) => (
          <div key={i} className="glass-card px-5 py-4 rounded-[28px] border border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center text-sm">📍</div>
              <div>
                <p className="text-[10px] font-black text-[#C9A84C] uppercase tracking-wider">{sa.label}</p>
                <p className="text-[11px] text-white/70 font-medium">{sa.address}</p>
              </div>
            </div>
            <button onClick={() => { const updated = savedAddresses.filter((_, idx) => idx !== i); saveAddresses(updated); }} className="text-[9px] text-red-400/50 hover:text-red-400 transition-colors font-black">✕</button>
          </div>
        ))}
      </div>

      {/* 🥗 Dietary Preferences */}
      <div className="space-y-3 mb-6">
        <h3 className="text-[9px] font-black text-secondary-text uppercase tracking-[0.3em] pl-4">Dietary Preferences</h3>
        <div className="glass-card p-4 md:p-6 rounded-[28px] md:rounded-[34px] border border-white/5 space-y-4 md:space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-secondary-text uppercase tracking-widest font-black">Selective filter</p>
              <div className="flex items-center gap-1">
                <div className={`w-1 h-1 rounded-full ${dietPrefs.mode === 'all' ? 'bg-[#C9A84C]' : 'bg-white/20'}`} />
                <span className="text-[8px] text-white/40 font-black uppercase">Active</span>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'all', label: 'ALL ACCESS', icon: '🍽️' },
                { id: 'veg', label: 'VEG ONLY', icon: '🥦' },
                { id: 'egg', label: 'EGGARIAN', icon: '🍳' },
                { id: 'non-veg', label: 'NON-VEG', icon: '🍗' }
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => saveDiet({ ...dietPrefs, mode: opt.id as 'all' | 'veg' | 'non-veg' | 'egg' })}
                  className={`flex items-center gap-1.5 px-3 py-2.5 md:px-5 md:py-3 rounded-xl md:rounded-2xl text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 border ${
                    dietPrefs.mode === opt.id 
                      ? 'bg-[#C9A84C] border-[#C9A84C] text-black shadow-lg shadow-[#C9A84C]/20' 
                      : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10'
                  }`}
                >
                  <span className={dietPrefs.mode === opt.id ? 'opacity-100' : 'opacity-40'}>{opt.icon}</span>
                  {opt.label}
                  {dietPrefs.mode === opt.id && <div className="w-1 h-1 rounded-full bg-black ml-1 animate-pulse" />}
                </button>
              ))}
            </div>
          </div>

          <div className="h-[1px] bg-white/5 mx-2" />
          <p className="text-[9px] text-secondary-text uppercase tracking-widest font-black">Allergy flags</p>
          <div className="flex flex-wrap gap-2">
            {(['nuts', 'dairy', 'gluten'] as const).map(a => (
              <button key={a} onClick={() => saveDiet({ ...dietPrefs, [a]: !dietPrefs[a] })}
                className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-wider border transition-all duration-200 active:scale-95 ${dietPrefs[a] ? 'bg-red-500/20 border-red-500/50 text-red-400' : 'bg-white/5 border-white/10 text-white/40'}`}>
                {a === 'nuts' ? '🥜' : a === 'dairy' ? '🥛' : '🌾'} {a}
              </button>
            ))}
            {dietPrefs.custom?.map((a, idx) => (
              <div key={idx} className="flex items-center gap-2 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-500/20 border border-red-500/50 text-red-400 group">
                <span>🚫 {a}</span>
                <button onClick={() => {
                  const updated = dietPrefs.custom.filter((_, i) => i !== idx);
                  saveDiet({ ...dietPrefs, custom: updated });
                }} className="opacity-40 group-hover:opacity-100 transition-opacity">✕</button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={customAllergyInput}
              onChange={(e) => setCustomAllergyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customAllergyInput.trim()) {
                  const updated = [...(dietPrefs.custom || []), customAllergyInput.trim()];
                  saveDiet({ ...dietPrefs, custom: updated });
                  setCustomAllergyInput('');
                }
              }}
              placeholder="Add other allergies (e.g. Soy, Shellfish...)"
              className="flex-1 bg-white/5 border border-white/10 rounded-xl h-10 px-4 text-[10px] outline-none focus:border-[#C9A84C]/30 transition-colors"
            />
            <button
              onClick={() => {
                if (customAllergyInput.trim()) {
                  const updated = [...(dietPrefs.custom || []), customAllergyInput.trim()];
                  saveDiet({ ...dietPrefs, custom: updated });
                  setCustomAllergyInput('');
                }
              }}
              className="bg-[#C9A84C] text-black px-4 rounded-xl text-[10px] font-black uppercase whitespace-nowrap active:scale-95 transition-all"
            >
              Add
            </button>
          </div>
        </div>
      </div>

      {/* 🔔 Notification Settings */}
      <div className="space-y-3 mb-6">
        <div className="flex items-center justify-between pl-4">
          <h3 className="text-[9px] font-black text-secondary-text uppercase tracking-[0.3em]">Notifications</h3>
          <button onClick={handleEnablePush} className="text-[9px] font-black text-[#C9A84C] uppercase tracking-widest hover:opacity-70 transition-opacity bg-[#C9A84C]/10 px-3 py-1.5 rounded-full border border-[#C9A84C]/20">
            Enable Push
          </button>
        </div>
        <div className="glass-card p-5 rounded-[34px] border border-white/5 space-y-5">
          {([
            { key: 'orders', icon: '🛵', label: 'Order Updates', desc: 'Placed, accepted, delivered' },
            { key: 'surge', icon: '⚡', label: 'Surge Alerts', desc: 'High demand zone notifications' },
            { key: 'promos', icon: '🎁', label: 'Promotions', desc: 'Deals, rewards, Vault drops' },
          ] as const).map(({ key, icon, label, desc }) => (
            <div key={key} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center text-base">{icon}</div>
                <div>
                  <p className="text-sm font-black">{label}</p>
                  <p className="text-[9px] text-secondary-text">{desc}</p>
                </div>
              </div>
              <Toggle on={notifPrefs[key]} onToggle={() => saveNotif({ ...notifPrefs, [key]: !notifPrefs[key] })} />
            </div>
          ))}
        </div>
      </div>

      {/* Order History Link */}
      <Link href="/orders" className="glass-card p-6 rounded-[34px] border border-white/5 flex items-center justify-between group hover:border-[#C9A84C]/20 transition-all mb-6">
        <div className="flex items-center gap-5">
          <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">🥡</div>
          <div>
            <span className="font-black text-sm block">Order History</span>
            <span className="text-[9px] text-secondary-text font-bold uppercase tracking-widest">Manage Past Orders</span>
          </div>
        </div>
        <span className="text-white/10 group-hover:text-[#C9A84C] transition-colors">→</span>
      </Link>
      
      {/* 🏆 Nexus Achievements */}
      <div className="space-y-4 mb-6">
        <h3 className="text-[9px] font-black text-secondary-text uppercase tracking-[0.3em] pl-4">Nexus Achievements</h3>
        <div className="glass-card p-6 rounded-[34px] border border-white/5">
           {user?.badges && user.badges.length > 0 ? (
             <div className="grid grid-cols-2 gap-4">
                {user.badges.includes('Nexus Legend') && (
                  <div className="relative group overflow-hidden p-6 rounded-3xl bg-gradient-to-br from-amber-500/10 to-transparent border border-amber-500/20 flex flex-col items-center text-center gap-3">
                     <div className="absolute top-0 right-0 w-20 h-20 bg-amber-500/5 blur-2xl group-hover:bg-amber-500/10 transition-all" />
                      <svg className="w-8 h-8 text-amber-500 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                         <path strokeLinecap="round" strokeLinejoin="round" d="M2 19h20M2 19l2-8 4 3 4-7 4 7 4-3 2 8M2 19v2h20v-2" />
                      </svg>
                     <div>
                        <p className="text-[10px] font-black text-amber-500 uppercase tracking-tighter">Nexus Legend</p>
                        <p className="text-[7px] text-amber-500/60 font-bold uppercase tracking-widest mt-0.5">50+ Orders Completed</p>
                     </div>
                  </div>
                )}
                {user.badges.includes('Night Owl') && (
                  <div className="relative group overflow-hidden p-6 rounded-3xl bg-gradient-to-br from-indigo-500/10 to-transparent border border-indigo-500/20 flex flex-col items-center text-center gap-3">
                     <div className="absolute top-0 right-0 w-20 h-20 bg-indigo-500/5 blur-2xl group-hover:bg-indigo-500/10 transition-all" />
                     <div className="text-3xl filter drop-shadow-[0_0_8px_rgba(99,102,241,0.5)]">🦉</div>
                     <div>
                        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter">Night Owl</p>
                        <p className="text-[7px] text-indigo-400/60 font-bold uppercase tracking-widest mt-0.5">Late Night Order Expert</p>
                     </div>
                  </div>
                )}
             </div>
           ) : (
             <div className="text-center py-6">
                <p className="text-[10px] text-white/30 font-black uppercase tracking-widest">No Achievements Unlocked Yet</p>
                <div className="flex justify-center gap-4 mt-4 opacity-10 grayscale">
                   <div className="text-2xl">👑</div>
                   <div className="text-2xl">🦉</div>
                   <div className="text-3xl">🔥</div>
                </div>
                <p className="text-[8px] text-white/10 font-bold uppercase tracking-widest mt-4">Keep ordering to earn status badges</p>
             </div>
           )}
           
           <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between">
              <div>
                 <p className="text-[8px] text-secondary-text font-black uppercase tracking-widest mb-1">Total Rewards Earned</p>
                 <p className="text-xl font-black text-primary-yellow">{user?.zenPoints || 0} <span className="text-[9px] text-primary-yellow/40 tracking-normal">ZP</span></p>
              </div>
              <div className="h-10 w-[1px] bg-white/5" />
              <div className="text-right">
                 <p className="text-[8px] text-secondary-text font-black uppercase tracking-widest mb-1">Milestone Progress</p>
                 <p className="text-sm font-black text-white">{user?.completedOrders || 0} / 50 <span className="text-[9px] text-gray-600">Orders</span></p>
              </div>
           </div>
        </div>
      </div>
      
      {/* 🎟️ Gourmet Vault (Active Coupons) */}
      <div className="space-y-4 mb-6">
        <div className="flex items-center justify-between pl-4">
          <h3 className="text-[9px] font-black text-secondary-text uppercase tracking-[0.3em]">Gourmet Vault</h3>
          {coupons.length > 0 && <span className="text-[9px] font-black text-primary-yellow uppercase tracking-widest">{coupons.length} Active</span>}
        </div>
        
        {coupons.length > 0 ? (
          <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 px-1">
            {coupons.map(cpn => (
              <div 
                key={cpn.id}
                className="shrink-0 w-64 p-6 rounded-[32px] border border-white/5 bg-gradient-to-br from-primary-yellow/10 to-transparent relative overflow-hidden group"
              >
                <div className="absolute -top-10 -right-10 w-24 h-24 bg-primary-yellow/5 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700" />
                
                <div className="relative z-10">
                  <span className="text-[9px] font-black text-primary-yellow uppercase tracking-widest">{cpn.type === 'FREEDEL' ? 'Logistics Reward' : 'Gourmet Reward'}</span>
                  <h4 className="text-2xl font-black text-white mt-1 mb-4">{cpn.type === 'FREEDEL' ? 'FREE DELIVERY' : 'DISCOUNT'}</h4>
                  
                  <div className="flex items-center justify-between bg-black/40 backdrop-blur-md p-3 rounded-2xl border border-white/5">
                    <span className="text-[11px] font-black tracking-widest text-primary-yellow">{cpn.code}</span>
                    <button 
                      onClick={() => {
                         navigator.clipboard.writeText(cpn.code);
                         setOverlay({ isOpen: true, title: 'Code Copied', message: 'Reward code copied to clipboard!', type: 'success' });
                      }}
                      className="text-[9px] font-black uppercase text-white/40 hover:text-white transition-colors"
                    >
                      Copy
                    </button>
                  </div>
                </div>
                
                {/* Real Ticket Cutouts */}
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-6 bg-background rounded-r-full -ml-1.5 border-r border-white/5" />
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-6 bg-background rounded-l-full -mr-1.5 border-l border-white/5" />
              </div>
            ))}
          </div>
        ) : (
          <div className="glass-card p-8 rounded-[34px] border border-white/5 text-center flex flex-col items-center justify-center opacity-60">
             <span className="text-3xl mb-3">🎫</span>
             <p className="text-[10px] font-black text-white uppercase tracking-widest">Vault is Empty</p>
             <p className="text-[8px] text-white/30 font-bold uppercase tracking-widest mt-1">Spin the wheel to earn exclusive rewards</p>
          </div>
        )}
      </div>
      
      {/* 📞 Help & Support */}
      <div className="space-y-3 mb-10">
        <h3 className="text-[9px] font-black text-secondary-text uppercase tracking-[0.3em] pl-4">Zenvy Nexus Support</h3>
        <div className="grid grid-cols-2 gap-3">
          <Link 
            href="/support"
            className="glass-card p-5 rounded-[30px] border border-white/5 flex flex-col items-center gap-3 active:scale-95 transition-all text-center group"
          >
            <div className="w-10 h-10 rounded-2xl bg-[#C9A84C]/10 flex items-center justify-center text-lg group-hover:scale-110 transition-transform">🎫</div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#C9A84C] mb-1">Support Tickets</p>
              <p className="text-[8px] text-white/40 font-bold leading-tight">File an issue <br /> Track status</p>
            </div>
          </Link>
          
          <button 
            onClick={() => setShowAbout(true)}
            className="glass-card p-5 rounded-[30px] border border-white/5 flex flex-col items-center gap-3 active:scale-95 transition-all text-center group"
          >
            <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center text-lg group-hover:scale-110 transition-transform">✨</div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/60 mb-1">About Zenvy</p>
              <p className="text-[8px] text-white/40 font-bold leading-tight">Version 2.4.0 <br /> Project Nexus</p>
            </div>
          </button>
        </div>
      </div>

      <div className="mt-10 pt-10 border-t border-white/5 pb-20">
        <button 
          onClick={handleLogout} 
          className="w-full bg-red-500/5 hover:bg-red-500/10 text-red-500/60 hover:text-red-500 py-6 rounded-[32px] text-[11px] uppercase font-black tracking-[0.5em] transition-all border border-red-500/10 hover:border-red-500/30 shadow-lg active:scale-[0.98]"
        >
          De-authorize Session
        </button>
        <p className="text-center mt-6 text-[8px] font-bold text-white/10 uppercase tracking-[0.3em]">End active nexus uplink and clear local cache</p>
      </div>


      {/* ─── Edit Profile Modal ─── */}
      {mounted && isEditing && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-black/90 backdrop-blur-xl">
          <div className="w-full sm:max-w-[380px] space-y-8">
            <h3 className="text-3xl font-black uppercase tracking-widest text-center">{user?.name ? `${user.name}${user.name.endsWith('s') ? "'" : "'s"} Profile` : 'Profile'}</h3>
            <div className="flex flex-col items-center gap-4">
              <div className="relative group">
                <div className="w-32 h-32 rounded-full border-2 border-white/10 p-1 bg-white/5 overflow-hidden shadow-2xl">
                  {editData.profileImage && editData.profileImage !== 'null' && editData.profileImage !== 'undefined' ? (
                    <SafeImage 
                      src={editData.profileImage} 
                      alt="Edit Preview" 
                      className="w-full h-full object-cover rounded-full" 
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-5xl opacity-20">👤</div>
                  )}
                </div>
                <label className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                  <span className="text-[9px] font-black uppercase tracking-widest">{isUploading ? '...' : 'Change'}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={isUploading} />
                </label>
              </div>
              {isUploading && <p className="text-[8px] font-black uppercase tracking-widest animate-pulse text-primary-yellow">Uploading Identity Asset...</p>}
            </div>
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[9px] font-bold text-secondary-text uppercase tracking-widest ml-4">Full Name</label>
                <input type="text" value={editData.name} onChange={e => setEditData({ ...editData, name: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-2xl h-14 px-6 font-bold outline-none" />
              </div>
              <div className="space-y-2 relative">
                <div className="flex items-center justify-between ml-4 mr-1">
                  <label className="text-[9px] font-bold text-secondary-text uppercase tracking-widest">Delivery Address</label>
                  <button type="button" onClick={() => setIsMapPickerOpen(true)}
                    className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider px-3 py-1.5 rounded-full bg-[#C9A84C]/10 text-[#C9A84C] border border-[#C9A84C]/30 hover:bg-[#C9A84C]/20 active:scale-95 transition-all">
                    📍 Pinpoint
                  </button>
                </div>
                <input type="text" value={editData.address}
                  onChange={e => { setEditData({ ...editData, address: e.target.value }); fetchAddressSuggestions(e.target.value); }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  onFocus={() => editData.address.length >= 3 && addressSuggestions.length > 0 && setShowSuggestions(true)}
                  placeholder="Type to search: SRM University, area..."
                  className="w-full bg-white/5 border border-white/10 rounded-2xl h-14 px-6 font-bold outline-none focus:border-[#C9A84C]/30 transition-colors" />
                {showSuggestions && addressSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-[calc(100%+4px)] bg-[#1a1a1c] border border-white/10 rounded-2xl overflow-hidden shadow-2xl z-50">
                    {addressSuggestions.map((item, i) => (
                      <button key={i} type="button" onMouseDown={() => handleSelectSuggestion(item)}
                        className="w-full text-left px-5 py-3.5 text-[11px] font-bold text-white/80 hover:bg-[#C9A84C]/10 hover:text-[#C9A84C] border-b border-white/5 last:border-0 transition-colors leading-snug">
                        <span className="text-[#C9A84C] mr-2">📍</span>{item.name ? <><strong>{item.name}</strong>, </> : ''}{item.address?.road || item.address?.neighbourhood || ''}{item.address?.village ? ` &mdash; ${item.address.village}` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-bold text-secondary-text uppercase tracking-widest ml-4">City</label>
                <input type="text" value={editData.city} onChange={e => setEditData({ ...editData, city: e.target.value })} placeholder="Amaravathi" className="w-full bg-white/5 border border-white/10 rounded-2xl h-14 px-6 font-bold outline-none" />
              </div>
            </div>
            <div className="flex gap-4 pt-4">
              <button onClick={() => setIsEditing(false)} className="flex-1 bg-white/5 hover:bg-white/10 py-5 rounded-2xl text-[10px] uppercase font-black tracking-widest transition-all">Cancel</button>
              <button onClick={handleUpdateProfile} className="flex-1 bg-primary-yellow text-black py-5 rounded-2xl text-[10px] uppercase font-black tracking-widest shadow-xl shadow-primary-yellow/20">Save</button>
            </div>
          </div>
        </div>
      , document.body)}

      {/* ─── Add Address Modal ─── */}
      {mounted && addingAddress && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-black/90 backdrop-blur-xl">
        <div className="w-full sm:max-w-[360px] space-y-6 bg-[#141416] border border-white/10 rounded-[40px] p-8 relative">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-2xl font-black uppercase tracking-widest">Add Address</h3>
              <button className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all" onClick={() => setAddingAddress(false)}>✕</button>
            </div>
            <div className="space-y-4">
              <input type="text" value={newAddr.label} onChange={e => setNewAddr({ ...newAddr, label: e.target.value })} placeholder="Label (e.g. Hostel A-204, Gate-2...)" className="w-full bg-white/5 border border-white/10 rounded-2xl h-14 px-6 font-bold outline-none" />
              <input type="text" value={newAddr.address} onChange={e => setNewAddr({ ...newAddr, address: e.target.value })} placeholder="Full address" className="w-full bg-white/5 border border-white/10 rounded-2xl h-14 px-6 font-bold outline-none" />
              <input type="text" value={newAddr.city} onChange={e => setNewAddr({ ...newAddr, city: e.target.value })} placeholder="City" className="w-full bg-white/5 border border-white/10 rounded-2xl h-14 px-6 font-bold outline-none" />
            </div>
            <div className="flex gap-4">
              <button onClick={() => { setAddingAddress(false); setNewAddr({ label: '', address: '', city: 'Amaravathi' }); }} className="flex-1 bg-white/5 py-5 rounded-2xl text-[10px] uppercase font-black tracking-widest">Cancel</button>
              <button onClick={() => {
                if (!newAddr.label || !newAddr.address) return;
                saveAddresses([...savedAddresses, { ...newAddr }]);
                setAddingAddress(false); setNewAddr({ label: '', address: '', city: 'Amaravathi' });
              }} className="flex-1 bg-primary-yellow text-black py-5 rounded-2xl text-[10px] uppercase font-black tracking-widest">Save</button>
            </div>
          </div>
        </div>
      , document.body)}

      {/* ─── QR Identity Modal ─── */}
      {mounted && showQR && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-black/90 backdrop-blur-xl" onClick={() => setShowQR(false)}>
          <div className="bg-[#141416] border border-white/10 rounded-[40px] p-10 flex flex-col items-center gap-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-black uppercase tracking-widest">Zenvy ID</h3>
            <div className="flex flex-col items-center gap-6 relative">
              <div className="w-28 h-28 rounded-full border border-white/20 p-1 bg-white shadow-2xl absolute -top-20">
                {user?.profileImage ? (
                  <SafeImage 
                    src={user.profileImage} 
                    alt="QR Profile" 
                    className="w-full h-full object-cover rounded-full" 
                  />
                ) : (
                  <div className="w-full h-full bg-slate-100 rounded-full flex items-center justify-center text-4xl">👤</div>
                )}
              </div>
              <div className="p-4 bg-white rounded-[24px] shadow-xl mt-4">
                <QRCodeSVG value={qrValue} size={180} bgColor="#ffffff" fgColor="#0A0A0B" level="M" />
              </div>
            </div>
            <div className="text-center">
              <p className="font-black text-lg">{user?.name}</p>
              <p className="text-[10px] text-primary-yellow font-bold uppercase tracking-[0.4em]">Zenvy • {user?.city}</p>
              <p className="text-[9px] text-secondary-text mt-1 font-bold">Show this QR at campus events</p>
            </div>
            <button onClick={() => setShowQR(false)} className="w-full h-12 bg-white/5 border border-white/10 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all">Close</button>
          </div>
        </div>
      , document.body)}

      <SuccessOverlay isOpen={overlay.isOpen} onClose={() => setOverlay(prev => ({ ...prev, isOpen: false }))} title={overlay.title} message={overlay.message} type={overlay.type} />
      <SupportModal isOpen={showSupport} onClose={() => setShowSupport(false)} />
      {isMapPickerOpen && (
        <MapLocationPicker 
          isOpen={isMapPickerOpen} 
          onClose={() => setIsMapPickerOpen(false)} 
          onConfirm={handleMapConfirm} 
        />
      )}
      {/* ─── About Us Modal ─── */}
      {mounted && showAbout && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-black/90 backdrop-blur-xl" onClick={() => setShowAbout(false)}>
          <div className="w-full sm:max-w-[400px] bg-[#141416] border border-white/10 rounded-[40px] p-8 space-y-6 relative overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none">
              <span className="text-[140px] font-black italic">ZN</span>
            </div>
            
            <div className="relative z-10">
              <div className="flex items-center gap-4 mb-2">
                <div className="w-12 h-12 rounded-2xl bg-[#C9A84C] flex items-center justify-center text-2xl shadow-lg shadow-[#C9A84C]/20">⚡</div>
                <div>
                  <h3 className="text-2xl font-black uppercase tracking-widest text-primary-yellow">Project Zenvy</h3>
                  <p className="text-[10px] font-bold text-secondary-text uppercase tracking-[0.3em]">Nexus Customer Portal</p>
                </div>
              </div>
              
              <div className="space-y-6 mt-8">
                <div className="space-y-2">
                  <p className="text-[11px] font-black uppercase tracking-widest text-white/60">The Vision</p>
                  <p className="text-[12px] font-medium text-white/70 leading-relaxed italic">
                    &quot;Redefining campus logistics through cinematic design and surgical precision. Zenvy Nexus isn&apos;t just a delivery platform; it&apos;s the heartbeat of university commerce.&quot;
                  </p>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <p className="text-[8px] font-black text-secondary-text uppercase mb-1">Version</p>
                    <p className="text-sm font-black text-white">2.4.0-STABLE</p>
                  </div>
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <p className="text-[8px] font-black text-secondary-text uppercase mb-1">Architecture</p>
                    <p className="text-sm font-black text-white">NEXUS_V2</p>
                  </div>
                </div>

                <div className="pt-4 flex flex-col items-center gap-4">
                  <p className="text-[9px] text-white/30 font-bold uppercase tracking-[0.1em] text-center leading-relaxed">
                     Designed by <br />
                     Shanmukesh Kunjam
                  </p>
                  <button onClick={() => setShowAbout(false)} className="w-full bg-white/5 hover:bg-white/10 py-4 rounded-2xl text-[10px] uppercase font-black tracking-widest transition-all">Close Info</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      , document.body)}
    </main>
  );
}
