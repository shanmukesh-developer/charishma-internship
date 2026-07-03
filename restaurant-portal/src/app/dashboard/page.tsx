'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { io } from 'socket.io-client';
import api from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, UtensilsCrossed, CheckCircle, Clock, User, Plus, Edit2, Power, Eye } from 'lucide-react';
import { useToast } from '@/components/RestaurantToast';
import { MenuItemForm } from '@/components/RestaurantForms';
import { OrderDetailModal } from '@/components/OrderDetailModal';
import { PerformanceSparklines } from '@/components/PerformanceSparklines';

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

interface Order {
  id: string;
  totalPrice: number;
  items: OrderItem[];
  status: string;
  createdAt: string;
  paymentMethod: string;
  upiStatus: string;
  deliveryPartnerName?: string;
  _id?: string;
}

interface MenuItem {
  id: string;
  name: string;
  price: number;
  category: string;
  isAvailable: boolean;
}

interface Announcement {
  message: string;
  type: 'info' | 'warning' | 'promo' | 'emergency';
}

export default function Dashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [activeTab, setActiveTab] = useState<'orders' | 'menu'>('orders');
  const [restaurant, setRestaurant] = useState<any>(null);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [showItemForm, setShowItemForm] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    const token = localStorage.getItem('restaurantToken');
    const restaurantId = localStorage.getItem('restaurantId');
    
    if (!token || !restaurantId) {
      router.push('/login');
      return;
    }

    // Fetch initial orders
    api.get(`/restaurants/${restaurantId}/orders`)
      .then(res => setOrders(res.data.map((o: any) => ({ ...o, id: o.id || o._id }))))
      .catch(err => console.error(err));

    // Fetch menu
    api.get(`/restaurants/${restaurantId}/menu`)
      .then(res => setMenu(res.data.map((m: any) => ({ ...m, id: m.id || m._id }))))
      .catch(err => console.error(err));

    // Fetch Profile from localStorage (restaurantUser has name stored at login)
    const storedUser = localStorage.getItem('restaurantUser');
    if (storedUser) {
      try { setRestaurant(JSON.parse(storedUser)); } catch {}
    } else {
      setRestaurant({ id: restaurantId, name: 'Zenvy Partner' });
    }

    // Connect socket WITH auth token so backend accepts the connection
    const token = localStorage.getItem('restaurantToken');
    const s = io(process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005', {
      transports: ['websocket', 'polling'],
      auth: { token, role: 'restaurant' },
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    
    s.on('connect', () => {
      console.log('Connected to socket');
      s.emit('joinRoom', `restaurant_${restaurantId}`);
    });

    s.on('restaurant_newOrder', () => {
      api.get(`/restaurants/${restaurantId}/orders`).then(res => setOrders(res.data.map((o: any) => ({ ...o, id: o.id || o._id }))));
    });

    s.on('statusUpdated', () => {
       api.get(`/restaurants/${restaurantId}/orders`).then(res => setOrders(res.data.map((o: any) => ({ ...o, id: o.id || o._id }))));
    });

    s.on('global_announcement', (data: Announcement) => {
      setAnnouncement(data);
      if (data.type !== 'emergency') {
        setTimeout(() => setAnnouncement(null), 8000);
      }
    });

    return () => {
      s.disconnect();
    };
  }, [router]);

  const handleAccept = async (orderId: string) => {
    try {
      await api.put(`/orders/${orderId}/restaurant-accept`);
      setOrders(orders.map(o => (o.id === orderId || o._id === orderId) ? { ...o, status: 'Accepted' } : o));
    } catch (error) {
      console.error(error);
      toast('Failed to accept order', 'error');
    }
  };

  const handleReject = async (orderId: string) => {
    if (!window.confirm("Are you sure you want to reject this order? This cannot be undone.")) return;
    try {
      await api.put(`/orders/${orderId}/cancel`);
      setOrders(orders.map(o => (o.id === orderId || o._id === orderId) ? { ...o, status: 'Cancelled' } : o));
    } catch (error) {
      console.error('Failed to reject order', error);
      toast('Failed to reject order. It may have already been canceled.', 'error');
    }
  };

  const toggleAvailability = async (itemId: string) => {
    try {
      const res = await api.put(`/restaurants/menu/${itemId}/toggle`);
      setMenu(menu.map(item => item.id === itemId ? { ...item, isAvailable: res.data.isAvailable } : item));
    } catch (error) {
      console.error(error);
      alert('Failed to update availability');
    }
  };

  const handleReady = async (orderId: string) => {
    try {
      await api.put(`/orders/${orderId}/restaurant-ready`);
      setOrders(orders.map(o => (o.id === orderId || o._id === orderId) ? { ...o, status: 'ReadyForPickup' } : o));
      toast('Order ready for pickup!', 'success');
    } catch (error) {
      console.error(error);
      toast('Failed to mark as ready', 'error');
    }
  };

  const handleMenuSubmit = async (formData: any, imageFile: File | null) => {
    setIsSubmitting(true);
    try {
      let imageUrl = editingItem?.id ? (editingItem as any).imageUrl : '';
      
      if (imageFile) {
        const data = new FormData();
        data.append('image', imageFile);
        const uploadRes = await api.post('/upload', data);
        imageUrl = uploadRes.data.imageUrl;
      }

      const payload = { ...formData, imageUrl };
      
      if (editingItem) {
        await api.put(`/restaurants/menu/${editingItem.id}`, payload);
        toast('Asset updated successfully', 'success');
      } else {
        await api.post('/restaurants/menu', payload);
        toast('New asset deployed', 'success');
      }

      // Refresh menu
      const restaurantId = localStorage.getItem('restaurantId');
      const res = await api.get(`/restaurants/${restaurantId}/menu`);
      setMenu(res.data.map((m: any) => ({ ...m, id: m.id || m._id })));
      setShowItemForm(false);
      setEditingItem(null);
    } catch (error) {
      console.error(error);
      toast('Failed to save menu item', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeOrders = orders.filter(o => ['Pending', 'Accepted', 'Preparing', 'ReadyForPickup'].includes(o.status));
  const pastOrders = orders.filter(o => ['Delivered', 'Cancelled', 'PickedUp'].includes(o.status));

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans p-6">
      <header className="flex items-center justify-between border-b border-zinc-800 pb-6 mb-8">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <UtensilsCrossed className="text-orange-500" size={28} />
            <h1 className="text-2xl font-bold tracking-tight">Zenvy Partners</h1>
          </div>

          <AnimatePresence>
            {announcement && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl border shadow-2xl flex items-center gap-3 backdrop-blur-md min-w-[300px] ${
                  announcement.type === 'emergency' ? 'bg-red-500 border-red-400 text-white animate-pulse' :
                  announcement.type === 'warning' ? 'bg-amber-500 border-amber-400 text-black' :
                  announcement.type === 'promo' ? 'bg-emerald-500 border-emerald-400 text-white' :
                  'bg-blue-600 border-blue-400 text-white'
                }`}
              >
                <span className="text-xl">
                  {announcement.type === 'emergency' ? '🚨' : announcement.type === 'warning' ? '⚠️' : announcement.type === 'promo' ? '🎉' : '📢'}
                </span>
                <p className="text-xs font-black uppercase tracking-widest">{announcement.message}</p>
                <button onClick={() => setAnnouncement(null)} className="ml-auto hover:scale-110 px-2 font-black">✕</button>
              </motion.div>
            )}
          </AnimatePresence>
          
          <nav className="flex gap-1 bg-zinc-900 p-1 rounded-xl border border-zinc-800">
            <button 
              onClick={() => setActiveTab('orders')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'orders' ? 'bg-orange-500 text-white shadow-lg' : 'text-zinc-400 hover:text-white'}`}
            >
              Orders
            </button>
            <button 
              onClick={() => setActiveTab('menu')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'menu' ? 'bg-orange-500 text-white shadow-lg' : 'text-zinc-400 hover:text-white'}`}
            >
              Menu
            </button>
          </nav>
        </div>
        
        <div className="flex items-center gap-4">
           <div className="hidden md:flex flex-col items-end mr-4">
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Node Identity</span>
              <span className="text-[11px] font-mono text-orange-500 font-bold">{restaurant?.id?.slice(0,13)}...</span>
           </div>
           <button 
             onClick={() => {
               localStorage.removeItem('restaurantToken');
               localStorage.removeItem('restaurantId');
               localStorage.removeItem('restaurantUser');
               router.push('/login');
             }}
             className="w-10 h-10 bg-zinc-900 border border-zinc-800 rounded-full flex items-center justify-center text-zinc-500 hover:text-white hover:border-zinc-700 transition-all"
             title="Logout"
           >
             <Power size={18} />
           </button>
        </div>
      </header>

      {activeTab === 'orders' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Incoming/Active Orders */}
          <div className="lg:col-span-2 space-y-6">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Clock className="text-orange-500" /> Live Feed
            </h2>
            
            <AnimatePresence mode="popLayout">
              {activeOrders.length === 0 ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-zinc-500 italic p-12 rounded-2xl border border-zinc-900 border-dashed text-center bg-zinc-900/20">
                  Waiting for new orders...
                </motion.div>
              ) : (
                activeOrders.map(order => (
                  <motion.div 
                    key={order.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl relative overflow-hidden"
                  >
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                           <span className="text-[10px] font-black bg-white/5 border border-white/10 px-2 py-0.5 rounded-md text-[#C9A84C] font-mono tracking-widest">#{String(order.id || order._id).slice(-6).toUpperCase()}</span>
                           {order.status === 'Pending' && <span className="animate-ping w-1.5 h-1.5 rounded-full bg-orange-500" />}
                        </div>
                        <div className="flex items-center gap-3">
                          <h3 className="text-xl font-bold">₹{order.totalPrice}</h3>
                          <button 
                            onClick={() => setSelectedOrder(order)}
                            className="bg-white/10 hover:bg-white/20 text-white p-1.5 rounded-md transition-colors"
                            title="View Details"
                          >
                            <Eye size={16} />
                          </button>
                        </div>
                        <p className="text-zinc-500 text-sm">{order.items.length} items • {new Date(order.createdAt).toLocaleTimeString()}</p>
                      </div>
                      
                      <span className={`px-3 py-1 rounded-full text-[12px] font-black uppercase tracking-widest ${
                        order.status === 'Pending' ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 
                        order.status === 'ReadyForPickup' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      }`}>
                        {order.status}
                      </span>
                    </div>

                    <div className="flex gap-4 mb-6">
                       <div className="flex flex-col gap-1">
                          <p className="text-[8px] font-black uppercase text-zinc-500 tracking-[0.2em]">Settlement</p>
                          <div className="flex items-center gap-2">
                             <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${order.paymentMethod === 'COD' ? 'bg-zinc-800 text-zinc-400' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}`}>
                               {order.paymentMethod}
                             </span>
                             {order.paymentMethod === 'UPI' && (
                               <span className={`text-[10px] font-black uppercase tracking-widest ${order.upiStatus === 'Verified' ? 'text-emerald-500' : 'text-amber-500 animate-pulse'}`}>
                                 {order.upiStatus === 'Verified' ? '✓ Verified' : '⌚ Verification Pending'}
                               </span>
                             )}
                          </div>
                       </div>
                       {order.deliveryPartnerName && (
                          <div className="flex flex-col gap-1 border-l border-zinc-800 pl-4">
                             <p className="text-[8px] font-black uppercase text-zinc-500 tracking-[0.2em]">Assigned Node</p>
                             <div className="flex items-center gap-2 text-blue-400">
                                <span className="text-[10px] font-black uppercase tracking-widest">{order.deliveryPartnerName}</span>
                             </div>
                          </div>
                       )}
                    </div>

                    <div className="space-y-3 mb-8 bg-zinc-950/50 p-4 rounded-xl border border-zinc-800/50">
                      {order.items.map((item, i: number) => (
                        <div key={i} className="flex justify-between text-sm items-center">
                          <span className="text-zinc-300 font-medium">
                            <span className="text-orange-500/80 mr-3 tabular-nums">{item.quantity}x</span> 
                            {item.name}
                          </span>
                          <span className="text-zinc-500 tabular-nums">₹{item.price * item.quantity}</span>
                        </div>
                      ))}
                    </div>

                    {order.status === 'Pending' && (
                      <div className="flex gap-3">
                        <button 
                          onClick={() => handleReject(order.id)}
                          className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] border border-zinc-700"
                        >
                          ✕ Reject
                        </button>
                        <button 
                          onClick={() => handleAccept(order.id)}
                          className="flex-[2] bg-orange-500 hover:bg-orange-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-lg shadow-orange-500/20"
                        >
                          <CheckCircle size={20} /> Accept & Start
                        </button>
                      </div>
                    )}
                    {order.status === 'Accepted' && (
                      <button 
                        onClick={() => handleReady(order.id)}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-lg shadow-blue-600/20"
                      >
                         <Package size={20} /> Dispatch / Food Ready
                      </button>
                    )}
                    {order.status === 'ReadyForPickup' && (
                      <div className="w-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold py-4 rounded-xl flex items-center justify-center gap-3">
                         <div className="w-4 h-4 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
                         Rider Pickup Pending...
                      </div>
                    )}
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>

          {/* Sidebar / Past Orders & Analytics */}
          <div>
            <PerformanceSparklines orders={orders} />

            <h2 className="text-xl font-semibold mb-6 flex items-center gap-2 text-zinc-400">
              <Package size={20} /> Recent History
            </h2>
            <div className="space-y-4">
              {pastOrders.slice(0, 8).map(order => (
                <div key={order.id} className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-5 hover:bg-zinc-900 transition-colors">
                  <div className="flex justify-between items-center mb-3">
                     <span className="text-[11px] font-black text-[#C9A84C]/50 font-mono uppercase tracking-widest">#{String(order.id || order._id).slice(-6).toUpperCase()}</span>
                    <span className="text-[12px] text-zinc-600">{new Date(order.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">{order.items.length} items</span>
                    <span className={`font-bold ${order.status === 'Cancelled' ? 'text-red-500' : 'text-green-400'}`}>₹{order.totalPrice}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex justify-between items-center bg-zinc-900/50 p-8 rounded-[32px] border border-zinc-800">
            <div>
              <h2 className="text-2xl font-bold flex items-center gap-3">
                <UtensilsCrossed className="text-orange-500" /> Menu Inventory
              </h2>
              <p className="text-zinc-500 text-sm mt-1">Manage your tactical food assets and availability.</p>
            </div>
            <button 
              onClick={() => { setEditingItem(null); setShowItemForm(true); }}
              className="bg-orange-500 hover:bg-orange-600 text-white font-black px-6 py-4 rounded-2xl flex items-center gap-2 transition-all shadow-lg shadow-orange-500/20 active:scale-95"
            >
              <Plus size={20} /> Deploy Asset
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {menu.map((item) => (
              <div 
                key={item.id} 
                className={`p-6 rounded-3xl border transition-all flex items-center justify-between group ${item.isAvailable ? 'bg-zinc-900 border-zinc-800' : 'bg-zinc-950 border-zinc-900 opacity-60'}`}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-zinc-950 rounded-xl flex items-center justify-center border border-zinc-800 group-hover:border-orange-500/30 transition-all">
                    <span className="text-xl">{item.isAvailable ? '🍕' : '🚫'}</span>
                  </div>
                  <div>
                    <h3 className={`font-bold transition-all ${item.isAvailable ? 'text-white' : 'text-zinc-600 line-through'}`}>{item.name}</h3>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-0.5">₹{item.price} • {item.category}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => { setEditingItem(item); setShowItemForm(true); }}
                    className="p-2 text-zinc-500 hover:text-orange-500 transition-colors"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button 
                    onClick={() => {
                       if (item.isAvailable) {
                          // Prompt for auto-restore
                          const choice = window.prompt("Type '1' to disable until End of Day. Type '2' to disable indefinitely.");
                          if (choice === '1') {
                             const endOfDay = new Date();
                             endOfDay.setHours(23, 59, 59, 999);
                             api.put(`/restaurants/menu/${item.id}/toggle`, { outOfStockUntil: endOfDay.toISOString() })
                              .then(res => setMenu(menu.map(m => m.id === item.id ? { ...m, isAvailable: res.data.isAvailable } : m)))
                              .catch(() => alert('Failed to update'));
                          } else if (choice === '2') {
                             toggleAvailability(item.id);
                          }
                       } else {
                          toggleAvailability(item.id);
                       }
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${item.isAvailable ? 'bg-orange-500' : 'bg-zinc-800'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${item.isAvailable ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showItemForm && (
        <MenuItemForm 
          initialData={editingItem}
          onCancel={() => { setShowItemForm(false); setEditingItem(null); }}
          onSubmit={handleMenuSubmit}
          isSubmitting={isSubmitting}
        />
      )}

      {selectedOrder && (
        <OrderDetailModal 
          order={selectedOrder} 
          onClose={() => setSelectedOrder(null)} 
        />
      )}
    </div>
  );
}
