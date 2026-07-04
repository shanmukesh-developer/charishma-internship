"use client";
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { OrderTimer } from './OrderUtils';
import DeliveryProof from './DeliveryProof';

interface Order {
  id: string;
  restaurant: string;
  restaurantAddress?: string;
  customerName: string;
  customerPhone?: string;
  drop: string;
  items: { name: string; quantity: number; price?: number; image?: string }[];
  totalAmount?: number;
  totalPrice?: number;
  finalPrice?: number;
  note?: string;
  createdAt?: string;
  status?: string;
  _id?: string;
  restaurantPhone?: string;
}

interface ActiveOrderCardProps {
  order: Order;
  status: string;
  actionLoading: boolean;
  pinValue: string;
  apiUrl: string;
  token: string;
  onPinChange: (value: string) => void;
  onPickUp: (id: string) => void;
  onDeliver: (id: string) => void;
  onArriveAtGate: (id: string) => Promise<void>;
  onChatOpen: (id: string) => void;
  onReportIssue: (id: string, type: string) => void;
  onCancel: (id: string) => void;
}

export default function ActiveOrderCard({ 
  order, 
  status, 
  actionLoading, 
  pinValue, 
  apiUrl,
  token,
  onPinChange, 
  onPickUp, 
  onDeliver,
  onArriveAtGate,
  onChatOpen,
  onReportIssue,
  onCancel
}: ActiveOrderCardProps) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showIssuePicker, setShowIssuePicker] = useState(false);
  const [gateLoading, setGateLoading] = useState(false);
  const [gateNotified, setGateNotified] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(`gate_notified_${order.id}`) === 'true';
    }
    return false;
  });

  const handleArriveAtGate = async () => {
    if (gateNotified || gateLoading) return;
    setGateLoading(true);
    try {
      await onArriveAtGate(order.id);
      setGateNotified(true);
      localStorage.setItem(`gate_notified_${order.id}`, 'true');
    } catch (err) {
      console.error(err);
    } finally {
      setGateLoading(false);
    }
  };

  const earnings = 30;
  const isAtPickup = status === 'Accepted' || status === 'ReadyForPickup';

  const ISSUE_TYPES = [
    { label: 'Delayed', icon: '⏱️' },
    { label: 'Wrong Items', icon: '📦' },
    { label: 'Customer Unreachable', icon: '📵' },
    { label: 'Restaurant Not Ready', icon: '🍳' },
    { label: 'Road Blocked', icon: '🚧' },
  ];

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative overflow-hidden"
    >
      {/* Glow accent */}
      <div className={`absolute -inset-px rounded-[28px] blur-sm ${isAtPickup ? 'bg-blue-500/10' : 'bg-emerald-500/10'}`} />

      <div className="relative metric-card !p-6 md:!p-8 rounded-[28px] border border-white/5">
        
        {/* Header — Status + Earnings */}
        <div className="flex justify-between items-start mb-8">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <motion.span
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className={`w-2 h-2 rounded-full ${isAtPickup ? 'bg-amber-400' : 'bg-emerald-400'}`}
              />
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                {isAtPickup ? 'Go to Restaurant' : 'Deliver to Customer'}
              </p>
            </div>
            <h2 className="text-2xl font-black text-white tracking-tight leading-tight">{order.restaurant}</h2>
            <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mt-1">Order #{order.id?.slice(-6).toUpperCase()}</p>
          </div>
          
          <div className="text-right">
            {order.createdAt && <OrderTimer createdAt={order.createdAt} />}
            <div className="mt-2 flex items-baseline gap-0.5 justify-end">
              <span className="text-xs text-emerald-500/60 font-black">+₹</span>
              <span className="text-2xl font-black text-emerald-400 tabular-nums">{earnings}</span>
            </div>
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-600 mt-0.5">Your Earn</p>
          </div>
        </div>

        {/* Special Note */}
        {order.note && (
          <div className="mb-6 p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 flex items-start gap-3">
            <span className="text-lg mt-0.5">📝</span>
            <div>
              <p className="text-[9px] text-amber-500/80 font-black uppercase tracking-widest mb-1">Customer Note</p>
              <p className="text-xs text-amber-200/70 font-medium leading-relaxed">{order.note}</p>
            </div>
          </div>
        )}

        {/* Route Visualization */}
        <div className="relative mb-8">
          {/* Connecting line */}
          <div className="absolute left-[19px] top-8 bottom-8 w-[2px] bg-gradient-to-b from-blue-500/40 to-emerald-500/40" />

          {/* Pickup */}
          <div className={`flex gap-4 mb-6 transition-all duration-500 ${!isAtPickup ? 'opacity-40' : ''}`}>
            <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center border-2 z-10 ${isAtPickup ? 'bg-blue-600 border-blue-400' : 'bg-slate-800 border-slate-600'}`}>
              <span className="text-[11px] font-black text-white">A</span>
            </div>
            <div className="flex-1 pt-1.5">
              <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-0.5">Pickup From</p>
              <h3 className="text-white font-bold text-sm leading-tight">{order.restaurantAddress || order.restaurant}</h3>
              {order.restaurantPhone && (
                <a
                  href={`tel:${order.restaurantPhone}`}
                  className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[9px] font-black uppercase tracking-widest hover:bg-blue-500/20 transition-all"
                >
                  📞 Call Restaurant
                </a>
              )}
            </div>
          </div>

          {/* Drop */}
          <div className={`flex gap-4 transition-all duration-500 ${isAtPickup ? 'opacity-40' : ''}`}>
            <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center border-2 z-10 ${!isAtPickup ? 'bg-emerald-600 border-emerald-400' : 'bg-slate-800 border-slate-600'}`}>
              <span className="text-[11px] font-black text-white">B</span>
            </div>
            <div className="flex-1 pt-1.5">
              <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mb-0.5">Deliver To</p>
              <h3 className="text-white font-bold text-sm leading-tight">{order.customerName}</h3>
              <p className="text-xs text-slate-500 mt-0.5 leading-tight">{order.drop}</p>
              {/* Call customer button — shown when phone is available */}
              {order.customerPhone && !order.customerPhone.includes('Protected') && (
                <a
                  href={`tel:${order.customerPhone}`}
                  className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase tracking-widest hover:bg-emerald-500/20 transition-all"
                >
                  📞 Call Customer
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Order Items */}
        <div className="bg-white/[0.025] rounded-2xl p-4 mb-6 border border-white/5">
          <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-3">Order Items</p>
          <div className="space-y-2">
            {order.items?.slice(0, 4).map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-blue-400 font-black text-xs w-5 shrink-0">{item.quantity}×</span>
                <span className="text-slate-300 font-medium truncate">{item.name}</span>
              </div>
            ))}
            {(order.items?.length || 0) > 4 && (
              <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">+{(order.items?.length || 0) - 4} more items</p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3 mb-6">
          {/* Navigate Button */}
          <button 
            onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(isAtPickup ? order.restaurantAddress || order.restaurant : order.drop)}`, '_blank')}
            className="w-full h-14 flex items-center justify-center gap-3 rounded-2xl bg-blue-600 text-white font-black text-[11px] uppercase tracking-[0.2em] shadow-lg shadow-blue-600/25 hover:bg-blue-500 transition-all active:scale-[0.98]"
          >
            <span className="text-base">📍</span>
            Navigate → {isAtPickup ? 'Restaurant' : 'Customer'}
          </button>
          
          {/* Secondary Actions */}
          <div className="grid grid-cols-2 gap-3">
            <button 
              onClick={() => onChatOpen(order.id)}
              className="h-12 flex items-center justify-center gap-2 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/8 text-[10px] font-black uppercase tracking-widest text-slate-300 transition-all"
            >
              💬 Chat
            </button>
            <button 
              onClick={() => setShowIssuePicker(true)}
              className="h-12 flex items-center justify-center gap-2 rounded-xl bg-red-500/5 border border-red-500/10 hover:bg-red-500/10 text-[10px] font-black uppercase tracking-widest text-red-500/60 hover:text-red-400 transition-all"
            >
              ⚠️ Issue
            </button>
          </div>

          {/* Issue Type Picker */}
          {showIssuePicker && (
            <div className="bg-[#111113] border border-white/10 rounded-2xl p-4 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-3">Select Issue Type</p>
              {ISSUE_TYPES.map(({ label, icon }) => (
                <button
                  key={label}
                  onClick={() => { onReportIssue(order.id, label); setShowIssuePicker(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-red-500/30 hover:bg-red-500/5 text-sm text-slate-300 font-bold transition-all text-left"
                >
                  <span>{icon}</span> {label}
                </button>
              ))}
              <button
                onClick={() => setShowIssuePicker(false)}
                className="w-full py-2 text-[9px] font-black uppercase tracking-widest text-slate-600 hover:text-slate-400 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Primary Action (Pickup / Deliver) */}
        <div className="pt-6 border-t border-white/5">
          {isAtPickup ? (
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => onPickUp(order.id)}
              disabled={actionLoading}
              className="w-full h-16 rounded-2xl bg-white text-black font-black text-[12px] uppercase tracking-widest transition-all hover:bg-slate-100 disabled:opacity-40 shadow-lg"
            >
              {actionLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                  Processing...
                </span>
              ) : '✅ Confirm Pickup'}
            </motion.button>
          ) : (
            <div className="space-y-4">
              {/* Reached Gate Button */}
              {!gateNotified ? (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handleArriveAtGate}
                  disabled={gateLoading}
                  className="w-full h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 font-black text-[11px] uppercase tracking-[0.2em] shadow-lg hover:bg-amber-500/20 transition-all flex items-center justify-center gap-2"
                >
                  {gateLoading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-amber-400/20 border-t-amber-400 rounded-full animate-spin" />
                      Sending Alert...
                    </>
                  ) : (
                    <>
                      <span>🛎️</span> Reached Gate (Notify Customer)
                    </>
                  )}
                </motion.button>
              ) : (
                <div className="w-full h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-black text-[11px] uppercase tracking-[0.2em] flex items-center justify-center gap-2">
                  <span>✅</span> Customer Notified of Gate Arrival
                </div>
              )}

              {/* Delivery Proof Photo */}
              <DeliveryProof orderId={order.id} apiUrl={apiUrl} token={token} />
              <div className="bg-white/[0.03] p-5 rounded-2xl border border-white/5">
                <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest text-center mb-3">
                  Ask customer for 4-digit PIN
                </p>
                <input 
                  type="tel" 
                  inputMode="numeric"
                  maxLength={4}
                  value={pinValue}
                  onChange={(e) => onPinChange(e.target.value.replace(/\D/g, ''))}
                  className="w-full bg-transparent text-5xl font-black tracking-[0.6em] text-center text-white outline-none placeholder:text-white/5 caret-blue-500"
                  placeholder="• • • •"
                />
                {/* PIN progress bar */}
                <div className="flex gap-2 mt-4 justify-center">
                  {[0,1,2,3].map(i => (
                    <div key={i} className={`h-1 w-8 rounded-full transition-all duration-200 ${i < pinValue.length ? 'bg-emerald-500' : 'bg-white/10'}`} />
                  ))}
                </div>
              </div>
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => onDeliver(order.id)}
                disabled={actionLoading || pinValue.length < 4}
                className={`w-full h-16 rounded-2xl font-black text-[12px] uppercase tracking-widest transition-all shadow-lg ${
                  pinValue.length === 4 
                    ? 'bg-emerald-600 text-white shadow-emerald-600/20 hover:bg-emerald-500' 
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                {actionLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    Validating PIN...
                  </span>
                ) : pinValue.length === 4 ? '🎯 Mark as Delivered' : 'Enter PIN to Complete'}
              </motion.button>
            </div>
          )}
        </div>
        {/* Emergency Cancel */}
        <div className="mt-4 pt-4 border-t border-white/5">
          {!showCancelConfirm ? (
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="w-full py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-red-500/50 hover:text-red-400 hover:bg-red-500/5 border border-red-500/10 hover:border-red-500/20 transition-all"
            >
              🚨 Emergency Cancel Order
            </button>
          ) : (
            <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 space-y-3">
              <p className="text-[10px] font-black text-red-400 uppercase tracking-widest text-center">Confirm Cancellation?</p>
              <p className="text-[10px] text-slate-500 text-center leading-relaxed">
                Order will be released back to queue for another rider.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  className="py-3 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white/5 text-slate-400 hover:bg-white/10 transition-all"
                >
                  Go Back
                </button>
                <button
                  onClick={() => { setShowCancelConfirm(false); onCancel(order.id); }}
                  disabled={actionLoading}
                  className="py-3 rounded-xl text-[10px] font-black uppercase tracking-widest bg-red-500 text-white hover:bg-red-400 transition-all disabled:opacity-50"
                >
                  Yes, Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
