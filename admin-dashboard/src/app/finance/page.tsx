"use client";
import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { API_URL } from '@/lib/config';
import RiderCashPanel from '@/components/finance/RiderCashPanel';
import PayoutsPanel from '@/components/finance/PayoutsPanel';

// ─── Types (GET /api/admin/finance, /finance/payouts, /finance/disputes) ───
interface Transaction {
  _id: string;
  orderId: string;
  restaurantName: string;
  totalAmount: number;
  commissionEarned: number;
  deliveryFee: number;
  timestamp: string;
}

interface FinanceReport {
  transactions: Transaction[];
  totalRevenue: number;
  totalCommission: number;
  totalDeliveryFees: number;
  /** C6: one earnings rule (delivery fee, ₹30 when it is 0). */
  totalRiderEarnings?: number;
  /** C6: delivered orders without a commission snapshot (settled before C6; current rate shown). */
  commissionEstimatedOrders?: number;
  total: number;
  pages: number;
}

interface Dispute {
  _id: string;
  userId?: { name?: string; phone?: string } | null;
  totalPrice: number;
  finalPrice?: number | null;
  status: string;
  paymentMethod?: string;
  paymentStatus?: string;
  upiStatus?: string | null;
  cancellationReason?: string | null;
  /** Set once a manual refund has been paid (the server refuses a second one). */
  refundedAt?: string | null;
  createdAt: string;
}

type Tab = 'ledger' | 'payouts' | 'cash' | 'disputes';
type Notice = { kind: 'success' | 'error'; text: string } | null;

const rupees = (n: number | null | undefined) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`;
const shortId = (id: string) => `#${String(id || '').slice(-6).toUpperCase()}`;

/** fetch + JSON with friendly errors (never shows raw server internals). */
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', ...init });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = res.status < 500 && body && typeof body.message === 'string' ? body.message : null;
    throw new Error(msg || (res.status >= 500 ? 'The server ran into a problem. Please try again.' : `Request failed (${res.status}).`));
  }
  return body as T;
}

const csvCell = (v: unknown) => {
  let s = String(v ?? '');
  // Spreadsheet formula injection: a store name like "=HYPERLINK(...)" must stay plain text in Excel / Sheets.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** How a cancelled order is (or is not) refunded under the COD + Wallet model. */
const PAY_METHODS: Record<string, string> = { cod: 'COD', wallet: 'Wallet', upi: 'UPI', card: 'Card' };
const refundState = (d: Dispute): { refundable: boolean; note: string } => {
  // Older rows store the method in lower case ('cod'): they showed "Unknown payment method".
  const method = PAY_METHODS[String(d.paymentMethod || '').toLowerCase()] || d.paymentMethod;
  switch (method) {
    case 'COD': return { refundable: false, note: 'Cash on Delivery: nothing was paid, no refund needed.' };
    case 'Wallet': return { refundable: false, note: 'Wallet: refunded automatically when the order was cancelled.' };
    case 'UPI':
    case 'Card': {
      const label = method === 'UPI' ? 'Legacy UPI' : 'Legacy card';
      if (d.refundedAt) return { refundable: false, note: `${label}: already refunded to the Wallet on ${new Date(d.refundedAt).toLocaleDateString()}.` };
      if (d.upiStatus === 'Rejected') return { refundable: false, note: `${label}: payment was rejected, nothing to refund.` };
      // Same rule as the server: only money that was actually received can be refunded.
      if (d.paymentStatus === 'Completed' || d.upiStatus === 'Verified') return { refundable: true, note: `${label}: payment was verified.` };
      return { refundable: false, note: `${label}: payment was never verified, so there is nothing to refund. Verify the payment first if the money did arrive.` };
    }
    default: return { refundable: false, note: 'Unknown payment method.' };
  }
};

const TransactionRow = memo(({ tx }: { tx: Transaction }) => (
  <tr className="hover:bg-white/[0.02] transition-colors">
    <td className="px-8 py-5 text-xs font-mono text-gray-400">{shortId(tx.orderId)}</td>
    <td className="px-8 py-5 text-sm font-bold text-white">{tx.restaurantName}</td>
    <td className="px-8 py-5 text-sm font-black text-white">{rupees(tx.totalAmount)}</td>
    <td className="px-8 py-5 text-sm font-black text-emerald-400">{rupees(tx.commissionEarned)}</td>
    <td className="px-8 py-5 text-sm text-gray-300">{rupees(tx.deliveryFee)}</td>
    <td className="px-8 py-5 text-[10px] text-gray-500 font-bold">{new Date(tx.timestamp).toLocaleDateString()}</td>
  </tr>
));
TransactionRow.displayName = 'TransactionRow';

const SectionState = ({ loading, error, onRetry, empty, emptyText, colSpan }: {
  loading: boolean; error: string | null; onRetry: () => void; empty: boolean; emptyText: string; colSpan?: number;
}) => {
  const body = loading
    ? <p className="text-gray-500 animate-pulse font-black uppercase tracking-widest text-xs">Loading…</p>
    : error
      ? (<><p className="text-xs text-red-400 font-bold">{error}</p><button onClick={onRetry} className="mt-3 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase text-gray-300 hover:text-white">Try again</button></>)
      : empty ? <p className="text-gray-500 text-xs">{emptyText}</p> : null;
  if (!body) return null;
  return colSpan
    ? <tr><td colSpan={colSpan} className="py-16 text-center">{body}</td></tr>
    : <div className="col-span-full py-16 text-center">{body}</div>;
};

export default function FinanceConsole() {
  const { isAuthed } = useAdminAuth();
  const [activeTab, setActiveTab] = useState<Tab>('ledger');

  const [report, setReport] = useState<FinanceReport | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);


  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [disputesLoading, setDisputesLoading] = useState(true);
  const [disputesError, setDisputesError] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [search, setSearch] = useState('');

  const fetchFinanceData = useCallback(async (page = 1) => {
    setReportLoading(true);
    try {
      const data = await requestJson<FinanceReport>(`${API_URL}/api/admin/finance?page=${page}`);
      setReport({ ...data, transactions: Array.isArray(data.transactions) ? data.transactions : [] });
      setCurrentPage(page);
      setReportError(null);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'Could not load the ledger.');
    } finally {
      setReportLoading(false);
    }
  }, []);

  const fetchDisputes = useCallback(async () => {
    setDisputesLoading(true);
    try {
      const data = await requestJson<Dispute[]>(`${API_URL}/api/admin/finance/disputes`);
      setDisputes(Array.isArray(data) ? data : []);
      setDisputesError(null);
    } catch (err) {
      setDisputesError(err instanceof Error ? err.message : 'Could not load cancelled orders.');
    } finally {
      setDisputesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    fetchFinanceData(1);
    fetchDisputes();
  }, [isAuthed, fetchFinanceData, fetchDisputes]);

  const exportCSV = () => {
    if (!report || report.transactions.length === 0) return;
    const headers = ['Order', 'Store', 'Order value (INR)', 'Commission (INR)', 'Delivery fee (INR)', 'Date'];
    const rows = report.transactions.map(tx => [
      shortId(tx.orderId), tx.restaurantName, tx.totalAmount, tx.commissionEarned, tx.deliveryFee,
      // toISOString() throws on an invalid date, which would abort the whole export.
      (() => { const d = new Date(tx.timestamp); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); })(),
    ]);
    const csv = [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `zenvy_ledger_page${currentPage}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const runAction = async (key: string, fn: () => Promise<string>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setActionLoading(key);
    try {
      const msg = await fn();
      setNotice({ kind: 'success', text: msg });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Action failed.' });
    } finally {
      inFlight.current = false;
      setActionLoading(null);
    }
  };

  const handleRefund = (d: Dispute) => {
    const amount = d.finalPrice ?? d.totalPrice;
    const state = refundState(d);
    if (!confirm(`Refund ${rupees(amount)} to ${d.userId?.name || 'the customer'}'s Zenvy Wallet for order ${shortId(d._id)}?\n\n${state.note}\nThis can only be done once.`)) return;
    runAction(d._id, async () => {
      const data = await requestJson<{ message?: string; refundAmount?: number }>(`${API_URL}/api/admin/finance/refund/${d._id}`, { method: 'POST' });
      fetchDisputes();
      return `${data?.message || 'Refund successful'}: ${rupees(data?.refundAmount ?? amount)} added to the Wallet (order ${shortId(d._id)}).`;
    });
  };

  if (!isAuthed) return <div className="p-20 text-center font-black text-white uppercase tracking-widest animate-pulse">Checking access…</div>;

  const q = search.trim().toLowerCase();
  const filteredTransactions = (report?.transactions || []).filter(tx =>
    !q || String(tx.restaurantName || '').toLowerCase().includes(q) || String(tx.orderId || '').toLowerCase().includes(q)
  );

  return (
    <div className="space-y-10 animate-fade-in relative pb-20">
      <header className="flex flex-wrap justify-between items-center gap-6 bg-white/5 p-8 rounded-[40px] border border-white/5 glass">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase">Finance</h2>
          <p className="text-gray-400 text-sm font-bold uppercase tracking-widest mt-1">Delivered-order ledger, payouts, rider cash and refunds</p>
        </div>
        <div className="glass px-10 py-4 rounded-3xl border border-white/10 flex flex-col">
          <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest mb-1">Platform commission (all time)</span>
          <span className="text-3xl font-black text-white tracking-tighter">{report ? rupees(report.totalCommission) : '—'}</span>
        </div>
      </header>

      {notice && (
        <div className={`p-4 rounded-2xl border text-xs font-bold flex justify-between items-start gap-4 ${notice.kind === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-gray-500 hover:text-white">✕</button>
        </div>
      )}

      <div className="flex gap-4 border-b border-white/10 pb-4">
        {([
          { id: 'ledger', label: 'Ledger' },
          { id: 'payouts', label: 'Payouts' },
          { id: 'cash', label: 'Rider cash' },
          { id: 'disputes', label: 'Cancellations & refunds' },
        ] as { id: Tab; label: string }[]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab.id ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-500 hover:text-white hover:bg-white/10'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'ledger' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="glass-card p-8 bg-blue-600/5">
              <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-2">Delivered order value (GMV)</p>
              <h4 className="text-2xl font-black text-white">{report ? rupees(report.totalRevenue) : '—'}</h4>
            </div>
            <div className="glass-card p-8 bg-emerald-600/5">
              <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mb-2">Commission</p>
              <h4 className="text-2xl font-black text-white">{report ? rupees(report.totalCommission) : '—'}</h4>
              {report && (report.commissionEstimatedOrders || 0) > 0 && <p className="text-[10px] text-gray-500 mt-1">Fixed per order; {report.commissionEstimatedOrders} older settled order(s) use today&apos;s rate.</p>}
            </div>
            <div className="glass-card p-8 bg-[var(--zenvy-gold)]/5">
              <p className="text-[9px] font-black text-[var(--zenvy-gold)] uppercase tracking-widest mb-2">Rider earnings</p>
              <h4 className="text-2xl font-black text-white">{report ? rupees(report.totalRiderEarnings ?? report.totalDeliveryFees) : '—'}</h4>
            </div>
            <div className="glass-card p-8 bg-white/5">
              <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-2">Delivered orders</p>
              <h4 className="text-2xl font-black text-white">{report ? report.total.toLocaleString('en-IN') : '—'}</h4>
            </div>
          </div>

          <div className="glass-card overflow-hidden">
            <div className="p-8 border-b border-white/5 flex flex-wrap gap-4 justify-between items-center bg-white/[0.01]">
              <h4 className="text-lg font-black text-white uppercase tracking-tight">Delivered orders</h4>
              <div className="flex flex-wrap gap-3">
                <input
                  type="text"
                  placeholder="Filter this page by store or order…"
                  className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs text-white outline-none focus:border-blue-500/40 w-64"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button
                  onClick={exportCSV}
                  disabled={!report || report.transactions.length === 0}
                  className="nexus-badge bg-emerald-500/10 border-emerald-500/20 text-emerald-400 px-6 py-2 hover:bg-emerald-500/20 transition-all font-black disabled:opacity-30"
                >
                  Export page (CSV)
                </button>
                <button
                  onClick={() => fetchFinanceData(currentPage)}
                  disabled={reportLoading}
                  className="nexus-badge bg-blue-500/10 border-blue-500/20 text-blue-400 px-6 py-2 hover:bg-blue-500/20 transition-all font-black disabled:opacity-30"
                >
                  ↻ Refresh
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/[0.03]">
                    {['Order', 'Store', 'Order value', 'Commission', 'Delivery fee', 'Date'].map(h => (
                      <th key={h} className="px-8 py-4 text-[9px] font-black text-gray-500 uppercase tracking-widest border-b border-white/5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.02]">
                  <SectionState
                    colSpan={6}
                    loading={reportLoading}
                    error={reportError}
                    onRetry={() => fetchFinanceData(currentPage)}
                    empty={filteredTransactions.length === 0}
                    emptyText={q ? 'No orders on this page match the filter.' : 'No delivered orders yet.'}
                  />
                  {!reportLoading && !reportError && filteredTransactions.map(tx => <TransactionRow key={tx._id} tx={tx} />)}
                </tbody>
              </table>
            </div>

            {report && report.pages > 1 && (
              <div className="p-6 bg-white/[0.03] border-t border-white/5 flex items-center justify-between">
                <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Page {currentPage} of {report.pages} ({report.total} orders)
                </span>
                <div className="flex gap-2">
                  <button disabled={currentPage <= 1 || reportLoading} onClick={() => fetchFinanceData(currentPage - 1)} className="px-5 py-2 bg-black/40 border border-white/10 rounded-xl text-[10px] font-black uppercase text-gray-400 hover:text-white disabled:opacity-30">Prev</button>
                  <button disabled={currentPage >= report.pages || reportLoading} onClick={() => fetchFinanceData(currentPage + 1)} className="px-5 py-2 bg-black/40 border border-white/10 rounded-xl text-[10px] font-black uppercase text-gray-400 hover:text-white disabled:opacity-30">Next</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'payouts' && <PayoutsPanel />}

      {activeTab === 'cash' && <RiderCashPanel />}

      {activeTab === 'disputes' && (
        <div className="glass-card overflow-hidden">
          <div className="p-8 border-b border-white/5 flex flex-wrap gap-4 justify-between items-center bg-white/[0.01]">
            <div>
              <h4 className="text-lg font-black text-white uppercase tracking-tight">Cancelled orders</h4>
              <p className="text-[11px] text-gray-500 mt-1">Wallet orders are refunded automatically on cancel and COD orders need no refund. Manual refunds are only for legacy UPI/card orders.</p>
            </div>
            <button onClick={fetchDisputes} disabled={disputesLoading} className="px-4 py-2 bg-blue-500/10 text-blue-400 rounded-xl text-[10px] font-black uppercase disabled:opacity-30">↻ Refresh</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
            <SectionState loading={disputesLoading} error={disputesError} onRetry={fetchDisputes} empty={disputes.length === 0} emptyText="No cancelled orders." />
            {!disputesLoading && !disputesError && disputes.map(d => {
              const state = refundState(d);
              return (
                <div key={d._id} className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <span className="text-[10px] font-mono text-gray-400">{shortId(d._id)} · {new Date(d.createdAt).toLocaleDateString()}</span>
                      <span className="text-[8px] bg-white/5 text-gray-300 px-2 py-1 rounded uppercase font-black">{d.paymentMethod || '—'}</span>
                    </div>
                    <h5 className="text-white font-bold">{d.userId?.name || 'Customer'}</h5>
                    <p className="text-xs text-gray-500">{d.userId?.phone || ''}</p>
                    <div className="mt-4 p-3 bg-red-500/5 rounded-lg border border-red-500/10">
                      <p className="text-[9px] text-red-400 font-black uppercase mb-1">Cancellation reason</p>
                      <p className="text-xs text-gray-300">{d.cancellationReason || 'No reason recorded.'}</p>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-3">{state.note}</p>
                  </div>
                  <div className="mt-6 flex items-center justify-between pt-4 border-t border-white/5">
                    <div className="flex flex-col">
                      <span className="text-[9px] font-black text-gray-500 uppercase">Order value</span>
                      <span className="text-lg font-black text-white">{rupees(d.finalPrice ?? d.totalPrice)}</span>
                    </div>
                    {d.refundedAt && <span className="text-[9px] font-black uppercase text-emerald-400">Refunded</span>}
                    {state.refundable && (
                      <button
                        onClick={() => handleRefund(d)}
                        disabled={actionLoading !== null}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-[9px] font-black uppercase disabled:opacity-40"
                      >
                        {actionLoading === d._id ? 'Refunding…' : 'Refund to Wallet'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
