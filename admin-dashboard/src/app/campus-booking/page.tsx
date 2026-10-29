"use client";
// In-Campus Booking (admin): every pickup booking paid straight to a campus stall by UPI (read only: the stall and
// the student move them), with the payment proof and the 1.5 % ZCS commission recorded on each; and the stalls'
// own switch, UPI ID, QR and prep time. Live: admin:changed 'campus_booking' / 'store'.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { adminRequest } from '@/lib/api';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { useLiveSync } from '@/lib/useLiveSync';
import { formatDateTime, formatINR } from '@/lib/format';
import {
  Badge, Button, DataTable, DescriptionList, Drawer, PageHeader, SearchInput, Select, StatTile, StatusPill, Tabs, Toolbar, IconPlus, IconRefresh, buttonClass, type Column,
} from '@/components/ui';

// A campus stall is a Stores entry of type "Local stall": the wizard opens preset to it, and its success screen
// leads to the stall's In-Campus Booking tab (switch, UPI ID, QR, prep time).
const ADD_STALL_HREF = '/restaurants?new=1&type=LOCAL_VENDOR';
import { StallBookingSettings, type CampusStall } from '@/components/campusBooking/StallBookingSettings';

interface Line { menuItemId: string | null; name: string; unitPrice: number; quantity: number; lineTotal: number }
interface Step { key: string; label: string; at: string | null; done: boolean }
interface Booking {
  id: string;
  ref: string;
  status: string;
  statusLabel: string;
  items: Line[];
  itemCount: number;
  amount: number;
  commissionPct: number;
  commission: number;
  net: number;
  prepMinutes: number;
  estimatedReadyAt: string | null;
  timeline: Step[];
  proof: { hasImage: boolean; imageUrl: string | null; ref: string | null; submittedAt: string | null; attempts: number };
  rejection: { code: string | null; reason: string | null; at: string | null } | null;
  cancellation: { by: string | null; code: string | null; reason: string | null; at: string | null } | null;
  stall: { id: string; name: string; location: string | null } | null;
  customer: { id: string; name?: string | null; phone?: string | null };
  payeeUpiId: string | null;
  note: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
interface ListReply {
  bookings: Booking[];
  total: number;
  stats: { byStatus: Record<string, number>; open: number; paidAmount: number; commission: number };
  statusLabels: Record<string, string>;
  commissionPct: number;
}

const STATUSES = ['OPEN', 'PAYMENT_PENDING', 'PAYMENT_REVIEW', 'REJECTED', 'ACCEPTED', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED'];
const TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  PAYMENT_PENDING: 'neutral', PAYMENT_REVIEW: 'warning', REJECTED: 'danger', ACCEPTED: 'info', PREPARING: 'info', READY: 'success', COLLECTED: 'success', CANCELLED: 'danger',
};

export default function CampusBookingPage() {
  const { isAuthed } = useAdminAuth();
  const [tab, setTab] = useState<'bookings' | 'stalls'>('bookings');
  const [data, setData] = useState<ListReply | null>(null);
  const [stalls, setStalls] = useState<CampusStall[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [storeId, setStoreId] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Booking | null>(null);
  const [editStall, setEditStall] = useState<CampusStall | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: '100' });
      if (status) qs.set('status', status);
      if (storeId) qs.set('storeId', storeId);
      if (search.trim()) qs.set('q', search.trim());
      const [b, s] = await Promise.all([
        adminRequest<ListReply>(`/api/admin/campus-booking/bookings?${qs.toString()}`),
        adminRequest<{ stores: CampusStall[] }>('/api/admin/campus-booking/stores'),
      ]);
      setData(b);
      setStalls(s.stores);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load In-Campus Booking.');
    } finally {
      setLoading(false);
    }
  }, [status, storeId, search]);
  useEffect(() => { if (isAuthed) void load(); }, [isAuthed, load]);
  const liveRef = useRef(load);
  liveRef.current = load;
  useLiveSync(['campus_booking', 'store'], () => liveRef.current(), { enabled: isAuthed });

  useEffect(() => {
    if (!openId) { setDetail(null); return; }
    let alive = true;
    adminRequest<{ booking: Booking }>(`/api/admin/campus-booking/bookings/${openId}`)
      .then((r) => { if (alive) setDetail(r.booking); })
      .catch(() => { if (alive) setDetail(null); });
    return () => { alive = false; };
  }, [openId, data]);

  const columns: Column<Booking>[] = useMemo(() => [
    {
      key: 'ref', header: 'Booking', sortValue: (b) => b.ref,
      cell: (b) => (
        <div className="min-w-0">
          <p className="font-mono font-medium text-fg">{b.ref}</p>
          <p className="truncate text-xs text-fg-muted">{b.items.map((i) => `${i.quantity} ${i.name}`).join(', ')}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', sortValue: (b) => b.status, cell: (b) => <StatusPill status={b.status} tone={TONE[b.status]} label={b.statusLabel} /> },
    { key: 'stall', header: 'Stall', hideBelow: 'md', sortValue: (b) => b.stall?.name || '', cell: (b) => <span className="text-fg">{b.stall?.name || '–'}</span> },
    {
      key: 'student', header: 'Student', hideBelow: 'lg',
      cell: (b) => <div className="min-w-0"><p className="truncate text-fg">{b.customer.name || 'Student'}</p><p className="truncate text-xs text-fg-muted">{b.customer.phone || ''}</p></div>,
    },
    {
      key: 'amount', header: 'Amount / commission', align: 'right', sortValue: (b) => b.amount,
      cell: (b) => <div className="tabular-nums"><p className="text-fg">{formatINR(b.amount)}</p><p className="text-xs text-fg-muted">{formatINR(b.commission)} ZCS</p></div>,
    },
    { key: 'created', header: 'Booked', align: 'right', sortValue: (b) => (b.createdAt ? new Date(b.createdAt) : 0), cell: (b) => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDateTime(b.createdAt, { short: true })}</span> },
  ], []);

  const stallColumns: Column<CampusStall>[] = useMemo(() => [
    { key: 'name', header: 'Stall', sortValue: (s) => s.name, cell: (s) => <div className="min-w-0"><p className="truncate font-medium text-fg">{s.name}</p><p className="truncate text-xs text-fg-muted">{[s.category, s.location].filter(Boolean).join(' · ')}</p></div> },
    {
      key: 'state', header: 'In-Campus Booking', sortValue: (s) => Number(s.takingBookings),
      cell: (s) => (s.takingBookings ? <Badge tone="success" dot>Taking bookings</Badge> : s.enabled ? <Badge tone="warning" dot>Needs UPI ID</Badge> : <Badge tone="neutral" dot>Off</Badge>),
    },
    { key: 'upi', header: 'UPI ID', hideBelow: 'md', cell: (s) => <span className="font-mono text-sm text-fg">{s.upiId || '–'}</span> },
    { key: 'qr', header: 'QR', hideBelow: 'lg', cell: (s) => <span className="text-fg-muted">{s.qrUrl ? 'Photo' : 'From UPI ID'}</span> },
    { key: 'prep', header: 'Prep', align: 'right', hideBelow: 'lg', cell: (s) => <span className="tabular-nums text-fg-muted">{s.effectivePrepMinutes} min</span> },
    { key: 'open', header: 'Now', align: 'right', cell: (s) => <span className={s.isOpen ? 'text-success-text' : 'text-fg-muted'}>{s.isOpen ? 'Open' : 'Closed'}</span> },
  ], []);

  if (!isAuthed) return null; // AppShell shows the session check
  const st = data?.stats;
  const review = st?.byStatus.PAYMENT_REVIEW || 0;
  const onSaved = (s: CampusStall) => {
    setStalls((prev) => (prev ? prev.map((x) => (x.id === s.id ? s : x)) : prev));
    setEditStall(s);
  };

  return (
    <div>
      <PageHeader
        title="In-Campus Booking"
        description={`Pickup bookings at campus stalls. Students pay the stall directly by UPI (ZCS never holds the money); the stall checks the payment, prepares the order and hands it over with the student's pickup code. ZCS commission ${data?.commissionPct ?? 1.5}% is recorded on each booking.`}
        actions={<>
          <Button leftIcon={<IconRefresh size={14} />} onClick={load} loading={loading}>Refresh</Button>
          <Link href={ADD_STALL_HREF} className={buttonClass('primary', 'md', 'inline-flex items-center gap-1.5')}><IconPlus size={14} />Add campus stall</Link>
        </>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Open bookings" value={st ? st.open : '–'} loading={!st && loading} />
        <StatTile label="Payments to review" value={st ? review : '–'} tone={review ? 'warning' : 'neutral'} loading={!st && loading} />
        <StatTile label="Paid to stalls" value={st ? formatINR(st.paidAmount) : '–'} hint="Accepted and collected bookings" loading={!st && loading} />
        <StatTile label={`ZCS commission ${data?.commissionPct ?? 1.5}%`} value={st ? formatINR(st.commission) : '–'} hint="Recorded, not collected by ZCS at payment" loading={!st && loading} />
      </div>

      <Tabs
        className="mb-4"
        ariaLabel="In-Campus Booking sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'bookings', label: 'Bookings', count: data?.total ?? null, attention: review > 0 },
          { id: 'stalls', label: 'Stalls', count: stalls ? stalls.filter((s) => s.takingBookings).length : null },
        ]}
      />

      {tab === 'bookings' ? (
        <>
          <Toolbar end={<span className="text-sm text-fg-muted tabular-nums">{data ? `${data.bookings.length} of ${data.total}` : ''}</span>}>
            <SearchInput value={search} onChange={setSearch} placeholder="Booking ref, e.g. CB7K3F" />
            <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto min-w-[170px]">
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s === 'OPEN' ? 'Open (not finished)' : data?.statusLabels[s] || s}</option>)}
            </Select>
            <Select aria-label="Stall" value={storeId} onChange={(e) => setStoreId(e.target.value)} className="w-auto min-w-[190px]">
              <option value="">All stalls</option>
              {(stalls || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Toolbar>
          <DataTable
            caption="In-Campus Bookings"
            columns={columns}
            rows={data?.bookings || []}
            rowKey={(b) => b.id}
            loading={loading && !data}
            error={error || null}
            onRetry={load}
            onRowClick={(b) => setOpenId(b.id)}
            noun="bookings"
            resetPageKey={`${status}|${storeId}|${search}`}
            initialSort={{ key: 'created', dir: 'desc' }}
            empty={{ title: 'No In-Campus Bookings yet', description: 'Bookings appear here once a stall takes In-Campus Bookings and students book.' }}
          />
        </>
      ) : (
        <DataTable
          caption="Campus stalls"
          columns={stallColumns}
          rows={stalls || []}
          rowKey={(s) => s.id}
          loading={loading && !stalls}
          error={error || null}
          onRetry={load}
          onRowClick={(s) => setEditStall(s)}
          noun="stalls"
          initialSort={{ key: 'name', dir: 'asc' }}
          empty={{
            title: 'No campus stalls yet',
            description: 'Add a stall (it is a store of type "Local stall"), then switch In-Campus Booking on and add its UPI ID.',
            action: <Link href={ADD_STALL_HREF} className={buttonClass('primary', 'md', 'inline-flex items-center gap-1.5')}><IconPlus size={14} />Add campus stall</Link>,
          }}
        />
      )}

      <Drawer open={!!openId} onClose={() => setOpenId(null)} title={detail ? `Booking ${detail.ref}` : 'Booking'} description={detail ? `${detail.stall?.name || ''} · ${formatDateTime(detail.createdAt)}` : undefined} size="xl">
        {detail ? <BookingDetail b={detail} /> : <p className="text-sm text-fg-muted">Loading…</p>}
      </Drawer>
      <Drawer open={!!editStall} onClose={() => setEditStall(null)} title={editStall?.name || 'Stall'} description="In-Campus Booking: switch, UPI ID, QR and prep time" size="lg">
        {editStall ? <StallBookingSettings stall={editStall} onSaved={onSaved} /> : null}
      </Drawer>
    </div>
  );
}

function BookingDetail({ b }: { b: Booking }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={b.status} tone={TONE[b.status]} label={b.statusLabel} />
        {b.proof.attempts > 1 ? <Badge tone="warning">Proof sent {b.proof.attempts} times</Badge> : null}
      </div>
      <DescriptionList
        columns={2}
        items={[
          { label: 'Student', value: [b.customer.name, b.customer.phone].filter(Boolean).join(' · ') || b.customer.id },
          { label: 'Stall', value: b.stall?.name || '–' },
          { label: 'Amount paid to the stall', value: formatINR(b.amount) },
          { label: `ZCS commission ${b.commissionPct}%`, value: `${formatINR(b.commission)} (stall keeps ${formatINR(b.net)})` },
          { label: 'Paid to UPI ID', value: <span className="font-mono">{b.payeeUpiId || '–'}</span> },
          { label: 'UPI reference', value: <span className="font-mono">{b.proof.ref || 'Not given'}</span> },
          { label: 'Proof sent', value: b.proof.submittedAt ? formatDateTime(b.proof.submittedAt) : 'Not yet' },
          { label: 'Prep estimate', value: `${b.prepMinutes} min${b.estimatedReadyAt ? ` · ready by ${formatDateTime(b.estimatedReadyAt, { short: true })}` : ''}` },
          ...(b.rejection ? [{ label: 'Payment rejected', value: b.rejection.reason || '–' }] : []),
          ...(b.cancellation ? [{ label: `Cancelled by ${b.cancellation.by || '–'}`, value: b.cancellation.reason || '–' }] : []),
          ...(b.note ? [{ label: 'Student note', value: b.note }] : []),
        ]}
      />
      {b.proof.imageUrl ? (
        <div>
          <p className="mb-2 text-sm font-medium text-fg">Payment screenshot</p>
          {/* Private media: a short-lived signed link for this admin view. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={b.proof.imageUrl} alt="Payment screenshot" className="max-h-[420px] rounded-lg border border-line bg-surface-2 object-contain" />
        </div>
      ) : null}
      <div>
        <p className="mb-2 text-sm font-medium text-fg">Items</p>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {b.items.map((i, idx) => (
            <li key={idx} className="flex justify-between px-3 py-2 text-sm"><span>{i.quantity} × {i.name}</span><span className="tabular-nums">{formatINR(i.lineTotal)}</span></li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-fg">Progress</p>
        <ol className="space-y-1 text-sm">
          {b.timeline.map((s) => (
            <li key={s.key} className={s.done ? 'text-fg' : 'text-fg-muted'}>{s.done ? 'Done' : 'Waiting'} · {s.label}{s.at ? ` · ${formatDateTime(s.at, { short: true })}` : ''}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
