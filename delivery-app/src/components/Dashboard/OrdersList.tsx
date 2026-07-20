"use client";
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface Order {
  id: string;
  restaurant: string;
  restaurantAddress?: string;
  customerName?: string;
  customerPhone?: string;
  drop?: string;
  items: { name: string; quantity: number; priceAtOrder?: number }[];
  totalAmount?: number;
  totalPrice?: number;
  finalPrice?: number;
  earnings?: string;
  deliveredAt?: string;
  createdAt?: string;
  deliverySlot?: string;
}

interface TaskCardProps {
  order: Order;
  timer?: number;
  sequence?: number;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  onShowDetails: (order: Order) => void;
}

const getOrderSection = (order: Order): 'Fruits' | 'Food' | 'Groceries' => {
  const items = order.items || [];
  for (const item of items) {
    const name = (item.name || '').toLowerCase();
    // Check fruits
    if (name.includes('fruit') || name.includes('apple') || name.includes('banana') || name.includes('mango') || name.includes('orange') || name.includes('grape') || name.includes('berry') || name.includes('strawberry') || name.includes('watermelon') || name.includes('papaya')) {
      return 'Fruits';
    }
    // Check food
    if (name.includes('biryani') || name.includes('sweet') || name.includes('curry') || name.includes('rice') || name.includes('noodle') || name.includes('burger') || name.includes('pizza') || name.includes('roti') || name.includes('roll') || name.includes('dosa') || name.includes('idli') || name.includes('paneer') || name.includes('chicken') || name.includes('sandwich')) {
      return 'Food';
    }
  }
  // Default to Groceries (Stationary, Essentials, Gym, Laundry, Pharmacy)
  return 'Groceries';
};

const getOrderTimeSlot = (order: Order): 'Before 7:30 AM' | 'After 7:30 AM' | '1:00 PM to 6:00 PM' => {
  const slot = (order.deliverySlot || '').toLowerCase();
  if (slot.includes('before 7:30') || slot.includes('breakfast') || slot.includes('early morning')) {
    return 'Before 7:30 AM';
  }
  if (slot.includes('1pm') || slot.includes('1 pm') || slot.includes('afternoon') || slot.includes('1pm to 6pm') || slot.includes('1pm-6pm')) {
    return '1:00 PM to 6:00 PM';
  }
  if (slot.includes('after 7:30')) {
    return 'After 7:30 AM';
  }

  // Fallback to createdAt time
  if (order.createdAt) {
    const date = new Date(order.createdAt);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const decimalTime = hours + minutes / 60;
    
    if (decimalTime < 7.5) {
      return 'Before 7:30 AM';
    } else if (decimalTime >= 13 && decimalTime <= 18) {
      return '1:00 PM to 6:00 PM';
    } else {
      return 'After 7:30 AM';
    }
  }
  
  return 'After 7:30 AM'; // Default fallback
};

const isBulkOrder = (order: Order): boolean => {
  const totalQty = order.items?.reduce((sum, item) => sum + (item.quantity || 1), 0) || 0;
  const price = order.finalPrice || order.totalPrice || 0;
  return totalQty >= 5 || price >= 500;
};

export function TaskCard({ order, sequence, onAccept, onDecline, onShowDetails }: TaskCardProps) {
  const isBulk = isBulkOrder(order);
  const timeSlot = getOrderTimeSlot(order);

  const getSlotStyle = (slot: string) => {
    switch (slot) {
      case 'Before 7:30 AM':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case '1:00 PM to 6:00 PM':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      default:
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      onClick={() => onShowDetails(order)}
      className="metric-card relative overflow-hidden group border border-white/5 cursor-pointer hover:border-white/10 active:scale-[0.99] transition-all"
    >
      {/* Background decoration for bulk orders */}
      {isBulk && (
        <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl -z-10 group-hover:bg-amber-500/10 transition-all" />
      )}

      <div className="flex justify-between items-start mb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="hud-title text-blue-500">
              {sequence ? `Priority Task #${sequence}` : 'Available Task'}
            </span>
            <span className={`text-[8px] font-black uppercase tracking-wider px-2 py-0.5 border rounded-full ${getSlotStyle(timeSlot)}`}>
              {timeSlot}
            </span>
            {isBulk && (
              <span className="text-[8px] font-black uppercase tracking-wider px-2 py-0.5 bg-amber-500 text-black rounded-full flex items-center gap-1 shadow-lg shadow-amber-500/10">
                🔥 Bulk Order
              </span>
            )}
          </div>
          <h4 className="text-xl font-bold text-white tracking-tight mt-1">{order.restaurant}</h4>
          <p className="text-[9px] font-bold text-blue-400/70 uppercase tracking-widest mt-0.5">#{order.id?.slice(-6).toUpperCase()}</p>
        </div>
        
        <div className="text-right">
          <span className="text-xl font-bold text-emerald-500">+₹30</span>
          <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mt-1">Your Earn</p>
        </div>
      </div>

      <div className="bg-white/[0.02] rounded-2xl p-4 mb-6 border border-white/5">
         <div className="space-y-2">
            {order.items?.map((item, idx) => (
              <div key={idx} className="flex justify-between items-center text-xs font-medium">
                <span className="text-slate-400">
                  <span className="text-blue-500 font-bold mr-2">{item.quantity}×</span>
                  {item.name}
                </span>
              </div>
            ))}
         </div>
         {order.drop && (
           <p className="text-[10px] text-slate-500 mt-3 border-t border-white/5 pt-2 italic">
             Drop: {order.drop}
           </p>
         )}
      </div>

      <div className="flex gap-4" onClick={(e) => e.stopPropagation()}>
        <button 
          onClick={() => onDecline(order.id)}
          className="flex-1 py-4 rounded-xl text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-white transition-all border border-transparent hover:border-white/5"
        >
          Ignore
        </button>
        <button 
          onClick={() => onAccept(order.id)}
          className="flex-[2] py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest bg-white text-black hover:bg-blue-600 hover:text-white transition-all shadow-sm font-black"
        >
          Accept Order
        </button>
      </div>
    </motion.div>
  );
}

export function HistoryCard({ order }: { order: Order }) {
  const date = order.deliveredAt ? new Date(order.deliveredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recently';
  
  return (
    <motion.div 
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="metric-card !p-5 flex items-center justify-between group"
    >
      <div className="flex items-center gap-4">
        <div className="w-11 h-11 rounded-2xl bg-white/[0.03] flex items-center justify-center border border-white/5 text-xl">
          📦
        </div>
        <div>
          <h4 className="text-[13px] font-bold text-white uppercase tracking-tight">{order.restaurant}</h4>
          <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.15em] mt-0.5">
            #{order.id?.slice(-6).toUpperCase()} • {date}
          </p>
        </div>
      </div>
        <div className="text-right">
        <p className="text-sm font-bold text-emerald-500 tabular-nums">
          {order.earnings 
            ? (typeof order.earnings === 'string' && order.earnings.includes('₹') ? order.earnings : `₹${order.earnings}`)
            : '+₹30'
          }
        </p>
        <p className="text-[8px] font-bold text-slate-600 uppercase tracking-widest">Earned</p>
      </div>
    </motion.div>
  );
}

interface OrdersListProps {
  orders: Order[];
  orderTimers: Record<string, number>;
  activeTab: 'pending' | 'history';
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  onRefresh: () => void;
}

export default function OrdersList({ orders, orderTimers, activeTab, onAccept, onDecline, onRefresh }: OrdersListProps) {
  const [selectedCategory, setSelectedCategory] = useState<'Fruits' | 'Food' | 'Groceries'>('Fruits');
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);

  // Group Pending Orders by Category & Time Slot
  const pendingBySection = {
    Fruits: [] as Order[],
    Food: [] as Order[],
    Groceries: [] as Order[]
  };

  if (activeTab === 'pending') {
    orders.forEach(order => {
      const section = getOrderSection(order);
      pendingBySection[section].push(order);
    });
  }

  const currentCategoryOrders = activeTab === 'pending' ? pendingBySection[selectedCategory] : orders;

  // Group current category's orders by time slots
  const groupedByTimeSlot = {
    'Before 7:30 AM': [] as Order[],
    'After 7:30 AM': [] as Order[],
    '1:00 PM to 6:00 PM': [] as Order[]
  };

  currentCategoryOrders.forEach(order => {
    const slot = getOrderTimeSlot(order);
    groupedByTimeSlot[slot].push(order);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between px-1">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            {activeTab === 'pending' ? 'Operational Queue' : 'Activity Archive'}
          </h2>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">
            {activeTab === 'pending' ? 'Real-time task synchronization' : 'Verified fulfillment history'}
          </p>
        </div>
        <button 
          onClick={onRefresh} 
          className="text-[9px] font-bold uppercase tracking-widest text-blue-500 hover:text-white transition-all px-4 py-2 rounded-xl bg-blue-500/5 hover:bg-blue-500/20"
        >
          {activeTab === 'pending' ? 'Fetch New' : 'Reload Logs'}
        </button>
      </div>

      {/* Category Segment Control (Only in Incoming/Pending tab) */}
      {activeTab === 'pending' && (
        <div className="bg-[#141416]/90 border border-white/5 p-1 rounded-2xl flex gap-1">
          {(['Fruits', 'Food', 'Groceries'] as const).map(cat => {
            const count = pendingBySection[cat].length;
            const icons = { Fruits: '🍏', Food: '🍔', Groceries: '📦' };
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`flex-1 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
                  selectedCategory === cat 
                    ? 'bg-white text-black font-black shadow-lg shadow-black/25' 
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <span>{icons[cat]}</span>
                {cat}
                {count > 0 && (
                  <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${selectedCategory === cat ? 'bg-black text-white' : 'bg-white/10 text-slate-400'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <AnimatePresence mode="wait">
        {currentCategoryOrders.length === 0 ? (
          <motion.div 
            key="empty-state"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="metric-card py-20 text-center border-dashed opacity-60"
          >
             <div className="w-16 h-16 bg-white/[0.03] rounded-full flex items-center justify-center mx-auto mb-6 border border-white/5 text-2xl">
                {activeTab === 'pending' ? '📦' : '⏳'}
             </div>
             <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">
               {activeTab === 'pending' 
                 ? `No ${selectedCategory} orders in queue` 
                 : 'No fulfillment history available'
               }
             </p>
          </motion.div>
        ) : (
          <motion.div 
            key="list-content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-8"
          >
             {activeTab === 'pending' ? (
               // Group and display slots with priority: Before 7:30 AM first, then After 7:30 AM, then 1:00 PM to 6:00 PM
               (['Before 7:30 AM', 'After 7:30 AM', '1:00 PM to 6:00 PM'] as const).map(slotName => {
                 const slotOrders = groupedByTimeSlot[slotName];
                 if (slotOrders.length === 0) return null;

                 return (
                   <div key={slotName} className="space-y-4">
                     <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                       <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                       <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">
                         {slotName} Orders ({slotOrders.length})
                       </h3>
                     </div>
                     <div className="grid grid-cols-1 gap-4">
                       {slotOrders.map((order, idx) => (
                         <TaskCard 
                           key={order.id} 
                           order={order} 
                           sequence={idx + 1}
                           timer={orderTimers[order.id]}
                           onAccept={onAccept}
                           onDecline={onDecline}
                           onShowDetails={(ord) => setDetailOrder(ord)}
                         />
                       ))}
                     </div>
                   </div>
                 );
               })
             ) : (
               <div className="grid grid-cols-1 gap-4">
                 {orders.map((order) => (
                   <HistoryCard key={order.id} order={order} />
                 ))}
               </div>
             )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Glassmorphic Customer Details Modal */}
      <AnimatePresence>
        {detailOrder && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDetailOrder(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[#18181b] border border-white/10 rounded-[32px] w-full max-w-md p-6 overflow-hidden shadow-2xl relative z-10"
            >
              {/* Close Button */}
              <button 
                onClick={() => setDetailOrder(null)}
                className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white"
              >
                ✕
              </button>

              <div className="mb-6">
                <span className="text-[10px] font-black uppercase tracking-widest text-blue-500 bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">
                  Customer & Order Details
                </span>
                <h3 className="text-xl font-bold text-white tracking-tight mt-3">
                  {detailOrder.restaurant}
                </h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                  Order ID: #{detailOrder.id.toUpperCase()}
                </p>
              </div>

              <div className="space-y-4 mb-8">
                {/* Customer Details */}
                <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 space-y-3">
                  <div>
                    <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block">Client Name</span>
                    <TextOrPlaceholder value={detailOrder.customerName} placeholder="Customer" />
                  </div>
                  <div>
                    <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block">Drop Location</span>
                    <TextOrPlaceholder value={detailOrder.drop} placeholder="Hostel Drop gate / Room" />
                  </div>
                  <div>
                    <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block">Delivery Slot Priority</span>
                    <TextOrPlaceholder value={getOrderTimeSlot(detailOrder)} placeholder="Standard" />
                  </div>
                  {isBulkOrder(detailOrder) && (
                    <div className="pt-1">
                      <span className="inline-block text-[9px] font-black uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30 px-3 py-0.5 rounded-full">
                        🔥 High Volume / Bulk order
                      </span>
                    </div>
                  )}
                </div>

                {/* Items list */}
                <div>
                  <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block mb-2 px-1">Order Items</span>
                  <div className="space-y-1 bg-white/[0.02] border border-white/5 rounded-2xl p-4">
                    {detailOrder.items?.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-xs">
                        <span className="text-slate-400">
                          <span className="text-blue-500 font-bold mr-2">{item.quantity}×</span>
                          {item.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Action Rows: Call & Message */}
              <div className="flex gap-4">
                <a
                  href={`tel:${detailOrder.customerPhone || ''}`}
                  onClick={(e) => {
                    if (!detailOrder.customerPhone || detailOrder.customerPhone === 'Hidden') {
                      e.preventDefault();
                      alert('Customer phone number is protected.');
                    }
                  }}
                  className="flex-1 py-4 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20 text-center"
                >
                  <span>📞</span> Call Client
                </a>

                <a
                  href={`https://wa.me/91${detailOrder.customerPhone || ''}`}
                  onClick={(e) => {
                    if (!detailOrder.customerPhone || detailOrder.customerPhone === 'Hidden') {
                      e.preventDefault();
                      alert('Customer contact details are protected.');
                    }
                  }}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 py-4 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 text-center"
                >
                  <span>💬</span> WhatsApp
                </a>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TextOrPlaceholder({ value, placeholder }: { value?: string; placeholder: string }) {
  if (!value || value === 'Hidden' || value === 'Identity Protected') {
    return <span className="text-sm font-bold text-slate-500 italic">{placeholder}</span>;
  }
  return <span className="text-sm font-bold text-white">{value}</span>;
}
