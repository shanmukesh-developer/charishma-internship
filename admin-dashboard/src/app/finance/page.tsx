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
  <tr className="hover:bg-surface-2/60 transition-colors">
    <td className="px-8 py-5 text-xs font-mono text-fg-muted">{shortId(tx.orderId)}</td>
    <td className="px-8 py-5 text-sm font-semibold text-fg">{tx.restaurantName}</td>
    <td className="px-8 py-5 text-sm font-semibold text-fg">{rupees(tx.totalAmount)}</td>
    <td className="px-8 py-5 text-sm font-semibold text-success-text">{rupees(tx.commissionEarned)}</td>
    <td className="px-8 py-5 text-sm text-fg-muted">{rupees(tx.deliveryFee)}</td>
    <td className="px-8 py-5 text-xs text-fg-muted font-semibold">{new Date(tx.timestamp).toLocaleDateString()}</td>
  </tr>
));
TransactionRow.displayName = 'TransactionRow';

const SectionState = ({ loading, error, onRetry, empty, emptyText, colSpan }: {
  loading: boolean; error: string | null; onRetry: () => void; empty: boolean; emptyText: string; colSpan?: number;
}) => {
  const body = loading
    ? <p className="text-fg-muted animate-pulse font-semibold text-xs">Loading…</p>
    : error
      ? (<><p className="text-xs text-danger-text font-semibold">{error}</p><button onClick={onRetry} className="mt-3 px-4 py-2 bg-surface-2/60 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:text-fg">Try again</button></>)
      : empty ? <p className="text-fg-muted text-xs">{emptyText}</p> : null;
  if (!body) return null;
  return colSpan
    ? <tr><td colSpan={colSpan} className="py-16 text-center">{body}</td></tr>
    : <div className="col-span-full py-16 text-center">{body}</div>;
};

export default function FinanceConsole() {
  const { isAuthed } = useAdminAuth();
  const [activeTab, setActiveTab] = useState<Tab>('ledger');
  // ?tab=<id>: links from the overview's Needs attention list and the global search open the right tab.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && (['ledger', 'payouts', 'cash', 'disputes'] as readonly string[]).includes(t)) setActiveTab(t as Tab);
  }, []);

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

  if (!isAuthed) return <div className="p-20 text-center font-semibold text-fg animate-pulse">Checking access…</div>;

  const q = search.trim().toLowerCase();
  const filteredTransactions = (report?.transactions || []).filter(tx =>
    !q || String(tx.restaurantName || '').toLowerCase().includes(q) || String(tx.orderId || '').toLowerCase().includes(q)
  );

  return (
    <div className="space-y-10 animate-fade-in relative">
      <header className="flex flex-wrap justify-between items-center gap-6">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Payments and payouts</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">Revenue, store and rider payouts, rider cash and disputes.</p>
        </div>
        <div className="bg-surface border border-line px-10 py-4 rounded-lg border border-line flex flex-col">
          <span className="text-xs font-semibold text-info-text mb-1">Platform commission (all time)</span>
          <span className="text-3xl font-semibold text-fg">{report ? rupees(report.totalCommission) : '—'}</span>
        </div>
      </header>

      {notice && (
        <div className={`p-4 rounded-lg border text-xs font-semibold flex justify-between items-start gap-4 ${notice.kind === 'error' ? 'bg-danger-soft border-danger/30 text-danger-text' : 'bg-success-soft border-success/30 text-success-text'}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-fg-muted hover:text-fg" aria-label="Dismiss"><span aria-hidden="true" className="text-base leading-none">×</span></button>
        </div>
      )}

      <div className="flex gap-4 border-b border-line pb-4">
        {([
          { id: 'ledger', label: 'Ledger' },
          { id: 'payouts', label: 'Payouts' },
          { id: 'cash', label: 'Rider cash' },
          { id: 'disputes', label: 'Cancellations & refunds' },
        ] as { id: Tab; label: string }[]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-6 py-3 rounded-lg text-xs font-semibold transition-all ${activeTab === tab.id ? 'bg-accent text-on-solid' : 'bg-surface-2/60 text-fg-muted hover:text-fg hover:bg-surface-2'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'ledger' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="rounded-lg border border-line bg-surface shadow-xs p-8 bg-info-soft">
              <p className="text-xs font-semibold text-info-text mb-2">Delivered order value (GMV)</p>
              <h4 className="text-2xl font-semibold text-fg">{report ? rupees(report.totalRevenue) : '—'}</h4>
            </div>
            <div className="rounded-lg border border-line bg-surface shadow-xs p-8 bg-success-soft">
              <p className="text-xs font-semibold text-success-text mb-2">Commission</p>
              <h4 className="text-2xl font-semibold text-fg">{report ? rupees(report.totalCommission) : '—'}</h4>
              {report && (report.commissionEstimatedOrders || 0) > 0 && <p className="text-xs text-fg-muted mt-1">Fixed per order; {report.commissionEstimatedOrders} older settled order(s) use today&apos;s rate.</p>}
            </div>
            <div className="rounded-lg border border-line bg-surface shadow-xs p-8 bg-accent">
              <p className="text-xs font-semibold text-warning-text mb-2">Rider earnings</p>
              <h4 className="text-2xl font-semibold text-fg">{report ? rupees(report.totalRiderEarnings ?? report.totalDeliveryFees) : '—'}</h4>
            </div>
            <div className="rounded-lg border border-line bg-surface shadow-xs p-8 bg-surface-2/60">
              <p className="text-xs font-semibold text-fg-muted mb-2">Delivered orders</p>
              <h4 className="text-2xl font-semibold text-fg">{report ? report.total.toLocaleString('en-IN') : '—'}</h4>
            </div>
          </div>

          <div className="glass-card overflow-hidden">
            <div className="p-8 border-b border-line flex flex-wrap gap-4 justify-between items-center bg-surface-2/60">
              <h4 className="text-lg font-semibold text-fg">Delivered orders</h4>
              <div className="flex flex-wrap gap-3">
                <input
                  type="text"
                  placeholder="Filter this page by store or order…"
                  className="bg-surface-2/60 border border-line rounded-xl px-4 py-2 text-xs text-fg outline-none focus:border-accent w-64"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button
                  onClick={exportCSV}
                  disabled={!report || report.transactions.length === 0}
                  className="nexus-badge bg-success-soft border-success/30 text-success-text px-6 py-2 hover:bg-success-soft transition-all font-semibold disabled:opacity-30"
                >
                  Export page (CSV)
                </button>
                <button
                  onClick={() => fetchFinanceData(currentPage)}
                  disabled={reportLoading}
                  className="nexus-badge bg-info-soft border-info/30 text-info-text px-6 py-2 hover:bg-info-soft transition-all font-semibold disabled:opacity-30"
                >
                  ↻ Refresh
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-2/60">
                    {['Order', 'Store', 'Order value', 'Commission', 'Delivery fee', 'Date'].map(h => (
                      <th key={h} className="px-8 py-4 text-xs font-semibold text-fg-muted border-b border-line">{h}</th>
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
              <div className="p-6 bg-surface-2/60 border-t border-line flex items-center justify-between">
                <span className="text-xs font-semibold text-fg-muted">
                  Page {currentPage} of {report.pages} ({report.total} orders)
                </span>
                <div className="flex gap-2">
                  <button disabled={currentPage <= 1 || reportLoading} onClick={() => fetchFinanceData(currentPage - 1)} className="px-5 py-2 bg-surface-2 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:text-fg disabled:opacity-30">Prev</button>
                  <button disabled={currentPage >= report.pages || reportLoading} onClick={() => fetchFinanceData(currentPage + 1)} className="px-5 py-2 bg-surface-2 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:text-fg disabled:opacity-30">Next</button>
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
          <div className="p-8 border-b border-line flex flex-wrap gap-4 justify-between items-center bg-surface-2/60">
            <div>
              <h4 className="text-lg font-semibold text-fg">Cancelled orders</h4>
              <p className="text-xs text-fg-muted mt-1">Wallet orders are refunded automatically on cancel and COD orders need no refund. Manual refunds are only for legacy UPI/card orders.</p>
            </div>
            <button onClick={fetchDisputes} disabled={disputesLoading} className="px-4 py-2 bg-info-soft text-info-text rounded-xl text-xs font-semibold disabled:opacity-30">↻ Refresh</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
            <SectionState loading={disputesLoading} error={disputesError} onRetry={fetchDisputes} empty={disputes.length === 0} emptyText="No cancelled orders." />
            {!disputesLoading && !disputesError && disputes.map(d => {
              const state = refundState(d);
              return (
                <div key={d._id} className="p-6 bg-surface-2/60 border border-line rounded-lg flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <span className="text-xs font-mono text-fg-muted">{shortId(d._id)} · {new Date(d.createdAt).toLocaleDateString()}</span>
                      <span className="text-xs bg-surface-2/60 text-fg-muted px-2 py-1 rounded font-semibold">{d.paymentMethod || '—'}</span>
                    </div>
                    <h5 className="text-fg font-semibold">{d.userId?.name || 'Customer'}</h5>
                    <p className="text-xs text-fg-muted">{d.userId?.phone || ''}</p>
                    <div className="mt-4 p-3 bg-danger-soft rounded-lg border border-danger/30">
                      <p className="text-xs text-danger-text font-semibold mb-1">Cancellation reason</p>
                      <p className="text-xs text-fg-muted">{d.cancellationReason || 'No reason recorded.'}</p>
                    </div>
                    <p className="text-xs text-fg-muted mt-3">{state.note}</p>
                  </div>
                  <div className="mt-6 flex items-center justify-between pt-4 border-t border-line">
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-fg-muted">Order value</span>
                      <span className="text-lg font-semibold text-fg">{rupees(d.finalPrice ?? d.totalPrice)}</span>
                    </div>
                    {d.refundedAt && <span className="text-xs font-semibold text-success-text">Refunded</span>}
                    {state.refundable && (
                      <button
                        onClick={() => handleRefund(d)}
                        disabled={actionLoading !== null}
                        className="px-4 py-2 bg-accent hover:bg-accent-hover text-on-solid rounded-xl text-xs font-semibold disabled:opacity-40"
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
