"use client";
import React, { useState, useEffect, memo } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

interface Transaction {
  _id: string;
  orderId: string;
  restaurantName: string;
  totalAmount: number;
  commissionEarned: number;
  deliveryFee: number;
  timestamp: string;
}

interface Payout {
  restaurantId: string;
  restaurantName: string;
  vendorType: string;
  totalOrders: number;
  totalGMV: number;
  totalCommission: number;
  netPayout: number;
}

interface Dispute {
  _id: string;
  userId: { name: string; phone: string };
  restaurantId: string;
  totalPrice: number;
  finalPrice?: number;
  status: string;
  cancellationReason?: string;
  createdAt: string;
}

const TransactionRow = memo(({ tx }: { tx: Transaction }) => (
  <tr className="hover:bg-white/[0.02] transition-colors group">
    <td className="px-8 py-6 text-xs font-mono text-blue-500/80 group-hover:text-blue-400">#TR-{tx.orderId.slice(-6).toUpperCase()}</td>
    <td className="px-8 py-6 text-sm font-bold text-white uppercase tracking-tight">{tx.restaurantName}</td>
    <td className="px-8 py-6 text-sm font-black text-white">₹{tx.totalAmount}</td>
    <td className="px-8 py-6">
      <div className="flex flex-col">
         <span className="text-sm font-black text-emerald-400">₹{tx.commissionEarned + tx.deliveryFee}</span>
         <span className="text-[8px] text-gray-500 font-bold uppercase tracking-widest">₹{tx.commissionEarned} comm + ₹{tx.deliveryFee} fee</span>
      </div>
    </td>
    <td className="px-8 py-6 text-[10px] text-gray-500 font-bold uppercase tracking-widest">{new Date(tx.timestamp).toLocaleDateString()}</td>
  </tr>
));
TransactionRow.displayName = 'TransactionRow';

export default function FinanceConsole() {
  const isAuthed = useAdminAuth();
  const [activeTab, setActiveTab] = useState<'ledger' | 'payouts' | 'disputes'>('ledger');
  
  const [report, setReport] = useState<{ transactions: Transaction[], totalRevenue: number, totalCommission: number, totalDeliveryFees: number, total: number, pages: number } | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const exportCSV = () => {
    if (!report) return;
    const headers = ['Trace ID', 'Origin Partner', 'Total GMV', 'Admin Take', 'Date'];
    const rows = report.transactions.map(tx => [
      `TR-${tx.orderId.slice(-6).toUpperCase()}`,
      tx.restaurantName,
      tx.totalAmount,
      tx.commissionEarned + tx.deliveryFee,
      new Date(tx.timestamp).toLocaleDateString()
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "zenvy_finance_ledger.csv");
    document.body.appendChild(link);
    link.click();
  };

  useEffect(() => {
    fetchFinanceData(1);
    fetchPayouts();
    fetchDisputes();
  }, []);

  const fetchFinanceData = async (page = 1) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/admin/finance?page=${page}`, { credentials: 'include' });
      if (res.ok) {
        setReport(await res.json());
        setCurrentPage(page);
      }
    } catch (err) {
      console.error('[FINANCE_FETCH_ERROR]', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPayouts = async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/finance/payouts`, { credentials: 'include' });
      if (res.ok) setPayouts(await res.json());
    } catch (err) { console.error(err); }
  };

  const fetchDisputes = async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/finance/disputes`, { credentials: 'include' });
      if (res.ok) setDisputes(await res.json());
    } catch (err) { console.error(err); }
  };

  const handleRefund = async (orderId: string) => {
    if (!confirm('Are you sure you want to refund this order back to the user wallet?')) return;
    try {
      setActionLoading(orderId);
      const res = await fetch(`${API_URL}/api/admin/finance/refund/${orderId}`, { method: 'POST', credentials: 'include' });
      if (res.ok) {
        alert('Refund processed successfully.');
        fetchDisputes();
      } else {
        const err = await res.json();
        alert(`Refund failed: ${err.message}`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleMarkSettled = (restId: string) => {
    alert(`Payout marked as settled for node: ${restId}. (Mock Action)`);
  };

  if (!isAuthed) return <div className="p-20 text-center font-black text-white uppercase tracking-widest animate-pulse">Authenticating...</div>;

  const filteredTransactions = report?.transactions.filter(tx => 
    tx.restaurantName.toLowerCase().includes(search.toLowerCase()) ||
    tx.orderId.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <div className="space-y-10 animate-fade-in relative pb-20">
      <header className="flex justify-between items-center bg-white/5 p-8 rounded-[40px] border border-white/5 glass">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase">Nexus <span className="text-emerald-500">Finance</span> Trace</h2>
          <p className="text-gray-400 text-sm font-bold uppercase tracking-widest mt-1">Revenue Splitting & Tactical Income Tracing</p>
        </div>
        <div className="flex gap-4">
            <div className="glass px-10 py-4 rounded-3xl border border-white/10 flex flex-col">
               <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest mb-1">Total Admin Take</span>
               <span className="text-3xl font-black text-white tracking-tighter">₹{( (report?.totalCommission || 0) + (report?.totalDeliveryFees || 0) ).toLocaleString()}</span>
            </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-white/10 pb-4">
        {[
          { id: 'ledger', label: 'Global Ledger' },
          { id: 'payouts', label: 'Partner Payouts' },
          { id: 'disputes', label: 'Disputes & Refunds' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
              activeTab === tab.id 
                ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]' 
                : 'bg-white/5 text-gray-500 hover:text-white hover:bg-white/10'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'ledger' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="glass-card p-8 bg-blue-600/5">
              <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-2">Ecosystem GMV</p>
              <h4 className="text-2xl font-black text-white">₹{report?.totalRevenue.toLocaleString() || '0'}</h4>
            </div>
            <div className="glass-card p-8 bg-emerald-600/5">
              <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mb-2">Active Commission</p>
              <h4 className="text-2xl font-black text-white">₹{report?.totalCommission.toLocaleString() || '0'}</h4>
            </div>
            <div className="glass-card p-8 bg-[#C9A84C]/5">
              <p className="text-[9px] font-black text-[#C9A84C] uppercase tracking-widest mb-2">Delivery Fees</p>
              <h4 className="text-2xl font-black text-white">₹{report?.totalDeliveryFees.toLocaleString() || '0'}</h4>
            </div>
            <div className="glass-card p-8 bg-white/5">
              <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-2">Status</p>
              <h4 className="text-2xl font-black text-white uppercase">Live Trace</h4>
            </div>
          </div>

          <div className="glass-card overflow-hidden">
            <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
              <h4 className="text-lg font-black text-white uppercase tracking-tight">Income Transaction Log</h4>
              <div className="flex gap-4">
                  <input 
                    type="text" 
                    placeholder="Search Trace ID or Partner..." 
                    className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white outline-none focus:border-blue-500/40"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <button 
                    onClick={exportCSV}
                    className="nexus-badge bg-emerald-500/10 border-emerald-500/20 text-emerald-400 px-6 py-2 hover:bg-emerald-500/20 transition-all font-black"
                  >
                    📥 EXPORT LEDGER
                  </button>
                  <button 
                    onClick={() => fetchFinanceData(currentPage)}
                    className="nexus-badge bg-blue-500/10 border-blue-500/20 text-blue-400 px-6 py-2 hover:bg-blue-500/20 transition-all font-black"
                  >
                    RE-SCAN FLOWS
                  </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/[0.03]">
                    <th className="px-8 py-4 text-[9px] font-black text-gray-500 uppercase tracking-widest border-b border-white/5">Trace ID</th>
                    <th className="px-8 py-4 text-[9px] font-black text-gray-500 uppercase tracking-widest border-b border-white/5">Origin Partner</th>
                    <th className="px-8 py-4 text-[9px] font-black text-gray-500 uppercase tracking-widest border-b border-white/5">Total GMV</th>
                    <th className="px-8 py-4 text-[9px] font-black text-gray-500 uppercase tracking-widest border-b border-white/5">Admin Take (Comm + Fee)</th>
                    <th className="px-8 py-4 text-[9px] font-black text-gray-500 uppercase tracking-widest border-b border-white/5">Settled Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.02]">
                  {loading ? (
                    <tr><td colSpan={5} className="py-20 text-center text-gray-600 animate-pulse font-black uppercase tracking-widest">Tracing Monetary Flows...</td></tr>
                  ) : filteredTransactions.length === 0 ? (
                    <tr><td colSpan={5} className="py-20 text-center text-gray-500 uppercase font-black text-xs tracking-widest">Zero Settled Flows Detected</td></tr>
                  ) : filteredTransactions.map((tx) => (
                    <TransactionRow key={tx._id} tx={tx} />
                  ))}
                </tbody>
              </table>
            </div>

            {report && report.pages > 1 && (
              <div className="p-6 bg-white/[0.03] border-t border-white/5 flex items-center justify-between">
                <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Ledger Page {currentPage} / {report.pages} ({report.total} flows)
                </span>
                <div className="flex gap-2">
                  <button disabled={currentPage === 1} onClick={() => fetchFinanceData(currentPage - 1)} className="px-5 py-2 bg-black/40 border border-white/10 rounded-xl text-[10px] font-black uppercase text-gray-400 hover:text-white disabled:opacity-30">Prev</button>
                  <button disabled={currentPage === report.pages} onClick={() => fetchFinanceData(currentPage + 1)} className="px-5 py-2 bg-black/40 border border-white/10 rounded-xl text-[10px] font-black uppercase text-gray-400 hover:text-white disabled:opacity-30">Next</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'payouts' && (
        <div className="glass-card overflow-hidden">
          <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
            <h4 className="text-lg font-black text-white uppercase tracking-tight">Partner Settlement Calculator</h4>
            <button onClick={fetchPayouts} className="px-4 py-2 bg-blue-500/10 text-blue-400 rounded-xl text-[10px] font-black uppercase">↻ Re-Calculate</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/[0.03]">
                  <th className="px-8 py-4 text-[9px] font-black text-gray-500 uppercase tracking-widest border-b border-white/5">Restaurant Node</th>
                  <th className="px-8 py-4 text-[9px] font-black text-gray-500 uppercase tracking-widest border-b border-white/5">Total Orders</th>
                  <th className="px-8 py-4 text-[9px] font-black text-gray-500 uppercase tracking-widest border-b border-white/5">Total GMV</th>
                  <th className="px-8 py-4 text-[9px] font-black text-gray-500 uppercase tracking-widest border-b border-white/5">Zenvy Comm.</th>
                  <th className="px-8 py-4 text-[9px] font-black text-blue-400 uppercase tracking-widest border-b border-white/5">Net Payout Owed</th>
                  <th className="px-8 py-4 text-[9px] font-black text-gray-500 uppercase tracking-widest border-b border-white/5">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.02]">
                {payouts.length === 0 ? (
                  <tr><td colSpan={6} className="py-10 text-center text-gray-500 text-xs italic">No payouts generated yet.</td></tr>
                ) : payouts.map(p => (
                  <tr key={p.restaurantId} className="hover:bg-white/[0.02]">
                    <td className="px-8 py-4 text-sm font-bold text-white">{p.restaurantName} <span className="block text-[8px] text-gray-500 uppercase">{p.vendorType}</span></td>
                    <td className="px-8 py-4 text-sm text-gray-300 font-mono">{p.totalOrders}</td>
                    <td className="px-8 py-4 text-sm text-gray-300 font-mono">₹{p.totalGMV}</td>
                    <td className="px-8 py-4 text-sm text-red-400 font-mono">-₹{p.totalCommission}</td>
                    <td className="px-8 py-4 text-lg font-black text-emerald-400">₹{p.netPayout}</td>
                    <td className="px-8 py-4">
                      <button onClick={() => handleMarkSettled(p.restaurantId)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[9px] font-black uppercase">Mark Settled</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'disputes' && (
        <div className="glass-card overflow-hidden">
          <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
            <h4 className="text-lg font-black text-white uppercase tracking-tight">Disputes & Wallet Refunds</h4>
            <button onClick={fetchDisputes} className="px-4 py-2 bg-blue-500/10 text-blue-400 rounded-xl text-[10px] font-black uppercase">↻ Refresh Disputes</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
            {disputes.length === 0 ? (
              <div className="col-span-full py-10 text-center text-gray-500 text-xs italic">No cancelled orders requiring action.</div>
            ) : disputes.map(d => (
              <div key={d._id} className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <span className="text-[10px] font-mono text-gray-400">#{d._id.slice(-6).toUpperCase()}</span>
                    <span className="text-[8px] bg-red-500/20 text-red-400 px-2 py-1 rounded uppercase font-black">Cancelled</span>
                  </div>
                  <h5 className="text-white font-bold">{d.userId?.name || 'Unknown User'}</h5>
                  <p className="text-xs text-gray-500">{d.userId?.phone}</p>
                  <div className="mt-4 p-3 bg-red-500/5 rounded-lg border border-red-500/10">
                    <p className="text-[9px] text-red-400 font-black uppercase mb-1">Cancellation Reason</p>
                    <p className="text-xs text-gray-300">{d.cancellationReason || 'No reason provided by node.'}</p>
                  </div>
                </div>
                <div className="mt-6 flex items-center justify-between pt-4 border-t border-white/5">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-gray-500 uppercase">Refund Value</span>
                    <span className="text-lg font-black text-emerald-400">₹{d.finalPrice || d.totalPrice}</span>
                  </div>
                  <button 
                    onClick={() => handleRefund(d._id)}
                    disabled={actionLoading === d._id}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-[9px] font-black uppercase disabled:opacity-40"
                  >
                    {actionLoading === d._id ? 'Processing...' : 'Process Refund'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
