"use client";
import { useState, useEffect, Suspense, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import SafeImage from '@/components/SafeImage';
import dynamic from 'next/dynamic';
import { getCoordsForAddress } from '@/utils/logistics';

const LeafletTrackingMapSub = dynamic(() => import('@/components/LeafletTrackingMapSub'), { ssr: false });

import DeliverySuccessOverlay from '@/components/DeliverySuccessOverlay';
import RatingModal from '@/components/RatingModal';
import ChatDrawer from '@/components/ChatDrawer';
import RiderProfileModal from '@/components/RiderProfileModal';
import Tilt from '@/components/Tilt';
import Magnetic from '@/components/Magnetic';

const CHECKPOINTS = [
  { name: 'Mangalagiri Jn', lat: 16.4422, lng: 80.5604 },
  { name: 'Neerukonda', lat: 16.4715, lng: 80.5055 },
  { name: 'SRM Main Gate', lat: 16.4673, lng: 80.5002 },
  { name: 'Academic Block', lat: 16.4635, lng: 80.5065 },
  { name: 'Hostel Sector', lat: 16.4618, lng: 80.5068 }
];

const FALLBACK_HOME_COORD = { lat: 16.4632, lng: 80.5064 };

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
import { socket } from '@/utils/socket';

interface OrderInfo {
  _id: string;
  status: string;
  totalPrice: number;
  finalPrice?: number;
  batchDiscount?: number;
  deliveryPin?: string;
  items?: { name: string; quantity: number }[];
  riderOtherOrders?: number;
  deliveryPartner?: {
    id: string;
    _id?: string;
    name: string;
    phone?: string;
    photoUrl?: string;
    averageRating?: number;
    totalRatings?: number;
    vehicleType?: string;
    vehicleNumber?: string;
    bio?: string;
  };
}


function TrackingContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('id');
  const [status, setStatus] = useState(1); 

  // Resolve home coordinate dynamically from user's saved address
  const homeCoord = useMemo(() => {
    if (typeof window === 'undefined') return FALLBACK_HOME_COORD;
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.address) {
          const coords = getCoordsForAddress(parsed.address);
          return { lat: coords.lat, lng: coords.lon };
        }
      }
    } catch { /* ignore */ }
    return FALLBACK_HOME_COORD;
  }, []);

  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null);
  const [, setIsElite] = useState(false);
  const [currentCheckpoint, setCurrentCheckpoint] = useState<string>('Mangalagiri Jn');
  
  // Real-Time Dynamic Telemetry State
  const [eta, setEta] = useState('Calculating...');
  const [captainSpeed, setCaptainSpeed] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  
  const [showDeliveryOverlay, setShowDeliveryOverlay] = useState(false);
  const [newBadges, setNewBadges] = useState<string[]>([]);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [gateNotification, setGateNotification] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [activeIssue, setActiveIssue] = useState<{ issueType: string; details: string; senderRole: string } | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);


  const [cancelSecondsLeft, setCancelSecondsLeft] = useState(0);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);

  const [userName, setUserName] = useState('Customer');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.isElite) setIsElite(true);
        if (parsed.name) setUserName(parsed.name);
      }
    } catch { /* ignore */ }

    if (!orderId) return;

    socket.emit('joinOrder', orderId);
    
    socket.on('connect', () => {
      setIsConnected(true);
      socket.emit('joinOrder', orderId);
    });
    socket.on('disconnect', () => setIsConnected(false));
    if (socket.connected) setIsConnected(true);
    
    socket.on('driverAtGate', (data: { message: string }) => {
      setGateNotification(data.message);
      setTimeout(() => setGateNotification(null), 10000);
    });

    const fetchOrder = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/api/orders/${orderId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (typeof data.items === 'string') {
          try { data.items = JSON.parse(data.items); } catch { data.items = []; }
        }
        setOrderInfo(data);
        if (data.status === 'Pending') setStatus(1);
        if (data.status === 'Accepted') setStatus(2);
        if (data.status === 'PickedUp') setStatus(3);
        if (data.status === 'Delivered') {
          setStatus(4);
          if (!data.rating) setShowRatingModal(true);
        }

        // Handle cancellation timer
        if (data.status === 'Pending' && data.createdAt) {
          const elapsed = (Date.now() - new Date(data.createdAt).getTime()) / 1000;
          const remaining = Math.max(0, 120 - Math.round(elapsed));
          setCancelSecondsLeft(remaining);
        }
      } catch {
        setActiveIssue({
          issueType: 'Network Instability',
          details: 'Fetching latest tracking data failed. Retrying...',
          senderRole: 'system'
        });
        setTimeout(() => setActiveIssue(null), 5000);
      }
    };

    socket.on('statusUpdated', (data: { status: string; newBadges?: string[] } | string) => {
      const newStatus = typeof data === 'string' ? data : data.status;
      const earnedBadges = typeof data === 'object' && data !== null ? data.newBadges || [] : [];

      if (newStatus === 'Pending') setStatus(1);
      if (newStatus === 'Accepted') { setStatus(2); fetchOrder(); } // Re-fetch to get rider info
      if (newStatus === 'PickedUp') { setStatus(3); fetchOrder(); } // Re-fetch to confirm rider
      if (newStatus === 'Delivered') {
        setStatus(4);
        setCaptainSpeed(0);
        setNewBadges(earnedBadges);
        setShowDeliveryOverlay(true);
      }
      if (newStatus === 'Cancelled') {
        setStatus(-1);
      }
    });

    // Live rider profile updates (e.g. name/photo change mid-ride)
    socket.on('rider_profile_updated', (data: Record<string, unknown>) => {
      setOrderInfo(prev => {
        if (!prev || !prev.deliveryPartner) return prev;
        if (prev.deliveryPartner.id !== data.riderId) return prev;
        return { ...prev, deliveryPartner: { ...prev.deliveryPartner, ...data } };
      });
    });

    socket.on('issue_alert', (data: { issueType: string; details: string; senderRole: string }) => {
      setActiveIssue(data);
      setTimeout(() => setActiveIssue(null), 15000);
    });
    
    socket.on('typing_start', () => {});

    socket.on('checkpointUpdated', (data: { currentCheckpoint: string }) => {
      setCurrentCheckpoint(prev => prev === data.currentCheckpoint ? prev : data.currentCheckpoint);
    });

    // Initial fetch
    fetchOrder();

    // Poll every 10s to catch rider assignment if socket missed it
    const pollInterval = setInterval(fetchOrder, 10000);

    return () => {
      clearInterval(pollInterval);
      socket.off('connect');
      socket.off('disconnect');
      socket.off('statusUpdated');
      socket.off('checkpointUpdated');
      socket.off('driverAtGate');
      socket.off('rider_profile_updated');
      socket.off('issue_alert');
      socket.off('typing_start');
    };
  }, [orderId]);

  useEffect(() => {
    if (cancelSecondsLeft > 0 && status === 1) {
      const tick = setInterval(() => setCancelSecondsLeft(p => Math.max(0, p - 1)), 1000);
      return () => clearInterval(tick);
    }
  }, [cancelSecondsLeft, status]);

  const cancelOrderAction = async () => {
    try {
      const token = localStorage.getItem('token');
      await fetch(`${API_URL}/api/orders/${orderId}/cancel`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      localStorage.removeItem('last_order');
      window.location.href = '/';
    } catch (_err) {
      console.warn('[CANCEL_ORDER] Backend cancellation failed:', _err);
    }
  };

  const [roadEta] = useState<number | null>(null);

  useEffect(() => {
    if (status === 4) {
      setEta('Arrived');
      return;
    }
    const idx = CHECKPOINTS.findIndex(cp => cp.name === currentCheckpoint);
    const remainingSteps = CHECKPOINTS.length - 1 - idx;
    const timeMins = Math.max(2, remainingSteps * 4); // 4 mins per checkpoint average
    setEta(`~${timeMins} min`);
  }, [currentCheckpoint, status]);

  const steps = [
    { label: 'Order Placed', time: 'Just now', desc: 'Your order has been received and is pending acceptance.' },
    { label: 'Order Accepted', time: 'Soon', desc: 'Driver has accepted and is preparing to fetch your meal.' },
    { label: 'Out for Delivery', time: 'Soon', desc: 'Rider is on the way to your Hostel Block.' },
    { label: 'Arrived', time: 'Estimated 5m', desc: 'Pick up your food at the designated spot.' }
  ];

  if (status === -1) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in duration-500">
         <div className="w-24 h-24 bg-red-500/10 rounded-full flex items-center justify-center mb-8 border border-red-500/20 shadow-[0_0_40px_rgba(239,68,68,0.2)]">
            <span className="text-4xl">❌</span>
         </div>
         <h1 className="text-3xl font-black text-white uppercase tracking-widest mb-4">Order Cancelled</h1>
         <p className="text-sm font-bold text-slate-400 mb-8 max-w-sm leading-relaxed">
            We are sorry, but this order has been cancelled by the restaurant, or it was manually aborted.
         </p>
         
         <div className="bg-white/[0.03] border border-white/5 p-6 rounded-3xl w-full max-w-sm mb-10 text-left">
            <h3 className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-3 flex items-center gap-2">
               <span className="animate-pulse w-2 h-2 bg-emerald-500 rounded-full"></span>
               Refund Status
            </h3>
            <p className="text-sm text-white font-medium">
               A full refund of <strong className="text-emerald-400">₹{orderInfo?.finalPrice || orderInfo?.totalPrice || 0}</strong> has been initiated. It will reflect in your original payment method within 3-5 business days.
            </p>
         </div>

         <Link href="/" className="px-10 py-5 bg-white text-black text-[11px] font-black uppercase tracking-widest rounded-2xl hover:scale-105 transition-transform">
           Return Home
         </Link>
      </main>
    );
  }

  return (
    <main className={`min-h-screen bg-[#0A0A0B] text-white px-4 py-6 md:p-8 animate-page relative overflow-x-hidden ${status === 3 || status === 4 ? 'animate-edge-glow' : ''}`} style={{ fontSize: '16px' }}>
      <div className="max-w-3xl mx-auto w-full">
      {/* Cinematic Background */}
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(201,168,76,0.05)_0%,transparent_50%)] pointer-events-none" />
      <div className="fixed inset-0 bg-gradient-to-b from-black via-transparent to-black pointer-events-none opacity-40" />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 md:mb-12 gap-4 md:gap-6 relative z-10">
        <div className="flex items-center justify-between md:justify-start gap-4">
          <Magnetic>
            <Link href="/" className="w-12 h-12 bg-white/5 backdrop-blur-xl rounded-full flex items-center justify-center border border-white/10 hover:bg-white/10 transition-all">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
          </Magnetic>
          <div>
            <h1 className="text-lg md:text-xl font-black uppercase tracking-[0.2em] md:tracking-[0.3em] text-gold-shimmer md:ml-4">Order Tracking</h1>
            {orderId && (
              <p className="text-xs font-bold text-blue-400 uppercase tracking-widest md:ml-4 mt-1">Order #{orderId.slice(-6).toUpperCase()}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {status === 1 && cancelSecondsLeft > 0 && (
            <Magnetic>
              <button
                onClick={() => setShowCancelConfirmation(true)}
                className="px-5 py-3 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-black transition-all text-xs font-black uppercase tracking-wider rounded-full border border-red-500/20 shadow-lg shadow-red-500/10"
              >
                Cancel Order ({cancelSecondsLeft}s)
              </button>
            </Magnetic>
          )}
          <Magnetic>
            <button 
              onClick={() => setIsChatOpen(true)}
              className="w-12 h-12 bg-white/5 backdrop-blur-xl text-white rounded-full flex items-center justify-center border border-white/10 hover:bg-white/10 transition-all relative"
            >
              <span className="text-xl">💬</span>
            </button>
          </Magnetic>
        </div>
      </div>

      {showCancelConfirmation && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ fontSize: '16px' }}>
           <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setShowCancelConfirmation(false)} />
           <div className="relative bg-[#1A1A1C] border border-white/10 p-6 md:p-8 rounded-3xl md:rounded-[40px] max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-300 mx-auto">
              <h3 className="text-xl font-black text-white mb-2">Cancel Order?</h3>
              <p className="text-sm text-secondary-text mb-6 leading-relaxed font-bold">This action cannot be undone. You will lose your current queue position and any batch discounts.</p>
              <div className="flex flex-col gap-3">
                 <button 
                   onClick={cancelOrderAction}
                   className="w-full py-4 bg-red-500 text-white font-black uppercase tracking-widest text-xs rounded-2xl shadow-xl shadow-red-500/20"
                 >
                   Yes, Cancel Order
                 </button>
                 <button 
                   onClick={() => setShowCancelConfirmation(false)}
                   className="w-full py-4 bg-white/5 text-white font-black uppercase tracking-widest text-xs rounded-2xl border border-white/5"
                 >
                   Keep My Order
                 </button>
              </div>
           </div>
        </div>
      )}


          {/* ─── Mission Progress Radar (Hybrid Map) ─── */}
          <Tilt scale={1.01} className="relative h-[280px] md:h-[480px] rounded-3xl md:rounded-[48px] overflow-hidden border border-white/10 bg-black/40 shadow-2xl z-10 transition-all">
            <LeafletTrackingMapSub 
              currentCheckpoint={currentCheckpoint}
              checkpoints={CHECKPOINTS}
              homeCoord={homeCoord}
            />
            
            {/* Delivery HUD Overlays */}
            <div className="absolute top-4 left-4 right-4 md:top-8 md:left-8 md:right-8 z-[1000] flex justify-between items-start pointer-events-none">
              <div className="bg-black/60 backdrop-blur-3xl px-4 py-3 md:px-6 md:py-4 rounded-2xl md:rounded-[32px] border border-white/10 shadow-2xl">
                <h3 className="text-xs font-black text-primary-yellow uppercase tracking-wider mb-1 flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                  GPS Tracking: Active
                </h3>
                <p className="text-[10px] font-black text-white/50 uppercase tracking-wide">{currentCheckpoint?.toUpperCase()}</p>
              </div>
              
              {!isConnected && (
                <div className="bg-red-500/10 backdrop-blur-xl px-4 py-2 border-red-500/30 rounded-2xl flex items-center gap-2">
                  <span className="text-[10px] font-black text-red-500 uppercase tracking-widest">GPS Signal Lost</span>
                  <span className="animate-ping w-1.5 h-1.5 bg-red-500 rounded-full" />
                </div>
              )}
            </div>
          </Tilt>

          <div className="mt-6 md:mt-8 flex flex-col md:flex-row justify-between items-start md:items-center bg-white/[0.03] p-5 md:p-8 rounded-2xl md:rounded-[36px] border border-white/5 relative z-10 gap-4 md:gap-6">
             <div className="flex items-center gap-4">
                <div className="w-12 h-12 md:w-14 md:h-14 bg-[#C9A84C]/10 rounded-xl md:rounded-2xl flex items-center justify-center text-xl md:text-2xl border border-[#C9A84C]/20 shadow-inner">📡</div>
                <div>
                   <p className="text-[11px] font-black text-white/30 uppercase tracking-wider mb-1">Current Sector</p>
                   <p className="text-base font-black text-white uppercase tracking-tight">{currentCheckpoint}</p>
                </div>
             </div>
             <div className="text-left md:text-right w-full md:w-auto">
                <p className="text-[11px] font-black text-white/30 uppercase tracking-wider mb-1">Tactical ETA</p>
                <div className="px-4 py-1.5 bg-[#C9A84C]/10 rounded-full border border-[#C9A84C]/20 inline-block">
                   <p className="text-sm font-black text-primary-yellow animate-pulse uppercase">{eta}</p>
                </div>
             </div>
          </div>

      {/* Dynamic Order Summary */}
      {orderInfo && (
        <Tilt scale={1.01} className="mb-6 relative z-10">
          <div className="p-5 md:p-8 bg-white/[0.03] backdrop-blur-2xl rounded-2xl md:rounded-[48px] border border-white/10 flex flex-col md:flex-row md:items-center justify-between group overflow-hidden gap-5 md:gap-8">
              <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity">
                 <span className="text-4xl font-black italic">VAULT</span>
              </div>
              <div className="flex items-center gap-6 relative z-10">
                <div className="w-16 h-16 bg-[#C9A84C]/10 rounded-2xl flex items-center justify-center border border-[#C9A84C]/20 text-3xl shadow-inner">
                   📦
                </div>
                <div>
                   <h4 className="text-xs font-black uppercase tracking-wider text-white/40 mb-1">ORDER #{orderId?.slice(-6)}</h4>
                   <div className="flex flex-col gap-1">
                      <p className="text-lg font-black text-white tracking-widest">
                        {orderInfo?.items ? (Array.isArray(orderInfo.items) ? orderInfo.items.length : 0) : 0} Items <span className="text-[#C9A84C] mx-2">•</span> ₹{orderInfo?.totalPrice || 0}
                      </p>
                      { (orderInfo.batchDiscount || 0) > 0 && (
                        <div className="px-3 py-1 bg-emerald-500/10 rounded-full border border-emerald-500/20 inline-flex self-start mt-2">
                          <p className="text-[8px] font-black text-emerald-400 uppercase tracking-[0.1em]">
                            ✨ Eco-Batching Efficiency Active (-₹{orderInfo.batchDiscount})
                          </p>
                        </div>
                      )}
                   </div>
                </div>
             </div>
             
             {orderInfo.deliveryPin && (
                <div className="text-right relative z-10">
                   <p className="text-xs font-black uppercase text-white/50 tracking-wider mb-2">Gate Activation PIN</p>
                   <div className="bg-[#C9A84C] text-white px-6 py-4 rounded-2xl font-black text-3xl tracking-[0.3em] shadow-[0_10px_30px_rgba(201,168,76,0.5)] border border-[#E8D48B]/30">
                     {orderInfo.deliveryPin}
                   </div>
                </div>
             )}
          </div>
        </Tilt>
      )}

      {/* Live Sync Status & Telemetry */}
      <div className="flex flex-col lg:flex-row gap-4 mb-8">
        <div 
          onClick={() => orderInfo?.deliveryPartner && setIsProfileOpen(true)}
          className={`flex-[2] glass-card p-4 md:p-6 border-[#C9A84C]/20 relative overflow-hidden transition-all ${orderInfo?.deliveryPartner ? 'cursor-pointer active:scale-95 hover:bg-white/[0.03]' : 'cursor-default'}`}
        >
           <div className="absolute top-0 right-0 p-2 opacity-5 pointer-events-none">
              <span className="text-[40px] font-black italic">RIDER</span>
           </div>
           
           <div className="flex items-center gap-5 relative z-10">
              <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-slate-800 flex items-center justify-center">
                  {orderInfo?.deliveryPartner?.photoUrl ? (
                  <SafeImage 
                    src={orderInfo.deliveryPartner.photoUrl} 
                    alt="Captain" 
                    className="w-full h-full object-cover" 
                    priority
                  />
                ) : (
                   <span className="text-3xl">🛵</span>
                 )}
              </div>
              <div className="flex-1">
                 <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                    <div>
                       <div className="flex items-center gap-1.5 mb-1">
                         <p className="text-[11px] font-black uppercase tracking-wider text-primary-yellow">Delivery Rider</p>
                         <span className="bg-emerald-500/10 text-emerald-500 text-[10px] font-black px-1.5 py-0.5 rounded border border-emerald-500/20">VERIFIED</span>
                       </div>
                       <h3 className="text-sm font-black text-white">
                         {orderInfo?.deliveryPartner?.name || 'Searching Rider...'} • {orderInfo?.deliveryPartner?.averageRating || '5.0'}⭐
                       </h3>
                       <p className="text-[11px] font-bold text-secondary-text uppercase tracking-wide mt-0.5">
                         {orderInfo?.deliveryPartner?.vehicleType || 'Zenvy Rider'} 
                         {orderInfo?.deliveryPartner?.vehicleNumber ? ` • ${orderInfo.deliveryPartner.vehicleNumber}` : ` # ${orderId?.slice(-4)}`}
                       </p>
                    </div>
                    <div className="text-left sm:text-right w-full sm:w-auto flex flex-col items-start sm:items-end">
                        <p className="text-[11px] font-black text-secondary-text uppercase mb-1">{eta}</p>
                        <p className="text-xs font-black text-white italic">{status === 4 ? '0' : captainSpeed} km/h</p>
                        <div className="w-20 h-1 bg-white/5 rounded-full overflow-hidden mt-1 relative shrink-0">
                           <div 
                             className="h-full bg-gradient-to-r from-[#D4A853] to-[#C9A84C] telemetry-bar-glow rounded-full"
                             style={{ width: `${Math.min(100, Math.max(8, (Number(status === 4 ? 0 : captainSpeed) || 0) * 2.5))}%` }}
                           />
                         </div>
                       {roadEta !== null && (
                         <p className="text-[6px] font-bold text-primary-yellow mt-1">Road Distance Ready</p>
                       )}
                    </div>
                 </div>
                 {orderInfo?.deliveryPartner?.bio && (
                   <p className="text-[8px] text-white/50 italic mt-1 line-clamp-1">&quot;{orderInfo.deliveryPartner.bio}&quot;</p>
                 )}
                 <div className="w-full h-1 bg-white/5 rounded-full mt-3 overflow-hidden">
                    <div 
                      className="h-full bg-primary-yellow transition-all duration-1000 ease-out relative"
                      style={{ width: `${status === 1 ? 15 : status === 2 ? 45 : status === 3 ? 80 : 100}%` }}
                    >
                       <div className="absolute inset-0 bg-white/20 animate-shimmer" />
                    </div>
                 </div>
              </div>
           </div>
        </div>

        <div className="flex-1 glass-card p-4 md:p-6 border-white/[0.05] flex flex-col justify-center items-center">
           <p className="text-[11px] font-black uppercase tracking-wider text-primary-yellow mb-2 text-center">Delivery Status</p>
           <div className="flex items-center gap-2">
              <span className="text-xl">{status === 4 ? '✅' : '🛵'}</span>
              <span className="text-sm font-black text-white">{status === 4 ? 'DELIVERED' : 'EN ROUTE'}</span>
           </div>
           <p className="text-[10px] font-black text-secondary-text uppercase mt-2 text-center">Secure Delivery Active</p>
        </div>
      </div>

      {/* Batching Transparency Banner */}
      {orderInfo?.riderOtherOrders && orderInfo.riderOtherOrders > 0 && (status === 2 || status === 3) && (
        <div className="mb-8 animate-in slide-in-from-top duration-700">
           <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-3xl flex items-center gap-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-5">
                 <span className="text-4xl font-black italic">ECO</span>
              </div>
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-xl">🌱</div>
              <div>
                 <p className="text-[9px] font-black text-emerald-400 uppercase tracking-[0.3em] mb-1">Batching Optimization</p>
                 <p className="text-xs font-bold text-white">Rider is delivering another order on the way.</p>
                 <p className="text-[9px] text-emerald-400/60 mt-1 uppercase font-black">This helps us reduce carbon footprint & delivery fees!</p>
              </div>
           </div>
        </div>
      )}

      {/* Status Timeline */}
      <div className="space-y-10 pl-6 relative">
        {steps.map((step, idx) => {
          const isActive = status >= idx + 1;
          const isCurrent = status === idx + 1;
          
          return (
            <div key={idx} className={`relative flex gap-10 transition-all duration-700 ${!isActive ? 'opacity-20 translate-x-4' : 'opacity-100 translate-x-0'}`}>
               {idx !== steps.length - 1 && (
                 <div className={`timeline-line ${isActive && status > idx + 1 ? 'active' : ''}`} />
               )}
               
               <div className={`timeline-dot shrink-0 mt-1.5 ${isActive ? 'active' : ''}`}>
                  {isCurrent && <div className="absolute inset-[-4px] rounded-full border border-primary-gold/30 animate-ping" />}
               </div>
 
               <div className="pb-4">
                  <div className="flex flex-col mb-1">
                     <span className={`text-[11px] font-black uppercase tracking-wider mb-1 ${isCurrent ? 'text-primary-gold' : 'text-secondary-text'}`}>
                        {isCurrent ? 'Current Status' : isActive ? 'Completed' : 'Upcoming'}
                     </span>
                     <h3 className="font-black text-sm uppercase tracking-widest">{step.label}</h3>
                  </div>
                  <p className="text-sm text-secondary-text leading-relaxed font-medium">
                     {step.desc}
                  </p>
                  {isCurrent && (
                     <div className="mt-4 px-3 py-1.5 bg-primary-gold/10 border border-primary-gold/20 rounded-full inline-flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-primary-gold animate-pulse" />
                        <span className="text-[8px] font-black uppercase tracking-widest text-primary-gold">{step.time}</span>
                     </div>
                  )}
               </div>
            </div>
          );
        })}
      </div>

      {/* Gate-2 Arrival Notification (Premium Glassmorphism) */}
      {gateNotification && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-md animate-in fade-in zoom-in duration-500">
           <div className="bg-black/60 backdrop-blur-2xl border border-primary-yellow/30 rounded-2xl p-4 shadow-[0_0_40px_rgba(201,168,76,0.2)] flex items-center gap-4">
              <div className="w-12 h-12 bg-primary-yellow/20 rounded-xl flex items-center justify-center text-2xl animate-pulse">🛎️</div>
              <div>
                 <p className="text-[10px] font-black text-primary-yellow uppercase tracking-widest mb-0.5">Campus Security Alert</p>
                 <p className="text-sm font-bold text-white leading-tight">{gateNotification}</p>
                 <p className="text-[9px] text-white/40 mt-1 uppercase font-medium">Please proceed to GATE-2 for pickup</p>
              </div>
              <button onClick={() => setGateNotification(null)} className="ml-auto text-white/20 hover:text-white transition-colors">
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                 </svg>
              </button>
           </div>
        </div>
      )}


      {/* Issue Alert HUD */}
      {activeIssue && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[110] w-[90%] max-w-md animate-in slide-in-from-bottom duration-500">
           <div className="bg-red-500/90 backdrop-blur-xl border border-white/20 rounded-3xl p-5 shadow-2xl flex items-center gap-5">
              <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl">⚠️</div>
              <div>
                 <p className="text-[10px] font-black text-white/70 uppercase tracking-widest mb-0.5">Delivery Alert: {activeIssue.senderRole}</p>
                 <p className="text-sm font-black text-white leading-tight">{activeIssue.issueType}</p>
                 <p className="text-[9px] text-white/50 mt-1 font-bold uppercase">{activeIssue.details || 'Immediate attention required'}</p>
              </div>
              <button onClick={() => setActiveIssue(null)} className="ml-auto text-white/40 hover:text-white transition-colors text-xl font-bold">×</button>
           </div>
        </div>
      )}

      <DeliverySuccessOverlay 
        isOpen={showDeliveryOverlay} 
        newBadges={newBadges}
        onComplete={() => {
          setShowDeliveryOverlay(false);
          setShowRatingModal(true);
        }} 
      />

      <RatingModal
        isOpen={showRatingModal}
        onClose={() => setShowRatingModal(false)}
        onSubmit={async (rating, review) => {
          const token = localStorage.getItem('token');
          await fetch(`${API_URL}/api/orders/${orderId}/rate`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ rating, review })
          });
        }}
      />

      <ChatDrawer
        orderId={orderId || ''}
        userName={userName}
        userRole="customer"
        socket={socket}
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
      />

      <RiderProfileModal 
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        partner={orderInfo?.deliveryPartner || null}
      />
      </div>
    </main>
  );
}

export default function TrackingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background text-white p-8 flex items-center justify-center font-black animate-pulse">Loading Tracker...</div>}>
      <TrackingContent />
    </Suspense>
  );
}

