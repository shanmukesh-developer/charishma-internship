"use client";
// Revenue (owner, 6 Nov 2026; reworked for clarity the same day). Top to bottom:
//   period bar (Today / This week / This month, prev / next, the exact IST range written out)
//   -> Money flow (customers paid -> stores / riders / ZenWe, every difference explained in words)
//   -> health banner (all amounts balance, or which orders don't; missing figures; older orders at today's rate)
//   -> To settle (one card per payment cycle) + Waiting for payment (Mark paid)
//   -> Stores table -> What ZenWe earns -> daily chart.
// Numbers come only from the server (GET /api/admin/revenue; rules in backend/utils/revenueReport.js) and are
// reloaded after every change; nothing is updated optimistically. Each panel has its own error boundary, the
// route has error.tsx, and a failed refresh keeps the last numbers on screen with a red banner and Try again.
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminRequest } from '@/lib/api';
import { useAdminAuth } from '@/utils/useAdminAuth';
import {
  Button, Card, CardBody, CardHeader, ErrorState, Input, Notice, PageHeader, SegmentedControl, Select, Skeleton, useToast,
  IconChevronLeft, IconChevronRight, IconInfo, IconRefresh,
} from '@/components/ui';
import RevenueChart from '@/components/revenue/RevenueChart';
import SettlePanel from '@/components/revenue/SettlePanel';
import StoresTable from '@/components/revenue/StoresTable';
import { SectionBoundary } from '@/components/revenue/RevenueBits';
import { PaymentDetailsDrawer, type PaymentTarget } from '@/components/revenue/PaymentDetails';
import { EarningsStatement, HealthBanner, HelpDrawer, MoneyFlow } from '@/components/revenue/RevenueSummary';
import {
  errText, istToday, normalizeReport, rangeText, type Cycle, type Period, type RevenueReport, type StoreRow,
} from '@/components/revenue/revenueModel';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
];
const PERIOD_NOUN: Record<Period, string> = { day: 'day', week: 'week', month: 'month' };
const STALE_MS = 5 * 60_000;

const agoText = (ms: number) => {
  const m = Math.floor(ms / 60_000);
  return m < 1 ? 'just now' : m === 1 ? '1 minute ago' : m < 60 ? `${m} minutes ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
};

export default function RevenuePage() {
  const { isAuthed } = useAdminAuth();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>('week');
  const [date, setDate] = useState<string>(istToday());
  const [storeId, setStoreId] = useState<string>('');
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [flags, setFlags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [storeNames, setStoreNames] = useState<Record<string, string>>({});
  const [savingCycle, setSavingCycle] = useState<string | null>(null);
  const [settleKey, setSettleKey] = useState(0);
  const [help, setHelp] = useState(false);
  const [editPayment, setEditPayment] = useState<PaymentTarget | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const q = new URLSearchParams({ period, date, ...(storeId ? { storeId } : {}) });
      const { report: r, flags: f } = normalizeReport(await adminRequest<unknown>(`/api/admin/revenue?${q}`));
      if (id !== reqId.current) return; // a newer request is on its way
      setReport(r);
      setFlags(f);
      setError(null);
      setFetchedAt(Date.now());
      setNow(Date.now());
      setStoreNames(prev => {
        const next = { ...prev };
        for (const s of r.stores) if (s.storeId) next[s.storeId] = s.name;
        return next;
      });
    } catch (e) {
      if (id !== reqId.current) return;
      setError(errText(e, 'Could not load the revenue numbers.'));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [period, date, storeId]);
  useEffect(() => { if (isAuthed) load(); }, [isAuthed, load]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // After any money change: reload the report and the settle cards from the server.
  const refreshAll = useCallback(() => {
    load();
    setSettleKey(k => k + 1);
  }, [load]);

  const changeCycle = async (s: StoreRow, cycle: Cycle) => {
    if (cycle === s.settlementCycle || savingCycle) return;
    setSavingCycle(s.storeId);
    try {
      await adminRequest(`/api/admin/revenue/stores/${s.storeId}/cycle`, { method: 'PUT', body: JSON.stringify({ cycle }) });
      toast.success(`${s.name} will now be paid ${cycle}.`);
    } catch (e) {
      toast.error(errText(e, 'Could not change how often this store is paid.'));
    } finally {
      setSavingCycle(null);
      refreshAll();
    }
  };

  if (!isAuthed) return null; // AppShell shows the session check

  const p = report?.period;
  // Shown while the next period loads, so the range text never lies about what is on screen.
  const viewingOld = !!report && loading;
  const stale = fetchedAt !== null && now - fetchedAt > STALE_MS;
  const storeOptions = Object.entries(storeNames).sort((a, b) => a[1].localeCompare(b[1]));
  const pickPeriod = (v: Period) => { setPeriod(v); setDate(istToday()); };

  return (
    <div className="text-fg">
      <PageHeader
        title="Revenue"
        description="What customers paid, what each store is owed, and what ZenWe keeps. Delivered orders only, by delivery time in India (IST)."
        actions={(
          <>
            <Button leftIcon={<IconInfo size={14} />} onClick={() => setHelp(true)}>How Revenue works</Button>
            <Button leftIcon={<IconRefresh size={14} />} loading={loading} onClick={refreshAll}>Refresh</Button>
          </>
        )}
      />

      {/* a. Period bar */}
      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <SegmentedControl ariaLabel="Period" options={PERIODS} value={period} onChange={pickPeriod} />
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" aria-label={`Previous ${PERIOD_NOUN[period]}`} disabled={!p || loading} onClick={() => p?.prevDate && setDate(p.prevDate)}><IconChevronLeft size={16} /></Button>
            <div className="min-w-[13rem] text-center" aria-live="polite">
              {p ? <p className="text-sm font-semibold tabular-nums text-fg">{rangeText(p)}</p> : <Skeleton className="mx-auto h-4 w-40" />}
              <p className="text-xs text-fg-muted">{p ? (p.isCurrent ? `This ${PERIOD_NOUN[p.period]} so far · IST` : 'India time (IST)') : ' '}</p>
            </div>
            <Button size="sm" variant="ghost" aria-label={`Next ${PERIOD_NOUN[period]}`} disabled={!p || p.isCurrent || p.isFuture || loading} onClick={() => p?.nextDate && setDate(p.nextDate)}><IconChevronRight size={16} /></Button>
          </div>
          {p && !p.isCurrent && <Button size="sm" onClick={() => setDate(istToday())}>Back to {PERIODS.find(x => x.value === period)?.label.toLowerCase()}</Button>}
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            Go to date
            <Input type="date" aria-label="Go to date" className="w-40" max={istToday()} value={date} onChange={e => e.target.value && setDate(e.target.value)} />
          </label>
          <div className="ml-auto">
            <Select aria-label="Store" className="w-56" value={storeId} onChange={e => setStoreId(e.target.value)}>
              <option value="">All stores</option>
              {storeOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </Select>
          </div>
        </CardBody>
      </Card>

      {/* load problems: never blank the page */}
      {error && report && (
        <Notice tone="danger" className="mb-4" title="Could not refresh the numbers" action={<Button size="sm" onClick={load} loading={loading}>Try again</Button>}>
          {error} The numbers below are from {fetchedAt ? agoText(now - fetchedAt) : 'earlier'}{p ? ` (${rangeText(p)})` : ''}. Don&apos;t pay anyone until they refresh.
        </Notice>
      )}
      {!error && stale && (
        <Notice tone="warning" className="mb-4" title={`These numbers were loaded ${agoText(now - (fetchedAt || now))}`} action={<Button size="sm" onClick={refreshAll} loading={loading}>Refresh now</Button>}>
          New orders may have been delivered since. Refresh before you settle or pay.
        </Notice>
      )}
      {viewingOld && p && (date < p.startDate || date > p.endDate || period !== p.period) && (
        <p className="mb-2 text-xs text-fg-muted" role="status">Loading the new period… still showing {rangeText(p)}.</p>
      )}

      {!report && error ? (
        <Card className="mb-4">
          <ErrorState title="Could not load the revenue numbers" message={`${error} Nothing was changed.`} onRetry={load} />
        </Card>
      ) : (
        <>
          <SectionBoundary name="Money flow"><MoneyFlow report={report} loading={loading} /></SectionBoundary>
          <SectionBoundary name="The balance check"><HealthBanner report={report} flags={flags} /></SectionBoundary>
        </>
      )}

      <SectionBoundary name="To settle"><SettlePanel refreshKey={settleKey} onChanged={refreshAll} onEditPayment={setEditPayment} /></SectionBoundary>

      {report && (
        <>
          <SectionBoundary name="The stores table"><StoresTable report={report} savingCycle={savingCycle} onCycle={changeCycle} onEditPayment={setEditPayment} /></SectionBoundary>
          {report.totals.orders > 0 && <SectionBoundary name="What ZenWe earns"><EarningsStatement report={report} /></SectionBoundary>}
          <SectionBoundary name="The chart">
            <Card className="mb-6">
              <CardHeader
                title={p?.period === 'day' ? 'Last 14 days' : `Each day of the ${p ? PERIOD_NOUN[p.period] : 'period'}`}
                description={p?.period === 'day' ? 'The selected day is darker.' : 'Hover a bar for the exact amount, or switch to Table.'}
              />
              <CardBody><RevenueChart series={report.series} highlight={p ? { start: p.startDate, end: p.endDate } : undefined} /></CardBody>
            </Card>
          </SectionBoundary>
        </>
      )}
      {!report && loading && (
        <Card className="mb-4"><CardBody className="grid gap-2"><Skeleton className="h-5 w-48" />{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-9 w-full" />)}</CardBody></Card>
      )}

      <HelpDrawer open={help} onClose={() => setHelp(false)} />
      {editPayment && <PaymentDetailsDrawer key={editPayment.storeId} target={editPayment} onClose={() => setEditPayment(null)} onSaved={refreshAll} />}
    </div>
  );
}
