"use client";
import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import SafeImage from '@/components/SafeImage';
import DeliverySuccessOverlay from '@/components/DeliverySuccessOverlay';
import RatingModal from '@/components/RatingModal';
import ChatDrawer from '@/components/ChatDrawer';
import RiderProfileModal from '@/components/RiderProfileModal';
import Magnetic from '@/components/Magnetic';
import { socket } from '@/utils/socket';

const CHECKPOINTS = [
  { name: 'Mangalagiri Jn' },
  { name: 'Neerukonda' },
  { name: 'SRM Main Gate' },
  { name: 'Academic Block' },
  { name: 'Hostel Sector' },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

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
    id: string; _id?: string; name: string; phone?: string;
    photoUrl?: string; averageRating?: number; totalRatings?: number;
    vehicleType?: string; vehicleNumber?: string; bio?: string;
  };
}


function TrackingContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('id');
  const [status, setStatus] = useState(1);
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null);
  const [currentCheckpoint, setCurrentCheckpoint] = useState('Mangalagiri Jn');
  const [eta, setEta] = useState('Calculating...');
  const [isConnected, setIsConnected] = useState(false);
  const [showDeliveryOverlay, setShowDeliveryOverlay] = useState(false);
  const [newBadges, setNewBadges] = useState<string[]>([]);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [gateNotification, setGateNotification] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [cancelSecondsLeft, setCancelSecondsLeft] = useState(0);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [userName, setUserName] = useState('Customer');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const p = JSON.parse(stored);
        if (p.name) setUserName(p.name);
      }
    } catch { /* ignore */ }
    if (!orderId) return;

    socket.emit('joinOrder', orderId);
    socket.on('connect', () => { setIsConnected(true); socket.emit('joinOrder', orderId); });
    socket.on('disconnect', () => setIsConnected(false));
    if (socket.connected) setIsConnected(true);
    socket.on('driverAtGate', (data: { message: string }) => {
      setGateNotification(data.message);
      setTimeout(() => setGateNotification(null), 10000);
    });

    const fetchOrder = async () => {
      try {
        const res = await fetch(`${API_URL}/api/orders/${orderId}`);
        const data = await res.json();
        if (typeof data.items === 'string') {
          try { data.items = JSON.parse(data.items); } catch { data.items = []; }
        }
        setOrderInfo(data);
        if (data.status === 'Pending') setStatus(1);
        else if (data.status === 'Accepted') setStatus(2);
        else if (data.status === 'Preparing' || data.status === 'ReadyForPickup') setStatus(3);
        else if (data.status === 'PickedUp') setStatus(4);
        else if (data.status === 'Delivered') { setStatus(5); if (!data.rating) setShowRatingModal(true); }
        else if (data.status === 'Cancelled') setStatus(-1);
        if (data.status === 'Pending' && data.createdAt) {
          const elapsed = (Date.now() - new Date(data.createdAt).getTime()) / 1000;
          setCancelSecondsLeft(Math.max(0, 120 - Math.round(elapsed)));
        }
      } catch { /* ignore */ }
    };

    socket.on('statusUpdated', (data: { status: string; newBadges?: string[] } | string) => {
      const s = typeof data === 'string' ? data : data.status;
      const badges = typeof data === 'object' && data !== null ? data.newBadges || [] : [];
      if (s === 'Pending') setStatus(1);
      else if (s === 'Accepted') { setStatus(2); fetchOrder(); }
      else if (s === 'Preparing' || s === 'ReadyForPickup') { setStatus(3); fetchOrder(); }
      else if (s === 'PickedUp') { setStatus(4); fetchOrder(); }
      else if (s === 'Delivered') { setStatus(5); setNewBadges(badges); setShowDeliveryOverlay(true); }
      else if (s === 'Cancelled') setStatus(-1);
    });
    socket.on('checkpointUpdated', (d: { currentCheckpoint: string }) => {
      setCurrentCheckpoint(prev => prev === d.currentCheckpoint ? prev : d.currentCheckpoint);
    });
    socket.on('rider_profile_updated', (d: Record<string, unknown>) => {
      setOrderInfo(prev => {
        if (!prev?.deliveryPartner || prev.deliveryPartner.id !== d.riderId) return prev;
        return { ...prev, deliveryPartner: { ...prev.deliveryPartner, ...d } };
      });
    });

    fetchOrder();
    const poll = setInterval(fetchOrder, 10000);
    return () => {
      clearInterval(poll);
      socket.off('connect'); socket.off('disconnect'); socket.off('statusUpdated');
      socket.off('checkpointUpdated'); socket.off('driverAtGate');
      socket.off('rider_profile_updated');
    };
  }, [orderId]);

  useEffect(() => {
    if (cancelSecondsLeft > 0 && status === 1) {
      const t = setInterval(() => setCancelSecondsLeft(p => Math.max(0, p - 1)), 1000);
      return () => clearInterval(t);
    }
  }, [cancelSecondsLeft, status]);

  useEffect(() => {
    if (status >= 4) { setEta('Arrived'); return; }
    const idx = CHECKPOINTS.findIndex(cp => cp.name === currentCheckpoint);
    const remaining = CHECKPOINTS.length - 1 - Math.max(0, idx);
    setEta(`~${Math.max(2, remaining * 4)} min`);
  }, [currentCheckpoint, status]);

  const cancelOrderAction = async () => {
    try {
      await fetch(`${API_URL}/api/orders/${orderId}/cancel`, { method: 'PUT', headers: { 'Content-Type': 'application/json' } });
      localStorage.removeItem('last_order');
      window.location.href = '/';
    } catch { /* ignore */ }
  };

  const steps = [
    { label: 'Order Placed', desc: 'Your order has been received.' },
    { label: 'Order Accepted', desc: 'Driver is preparing to fetch your meal.' },
    { label: 'Kitchen Preparing', desc: 'The kitchen is cooking your order right now.' },
    { label: 'Out for Delivery', desc: 'Rider is on the way to your hostel.' },
    { label: 'Arrived', desc: 'Pick up your food at the designated spot.' },
  ];

  if (status === -1) {
    return (
      <main className="min-h-screen bg-[#0A0A0B] flex flex-col items-center justify-center p-8 text-center">
        <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-6 border border-red-500/20">
          <span className="text-3xl">✕</span>
        </div>
        <h1 className="text-2xl font-bold text-white mb-3">Order Cancelled</h1>
        <p className="text-sm text-[#6B6B6B] mb-8 max-w-xs">This order was cancelled. A full refund of <strong className="text-emerald-400">₹{orderInfo?.finalPrice || orderInfo?.totalPrice || 0}</strong> has been initiated.</p>
        <Link href="/" className="px-8 py-4 bg-white text-black text-xs font-bold uppercase tracking-widest rounded-2xl">Return Home</Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0A0A0B] text-white">
      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Magnetic>
              <Link href="/" className="w-10 h-10 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10 hover:border-[#C9A84C]/30 transition-colors">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
            </Magnetic>
            <div>
              <h1 className="text-sm font-bold text-white uppercase tracking-widest">Order Tracking</h1>
              {orderId && <p className="text-xs text-[#C9A84C] font-bold tracking-wider">#{orderId.slice(-6).toUpperCase()}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* ETA chip */}
            {eta && eta !== 'Calculating...' && (
              <div className="flex items-center gap-1.5 bg-[#C9A84C]/10 border border-[#C9A84C]/20 rounded-xl px-3 py-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${status >= 5 ? 'bg-emerald-400' : 'bg-[#C9A84C] animate-pulse'}`} />
                <span className="text-xs font-bold text-[#C9A84C]">{eta}</span>
              </div>
            )}
            {status === 1 && cancelSecondsLeft > 0 && (
              <button onClick={() => setShowCancelConfirmation(true)} className="px-4 py-2 text-xs font-bold text-red-400 border border-red-500/20 rounded-xl hover:bg-red-500/10 transition-colors">
                Cancel ({cancelSecondsLeft}s)
              </button>
            )}
            <button onClick={() => setIsChatOpen(true)} className="w-10 h-10 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10 hover:border-[#C9A84C]/30 transition-colors text-lg">
              💬
            </button>
          </div>
        </div>

        {/* What's Happening Now */}
        <div className="bg-[#141416] border border-[#C9A84C]/10 rounded-2xl px-4 py-3 mb-4 flex items-center gap-3">
          <span className="text-xl shrink-0">
            {status === 1 ? '⏳' : status === 2 ? '✅' : status === 3 ? '🍳' : status === 4 ? '🛵' : '🎉'}
          </span>
          <div>
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">What&apos;s happening now</p>
            <p className="text-sm font-semibold text-white">
              {status === 1 && 'Waiting for the restaurant to accept your order'}
              {status === 2 && 'Restaurant accepted — rider is heading to pick up'}
              {status === 3 && 'Kitchen is cooking your order fresh right now'}
              {status === 4 && `Rider is on the way to ${currentCheckpoint}`}
              {status >= 5 && 'Your order has been delivered!'}
            </p>
          </div>
        </div>


        {/* Order Card + PIN */}
        {orderInfo && (
          <div className="bg-[#141416] border border-[#C9A84C]/10 rounded-3xl p-5 mb-4">
            <div className="flex items-center justify-between gap-4 mb-3">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-[#C9A84C]/10 rounded-2xl flex items-center justify-center text-xl border border-[#C9A84C]/15">📦</div>
                <div>
                  <p className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-0.5">Order #{orderId?.slice(-6)}</p>
                  <p className="text-sm font-bold text-white">
                    {Array.isArray(orderInfo.items) ? orderInfo.items.length : 0} item{Array.isArray(orderInfo.items) && orderInfo.items.length !== 1 ? 's' : ''} · ₹{orderInfo.finalPrice || orderInfo.totalPrice}
                  </p>
                  {(orderInfo.batchDiscount || 0) > 0 && (
                    <p className="text-[9px] text-emerald-400 font-bold mt-0.5">✦ Eco batch discount –₹{orderInfo.batchDiscount}</p>
                  )}
                </div>
              </div>
              {orderInfo.deliveryPin && (
                <div className="text-right shrink-0">
                  <p className="text-[9px] font-bold text-white/30 uppercase tracking-wider mb-1">Gate PIN</p>
                  <div className="bg-[#C9A84C] text-[#0A0A0B] px-4 py-2 rounded-xl font-black text-2xl tracking-[0.25em] shadow-lg shadow-[#C9A84C]/20">
                    {orderInfo.deliveryPin}
                  </div>
                </div>
              )}
            </div>
            {/* Items list */}
            {Array.isArray(orderInfo.items) && orderInfo.items.length > 0 && (
              <div className="border-t border-white/5 pt-3 space-y-1.5">
                {orderInfo.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 bg-white/8 rounded-md flex items-center justify-center text-[10px] font-bold text-white/40">{item.quantity}</span>
                      <span className="text-xs text-white/70 font-medium">{item.name}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Rider Card */}
        <div
          onClick={() => orderInfo?.deliveryPartner && setIsProfileOpen(true)}
          className={`bg-[#141416] border border-[#C9A84C]/10 rounded-3xl p-5 mb-3 ${orderInfo?.deliveryPartner ? 'cursor-pointer hover:border-[#C9A84C]/25 transition-colors' : ''}`}
        >
          <p className="text-[10px] font-bold text-[#C9A84C] uppercase tracking-widest mb-4">Delivery Rider</p>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl overflow-hidden border border-white/10 bg-white/5 flex items-center justify-center shrink-0">
              {orderInfo?.deliveryPartner?.photoUrl
                ? <SafeImage src={orderInfo.deliveryPartner.photoUrl} alt="Rider" className="w-full h-full object-cover" />
                : <span className="text-2xl">🛵</span>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-bold text-white truncate">
                  {orderInfo?.deliveryPartner?.name || 'Searching rider...'}
                </p>
                <span className="text-[9px] font-bold text-emerald-400 border border-emerald-400/20 bg-emerald-500/10 px-1.5 py-0.5 rounded shrink-0">VERIFIED</span>
              </div>
              <p className="text-xs text-[#6B6B6B] truncate">
                {orderInfo?.deliveryPartner?.vehicleType || 'Zenvy Rider'}
                {orderInfo?.deliveryPartner?.vehicleNumber ? ` · ${orderInfo.deliveryPartner.vehicleNumber}` : ''}
              </p>
              <p className="text-xs text-[#C9A84C] font-bold mt-1">
                ⭐ {orderInfo?.deliveryPartner?.averageRating || '5.0'}
              </p>
            </div>
            {orderInfo?.deliveryPartner && (
              <svg className="w-4 h-4 text-white/20 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
            )}
          </div>

          {/* Progress bar */}
          <div className="mt-4 w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#C9A84C] rounded-full transition-all duration-1000"
              style={{ width: `${status === 1 ? 10 : status === 2 ? 30 : status === 3 ? 55 : status === 4 ? 85 : 100}%` }}
            />
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <button
            onClick={() => setIsChatOpen(true)}
            className="flex flex-col items-center gap-2 bg-[#141416] border border-white/8 hover:border-[#C9A84C]/25 rounded-2xl py-4 transition-colors"
          >
            <span className="text-xl">💬</span>
            <span className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Chat</span>
          </button>
          <a
            href={orderInfo?.deliveryPartner?.phone ? `tel:${orderInfo.deliveryPartner.phone}` : '#'}
            className={`flex flex-col items-center gap-2 bg-[#141416] border border-white/8 hover:border-[#C9A84C]/25 rounded-2xl py-4 transition-colors ${!orderInfo?.deliveryPartner?.phone ? 'opacity-40 pointer-events-none' : ''}`}
          >
            <span className="text-xl">📞</span>
            <span className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Call Rider</span>
          </a>
          <button
            onClick={() => {
              if (navigator.share) {
                navigator.share({ title: 'Track my Zenvy order', url: window.location.href });
              } else {
                navigator.clipboard.writeText(window.location.href);
              }
            }}
            className="flex flex-col items-center gap-2 bg-[#141416] border border-white/8 hover:border-[#C9A84C]/25 rounded-2xl py-4 transition-colors"
          >
            <span className="text-xl">🔗</span>
            <span className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Share</span>
          </button>
        </div>

        {/* Steps Timeline */}
        <div className="bg-[#141416] border border-[#C9A84C]/10 rounded-3xl p-5 mb-4">
          <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-5">Order Progress</p>
          <div className="space-y-0">
            {steps.map((step, idx) => {
              const stepNum = idx + 1;
              const isDone = status > stepNum;
              const isCurrent = status === stepNum;
              const isUpcoming = status < stepNum;
              return (
                <div key={idx} className="flex gap-4 relative">
                  {/* Line */}
                  {idx < steps.length - 1 && (
                    <div className="absolute left-[17px] top-9 bottom-0 w-px bg-white/8" />
                  )}
                  {/* Dot */}
                  <div className={`w-9 h-9 rounded-full border-2 flex items-center justify-center shrink-0 z-10 transition-all ${
                    isDone ? 'bg-[#C9A84C] border-[#C9A84C] text-[#0A0A0B]' :
                    isCurrent ? 'bg-[#C9A84C]/10 border-[#C9A84C] text-[#C9A84C]' :
                    'bg-white/3 border-white/10 text-white/20'
                  }`}>
                    {isDone
                      ? <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                      : <span className="text-xs font-bold">{stepNum}</span>
                    }
                  </div>
                  {/* Text */}
                  <div className={`pb-6 ${isUpcoming ? 'opacity-30' : ''}`}>
                    <p className={`text-xs font-bold uppercase tracking-wider ${isCurrent ? 'text-[#C9A84C]' : isDone ? 'text-white/60' : 'text-white/30'}`}>
                      {isCurrent ? '● Current' : isDone ? 'Done' : 'Upcoming'}
                    </p>
                    <p className={`text-sm font-bold mt-0.5 ${isCurrent ? 'text-white' : isDone ? 'text-white/70' : 'text-white/30'}`}>{step.label}</p>
                    {(isCurrent || isDone) && <p className="text-xs text-[#6B6B6B] mt-0.5">{step.desc}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Batching Notice */}
        {orderInfo?.riderOtherOrders && orderInfo.riderOtherOrders > 0 && (status === 2 || status === 3) && (
          <div className="bg-emerald-500/8 border border-emerald-500/15 rounded-2xl p-4 mb-4 flex items-center gap-3">
            <span className="text-xl">🌱</span>
            <div>
              <p className="text-xs font-bold text-emerald-400">Eco Batching Active</p>
              <p className="text-xs text-[#6B6B6B] mt-0.5">Rider is delivering another order on the way — reducing carbon footprint.</p>
            </div>
          </div>
        )}

      </div>

      {/* Cancel Confirmation Modal */}
      {showCancelConfirmation && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setShowCancelConfirmation(false)} />
          <div className="relative bg-[#141416] border border-white/10 p-6 rounded-3xl max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">Cancel Order?</h3>
            <p className="text-sm text-[#6B6B6B] mb-6">This cannot be undone. You will lose your queue position and any batch discounts.</p>
            <div className="flex flex-col gap-3">
              <button onClick={cancelOrderAction} className="w-full py-4 bg-red-500 text-white font-bold text-sm rounded-2xl">Yes, Cancel Order</button>
              <button onClick={() => setShowCancelConfirmation(false)} className="w-full py-4 bg-white/5 text-white font-bold text-sm rounded-2xl border border-white/8">Keep My Order</button>
            </div>
          </div>
        </div>
      )}

      {/* Gate Notification */}
      {gateNotification && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-md">
          <div className="bg-[#141416] border border-[#C9A84C]/30 rounded-2xl p-4 shadow-xl flex items-center gap-3">
            <span className="text-2xl">🛎️</span>
            <div className="flex-1">
              <p className="text-xs font-bold text-[#C9A84C] uppercase tracking-wider">Campus Gate Alert</p>
              <p className="text-sm text-white">{gateNotification}</p>
            </div>
            <button onClick={() => setGateNotification(null)} className="text-white/30 hover:text-white">✕</button>
          </div>
        </div>
      )}

      <DeliverySuccessOverlay isOpen={showDeliveryOverlay} newBadges={newBadges} onComplete={() => { setShowDeliveryOverlay(false); setShowRatingModal(true); }} />
      <RatingModal isOpen={showRatingModal} onClose={() => setShowRatingModal(false)} onSubmit={async (rating, review, tipAmount) => {
        await fetch(`${API_URL}/api/orders/${orderId}/rate`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating, review, tipAmount }) });
      }} />
      <ChatDrawer orderId={orderId || ''} userName={userName} userRole="customer" socket={socket} isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />
      <RiderProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} partner={orderInfo?.deliveryPartner || null} />
    </main>
  );
}

export default function TrackingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0A0A0B] text-white flex items-center justify-center text-sm font-bold">Loading...</div>}>
      <TrackingContent />
    </Suspense>
  );
}
