"use client";
import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useAdminSocket } from '@/components/AdminSocketProvider';
import dynamic from 'next/dynamic';
import { useAdminAuth } from '@/utils/useAdminAuth';
import PaymentVerificationModal from '@/components/PaymentVerificationModal';
import { API_URL } from '@/lib/config';
import { adminRequest as apiRequest } from '@/lib/api';
import Link from 'next/link';
import { useLiveSync, useFreshIds, liveLabel, FRESH_ROW_CLASS } from '@/lib/useLiveSync';
import { useVisibleInterval } from '@/lib/useVisibleInterval';
import { peekCachedJson } from '@/lib/requestCache';
import { useRouter } from 'next/navigation';
import {
  Badge, Button, ButtonLink, Card, CardHeader, DataTable, EmptyState, Field, Notice, PageHeader,
  SegmentedControl, Skeleton, StatusDot, StatusPill, Textarea, useConfirm, type Column,
  IconChevronRight,
} from '@/components/ui';
import { formatINR, formatRelative, formatTime, humanize } from '@/lib/format';

// "Needs attention" counters on the overview, kept live by realtime events.
type LegacyInboxKey = 'tickets' | 'verifications' | 'pgBookings' | 'wallPending' | 'serviceRequests' | 'stuckStallOrders';
// Added by the backend's extended /api/admin/attention-counts (null / missing on older servers).
type ExtraInboxKey = 'riderApprovals' | 'payoutsPending' | 'autoDrivers' | 'autoVehicles' | 'eventsToReview' | 'rentalListings' | 'rentalLicences' | 'rentalReports' | 'rentalDisputes' | 'friendsReports' | 'friendsAppeals';
type InboxKey = LegacyInboxKey | ExtraInboxKey;
type Inbox = Record<InboxKey, number | null>;
/** Keys whose number is a lower bound (the fallback list hit its server cap): shown as "N+". */
type InboxCapped = Partial<Record<InboxKey, boolean>>;
const INBOX_ITEMS: { key: InboxKey; label: string; area: string; href: string; liveType: string; urgent?: boolean }[] = [
  { key: 'stuckStallOrders', label: 'Stall orders stuck for more than 6 hours', area: 'Orders', href: '/orders?stuck=6', liveType: 'order', urgent: true },
  { key: 'tickets', label: 'Open support tickets', area: 'Customers', href: '/tickets', liveType: 'ticket' },
  { key: 'riderApprovals', label: 'Rider sign-ups to approve', area: 'Riders', href: '/fleet?filter=pending', liveType: 'rider' },
  { key: 'payoutsPending', label: 'Payouts to mark as paid', area: 'Payments', href: '/finance?tab=payouts', liveType: 'payout' },
  { key: 'verifications', label: 'Student IDs to review', area: 'Customers', href: '/student-verification', liveType: 'verification' },
  { key: 'friendsReports', label: 'Reports to review', area: 'Community', href: '/moderation', liveType: 'friends_report' },
  { key: 'friendsAppeals', label: 'Appeals to decide', area: 'Community', href: '/moderation?tab=appeals', liveType: 'friends_appeal' },
  { key: 'wallPending', label: 'Wall photos to approve', area: 'Community', href: '/wall', liveType: 'wall_submission' },
  { key: 'pgBookings', label: 'PG booking requests', area: 'PG and hostels', href: '/pg?tab=bookings', liveType: 'pg_booking' },
  { key: 'serviceRequests', label: 'New service bookings', area: 'Services', href: '/service-bookings', liveType: 'service_booking' },
  { key: 'autoDrivers', label: 'Auto drivers to verify', area: 'Auto-ride', href: '/auto-ride?tab=drivers', liveType: 'auto_driver' },
  { key: 'autoVehicles', label: 'Auto vehicles to verify', area: 'Auto-ride', href: '/auto-ride?tab=vehicles', liveType: 'auto_driver' },
  { key: 'eventsToReview', label: 'Events submitted for review', area: 'Events', href: '/campus-events?tab=review', liveType: 'campus_event_admin' },
  { key: 'rentalListings', label: 'Rental listings to review', area: 'Rentals', href: '/rentals?tab=listings', liveType: 'rental' },
  { key: 'rentalLicences', label: 'Driving licences to verify', area: 'Rentals', href: '/rentals?tab=licences', liveType: 'rental' },
  { key: 'rentalReports', label: 'Rental reports to handle', area: 'Rentals', href: '/rentals?tab=reports', liveType: 'rental' },
  { key: 'rentalDisputes', label: 'Disputed rental charges', area: 'Rentals', href: '/rentals?tab=disputes', liveType: 'rental' },
];
const EMPTY_INBOX: Inbox = Object.fromEntries(INBOX_ITEMS.map(i => [i.key, null])) as Inbox;
// Every queue's live type (and the realtime names some modules use), so a new item lights its row at once; the
// inbox is also polled with the feed (some queues have no live event at all).
const LIVE_HOME_TYPES = [...new Set([
  'order', 'rider', 'store', 'ticket', 'verification', 'pg_booking', 'wall_submission', 'wall', 'service_booking',
  ...INBOX_ITEMS.map(i => i.liveType), 'rental_booking', 'friends_review',
])];

// Leaflet (~150 KB) loads only with the map; a skeleton holds the space meanwhile.
const LiveFleetMap = dynamic(() => import('@/components/LiveFleetMap'), {
  ssr: false,
  loading: () => <div className="w-full h-full rounded-lg bg-surface-2 animate-pulse" aria-label="Loading the fleet map" />,
});

// Route reference points drawn on the fleet map (real places on the Mangalagiri → SRM AP route).
const CHECKPOINTS = [
  { name: 'Mangalagiri Jn', lat: 16.4422, lng: 80.5604 },
  { name: 'Neerukonda', lat: 16.4715, lng: 80.5055 },
  { name: 'SRM Main Gate', lat: 16.4673, lng: 80.5002 },
  { name: 'Academic Block', lat: 16.4635, lng: 80.5065 },
  { name: 'Hostel Sector', lat: 16.4618, lng: 80.5068 }
];

const ORDER_FEED_LIMIT = 40;
const ORDERS_PATH = `/api/orders?limit=${ORDER_FEED_LIMIT}`;
const STATS_PATH = '/api/admin/stats';
/** Fallback polling: frequent only while the live socket is down; slow safety net otherwise. */
const POLL_OFFLINE_MS = 15000;
const POLL_LIVE_MS = 60000;

/** fetch against the one backend; throws an Error carrying the server's friendly `message`. */
const errMsg = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

const toNumber = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ─── Types ───────────────────────────────────────────────────
interface AdminStat {
  label: string;
  value: string;
  hint: string;
}

interface LiveOrder {
  id: string;
  kind: 'order';
  customer: string;
  location: string;
  status: string;
  price: number;
  restaurant: string;
  timestamp: Date;
  paymentMethod: string;
  upiStatus?: string;
  upiUTR?: string;
  upiScreenshot?: string;
  riderAssigned: boolean;
  deliveryPartnerName?: string;
  deliveryPartnerPhoto?: string;
}

interface RiderPosition {
  riderId: string;
  riderName: string;
  photoUrl?: string;
  currentCheckpoint?: string;
  activeOrderCount: number;
  isOnline: boolean;
  /** Last real GPS fix from admin_rider_location (absent until the rider app sends one). */
  lat?: number;
  lng?: number;
  /** ms timestamp of that fix. */
  locatedAt?: number;
}

interface OperationalEvent {
  id: string;
  type: 'SOS' | 'ISSUE';
  senderRole: string;
  senderName?: string;
  issueType?: string;
  details: string;
  orderId?: string;
  timestamp: Date;
}

interface InterceptedChat {
  orderId: string;
  sender: string;
  senderRole: string;
  message: string;
  timestamp: Date;
}

const mapOrder = (o: any): LiveOrder => ({
  id: String(o.id || o._id),
  kind: 'order',
  customer: o.user?.name || 'Customer',
  location: o.hostelGateDelivery ? 'Hostel gate' : 'Room delivery',
  status: String(o.status || 'Pending'),
  price: toNumber(o.finalPrice ?? o.totalPrice),
  restaurant: o.restaurant?.name || 'Store',
  timestamp: new Date(o.createdAt || Date.now()),
  paymentMethod: String(o.paymentMethod || 'COD'),
  upiStatus: o.upiStatus ? String(o.upiStatus) : undefined,
  upiUTR: o.upiUTR || undefined,
  upiScreenshot: o.upiScreenshot || undefined,
  riderAssigned: !!(o.deliveryPartnerId || o.deliveryPartner),
  deliveryPartnerName: o.deliveryPartner?.name,
  deliveryPartnerPhoto: o.deliveryPartner?.photoUrl,
});

// Legacy UPI orders (before COD + Wallet only) can still be waiting for a manual check.
const needsUpiCheck = (o: LiveOrder) => o.kind === 'order' && o.paymentMethod === 'UPI' && o.upiStatus === 'Pending';

const shortId = (id?: string) => (id ? `#${String(id).slice(-6).toUpperCase()}` : '');

const toStats = (data: any): AdminStat[] => [
  { label: 'Delivered revenue', value: formatINR(data?.revenue ?? 0), hint: 'All delivered orders' },
  { label: 'Open order value', value: formatINR(data?.activeRevenue ?? 0), hint: `${data?.activeOrders || 0} open orders` },
  { label: 'Approved riders', value: String(data?.activeFleet ?? '0'), hint: 'Riders allowed to deliver' },
  { label: 'Commission', value: formatINR(data?.commission ?? 0), hint: 'Estimated at 10%' },
  { label: 'Local vendors', value: String(data?.localVendorCount ?? '0'), hint: 'Active stalls' },
];

const toFeed = (ordersData: { orders?: any[] } | null): LiveOrder[] => {
  const orders = (Array.isArray(ordersData?.orders) ? ordersData!.orders! : []).map(mapOrder);
  return orders
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, ORDER_FEED_LIMIT);
};

/** Last numbers/feed this tab loaded (stale-while-revalidate): painted at once, then refreshed. */
const peekStats = () => {
  const d = peekCachedJson<any>(STATS_PATH, API_URL);
  return d ? toStats(d) : null;
};
const peekFeed = () => {
  const o = peekCachedJson<{ orders?: any[] }>(ORDERS_PATH, API_URL);
  return o ? toFeed(o) : null;
};

// ─── Presentational pieces ─────────────────────────────────

const RiderRow = memo(({ rider }: { rider: RiderPosition }) => (
  <li className="flex items-center gap-3 px-4 py-2.5">
    <StatusDot tone={rider.isOnline ? 'success' : 'neutral'} label={rider.isOnline ? 'Online' : 'Offline'} />
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm text-fg">{rider.riderName}</p>
      <p className="truncate text-xs text-fg-muted">
        {rider.isOnline ? (rider.currentCheckpoint ? `Near ${rider.currentCheckpoint}` : 'Online') : 'Offline'}
      </p>
    </div>
    <span className="shrink-0 text-xs tabular-nums text-fg-muted">{rider.activeOrderCount || 0} active</span>
  </li>
));
RiderRow.displayName = 'RiderRow';

const EventAlert = memo(({ event, onResolve }: { event: OperationalEvent, onResolve: (id: string) => void }) => (
  <Notice
    tone={event.type === 'SOS' ? 'danger' : 'warning'}
    title={`${event.type === 'SOS' ? 'SOS from' : 'Issue reported by'} ${event.senderRole.toLowerCase()}${event.senderName ? ` ${event.senderName}` : ''} · ${formatTime(event.timestamp)}`}
    onClose={() => onResolve(event.id)}
  >
    <span className="text-fg">{event.issueType || event.details}</span>
    {event.issueType && event.details && <span className="block">{event.details}</span>}
    {event.orderId && <span className="block">Order {shortId(event.orderId)}</span>}
  </Notice>
));
EventAlert.displayName = 'EventAlert';

export default function AdminHome() {
  const { isAuthed } = useAdminAuth();
  const { socket, isConnected, notifyLive } = useAdminSocket();
  const { mark: markFresh, isFresh } = useFreshIds();
  const confirm = useConfirm();
  const router = useRouter();
  const [inbox, setInbox] = useState<Inbox>(EMPTY_INBOX);
  const [inboxLoaded, setInboxLoaded] = useState(false);
  const [freshInbox, setFreshInbox] = useState<Partial<Record<InboxKey, boolean>>>({});
  const [inboxCapped, setInboxCapped] = useState<InboxCapped>({});

  const [stats, setStats] = useState<AdminStat[] | null>(peekStats);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [liveOrders, setLiveOrders] = useState<LiveOrder[]>(() => peekFeed() || []);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [riders, setRiders] = useState<Record<string, RiderPosition>>({});
  const [operationalEvents, setOperationalEvents] = useState<OperationalEvent[]>([]);
  const [interceptedChats, setInterceptedChats] = useState<InterceptedChat[]>([]);
  const [loading, setLoading] = useState(() => peekFeed() === null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const [megaMsg, setMegaMsg] = useState('');
  const [megaType, setMegaType] = useState<'info' | 'warning' | 'promo' | 'emergency'>('info');
  const [broadcasting, setBroadcasting] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [selectedUPIOrder, setSelectedUPIOrder] = useState<LiveOrder | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiRequest<any>(STATS_PATH);
      setStats(toStats(data));
      setStatsError(null);
    } catch (err) {
      setStatsError(errMsg(err, 'Could not load dashboard numbers.'));
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    try {
      const ordersData = await apiRequest<{ orders?: any[] }>(ORDERS_PATH);
      setLiveOrders(toFeed(ordersData));
      setOrdersError(null);
    } catch (err) {
      setOrdersError(errMsg(err, 'Could not load recent orders.'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Seed the rider list from the database; sockets keep it live afterwards.
  const fetchRiders = useCallback(async () => {
    try {
      // Every approved rider, normally in one request of up to 500 (more pages, capped at 20, only beyond that).
      // Page 1 tells us the page count; the rest are fetched in parallel instead of one after another.
      // Approved riders only (server-side filter): unapproved sign-ups were downloaded and then dropped.
      const riderPage = (page: number) => apiRequest<{ riders?: any[]; pages?: number }>(`/api/admin/riders?approved=1&limit=500&page=${page}`);
      const first = await riderPage(1);
      const list: any[] = Array.isArray(first?.riders) ? [...first.riders] : [];
      const pages = Math.min(20, Number(first?.pages) || 1);
      if (pages > 1) { // pages is counted by the server at its own page size (500 now, 100 on older servers)
        const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => riderPage(i + 2)));
        rest.forEach(d => { if (Array.isArray(d?.riders)) list.push(...d.riders); });
      }
      setRiders(prev => {
        const next: Record<string, RiderPosition> = { ...prev };
        list.filter(r => r.isApproved).forEach(r => {
          const id = String(r.id || r._id);
          const existing: RiderPosition | undefined = prev[id];
          next[id] = {
            ...existing,
            activeOrderCount: existing?.activeOrderCount ?? 0,
            riderId: id,
            riderName: r.name || 'Rider',
            photoUrl: r.photoUrl || undefined,
            isOnline: existing?.isOnline ?? !!r.isOnline,
          };
        });
        return next;
      });
    } catch {
      // Non-critical: the live socket events still populate riders.
    }
  }, []);

  // Counts for the "Needs attention" strip: one request, SQL COUNTs on the server
  // (GET /api/admin/attention-counts). A queue the server could not count stays "–".
  const fetchInbox = useCallback(async () => {
    try {
      const d = await apiRequest<Partial<Record<InboxKey, number | null>>>('/api/admin/attention-counts', { cache: 'reload' });
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      setInbox(prev => {
        const next = { ...prev };
        // Keep the last known number when one queue could not be counted this time.
        (Object.keys(next) as InboxKey[]).forEach(k => { const v = num(d?.[k]); if (v !== null || prev[k] === null) next[k] = v; });
        return next;
      });
      setInboxCapped({});
      setInboxLoaded(true);
      return;
    } catch {
      // Older backend without the counts endpoint: count the (capped) lists instead, below.
    }
    const LIST_CAP: Partial<Record<InboxKey, number>> = { verifications: 100, pgBookings: 200, serviceRequests: 100 };
    const count = (v: unknown) => (Array.isArray(v) ? v.length : null);
    const jobs: Record<LegacyInboxKey, Promise<number | null>> = {
      tickets: apiRequest<any[]>('/api/tickets/admin')
        .then(list => (Array.isArray(list) ? list.filter(t => t?.status === 'Open' || t?.status === 'In Progress').length : null)),
      verifications: apiRequest<{ requests?: unknown[] }>('/api/campus/verify/requests?status=pending').then(d => count(d?.requests)),
      pgBookings: apiRequest<unknown[]>('/api/pg/admin/bookings?status=Pending').then(count),
      wallPending: apiRequest<unknown[]>('/api/wall/admin/pending').then(count),
      serviceRequests: apiRequest<{ bookings?: unknown[] }>('/api/services/admin/all?status=REQUESTED').then(d => count(d?.bookings)),
      stuckStallOrders: apiRequest<{ total?: number }>('/api/admin/orders?stuckHours=6&limit=1').then(d => (typeof d?.total === 'number' ? d.total : null)),
    };
    const keys = Object.keys(jobs) as LegacyInboxKey[];
    const results = await Promise.allSettled(keys.map(k => jobs[k]));
    const capped: InboxCapped = {};
    setInbox(prev => {
      const next = { ...prev };
      keys.forEach((k, i) => {
        const r = results[i];
        if (r.status === 'fulfilled') {
          next[k] = r.value;
          const cap = LIST_CAP[k];
          if (cap && r.value !== null && r.value >= cap) capped[k] = true;
        } else if (prev[k] === null) next[k] = null;
      });
      return next;
    });
    setInboxCapped(capped);
    setInboxLoaded(true);
  }, []);

  const inboxFreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (inboxFreshTimer.current) clearTimeout(inboxFreshTimer.current); }, []);

  const lastStatsUpdate = useRef(0);
  const lastRidersFetch = useRef(0);
  const ridersTrailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (ridersTrailing.current) clearTimeout(ridersTrailing.current); }, []);
  const throttledFetchStats = useCallback(() => {
    const now = Date.now();
    if (now - lastStatsUpdate.current > 10000) {
      fetchStats();
      lastStatsUpdate.current = now;
    }
  }, [fetchStats]);

  // Called by PaymentVerificationModal; returns an error message (modal stays open) or null.
  const handleVerifyUPI = async (orderId: string, isVerified: boolean): Promise<string | null> => {
    setActionError(null);
    setActionNotice(null);
    try {
      const res = await apiRequest<{ message?: string }>(`/api/orders/${orderId}/verify-upi`, {
        method: 'PUT',
        body: JSON.stringify({ isVerified }),
      });
      setActionNotice(res?.message || (isVerified ? 'Payment verified.' : 'Payment rejected and order cancelled.'));
      fetchOrders();
      fetchStats();
      return null;
    } catch (err) {
      return errMsg(err, 'Could not update the payment.');
    }
  };

  const handleVerifyRequest = useCallback((o: LiveOrder) => setSelectedUPIOrder(o), []);

  const handleAcceptAllPending = async () => {
    if (batchRunning) return;
    if (!(await confirm({
      title: 'Accept all pending orders?',
      description: 'Every pending ZenWe-delivered order is accepted on behalf of its store and sent to riders. Stall orders (the stall confirms and delivers them itself) and legacy UPI orders whose payment is not verified are skipped; handle those on the Orders page. Use this only when stores cannot accept in their app. It cannot be undone.',
      confirmLabel: 'Accept all pending',
      tone: 'danger',
    }))) return;
    setBatchRunning(true);
    setActionError(null);
    setActionNotice(null);
    try {
      // Accepted one by one through the normal accept endpoint (same checks, rider pool and pushes as
      // a single accept) instead of the bulk status flip, so nothing unpaid or stall-owned slips through.
      const data = await apiRequest<{ orders?: any[] }>('/api/orders?status=Pending&fulfilment=ZENVY&limit=200');
      const pending = (Array.isArray(data?.orders) ? data.orders : []).filter(o => o?.status === 'Pending');
      const eligible = pending.filter(o => o.fulfilment !== 'VENDOR' && !(o.paymentMethod === 'UPI' && o.upiStatus !== 'Verified' && o.paymentStatus !== 'Completed'));
      const skippedUpi = pending.length - eligible.length;
      let accepted = 0;
      let failed = 0;
      for (const o of eligible) {
        try {
          await apiRequest(`/api/orders/${encodeURIComponent(String(o.id || o._id))}/restaurant-accept`, { method: 'PUT', body: JSON.stringify({}) });
          accepted++;
        } catch {
          failed++;
        }
      }
      const parts = [`${accepted} pending order${accepted === 1 ? '' : 's'} accepted.`];
      if (skippedUpi) parts.push(`${skippedUpi} skipped (UPI payment not verified).`);
      if (failed) parts.push(`${failed} could not be accepted (already changed or refused); check the Orders page.`);
      parts.push('Stall orders were not touched.');
      if (failed) setActionError(parts.join(' ')); else setActionNotice(parts.join(' '));
      fetchOrders();
      fetchStats();
    } catch (err) {
      setActionError(errMsg(err, 'Could not accept the pending orders.'));
    } finally {
      setBatchRunning(false);
    }
  };

  const handleBroadcast = async () => {
    const message = megaMsg.trim();
    if (!message || broadcasting) return;
    if (!socket || !isConnected) {
      setActionError('Live connection is offline, so the in-app banner cannot be sent right now. Use Push notifications instead.');
      return;
    }
    if (!(await confirm({ title: 'Send this banner?', description: 'It is shown in the app to everyone who is online right now.', confirmLabel: 'Send banner' }))) return;
    setBroadcasting(true);
    setActionError(null);
    const payload = { message: message.slice(0, 300), type: megaType };
    // Success is shown only when the server acknowledges it. The server drops a broadcast from a
    // socket that is not signed in as admin (e.g. an expired session) without relaying it.
    socket.timeout(8000).emit('admin_broadcast', payload, (err: unknown, ack?: { ok?: boolean; message?: string }) => {
      setBroadcasting(false);
      if (err) {
        setActionError('The server did not confirm the banner, so it may not have been shown. Refresh the page (sign in again if asked) and try once more.');
        return;
      }
      if (!ack || ack.ok !== true) {
        setActionError(ack?.message || 'The server refused the banner. Sign in again and retry.');
        return;
      }
      setActionNotice('Banner sent to everyone currently online. Students who are offline will not see it.');
      setMegaMsg('');
    });
  };

  const handleResolveEvent = useCallback((eventId: string) => {
    setOperationalEvents(prev => prev.filter(e => e.id !== eventId));
  }, []);

  // Initial load: all independent reads in parallel (stats, feed, riders, inbox), once per sign-in.
  // Kept apart from the socket effect below so a socket (re)connect does not reload everything.
  useEffect(() => {
    if (!isAuthed) return;
    fetchStats();
    fetchOrders();
    fetchRiders();
    fetchInbox();
  }, [isAuthed, fetchStats, fetchOrders, fetchRiders, fetchInbox]);

  // Polling fallback so the feed never desyncs if a socket event is missed: every 15 s while the live
  // socket is down, every 60 s while it is up (events already refresh the feed), never in a hidden tab.
  useVisibleInterval(() => {
    fetchOrders();
    throttledFetchStats();
    fetchInbox();
  }, isConnected ? POLL_LIVE_MS : POLL_OFFLINE_MS, isAuthed);

  useEffect(() => {
    if (!isAuthed || !socket) return;

    const prependOrder = (entry: LiveOrder) => {
      setLiveOrders(prev => (prev.some(o => o.id === entry.id) ? prev : [entry, ...prev].slice(0, ORDER_FEED_LIMIT)));
    };

    // admin_newOrder: { id, restaurant, customer, drop, totalPrice, finalPrice, paymentMethod, paymentStatus, createdAt }
    const handleIncomingOrder = (order: any) => {
      throttledFetchStats();
      const orderId = order?.id || order?._id;
      if (!orderId) return;
      prependOrder({
        id: String(orderId),
        kind: 'order',
        customer: order.customer || order.user?.name || 'Customer',
        location: order.hostelGateDelivery ? 'Hostel gate' : (order.drop || 'Room delivery'),
        status: order.status || 'Pending',
        price: toNumber(order.finalPrice ?? order.totalPrice),
        restaurant: (typeof order.restaurant === 'string' ? order.restaurant : order.restaurant?.name) || 'Store',
        timestamp: new Date(order.createdAt || Date.now()),
        paymentMethod: order.paymentMethod || 'COD',
        riderAssigned: false,
      });
    };

    const handleStatusUpdated = (data: any) => {
      throttledFetchStats();
      const targetId = String(data?.id || data?.orderId || '');
      if (!targetId || !data?.status) return;
      setLiveOrders(prev => prev.map(o => o.id === targetId ? { ...o, status: String(data.status) } : o));
    };

    const handleOrderCancelled = (data: any) => {
      const targetId = String(data?.orderId || '');
      if (!targetId) return;
      setLiveOrders(prev => prev.map(o => o.id === targetId ? { ...o, status: 'Cancelled' } : o));
    };

    let pendingRidersUpdate: Record<string, RiderPosition> = {};
    let riderUpdateTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleRiderLocation = (data: any) => {
      if (!data?.riderId) return;
      const id = String(data.riderId);
      const lat = Number(data.lat ?? data.latitude);
      const lng = Number(data.lng ?? data.longitude);
      const hasFix = (data.lat ?? data.latitude) != null && (data.lng ?? data.longitude) != null
        && Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
      pendingRidersUpdate[id] = {
        ...(pendingRidersUpdate[id] || {}),
        riderId: id,
        riderName: data.riderName || 'Rider',
        currentCheckpoint: data.currentCheckpoint,
        activeOrderCount: toNumber(data.activeOrderCount),
        isOnline: data.isOnline !== false,
        // Only a real fix moves the pin; an update without one keeps the last known position.
        ...(hasFix ? { lat, lng, locatedAt: Date.now() } : {}),
      };
      if (!riderUpdateTimeout) {
        riderUpdateTimeout = setTimeout(() => {
          const batch = pendingRidersUpdate;
          pendingRidersUpdate = {};
          riderUpdateTimeout = null;
          setRiders(prev => {
            const next = { ...prev };
            Object.values(batch).forEach(r => { next[r.riderId] = { ...(prev[r.riderId] || {}), ...r, photoUrl: prev[r.riderId]?.photoUrl }; });
            return next;
          });
        }, 1500); // throttle map/list re-renders
      }
    };

    const upsertRider = (riderId: string, patch: Partial<RiderPosition>) => {
      setRiders(prev => ({
        ...prev,
        [riderId]: {
          activeOrderCount: prev[riderId]?.activeOrderCount ?? 0,
          riderName: prev[riderId]?.riderName ?? 'Rider',
          isOnline: prev[riderId]?.isOnline ?? false,
          currentCheckpoint: prev[riderId]?.currentCheckpoint,
          photoUrl: prev[riderId]?.photoUrl,
          ...patch,
          riderId,
        },
      }));
    };

    const handleRiderOnline = (data: any) => {
      if (!data?.riderId) return;
      upsertRider(String(data.riderId), { isOnline: true, ...(data.name ? { riderName: data.name } : {}) });
    };

    const handleRiderOffline = (data: any) => {
      if (!data?.riderId) return;
      upsertRider(String(data.riderId), { isOnline: false });
    };

    const handleRiderStatus = (data: any) => {
      if (!data?.riderId) return;
      upsertRider(String(data.riderId), { isOnline: !!data.isOnline, ...(data.name ? { riderName: data.name } : {}) });
    };

    const handleOrderAccepted = (data: any) => {
      const targetId = String(data?.orderId || '');
      if (!targetId) return;
      // Rider fields only: the status comes from `statusUpdated` (a rider can accept an order that is
      // already Preparing / Ready, and forcing 'Accepted' moved it backwards on screen).
      setLiveOrders(prev => prev.map(o => o.id === targetId ? { ...o, riderAssigned: true, deliveryPartnerName: data.riderName || o.deliveryPartnerName } : o));
    };

    const handleDeliveryComplete = (data: any) => {
      throttledFetchStats();
      const targetId = String(data?.orderId || '');
      if (!targetId) return;
      setLiveOrders(prev => prev.map(o => o.id === targetId ? { ...o, status: 'Delivered' } : o));
    };

    const handleOrderUnassigned = (data: any) => {
      const targetId = String(data?.orderId || '');
      if (!targetId) return;
      // Unassigning a rider does not reset the order to Pending (it may be Preparing / Ready): only the
      // rider fields change here; `statusUpdated` carries any real status change.
      setLiveOrders(prev => prev.map(o => o.id === targetId ? { ...o, riderAssigned: false, deliveryPartnerName: undefined, deliveryPartnerPhoto: undefined } : o));
    };

    const handleRiderProfileUpdated = (data: any) => {
      const riderId = String(data?.riderId || '');
      if (!riderId) return;
      setRiders(prev => (prev[riderId]
        ? { ...prev, [riderId]: { ...prev[riderId], riderName: data.name || prev[riderId].riderName, photoUrl: data.photoUrl || prev[riderId].photoUrl } }
        : prev));
    };

    const handleSosReceived = (data: any) => {
      setOperationalEvents(prev => [{
        id: `sos-${data?.riderId || 'rider'}-${Date.now()}`,
        type: 'SOS' as const,
        senderRole: 'Rider',
        senderName: data?.riderName ? String(data.riderName) : undefined,
        details: 'Emergency SOS triggered. Call the rider now.',
        orderId: data?.orderId ? String(data.orderId) : undefined,
        timestamp: new Date(),
      }, ...prev].slice(0, 10));
    };

    const handleIssueReported = (data: any) => {
      setOperationalEvents(prev => [{
        id: `issue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'ISSUE' as const,
        senderRole: String(data?.senderRole || 'User'),
        senderName: data?.senderName ? String(data.senderName) : undefined,
        issueType: data?.issueType ? String(data.issueType) : undefined,
        details: String(data?.details || ''),
        orderId: data?.orderId ? String(data.orderId) : undefined,
        timestamp: new Date(),
      }, ...prev].slice(0, 10));
    };

    const handleInterceptChat = (data: any) => {
      if (!data?.message) return;
      const ts = new Date(data.timestamp || Date.now());
      setInterceptedChats(prev => [{
        orderId: String(data.orderId || ''),
        sender: String(data.sender || 'Unknown'),
        senderRole: String(data.senderRole || ''),
        message: String(data.message),
        timestamp: Number.isNaN(ts.getTime()) ? new Date() : ts,
      }, ...prev].slice(0, 30));
    };

    socket.on('admin_newOrder', handleIncomingOrder);
    socket.on('statusUpdated', handleStatusUpdated);
    socket.on('orderCancelled', handleOrderCancelled);
    socket.on('admin_rider_location', handleRiderLocation);
    socket.on('admin_rider_online', handleRiderOnline);
    socket.on('admin_rider_offline', handleRiderOffline);
    socket.on('admin_rider_status', handleRiderStatus);
    socket.on('admin_order_accepted', handleOrderAccepted);
    socket.on('admin_delivery_complete', handleDeliveryComplete);
    socket.on('order_unassigned', handleOrderUnassigned);
    socket.on('rider_profile_updated', handleRiderProfileUpdated);
    socket.on('sos_received', handleSosReceived);
    socket.on('admin_issue_reported', handleIssueReported);
    socket.on('admin_intercept_chat', handleInterceptChat);

    return () => {
      socket.off('admin_newOrder', handleIncomingOrder);
      socket.off('statusUpdated', handleStatusUpdated);
      socket.off('orderCancelled', handleOrderCancelled);
      socket.off('admin_rider_location', handleRiderLocation);
      socket.off('admin_rider_online', handleRiderOnline);
      socket.off('admin_rider_offline', handleRiderOffline);
      socket.off('admin_rider_status', handleRiderStatus);
      socket.off('admin_order_accepted', handleOrderAccepted);
      socket.off('admin_delivery_complete', handleDeliveryComplete);
      socket.off('order_unassigned', handleOrderUnassigned);
      socket.off('rider_profile_updated', handleRiderProfileUpdated);
      socket.off('sos_received', handleSosReceived);
      socket.off('admin_issue_reported', handleIssueReported);
      socket.off('admin_intercept_chat', handleInterceptChat);
      if (riderUpdateTimeout) clearTimeout(riderUpdateTimeout);
    };
  }, [isAuthed, socket, throttledFetchStats]);

  // Realtime sync (`admin:changed` / `data:changed`, ids only): refetch just the widgets that changed.
  useLiveSync(LIVE_HOME_TYPES, (events, { reconnect }) => {
    const has = (t: string) => reconnect || events.some(e => e.type === t);
    if (has('order')) {
      fetchOrders();
      // Stats are heavier; refresh them at most every 10 s.
      throttledFetchStats();
      if (!reconnect) markFresh(events.filter(e => e.type === 'order').map(e => e.id));
    }
    if (has('rider')) {
      // Rider rows change often (duty toggles) and the socket events above already keep the list live:
      // re-read the full roster at most every 15 s instead of on every rider event.
      const now = Date.now();
      const wait = 15000 - (now - lastRidersFetch.current);
      if (reconnect || wait <= 0) { lastRidersFetch.current = now; fetchRiders(); }
      else if (!ridersTrailing.current) {
        // One trailing refresh so the last change inside the window is not lost.
        ridersTrailing.current = setTimeout(() => { ridersTrailing.current = null; lastRidersFetch.current = Date.now(); fetchRiders(); }, wait);
      }
      throttledFetchStats();
    }
    if (has('store') && !has('order')) throttledFetchStats();
    const inboxKeys = INBOX_ITEMS
      .filter(i => has(i.liveType) || (i.key === 'wallPending' && events.some(e => e.type === 'wall' && e.scope === 'submissions')))
      .map(i => i.key);
    if (inboxKeys.length) {
      fetchInbox();
      if (!reconnect) {
        setFreshInbox(prev => ({ ...prev, ...Object.fromEntries(inboxKeys.map(k => [k, true])) }));
        if (inboxFreshTimer.current) clearTimeout(inboxFreshTimer.current);
        inboxFreshTimer.current = setTimeout(() => setFreshInbox({}), 6000);
      }
    }
    if (reconnect) return;
    const newOrders = events.filter(e => e.type === 'order' && e.action === 'created');
    const label = liveLabel(newOrders, 'order');
    if (label) notifyLive(label);
    for (const [type, noun] of [['ticket', 'support ticket'], ['verification', 'verification request'], ['pg_booking', 'PG booking request'], ['wall_submission', 'wall photo'], ['service_booking', 'service booking']] as const) {
      const l = liveLabel(events.filter(e => e.type === type && e.action === 'created'), noun);
      if (l) notifyLive(l);
    }
  }, { enabled: isAuthed });

  // Derived lists are recomputed only when their source changes (not on every toast / input keystroke).
  const riderList = useMemo(
    () => Object.values(riders).sort((a, b) => Number(b.isOnline) - Number(a.isOnline)),
    [riders],
  );
  const onlineCount = useMemo(() => riderList.filter(r => r.isOnline).length, [riderList]);
  const upiPendingCount = useMemo(() => liveOrders.filter(needsUpiCheck).length, [liveOrders]);

  if (!isAuthed) return null; // AppShell shows the auth loader / redirect

  // "Needs attention": queues with something waiting first (urgent ones on top), then the clear ones.
  const attention = INBOX_ITEMS.map(i => ({ ...i, value: inbox[i.key] }));
  const waiting = attention
    .filter(a => (a.value ?? 0) > 0)
    .sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || (b.value as number) - (a.value as number));
  const clear = attention.filter(a => a.value === 0);

  const orderColumns: Column<LiveOrder>[] = [
    {
      key: 'id',
      header: 'Order',
      width: '120px',
      cell: o => (
        <span className="font-mono text-xs text-fg-muted">{shortId(o.id)}</span>
      ),
    },
    {
      key: 'store',
      header: 'Store',
      sortValue: o => o.restaurant,
      cell: o => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{o.restaurant}</p>
          <p className="truncate text-xs text-fg-muted">{o.customer} · {o.location}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: o => o.status,
      cell: o => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill status={o.status} />
          {needsUpiCheck(o) && <Badge tone="warning">Verify UPI</Badge>}
        </div>
      ),
    },
    {
      key: 'rider',
      header: 'Rider',
      hideBelow: 'lg',
      cell: o => o.deliveryPartnerName
        ? <span className="text-fg">{o.deliveryPartnerName}</span>
        : o.riderAssigned
          ? <span className="text-fg-muted">Assigned</span>
          : ['Delivered', 'Cancelled'].includes(o.status)
            ? <span className="text-fg-subtle">–</span>
            : o.status === 'Pending'
              ? <span className="text-fg-muted">Waiting for the store</span>
              : <span className="text-fg-muted">Waiting for a rider</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      sortValue: o => o.price,
      cell: o => (
        <div>
          <p className="font-medium tabular-nums text-fg">{formatINR(o.price)}</p>
          <p className="text-xs text-fg-muted">{humanize(o.paymentMethod)}</p>
        </div>
      ),
    },
    {
      key: 'time',
      header: 'Placed',
      align: 'right',
      sortValue: o => o.timestamp,
      cell: o => <span className="whitespace-nowrap text-xs text-fg-muted" title={o.timestamp.toISOString()}>{formatRelative(o.timestamp)}</span>,
    },
  ];

  const openOrder = (o: LiveOrder) => {
    if (needsUpiCheck(o)) { handleVerifyRequest(o); return; }
    router.push(`/orders?order=${encodeURIComponent(o.id)}`);
  };

  return (
    <div className="pb-12">
      <PageHeader
        title="Overview"
        description="What needs your attention, the latest orders and live riders."
        meta={<Badge tone={isConnected ? 'success' : 'warning'} dot>{isConnected ? 'Live' : 'Refreshing every 15 seconds'}</Badge>}
        actions={<ButtonLink href="/orders" variant="secondary">Open orders</ButtonLink>}
      />

      {operationalEvents.length > 0 && (
        <div className="mb-6 space-y-2" aria-label="Alerts from riders and customers">
          {operationalEvents.map(event => <EventAlert key={event.id} event={event} onResolve={handleResolveEvent} />)}
        </div>
      )}

      {(actionError || actionNotice) && (
        <Notice tone={actionError ? 'danger' : 'success'} className="mb-6" onClose={() => { setActionError(null); setActionNotice(null); }}>
          <span className="text-fg">{actionError || actionNotice}</span>
        </Notice>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-3">
        {/* Needs attention */}
        <Card className="xl:col-span-2">
          <CardHeader
            title="Needs attention"
            description="Queues waiting for an admin. Open one to handle it."
            actions={inboxLoaded && waiting.length > 0 ? <Badge tone="warning">{waiting.length} {waiting.length === 1 ? 'queue' : 'queues'}</Badge> : undefined}
          />
          {!inboxLoaded ? (
            <ul className="divide-y divide-line">
              {Array.from({ length: 4 }, (_, i) => (
                <li key={i} className="flex items-center gap-4 px-4 py-3"><Skeleton className="h-4 w-1/2" /><Skeleton className="ml-auto h-4 w-8" /></li>
              ))}
            </ul>
          ) : waiting.length === 0 ? (
            <EmptyState title="Nothing is waiting" description="Every queue below is clear. New requests appear here as they arrive." />
          ) : (
            <ul className="divide-y divide-line">
              {waiting.map(item => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className={`group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/70 ${freshInbox[item.key] ? FRESH_ROW_CLASS : ''}`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${item.urgent ? 'bg-danger' : 'bg-warning'}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{item.label}</span>
                      <span className="block text-xs text-fg-muted">{item.area}</span>
                    </span>
                    <span className={`text-base font-semibold tabular-nums ${item.urgent ? 'text-danger-text' : 'text-fg'}`}>
                      {item.value}{inboxCapped[item.key] ? '+' : ''}
                    </span>
                    <IconChevronRight size={14} className="text-fg-subtle group-hover:text-fg" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {inboxLoaded && clear.length > 0 && (
            <p className="border-t border-line px-4 py-3 text-xs text-fg-muted">
              <span className="font-medium text-fg-muted">All clear: </span>
              {clear.map((c, i) => (
                <span key={c.key}>
                  <Link href={c.href} className="hover:text-fg hover:underline underline-offset-2">{c.label.charAt(0).toLowerCase() + c.label.slice(1)}</Link>
                  {i < clear.length - 1 ? ', ' : ''}
                </span>
              ))}
            </p>
          )}
        </Card>

        {/* Key numbers */}
        <Card>
          <CardHeader title="Key numbers" description="From the server, updated as orders change." />
          {statsError && !stats ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-danger-text">{statsError}</p>
              <Button size="sm" className="mt-3" onClick={fetchStats}>Try again</Button>
            </div>
          ) : (
            <dl className="divide-y divide-line">
              {(stats || Array.from({ length: 5 }, () => null)).map((stat, i) => (
                <div key={stat?.label ?? i} className="flex items-baseline justify-between gap-4 px-4 py-3">
                  {stat ? (
                    <>
                      <dt className="min-w-0">
                        <span className="block text-sm text-fg">{stat.label}</span>
                        <span className="block truncate text-xs text-fg-muted">{stat.hint}</span>
                      </dt>
                      <dd className="text-lg font-semibold tabular-nums text-fg">{stat.value}</dd>
                    </>
                  ) : (
                    <><Skeleton className="h-4 w-28" /><Skeleton className="h-5 w-16" /></>
                  )}
                </div>
              ))}
            </dl>
          )}
        </Card>
      </div>

      {/* Recent orders */}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-fg">Latest orders</h2>
            <p className="mt-0.5 text-sm text-fg-muted">The newest {ORDER_FEED_LIMIT} orders. Select a row to open it.</p>
          </div>
          {upiPendingCount > 0 && <Badge tone="warning">{upiPendingCount} legacy UPI {upiPendingCount === 1 ? 'payment' : 'payments'} to verify</Badge>}
        </div>
        <DataTable
          caption="Latest orders"
          columns={orderColumns}
          rows={liveOrders}
          rowKey={o => `${o.kind}-${o.id}`}
          loading={loading}
          error={ordersError}
          onRetry={fetchOrders}
          onRowClick={openOrder}
          rowClassName={o => (o.kind === 'order' && isFresh(o.id) ? FRESH_ROW_CLASS : undefined)}
          pageSize={10}
          noun="orders"
          maxHeight="none"
          empty={{ title: 'No orders yet', description: 'New orders appear here the moment they are placed.' }}
        />
      </section>

      {/* Riders */}
      <section className="mt-8">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-fg">Riders</h2>
          <p className="mt-0.5 text-sm text-fg-muted">Approved riders and where they are. A rider without a GPS fix is placed at the last route checkpoint their app reported.</p>
        </div>
        <div className="grid items-start gap-6 xl:grid-cols-3">
          <Card className="overflow-hidden xl:col-span-2">
            <div className="h-[420px]">
              <LiveFleetMap riders={riders} checkpoints={CHECKPOINTS} />
            </div>
          </Card>
          <Card>
            <CardHeader
              title="Rider status"
              actions={<Badge tone={onlineCount > 0 ? 'success' : 'neutral'} dot>{onlineCount} online</Badge>}
            />
            {riderList.length === 0 ? (
              <EmptyState title="No approved riders yet" action={<ButtonLink href="/fleet" size="sm">Go to Riders</ButtonLink>} />
            ) : (
              <ul className="max-h-[364px] divide-y divide-line overflow-y-auto">
                {riderList.map(rider => <RiderRow key={rider.riderId} rider={rider} />)}
              </ul>
            )}
          </Card>
        </div>
      </section>

      {/* Tools */}
      <section className="mt-8">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-fg">Tools</h2>
          <p className="mt-0.5 text-sm text-fg-muted">For when stores cannot use their app, or everyone online needs to see a message.</p>
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Accept pending orders for stores" />
            <div className="space-y-4 p-4">
              <p className="text-sm text-fg-muted">
                Pending orders that nobody accepts are cancelled and refunded automatically after the server timeout (7 minutes by default; slot orders count from 60 minutes before their slot).
                If stores can be reached by phone but cannot use their app, accept all pending ZenWe-delivered orders at once. Stall orders and unverified UPI orders are skipped.
              </p>
              <Button variant="secondary" onClick={handleAcceptAllPending} loading={batchRunning}>
                {batchRunning ? 'Accepting…' : 'Accept all pending orders'}
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="In-app banner" description="Shown live to everyone who has the app open. For phones that are closed, use Push notifications." />
            <div className="space-y-4 p-4">
              <div>
                <p className="mb-1 text-sm font-medium text-fg">Type</p>
                <SegmentedControl
                  ariaLabel="Banner type"
                  value={megaType}
                  onChange={setMegaType}
                  options={[
                    { value: 'info', label: 'Information' },
                    { value: 'warning', label: 'Warning' },
                    { value: 'promo', label: 'Promotion' },
                    { value: 'emergency', label: 'Emergency' },
                  ]}
                />
              </div>
              <Field label="Message" hint={`${megaMsg.length}/280 characters. {{username}} is replaced with each student's name.`}>
                <Textarea
                  id="mega-banner-text"
                  rows={3}
                  maxLength={280}
                  value={megaMsg}
                  onChange={e => setMegaMsg(e.target.value)}
                  placeholder="Type the message students will see"
                />
              </Field>
              <div className="flex justify-end">
                <Button variant="primary" disabled={!megaMsg.trim()} loading={broadcasting} onClick={handleBroadcast}>
                  {broadcasting ? 'Sending…' : 'Send banner'}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* Order chat feed */}
      <section className="mt-8">
        <Card>
          <CardHeader
            title="Order chat"
            description="Messages between customers and riders since this page was opened."
            actions={<Badge tone={isConnected ? 'success' : 'neutral'} dot>{isConnected ? 'Live' : 'Offline'}</Badge>}
          />
          {interceptedChats.length === 0 ? (
            <EmptyState title="No messages yet" description="Chat messages on active orders appear here as they are sent." />
          ) : (
            <ul className="max-h-[360px] divide-y divide-line overflow-y-auto">
              {interceptedChats.map((chat, idx) => (
                <li key={`${chat.orderId}-${chat.timestamp.getTime()}-${idx}`} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3 text-xs text-fg-muted">
                    <span className="truncate">
                      <span className="font-medium text-fg">{chat.sender}</span>
                      {chat.senderRole && <> · {chat.senderRole.toLowerCase()}</>}
                      {chat.orderId && <> · Order {shortId(chat.orderId)}</>}
                    </span>
                    <span className="shrink-0 tabular-nums">{formatTime(chat.timestamp)}</span>
                  </div>
                  <p className="mt-1 break-words text-sm text-fg">{chat.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <PaymentVerificationModal
        isOpen={!!selectedUPIOrder}
        order={selectedUPIOrder}
        onClose={() => setSelectedUPIOrder(null)}
        onVerify={handleVerifyUPI}
      />
    </div>
  );
}
