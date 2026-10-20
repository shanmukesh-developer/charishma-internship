"use client";

import { useEffect, useRef, useState } from 'react';
import { API_URL } from '@/lib/config';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { useAdminSocket } from '@/components/AdminSocketProvider';
import { useLiveSync } from '@/lib/useLiveSync';
import {
  Badge, Button, DataTable, DescriptionList, Drawer, Field, Input, Notice, PageHeader, SearchInput, Select, StatusPill, Toolbar,
  useConfirm, useToast, IconDownload, IconFile, IconRefresh, type Column,
} from '@/components/ui';
import { formatDateTime, formatINR, humanize, shortId } from '@/lib/format';

interface ServiceBooking {
  id: string;
  userId: string;
  serviceType: string;
  title: string;
  description?: string;
  specifications?: Record<string, unknown>;
  attachmentUrl?: string;
  status: string;
  quotedAmount?: number;
  finalAmount?: number;
  paymentStatus?: string;
  paymentMethod?: string;
  pickupSlot?: string;
  hostelBlock?: string;
  roomNumber?: string;
  deliveryAddress?: string;
  contactPhone?: string;
  assignedPartnerId?: string;
  driverDetails?: { name?: string; phone?: string } | null;
  trackingHistory?: { stage?: string; timestamp?: string; note?: string }[];
  createdAt: string;
  updatedAt: string;
}

const STATUSES = ['', 'REQUESTED', 'DIAGNOSED_QUOTED', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'];
// Same list as ServiceBooking.serviceType on the backend.
const SERVICE_TYPES = ['', 'LAPTOP_REPAIR', 'PHONE_REPAIR', 'MOBILE_REPAIR', 'TAILORING', 'PRINTOUT', 'LAUNDRY', 'ROOM_SHIFTING', 'AUTO_RIDE', 'BIKE_TAXI', 'STATION_CAB', 'CLEANING', 'PG_BOOKING', 'MATTRESS_DELIVERY', 'ELECTRONICS_DELIVERY', 'GROCERY_DELIVERY', 'PHARMACY_DELIVERY', 'GENERAL'];
const CLOSED_STATUSES = ['COMPLETED', 'CANCELLED'];

const money = (value?: number) => (value ? formatINR(value) : null);
const formatDate = (value?: string) => (value ? formatDateTime(value) : '');
const specLabel = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

async function readError(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) return 'Your session has expired. Please sign in again.';
  if (response.status >= 500) return `${fallback} (server error ${response.status}). Please try again.`;
  return (data && typeof data.message === 'string' && data.message) || `${fallback} (${response.status}).`;
}

const labelFor = (value: string) => humanize(value);

export default function ServiceBookingsPage() {
  const { isAuthed } = useAdminAuth();
  const [bookings, setBookings] = useState<ServiceBooking[]>([]);
  const [status, setStatus] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [hostelBlock, setHostelBlock] = useState('');
  const [search, setSearch] = useState('');
  const [refreshCount, setRefreshCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expanded = expandedId ? bookings.find(b => b.id === expandedId) || null : null;

  const { socket } = useAdminSocket();

  // The block filter is free text: query the server once typing pauses, not on every keystroke.
  const [blockQuery, setBlockQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setBlockQuery(hostelBlock.trim()), 400);
    return () => clearTimeout(t);
  }, [hostelBlock]);

  // Live reloads: the legacy socket events and `admin:changed` both fire for one change, so bursts are
  // coalesced into one quiet reload (no spinner) instead of one full reload per event.
  const quietReload = useRef(false);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveRefresh = useRef(() => {});
  liveRefresh.current = () => {
    if (liveTimer.current) return;
    liveTimer.current = setTimeout(() => {
      liveTimer.current = null;
      quietReload.current = true;
      setRefreshCount(count => count + 1);
    }, 800);
  };
  useEffect(() => () => { if (liveTimer.current) clearTimeout(liveTimer.current); }, []);

  // Reload when a booking is created or cancelled by a customer.
  useEffect(() => {
    if (!socket) return;
    const onChange = () => liveRefresh.current();
    socket.on('newServiceBooking', onChange);
    socket.on('serviceCancelled', onChange);
    socket.on('serviceQuoteAccepted', onChange);
    return () => {
      socket.off('newServiceBooking', onChange);
      socket.off('serviceCancelled', onChange);
      socket.off('serviceQuoteAccepted', onChange);
    };
  }, [socket]);

  // Realtime sync: the backend sends `admin:changed` { type: 'service_booking' } for bookings.
  useLiveSync(['service_booking'], () => liveRefresh.current(), { enabled: isAuthed });

  const replaceBooking = (updated: ServiceBooking) => setBookings(prev => prev.map(b => (b.id === updated.id ? { ...b, ...updated } : b)));

  useEffect(() => {
    const controller = new AbortController();
    const quiet = quietReload.current;
    quietReload.current = false;
    const loadBookings = async () => {
      if (!quiet) {
        setLoading(true);
        setError('');
      }
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (serviceType) params.set('serviceType', serviceType);
      if (blockQuery) params.set('hostelBlock', blockQuery);
      try {
        const response = await fetch(`${API_URL}/api/services/admin/all?${params.toString()}`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await readError(response, 'Could not load bookings'));
        const data = await response.json().catch(() => ({}));
        setBookings(Array.isArray(data.bookings) ? data.bookings : []);
      } catch (loadError) {
        if (!controller.signal.aborted) setError(loadError instanceof TypeError ? 'Could not reach the server. Check your connection and try again.' : loadError instanceof Error ? loadError.message : 'Could not load service bookings.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    loadBookings();
    return () => controller.abort();
  }, [status, serviceType, blockQuery, refreshCount]);

  const filtered = bookings.filter(booking => {
    const query = search.trim().toLowerCase();
    return !query || [booking.id, booking.title, booking.serviceType, booking.hostelBlock, booking.contactPhone, booking.userId]
      .some(value => value != null && String(value).toLowerCase().includes(query));
  });

  if (!isAuthed) return null; // AppShell shows the session check

  const columns: Column<ServiceBooking>[] = [
    {
      key: 'title',
      header: 'Booking',
      sortValue: b => b.title,
      cell: b => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{b.title}</p>
          <p className="truncate text-xs text-fg-muted">
            <span className="font-mono">{shortId(b.id)}</span> · {labelFor(b.serviceType)}
            {hasDocument(b) && <> · PDF attached</>}
          </p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', sortValue: b => b.status, cell: b => <StatusPill status={b.status} /> },
    {
      key: 'student',
      header: 'Student',
      hideBelow: 'lg',
      cell: b => (
        <div className="min-w-0">
          <p className="truncate text-fg">{b.contactPhone || b.userId}</p>
          <p className="truncate text-xs text-fg-muted">{[b.hostelBlock, b.roomNumber].filter(Boolean).join(' · ') || b.deliveryAddress || 'No pickup place'}</p>
        </div>
      ),
    },
    { key: 'slot', header: 'Slot', hideBelow: 'xl', cell: b => <span className="text-fg-muted">{b.pickupSlot || '–'}</span> },
    {
      key: 'amount',
      header: 'Quote / final',
      align: 'right',
      sortValue: b => b.finalAmount || b.quotedAmount || 0,
      cell: b => (
        <div className="tabular-nums">
          <p className="text-fg">{money(b.quotedAmount) || <span className="text-fg-muted">Quote pending</span>}</p>
          <p className="text-xs text-fg-muted">{money(b.finalAmount) || '–'}</p>
        </div>
      ),
    },
    {
      key: 'created',
      header: 'Booked',
      align: 'right',
      sortValue: b => new Date(b.createdAt),
      cell: b => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDate(b.createdAt)}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Services"
        description="Repair, laundry, printout, ride and other campus service requests: send quotes and move them through their stages. All bookings are cash on delivery."
        actions={
          <Button leftIcon={<IconRefresh size={14} />} onClick={() => setRefreshCount(value => value + 1)} loading={loading}>
            Refresh
          </Button>
        }
      />

      <Toolbar end={<span className="text-sm text-fg-muted tabular-nums">{filtered.length} of {bookings.length} bookings</span>}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search title, phone or ID" />
        <Select aria-label="Status" value={status} onChange={event => setStatus(event.target.value)} className="w-auto min-w-[160px]">
          <option value="">All statuses</option>
          {STATUSES.filter(Boolean).map(value => <option key={value} value={value}>{labelFor(value)}</option>)}
        </Select>
        <Select aria-label="Service type" value={serviceType} onChange={event => setServiceType(event.target.value)} className="w-auto min-w-[170px]">
          <option value="">All service types</option>
          {SERVICE_TYPES.filter(Boolean).map(value => <option key={value} value={value}>{labelFor(value)}</option>)}
        </Select>
        <Input aria-label="Hostel block" value={hostelBlock} onChange={event => setHostelBlock(event.target.value)} placeholder="Hostel block" className="w-36" />
      </Toolbar>

      <DataTable
        caption="Service bookings"
        columns={columns}
        rows={filtered}
        rowKey={b => b.id}
        loading={loading}
        error={error || null}
        onRetry={() => setRefreshCount(value => value + 1)}
        onRowClick={b => setExpandedId(b.id)}
        noun="bookings"
        resetPageKey={`${search}|${status}|${serviceType}|${blockQuery}`}
        initialSort={{ key: 'created', dir: 'desc' }}
        empty={{ title: 'No matching service bookings', description: 'Requests appear here when students book a campus service.' }}
      />

      <Drawer
        open={!!expanded}
        onClose={() => setExpandedId(null)}
        title={expanded?.title || 'Booking'}
        description={expanded ? `${shortId(expanded.id)} · ${labelFor(expanded.serviceType)} · booked ${formatDate(expanded.createdAt)}` : undefined}
        size="xl"
      >
        {expanded && <BookingDetails booking={expanded} />}
        {/* keyed by updatedAt: a live change (customer cancel / quote accepted) resets the form to the real stage */}
        {expanded && <BookingActions key={`${expanded.id}-${expanded.updatedAt}`} booking={expanded} onUpdated={replaceBooking} />}
      </Drawer>
    </div>
  );
}

const SPEC_HIDDEN = ['catalogueItemId', 'documentName'];
const specEntries = (booking: ServiceBooking) =>
  Object.entries(booking.specifications || {}).filter(([key, value]) => !SPEC_HIDDEN.includes(key) && value !== null && value !== '' && typeof value !== 'object');

/** Print jobs can carry a PDF; the server lists its name in specifications.documentName. */
const hasDocument = (booking: ServiceBooking) => {
  const s = booking.specifications || {};
  return typeof s.documentName === 'string' ? s.documentName.trim() !== '' : !!(s.document && typeof s.document === 'object');
};

const fileNameFrom = (header: string | null, fallback: string) => {
  const m = header ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header) : null;
  try { return m ? decodeURIComponent(m[1]) : fallback; } catch { return m ? m[1] : fallback; }
};

/** GET /api/services/:id/document with the admin session (the fetch interceptor adds the token). */
function DownloadPdfButton({ booking }: { booking: ServiceBooking }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/services/${encodeURIComponent(booking.id)}/document`, { cache: 'no-store' });
      if (!response.ok) throw new Error(await readError(response, 'Could not download the PDF'));
      const blob = await response.blob();
      const fallback = String(booking.specifications?.documentName || `booking-${booking.id.slice(-8)}.pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileNameFrom(response.headers.get('Content-Disposition'), fallback);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      toast.error(e instanceof TypeError ? 'Could not reach the server. Check your connection and try again.' : e instanceof Error ? e.message : 'Could not download the PDF.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" leftIcon={<IconDownload size={14} />} loading={busy} onClick={download}>
      Download PDF
    </Button>
  );
}

function BookingDetails({ booking }: { booking: ServiceBooking }) {
  const specs = specEntries(booking);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={booking.status} />
        <Badge>{labelFor(booking.serviceType)}</Badge>
      </div>

      {hasDocument(booking) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-2/50 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <IconFile size={16} className="shrink-0 text-fg-subtle" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">{String(booking.specifications?.documentName || 'Attached PDF')}</p>
              <p className="text-xs text-fg-muted">PDF to print, uploaded by the student</p>
            </div>
          </div>
          <DownloadPdfButton booking={booking} />
        </div>
      )}

      <DescriptionList
        columns={2}
        items={[
          { label: 'Student', value: booking.contactPhone || booking.userId },
          { label: 'Pickup', value: [booking.hostelBlock, booking.roomNumber].filter(Boolean).join(' · ') || booking.deliveryAddress || 'Not specified' },
          { label: 'Slot', value: booking.pickupSlot || 'Not specified' },
          { label: 'Quote / final', value: `${money(booking.quotedAmount) || 'Quote pending'} / ${money(booking.finalAmount) || '–'}` },
          { label: 'Payment', value: `${booking.paymentMethod && booking.paymentMethod !== 'COD' ? `${booking.paymentMethod} (legacy)` : 'Cash on delivery'} · ${labelFor(booking.paymentStatus || 'Pending')}` },
          { label: 'Assigned partner', value: booking.driverDetails?.name || booking.assignedPartnerId || 'Unassigned' },
        ]}
      />

      <div>
        <p className="text-xs text-fg-muted">Description</p>
        <p className="mt-0.5 whitespace-pre-wrap text-sm text-fg">{booking.description || 'No description provided.'}</p>
      </div>

      {booking.attachmentUrl && <Attachment url={booking.attachmentUrl} id={booking.id} />}

      <div>
        <p className="mb-1 text-xs text-fg-muted">Specifications</p>
        {specs.length ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-line bg-surface-2/50 p-3 text-sm">
            {specs.map(([key, value]) => (
              <div key={key} className="contents"><dt className="text-fg-muted">{specLabel(key)}</dt><dd className="break-words text-fg">{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}</dd></div>
            ))}
          </dl>
        ) : <p className="text-sm text-fg-muted">None</p>}
      </div>

      <div>
        <p className="mb-2 text-xs text-fg-muted">Tracking history</p>
        <ol className="space-y-3">
          {(booking.trackingHistory || []).map((event, index) => (
            <li key={`${event.timestamp || ''}-${index}`} className="border-l-2 border-line pl-3">
              <p className="text-sm text-fg"><span className="font-medium">{event.stage ? labelFor(event.stage) : 'Update'}</span><span className="ml-2 text-xs text-fg-muted">{formatDate(event.timestamp)}</span></p>
              {event.note && <p className="mt-0.5 text-sm text-fg-muted">{event.note}</p>}
            </li>
          ))}
          {!booking.trackingHistory?.length && <li className="text-sm text-fg-muted">No tracking events recorded.</li>}
        </ol>
      </div>
    </div>
  );
}

/**
 * The customer app sends photos inline as data: URLs. Browsers block opening a data: URL in a new tab,
 * so show the photo here and offer a download instead.
 */
function Attachment({ url, id }: { url: string; id: string }) {
  const isDataImage = /^data:image\//i.test(url);
  const isHttp = /^https?:\/\//i.test(url);
  if (isDataImage) {
    const ext = (/^data:image\/(\w+)/i.exec(url)?.[1] || 'jpg').toLowerCase();
    return (
      <div className="space-y-2">
        <p className="text-xs text-fg-muted">Attachment</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} loading="lazy" decoding="async" alt="Photo attached by the customer" className="max-h-64 rounded-md border border-line object-contain" />
        <a className="inline-block text-sm font-medium text-accent-text hover:underline" href={url} download={`booking-${id.slice(-8)}.${ext === 'jpeg' ? 'jpg' : ext}`}>Download photo</a>
      </div>
    );
  }
  if (isHttp) return <a className="inline-block text-sm font-medium text-accent-text hover:underline" href={url} target="_blank" rel="noreferrer">Open attachment</a>;
  return null;
}

/** Admin update: stage, quote / final amount and a note for the customer (PATCH /api/services/:id/status). */
function BookingActions({ booking, onUpdated }: { booking: ServiceBooking; onUpdated: (b: ServiceBooking) => void }) {
  const confirm = useConfirm();
  const [nextStatus, setNextStatus] = useState(booking.status);
  const [quoted, setQuoted] = useState(booking.quotedAmount ? String(booking.quotedAmount) : '');
  const [finalAmount, setFinalAmount] = useState(booking.finalAmount ? String(booking.finalAmount) : '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const closed = CLOSED_STATUSES.includes(booking.status);

  const amount = (value: string, label: string) => {
    if (value.trim() === '') return { value: undefined };
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100000) return { error: `${label} must be between ₹0 and ₹1,00,000.` };
    return { value: Math.round(n * 100) / 100 };
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const q = amount(quoted, 'Quote');
    const f = amount(finalAmount, 'Final amount');
    if (q.error || f.error) return setMessage({ kind: 'error', text: (q.error || f.error) as string });
    const statusChanged = nextStatus !== booking.status;
    const quoteChanged = q.value !== undefined && q.value !== (booking.quotedAmount || 0);
    const finalChanged = f.value !== undefined && f.value !== (booking.finalAmount || 0);
    if (!statusChanged && !quoteChanged && !finalChanged && !note.trim()) return setMessage({ kind: 'error', text: 'Nothing to update.' });
    if (nextStatus === 'CANCELLED' && statusChanged && !(await confirm({ title: 'Cancel this booking?', description: 'The customer will see it as cancelled.', confirmLabel: 'Cancel booking', cancelLabel: 'Keep booking', tone: 'danger' }))) return;
    if (nextStatus === 'DIAGNOSED_QUOTED' && statusChanged && !(q.value || booking.quotedAmount)) return setMessage({ kind: 'error', text: 'Enter the quote before sending it to the customer.' });

    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_URL}/api/services/${booking.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(statusChanged ? { status: nextStatus } : {}),
          ...(quoteChanged ? { quotedAmount: q.value } : {}),
          ...(finalChanged ? { finalAmount: f.value } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not update the booking'));
      const data = await response.json().catch(() => ({}));
      if (data?.booking) onUpdated(data.booking);
      setNote('');
      setMessage({ kind: 'ok', text: 'Booking updated. Customers with the app open see the change right away.' });
    } catch (updateError) {
      setMessage({ kind: 'error', text: updateError instanceof TypeError ? 'Could not reach the server. Check your connection and try again.' : updateError instanceof Error ? updateError.message : 'Could not update the booking.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="mt-6 space-y-4 border-t border-line pt-6" aria-label="Update booking">
      <div>
        <h3 className="text-sm font-semibold text-fg">Update booking</h3>
        {closed && <p className="mt-0.5 text-xs text-fg-muted">This booking is {labelFor(booking.status).toLowerCase()}. You can still correct the amounts or add a note.</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Stage">
          <Select value={nextStatus} onChange={event => setNextStatus(event.target.value)}>
            {STATUSES.filter(Boolean).map(value => <option key={value} value={value}>{labelFor(value)}</option>)}
          </Select>
        </Field>
        <Field label="Quote" optional>
          <Input prefix="₹" inputMode="decimal" value={quoted} onChange={event => setQuoted(event.target.value)} placeholder="Quote pending" />
        </Field>
        <Field label="Final amount" optional hint="Set when the job is completed.">
          <Input prefix="₹" inputMode="decimal" value={finalAmount} onChange={event => setFinalAmount(event.target.value)} />
        </Field>
        <Field label="Note to customer" optional>
          <Input value={note} maxLength={300} onChange={event => setNote(event.target.value)} />
        </Field>
      </div>
      {message && (
        <Notice tone={message.kind === 'error' ? 'danger' : 'success'}>
          <span className="text-fg">{message.text}</span>
        </Notice>
      )}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={saving}>{saving ? 'Saving…' : 'Save update'}</Button>
      </div>
    </form>
  );
}
