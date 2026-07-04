"use client";
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { io } from 'socket.io-client';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAdminAuth } from '@/utils/useAdminAuth';
import PaymentVerificationModal from '@/components/PaymentVerificationModal';
import Image from 'next/image';

const LiveFleetMap = dynamic(() => import('@/components/LiveFleetMap'), { ssr: false });

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || API_URL;

const CHECKPOINTS = [
  { name: 'Mangalagiri Jn', lat: 16.4422, lng: 80.5604 },
  { name: 'Neerukonda', lat: 16.4715, lng: 80.5055 },
  { name: 'SRM Main Gate', lat: 16.4673, lng: 80.5002 },
  { name: 'Academic Block', lat: 16.4635, lng: 80.5065 },
  { name: 'Hostel Sector', lat: 16.4618, lng: 80.5068 }
];

// ─── Types ───────────────────────────────────────────────────
interface AdminStat {
  label: string;
  value: string;
  growth: string;
  trend: 'up' | 'down' | 'neutral';
}

interface LiveOrder {
  id: string;
  customer: string;
  location: string;
  status: string;
  price: number;
  restaurant?: string;
  timestamp: Date;
  paymentMethod: string;
  upiStatus?: string;
  upiUTR?: string;
  upiScreenshot?: string;
  deliveryPartnerName?: string;
  deliveryPartnerPhoto?: string;
}

interface RiderPosition {
  riderId: string;
  riderName: string;
  photoUrl?: string;
  currentCheckpoint?: string;
  activeOrderCount: number;
  isOnline: boolean;
}

interface OperationalEvent {
  id: string;
  type: 'SOS' | 'ISSUE';
  senderRole: string;
  senderName?: string;
  issueType?: string;
  details: string;
  orderId?: string;
  timestamp: Date;
}

// ─── Memoized Components for Performance ───────────────────
const OrderItem = memo(({ order, onVerify }: { order: LiveOrder, onVerify: (o: LiveOrder) => void }) => (
  <div 
    onClick={() => { if (order.paymentMethod === 'UPI' && order.upiStatus === 'Pending') onVerify(order); }}
    className={`group p-4 rounded-3xl bg-white/[0.015] border border-white/5 hover:border-white/10 transition-all duration-300 ${order.paymentMethod === 'UPI' && order.upiStatus === 'Pending' ? 'cursor-pointer hover:bg-amber-500/5' : ''}`}
  >
    <div className="flex justify-between items-start mb-2">
       <div>
          <p className="text-[11px] font-black text-blue-500 uppercase tracking-widest mb-0.5">{order.restaurant}</p>
           <p className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors flex items-center gap-2">
             {order.customer}
             <span className="text-[9px] text-gray-600 font-black opacity-50 font-mono tracking-tighter">#{order.id.slice(-6).toUpperCase()}</span>
           </p>
       </div>
        <div className="flex gap-2">
           {order.paymentMethod === 'UPI' && order.upiStatus === 'Pending' && (
             <span className="text-[7px] font-black px-1.5 py-0.5 bg-amber-500 text-black rounded animate-pulse">UPI_PENDING</span>
           )}
           <span className={`text-[10px] font-black px-2 py-1 rounded-lg uppercase tracking-wider ${
             order.status === 'Cancelled' ? 'bg-red-500/10 text-red-500' :
             order.status === 'Delivered' ? 'bg-emerald-500/10 text-emerald-500' :
             'bg-blue-500/10 text-blue-500'
           }`}>
             {order.status}
           </span>
        </div>
    </div>
    <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.03]">
        <div className="flex items-center gap-2">
          {order.deliveryPartnerName ? (
            <>
               <div className="w-5 h-5 rounded-full overflow-hidden border border-white/10 bg-slate-800 flex items-center justify-center">
                  {order.deliveryPartnerPhoto ? (
                     <Image src={order.deliveryPartnerPhoto} width={20} height={20} alt="Node" className="object-cover" />
                  ) : '👤'}
               </div>
               <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest truncate max-w-[80px]">
                  {order.deliveryPartnerName}
               </span>
            </>
          ) : (
            <div className="flex items-center gap-2 text-gray-600 group-hover:text-blue-500/50 transition-colors">
               <div className="w-5 h-5 rounded-full border border-white/5 bg-white/5 flex items-center justify-center text-[10px] animate-pulse">?</div>
               <span className="text-[10px] font-black uppercase tracking-widest">Awaiting Dispatch</span>
            </div>
          )}
        </div>
       <div className="text-right">
         <span className="text-[12px] text-gray-500 font-bold uppercase tracking-wide block">{order.location}</span>
         <span className="text-xs text-white font-black tracking-tighter">₹{order.price.toFixed(0)}</span>
       </div>
    </div>
  </div>
));
OrderItem.displayName = 'OrderItem';

const RiderStatusItem = memo(({ rider }: { rider: RiderPosition }) => (
  <div className="flex items-center gap-4 p-3 bg-white/[0.02] border border-white/5 rounded-2xl">
    <div className={`w-2 h-2 rounded-full ${rider.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-gray-700'}`} />
    <div className="flex-1">
      <p className="text-[11px] font-black text-white uppercase tracking-tight">{rider.riderName}</p>
      <p className="text-[8px] text-gray-500 font-bold uppercase tracking-widest">
        {rider.isOnline ? `At ${rider.currentCheckpoint || 'Hub'}` : 'Disconnected'}
      </p>
    </div>
    <div className="text-right">
       <span className="text-[9px] font-black text-blue-500">{rider.activeOrderCount || 0} Tasks</span>
    </div>
  </div>
));
RiderStatusItem.displayName = 'RiderStatusItem';

const EventItem = memo(({ event, onResolve }: { event: OperationalEvent, onResolve: (id: string) => void }) => (
  <div className={`p-4 rounded-3xl animate-pulse flex items-center gap-4 ${event.type === 'SOS' ? 'bg-red-600/20 border border-red-600' : 'bg-amber-600/20 border border-amber-600'}`}>
    <div className="text-2xl">{event.type === 'SOS' ? '🚨' : '⚠️'}</div>
    <div className="flex-1">
      <p className="text-[12px] font-black uppercase text-white tracking-widest">{event.type} Alert: {event.senderRole}</p>
      <p className="text-xs font-black text-white">{event.issueType || event.details}</p>
      {event.orderId && <p className="text-[10px] text-white/50 font-black uppercase mt-1 tracking-tighter">Order ID: <span className="text-[#C9A84C]">#{event.orderId.slice(-6).toUpperCase()}</span></p>}
    </div>
    <div className="flex flex-col items-end gap-2">
      <span className="text-[10px] font-black text-white opacity-40">
        {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
      <button 
        onClick={() => onResolve(event.id)}
        className="text-[8px] font-black text-white/60 uppercase tracking-widest hover:text-white border border-white/10 px-2 py-1 rounded bg-white/5"
      >
        Resolve
      </button>
    </div>
  </div>
));
EventItem.displayName = 'EventItem';


export default function AdminHome() {
  const router = useRouter();
  const isAuthed = useAdminAuth();

  const [stats, setStats] = useState<AdminStat[]>([
    { label: 'Platform Revenue', value: '₹0', growth: '+0%', trend: 'neutral' },
    { label: 'Order Activity', value: '0', growth: '+0%', trend: 'neutral' },
    { label: 'Active Fleet', value: '0', growth: 'Initializing', trend: 'neutral' },
    { label: 'Zenvy Commission', value: '₹0', growth: 'Real-time', trend: 'up' },
  ]);

  const [liveOrders, setLiveOrders] = useState<LiveOrder[]>([]);
  const [riders, setRiders] = useState<Record<string, RiderPosition>>({});
  const [operationalEvents, setOperationalEvents] = useState<OperationalEvent[]>([]);
  const [interceptedChats, setInterceptedChats] = useState<{orderId: string, sender: string, senderRole: string, message: string, timestamp: Date}[]>([]);
  const [loading, setLoading] = useState(true);

  // Megaphone
  const [megaMsg, setMegaMsg] = useState('');
  const [megaType, setMegaType] = useState<'info' | 'warning' | 'promo' | 'emergency'>('info');
  const [broadcasting, setBroadcasting] = useState(false);
  const [selectedUPIOrder, setSelectedUPIOrder] = useState<LiveOrder | null>(null);
  const socketRef = useRef<ReturnType<typeof io> | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? 'cookie-managed' : null;
      const res = await fetch(`${API_URL}/api/admin/stats`, {
         });
      if (!res.ok) return;
      const data = await res.json();
      setStats([
        { label: 'Platform Revenue', value: data.revenue || '₹0', growth: 'Delivered', trend: 'up' },
        { label: 'Active Pipeline', value: data.activeRevenue || '₹0', growth: `${data.activeOrders || 0} Awaiting`, trend: 'up' },
        { label: 'Active Fleet', value: data.activeFleet || '0', growth: 'Nodes Online', trend: 'neutral' },
        { label: 'Zenvy Commission', value: data.commission || '₹0', growth: 'Operational Fee', trend: 'up' },
        { label: 'Local Vendors', value: data.localVendorCount || '0', growth: '🏪 CampusBites', trend: 'up' },
      ]);
    } catch (err) { console.error('[STATS_FETCH_ERROR]', err); }
  }, []);

  const fetchOrders = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? 'cookie-managed' : null;
      const res = await fetch(`${API_URL}/api/orders`, {
         });
      const data = await res.json();
      if (res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const formatted = data.map((o: any) => ({
            id: String(o._id || o.id),
            customer: o.userId?.name || 'Student',
            location: (o.hostelGateDelivery) ? 'Hostel Gate' : 'Room Delivery',
            status: String(o.status),
            price: Number(o.finalPrice || o.totalPrice),
            restaurant: o.restaurant?.name || 'Zenvy Elite',
            timestamp: new Date(String(o.createdAt)),
            paymentMethod: String(o.paymentMethod),
            upiStatus: String(o.upiStatus),
            upiUTR: String(o.upiUTR),
            upiScreenshot: String(o.upiScreenshot),
            deliveryPartnerName: o.deliveryPartner?.name,
            deliveryPartnerPhoto: o.deliveryPartner?.photoUrl
        }));
        setLiveOrders(formatted);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  const lastStatsUpdate = useRef(0);
  const throttledFetchStats = useCallback(() => {
    const now = Date.now();
    if (now - lastStatsUpdate.current > 10000) {
      fetchStats();
      lastStatsUpdate.current = now;
    }
  }, [fetchStats]);

  const handleVerifyUPI = async (orderId: string, isVerified: boolean) => {
    try {
      const token = typeof window !== 'undefined' ? 'cookie-managed' : null;
      const res = await fetch(`${API_URL}/api/orders/${orderId}/verify-payment`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          },
        body: JSON.stringify({ isVerified })
      });
      if (res.ok) {
        fetchOrders();
        fetchStats();
      }
    } catch (err) { console.error('Verification failed', err); }
  };

  const handleOverrideGlobalBatch = async () => {
    if (!confirm('OVERRIDE PROTOCOL: Force-accept all pending orders?')) return;
    try {
      const token = 'cookie-managed';
      const res = await fetch(`${API_URL}/api/admin/orders/batch-update`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify({ targetStatus: 'Pending', newStatus: 'Accepted' })
      });
      if (res.ok) {
        const data = await res.json();
        alert(`SUCCESS: ${data.count} nodes transitioned to ACCEPTED state.`);
        fetchOrders();
      }
    } catch (err) { console.error('[BATCH_OVERRIDE_ERROR]', err); }
  };

  const handlePrintReport = () => {
    window.print();
  };

  const handleResolveEvent = (eventId: string) => {
    setOperationalEvents(prev => prev.filter(e => e.id !== eventId));
  };

  useEffect(() => {
    fetchStats();
    fetchOrders();

    const socket = io(SOCKET_URL.replace(/\/$/, ""), {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;
    socket.emit('joinAdmin');
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on('admin_newOrder', (order: any) => {
      throttledFetchStats();
      setLiveOrders(prev => [{
        id: order.id,
        customer: order.customer || 'Student',
        location: order.drop || 'Unknown',
        status: 'Pending',
        price: order.finalPrice || order.totalPrice,
        restaurant: order.restaurant || 'Zenvy Elite',
        timestamp: new Date(),
        paymentMethod: order.paymentMethod || 'COD',
        upiStatus: order.upiStatus || (order.paymentMethod === 'UPI' ? 'Pending' : 'Verified')
      }, ...prev].slice(0, 20));
    });

    socket.on('statusUpdated', (data: { id: string, status: string }) => {
      throttledFetchStats();
      setLiveOrders(prev => prev.map(o => o.id === data.id ? { ...o, status: data.status } : o));
    });

    socket.on('orderCancelled', ({ orderId }: { orderId: string }) => {
      setLiveOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'Cancelled' } : o));
    });

    socket.on('admin_rider_location', (data: RiderPosition) => {
      setRiders(prev => ({
        ...prev,
        [data.riderId]: {
          ...data,
          timestamp: new Date()
        }
      }));
    });

    socket.on('admin_rider_online', (data: { riderId: string, name: string }) => {
      setRiders(prev => ({
        ...prev,
        [data.riderId]: {
          ...(prev[data.riderId] || {}),
          riderId: data.riderId,
          riderName: data.name,
          isOnline: true,
          activeOrderCount: 0
        }
      }));
    });

    socket.on('admin_rider_offline', (data: { riderId: string }) => {
      setRiders(prev => {
        const next = { ...prev };
        if (next[data.riderId]) next[data.riderId].isOnline = false;
        return next;
      });
    });
    
    socket.on('admin_rider_status', (data: { riderId: string, isOnline: boolean, name: string }) => {
      setRiders(prev => ({
        ...prev,
        [data.riderId]: {
          ...(prev[data.riderId] || { activeOrderCount: 0 }),
          riderId: data.riderId,
          riderName: data.name,
          isOnline: data.isOnline
        }
      }));
    });

    socket.on('admin_order_accepted', (data: { orderId: string, riderName: string }) => {
      setLiveOrders(prev => prev.map(o => o.id === data.orderId ? { ...o, status: 'Accepted', deliveryPartnerName: data.riderName } : o));
    });

    socket.on('admin_delivery_complete', (data: { orderId: string }) => {
      throttledFetchStats();
      setLiveOrders(prev => prev.map(o => o.id === data.orderId ? { ...o, status: 'Delivered' } : o));
    });

    socket.on('order_unassigned', (data: { orderId: string }) => {
      setLiveOrders(prev => prev.map(o => o.id === data.orderId ? { ...o, status: 'Pending', deliveryPartnerName: undefined } : o));
    });

    socket.on('rider_profile_updated', (data: Record<string, unknown>) => {
      setRiders(prev => {
        const riderId = String(data.riderId);
        if (prev[riderId]) {
          return {
            ...prev,
            [riderId]: {
              ...prev[riderId],
              riderName: String(data.name),
              photoUrl: String(data.photoUrl)
            }
          };
        }
        return prev;
      });
    });

    socket.on('sos_received', (data: Record<string, unknown>) => {
      setOperationalEvents(prev => [{
        id: `sos-${Date.now()}`,
        type: 'SOS' as const,
        senderRole: 'Rider',
        senderName: String(data.riderName),
        details: 'CRITICAL EMERGENCY: SOS Triggered',
        timestamp: new Date()
      }, ...prev].slice(0, 10));
    });

    socket.on('admin_issue_reported', (data: Record<string, unknown>) => {
      setOperationalEvents(prev => [{
        id: `issue-${Date.now()}`,
        type: 'ISSUE' as const,
        senderRole: String(data.senderRole) as 'Customer' | 'Rider',
        issueType: String(data.issueType),
        details: String(data.details),
        orderId: String(data.orderId),
        timestamp: new Date()
      }, ...prev].slice(0, 10));
    });

    socket.on('admin_intercept_chat', (data: any) => {
      setInterceptedChats(prev => [{
        orderId: data.orderId,
        sender: data.sender,
        senderRole: data.senderRole,
        message: data.message,
        timestamp: new Date(data.timestamp)
      }, ...prev].slice(0, 30));
    });

    return () => { socket.disconnect(); };
  }, [fetchStats, fetchOrders, router, throttledFetchStats]);

  if (!isAuthed) {
    return <div className="p-20 text-center font-black text-white uppercase tracking-widest animate-pulse">Authenticating Command Terminal...</div>;
  }

  return (
    <div className="space-y-12 animate-fade-in relative pb-20">
      {/* 🚀 Header */}
      <header className="flex justify-between items-center mb-8">
         <div className="flex flex-col">
            <h1 className="text-3xl font-black text-white italic tracking-tighter">COMMAND<span className="text-blue-500">CENTER</span></h1>
            <p className="text-[10px] font-black text-gray-500 uppercase tracking-[0.4em] mt-1">SRM AP LOGISTICS HUB v4.2.0</p>
         </div>
      </header>

      {/* ─── Hero Metrics ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        {stats.map((stat, i) => (
          <div key={i} className="glass-card p-8 group overflow-hidden relative">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/[0.03] blur-[40px] group-hover:bg-blue-600/[0.08] transition-all" />
            <p className="stat-label tracking-[0.2em]">{stat.label}</p>
            <div className="flex items-end justify-between mt-2">
              <h4 className="text-3xl font-black text-white">{stat.value}</h4>
              <span className={`text-[12px] font-black px-2 py-1 rounded-md border ${
                stat.trend === 'up' ? 'text-emerald-400 bg-emerald-400/5 border-emerald-400/20' :
                stat.trend === 'down' ? 'text-blue-400 bg-blue-400/5 border-blue-400/20' :
                'text-gray-500 bg-white/5 border-white/10'
              }`}>
                {stat.growth}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-10 items-start">
        {/* ─── Hybrid Campus Radar (Nodes on Map) ─── */}
        <div className="col-span-1 lg:col-span-2">
          <div className="glass-card p-2 border-white/5 relative overflow-hidden bg-slate-900/50 h-[550px]">
            <LiveFleetMap riders={riders} checkpoints={CHECKPOINTS} />
            
            {/* Status Intelligence Floor Overlay */}
            <div className="absolute bottom-6 left-6 right-6 z-[1000] px-6 py-4 glass-card border-white/10 bg-slate-900/80 backdrop-blur-md">
               <div className="grid grid-cols-3 gap-6">
                  <div className="text-center">
                     <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Base Hub</p>
                     <p className="text-[12px] text-white font-black uppercase mt-1">Mangalagiri</p>
                  </div>
                  <div className="text-center">
                     <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Transit Logic</p>
                     <p className="text-[12px] text-blue-400 font-black uppercase mt-1">Neerukonda Node</p>
                  </div>
                  <div className="text-center">
                     <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Nexus Goal</p>
                     <p className="text-[12px] text-emerald-400 font-black uppercase mt-1">SRM Campus</p>
                  </div>
               </div>
            </div>
          </div>
        </div>

        {/* ─── Gourmet Feed (Recent Activity) ─── */}
        <div className="space-y-6">
           <h3 className="text-xl font-black tracking-tighter uppercase text-white">Tactical <span className="text-[#C9A84C]">Ops Stream</span></h3>
           <div className="glass-card h-[450px] overflow-y-auto p-6 space-y-4 scrollbar-hide border-white/10">
              
              {/* Critical Alerts Priority */}
              {operationalEvents.map(event => (
                <EventItem key={event.id} event={event} onResolve={handleResolveEvent} />
              ))}

              <div className="h-px bg-white/5 my-4" />

              <div className="space-y-4">
                 <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Live Fleet Status</h4>
                    <span className="text-[9px] font-black text-emerald-500 uppercase px-2 py-0.5 bg-emerald-500/10 rounded-md">
                       {Object.values(riders).filter(r => r.isOnline).length} Nodes Active
                    </span>
                 </div>
                 <div className="grid grid-cols-1 gap-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {Object.values(riders).length === 0 ? (
                      <p className="text-[10px] text-gray-600 italic text-center py-10">No personnel data in grid...</p>
                    ) : Object.values(riders).sort((a, b) => Number(b.isOnline) - Number(a.isOnline)).map(rider => (
                       <RiderStatusItem key={rider.riderId} rider={rider} />
                    ))}
                 </div>
              </div>

              <div className="h-px bg-white/5 my-4" />

              {loading ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-500">
                   <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                   <p className="text-[12px] uppercase font-black tracking-widest">Syncing Nodes...</p>
                </div>
              ) : liveOrders.length === 0 ? (
                <p className="text-center py-20 text-gray-600 text-xs italic tracking-wide">No movements detected in the last scan.</p>
              ) : (
                liveOrders.map((order) => (
                  <OrderItem 
                    key={order.id} 
                    order={order} 
                    onVerify={(o) => setSelectedUPIOrder(o)} 
                  />
                ))
              )}
           </div>
        </div>
      </div>

      {/* ─── Global Search & Batch Controls ─── */}
      <div className="glass-card p-10 flex flex-col md:flex-row items-center gap-10">
         <div className="flex-1 space-y-2">
            <h3 className="text-2xl font-black text-white tracking-tight">Tactically Informed Management</h3>
            <p className="text-sm text-gray-500 max-w-lg leading-relaxed">The Nexus Terminal provides absolute transparency over all campus movement. Every byte of data is verified through our SRM-Alpha nodes.</p>
         </div>
          <div className="flex gap-4 print:hidden">
            <button 
              onClick={() => {
                if (!confirm("Activate STORM MODE? This will globally enable Surge Pricing and alert all active users.")) return;
                if (socketRef.current) socketRef.current.emit('admin_broadcast', { message: "⚠️ SEVERE WEATHER: Deliveries may be delayed. Surge pricing active.", type: "emergency" });
              }}
              className="px-8 py-4 bg-red-600 shadow-[0_0_30px_rgba(220,38,38,0.3)] rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] text-white hover:scale-105 transition-all animate-pulse"
            >
               🚨 STORM MODE OVERRIDE
            </button>
            <button 
              onClick={handleOverrideGlobalBatch}
              className="px-8 py-4 bg-[#C9A84C] shadow-[0_0_30px_rgba(201,168,76,0.3)] rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] text-black hover:scale-105 transition-all"
            >
               Override Global Batch
            </button>
          </div>
      </div>

      {/* ─── Communication Suite ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Tactical Megaphone */}
        <div className="glass-card p-8 border border-white/10 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-2xl">📢</span>
              <div>
                <h3 className="text-xl font-black text-white uppercase tracking-widest">Tactical Broadcast</h3>
                <p className="text-[11px] text-gray-500">Push live alerts to all 3 portals instantly via WebSockets</p>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                {(['info', 'warning', 'promo', 'emergency'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setMegaType(t)}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider border transition-all ${
                      megaType === t
                        ? t === 'emergency' ? 'bg-red-600 border-red-400 text-white' :
                          t === 'warning'   ? 'bg-amber-500 border-amber-400 text-black' :
                          t === 'promo'     ? 'bg-emerald-600 border-emerald-400 text-white' :
                                              'bg-blue-600 border-blue-400 text-white'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                    }`}
                  >
                    { t === 'emergency' ? '🚨' : t === 'warning' ? '⚠️' : t === 'promo' ? '🎉' : '📢' } {t}
                  </button>
                ))}
              </div>
              <textarea
                rows={3}
                value={megaMsg}
                onChange={e => setMegaMsg(e.target.value)}
                placeholder="Type your message (e.g. '🌧️ Rain alert! Deliveries delayed by 15 mins due to weather.')"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm text-white placeholder-gray-600 outline-none focus:border-blue-500/40 resize-none transition-all"
              />
            </div>
          </div>
          <button
            disabled={!megaMsg.trim() || broadcasting}
            onClick={() => {
              if (!socketRef.current || !megaMsg.trim()) return;
              setBroadcasting(true);
              socketRef.current.emit('admin_broadcast', { message: megaMsg.trim(), type: megaType });
              setTimeout(() => { setMegaMsg(''); setBroadcasting(false); }, 1500);
            }}
            className="w-full mt-6 py-4 rounded-xl text-[13px] font-black uppercase tracking-widest bg-[#C9A84C] text-black hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {broadcasting ? 'Transmitting...' : 'Execute Broadcast'}
          </button>
        </div>

        {/* Live Chat Intercept Terminal */}
        <div className="glass-card p-8 border border-blue-500/20 bg-black/60 relative overflow-hidden flex flex-col h-[400px]">
           <div className="absolute top-0 right-0 p-4">
              <span className="flex items-center gap-2 px-2 py-1 bg-red-500/10 border border-red-500/20 text-red-500 rounded text-[9px] font-black uppercase animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> REC
              </span>
           </div>
           <div className="flex items-center gap-3 mb-6">
              <span className="text-2xl">📡</span>
              <div>
                <h3 className="text-xl font-black text-white uppercase tracking-widest text-blue-400">Comms Intercept</h3>
                <p className="text-[11px] text-gray-500 font-mono tracking-tight">Monitoring all P2P Grid Communications</p>
              </div>
           </div>
           
           <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar flex flex-col-reverse">
             {interceptedChats.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                   <p className="text-xs font-mono text-gray-600">Awaiting transmission...</p>
                </div>
             ) : interceptedChats.map((chat, idx) => (
               <div key={idx} className="bg-white/5 border border-white/5 p-3 rounded-lg flex flex-col gap-1">
                 <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                      {chat.senderRole} <span className="text-white">({chat.sender.slice(0,12)}...)</span>
                    </span>
                    <span className="text-[8px] font-mono text-gray-600">{chat.timestamp.toLocaleTimeString()}</span>
                 </div>
                 <p className="text-sm font-mono text-blue-300">{chat.message}</p>
                 <span className="text-[8px] font-black text-yellow-600/50 uppercase">Order: #{chat.orderId.slice(-6).toUpperCase()}</span>
               </div>
             ))}
           </div>
        </div>

      </div>

      <PaymentVerificationModal 
        isOpen={!!selectedUPIOrder}
        order={selectedUPIOrder}
        onClose={() => setSelectedUPIOrder(null)}
        onVerify={handleVerifyUPI}
      />
    </div>
  );
}
