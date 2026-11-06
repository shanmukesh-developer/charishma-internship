"use client";
// Revenue (owner, 6 Nov 2026): its own section. For an IST day / week (Mon-Sun) / month: what customers paid
// (COD cash, Wallet, cash stalls took themselves), what ZenWe keeps line by line, what each store is owed from
// the commission fixed when each order was placed, what is already settled, and a reconciliation that must be
// exactly ₹0.00. Settle all creates one statement per store for a cycle (daily / weekly / monthly).
// Backend: GET /api/admin/revenue (routes/revenueRoutes.js; every rule in backend/utils/revenueReport.js).
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminRequest } from '@/lib/api';
import { useAdminAuth } from '@/utils/useAdminAuth';
import {
  Badge, Button, Card, CardBody, CardHeader, DataTable, Input, Notice, PageHeader, SegmentedControl, Select, StatTile,
  useToast, type Column, IconChevronLeft, IconChevronRight, IconDownload, IconRefresh,
} from '@/components/ui';
import RevenueChart from '@/components/revenue/RevenueChart';
import SettleAllPanel from '@/components/revenue/SettleAllPanel';
import {
  CYCLES, commissionText, csvRupees, istToday, rupees, type Cycle, type Period, type RevenueReport, type StoreRow,
} from '@/components/revenue/revenueModel';

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const PERIODS: { value: Period; label: string }[] = [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }];

function Line({ label, paise, strong = false, hint }: { label: string; paise: number; strong?: boolean; hint?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? 'border-t border-line-strong pt-2 font-semibold' : ''}`}>
      <div className="min-w-0">
        <p className={strong ? 'text-fg' : 'text-fg-muted'}>{label}</p>
        {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
      </div>
      <span className={`shrink-0 tabular-nums ${paise < 0 ? 'text-danger-text' : 'text-fg'}`}>{rupees(paise)}</span>
    </div>
  );
}

function downloadCsv(report: RevenueReport) {
  const head = ['Store', 'Type', 'Settlement cycle', 'UPI ID', 'Orders', 'Item total (₹)', 'Commission now', 'Commission % (effective)', 'Commission (₹)',
    'Store share (₹)', 'Paid at counter by rider (₹)', 'Cash the stall kept (₹)', 'Owed via statements (₹)', 'Settled (₹)', 'On pending statement (₹)', 'Pending to settle (₹)',
    'Collected from customers (₹)', 'Commission at report-time rate (orders)'];
  // Quoted when needed; text that a spreadsheet would run as a formula gets a leading apostrophe.
  const esc = (v: string | number) => {
    let s = String(v);
    if (typeof v === 'string' && /^[=+@\t\r-]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = report.stores.map(s => [
    s.name, s.kind === 'vendor' ? 'Stall' : 'Restaurant', s.settlementCycle, s.payoutUpiId || '', s.orders, csvRupees(s.itemsPaise), commissionText(s.currentCommission),
    s.effectiveCommissionPct, csvRupees(s.commissionPaise), csvRupees(s.storeSharePaise), csvRupees(s.counterPaidPaise), csvRupees(s.stallCashPaise),
    csvRupees(s.owedPaise), csvRupees(s.settledPaise), csvRupees(s.onStatementPaise), csvRupees(s.pendingPaise), csvRupees(s.collectedPaise), s.commissionEstimatedOrders,
  ]);
  const t = report.totals;
  rows.push(['TOTAL', '', '', '', t.orders, csvRupees(t.itemsPaise), '', '', csvRupees(t.commissionPaise), csvRupees(t.storeSharePaise), csvRupees(t.counterPaidPaise),
    csvRupees(t.stallCashPaise), csvRupees(t.owedPaise), csvRupees(t.settledPaise), csvRupees(t.onStatementPaise), csvRupees(t.pendingPaise), csvRupees(t.collectedPaise), t.commissionEstimatedOrders]);
  const meta = [[`ZenWe revenue ${report.period.label} (${report.period.startDate} to ${report.period.endDate}, IST)`], [`Reconciliation: ${report.reconciliation.ok ? 'balanced (difference 0.00)' : `NOT balanced, difference ${csvRupees(report.reconciliation.differencePaise)}`}`], []];
  const csv = [...meta, head, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zenwe-revenue-${report.period.period}-${report.period.startDate}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function RevenuePage() {
  const { isAuthed } = useAdminAuth();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>('week');
  const [date, setDate] = useState<string>(istToday());
  const [storeId, setStoreId] = useState<string>('');
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storeNames, setStoreNames] = useState<Record<string, string>>({});
  const [savingCycle, setSavingCycle] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const q = new URLSearchParams({ period, date, ...(storeId ? { storeId } : {}) });
      const r = await adminRequest<RevenueReport>(`/api/admin/revenue?${q}`);
      if (id !== reqId.current) return; // a newer request is on its way
      setReport(r);
      setError(null);
      setStoreNames(prev => {
        const next = { ...prev };
        for (const s of r.stores) next[s.storeId] = s.name;
        return next;
      });
    } catch (e) {
      if (id !== reqId.current) return;
      setError(errText(e, 'Could not load revenue.'));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [period, date, storeId]);
  useEffect(() => { if (isAuthed) load(); }, [isAuthed, load]);

  const changeCycle = async (s: StoreRow, cycle: Cycle) => {
    if (cycle === s.settlementCycle || savingCycle) return;
    setSavingCycle(s.storeId);
    try {
      await adminRequest(`/api/admin/revenue/stores/${s.storeId}/cycle`, { method: 'PUT', body: JSON.stringify({ cycle }) });
      setReport(prev => prev && { ...prev, stores: prev.stores.map(x => (x.storeId === s.storeId ? { ...x, settlementCycle: cycle } : x)) });
      toast.success(`${s.name} is now settled ${cycle}.`);
    } catch (e) {
      toast.error(errText(e, 'Could not change the settlement cycle.'));
    } finally {
      setSavingCycle(null);
    }
  };

  if (!isAuthed) return null; // AppShell shows the session check

  const t = report?.totals;
  const p = report?.period;
  const rec = report?.reconciliation;

  const columns: Column<StoreRow>[] = [
    {
      key: 'name', header: 'Store', sortValue: s => s.name,
      cell: s => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{s.name}</p>
          <p className="truncate text-xs text-fg-muted">{s.kind === 'vendor' ? 'Stall' : 'Restaurant'}{s.isActive ? '' : ' · switched off'}</p>
        </div>
      ),
    },
    { key: 'orders', header: 'Orders', align: 'right', sortValue: s => s.orders, cell: s => <span className="tabular-nums">{s.orders}</span> },
    { key: 'items', header: 'Item total', align: 'right', sortValue: s => s.itemsPaise, cell: s => <span className="tabular-nums">{rupees(s.itemsPaise)}</span> },
    {
      key: 'rate', header: 'Commission %', align: 'right', hideBelow: 'lg', sortValue: s => s.effectiveCommissionPct,
      cell: s => (
        <div className="text-right">
          <p className="tabular-nums">{s.effectiveCommissionPct.toFixed(2)}%</p>
          <p className="whitespace-nowrap text-xs text-fg-muted" title="The store's rate today. Each order uses the rate fixed when it was placed.">now {commissionText(s.currentCommission)}</p>
        </div>
      ),
    },
    {
      key: 'commission', header: 'Commission', align: 'right', sortValue: s => s.commissionPaise,
      cell: s => (
        <div className="text-right">
          <p className="tabular-nums">{rupees(s.commissionPaise)}</p>
          {s.commissionEstimatedOrders > 0 && <Badge tone="warning" title="Old orders without a saved commission use the store's rate today.">{s.commissionEstimatedOrders} at today&apos;s rate</Badge>}
        </div>
      ),
    },
    {
      key: 'owed', header: 'Owed', align: 'right', sortValue: s => s.owedPaise,
      cell: s => (
        <div className="text-right">
          <p className={`tabular-nums font-medium ${s.owedPaise < 0 ? 'text-danger-text' : 'text-fg'}`}>{rupees(s.owedPaise)}</p>
          {s.owedPaise < 0 && <p className="whitespace-nowrap text-xs text-fg-muted">stall owes ZenWe</p>}
          {s.counterPaidPaise > 0 && <p className="whitespace-nowrap text-xs text-fg-muted">{rupees(s.counterPaidPaise)} paid at counter</p>}
        </div>
      ),
    },
    { key: 'settled', header: 'Settled', align: 'right', sortValue: s => s.settledPaise, cell: s => <span className="tabular-nums text-success-text">{rupees(s.settledPaise)}</span> },
    {
      key: 'pending', header: 'Pending', align: 'right', sortValue: s => s.pendingPaise,
      cell: s => (
        <div className="text-right">
          <p className={`tabular-nums font-semibold ${s.pendingPaise !== 0 ? 'text-warning-text' : 'text-fg-muted'}`}>{rupees(s.pendingPaise)}</p>
          {s.onStatementPaise !== 0 && <p className="whitespace-nowrap text-xs text-fg-muted">{rupees(s.onStatementPaise)} on a statement</p>}
        </div>
      ),
    },
    {
      key: 'cycle', header: 'Cycle', sortValue: s => s.settlementCycle,
      cell: s => (
        <Select aria-label={`Settlement cycle for ${s.name}`} className="w-28" value={s.settlementCycle} disabled={savingCycle !== null} onChange={e => changeCycle(s, e.target.value as Cycle)}>
          {CYCLES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      ),
    },
    { key: 'upi', header: 'UPI ID', hideBelow: 'xl', sortValue: s => s.payoutUpiId || '', cell: s => <span className={`font-mono text-xs ${s.payoutUpiId ? 'text-fg' : 'text-fg-subtle'}`}>{s.payoutUpiId || 'not set'}</span> },
  ];

  const storeOptions = Object.entries(storeNames).sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="text-fg">
      <PageHeader
        title="Revenue"
        description="What customers paid, what ZenWe keeps and what each store is owed, from the commission fixed when each order was placed. Delivered orders only, by delivery time in IST."
        actions={(
          <>
            <Button leftIcon={<IconRefresh size={14} />} loading={loading} onClick={load}>Refresh</Button>
            <Button leftIcon={<IconDownload size={14} />} disabled={!report || report.stores.length === 0} onClick={() => report && downloadCsv(report)}>Export CSV</Button>
          </>
        )}
      />

      {/* Period bar */}
      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center gap-3">
          <SegmentedControl ariaLabel="Period" options={PERIODS} value={period} onChange={setPeriod} />
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="Previous period" disabled={!p} onClick={() => p && setDate(p.prevDate)}><IconChevronLeft size={16} /></Button>
            <span className="min-w-[11rem] text-center text-sm font-semibold tabular-nums" aria-live="polite">{p ? p.label : '…'}</span>
            <Button size="sm" variant="ghost" aria-label="Next period" disabled={!p || p.isCurrent || p.isFuture} onClick={() => p && setDate(p.nextDate)}><IconChevronRight size={16} /></Button>
          </div>
          <Input type="date" aria-label="Go to date" className="w-40" max={istToday()} value={date} onChange={e => e.target.value && setDate(e.target.value)} />
          {p && !p.isCurrent && <Button size="sm" variant="ghost" onClick={() => setDate(istToday())}>Today</Button>}
          <div className="ml-auto">
            <Select aria-label="Store" className="w-56" value={storeId} onChange={e => setStoreId(e.target.value)}>
              <option value="">All stores</option>
              {storeOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </Select>
          </div>
        </CardBody>
      </Card>

      {error && <Notice tone="danger" className="mb-4" action={<Button size="sm" onClick={load}>Try again</Button>}>{error}</Notice>}

      {/* Reconciliation */}
      {rec && (
        rec.ok ? (
          <Notice tone="success" className="mb-4" title="Balanced: difference ₹0.00">
            Collected {rupees(rec.collectedLessRefundsPaise)}{t && t.refundsPaise ? ' (after refunds)' : ''} = owed to stores + ZenWe keeps + rider pay ({rupees(rec.storeSharePlusKeepsPlusRiderPaise)}), checked order by order.
          </Notice>
        ) : (
          <Notice tone="danger" className="mb-4" title={`Not balanced: difference ${rupees(rec.differencePaise)} on ${rec.mismatchedOrders} order${rec.mismatchedOrders === 1 ? '' : 's'}`}>
            <p>These orders&apos; totals do not match their parts. Check them before settling; nothing was adjusted.</p>
            <ul className="mt-1 list-disc pl-4">
              {rec.mismatches.slice(0, 20).map(m => (
                <li key={m.orderId}><span className="font-mono">{m.orderCode}</span> {m.storeName ? `(${m.storeName})` : ''}: {rupees(m.differencePaise)}. {m.reason}</li>
              ))}
            </ul>
            {rec.mismatches.length > 20 && <p className="mt-1">…and {rec.mismatches.length - 20} more.</p>}
          </Notice>
        )
      )}

      {/* Summary */}
      <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label="Summary">
        <StatTile label="Collected" loading={loading && !t} value={t ? rupees(t.collectedPaise) : null} hint={t ? `${t.orders} orders · COD ${rupees(t.byChannel.cod)} · Wallet ${rupees(t.byChannel.wallet)}` : undefined} />
        <StatTile label="ZenWe keeps" loading={loading && !t} tone={t && t.keepsPaise < 0 ? 'danger' : 'neutral'} value={t ? rupees(t.keepsPaise) : null} hint={t ? `Commission ${rupees(t.commissionPaise)} + fees − discounts − rider pay` : undefined} />
        <StatTile label="Owed to stores" loading={loading && !t} value={t ? rupees(t.owedPaise) : null} hint={t ? (t.stallCashPaise ? `after ${rupees(t.stallCashPaise)} cash stalls kept` : 'through statements') : undefined} />
        <StatTile label="Already settled" loading={loading && !t} tone="success" value={t ? rupees(t.settledPaise) : null} hint="on paid statements" />
        <StatTile label="Pending to settle" loading={loading && !t} tone={t && t.pendingPaise !== 0 ? 'warning' : 'neutral'} value={t ? rupees(t.pendingPaise) : null} hint={t && t.onStatementPaise ? `${rupees(t.onStatementPaise)} on statements, not paid` : 'not on a paid statement'} />
      </section>

      {/* Where the money went */}
      {t && report && (
        <div className="mb-4 grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="Collected" description="What customers paid for delivered orders." />
            <CardBody className="text-sm">
              <Line label="Cash on delivery (riders)" paise={t.byChannel.cod} hint={`${t.ordersByChannel.cod} orders`} />
              <Line label="ZenWe Wallet" paise={t.byChannel.wallet} hint={`${t.ordersByChannel.wallet} orders`} />
              <Line label="Cash taken by stalls themselves" paise={t.byChannel.stall} hint={`${t.ordersByChannel.stall} orders · never reaches ZenWe`} />
              {t.byChannel.other !== 0 && <Line label="UPI / card (older orders)" paise={t.byChannel.other} hint={`${t.ordersByChannel.other} orders`} />}
              <Line label="Total collected" paise={t.collectedPaise} strong />
              {t.refundsPaise !== 0 && <Line label="Refunds on delivered orders" paise={-t.refundsPaise} />}
              {report.context.riderCashHeldNowPaise !== null && (
                <p className="mt-2 text-xs text-fg-subtle">COD cash riders hold right now (all days): {rupees(report.context.riderCashHeldNowPaise)}. Collected from riders in Payments and payouts &gt; Rider cash.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Where it goes" description="Every rupee collected, split three ways." />
            <CardBody className="text-sm">
              <Line label="Stores' share (items − commission)" paise={t.storeSharePaise} hint={t.counterPaidPaise ? `incl. ${rupees(t.counterPaidPaise)} riders paid at shop counters` : undefined} />
              <Line label="ZenWe keeps" paise={t.keepsPaise} />
              <Line label="Rider pay" paise={t.riderPayPaise} hint="By the earnings rule: delivery fee, or ₹30 when it is 0. Tips are separate." />
              <Line label="Total" paise={t.storeSharePaise + t.keepsPaise + t.riderPayPaise} strong />
              <p className="mt-2 text-xs text-fg-subtle">Owed via statements = stores&apos; share − counter payments − cash stalls kept = {rupees(t.owedPaise)}.</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="ZenWe keeps, line by line" />
            <CardBody className="text-sm">
              {report.keepsLines.map(l => <Line key={l.key} label={l.label} paise={l.paise} />)}
              <Line label="ZenWe keeps" paise={t.keepsPaise} strong />
            </CardBody>
          </Card>
        </div>
      )}

      {report && report.commissionEstimated.orders > 0 && (
        <Notice tone="warning" className="mb-4" title={`${report.commissionEstimated.orders} older order${report.commissionEstimated.orders === 1 ? '' : 's'} use the store's commission rate today`}>
          They were settled before ZenWe saved the commission on each order, so the rate at the time is not known. Every newer order uses the rate fixed when it was placed.
        </Notice>
      )}
      {report && report.excluded.testOrders > 0 && (
        <p className="mb-4 text-xs text-fg-subtle">{report.excluded.testOrders} test order{report.excluded.testOrders === 1 ? '' : 's'} (owner test stores) left out.</p>
      )}

      {/* Series */}
      {report && (
        <Card className="mb-4">
          <CardHeader title={p?.period === 'day' ? 'Last 14 days' : `Each day of the ${p?.period}`} description={p?.period === 'day' ? 'The selected day is highlighted.' : undefined} />
          <CardBody>
            <RevenueChart series={report.series} highlight={p ? { start: p.startDate, end: p.endDate } : undefined} />
          </CardBody>
        </Card>
      )}

      {/* Per store */}
      <section className="mb-6" aria-label="Stores">
        <h2 className="mb-2 text-base font-semibold text-fg">By store</h2>
        <DataTable
          caption="Revenue by store"
          columns={columns}
          rows={report?.stores || []}
          rowKey={s => s.storeId}
          loading={loading && !report}
          error={!report ? error : null}
          onRetry={load}
          pageSize={50}
          noun="stores"
          maxHeight="none"
          initialSort={{ key: 'owed', dir: 'desc' }}
          empty={{ title: 'No delivered orders in this period', description: 'Pick another day, week or month.' }}
        />
      </section>

      <SettleAllPanel onChanged={load} />
    </div>
  );
}
