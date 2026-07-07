"use client";
import Link from 'next/link';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import { showToast } from '@/components/ToastProvider';
import { API_URL } from '@/utils/api';

interface OrderItem {
  name?: string;
  quantity: number;
  priceAtOrder: number;
  menuItemId?: string;
  basePrice?: number;
  customizations?: Record<string, unknown>;
  image?: string;
}

interface OrderRecord {
  _id: string;
  totalPrice: number;
  status: string;
  createdAt: string;
  restaurantId?: string;
  restaurantName?: string;
  items: OrderItem[];
  deliveryPin?: string;
  paymentMethod?: string;
  upiStatus?: string;
}

// Skeleton loading component
function OrderSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="glass-card p-6 rounded-[28px]">
          <div className="flex items-center justify-between mb-3">
            <div className="skeleton h-4 w-28 rounded-lg" />
            <div className="skeleton h-3 w-16 rounded-lg" />
          </div>
          <div className="flex items-center justify-between">
            <div className="skeleton h-3 w-32 rounded-lg" />
            <div className="skeleton h-4 w-12 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function OrdersPage() {
  const router = useRouter();
  const { clearCart, addToCart } = useCart();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const touchStartX = useRef(0);

  const handleOneTabReorder = (order: OrderRecord) => {
    setReorderingId(order._id);
    clearCart();
    order.items.forEach((item) => {
      addToCart({
        id: item.menuItemId || `legacy-${item.name}`,
        name: item.name || 'Item',
        price: item.priceAtOrder,
        basePrice: item.basePrice || item.priceAtOrder,
        image: item.image || '',
        restaurantId: order.restaurantId || '',
        restaurantName: order.restaurantName || '',
        customizations: item.customizations as any,
        quantity: item.quantity,
      });
    });
    showToast('Cart loaded! ⚡', 'success', '🛒');
    setTimeout(() => router.push('/basket'), 600);
  };

  useEffect(() => {
    const token = 'cookie-managed';
    if (!token) { router.push('/login'); return; }
    const fetchOrders = async () => {
      try {
        const token = 'cookie-managed';
        const res = await fetch(`${API_URL}/api/orders/myorders`, {
          });
        if (res.ok) {
          const data = await res.json();
          // Items may be stringified JSON in SQLite — parse them safely
          const parsed = data.map((o: OrderRecord) => ({
            ...o,
            items: typeof o.items === 'string' ? (() => { try { return JSON.parse(o.items as unknown as string); } catch { return []; } })() : (o.items || [])
          }));
          setOrders(parsed);
        } else if (res.status === 401) {
          
          router.push('/login');
        }
      } catch (err) {
        console.error('Failed to fetch orders:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchOrders();
  }, [router]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    setSwipedId(null);
  };

  const handleTouchEnd = (e: React.TouchEvent, id: string) => {
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (diff > 80) setSwipedId(id); // Swipe left reveals reorder
    if (diff < -40) setSwipedId(null); // Swipe right hides
  };

  const statusColor = (s: string) => {
    if (s === 'Delivered') return 'text-emerald-400 light:text-[#EF4F5F] light:text-[#EF4F5F] light:text-[#EF4F5F] light:text-[#EF4F5F]';
    if (s === 'Cancelled') return 'text-red-400';
    return 'text-primary-yellow';
  };

  const statusIcon = (s: string) => {
    if (s === 'Delivered') return '✓';
    if (s === 'Cancelled') return '✕';
    return '◎';
  };

  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedOrderId(expandedOrderId === id ? null : id);
  };

  return (
    <main className="min-h-screen bg-background text-white light:text-gray-900 p-6 relative overflow-hidden">
      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute -top-40 -left-40 w-80 h-80 bg-[#C9A84C]/[0.03] rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-10 pt-6">
          <Link href="/" className="w-10 h-10 glass-card rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-white light:text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-lg font-black uppercase tracking-[0.15em]">My Orders</h1>
          <div className="w-10" />
        </div>

        {loading ? (
          <OrderSkeleton />
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center animate-in fade-in zoom-in duration-700">
            <div className="relative mb-10">
              <div className="absolute inset-0 bg-[#C9A84C]/20 blur-[40px] rounded-full animate-pulse" />
              <div className="w-24 h-24 glass-card rounded-[32px] flex items-center justify-center text-5xl relative z-10 border-[#C9A84C]/20 shadow-[0_0_50px_rgba(201,168,76,0.15)]">
                🍽️
              </div>
            </div>
            <h2 className="text-2xl font-black mb-3 tracking-tight text-white light:text-gray-900 uppercase italic">No Orders Yet</h2>
            <p className="text-secondary-text text-xs mb-10 max-w-[280px] font-bold leading-relaxed uppercase tracking-widest ">
              You haven't placed any orders yet. <br/>
              Let's order some delicious campus food!
            </p>
            <Link href="/" className="btn-yellow px-10 py-4 text-[10px] font-black uppercase tracking-[0.2em] shadow-[0_10px_30px_rgba(201,168,76,0.2)] hover:shadow-[0_15px_40px_rgba(201,168,76,0.3)] transition-all active:scale-95">
              Explore Canteens
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-[9px] font-bold text-secondary-text uppercase tracking-[0.2em] mb-2">← Swipe to reorder • Tap to expand</p>
            {orders.map((order) => {
              const isExpanded = expandedOrderId === order._id;
              return (
              <div key={order._id} className="relative overflow-hidden rounded-[28px]">
                {/* Reorder Action (behind card) */}
                <div 
                  className="absolute right-0 top-0 bottom-0 w-28 bg-gradient-to-l from-[#C9A84C] to-[#8B7332] flex flex-col items-center justify-center rounded-r-[28px] cursor-pointer active:opacity-80 gap-1"
                  onClick={() => handleOneTabReorder(order)}
                >
                  <span className="text-lg">{reorderingId === order._id ? '⏳' : '⚡'}</span>
                  <span className="text-[8px] font-black text-black uppercase tracking-wider">{reorderingId === order._id ? 'Adding...' : '1-Tap Reorder'}</span>
                </div>

                {/* Card */}
                <div
                  className={`glass-card p-6 rounded-[28px] relative z-10 transition-all duration-300 ${swipedId === order._id ? '-translate-x-24' : 'translate-x-0'} ${isExpanded ? 'border-[#C9A84C]/30 bg-white/[0.05]' : 'border-white/10'}`}
                  onTouchStart={(e) => handleTouchStart(e)}
                  onTouchEnd={(e) => handleTouchEnd(e, order._id)}
                  onClick={() => toggleExpand(order._id)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${statusColor(order.status)}`}>{statusIcon(order.status)}</span>
                      <h3 className="text-sm font-black tracking-tight text-white light:text-gray-900/80">
                        Order <span className="text-[#C9A84C] light:text-[#EF4F5F] light:text-[#EF4F5F] light:text-[#EF4F5F] light:text-[#EF4F5F]">#{order._id.slice(-6).toUpperCase()}</span>
                      </h3>
                    </div>
                    <span className={`text-[9px] font-black uppercase tracking-widest ${statusColor(order.status)}`}>
                      {order.status}
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-secondary-text font-bold">
                      {order.items?.length || 0} item{(order.items?.length || 0) > 1 ? 's' : ''} • {new Date(order.createdAt).toLocaleDateString()}
                    </p>
                    <span className="text-sm font-black text-gold-gradient">₹{order.totalPrice}</span>
                  </div>

                  {isExpanded && (
                    <div className="mt-6 animate-in fade-in slide-in-from-top-2">
                       <div className="bg-black/20 rounded-2xl p-4 border border-white/5 mb-4">
                          <p className="text-[8px] font-black uppercase text-secondary-text tracking-[0.2em] mb-3 text-center">Order Delivery Details</p>
                          <div className="flex justify-between items-center bg-[#C9A84C]/10 p-4 rounded-xl border border-[#C9A84C]/20">
                             <div>
                                <p className="text-[7px] font-black uppercase text-[#C9A84C] light:text-[#EF4F5F] light:text-[#EF4F5F] light:text-[#EF4F5F] light:text-[#EF4F5F] tracking-widest">Delivery OTP PIN</p>
                                <p className="text-xl font-black text-white light:text-gray-900 tracking-[0.2em]">{order.deliveryPin || 'WAIT'}</p>
                             </div>
                             <div className="text-right">
                                <p className="text-[7px] font-black uppercase text-secondary-text tracking-widest">Verification PIN</p>
                                <p className="text-[9px] font-bold text-white light:text-gray-900/50">Show to Delivery Partner</p>
                             </div>
                          </div>
                          
                          {order.paymentMethod === 'UPI' && (
                            <div className={`mt-3 px-4 py-2 rounded-xl border flex items-center justify-between ${order.upiStatus === 'Verified' ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-amber-500/10 border-amber-500/20 animate-pulse'}`}>
                               <p className="text-[8px] font-black uppercase tracking-widest text-secondary-text">UPI Verification</p>
                               <span className={`text-[10px] font-black uppercase tracking-widest ${order.upiStatus === 'Verified' ? 'text-emerald-400 light:text-[#EF4F5F] light:text-[#EF4F5F] light:text-[#EF4F5F] light:text-[#EF4F5F]' : 'text-amber-500'}`}>
                                 {order.upiStatus === 'Verified' ? '✓ Platform Confirmed' : '⌚ Awaiting Admin Sync'}
                               </span>
                            </div>
                          )}
                       </div>
                       
                       <div className="space-y-2 mb-4">
                          {order.items.map((item, idx) => (
                             <div key={idx} className="flex justify-between text-[11px] font-bold text-secondary-text">
                                <span><span className="text-primary-yellow mr-2">{item.quantity}x</span> {item.name || 'Menu Item'}</span>
                                <span>₹{(item.priceAtOrder || 0) * item.quantity}</span>
                             </div>
                          ))}
                       </div>

                        {order.status !== 'Delivered' && order.status !== 'Cancelled' ? (
                          <Link href={`/tracking?id=${order._id}`} className="w-full btn-yellow py-3 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 mb-2">
                            Track Live Location <span>→</span>
                          </Link>
                        ) : (
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleOneTabReorder(order); }}
                            className="w-full bg-[#C9A84C]/10 border border-[#C9A84C]/30 hover:bg-[#C9A84C]/20 py-3 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 mb-2 text-[#C9A84C] light:text-[#EF4F5F] light:text-[#EF4F5F] light:text-[#EF4F5F] light:text-[#EF4F5F] rounded-xl transition-all"
                          >
                            ⚡ 1-Tap Reorder
                          </button>
                        )}
                    </div>
                  )}

                  {!isExpanded && order.status !== 'Delivered' && order.status !== 'Cancelled' && (
                    <div className="flex justify-between items-center mt-4 pt-4 border-t border-white/5">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[8px] font-black uppercase tracking-widest text-emerald-500">Live Active</span>
                      </div>
                      <span className="text-[8px] font-black uppercase tracking-widest text-primary-yellow">Expand for PIN →</span>
                    </div>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

