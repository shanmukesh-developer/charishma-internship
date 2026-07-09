"use client";

import React, { useState } from 'react';
import { motion } from 'framer-motion';

interface BasketItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  priceEstimated: number;
  priceActual?: number;
  status: 'Pending' | 'Approved' | 'Unavailable';
}

interface User {
  name: string;
  phone: string;
  hostelBlock: string;
  roomNumber: string;
}

interface MegaBasket {
  id: string;
  status: 'Created' | 'PaidEstimate' | 'PartnerAssigned' | 'Shopping' | 'PriceApprovalPending' | 'Approved' | 'Purchased' | 'Delivering' | 'Delivered';
  estimatedTotal: number;
  actualTotal?: number;
  shoppingFee: number;
  deliveryFee: number;
  deliveryAddress: string;
  deliveryPin: string;
  paymentMethod: 'COD' | 'UPI';
  paymentStatus: 'Pending' | 'Completed';
  items: BasketItem[];
  user: User;
  createdAt: string;
}

interface ActiveBasketCardProps {
  basket: MegaBasket;
  apiUrl: string;
  onRefresh: () => void;
}

export default function ActiveBasketCard({ basket, apiUrl, onRefresh }: ActiveBasketCardProps) {
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [itemPrices, setItemPrices] = useState<Record<string, number>>(() => {
    const prices: Record<string, number> = {};
    basket.items.forEach(item => {
      prices[item.id] = item.priceActual !== undefined ? item.priceActual : item.priceEstimated;
    });
    return prices;
  });
  
  const [pinValue, setPinValue] = useState('');
  const [submittingPin, setSubmittingPin] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const handleUpdateItemStatus = async (itemId: string, status: 'Approved' | 'Unavailable') => {
    setUpdatingItemId(itemId);
    try {
      const priceActual = itemPrices[itemId];
      const res = await fetch(`${apiUrl}/api/mega-basket/${basket.id}/item-status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, status, priceActual })
      });
      if (res.ok) {
        onRefresh();
      } else {
        const err = await res.json();
        alert(err.message || 'Failed to update item');
      }
    } catch (e) {
      alert('Network error updating item status');
    } finally {
      setUpdatingItemId(null);
    }
  };

  const handlePriceChange = (itemId: string, value: string) => {
    const val = parseFloat(value) || 0;
    setItemPrices(prev => ({ ...prev, [itemId]: val }));
  };

  const handleTransitionStatus = async (endpoint: string, body?: any) => {
    setActionLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/mega-basket/${basket.id}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      if (res.ok) {
        onRefresh();
      } else {
        const err = await res.json();
        alert(err.message || 'Action failed');
      }
    } catch (e) {
      alert('Network error executing transition');
    } finally {
      setActionLoading(false);
    }
  };

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinValue || pinValue.trim().length !== 4) {
      alert('Please enter the 4-digit verification PIN.');
      return;
    }
    setSubmittingPin(true);
    try {
      const res = await fetch(`${apiUrl}/api/mega-basket/${basket.id}/complete-delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryPin: pinValue.trim() })
      });
      if (res.ok) {
        onRefresh();
      } else {
        const err = await res.json();
        alert(err.message || 'PIN verification failed');
      }
    } catch (e) {
      alert('Network error during PIN verification');
    } finally {
      setSubmittingPin(false);
    }
  };

  const getStatusBadgeColor = (status: MegaBasket['status']) => {
    switch (status) {
      case 'PartnerAssigned': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'Shopping': return 'bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse';
      case 'PriceApprovalPending': return 'bg-purple-500/10 text-purple-400 border-purple-500/20 animate-pulse';
      case 'Approved': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'Purchased': return 'bg-teal-500/10 text-teal-400 border-teal-500/20';
      case 'Delivering': return 'bg-rose-500/10 text-rose-400 border-rose-500/20 animate-bounce';
      default: return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="metric-card relative overflow-hidden group border border-white/5 bg-[#141416]/90 rounded-[28px] p-6 shadow-xl"
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <span className="hud-title text-emerald-500 uppercase tracking-widest text-[9px] font-bold">
            Essentials Shopping Job
          </span>
          <h4 className="text-lg font-black text-white tracking-tight mt-1">
            Deliver to: {basket.user?.name || 'Customer'}
          </h4>
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-0.5">
            Room: {basket.user?.roomNumber || 'N/A'}, Block: {basket.user?.hostelBlock || 'N/A'}
          </p>
          <p className="text-[9px] font-bold text-[#C9A84C]/80 uppercase tracking-widest mt-1">
            Order #{basket.id.slice(-6).toUpperCase()}
          </p>
        </div>

        <div className="text-right">
          <span className={`text-[9px] font-black uppercase tracking-widest px-3 py-1 border rounded-full ${getStatusBadgeColor(basket.status)}`}>
            {basket.status}
          </span>
          <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mt-2">
            Est Earnings: <span className="text-emerald-400 font-black">+₹50</span>
          </p>
        </div>
      </div>

      {/* Main Flow Controls */}
      <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 mb-6">
        {basket.status === 'PartnerAssigned' && (
          <div className="text-center py-4">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-4">
              You claimed this basket. Arrive at the store and start shopping.
            </p>
            <button
              onClick={() => handleTransitionStatus('start-shopping')}
              disabled={actionLoading}
              className="w-full py-4 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] bg-emerald-500 text-black hover:bg-emerald-400 transition-all shadow-[0_4px_20px_rgba(16,185,129,0.2)] disabled:opacity-50"
            >
              {actionLoading ? 'Initializing...' : 'Start Shopping 🛒'}
            </button>
          </div>
        )}

        {basket.status === 'Shopping' && (
          <div className="space-y-4">
            <p className="text-[10px] text-yellow-500 font-black uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <span>🛒</span> Shop Pricing Checklist
            </p>
            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wide mb-4">
              Enter actual shop price for each item. Mark unavailable if out of stock.
            </p>

            <div className="space-y-3">
              {basket.items.map((item) => (
                <div key={item.id} className="bg-black/40 border border-white/5 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-black text-white">{item.name}</span>
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">
                      Qty: {item.quantity} {item.unit} • Est: ₹{item.priceEstimated}/unit
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="w-24">
                      <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block mb-0.5">Actual Price</label>
                      <input
                        type="number"
                        min="0"
                        value={itemPrices[item.id] || 0}
                        onChange={(e) => handlePriceChange(item.id, e.target.value)}
                        className="w-full bg-black/55 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500 text-center"
                      />
                    </div>

                    <div className="flex gap-1 mt-3">
                      <button
                        onClick={() => handleUpdateItemStatus(item.id, 'Approved')}
                        disabled={updatingItemId === item.id}
                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-all ${item.status === 'Approved' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-black/20 border-white/5 text-gray-400 hover:text-white'}`}
                      >
                        Available
                      </button>
                      <button
                        onClick={() => handleUpdateItemStatus(item.id, 'Unavailable')}
                        disabled={updatingItemId === item.id}
                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-all ${item.status === 'Unavailable' ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-black/20 border-white/5 text-gray-400 hover:text-white'}`}
                      >
                        N/A
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => handleTransitionStatus('submit-bill')}
              disabled={actionLoading || basket.items.some(i => i.status === 'Pending')}
              className="w-full py-4 rounded-xl text-[10px] font-black uppercase tracking-[0.15em] bg-white text-black hover:bg-emerald-500 hover:text-black transition-all shadow-lg disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-black"
            >
              {actionLoading ? 'Submitting...' : 'Submit Prices for Customer Approval'}
            </button>
            {basket.items.some(i => i.status === 'Pending') && (
              <p className="text-[8px] text-amber-500 font-bold text-center uppercase tracking-widest">
                * Please checklist all items before submitting bill
              </p>
            )}
          </div>
        )}

        {basket.status === 'PriceApprovalPending' && (
          <div className="text-center py-6 animate-pulse">
            <span className="text-2xl block mb-2">⏳</span>
            <p className="text-[10px] text-purple-400 font-black uppercase tracking-widest">
              Awaiting Price Approval
            </p>
            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mt-1">
              Customer is reviewing the bill details (Total actual: ₹{basket.actualTotal}). Please wait.
            </p>
          </div>
        )}

        {basket.status === 'Approved' && (
          <div className="text-center py-4">
            <p className="text-[10px] text-emerald-400 font-black uppercase tracking-widest mb-4">
              ✓ Customer Approved Bill Prices!
            </p>
            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mb-4">
              Pay at checkout and pack the items securely.
            </p>
            <button
              onClick={() => handleTransitionStatus('purchase-completed')}
              disabled={actionLoading}
              className="w-full py-4 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] bg-emerald-500 text-black hover:bg-emerald-400 transition-all shadow-[0_4px_20px_rgba(16,185,129,0.2)] disabled:opacity-50"
            >
              {actionLoading ? 'Updating...' : 'Purchase Completed'}
            </button>
          </div>
        )}

        {basket.status === 'Purchased' && (
          <div className="text-center py-4">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-4">
              Items purchased and packed. Start transit to the hostel address.
            </p>
            <button
              onClick={() => handleTransitionStatus('start-delivery')}
              disabled={actionLoading}
              className="w-full py-4 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] bg-emerald-500 text-black hover:bg-emerald-400 transition-all shadow-[0_4px_20px_rgba(16,185,129,0.2)] disabled:opacity-50"
            >
              {actionLoading ? 'Updating...' : 'Start Delivery Run 🚀'}
            </button>
          </div>
        )}

        {basket.status === 'Delivering' && (
          <div className="space-y-4">
            <div className="bg-black/30 border border-white/5 rounded-xl p-4">
              <p className="text-[8px] font-black text-gray-500 uppercase tracking-widest mb-1">Fulfillment Target</p>
              <p className="text-xs font-black text-white">Address: {basket.deliveryAddress}</p>
              <p className="text-[9px] text-emerald-400 font-bold mt-1 uppercase tracking-widest">Payment Mode: {basket.paymentMethod} ({basket.paymentStatus === 'Completed' ? 'Paid' : 'Pay Cash ₹' + ((basket.actualTotal || basket.estimatedTotal) + basket.shoppingFee + basket.deliveryFee)})</p>
              <a href={`tel:${basket.user?.phone}`} className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mt-3 inline-block">📞 Call Customer: {basket.user?.phone}</a>
            </div>

            <form onSubmit={handleVerifyPin} className="space-y-3">
              <div>
                <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest block mb-2 text-center">
                  Ask customer for their 4-digit Delivery PIN
                </label>
                <input
                  type="text"
                  maxLength={4}
                  placeholder="e.g. 1234"
                  value={pinValue}
                  onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))}
                  className="w-full bg-black/60 border border-[#C9A84C]/30 rounded-xl py-3 text-sm text-center font-black tracking-[0.4em] text-white focus:outline-none focus:border-[#C9A84C]"
                />
              </div>

              <button
                type="submit"
                disabled={submittingPin || pinValue.length !== 4}
                className="w-full py-4 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] bg-[#C9A84C] text-black hover:bg-[#d4b96a] transition-all disabled:opacity-40"
              >
                {submittingPin ? 'Verifying PIN...' : 'Verify PIN & Deliver'}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Item summary lists for non-shopping states */}
      {basket.status !== 'Shopping' && (
        <div className="border-t border-white/5 pt-4">
          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-3">Shopping List Overview</p>
          <div className="space-y-2">
            {basket.items.map((item, idx) => (
              <div key={idx} className="flex justify-between items-center text-xs font-bold text-slate-400">
                <span>
                  <span className="text-emerald-500 font-black mr-2">{item.quantity}x</span>
                  {item.name} ({item.unit})
                </span>
                <span className={item.status === 'Unavailable' ? 'line-through text-red-500' : 'text-slate-300'}>
                  {item.status === 'Unavailable' ? 'N/A' : `₹${item.priceActual || item.priceEstimated}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
