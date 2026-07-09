"use client";

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { API_URL } from '@/utils/api';
import socket from '@/utils/socket';
import { showToast } from '@/components/ToastProvider';

interface BasketItem {
  id?: string;
  name: string;
  quantity: number;
  unit: string;
  priceEstimated: number;
  priceActual?: number;
  status: 'Pending' | 'Approved' | 'Unavailable';
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
  upiUTR?: string;
  items: BasketItem[];
  deliveryPartner?: {
    name: string;
    phone: string;
    photoUrl?: string;
  };
  createdAt: string;
}

const QUICK_ITEMS = [
  { name: 'Organic Tomatoes', unit: 'kg', priceEstimated: 40, category: '🍅 Veggies' },
  { name: 'Fresh Potatoes', unit: 'kg', priceEstimated: 30, category: '🥔 Veggies' },
  { name: 'Amul Fresh Milk', unit: 'packet', priceEstimated: 30, category: '🥛 Dairy' },
  { name: 'Fresh Brown Eggs', unit: 'dozen', priceEstimated: 80, category: '🥚 Dairy' },
  { name: 'Britannia Bread', unit: 'pcs', priceEstimated: 45, category: '🍞 Bakery' },
  { name: 'Comfort Blue Softener', unit: 'pcs', priceEstimated: 60, category: '🧼 Essentials' },
  { name: 'Surf Excel Liquid', unit: 'pcs', priceEstimated: 120, category: '🧼 Essentials' },
  { name: 'Maggi 2-Min Noodles', unit: 'packet', priceEstimated: 15, category: '🍜 Snacks' }
];

export default function MegaBasketPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'new' | 'list'>('new');
  
  // New Basket Form State
  const [items, setItems] = useState<BasketItem[]>([]);
  const [customName, setCustomName] = useState('');
  const [customQty, setCustomQty] = useState(1);
  const [customUnit, setCustomUnit] = useState('pcs');
  const [customPrice, setCustomPrice] = useState(20);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'COD' | 'UPI'>('COD');
  const [upiUTR, setUpiUTR] = useState('');
  const [placing, setPlacing] = useState(false);
  const [showUpiModal, setShowUpiModal] = useState(false);
  const [createdBasketId, setCreatedBasketId] = useState<string | null>(null);

  // Baskets List State
  const [baskets, setBaskets] = useState<MegaBasket[]>([]);
  const [selectedBasket, setSelectedBasket] = useState<MegaBasket | null>(null);
  const [loadingBaskets, setLoadingBaskets] = useState(false);
  const [approvingPrice, setApprovingPrice] = useState(false);

  // Check login session
  useEffect(() => {
    const token = 'cookie-managed';
    if (!token) {
      router.push('/login?redirect=mega-basket');
      return;
    }

    // Load user details if available
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const user = JSON.parse(stored);
        if (user.defaultAddress) {
          setDeliveryAddress(user.defaultAddress);
        } else if (user.hostelBlock && user.roomNumber) {
          setDeliveryAddress(`Block ${user.hostelBlock}, Room ${user.roomNumber}`);
        }
      }
    } catch { /* ignore */ }

    fetchBaskets();
  }, [router]);

  // Socket listener for selected basket
  useEffect(() => {
    if (!selectedBasket) return;

    const basketIdStr = selectedBasket.id.toString();
    socket.emit('joinRoom', basketIdStr);
    console.log('[SOCKET] Joined basket room:', basketIdStr);

    const handleStatusUpdated = (data: { id: string; status: MegaBasket['status']; actualTotal?: number }) => {
      if (data.id === selectedBasket.id) {
        showToast(`Basket status updated: ${data.status}! 🔔`, 'info', '🛒');
        setSelectedBasket(prev => {
          if (!prev) return null;
          return {
            ...prev,
            status: data.status,
            actualTotal: data.actualTotal !== undefined ? data.actualTotal : prev.actualTotal
          };
        });
        fetchBaskets();
      }
    };

    const handleItemUpdated = (item: BasketItem) => {
      showToast(`Rider updated item: ${item.name}! 🔍`, 'info', '📋');
      setSelectedBasket(prev => {
        if (!prev) return null;
        const updatedItems = prev.items.map(i => i.id === item.id || (i.name === item.name && !i.id) ? { ...i, ...item } : i);
        return {
          ...prev,
          items: updatedItems
        };
      });
      fetchBaskets();
    };

    socket.on('statusUpdated', handleStatusUpdated);
    socket.on('basket_item_updated', handleItemUpdated);

    return () => {
      socket.off('statusUpdated', handleStatusUpdated);
      socket.off('basket_item_updated', handleItemUpdated);
    };
  }, [selectedBasket]);

  const fetchBaskets = async () => {
    setLoadingBaskets(true);
    try {
      const res = await fetch(`${API_URL}/api/mega-basket`);
      if (res.ok) {
        const data = await res.json();
        setBaskets(data);
        // Refresh selected basket if currently viewing one
        if (selectedBasket) {
          const fresh = data.find((b: MegaBasket) => b.id === selectedBasket.id);
          if (fresh) setSelectedBasket(fresh);
        }
      }
    } catch (err) {
      console.error('Failed to fetch baskets:', err);
    } finally {
      setLoadingBaskets(false);
    }
  };

  const handleQuickAdd = (item: typeof QUICK_ITEMS[0]) => {
    const exists = items.find(i => i.name === item.name);
    if (exists) {
      setItems(prev => prev.map(i => i.name === item.name ? { ...i, quantity: i.quantity + 1 } : i));
      showToast(`Increased quantity of ${item.name}`, 'success', '➕');
    } else {
      setItems(prev => [...prev, {
        name: item.name,
        quantity: 1,
        unit: item.unit,
        priceEstimated: item.priceEstimated,
        status: 'Pending'
      }]);
      showToast(`Added ${item.name} to basket`, 'success', '🛒');
    }
  };

  const handleAddCustom = () => {
    if (!customName.trim()) {
      showToast('Please enter an item name', 'warning', '⚠️');
      return;
    }
    const exists = items.find(i => i.name.toLowerCase() === customName.trim().toLowerCase());
    if (exists) {
      showToast('Item already in list. Update quantity instead!', 'warning', '⚠️');
      return;
    }
    setItems(prev => [...prev, {
      name: customName.trim(),
      quantity: customQty,
      unit: customUnit,
      priceEstimated: customPrice,
      status: 'Pending'
    }]);
    setCustomName('');
    setCustomQty(1);
    setCustomPrice(20);
    showToast(`Added ${customName.trim()} to list`, 'success', '✓');
  };

  const handleRemoveItem = (index: number) => {
    setItems(prev => prev.filter((_, idx) => idx !== index));
  };

  const subtotal = useMemo(() => {
    return items.reduce((acc, curr) => acc + (curr.priceEstimated * curr.quantity), 0);
  }, [items]);

  const shoppingFee = 30;
  const deliveryFee = 20;
  const grandTotal = subtotal + shoppingFee + deliveryFee;

  const handlePlaceOrder = async () => {
    if (items.length === 0) {
      showToast('Your basket is empty!', 'warning', '⚠️');
      return;
    }
    if (!deliveryAddress.trim()) {
      showToast('Delivery address is required!', 'warning', '⚠️');
      return;
    }

    setPlacing(true);
    try {
      const res = await fetch(`${API_URL}/api/mega-basket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          deliveryAddress,
          paymentMethod
        })
      });

      if (res.ok) {
        const basket = await res.json();
        setCreatedBasketId(basket.id);
        if (paymentMethod === 'UPI') {
          setShowUpiModal(true);
        } else {
          showToast('Essentials basket order placed! ⚡', 'success', '🎉');
          setItems([]);
          fetchBaskets();
          // Select and view the newly created basket
          setSelectedBasket(basket);
          setActiveTab('list');
        }
      } else {
        const err = await res.json();
        showToast(err.message || 'Failed to place order', 'error', '❌');
      }
    } catch (error) {
      showToast('Network error, please try again', 'error', '❌');
    } finally {
      setPlacing(false);
    }
  };

  const handleUpiSubmit = async () => {
    if (!upiUTR.trim() || upiUTR.trim().length < 6) {
      showToast('Enter a valid UPI Reference / UTR Number', 'warning', '⚠️');
      return;
    }
    if (!createdBasketId) return;

    try {
      const res = await fetch(`${API_URL}/api/mega-basket/${createdBasketId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upiUTR })
      });

      if (res.ok) {
        const data = await res.json();
        showToast('Payment submitted! Awaiting dispatch.', 'success', '💳');
        setShowUpiModal(false);
        setUpiUTR('');
        setItems([]);
        fetchBaskets();
        setSelectedBasket(data.basket);
        setActiveTab('list');
      } else {
        showToast('Submission failed', 'error', '❌');
      }
    } catch (err) {
      showToast('Server error during payment submission', 'error', '❌');
    }
  };

  const handleApproveBill = async () => {
    if (!selectedBasket) return;
    setApprovingPrice(true);
    try {
      const res = await fetch(`${API_URL}/api/mega-basket/${selectedBasket.id}/approve`, {
        method: 'POST'
      });
      if (res.ok) {
        showToast('Prices approved! Rider is purchasing now.', 'success', '✅');
        fetchBaskets();
      } else {
        showToast('Approval failed', 'error', '❌');
      }
    } catch (err) {
      showToast('Network error, try again', 'error', '❌');
    } finally {
      setApprovingPrice(false);
    }
  };

  const getStatusStep = (status: MegaBasket['status']) => {
    const steps = [
      'Created',
      'PaidEstimate',
      'PartnerAssigned',
      'Shopping',
      'PriceApprovalPending',
      'Approved',
      'Purchased',
      'Delivering',
      'Delivered'
    ];
    return steps.indexOf(status);
  };

  const getStatusLabel = (status: MegaBasket['status']) => {
    const labels: Record<MegaBasket['status'], string> = {
      Created: 'Created (Awaiting Payment)',
      PaidEstimate: 'Payment Verified (Finding Rider)',
      PartnerAssigned: 'Rider Claimed Job',
      Shopping: 'Rider is in the Shop 🛒',
      PriceApprovalPending: 'Price Approval Required 🚨',
      Approved: 'Prices Approved by You',
      Purchased: 'Items Purchased, Packing',
      Delivering: 'Rider is en route 🚀',
      Delivered: 'Completed & Delivered 🎉'
    };
    return labels[status] || status;
  };

  return (
    <main className="min-h-screen bg-background text-white light:text-gray-900 p-6 relative overflow-hidden">
      {/* Background radial effects */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-emerald-500/[0.04] rounded-full blur-[120px]" />
        <div className="absolute top-1/3 -left-32 w-80 h-80 bg-[#C9A84C]/[0.03] rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-lg mx-auto pb-24">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 pt-4">
          <Link href="/" className="w-10 h-10 glass-card rounded-full flex items-center justify-center border border-white/5 active:scale-95 transition-all">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-xl">🧺</span>
            <h1 className="text-lg font-black uppercase tracking-[0.15em] bg-gradient-to-r from-emerald-400 via-teal-300 to-yellow-400 text-transparent bg-clip-text">
              Mega Basket
            </h1>
          </div>
          <div className="w-10" />
        </div>

        {/* Navigation Tabs */}
        <div className="flex bg-[#141416]/80 border border-white/5 p-1 rounded-2xl mb-6">
          <button
            onClick={() => { setActiveTab('new'); setSelectedBasket(null); }}
            className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === 'new' ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-black shadow-lg shadow-emerald-500/20' : 'text-gray-400 hover:text-white'}`}
          >
            Create Basket
          </button>
          <button
            onClick={() => { setActiveTab('list'); fetchBaskets(); }}
            className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === 'list' ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-black shadow-lg shadow-emerald-500/20' : 'text-gray-400 hover:text-white'}`}
          >
            Active Baskets ({baskets.filter(b => b.status !== 'Delivered').length})
          </button>
        </div>

        {activeTab === 'new' ? (
          <div>
            {/* Create Basket View */}
            <div className="glass-card p-5 rounded-[28px] border border-white/5 mb-6">
              <h2 className="text-xs font-black uppercase tracking-widest text-[#C9A84C] mb-4">Quick Add Essentials</h2>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {QUICK_ITEMS.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleQuickAdd(item)}
                    className="flex flex-col justify-start p-3 bg-white/5 border border-white/5 rounded-xl hover:border-emerald-500/30 hover:bg-white/10 transition-all text-left active:scale-95"
                  >
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{item.category}</span>
                    <span className="text-xs font-black truncate w-full text-white">{item.name}</span>
                    <span className="text-[11px] font-black text-emerald-400 mt-2">Est. ₹{item.priceEstimated} / {item.unit}</span>
                  </button>
                ))}
              </div>

              {/* Custom Item input */}
              <div className="border-t border-white/5 pt-4">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Add Custom Item / Special Request</h3>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Enter item name (e.g. Tomato Sauce, Blue Pen)"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest block mb-1">Qty</label>
                      <input
                        type="number"
                        min="1"
                        value={customQty}
                        onChange={(e) => setCustomQty(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white text-center focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest block mb-1">Unit</label>
                      <select
                        value={customUnit}
                        onChange={(e) => setCustomUnit(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-2 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                      >
                        <option value="pcs">pcs</option>
                        <option value="kg">kg</option>
                        <option value="packet">packet</option>
                        <option value="dozen">dozen</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest block mb-1">Est. Price</label>
                      <input
                        type="number"
                        min="0"
                        value={customPrice}
                        onChange={(e) => setCustomPrice(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white text-center focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                  <button
                    onClick={handleAddCustom}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 text-[10px] font-black uppercase tracking-widest text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/30 transition-all"
                  >
                    + Add to Shopping List
                  </button>
                </div>
              </div>
            </div>

            {/* Shopping List Items */}
            {items.length > 0 && (
              <div className="glass-card p-5 rounded-[28px] border border-white/5 mb-6 animate-in fade-in slide-in-from-bottom-3 duration-300">
                <h2 className="text-xs font-black uppercase tracking-widest text-white mb-4">Your Shopping List ({items.length})</h2>
                <div className="space-y-3 mb-4">
                  {items.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-black/20 p-3 rounded-xl border border-white/5">
                      <div>
                        <p className="text-xs font-black text-white">{item.name}</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{item.quantity} {item.unit} • Est. ₹{item.priceEstimated}/unit</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-black text-emerald-400">₹{item.priceEstimated * item.quantity}</span>
                        <button
                          onClick={() => handleRemoveItem(idx)}
                          className="w-7 h-7 bg-red-500/10 border border-red-500/20 text-red-400 rounded-full flex items-center justify-center hover:bg-red-500 hover:text-white transition-all"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Subtotals */}
                <div className="border-t border-white/5 pt-4 space-y-2 text-xs">
                  <div className="flex justify-between text-gray-400 font-bold">
                    <span>Items Subtotal</span>
                    <span>₹{subtotal}</span>
                  </div>
                  <div className="flex justify-between text-gray-400 font-bold">
                    <span>Personal Shopper Fee</span>
                    <span>₹{shoppingFee}</span>
                  </div>
                  <div className="flex justify-between text-gray-400 font-bold">
                    <span>Hostel Delivery Fee</span>
                    <span>₹{deliveryFee}</span>
                  </div>
                  <div className="flex justify-between text-white font-black border-t border-white/5 pt-2 text-sm">
                    <span>Estimated Total Bill</span>
                    <span className="text-emerald-400">₹{grandTotal}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Delivery address & Payment */}
            <div className="glass-card p-5 rounded-[28px] border border-white/5 mb-6">
              <h2 className="text-xs font-black uppercase tracking-widest text-[#C9A84C] mb-4 font-black">Delivery & Payment Setup</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest block mb-2">Delivery Address (Hostel & Room)</label>
                  <input
                    type="text"
                    placeholder="e.g. Block B, Room 202"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest block mb-2">Payment Method</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setPaymentMethod('COD')}
                      className={`py-3 rounded-xl border text-xs font-black uppercase tracking-widest transition-all ${paymentMethod === 'COD' ? 'bg-white/10 border-emerald-500 text-emerald-400' : 'bg-black/20 border-white/10 text-gray-400'}`}
                    >
                      Cash / COD
                    </button>
                    <button
                      onClick={() => setPaymentMethod('UPI')}
                      className={`py-3 rounded-xl border text-xs font-black uppercase tracking-widest transition-all ${paymentMethod === 'UPI' ? 'bg-white/10 border-emerald-500 text-emerald-400' : 'bg-black/20 border-white/10 text-gray-400'}`}
                    >
                      Pay UPI Advance
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Action button */}
            <button
              onClick={handlePlaceOrder}
              disabled={placing}
              className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-black py-4 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20 transition-all active:scale-95 disabled:opacity-50"
            >
              {placing ? 'Placing Order...' : `Place Shopping Order (Est. ₹${grandTotal})`}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Baskets List View */}
            {selectedBasket ? (
              <div className="animate-in fade-in zoom-in-95 duration-300">
                {/* Back button */}
                <button
                  onClick={() => setSelectedBasket(null)}
                  className="mb-4 text-xs font-black text-emerald-400 uppercase tracking-widest flex items-center gap-1 active:scale-95 transition-all"
                >
                  ← Back to Baskets List
                </button>

                {/* Live Basket Tracking Detail */}
                <div className="glass-card p-5 rounded-[28px] border border-white/5 mb-6">
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Basket Code</p>
                      <h3 className="text-sm font-black text-[#C9A84C] tracking-wide">#{selectedBasket.id.slice(-6).toUpperCase()}</h3>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full animate-pulse">
                      {selectedBasket.status}
                    </span>
                  </div>

                  {/* Status description */}
                  <div className="bg-black/20 border border-white/5 rounded-2xl p-4 mb-6">
                    <p className="text-[8px] font-black uppercase text-secondary-text tracking-[0.2em] mb-1">Operational State</p>
                    <p className="text-xs font-black text-white">{getStatusLabel(selectedBasket.status)}</p>
                    
                    {/* Delivery Partner Assigned */}
                    {selectedBasket.deliveryPartner && (
                      <div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-lg">
                          👤
                        </div>
                        <div>
                          <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Personal Shopper</p>
                          <p className="text-xs font-black text-white">{selectedBasket.deliveryPartner.name}</p>
                          <a href={`tel:${selectedBasket.deliveryPartner.phone}`} className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest mt-0.5 block">Call Rider: {selectedBasket.deliveryPartner.phone}</a>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Verification PIN card */}
                  {getStatusStep(selectedBasket.status) >= getStatusStep('Approved') && (
                    <div className="bg-gradient-to-r from-[#C9A84C]/10 to-[#8B7332]/10 border border-[#C9A84C]/20 rounded-2xl p-4 mb-6 text-center">
                      <p className="text-[8px] font-black uppercase text-[#C9A84C] tracking-widest mb-1">Secure Delivery PIN</p>
                      <p className="text-2xl font-black text-white tracking-[0.3em]">{selectedBasket.deliveryPin}</p>
                      <p className="text-[9px] font-bold text-gray-400 mt-1 uppercase tracking-wide">Provide this to the rider upon delivery</p>
                    </div>
                  )}

                  {/* Price approval section */}
                  {selectedBasket.status === 'PriceApprovalPending' && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 mb-6 animate-in slide-in-from-top-2 duration-300">
                      <p className="text-xs font-black text-amber-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                        <span>🚨</span> Action Required: Price Approval
                      </p>
                      <p className="text-xs text-gray-300 leading-relaxed font-bold mb-4 uppercase tracking-wide">
                        The shopper has uploaded the actual shop prices. Please review the checklist below. The actual total is <span className="text-emerald-400">₹{selectedBasket.actualTotal}</span>.
                      </p>
                      <button
                        onClick={handleApproveBill}
                        disabled={approvingPrice}
                        className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-black font-black uppercase text-[10px] tracking-widest py-3 rounded-xl transition-all active:scale-95"
                      >
                        {approvingPrice ? 'Approving...' : 'Approve Actual Prices & Proceed'}
                      </button>
                    </div>
                  )}

                  {/* Items List / Live Shopping Checklist */}
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A84C] mb-3">Shop Price Checklist</h4>
                  <div className="space-y-2 mb-6">
                    {selectedBasket.items.map((item, idx) => {
                      const isShopping = getStatusStep(selectedBasket.status) >= getStatusStep('Shopping');
                      const actualPrice = item.priceActual !== undefined ? item.priceActual : null;
                      
                      return (
                        <div key={idx} className="flex justify-between items-center bg-black/25 p-3 rounded-xl border border-white/5">
                          <div>
                            <span className={`text-xs font-black ${item.status === 'Unavailable' ? 'line-through text-red-500' : 'text-white'}`}>
                              {item.name}
                            </span>
                            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mt-0.5">
                              Qty: {item.quantity} {item.unit} • Est: ₹{item.priceEstimated}/unit
                            </p>
                          </div>

                          <div className="text-right">
                            {item.status === 'Unavailable' ? (
                              <span className="text-[9px] font-black uppercase tracking-widest text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">Unavailable</span>
                            ) : isShopping && actualPrice !== null ? (
                              <div className="flex flex-col items-end">
                                <span className="text-xs font-black text-emerald-400">Actual: ₹{actualPrice * item.quantity}</span>
                                {actualPrice !== item.priceEstimated && (
                                  <span className={`text-[8px] font-bold ${actualPrice > item.priceEstimated ? 'text-red-400' : 'text-emerald-400'}`}>
                                    {actualPrice > item.priceEstimated ? '↑ Higher' : '↓ Lower'}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs font-black text-gray-400">Est. ₹{item.priceEstimated * item.quantity}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Summary Box */}
                  <div className="border-t border-white/5 pt-4 space-y-2 text-xs">
                    <div className="flex justify-between text-gray-400 font-bold">
                      <span>Shopping & Checkout Fee</span>
                      <span>₹{selectedBasket.shoppingFee}</span>
                    </div>
                    <div className="flex justify-between text-gray-400 font-bold">
                      <span>Hostel Delivery Fee</span>
                      <span>₹{selectedBasket.deliveryFee}</span>
                    </div>
                    <div className="flex justify-between text-white font-black border-t border-white/5 pt-2 text-sm">
                      <span>Grand Total Bill</span>
                      <span className="text-emerald-400">
                        ₹{(selectedBasket.actualTotal || selectedBasket.estimatedTotal) + selectedBasket.shoppingFee + selectedBasket.deliveryFee}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                {/* Active Baskets List */}
                {loadingBaskets && baskets.length === 0 ? (
                  <div className="text-center py-12 text-gray-400 font-bold uppercase tracking-widest text-xs">Loading Baskets...</div>
                ) : baskets.length === 0 ? (
                  <div className="text-center py-16 bg-[#141416]/50 rounded-[28px] border border-white/5">
                    <span className="text-4xl block mb-4">🛒</span>
                    <h3 className="text-sm font-black uppercase tracking-widest text-white mb-2">No Active Baskets</h3>
                    <p className="text-[10px] text-gray-400 font-bold max-w-xs mx-auto leading-relaxed uppercase tracking-wider">You don't have any daily essentials baskets active right now. Switch to 'Create Basket' to request custom items!</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {baskets.map((basket) => (
                      <div
                        key={basket.id}
                        onClick={() => setSelectedBasket(basket)}
                        className="glass-card p-4 rounded-2xl border border-white/5 hover:border-emerald-500/20 hover:bg-white/5 cursor-pointer transition-all active:scale-98"
                      >
                        <div className="flex justify-between items-center mb-2">
                          <h3 className="text-xs font-black text-[#C9A84C] tracking-wide">Basket #{basket.id.slice(-6).toUpperCase()}</h3>
                          <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${basket.status === 'Delivered' ? 'bg-white/10 text-gray-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                            {basket.status}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-gray-300 line-clamp-1 mb-2">
                          {basket.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                        </p>
                        <div className="flex justify-between items-center border-t border-white/5 pt-2 mt-2">
                          <span className="text-[9px] text-gray-500 font-bold">{new Date(basket.createdAt).toLocaleDateString()}</span>
                          <span className="text-xs font-black text-emerald-400">₹{(basket.actualTotal || basket.estimatedTotal) + basket.shoppingFee + basket.deliveryFee}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* UPI Payment Modal */}
      <AnimatePresence>
        {showUpiModal && (
          <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#141416] border border-white/10 p-6 rounded-[32px] w-full max-w-sm text-center"
            >
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-2xl mx-auto mb-4">
                📲
              </div>
              <h3 className="text-sm font-black uppercase tracking-widest text-[#C9A84C] mb-2">Submit UPI Advance Payment</h3>
              <p className="text-[10px] text-gray-400 font-bold max-w-xs mx-auto mb-6 leading-relaxed uppercase tracking-wider">
                Please scan the campus UPI QR to transfer the estimated advance amount of <span className="text-emerald-400">₹{grandTotal}</span>.
              </p>

              {/* UPI QR Mock */}
              <div className="w-48 h-48 mx-auto bg-white rounded-2xl p-3 flex items-center justify-center mb-6 border-2 border-emerald-500/40">
                <img src="/assets/upi_qr.png" alt="UPI QR Scanner" className="w-full h-full object-contain" />
              </div>

              {/* UTR Input */}
              <div className="text-left mb-6">
                <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest block mb-2">12-Digit Transaction Reference (UTR)</label>
                <input
                  type="text"
                  placeholder="e.g. 340590112345"
                  value={upiUTR}
                  onChange={(e) => setUpiUTR(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white text-center tracking-[0.2em] font-black focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowUpiModal(false)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl py-3 text-[10px] font-black uppercase tracking-widest text-gray-400"
                >
                  Pay Later / COD
                </button>
                <button
                  onClick={handleUpiSubmit}
                  className="flex-1 bg-emerald-500 text-black rounded-xl py-3 text-[10px] font-black uppercase tracking-widest"
                >
                  Verify Payment
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main>
  );
}
