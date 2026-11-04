"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { API_URL } from '@/lib/config';
import RiderCashPanel from '@/components/finance/RiderCashPanel';
import PayoutsPanel from '@/components/finance/PayoutsPanel';
import {
  Badge, Button, DataTable, DescriptionList, Drawer, Notice as NoticeBox, PageHeader, SearchInput, StatTile, Tabs, Toolbar,
  useConfirm, type Column, IconDownload, IconRefresh,
} from '@/components/ui';
import { formatDate, formatINR, humanize } from '@/lib/format';

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

const rupees = (n: number | null | undefined) => formatINR(Math.round(Number(n || 0)));
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
      if (d.refundedAt) return { refundable: false, note: `${label}: already refunded to the Wallet on ${formatDate(d.refundedAt)}.` };
      if (d.upiStatus === 'Rejected') return { refundable: false, note: `${label}: payment was rejected, nothing to refund.` };
      // Same rule as the server: only money that was actually received can be refunded.
      if (d.paymentStatus === 'Completed' || d.upiStatus === 'Verified') return { refundable: true, note: `${label}: payment was verified.` };
      return { refundable: false, note: `${label}: payment was never verified, so there is nothing to refund. Verify the payment first if the money did arrive.` };
    }
    default: return { refundable: false, note: 'Unknown payment method.' };
  }
};

export default function FinanceConsole() {
  const { isAuthed } = useAdminAuth();
  const confirm = useConfirm();
  const [openDispute, setOpenDispute] = useState<string | null>(null);
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
    link.download = `zenv_ledger_page${currentPage}_${new Date().toISOString().slice(0, 10)}.csv`;
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

  const handleRefund = async (d: Dispute) => {
    const amount = d.finalPrice ?? d.totalPrice;
    const state = refundState(d);
    if (!(await confirm({ title: `Refund ${rupees(amount)} to ${d.userId?.name || 'the customer'}'s Wallet?`, description: `Order ${shortId(d._id)}. ${state.note} This can only be done once.`, confirmLabel: 'Refund to Wallet', tone: 'danger' }))) return;
    runAction(d._id, async () => {
      const data = await requestJson<{ message?: string; refundAmount?: number }>(`${API_URL}/api/admin/finance/refund/${d._id}`, { method: 'POST' });
      fetchDisputes();
      return `${data?.message || 'Refund successful'}: ${rupees(data?.refundAmount ?? amount)} added to the Wallet (order ${shortId(d._id)}).`;
    });
  };

  if (!isAuthed) return null; // AppShell shows the session check

  const q = search.trim().toLowerCase();
  const filteredTransactions = (report?.transactions || []).filter(tx =>
    !q || String(tx.restaurantName || '').toLowerCase().includes(q) || String(tx.orderId || '').toLowerCase().includes(q)
  );
  const dispute = openDispute ? disputes.find(d => d._id === openDispute) || null : null;
  const refundableCount = disputes.filter(d => refundState(d).refundable).length;

  const ledgerColumns: Column<Transaction>[] = [
    { key: 'order', header: 'Order', width: '110px', cell: tx => <a href={`/orders?order=${encodeURIComponent(tx.orderId)}`} className="font-mono text-xs text-fg-muted hover:text-fg hover:underline">{shortId(tx.orderId)}</a> },
    { key: 'store', header: 'Store', sortValue: tx => tx.restaurantName, cell: tx => <span className="font-medium text-fg">{tx.restaurantName}</span> },
    { key: 'value', header: 'Order value', align: 'right', sortValue: tx => tx.totalAmount, cell: tx => <span className="tabular-nums">{rupees(tx.totalAmount)}</span> },
    { key: 'commission', header: 'Commission', align: 'right', sortValue: tx => tx.commissionEarned, cell: tx => <span className="tabular-nums text-success-text">{rupees(tx.commissionEarned)}</span> },
    { key: 'fee', header: 'Delivery fee', align: 'right', hideBelow: 'lg', sortValue: tx => tx.deliveryFee, cell: tx => <span className="tabular-nums text-fg-muted">{rupees(tx.deliveryFee)}</span> },
    { key: 'date', header: 'Delivered', align: 'right', sortValue: tx => new Date(tx.timestamp), cell: tx => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDate(tx.timestamp)}</span> },
  ];

  const disputeColumns: Column<Dispute>[] = [
    {
      key: 'order',
      header: 'Order',
      cell: d => (
        <div>
          <p className="font-mono text-xs text-fg-muted">{shortId(d._id)}</p>
          <p className="text-xs text-fg-muted">{formatDate(d.createdAt)}</p>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      sortValue: d => d.userId?.name || '',
      cell: d => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{d.userId?.name || 'Customer'}</p>
          <p className="text-xs text-fg-muted">{d.userId?.phone || ''}</p>
        </div>
      ),
    },
    { key: 'reason', header: 'Cancellation reason', hideBelow: 'lg', cell: d => <span className="line-clamp-2 max-w-[320px] text-sm text-fg-muted">{d.cancellationReason || 'No reason recorded.'}</span> },
    { key: 'method', header: 'Payment', cell: d => <span className="text-fg">{d.paymentMethod ? humanize(d.paymentMethod) : '–'}</span> },
    { key: 'value', header: 'Order value', align: 'right', sortValue: d => d.finalPrice ?? d.totalPrice, cell: d => <span className="tabular-nums">{rupees(d.finalPrice ?? d.totalPrice)}</span> },
    {
      key: 'refund',
      header: 'Refund',
      align: 'right',
      sortValue: d => (refundState(d).refundable ? 0 : d.refundedAt ? 1 : 2),
      cell: d => {
        const st = refundState(d);
        if (d.refundedAt) return <Badge tone="success">Refunded</Badge>;
        if (st.refundable) return <Button size="sm" variant="primary" disabled={actionLoading !== null} loading={actionLoading === d._id} onClick={() => handleRefund(d)}>Refund to Wallet</Button>;
        return <span className="text-xs text-fg-muted">Not needed</span>;
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Payments and payouts"
        description="What ZENV earned, what stores and riders are owed, cash riders hold, and refunds for cancelled orders."
        meta={report ? <Badge tone="accent">Commission all time: {rupees(report.totalCommission)}</Badge> : undefined}
      >
        <Tabs
          ariaLabel="Payments sections"
          value={activeTab}
          onChange={setActiveTab}
          tabs={[
            { id: 'ledger', label: 'Ledger' },
            { id: 'payouts', label: 'Payouts' },
            { id: 'cash', label: 'Rider cash' },
            { id: 'disputes', label: 'Cancellations and refunds', count: refundableCount || null, attention: true },
          ]}
        />
      </PageHeader>

      {notice && (
        <NoticeBox tone={notice.kind === 'error' ? 'danger' : 'success'} className="mb-4" onClose={() => setNotice(null)}>
          <span className="text-fg">{notice.text}</span>
        </NoticeBox>
      )}

      {activeTab === 'ledger' && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Delivered order value" value={report ? rupees(report.totalRevenue) : null} hint="Gross merchandise value" loading={reportLoading && !report} />
            <StatTile
              label="Commission"
              value={report ? rupees(report.totalCommission) : null}
              hint={report && (report.commissionEstimatedOrders || 0) > 0 ? `${report.commissionEstimatedOrders} older orders use today’s rate` : 'Fixed per order when delivered'}
              loading={reportLoading && !report}
            />
            <StatTile label="Rider earnings" value={report ? rupees(report.totalRiderEarnings ?? report.totalDeliveryFees) : null} hint="Delivery fee per order, minimum ₹30" loading={reportLoading && !report} />
            <StatTile label="Delivered orders" value={report ? report.total.toLocaleString('en-IN') : null} loading={reportLoading && !report} />
          </div>

          <Toolbar
            end={
              <>
                <Button leftIcon={<IconDownload size={14} />} onClick={exportCSV} disabled={!report || report.transactions.length === 0}>Export page (CSV)</Button>
                <Button leftIcon={<IconRefresh size={14} />} onClick={() => fetchFinanceData(currentPage)} loading={reportLoading}>Refresh</Button>
              </>
            }
          >
            <SearchInput value={search} onChange={setSearch} placeholder="Filter this page by store or order" className="sm:w-72" />
          </Toolbar>
          <DataTable
            caption="Delivered orders"
            columns={ledgerColumns}
            rows={filteredTransactions}
            rowKey={tx => tx._id}
            loading={reportLoading}
            error={reportError}
            onRetry={() => fetchFinanceData(currentPage)}
            pagination={report ? { page: currentPage, pages: Math.max(1, report.pages), total: report.total, onPage: p => fetchFinanceData(p) } : undefined}
            noun="orders"
            empty={{ title: q ? 'No orders on this page match' : 'No delivered orders yet' }}
          />
        </>
      )}

      {activeTab === 'payouts' && <PayoutsPanel />}

      {activeTab === 'cash' && <RiderCashPanel />}

      {activeTab === 'disputes' && (
        <>
          <Toolbar end={<Button leftIcon={<IconRefresh size={14} />} onClick={fetchDisputes} loading={disputesLoading}>Refresh</Button>}>
            <p className="max-w-3xl text-sm text-fg-muted">Wallet orders are refunded automatically when cancelled and cash orders need no refund. Manual refunds are only for older UPI and card orders.</p>
          </Toolbar>
          <DataTable
            caption="Cancelled orders"
            columns={disputeColumns}
            rows={disputes}
            rowKey={d => d._id}
            loading={disputesLoading}
            error={disputesError}
            onRetry={fetchDisputes}
            onRowClick={d => setOpenDispute(d._id)}
            noun="orders"
            empty={{ title: 'No cancelled orders' }}
          />
        </>
      )}

      <Drawer
        open={!!dispute}
        onClose={() => setOpenDispute(null)}
        size="md"
        title={dispute ? `Cancelled order ${shortId(dispute._id)}` : 'Cancelled order'}
        description={dispute ? `Placed ${formatDate(dispute.createdAt)}` : undefined}
        footer={dispute && refundState(dispute).refundable && !dispute.refundedAt ? (
          <Button variant="primary" disabled={actionLoading !== null} loading={actionLoading === dispute._id} onClick={() => handleRefund(dispute)}>Refund to Wallet</Button>
        ) : undefined}
      >
        {dispute && (
          <div className="space-y-5">
            <DescriptionList
              columns={2}
              items={[
                { label: 'Customer', value: <>{dispute.userId?.name || 'Customer'}<span className="block text-fg-muted">{dispute.userId?.phone || ''}</span></> },
                { label: 'Order value', value: rupees(dispute.finalPrice ?? dispute.totalPrice) },
                { label: 'Payment', value: dispute.paymentMethod ? humanize(dispute.paymentMethod) : '–' },
                { label: 'Payment status', value: dispute.paymentStatus ? humanize(dispute.paymentStatus) : '–' },
              ]}
            />
            <NoticeBox tone="neutral" title="Cancellation reason">{dispute.cancellationReason || 'No reason recorded.'}</NoticeBox>
            <NoticeBox tone={refundState(dispute).refundable ? 'warning' : 'info'} title="Refund">{refundState(dispute).note}</NoticeBox>
            <a href={`/orders?order=${encodeURIComponent(dispute._id)}`} className="inline-block text-sm text-accent-text hover:underline">Open the order</a>
          </div>
        )}
      </Drawer>
    </div>
  );
}
