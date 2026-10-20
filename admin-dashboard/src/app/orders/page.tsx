"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAdminSocket } from '@/components/AdminSocketProvider';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { API_URL } from '@/lib/config';
import { formatDateTime, formatINR, humanize } from '@/lib/format';
import {
  Badge, Button, DataTable, DescriptionList, Drawer, Field, Modal, Notice as NoticeBox, PageHeader, SegmentedControl, Select,
  StatusPill, Textarea, Toolbar, useConfirm, type Column, type Tone, IconRefresh, IconExternal, IconX,
} from '@/components/ui';
import { useLiveSync, useFreshIds, liveLabel, FRESH_ROW_CLASS } from '@/lib/useLiveSync';
import { useVisibleInterval } from '@/lib/useVisibleInterval';

// ─── Types (shape of GET /api/admin/orders) ───────────────────
interface OrderItem {
  name?: string;
  quantity: number;
  priceAtOrder?: number;
  price?: number;
  lineTotal?: number;
}

interface PriceBreakdown {
  subtotal?: number;
  deliveryFee?: number;
  packagingFee?: number;
  taxes?: number;
  discounts?: { type: string; label: string; amount: number }[];
  totalDiscount?: number;
  finalPrice?: number;
  couponCode?: string | null;
}

interface Order {
  _id: string;
  id?: string;
  user?: { name?: string; phone?: string } | null;
  restaurantId?: string | null;
  restaurant?: { name?: string; vendorType?: string | null; whatsappNumber?: string | null } | null;
  /** 'VENDOR' = CampusBites stall delivers itself (COD to the stall, no rider, no PIN). null / 'ZENVY' = Zenvy rider. */
  fulfilment?: string | null;
  outForDeliveryAt?: string | null;
  /** Set once by the backend job when a stall order stayed open for hours (admin + stall were told). */
  stuckFlaggedAt?: string | null;
  items: OrderItem[];
  totalPrice: number;
  finalPrice?: number | null;
  deliveryFee?: number | null;
  priceBreakdown?: PriceBreakdown | string | null;
  status: string;
  paymentMethod?: 'COD' | 'Wallet' | 'UPI' | 'Card' | string;
  paymentStatus?: 'Pending' | 'Completed' | 'Failed' | string;
  upiStatus?: 'Pending' | 'Verified' | 'Rejected' | null;
  upiUTR?: string | null;
  upiScreenshot?: string | null;
  deliveryAddress?: string | null;
  deliveryInstructions?: string[] | string | null;
  hostelGateDelivery?: boolean;
  deliverySlot?: string | null;
  cancellationReason?: string | null;
  estDuration?: number | string | null;
  deliveryPartnerId?: string | null;
  deliveryPinAttempts?: number;
  /** C8: set when the order is delivered (null before). */
  receiptNumber?: string | null;
  createdAt: string;
}

type Notice = { kind: 'success' | 'error'; text: string } | null;

const STATUS_FILTERS = ['All', 'Pending', 'Accepted', 'Preparing', 'ReadyForPickup', 'Picking', 'PickedUp', 'ArrivedAtGate', 'OutForDelivery', 'Delivered', 'Cancelled'];
const STATUS_LABELS: Record<string, string> = {
  ReadyForPickup: 'Ready',
  // Buy-at-store orders: the rider is at the counter buying the items.
  Picking: 'Rider buying',
  PickedUp: 'Picked up',
  ArrivedAtGate: 'At gate',
  OutForDelivery: 'Out for delivery',
};
type FulfilmentFilter = 'All' | 'ZENVY' | 'VENDOR';
const FULFILMENT_FILTERS: { value: FulfilmentFilter; label: string }[] = [
  { value: 'All', label: 'All deliveries' },
  { value: 'ZENVY', label: 'Zenvy riders' },
  { value: 'VENDOR', label: 'Stall delivers' },
];
/** Stall (CampusBites) order: the stall delivers it, cash to the stall, no rider and no PIN. */
const isVendorOrder = (o: Order) => o.fulfilment === 'VENDOR';
const stallName = (o: Order) => o.restaurant?.name || 'the stall';
const TERMINAL = ['Delivered', 'Cancelled'];
/** Statuses where support can assign / remove a rider (the food is still at the store). */
const ASSIGNABLE = ['Accepted', 'Preparing', 'ReadyForPickup', 'Picking'];
const PIN_LOCK_ATTEMPTS = 5;

const statusLabel = (s: string) => STATUS_LABELS[s] || s;
const orderId = (o: { _id?: string; id?: string }) => String(o._id || o.id || '');
const shortId = (id: string) => `#${id.slice(-6).toUpperCase()}`;
const rupees = (n: number | null | undefined) => formatINR(Number(n || 0));
const grandTotal = (o: Order) => (o.finalPrice ?? o.totalPrice ?? 0);
const isLegacyUpiPending = (o: Order) => o.paymentMethod === 'UPI' && o.upiStatus === 'Pending' && !TERMINAL.includes(o.status);

const parseJson = <T,>(v: T | string | null | undefined): T | null => {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v) as T; } catch { return null; }
};

const formatEta = (v: Order['estDuration']) => {
  if (v == null || v === '') return null;
  return typeof v === 'number' ? `${v} min` : String(v);
};

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

/**
 * C8 receipt: GET /api/orders/:id/receipt returns a signed 15-minute link to the printable receipt.
 * 409 RECEIPT_NOT_READY (not delivered / cancelled) is shown as the server's message.
 */
const ReceiptPanel = ({ order }: { order: Order }) => {
  const [state, setState] = useState<{ loading: boolean; error: string | null; url: string | null }>({ loading: false, error: null, url: null });
  const open = async () => {
    if (state.loading) return;
    setState({ loading: true, error: null, url: null });
    try {
      const data = await requestJson<{ url?: string }>(`${API_URL}/api/orders/${encodeURIComponent(orderId(order))}/receipt`);
      const url = typeof data.url === 'string' && /^https?:\/\//i.test(data.url) ? data.url : null;
      if (!url) throw new Error('The receipt link was not returned. Please try again.');
      window.open(url, '_blank', 'noopener,noreferrer');
      setState({ loading: false, error: null, url });
    } catch (err) {
      setState({ loading: false, error: err instanceof Error ? err.message : 'Could not open the receipt.', url: null });
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={open} loading={state.loading} rightIcon={<IconExternal size={12} />}>
          {state.loading ? 'Opening…' : 'View receipt'}
        </Button>
        {order.receiptNumber && <span className="text-xs text-fg-muted">Receipt no. <span className="font-mono text-fg">{order.receiptNumber}</span></span>}
      </div>
      {!TERMINAL.includes(order.status) && !state.error && <p className="text-xs text-fg-muted">A receipt is issued once the order is delivered.</p>}
      {state.error && <p className="text-xs text-warning-text">{state.error}</p>}
      {state.url && (
        <p className="text-xs text-fg-muted">
          Did not open? <a href={state.url} target="_blank" rel="noopener noreferrer" className="text-accent-text underline">Open the receipt</a> (link valid for 15 minutes).
        </p>
      )}
    </div>
  );
};

const STATUS_TONE: Record<string, Tone> = {
  Pending: 'warning', Accepted: 'info', Preparing: 'info', ReadyForPickup: 'accent', Picking: 'info', PickedUp: 'info',
  ArrivedAtGate: 'info', OutForDelivery: 'info', Delivered: 'success', Cancelled: 'danger',
};
const OrderStatus = ({ status }: { status: string }) => <StatusPill status={status} label={statusLabel(status)} tone={STATUS_TONE[status] || 'neutral'} />;

/** Payment method + state. Legacy UPI orders (before COD + Wallet only) show their manual check state. */
const PaymentCell = ({ order }: { order: Order }) => {
  const method = order.paymentMethod ? humanize(order.paymentMethod) : '–';
  if (order.paymentMethod === 'UPI') {
    return (
      <div>
        <p className="text-fg">UPI <span className="text-fg-muted">(legacy)</span></p>
        <p className={`text-xs ${order.upiStatus === 'Pending' ? 'text-warning-text' : 'text-fg-muted'}`}>{order.upiStatus ? humanize(order.upiStatus) : 'Not checked'}</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-fg">{method}</p>
      {order.paymentStatus && <p className={`text-xs ${order.paymentStatus === 'Completed' ? 'text-success-text' : 'text-fg-muted'}`}>{order.paymentStatus === 'Completed' ? 'Paid' : humanize(order.paymentStatus)}</p>}
    </div>
  );
};

/** Small flags shown under the status (payment check, PIN lock, stuck stall order). */
const OrderFlags = ({ order }: { order: Order }) => {
  const pinLocked = !isVendorOrder(order) && (order.deliveryPinAttempts || 0) >= PIN_LOCK_ATTEMPTS && !TERMINAL.includes(order.status);
  const stuck = !!order.stuckFlaggedAt && !TERMINAL.includes(order.status);
  if (!isLegacyUpiPending(order) && !pinLocked && !stuck) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {isLegacyUpiPending(order) && <Badge tone="warning">Payment check needed</Badge>}
      {pinLocked && <Badge tone="danger">PIN locked</Badge>}
      {stuck && <Badge tone="warning" title="This stall order has been open for hours. Call the stall, then mark it delivered or cancel it.">Stuck, check with stall</Badge>}
    </div>
  );
};

export default function OrdersPage() {
  const { isAuthed } = useAdminAuth();
  const { socket, isConnected, notifyLive } = useAdminSocket();
  const { mark: markFresh, isFresh } = useFreshIds();
  const confirm = useConfirm();
  // Cancel needs a reason for the customer (was a browser prompt): this small form collects it.
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState('Cancelled by Zenvy support');
  const [orders, setOrders] = useState<Order[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // ?order=<id> (overview and global search): opens that order, fetched on its own when it is not in this page.
  const [deepOrder, setDeepOrder] = useState<Order | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('order');
    if (!id) return;
    setSelectedId(id);
    fetch(`${API_URL}/api/admin/orders?q=${encodeURIComponent(id)}&limit=1`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { const o = Array.isArray(d?.orders) ? d.orders[0] : null; if (o) setDeepOrder(o as Order); })
      .catch(() => { /* the order may still appear in the list */ });
  }, []);
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterFulfilment, setFilterFulfilment] = useState<FulfilmentFilter>('All');
  // "Stall orders stuck > N h": stall orders still Accepted / Out for delivery N+ hours after placing (null = off).
  const [stuckHours, setStuckHours] = useState<number | null>(null);
  // ?store=<id> (from Stores → a store → "All orders").
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  // The first load waits until ?store= has been read, so a store link does not fetch twice.
  const [filtersReady, setFiltersReady] = useState(false);
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const sid = qs.get('store');
    if (sid) setStoreFilter(sid);
    // ?stuck=<hours> (overview "Stall orders stuck" tile).
    const stuck = Number(qs.get('stuck'));
    if (Number.isFinite(stuck) && stuck >= 1 && stuck <= 72) setStuckHours(Math.round(stuck));
    setFiltersReady(true);
  }, []);
  const clearStoreFilter = () => {
    setStoreFilter(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('store');
    window.history.replaceState(window.history.state, '', url.toString());
  };
  const [notice, setNotice] = useState<Notice>(null);

  const requestSeq = useRef(0);
  const inFlight = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef(1);
  pageRef.current = currentPage;

  const selectedOrder = selectedId ? orders.find(o => orderId(o) === selectedId) || (deepOrder && orderId(deepOrder) === selectedId ? deepOrder : null) : null;

  const showNotice = useCallback((n: Notice) => {
    setNotice(n);
    if (n) setTimeout(() => setNotice(cur => (cur === n ? null : cur)), 6000);
  }, []);

  const fetchOrders = useCallback(async (page = 1, showSpinner = true) => {
    const seq = ++requestSeq.current;
    if (showSpinner) setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50', status: filterStatus });
      if (stuckHours) params.set('stuckHours', String(stuckHours));
      else if (filterFulfilment !== 'All') params.set('fulfilment', filterFulfilment);
      if (storeFilter) params.set('restaurantId', storeFilter);
      const data = await requestJson<{ orders?: Order[]; total?: number; pages?: number }>(`${API_URL}/api/admin/orders?${params}`);
      if (seq !== requestSeq.current) return; // a newer request (filter/page change) superseded this one
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setTotalOrders(data.total || 0);
      setTotalPages(Math.max(1, data.pages || 1));
      setCurrentPage(page);
      setLoadError(null);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      // Background refreshes keep the last good list; only a visible load shows the error.
      if (showSpinner) setLoadError(err instanceof Error ? err.message : 'Could not load orders.');
    } finally {
      if (seq === requestSeq.current && showSpinner) setLoading(false);
    }
  }, [filterStatus, filterFulfilment, storeFilter, stuckHours]);

  /** Coalesces bursts of socket events into one quiet refresh. */
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => fetchOrders(pageRef.current, false), 800);
  }, [fetchOrders]);

  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  useEffect(() => {
    if (isAuthed && filtersReady) fetchOrders(1, true);
  }, [isAuthed, filtersReady, fetchOrders]);

  // Background polling fallback in case a socket event is missed: 20 s while the live socket is down,
  // 60 s while it is up (socket events already trigger refreshes); paused in a hidden tab.
  useVisibleInterval(() => fetchOrders(pageRef.current, false), isConnected ? 60000 : 20000, isAuthed && filtersReady);

  // Live updates from the admin socket room.
  useEffect(() => {
    if (!socket) return;

    const patchStatus = (targetId: string, status: string) => {
      if (!targetId || !status) return;
      setOrders(prev => prev.map(o => (orderId(o) === targetId ? { ...o, status } : o)));
    };
    // New-order payloads are partial (no items/status), so reload the page instead of inserting them.
    const handleNewOrder = () => scheduleRefresh();
    const handleStatusUpdated = (data: { id?: string; orderId?: string; status?: string }) => {
      patchStatus(String(data?.id || data?.orderId || ''), String(data?.status || ''));
      scheduleRefresh();
    };
    const handleOrderAccepted = (data: { orderId: string }) => { patchStatus(String(data?.orderId || ''), 'Accepted'); scheduleRefresh(); };
    const handleDeliveryComplete = (data: { orderId: string }) => patchStatus(String(data?.orderId || ''), 'Delivered');
    const handleOrderCancelled = (data: { orderId: string }) => { patchStatus(String(data?.orderId || ''), 'Cancelled'); scheduleRefresh(); };
    const handleOrderUnassigned = () => scheduleRefresh();
    const handleStallStuck = (data: { placedAtIST?: string; hours?: number }) => {
      scheduleRefresh();
      notifyLive(`Stall order open > ${data?.hours || 6} h${data?.placedAtIST ? ` (placed ${data.placedAtIST})` : ''}`);
    };

    socket.on('admin_newOrder', handleNewOrder);
    socket.on('newOrder', handleNewOrder);
    socket.on('statusUpdated', handleStatusUpdated);
    socket.on('admin_order_accepted', handleOrderAccepted);
    socket.on('admin_delivery_complete', handleDeliveryComplete);
    socket.on('order_unassigned', handleOrderUnassigned);
    socket.on('orderCancelled', handleOrderCancelled);
    socket.on('stallOrderStuck', handleStallStuck);

    return () => {
      socket.off('admin_newOrder', handleNewOrder);
      socket.off('newOrder', handleNewOrder);
      socket.off('statusUpdated', handleStatusUpdated);
      socket.off('admin_order_accepted', handleOrderAccepted);
      socket.off('admin_delivery_complete', handleDeliveryComplete);
      socket.off('order_unassigned', handleOrderUnassigned);
      socket.off('orderCancelled', handleOrderCancelled);
      socket.off('stallOrderStuck', handleStallStuck);
    };
  }, [socket, scheduleRefresh, notifyLive]);

  // Realtime sync: `admin:changed` { type: 'order' } (ids only) → quiet refetch + highlight.
  useLiveSync(['order'], (events, { reconnect }) => {
    if (!isAuthed) return;
    // Shares the legacy events' coalescing timer, so statusUpdated + admin:changed for one write = one refetch.
    scheduleRefresh();
    if (reconnect) return;
    markFresh(events.map(e => e.id));
    const created = events.filter(e => e.action === 'created');
    if (created.length) notifyLive(liveLabel(created, 'order') || 'New order');
  }, { enabled: isAuthed });

  /** Runs one order action at a time (guards against double clicks). */
  const runAction = async (order: Order, label: string, url: string, body: Record<string, unknown> | undefined, optimisticStatus?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const id = orderId(order);
    setBusyId(id);
    try {
      const data = await requestJson<{ message?: string; status?: string; refundedToWallet?: number }>(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const nextStatus = data?.status || optimisticStatus;
      if (nextStatus) setOrders(prev => prev.map(o => (orderId(o) === id ? { ...o, status: nextStatus } : o)));
      // The cancel endpoint's message is written for the customer ("your Wallet"), so word refunds for the admin here.
      const refunded = typeof data?.refundedToWallet === 'number' && data.refundedToWallet > 0
        ? `${label}. ${rupees(data.refundedToWallet)} refunded to the customer's Wallet.`
        : null;
      showNotice({ kind: 'success', text: `${shortId(id)}: ${refunded || (data?.message ? data.message.replace(/\.$/, '') + '.' : `${label}.`)}` });
      await fetchOrders(pageRef.current, false);
    } catch (err) {
      showNotice({ kind: 'error', text: `${shortId(id)}: ${err instanceof Error ? err.message : 'Action failed.'}` });
    } finally {
      inFlight.current = false;
      setBusyId(null);
    }
  };

  const acceptOrder = async (o: Order) => {
    const question = isVendorOrder(o)
      ? `Accept order ${shortId(orderId(o))} on behalf of ${stallName(o)}? Only do this after confirming with the stall: the stall delivers it itself (no rider).`
      : `Accept order ${shortId(orderId(o))} on behalf of ${o.restaurant?.name || 'the store'} and send it to riders?`;
    if (!(await confirm({ title: 'Accept this order?', description: question, confirmLabel: isVendorOrder(o) ? 'Accept for stall' : 'Accept and dispatch' }))) return;
    runAction(o, 'Order accepted', `${API_URL}/api/orders/${orderId(o)}/restaurant-accept`, {}, 'Accepted');
  };

  const setStatus = async (o: Order, status: string) => {
    const id = shortId(orderId(o));
    if (status === 'Delivered') {
      const cash = o.paymentMethod === 'COD' ? ` This is a cash on delivery order: confirm ${rupees(grandTotal(o))} was collected${isVendorOrder(o) ? ` by ${stallName(o)}` : ''}.` : '';
      if (!(await confirm({ title: `Mark order ${id} as delivered?`, description: `The customer is notified and rewards are credited.${cash}`, confirmLabel: 'Mark delivered' }))) return;
    } else if (!(await confirm({ title: `Change order ${id} to ${statusLabel(status).toLowerCase()}?`, description: 'The customer, store and rider apps update straight away.', confirmLabel: 'Change status' }))) {
      return;
    }
    runAction(o, `Marked ${statusLabel(status)}`, `${API_URL}/api/orders/${orderId(o)}/status`, { status }, status);
  };

  // Opens the cancel form; the request itself is unchanged (same endpoint, status and reason).
  const cancelOrder = (o: Order) => {
    setCancelReason('Cancelled by Zenvy support');
    setCancelling(o);
  };
  const confirmCancel = () => {
    const o = cancelling;
    if (!o) return;
    const reason = cancelReason;
    setCancelling(null);
    runAction(o, 'Order cancelled', `${API_URL}/api/orders/${orderId(o)}/status`, { status: 'Cancelled', reason: reason.trim() || undefined }, 'Cancelled');
  };

  const verifyUpi = async (o: Order, isVerified: boolean) => {
    const id = shortId(orderId(o));
    const question = isVerified
      ? `Confirm you found UTR ${o.upiUTR || '(none)'} for ${rupees(grandTotal(o))} in the bank statement? The order will be accepted.`
      : `Reject the UPI payment for order ${id}? The order will be cancelled.`;
    if (!(await confirm({ title: isVerified ? 'Mark the payment as received?' : 'Reject this payment?', description: question, confirmLabel: isVerified ? 'Payment received' : 'Reject payment', tone: isVerified ? 'default' : 'danger' }))) return;
    runAction(o, isVerified ? 'Payment verified' : 'Payment rejected', `${API_URL}/api/orders/${orderId(o)}/verify-upi`, { isVerified });
  };

  // Support can give a not-yet-picked-up order to a rider or take it back (PUT /api/admin/orders/:id/rider).
  const selectedAssignable = !!selectedOrder && !isVendorOrder(selectedOrder) && ASSIGNABLE.includes(selectedOrder.status);
  const [assignRiders, setAssignRiders] = useState<{ id: string; name: string; isOnline?: boolean }[] | null>(null);
  const [assignPick, setAssignPick] = useState('');
  useEffect(() => {
    if (!selectedAssignable || assignRiders) return;
    let live = true;
    requestJson<{ riders?: { id?: string; _id?: string; name?: string; isOnline?: boolean }[] }>(`${API_URL}/api/admin/riders?approved=1&limit=100`)
      .then(d => {
        if (!live) return;
        const list = (d.riders || []).map(r => ({ id: String(r.id || r._id || ''), name: r.name || 'Rider', isOnline: r.isOnline })).filter(r => r.id);
        list.sort((a, b) => Number(!!b.isOnline) - Number(!!a.isOnline) || a.name.localeCompare(b.name));
        setAssignRiders(list);
      })
      .catch(() => { if (live) setAssignRiders([]); });
    return () => { live = false; };
  }, [selectedAssignable, assignRiders]);
  const assignRider = async (o: Order, riderId: string | null) => {
    const id = shortId(orderId(o));
    const who = riderId ? (assignRiders || []).find(r => r.id === riderId)?.name || 'this rider' : null;
    if (!(await confirm(riderId
      ? { title: `Give order ${id} to ${who}?`, description: 'The current rider, if any, loses the order.', confirmLabel: 'Assign rider' }
      : { title: `Remove the rider from order ${id}?`, description: 'The order goes back to all riders.', confirmLabel: 'Remove rider', tone: 'danger' }))) return;
    runAction(o, riderId ? 'Rider assigned' : 'Rider removed', `${API_URL}/api/admin/orders/${orderId(o)}/rider`, { riderId });
    setAssignPick('');
  };

  if (!isAuthed) return null; // AppShell shows the session check

  const visibleOrders = orders.filter(o => filterStatus === 'All' || o.status === filterStatus);
  const breakdown = selectedOrder ? parseJson<PriceBreakdown>(selectedOrder.priceBreakdown) : null;
  const instructions = selectedOrder ? parseJson<string[]>(selectedOrder.deliveryInstructions as string[] | string | null) : null;
  const selectedBusy = !!selectedOrder && busyId === orderId(selectedOrder);
  const selectedOpen = !!selectedOrder && !TERMINAL.includes(selectedOrder.status);
  const selectedVendor = !!selectedOrder && isVendorOrder(selectedOrder);
  const selectedPinLocked = !!selectedOrder && !selectedVendor && (selectedOrder.deliveryPinAttempts || 0) >= PIN_LOCK_ATTEMPTS && selectedOpen;
  const stallWa = selectedOrder?.restaurant?.whatsappNumber ? String(selectedOrder.restaurant.whatsappNumber).replace(/\D/g, '') : '';

  const columns: Column<Order>[] = [
    {
      key: 'id',
      header: 'Order',
      width: '110px',
      cell: o => (
        <div>
          <span className="font-mono text-xs text-fg-muted">{shortId(orderId(o))}</span>
          {isFresh(orderId(o)) && <span className="ml-1.5 text-xs font-medium text-success-text">New</span>}
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      sortValue: o => o.user?.name || '',
      cell: o => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{o.user?.name || 'Customer'}</p>
          <p className="text-xs text-fg-muted">{o.user?.phone || '–'}</p>
        </div>
      ),
    },
    {
      key: 'store',
      header: 'Store and items',
      sortValue: o => o.restaurant?.name || '',
      cell: o => (
        <div className="min-w-0 max-w-[280px]">
          <p className="truncate text-fg">{o.restaurant?.name || '–'}</p>
          <p className="truncate text-xs text-fg-muted">{(o.items || []).map(i => `${i.name || 'Item'} ×${i.quantity}`).join(', ') || '–'}</p>
          {isVendorOrder(o) && <p className="text-xs text-warning-text" title="The stall delivers this order itself and collects cash. No Zenvy rider, no delivery PIN.">Stall delivers, cash to stall</p>}
        </div>
      ),
    },
    { key: 'total', header: 'Total', align: 'right', sortValue: o => grandTotal(o), cell: o => <span className="font-medium tabular-nums text-fg">{rupees(grandTotal(o))}</span> },
    { key: 'payment', header: 'Payment', hideBelow: 'lg', sortValue: o => o.paymentMethod || '', cell: o => <PaymentCell order={o} /> },
    {
      key: 'status',
      header: 'Status',
      sortValue: o => o.status,
      cell: o => (
        <div>
          <OrderStatus status={o.status} />
          <OrderFlags order={o} />
        </div>
      ),
    },
    {
      key: 'placed',
      header: 'Placed',
      align: 'right',
      sortValue: o => new Date(o.createdAt),
      cell: o => <span className="whitespace-nowrap text-xs text-fg-muted">{busyId === orderId(o) ? 'Working…' : formatDateTime(o.createdAt, { short: true })}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Every food and store order: status, rider, payment and refunds. Select an order to see details and support actions."
        meta={<Badge tone={isConnected ? 'success' : 'warning'} dot>{isConnected ? 'Live' : 'Refreshing every 20 seconds'}</Badge>}
        actions={<Button leftIcon={<IconRefresh size={14} />} loading={loading} onClick={() => fetchOrders(currentPage)}>Refresh</Button>}
      />

      <Toolbar end={<span className="text-sm tabular-nums text-fg-muted">{totalOrders.toLocaleString('en-IN')} orders</span>}>
        <SegmentedControl
          ariaLabel="Delivered by"
          value={filterFulfilment}
          onChange={v => setFilterFulfilment(v)}
          options={FULFILMENT_FILTERS.map(f => ({ value: f.value, label: f.label }))}
        />
        <Select aria-label="Status" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="w-auto min-w-[150px]">
          {STATUS_FILTERS.map(s => <option key={s} value={s}>{s === 'All' ? 'All statuses' : statusLabel(s)}</option>)}
        </Select>
        <Button
          variant={stuckHours ? 'primary' : 'secondary'}
          aria-pressed={!!stuckHours}
          onClick={() => setStuckHours(h => (h ? null : 6))}
          title="Stall orders still accepted or out for delivery long after they were placed. They are never cancelled automatically: call the stall."
        >
          Stuck stall orders
        </Button>
        {stuckHours && (
          <Select aria-label="Stuck for at least" value={stuckHours} onChange={e => setStuckHours(Number(e.target.value))} className="w-auto">
            {[2, 4, 6, 12, 24, 48].map(h => <option key={h} value={h}>Open {h} h or more</option>)}
          </Select>
        )}
        {storeFilter && (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface-2 pl-2.5 pr-1 text-sm text-fg">
            One store{orders[0]?.restaurant?.name ? `: ${orders[0].restaurant.name}` : ''}
            <button type="button" onClick={clearStoreFilter} aria-label="Show all stores" className="rounded p-1 text-fg-subtle hover:bg-surface-3 hover:text-fg"><IconX size={12} /></button>
          </span>
        )}
      </Toolbar>

      {notice && (
        <NoticeBox tone={notice.kind === 'error' ? 'danger' : 'success'} className="mb-3" onClose={() => setNotice(null)}>
          <span className="text-fg">{notice.text}</span>
        </NoticeBox>
      )}

      <DataTable
        caption="Orders"
        columns={columns}
        rows={visibleOrders}
        rowKey={o => orderId(o)}
        loading={loading}
        error={loadError}
        onRetry={() => fetchOrders(currentPage)}
        onRowClick={o => setSelectedId(orderId(o))}
        rowClassName={o => (isFresh(orderId(o)) ? FRESH_ROW_CLASS : undefined)}
        pagination={{ page: currentPage, pages: totalPages, total: totalOrders, pageSize: 50, onPage: p => fetchOrders(p) }}
        noun="orders"
        empty={{
          title: filterStatus === 'All' ? 'No orders yet' : `No ${statusLabel(filterStatus).toLowerCase()} orders`,
          description: stuckHours ? 'No stall order has been open that long.' : 'New orders appear here the moment they are placed.',
        }}
      />

      {/* Order detail */}
      <Drawer
        open={!!selectedOrder}
        onClose={() => setSelectedId(null)}
        size="xl"
        title={selectedOrder ? `Order ${shortId(orderId(selectedOrder))}` : 'Order'}
        description={selectedOrder ? `Placed ${formatDateTime(selectedOrder.createdAt)} · ${selectedOrder.restaurant?.name || 'Store'}` : undefined}
        headerActions={selectedOrder ? <OrderStatus status={selectedOrder.status} /> : undefined}
        footer={selectedOrder && selectedOpen && !isLegacyUpiPending(selectedOrder) ? (
          <div className="flex w-full flex-wrap items-center gap-2">
            <span className="mr-auto text-xs text-fg-muted">{selectedVendor ? 'The customer and Zenvy Vendor apps update automatically.' : 'The customer, store and rider apps update automatically.'}</span>
            <Button variant="destructive" disabled={selectedBusy} onClick={() => cancelOrder(selectedOrder)}>Cancel order</Button>
            {selectedVendor && ['Accepted', 'Preparing', 'ReadyForPickup'].includes(selectedOrder.status) && (
              <Button disabled={selectedBusy} onClick={() => setStatus(selectedOrder, 'OutForDelivery')}>Out for delivery</Button>
            )}
            {!selectedVendor && !['Pending', 'PickedUp', 'ArrivedAtGate'].includes(selectedOrder.status) && (
              <Button disabled={selectedBusy} onClick={() => setStatus(selectedOrder, 'PickedUp')}>Mark picked up</Button>
            )}
            {selectedOrder.status !== 'Pending' && (
              <Button variant="primary" disabled={selectedBusy} onClick={() => setStatus(selectedOrder, 'Delivered')}>Mark delivered</Button>
            )}
            {selectedOrder.status === 'Pending' && (
              <Button variant="primary" disabled={selectedBusy} onClick={() => acceptOrder(selectedOrder)}>{selectedVendor ? 'Accept for stall' : 'Accept and dispatch'}</Button>
            )}
          </div>
        ) : undefined}
      >
        {selectedOrder && (
          <div className="space-y-6">
            {selectedBusy && <NoticeBox tone="info">Working…</NoticeBox>}
            {selectedPinLocked && (
              <NoticeBox tone="danger" title="Rider locked out of the delivery PIN">
                The rider entered a wrong delivery PIN {selectedOrder.deliveryPinAttempts} times. Call the customer to confirm they received the order before marking it delivered.
              </NoticeBox>
            )}

            {/* Legacy UPI orders: manual verification only. New orders are COD or Wallet. */}
            {isLegacyUpiPending(selectedOrder) && (
              <NoticeBox
                tone="warning"
                title="Legacy UPI payment waiting for a check"
                action={
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" disabled={selectedBusy} onClick={() => verifyUpi(selectedOrder, true)}>Payment received</Button>
                    <Button size="sm" variant="destructive" disabled={selectedBusy} onClick={() => verifyUpi(selectedOrder, false)}>Reject payment</Button>
                  </div>
                }
              >
                UPI checkout is switched off. Check this older payment against the bank statement before accepting.
                <span className="mt-1 block">UTR: <span className="font-mono text-fg">{selectedOrder.upiUTR || 'not provided'}</span>
                  {selectedOrder.upiScreenshot && /^(https?:|data:image\/)/i.test(selectedOrder.upiScreenshot) && (
                    <> · <a href={selectedOrder.upiScreenshot} target="_blank" rel="noopener noreferrer" className="text-accent-text underline">Open screenshot</a></>
                  )}
                </span>
              </NoticeBox>
            )}

            <DescriptionList
              columns={2}
              items={[
                { label: 'Customer', value: <><span className="font-medium">{selectedOrder.user?.name || 'Customer'}</span><span className="block text-fg-muted">{selectedOrder.user?.phone || 'No phone on file'}</span></> },
                { label: 'Payment', value: <PaymentCell order={selectedOrder} /> },
                {
                  label: 'Delivery',
                  value: (
                    <>
                      <span className="whitespace-pre-line">{selectedOrder.deliveryAddress || (selectedOrder.hostelGateDelivery ? 'Hostel gate' : 'No address on file')}</span>
                      {selectedOrder.deliverySlot && <span className="block text-fg-muted">Slot: {selectedOrder.deliverySlot}</span>}
                      {formatEta(selectedOrder.estDuration) && <span className="block text-fg-muted">Kitchen time: {formatEta(selectedOrder.estDuration)}</span>}
                    </>
                  ),
                },
                { label: 'Order ID', value: <span className="break-all font-mono text-xs">{orderId(selectedOrder)}</span> },
              ]}
            />

            {Array.isArray(instructions) && instructions.length > 0 && (
              <div>
                <p className="text-xs text-fg-muted">Delivery instructions</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-fg">{instructions.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            )}

            {/* Who delivers */}
            {selectedVendor ? (
              <NoticeBox tone="neutral" title="Delivered by the stall">
                {stallName(selectedOrder)} delivers this order itself and collects the cash. No Zenvy rider, no delivery PIN.
                {selectedOrder.outForDeliveryAt && <span className="block">Left the stall {formatDateTime(selectedOrder.outForDeliveryAt, { short: true })}.</span>}
                {stallWa && (
                  <a href={`https://wa.me/${stallWa.length === 10 ? `91${stallWa}` : stallWa}`} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-accent-text underline">WhatsApp the stall <IconExternal size={12} /></a>
                )}
              </NoticeBox>
            ) : (
              <div className="rounded-lg border border-line p-3">
                <p className="text-xs text-fg-muted">Rider</p>
                <p className="mt-0.5 text-sm text-fg">
                  {selectedOrder.deliveryPartnerId ? ((assignRiders || []).find(r => r.id === selectedOrder.deliveryPartnerId)?.name || 'Assigned') : 'Not assigned yet'}
                </p>
                {selectedAssignable && (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <Field label="Give the order to" className="min-w-[220px] flex-1">
                      <Select value={assignPick} onChange={e => setAssignPick(e.target.value)}>
                        <option value="">{assignRiders === null ? 'Loading riders…' : 'Choose a rider'}</option>
                        {(assignRiders || []).filter(r => r.id !== selectedOrder.deliveryPartnerId).map(r => (
                          <option key={r.id} value={r.id}>{r.name}{r.isOnline ? ' · online' : ' · offline'}</option>
                        ))}
                      </Select>
                    </Field>
                    <Button disabled={selectedBusy || !assignPick} onClick={() => assignRider(selectedOrder, assignPick)}>{selectedOrder.deliveryPartnerId ? 'Reassign' : 'Assign'}</Button>
                    {selectedOrder.deliveryPartnerId && (
                      <Button variant="ghost" className="text-danger-text hover:text-danger-text" disabled={selectedBusy} onClick={() => assignRider(selectedOrder, null)}>Remove rider</Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Items and price */}
            <div>
              <p className="mb-1 text-xs text-fg-muted">Items</p>
              <div className="rounded-lg border border-line">
                {(selectedOrder.items || []).length === 0 ? (
                  <p className="px-3 py-3 text-sm text-fg-muted">No items recorded.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {selectedOrder.items.map((item, i) => {
                      const unit = item.priceAtOrder ?? item.price;
                      const line = item.lineTotal ?? (unit != null ? unit * item.quantity : null);
                      return (
                        <li key={i} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
                          <span className="text-fg">{item.name || 'Item'} <span className="text-fg-muted">×{item.quantity}</span></span>
                          <span className="tabular-nums text-fg">{line != null ? rupees(line) : '–'}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="space-y-1 border-t border-line px-3 py-2 text-sm">
                  {breakdown?.subtotal != null && <div className="flex justify-between text-fg-muted"><span>Subtotal</span><span className="tabular-nums">{rupees(breakdown.subtotal)}</span></div>}
                  {breakdown?.deliveryFee != null && <div className="flex justify-between text-fg-muted"><span>Delivery fee</span><span className="tabular-nums">{rupees(breakdown.deliveryFee)}</span></div>}
                  {!!breakdown?.packagingFee && <div className="flex justify-between text-fg-muted"><span>Packaging</span><span className="tabular-nums">{rupees(breakdown.packagingFee)}</span></div>}
                  {!!breakdown?.taxes && <div className="flex justify-between text-fg-muted"><span>Taxes</span><span className="tabular-nums">{rupees(breakdown.taxes)}</span></div>}
                  {(breakdown?.discounts || []).map((d, i) => (
                    <div key={i} className="flex justify-between text-success-text"><span>{d.label}</span><span className="tabular-nums">−{rupees(d.amount)}</span></div>
                  ))}
                  <div className="flex justify-between pt-1 font-semibold text-fg"><span>Total</span><span className="tabular-nums">{rupees(grandTotal(selectedOrder))}</span></div>
                </div>
              </div>
            </div>

            {selectedOrder.cancellationReason && (
              <NoticeBox tone="danger" title="Cancellation reason">{selectedOrder.cancellationReason}</NoticeBox>
            )}

            <div>
              <p className="mb-1 text-xs text-fg-muted">Receipt</p>
              <ReceiptPanel key={orderId(selectedOrder)} order={selectedOrder} />
            </div>
          </div>
        )}
      </Drawer>

      {/* Cancel: asks for the reason the customer sees (same request as before). */}
      <Modal
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        size="sm"
        title={cancelling ? `Cancel order ${shortId(orderId(cancelling))}?` : 'Cancel order'}
        description={cancelling
          ? `This cannot be undone.${cancelling.paymentMethod === 'Wallet' ? ` ${rupees(grandTotal(cancelling))} will be refunded to the customer's Wallet.` : ''}`
          : undefined}
        footer={
          <>
            <Button onClick={() => setCancelling(null)}>Keep order</Button>
            <Button variant="destructive" onClick={confirmCancel}>Cancel order</Button>
          </>
        }
      >
        <Field label="Reason" hint="Shown to the customer.">
          <Textarea rows={2} value={cancelReason} onChange={e => setCancelReason(e.target.value)} maxLength={300} />
        </Field>
      </Modal>
    </div>
  );
}
