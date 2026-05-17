"use client";
import React, { useState, useEffect, memo } from 'react';
import { io } from 'socket.io-client';
import { useAdminAuth } from '@/utils/useAdminAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5005';

interface OrderItem {
  name: string;
  quantity: number;
  price?: number;
}

interface Order {
  _id: string;
  id: string; 
  userId?: { name: string; phone: string };
  restaurantId?: string;
  items: OrderItem[];
  totalPrice: number;
  finalPrice?: number;
  status: string;
  hostelGateDelivery: boolean;
  deliverySlot?: string;
  createdAt: string;
}

const OrderRow = memo(({ order, onSelect, onUpdateStatus, onAccept, actionLoading, getStatusStyle }: { 
  order: Order, 
  onSelect: (o: Order) => void,
  onUpdateStatus: (id: string, status: string) => void,
  onAccept: (id: string) => void,
  actionLoading: string | null,
  getStatusStyle: (s: string) => string
}) => (
  <tr className="hover:bg-white/[0.01] transition-colors">
     <td className="p-4">
        <span className="font-mono text-[10px] text-gray-400">#{order._id.slice(-6).toUpperCase()}</span>
     </td>
     <td className="p-4">
        <p className="text-xs font-bold text-white">{order.userId?.name || 'Student'}</p>
        <p className="text-[9px] text-gray-500">{order.userId?.phone || 'N/A'}</p>
     </td>
     <td className="p-4">
        <button 
          onClick={() => onSelect(order)}
          className="text-left group"
        >
          <p className="text-xs text-white max-w-[200px] truncate group-hover:text-blue-400 transition-colors">
             {(order.items || []).map(i => `${i.name} (x${i.quantity})`).join(', ')}
          </p>
          <span className="text-[7px] text-gray-500 uppercase font-black tracking-widest">View Manifest →</span>
        </button>
     </td>
     <td className="p-4">
        <div className="flex flex-col">
           <span className="text-xs font-black text-white">₹{order.finalPrice || order.totalPrice}</span>
           {order.finalPrice !== undefined && order.finalPrice !== order.totalPrice && (
              <span className="text-[8px] text-gray-500 line-through">₹{order.totalPrice}</span>
           )}
           <span className="text-[7px] text-gray-500 uppercase font-black tracking-tighter">Grand Total</span>
        </div>
     </td>
     <td className="p-4">
        <span className="text-[10px] font-bold text-gray-300">
           {order.hostelGateDelivery ? 'Hostel Gate' : 'Room Delivery'}
        </span>
        {order.deliverySlot && <p className="text-[8px] text-blue-400">{order.deliverySlot}</p>}
     </td>
     <td className="p-4">
        <span className={`text-[9px] font-black px-2 py-1 rounded-md border uppercase tracking-wider ${getStatusStyle(order.status)}`}>
           {order.status}
        </span>
     </td>
      <td className="p-4">
         <span className="text-[10px] text-gray-500">
            {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
         </span>
      </td>
      <td className="p-4">
         <div className="flex gap-2">
           {order.status === 'Pending' && (
             <button
               onClick={() => onAccept(order._id)}
               disabled={actionLoading === order._id + 'Accept'}
               className="px-3 py-1.5 bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-sky-500/20 transition-all disabled:opacity-40"
             >
               {actionLoading === order._id + 'Accept' ? '...' : '▶ Dispatch'}
             </button>
           )}
           {order.status !== 'Delivered' && order.status !== 'Cancelled' && order.status !== 'Pending' && (
             <button
               onClick={() => onUpdateStatus(order._id, 'Delivered')}
               disabled={actionLoading === order._id + 'Delivered'}
               className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-emerald-500/20 transition-all disabled:opacity-40"
             >
               {actionLoading === order._id + 'Delivered' ? '...' : '✓ Deliver'}
             </button>
           )}
           {order.status !== 'Cancelled' && order.status !== 'Delivered' && (
             <button
               onClick={() => onUpdateStatus(order._id, 'Cancelled')}
               disabled={actionLoading === order._id + 'Cancelled'}
               className="px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-red-500/20 transition-all disabled:opacity-40"
             >
               {actionLoading === order._id + 'Cancelled' ? '...' : '✕ Cancel'}
             </button>
           )}
           {(order.status === 'Delivered' || order.status === 'Cancelled') && (
             <span className="text-[9px] text-gray-600 italic">—</span>
           )}
         </div>
      </td>
  </tr>
));
OrderRow.displayName = 'OrderRow';

export default function OrdersPage() {
  const isAuthed = useAdminAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('All');

  const updateOrderStatus = async (orderId: string, status: string) => {
    try {
      setActionLoading(orderId + status);
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ status })
      });
      if (res.ok) await fetchOrders();
    } catch (err) {
      console.error('[ORDER_UPDATE_ERROR]', err);
    } finally {
      setActionLoading(null);
    }
  };

  const fetchOrders = async (page = 1) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/admin/orders?page=${page}&status=${filterStatus}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
         setOrders(data.orders || []);
         setTotalOrders(data.total || 0);
         setTotalPages(data.pages || 1);
         setCurrentPage(page);
      }
    } catch (err) {
      console.error('[ORDERS_FETCH_ERROR]', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptOrder = async (orderId: string) => {
    try {
      setActionLoading(orderId + 'Accept');
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/orders/${orderId}/restaurant-accept`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) await fetchOrders();
    } catch { } finally { setActionLoading(null); }
  };

  useEffect(() => {
    fetchOrders(1);

    const socket = io(SOCKET_URL, {
      transports: ['websocket']
    });
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on('admin_newOrder', (order: any) => { 
       setOrders(prev => [{
          ...order,
          _id: order.id,
          createdAt: new Date().toISOString()
       }, ...prev].slice(0, 50)); 
    });
    socket.on('statusUpdated', (data: { id: string, status: string }) => { 
       setOrders(prev => prev.map(o => o._id === data.id ? { ...o, status: data.status } : o));
    });
    socket.on('orderCancelled', ({ orderId }: { orderId: string }) => { 
       setOrders(prev => prev.map(o => o._id === orderId ? { ...o, status: 'Cancelled' } : o));
    });

    return () => { socket.disconnect(); };
  }, [filterStatus]);

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'Pending': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'Accepted': return 'bg-sky-500/10 text-sky-400 border-sky-500/20';
      case 'PickedUp': return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
      case 'Delivered': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'Cancelled': return 'bg-red-500/10 text-red-500 border-red-500/20';
      default: return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    }
  };

  if (!isAuthed) return <div className="p-20 text-center font-black text-white uppercase tracking-widest animate-pulse">Authenticating...</div>;

  return (
    <div className="space-y-8 animate-fade-in relative pb-20">
      <div className="flex items-center justify-between">
         <div className="flex items-center gap-6">
           <h1 className="text-3xl font-black tracking-tighter text-white uppercase">Live Orders <span className="text-blue-500">Trace</span></h1>
           <div className="flex gap-2">
              {['All', 'Pending', 'Accepted', 'PickedUp', 'Delivered', 'Cancelled'].map(s => (
                <button 
                  key={s} 
                  onClick={() => setFilterStatus(s)}
                  className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all ${filterStatus === s ? 'bg-blue-500 text-white border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.4)]' : 'bg-white/5 text-gray-500 border-white/10 hover:text-white'}`}
                >
                  {s}
                </button>
              ))}
           </div>
         </div>
          <button onClick={() => fetchOrders(currentPage)} className="nexus-badge bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20 transition-all flex items-center gap-2">
            🔄 Refresh ({totalOrders})
          </button>
      </div>

      <div className="glass-card overflow-hidden border-white/10">
         <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
               <thead>
                  <tr className="border-b border-white/5 bg-white/[0.02]">
                     <th className="p-4 text-[10px] font-black uppercase text-gray-400 tracking-wider">Order ID</th>
                     <th className="p-4 text-[10px] font-black uppercase text-gray-400 tracking-wider">Customer</th>
                     <th className="p-4 text-[10px] font-black uppercase text-gray-400 tracking-wider">Items</th>
                     <th className="p-4 text-[10px] font-black uppercase text-gray-400 tracking-wider">Total</th>
                     <th className="p-4 text-[10px] font-black uppercase text-gray-400 tracking-wider">Drop Location</th>
                     <th className="p-4 text-[10px] font-black uppercase text-gray-400 tracking-wider">Status</th>
                     <th className="p-4 text-[10px] font-black uppercase text-gray-400 tracking-wider">Timestamp</th>
                     <th className="p-4 text-[10px] font-black uppercase text-gray-400 tracking-wider">Actions</th>
                   </tr>
               </thead>
               <tbody className="divide-y divide-white/[0.03]">
                  {loading ? (
                     <tr>
                        <td colSpan={8} className="p-10 text-center">
                           <div className="flex flex-col items-center justify-center gap-2 text-gray-500">
                              <div className="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                              <p className="text-[10px] uppercase font-black tracking-widest">Syncing Nodes...</p>
                           </div>
                        </td>
                     </tr>
                  ) : orders.filter(o => filterStatus === 'All' || o.status === filterStatus).length === 0 ? (
                     <tr>
                        <td colSpan={8} className="p-10 text-center text-gray-500 text-xs italic">
                           No orders found matching the filter.
                        </td>
                     </tr>
                  ) : (
                     orders.filter(o => filterStatus === 'All' || o.status === filterStatus).map((order) => (
                        <OrderRow 
                          key={order._id} 
                          order={order} 
                          onSelect={setSelectedOrder} 
                          onUpdateStatus={updateOrderStatus} 
                          onAccept={handleAcceptOrder}
                          actionLoading={actionLoading}
                          getStatusStyle={getStatusStyle}
                        />
                     ))
                  )}
               </tbody>
            </table>
         </div>

         {/* Pagination Interface */}
         {totalPages > 1 && (
           <div className="p-6 bg-white/[0.02] border-t border-white/5 flex items-center justify-between">
              <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                Showing Page {currentPage} of {totalPages}
              </span>
              <div className="flex gap-2">
                 <button 
                   disabled={currentPage === 1}
                   onClick={() => fetchOrders(currentPage - 1)}
                   className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase text-gray-400 hover:text-white disabled:opacity-30"
                 >
                   Previous
                 </button>
                 <button 
                   disabled={currentPage === totalPages}
                   onClick={() => fetchOrders(currentPage + 1)}
                   className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase text-gray-400 hover:text-white disabled:opacity-30"
                 >
                   Next
                 </button>
              </div>
           </div>
         )}
      </div>

      {/* Order Manifest Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-card max-w-2xl w-full p-10 space-y-8 animate-slide-up relative">
            <button 
              onClick={() => setSelectedOrder(null)}
              className="absolute top-8 right-8 text-gray-500 hover:text-white transition-colors"
            >
              ✕
            </button>
            
            <div className="flex justify-between items-start border-b border-white/5 pb-8">
               <div>
                  <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Order <span className="text-blue-500">Manifest</span></h3>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">Trace ID: #{selectedOrder._id.toUpperCase()}</p>
               </div>
               <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${getStatusStyle(selectedOrder.status)}`}>
                  {selectedOrder.status}
               </div>
            </div>

            <div className="grid grid-cols-2 gap-10">
               <div className="space-y-6">
                  <div>
                    <h5 className="text-[9px] font-black text-blue-500 uppercase tracking-[0.2em] mb-3">Customer Intel</h5>
                    <p className="text-lg font-black text-white">{selectedOrder.userId?.name || 'Student Resident'}</p>
                    <p className="text-xs text-gray-500 font-bold">{selectedOrder.userId?.phone || 'N/A'}</p>
                  </div>
                  <div>
                    <h5 className="text-[9px] font-black text-blue-500 uppercase tracking-[0.2em] mb-3">Operational Meta</h5>
                    <p className="text-xs text-white font-bold">{selectedOrder.hostelGateDelivery ? '📍 Gate Deployment' : '🚪 Direct Room Entry'}</p>
                    {selectedOrder.deliverySlot && <p className="text-[10px] text-blue-400 font-black mt-1">Slot: {selectedOrder.deliverySlot}</p>}
                  </div>
               </div>
               <div className="space-y-4">
                  <h5 className="text-[9px] font-black text-blue-500 uppercase tracking-[0.2em] mb-1">Asset Allocation</h5>
                  <div className="space-y-3 bg-white/[0.02] p-4 rounded-2xl border border-white/5 max-h-[200px] overflow-y-auto">
                    {selectedOrder.items.map((item, i) => (
                      <div key={i} className="flex justify-between items-center text-xs">
                        <span className="text-white font-bold">{item.name} <span className="text-gray-500 ml-1">x{item.quantity}</span></span>
                        <span className="text-gray-400">₹{(item.price || 0) * item.quantity}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between items-center pt-4 border-t border-white/5">
                     <span className="text-[10px] font-black text-white uppercase tracking-widest">Total Valuation</span>
                     <span className="text-xl font-black text-blue-500">₹{selectedOrder.finalPrice || selectedOrder.totalPrice}</span>
                  </div>
               </div>
            </div>

            <div className="flex gap-4 pt-4">
               <button onClick={() => setSelectedOrder(null)} className="flex-1 py-4 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black uppercase text-gray-500 hover:text-white transition-all">Close Trace</button>
               {selectedOrder.status === 'Pending' && (
                 <button 
                   onClick={() => { updateOrderStatus(selectedOrder._id, 'Accepted'); setSelectedOrder(null); }}
                   className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-[0_0_20px_rgba(37,99,235,0.4)]"
                 >
                   Authorize Dispatch
                 </button>
               )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

