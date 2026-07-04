"use client";

import React, { useState, useEffect, memo } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import api from '@/lib/api';

interface User {
  id: string;
  _id: string;
  name: string;
  phone: string;
  email: string;
}

interface Coupon {
  id: string;
  _id: string;
  code: string;
  type: 'FREEDEL' | 'DISCOUNT';
  value: number;
  userId: string;
  isUsed: boolean;
  expiryDate: string;
  createdAt: string;
  user?: {
    id: string;
    name: string;
    phone: string;
  };
}

export default function CouponManagement() {
  const isAuthed = useAdminAuth();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Form State
  const [code, setCode] = useState('');
  const [type, setType] = useState<'FREEDEL' | 'DISCOUNT'>('FREEDEL');
  const [value, setValue] = useState<number | ''>('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (isAuthed) {
      fetchCoupons();
      fetchUsers();
    }
  }, [isAuthed]);

  const fetchCoupons = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/coupons');
      if (res.data) {
        setCoupons(res.data);
      }
    } catch (err: any) {
      console.error('[COUPON_FETCH_ERROR]', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await api.get('/admin/users?limit=100');
      if (res.data && res.data.users) {
        setUsers(res.data.users);
      }
    } catch (err: any) {
      console.error('[USERS_FETCH_ERROR]', err);
    }
  };

  const generateRandomCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'ZF-';
    for (let i = 0; i < 5; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setCode(result);
  };

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!code.trim()) {
      setErrorMsg('Coupon code is required.');
      return;
    }
    if (!selectedUserId) {
      setErrorMsg('Please select a resident.');
      return;
    }

    try {
      setSubmitLoading(true);
      const payload = {
        code: code.toUpperCase().trim(),
        type,
        value: type === 'DISCOUNT' ? Number(value) : 0,
        userId: selectedUserId,
        expiryDate: expiryDate ? new Date(expiryDate).toISOString() : undefined,
      };

      const res = await api.post('/admin/coupons', payload);
      if (res.data) {
        setSuccessMsg(`Coupon "${res.data.code}" successfully generated!`);
        setCode('');
        setType('FREEDEL');
        setValue('');
        setSelectedUserId('');
        setExpiryDate('');
        setUserSearch('');
        setShowCreateModal(false);
        fetchCoupons();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to generate coupon.');
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleDeleteCoupon = async (couponId: string, couponCode: string) => {
    if (!confirm(`Are you sure you want to revoke coupon "${couponCode}"?`)) return;

    try {
      const res = await api.delete(`/admin/coupons/${couponId}`);
      if (res.data) {
        fetchCoupons();
      }
    } catch (err: any) {
      alert(err.message || 'Failed to revoke coupon.');
    }
  };

  // Filters
  const filteredUsers = users.filter(u =>
    u.name?.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.phone?.toLowerCase().includes(userSearch.toLowerCase())
  );

  if (!isAuthed) return <div className="p-20 text-center font-black text-white uppercase tracking-widest animate-pulse">Authenticating...</div>;

  return (
    <div className="space-y-10 animate-fade-in relative pb-20">
      <header className="flex justify-between items-center bg-white/5 p-8 rounded-[40px] border border-white/5 glass">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase">Coupon <span className="text-blue-500">Registry</span></h2>
          <p className="text-gray-400 text-sm font-bold uppercase tracking-widest mt-1">Generate discounts & delivery incentives for residents</p>
        </div>
        <button
          onClick={() => {
            setShowCreateModal(true);
            generateRandomCode();
            // Default expiry date: 7 days from now
            const defaultExpiry = new Date();
            defaultExpiry.setDate(defaultExpiry.getDate() + 7);
            setExpiryDate(defaultExpiry.toISOString().split('T')[0]);
          }}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-[0_0_20px_rgba(37,99,235,0.4)] transition-all flex items-center gap-2"
        >
          <span>➕</span> Generate Coupon
        </button>
      </header>

      {/* Coupon List Container */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="py-20 text-center animate-pulse text-gray-600 font-black uppercase">Initialising Coupon scan...</div>
        ) : coupons.length === 0 ? (
          <div className="py-20 text-center text-gray-500 font-bold uppercase tracking-wider">No active or used coupons registered in Nexus</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/[0.03] border-b border-white/5">
                  <th className="px-8 py-5 text-[9px] font-black text-gray-500 uppercase tracking-widest">Coupon Code</th>
                  <th className="px-8 py-5 text-[9px] font-black text-gray-500 uppercase tracking-widest">Incentive Type</th>
                  <th className="px-8 py-5 text-[9px] font-black text-gray-500 uppercase tracking-widest">Assigned Resident</th>
                  <th className="px-8 py-5 text-[9px] font-black text-gray-500 uppercase tracking-widest">Expiry Date</th>
                  <th className="px-8 py-5 text-[9px] font-black text-gray-500 uppercase tracking-widest">Status</th>
                  <th className="px-8 py-5 text-[9px] font-black text-gray-500 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.02] text-white">
                {coupons.map((coupon) => {
                  const isExpired = new Date(coupon.expiryDate) < new Date();
                  return (
                    <tr key={coupon.id || coupon._id} className="hover:bg-white/[0.01] transition-all">
                      <td className="px-8 py-5 font-mono text-sm font-black text-blue-400">{coupon.code}</td>
                      <td className="px-8 py-5">
                        <div className="flex flex-col">
                          <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md w-fit ${
                            coupon.type === 'FREEDEL' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          }`}>
                            {coupon.type === 'FREEDEL' ? 'Free Delivery' : 'Discount'}
                          </span>
                          {coupon.type === 'DISCOUNT' && (
                            <span className="text-[11px] text-gray-400 mt-1 font-bold">Value: ₹{coupon.value}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        {coupon.user ? (
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-white">{coupon.user.name}</span>
                            <span className="text-[10px] text-gray-500 font-mono mt-0.5">{coupon.user.phone}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500 italic">Unknown Resident</span>
                        )}
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-gray-300">
                            {new Date(coupon.expiryDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                          <span className="text-[9px] text-gray-500 font-mono mt-0.5">
                            {new Date(coupon.expiryDate).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        {coupon.isUsed ? (
                          <span className="px-2 py-0.5 rounded bg-gray-500/10 text-gray-500 text-[9px] font-black uppercase tracking-wider border border-gray-500/20">Used</span>
                        ) : isExpired ? (
                          <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-500 text-[9px] font-black uppercase tracking-wider border border-red-500/20">Expired</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[9px] font-black uppercase tracking-wider border border-emerald-500/20">Active</span>
                        )}
                      </td>
                      <td className="px-8 py-5 text-right">
                        <button
                          onClick={() => handleDeleteCoupon(coupon.id || coupon._id, coupon.code)}
                          className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white rounded-lg text-[9px] font-black uppercase tracking-widest transition-all"
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal for Coupon Creation */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-[#0D0D15] border border-white/10 rounded-[32px] w-full max-w-xl overflow-hidden glass shadow-[0_0_50px_rgba(0,0,0,0.8)]">
            <header className="px-8 py-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
              <h3 className="text-xl font-black text-white uppercase tracking-tight">Generate Resident Incentive</h3>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setErrorMsg('');
                }}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white flex items-center justify-center text-lg transition-all"
              >
                ✕
              </button>
            </header>

            <form onSubmit={handleCreateCoupon} className="p-8 space-y-6">
              {errorMsg && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-xs font-bold text-red-400">
                  ⚠️ {errorMsg}
                </div>
              )}

              {/* Resident Selector */}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Assign Resident</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search resident by name or phone..."
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-3.5 px-5 text-sm text-white placeholder-gray-600 outline-none focus:border-blue-500/50 transition-all"
                    value={userSearch}
                    onChange={(e) => {
                      setUserSearch(e.target.value);
                      setSelectedUserId('');
                    }}
                  />
                  {userSearch && !selectedUserId && (
                    <div className="absolute left-0 right-0 mt-2 bg-[#0D0D15] border border-white/10 rounded-2xl max-h-48 overflow-y-auto z-50 glass shadow-2xl">
                      {filteredUsers.length === 0 ? (
                        <div className="p-4 text-xs text-gray-500 text-center font-bold">No residents matching search query</div>
                      ) : (
                        filteredUsers.slice(0, 5).map((u) => (
                          <button
                            key={u.id || u._id}
                            type="button"
                            onClick={() => {
                              setSelectedUserId(u.id || u._id);
                              setUserSearch(`${u.name} (${u.phone})`);
                            }}
                            className="w-full text-left px-5 py-3 hover:bg-white/[0.03] text-sm text-white flex justify-between items-center transition-all border-b border-white/5 last:border-0"
                          >
                            <span className="font-bold">{u.name}</span>
                            <span className="text-[10px] text-gray-500 font-mono">{u.phone}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {selectedUserId && (
                  <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider flex items-center gap-1">
                    ✓ Resident locked: {userSearch}
                  </p>
                )}
              </div>

              {/* Coupon Code */}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Coupon Code</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. FLAT100"
                    className="flex-1 bg-white/5 border border-white/10 rounded-2xl py-3.5 px-5 text-sm font-mono text-white placeholder-gray-600 outline-none focus:border-blue-500/50 transition-all uppercase"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={generateRandomCode}
                    className="px-5 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all"
                  >
                    🎲 Auto Gen
                  </button>
                </div>
              </div>

              {/* Coupon Type */}
              <div className="grid grid-cols-2 gap-4">
                <div className={`space-y-2 ${type === 'FREEDEL' ? 'col-span-2' : ''}`}>
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Coupon Type</label>
                  <select
                    className="w-full bg-[#0D0D15] border border-white/10 rounded-2xl py-3.5 px-5 text-sm text-white outline-none focus:border-blue-500/50 transition-all appearance-none cursor-pointer"
                    value={type}
                    onChange={(e) => setType(e.target.value as 'FREEDEL' | 'DISCOUNT')}
                  >
                    <option value="FREEDEL">Free Delivery</option>
                    <option value="DISCOUNT">Rupees Discount</option>
                  </select>
                </div>

                {type === 'DISCOUNT' && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Discount Value (₹)</label>
                    <input
                      type="number"
                      placeholder="e.g. 50"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl py-3.5 px-5 text-sm text-white placeholder-gray-600 outline-none focus:border-blue-500/50 transition-all"
                      value={value}
                      onChange={(e) => setValue(e.target.value ? Number(e.target.value) : '')}
                    />
                  </div>
                )}
              </div>

              {/* Expiry Date */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Expiry Date</label>
                  <div className="flex gap-2">
                    {[1, 3, 7, 30].map(days => (
                      <button
                        key={days}
                        type="button"
                        onClick={() => {
                          const d = new Date();
                          d.setDate(d.getDate() + days);
                          setExpiryDate(d.toISOString().split('T')[0]);
                        }}
                        className="px-2 py-1 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded text-[9px] font-bold transition-all"
                      >
                        +{days}d
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="date"
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-3.5 px-5 text-sm text-white outline-none focus:border-blue-500/50 transition-all"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
              </div>

              {/* Submit Buttons */}
              <div className="flex gap-4 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setErrorMsg('');
                  }}
                  className="flex-1 py-3.5 bg-white/5 hover:bg-white/10 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitLoading}
                  className="flex-1 py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-[0_0_20px_rgba(37,99,235,0.4)] transition-all"
                >
                  {submitLoading ? 'Generating...' : 'Authorize Coupon'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
