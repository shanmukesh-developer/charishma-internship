"use client";
// Revenue page: one row per store for the period. Sticky header, sort by any column, search, totals row, CSV
// export. "Still to pay" below zero (a stall that kept the customers' cash) reads "Store owes ZenWe ₹X".
// A missing UPI ID links to the store's details, where it is added before paying.
import { useMemo, useState } from 'react';
import { Button, Card, CardHeader, IconArrowDown, IconArrowUp, IconDownload, SearchInput, Select, cn } from '@/components/ui';
import { Money, Tip } from './RevenueBits';
import { PaymentSummary, type PaymentTarget } from './PaymentDetails';
import {
  CYCLES, MISSING, commissionText, count, csvRupees, ok, plural, rangeText, rupeesAbs, sum,
  type Cycle, type RevenueReport, type StoreRow,
} from './revenueModel';

type SortKey = 'name' | 'orders' | 'items' | 'commission' | 'owed' | 'settled' | 'pending' | 'cycle';
const SORTS: Record<SortKey, (s: StoreRow) => string | number> = {
  name: s => s.name.toLowerCase(),
  orders: s => s.orders,
  items: s => s.itemsPaise,
  commission: s => s.commissionPaise,
  owed: s => s.owedPaise,
  settled: s => s.settledPaise,
  pending: s => s.pendingPaise,
  cycle: s => s.settlementCycle,
};

function downloadCsv(report: RevenueReport) {
  const head = ['Store', 'Type', 'Payment cycle', 'UPI ID', 'Bank account (masked)', 'Orders', 'Sales - item total (Rs)', 'Commission % (actual)', 'Commission rate now', 'Commission (Rs)',
    'Store gets (Rs)', 'Already paid (Rs)', 'Still to pay (Rs)', 'On a statement, not paid yet (Rs)', 'Paid at counter by rider (Rs)', 'Cash the stall kept (Rs)',
    'Customers paid (Rs)', 'Orders at today\'s rate'];
  // Quoted when needed; text a spreadsheet would run as a formula gets a leading apostrophe.
  const esc = (v: string | number) => {
    let s = String(v);
    if (typeof v === 'string' && /^[=+@\t\r-]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const n = (v: number) => (ok(v) ? v : '');
  const rows: (string | number)[][] = report.stores.map(s => [
    s.name, s.kind === 'vendor' ? 'Stall' : 'Restaurant', s.settlementCycle, s.payment.payoutUpiId || 'NOT SET',
    s.payment.hasBank ? `${s.payment.bankName || 'Bank'} ${s.payment.bankAccountMasked || ''} ${s.payment.bankIfsc || ''}`.trim() : 'NOT SET', n(s.orders), csvRupees(s.itemsPaise),
    ok(s.effectiveCommissionPct) ? s.effectiveCommissionPct.toFixed(2) : '', commissionText(s.currentCommission), csvRupees(s.commissionPaise),
    csvRupees(s.owedPaise), csvRupees(s.settledPaise), csvRupees(s.pendingPaise), csvRupees(s.onStatementPaise), csvRupees(s.counterPaidPaise), csvRupees(s.stallCashPaise),
    csvRupees(s.collectedPaise), n(s.commissionEstimatedOrders),
  ]);
  const t = report.totals;
  rows.push(['TOTAL', '', '', '', '', n(t.orders), csvRupees(t.itemsPaise), '', '', csvRupees(t.commissionPaise), csvRupees(t.owedPaise), csvRupees(t.settledPaise),
    csvRupees(t.pendingPaise), csvRupees(t.onStatementPaise), csvRupees(t.counterPaidPaise), csvRupees(t.stallCashPaise), csvRupees(t.collectedPaise), n(t.commissionEstimatedOrders)]);
  const p = report.period;
  const meta = [
    [`ZenWe revenue by store: ${rangeText(p)} (India time)`],
    [`Balance check: ${report.reconciliation.ok ? 'all amounts balance (difference 0.00)' : `NOT balanced, difference ${csvRupees(report.reconciliation.differencePaise)}`}`],
    [`Downloaded ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`],
    [],
  ];
  const csv = [...meta, head, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = p.startDate === p.endDate
    ? `zenwe-revenue-day-${p.startDate}.csv`
    : `zenwe-revenue-${p.period}-${p.startDate}-to-${p.endDate}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Th({ k, label, tip, sort, setSort, right = false, className }: { k: SortKey; label: string; tip?: string; sort: { key: SortKey; dir: 'asc' | 'desc' }; setSort: (s: { key: SortKey; dir: 'asc' | 'desc' }) => void; right?: boolean; className?: string }) {
  const active = sort.key === k;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn('sticky top-0 z-10 whitespace-nowrap border-b border-line bg-surface-2 px-2.5 py-2 text-xs font-medium text-fg-muted', right ? 'text-right' : 'text-left', className)}>
      <span className={cn('inline-flex items-center gap-0.5', right && 'flex-row-reverse')}>
        <button type="button" onClick={() => setSort({ key: k, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })} className={cn('inline-flex items-center gap-1 hover:text-fg', active && 'text-fg')}>
          {label}
          {active ? (sort.dir === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />) : null}
        </button>
        {tip && <Tip text={tip} />}
      </span>
    </th>
  );
}

export default function StoresTable({ report, savingCycle, onCycle, onEditPayment }: { report: RevenueReport; savingCycle: string | null; onCycle: (s: StoreRow, c: Cycle) => void; onEditPayment: (t: PaymentTarget) => void }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'pending', dir: 'desc' });
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? report.stores.filter(s => s.name.toLowerCase().includes(needle) || (s.payoutUpiId || '').toLowerCase().includes(needle)) : report.stores;
    const get = SORTS[sort.key];
    const sorted = [...list].sort((a, b) => {
      const x = get(a); const y = get(b);
      if (typeof x === 'number' && typeof y === 'number') {
        if (!ok(x)) return 1; if (!ok(y)) return -1; // missing last
        return x - y;
      }
      return String(x).localeCompare(String(y));
    });
    return sort.dir === 'desc' ? sorted.reverse() : sorted;
  }, [report.stores, q, sort]);
  const filtered = rows.length !== report.stores.length;
  // Totals: the report's own totals for all stores; the sum of the visible rows while searching.
  const tot = filtered
    ? { orders: sum(rows.map(r => r.orders)), itemsPaise: sum(rows.map(r => r.itemsPaise)), commissionPaise: sum(rows.map(r => r.commissionPaise)), owedPaise: sum(rows.map(r => r.owedPaise)), settledPaise: sum(rows.map(r => r.settledPaise)), pendingPaise: sum(rows.map(r => r.pendingPaise)) }
    : report.totals;
  const missingUpi = report.stores.filter(s => !s.payment.canPay && ok(s.pendingPaise) && s.pendingPaise > 0).length;

  return (
    <Card className="mb-4">
      <CardHeader
        title="Stores"
        description={<>What each store sold and what ZenWe owes it for {rangeText(report.period)}.{missingUpi > 0 && <span className="text-warning-text"> {plural(missingUpi, 'store')} still to be paid {missingUpi === 1 ? 'has' : 'have'} no UPI or bank details yet.</span>}</>}
        actions={(
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Search store or UPI ID" ariaLabel="Search stores" className="sm:w-56" />
            <Button size="sm" leftIcon={<IconDownload size={14} />} disabled={report.stores.length === 0} onClick={() => downloadCsv(report)}>Download CSV</Button>
          </>
        )}
      />
      {report.stores.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-fg-muted">No delivered orders in this period, so no store has anything to show.</p>
      ) : (
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full min-w-[960px] border-separate border-spacing-0 text-sm">
            <caption className="sr-only">Revenue by store, {rangeText(report.period)}</caption>
            <thead>
              <tr>
                <Th k="name" label="Store" sort={sort} setSort={setSort} />
                <Th k="orders" label="Orders" sort={sort} setSort={setSort} right />
                <Th k="items" label="Sales" tip="The store's item total: what its items cost, before fees and discounts." sort={sort} setSort={setSort} right />
                <Th k="commission" label="Commission" tip="ZenWe's cut, at the rate fixed when each order was placed. The % is the actual rate over this period." sort={sort} setSort={setSort} right />
                <Th k="owed" label="Store gets" tip="Sales minus commission, minus cash a stall took itself. What ZenWe owes the store for this period." sort={sort} setSort={setSort} right />
                <Th k="settled" label="Already paid" tip="On statements you have marked paid." sort={sort} setSort={setSort} right />
                <Th k="pending" label="Still to pay" tip="Store gets minus already paid. Below zero means the store owes ZenWe." sort={sort} setSort={setSort} right />
                <Th k="cycle" label="Paid" tip="How often this store is paid. Changing it only affects future statements." sort={sort} setSort={setSort} />
                <th scope="col" className="sticky top-0 z-10 whitespace-nowrap border-b border-line bg-surface-2 px-3 py-2 text-left text-xs font-medium text-fg-muted">Payment details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.storeId} className="hover:bg-surface-2/50 [&>td]:border-b [&>td]:border-line">
                  <td className="px-2.5 py-2 align-top">
                    <p className="max-w-[16rem] truncate font-medium text-fg" title={s.name}>{s.name}</p>
                    <p className="text-xs text-fg-muted">{s.kind === 'vendor' ? 'Stall' : 'Restaurant'}{s.isActive ? '' : ' · switched off'}</p>
                  </td>
                  <td className="px-2.5 py-2 text-right align-top tabular-nums">{count(s.orders)}</td>
                  <td className="px-2.5 py-2 text-right align-top"><Money paise={s.itemsPaise} /></td>
                  <td className="px-2.5 py-2 text-right align-top">
                    <Money paise={s.commissionPaise} />
                    <p className="whitespace-nowrap text-xs text-fg-muted" title={`Rate today: ${commissionText(s.currentCommission)}`}>
                      {ok(s.effectiveCommissionPct) ? `${s.effectiveCommissionPct.toFixed(2)}%` : MISSING}
                      {s.commissionEstimatedOrders > 0 ? ` · ${s.commissionEstimatedOrders} at today's rate` : ''}
                    </p>
                  </td>
                  <td className="px-2.5 py-2 text-right align-top">
                    <Money paise={s.owedPaise} neutral />
                    {s.stallCashPaise > 0 && <p className="whitespace-nowrap text-xs text-fg-muted">after {rupeesAbs(s.stallCashPaise)} cash kept</p>}
                    {s.counterPaidPaise > 0 && <p className="whitespace-nowrap text-xs text-fg-muted">+ {rupeesAbs(s.counterPaidPaise)} paid at counter</p>}
                  </td>
                  <td className="px-2.5 py-2 text-right align-top"><Money paise={s.settledPaise} className={s.settledPaise > 0 ? 'text-success-text' : 'text-fg-muted'} /></td>
                  <td className="px-2.5 py-2 text-right align-top">
                    {ok(s.pendingPaise) && s.pendingPaise < 0 ? (
                      <span className="block font-semibold leading-tight text-danger-text"><span className="block text-xs font-medium">Store owes ZenWe</span>{rupeesAbs(s.pendingPaise)}</span>
                    ) : (
                      <Money paise={s.pendingPaise} strong className={s.pendingPaise > 0 ? 'text-warning-text' : 'text-fg-muted'} />
                    )}
                    {s.onStatementPaise !== 0 && ok(s.onStatementPaise) && <p className="whitespace-nowrap text-xs text-fg-muted">{rupeesAbs(s.onStatementPaise)} on a statement, not paid</p>}
                  </td>
                  <td className="px-2.5 py-2 align-top">
                    <Select aria-label={`How often ${s.name} is paid`} className="w-[6.5rem]" value={s.settlementCycle} disabled={savingCycle !== null} onChange={e => onCycle(s, e.target.value as Cycle)}>
                      {CYCLES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </Select>
                  </td>
                  <td className="px-2.5 py-2 align-top">
                    <PaymentSummary payment={s.payment} name={s.name} compact onEdit={() => onEditPayment({ storeId: s.storeId, name: s.name })} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold [&>td]:sticky [&>td]:bottom-0 [&>td]:border-t [&>td]:border-line-strong [&>td]:bg-surface-2">
                <td className="px-2.5 py-2">{filtered ? `Total of ${plural(rows.length, 'store')} shown` : `Total, ${plural(report.stores.length, 'store')}`}</td>
                <td className="px-2.5 py-2 text-right tabular-nums">{count(tot.orders)}</td>
                <td className="px-2.5 py-2 text-right"><Money paise={tot.itemsPaise} /></td>
                <td className="px-2.5 py-2 text-right"><Money paise={tot.commissionPaise} /></td>
                <td className="px-2.5 py-2 text-right"><Money paise={tot.owedPaise} neutral /></td>
                <td className="px-2.5 py-2 text-right"><Money paise={tot.settledPaise} /></td>
                <td className="px-2.5 py-2 text-right"><Money paise={tot.pendingPaise} neutral /></td>
                <td className="px-2.5 py-2" colSpan={2} />
              </tr>
            </tfoot>
          </table>
          {rows.length === 0 && <p className="px-4 py-6 text-center text-sm text-fg-muted">No store matches “{q}”.</p>}
        </div>
      )}
    </Card>
  );
}
