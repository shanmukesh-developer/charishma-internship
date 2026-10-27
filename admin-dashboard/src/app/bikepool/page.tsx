"use client";

import { useCallback, useEffect, useState } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { adminRequest as apiRequest } from '@/lib/api';
import {
  Badge, Button, DataTable, DescriptionList, Drawer, Notice, PageHeader, SegmentedControl, StatusPill, Toolbar, useConfirm,
  type Column, IconRefresh,
} from '@/components/ui';
import { formatDateTime as fmtDateTime, formatINR, formatPhone, humanize } from '@/lib/format';


interface BikePool {
  id: string;
  creatorRole: 'rider' | 'passenger';
  origin: string;
  destination: string;
  departureTime: string;
  splitAmount: number;
  estimatedFuelCost: number;
  genderPreference: string;
  status: 'Available' | 'Matched' | 'Completed' | 'Cancelled';
  paymentStatus: 'Unpaid' | 'Paid';
  vehicleType?: string;
  availableSeats?: number;
  creator?: { id: string; name: string; phone: string; gender: string };
  coRider?: { id: string; name: string; phone: string };
  createdAt: string;
}

type Filter = 'all' | BikePool['status'];

const statusTone = (s: string) => (s === 'Available' ? 'info' : s === 'Matched' ? 'success' : s === 'Cancelled' ? 'danger' : 'neutral') as 'info' | 'success' | 'danger' | 'neutral';

/** fetch against the one backend; throws an Error carrying the server's friendly `message`. */
export default function BikePoolAdmin() {
  const { isAuthed } = useAdminAuth();
  const confirm = useConfirm();
  const [pools, setPools] = useState<BikePool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const fetchPools = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Admin-only list of every listing. No fallback to the public feed: it hides full and old rides.
      const data = await apiRequest<BikePool[]>('/api/bikepool/admin/all');
      setPools(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load co-ride listings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthed) fetchPools();
  }, [isAuthed, fetchPools]);

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr || '—';
    return fmtDateTime(d, { short: true });
  };

  const runAction = async (pool: BikePool, action: 'force-cancel' | 'mark-paid') => {
    if (busyId) return;
    const route = `${pool.origin} → ${pool.destination}`;
    const ok = action === 'force-cancel'
      ? await confirm({
        title: 'Cancel this ride?',
        description: `${route} by ${pool.creator?.name || 'this student'}. Riders will no longer see it. This cannot be undone.`,
        confirmLabel: 'Cancel ride',
        cancelLabel: 'Keep ride',
        tone: 'danger',
      })
      : await confirm({
        title: 'Mark this ride as paid?',
        description: `${route}. Only do this once the co-riders have settled up.`,
        confirmLabel: 'Mark as paid',
      });
    if (!ok) return;
    setBusyId(pool.id);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ message?: string }>(`/api/bikepool/admin/${pool.id}/${action}`, { method: 'POST' });
      setNotice(res?.message || (action === 'force-cancel' ? 'Ride cancelled.' : 'Ride marked as paid.'));
      await fetchPools();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That action failed. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const stats = {
    total: pools.length,
    active: pools.filter(p => p.status === 'Available').length,
    matched: pools.filter(p => p.status === 'Matched').length,
    completed: pools.filter(p => p.status === 'Completed').length,
    cancelled: pools.filter(p => p.status === 'Cancelled').length,
  };

  const filtered = filter === 'all' ? pools : pools.filter(p => p.status === filter);
  const open = openId ? pools.find(p => p.id === openId) || null : null;

  const canMarkPaid = (p: BikePool) => p.paymentStatus === 'Unpaid' && p.status !== 'Cancelled' && Number(p.splitAmount) > 0;
  const canCancel = (p: BikePool) => p.status === 'Available' || p.status === 'Matched';
  const priceText = (p: BikePool) => (Number(p.splitAmount) > 0 ? `${formatINR(Number(p.splitAmount))} / seat` : 'Free');

  const columns: Column<BikePool>[] = [
    {
      key: 'route',
      header: 'Route',
      sortValue: p => `${p.origin} ${p.destination}`,
      cell: p => (
        <div className="min-w-0 max-w-[340px]">
          <p className="truncate font-medium text-fg">{p.origin} → {p.destination}</p>
          <p className="truncate text-xs text-fg-muted">{p.creatorRole === 'rider' ? 'Offered by rider' : 'Requested by passenger'}{p.vehicleType ? ` · ${humanize(p.vehicleType)}` : ''}</p>
        </div>
      ),
    },
    { key: 'departure', header: 'Departs', sortValue: p => new Date(p.departureTime), cell: p => <span className="whitespace-nowrap">{formatDateTime(p.departureTime)}</span> },
    {
      key: 'creator',
      header: 'Posted by',
      hideBelow: 'lg',
      sortValue: p => p.creator?.name || '',
      cell: p => (
        <div className="min-w-0">
          <p className="truncate text-fg">{p.creator?.name || 'Unknown'}</p>
          {p.coRider && <p className="truncate text-xs text-fg-muted">with {p.coRider.name}</p>}
        </div>
      ),
    },
    { key: 'seats', header: 'Seats left', align: 'right', hideBelow: 'xl', sortValue: p => p.availableSeats ?? -1, cell: p => <span className="tabular-nums">{typeof p.availableSeats === 'number' ? p.availableSeats : '–'}</span> },
    { key: 'price', header: 'Split', align: 'right', sortValue: p => Number(p.splitAmount) || 0, cell: p => <span className="whitespace-nowrap tabular-nums">{priceText(p)}</span> },
    { key: 'payment', header: 'Payment', hideBelow: 'lg', cell: p => (Number(p.splitAmount) > 0 ? <Badge tone={p.paymentStatus === 'Paid' ? 'success' : 'warning'}>{p.paymentStatus}</Badge> : <span className="text-xs text-fg-subtle">Not needed</span>) },
    { key: 'status', header: 'Status', sortValue: p => p.status, cell: p => <StatusPill status={p.status} tone={statusTone(p.status)} label={p.status} /> },
  ];

  return (
    <div className="text-fg">
      <PageHeader
        title="Co-ride"
        description="Every co-ride listing, newest first. ZCS does not collect ride money; co-riders settle directly."
        actions={<Button leftIcon={<IconRefresh size={14} />} loading={loading} onClick={fetchPools}>Refresh</Button>}
      />

      <Toolbar end={<span className="text-sm tabular-nums text-fg-muted">{filtered.length} of {pools.length} rides</span>}>
        <SegmentedControl<Filter>
          ariaLabel="Ride status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: stats.total },
            { value: 'Available', label: 'Available', count: stats.active },
            { value: 'Matched', label: 'Matched', count: stats.matched },
            { value: 'Completed', label: 'Completed', count: stats.completed },
            { value: 'Cancelled', label: 'Cancelled', count: stats.cancelled },
          ]}
        />
      </Toolbar>

      {notice && <Notice tone="success" className="mb-3" onClose={() => setNotice(null)}>{notice}</Notice>}
      {error && pools.length > 0 && <Notice tone="danger" className="mb-3" onClose={() => setError(null)}>{error}</Notice>}

      <DataTable
        caption="Co-ride listings"
        columns={columns}
        rows={filtered}
        rowKey={p => p.id}
        loading={loading && pools.length === 0}
        error={pools.length === 0 ? error : null}
        onRetry={fetchPools}
        onRowClick={p => setOpenId(p.id)}
        noun="rides"
        resetPageKey={filter}
        empty={{ title: filter === 'all' ? 'No co-ride listings yet' : `No ${filter.toLowerCase()} rides`, description: 'Rides students post in the app appear here.' }}
      />

      <Drawer
        open={!!open}
        onClose={() => setOpenId(null)}
        size="md"
        title={open ? `${open.origin} → ${open.destination}` : 'Ride'}
        description={open ? `Departs ${formatDateTime(open.departureTime)}` : undefined}
        headerActions={open ? <StatusPill status={open.status} tone={statusTone(open.status)} label={open.status} /> : undefined}
        footer={open && (canMarkPaid(open) || canCancel(open)) ? (
          <div className="flex w-full flex-wrap justify-end gap-2">
            {canMarkPaid(open) && <Button disabled={!!busyId} loading={busyId === open.id} onClick={() => runAction(open, 'mark-paid')}>Mark as paid</Button>}
            {canCancel(open) && <Button variant="destructive" disabled={!!busyId} loading={busyId === open.id} onClick={() => runAction(open, 'force-cancel')}>Cancel ride</Button>}
          </div>
        ) : undefined}
      >
        {open && (
          <DescriptionList
            columns={2}
            items={[
              { label: 'Posted by', value: <>{open.creator?.name || 'Unknown'}{open.creator?.phone && <span className="block text-fg-muted">{formatPhone(open.creator.phone)}</span>}</> },
              { label: 'Co-rider', value: open.coRider ? <>{open.coRider.name}{open.coRider.phone && <span className="block text-fg-muted">{formatPhone(open.coRider.phone)}</span>}</> : 'Not matched yet' },
              { label: 'Listing type', value: open.creatorRole === 'rider' ? 'Rider offering seats' : 'Passenger looking for a ride' },
              { label: 'Vehicle', value: open.vehicleType ? humanize(open.vehicleType) : 'Not specified' },
              { label: 'Seats left', value: typeof open.availableSeats === 'number' ? open.availableSeats : 'Not specified' },
              { label: 'Gender preference', value: open.genderPreference || 'Any' },
              { label: 'Split', value: priceText(open) },
              { label: 'Estimated fuel cost', value: Number(open.estimatedFuelCost) > 0 ? formatINR(Number(open.estimatedFuelCost)) : 'Not given' },
              { label: 'Payment', value: Number(open.splitAmount) > 0 ? open.paymentStatus : 'Not needed (free ride)' },
              { label: 'Posted', value: formatDateTime(open.createdAt) },
            ]}
          />
        )}
      </Drawer>
    </div>
  );
}
