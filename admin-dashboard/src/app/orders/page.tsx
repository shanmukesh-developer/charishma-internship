"use client";
import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useAdminSocket } from '@/components/AdminSocketProvider';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { API_URL } from '@/lib/config';
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
const rupees = (n: number | null | undefined) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
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
    <div className="mt-3 space-y-2">
      {order.receiptNumber && (
        <p className="text-[10px] text-gray-400">Receipt no. <span className="font-mono font-bold text-white">{order.receiptNumber}</span></p>
      )}
      <button onClick={open} disabled={state.loading} className="px-3 py-1.5 bg-white/5 text-gray-200 border border-white/10 rounded-xl text-[9px] font-black uppercase tracking-wider hover:bg-white/10 disabled:opacity-30">
        {state.loading ? 'Opening…' : 'View receipt'}
      </button>
      {!TERMINAL.includes(order.status) && !state.error && <p className="text-[10px] text-gray-500">A receipt is issued once the order is delivered.</p>}
      {state.error && <p className="text-[10px] font-bold text-amber-400">{state.error}</p>}
      {state.url && (
        <p className="text-[10px] text-gray-500">
          Did not open? <a href={state.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">Open receipt ↗</a> (link valid for 15 minutes)
        </p>
      )}
    </div>
  );
};

const getStatusStyle = (status: string) => {
  switch (status) {
    case 'Pending': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    case 'Accepted':
    case 'Preparing': return 'bg-sky-500/10 text-sky-400 border-sky-500/20';
    case 'ReadyForPickup': return 'bg-violet-500/10 text-violet-400 border-violet-500/20';
    case 'Picking':
    case 'PickedUp':
    case 'ArrivedAtGate':
    case 'OutForDelivery': return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
    case 'Delivered': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    case 'Cancelled': return 'bg-red-500/10 text-red-500 border-red-500/20';
    default: return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  }
};

const PaymentBadge = ({ order }: { order: Order }) => {
  const method = order.paymentMethod || '—';
  let tone = 'text-gray-400 bg-white/5 border-white/10';
  let note = order.paymentStatus || '';
  if (method === 'UPI') {
    tone = order.upiStatus === 'Pending' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' : 'text-gray-400 bg-white/5 border-white/10';
    note = `Legacy UPI · ${order.upiStatus || 'n/a'}`;
  } else if (order.paymentStatus === 'Completed') {
    tone = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <span className={`text-[9px] font-black px-2 py-0.5 rounded border uppercase tracking-wider ${tone}`}>{method}</span>
      {note && <span className="text-[8px] text-gray-500 uppercase tracking-wider">{note}</span>}
    </div>
  );
};

const OrderRow = memo(({ order, busy, fresh, onSelect }: {
  order: Order;
  busy: boolean;
  fresh?: boolean;
  onSelect: (o: Order) => void;
}) => {
  const id = orderId(order);
  const pinLocked = !isVendorOrder(order) && (order.deliveryPinAttempts || 0) >= PIN_LOCK_ATTEMPTS && !TERMINAL.includes(order.status);
  return (
    <tr className={`hover:bg-white/[0.02] transition-colors cursor-pointer ${fresh ? FRESH_ROW_CLASS : ''}`} onClick={() => onSelect(order)}>
      <td className="p-4">
        <span className="font-mono text-[10px] text-gray-400">{shortId(id)}</span>
        {fresh && <span className="ml-2 text-[8px] font-black uppercase tracking-wider text-emerald-400">new</span>}
      </td>
      <td className="p-4">
        <p className="text-xs font-bold text-white">{order.user?.name || 'Customer'}</p>
        <p className="text-[9px] text-gray-500">{order.user?.phone || '—'}</p>
      </td>
      <td className="p-4">
        <p className="text-xs text-gray-300 font-bold">{order.restaurant?.name || '—'}</p>
        {isVendorOrder(order) && (
          <p className="mt-0.5 text-[8px] font-black uppercase tracking-wider text-amber-400" title="The stall delivers this order itself and collects cash. No Zenvy rider, no delivery PIN.">Stall delivers · COD to stall</p>
        )}
        <p className="text-[10px] text-gray-500 max-w-[220px] truncate">
          {(order.items || []).map(i => `${i.name || 'Item'} ×${i.quantity}`).join(', ') || '—'}
        </p>
      </td>
      <td className="p-4">
        <span className="text-xs font-black text-white">{rupees(grandTotal(order))}</span>
      </td>
      <td className="p-4"><PaymentBadge order={order} /></td>
      <td className="p-4">
        <div className="flex flex-col items-start gap-1">
          <span className={`text-[9px] font-black px-2 py-1 rounded-md border uppercase tracking-wider ${getStatusStyle(order.status)}`}>
            {statusLabel(order.status)}
          </span>
          {isLegacyUpiPending(order) && (
            <span className="text-[8px] font-black text-amber-400 uppercase tracking-wider">Payment check needed</span>
          )}
          {pinLocked && (
            <span className="text-[8px] font-black text-red-400 uppercase tracking-wider">PIN locked</span>
          )}
          {order.stuckFlaggedAt && !TERMINAL.includes(order.status) && (
            <span className="text-[8px] font-black text-orange-400 uppercase tracking-wider" title="This stall order has been open for hours. Call the stall, then mark it Delivered or cancel it.">Stuck · check with stall</span>
          )}
        </div>
      </td>
      <td className="p-4">
        <span className="text-[10px] text-gray-500">
          {new Date(order.createdAt).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      </td>
      <td className="p-4 text-right">
        <span className="text-[9px] font-black uppercase tracking-widest text-blue-400">{busy ? 'Working…' : 'Open →'}</span>
      </td>
    </tr>
  );
});
OrderRow.displayName = 'OrderRow';

export default function OrdersPage() {
  const { isAuthed } = useAdminAuth();
  const { socket, isConnected, notifyLive } = useAdminSocket();
  const { mark: markFresh, isFresh } = useFreshIds();
  const [orders, setOrders] = useState<Order[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const selectedOrder = selectedId ? orders.find(o => orderId(o) === selectedId) || null : null;

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

  const acceptOrder = (o: Order) => {
    const question = isVendorOrder(o)
      ? `Accept order ${shortId(orderId(o))} on behalf of ${stallName(o)}? Only do this after confirming with the stall: the stall delivers it itself (no rider).`
      : `Accept order ${shortId(orderId(o))} on behalf of ${o.restaurant?.name || 'the store'} and send it to riders?`;
    if (!confirm(question)) return;
    runAction(o, 'Order accepted', `${API_URL}/api/orders/${orderId(o)}/restaurant-accept`, {}, 'Accepted');
  };

  const setStatus = (o: Order, status: string) => {
    const id = shortId(orderId(o));
    if (status === 'Delivered') {
      const cash = o.paymentMethod === 'COD' ? `\n\nThis is a Cash on Delivery order: confirm ${rupees(grandTotal(o))} was collected${isVendorOrder(o) ? ` by ${stallName(o)}` : ''}.` : '';
      if (!confirm(`Mark order ${id} as delivered? The customer is notified and rewards are credited.${cash}`)) return;
    } else if (!confirm(`Change order ${id} to "${statusLabel(status)}"?`)) {
      return;
    }
    runAction(o, `Marked ${statusLabel(status)}`, `${API_URL}/api/orders/${orderId(o)}/status`, { status }, status);
  };

  const cancelOrder = (o: Order) => {
    const id = shortId(orderId(o));
    const refundNote = o.paymentMethod === 'Wallet' ? `\n${rupees(grandTotal(o))} will be refunded to the customer's Wallet.` : '';
    const reason = prompt(`Cancel order ${id}? This cannot be undone.${refundNote}\n\nReason (shown to the customer):`, 'Cancelled by Zenvy support');
    if (reason === null) return;
    runAction(o, 'Order cancelled', `${API_URL}/api/orders/${orderId(o)}/status`, { status: 'Cancelled', reason: reason.trim() || undefined }, 'Cancelled');
  };

  const verifyUpi = (o: Order, isVerified: boolean) => {
    const id = shortId(orderId(o));
    const question = isVerified
      ? `Confirm you found UTR ${o.upiUTR || '(none)'} for ${rupees(grandTotal(o))} in the bank statement? The order will be accepted.`
      : `Reject the UPI payment for order ${id}? The order will be cancelled.`;
    if (!confirm(question)) return;
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
  const assignRider = (o: Order, riderId: string | null) => {
    const id = shortId(orderId(o));
    const who = riderId ? (assignRiders || []).find(r => r.id === riderId)?.name || 'this rider' : null;
    if (!confirm(riderId ? `Give order ${id} to ${who}? The current rider (if any) loses it.` : `Take order ${id} away from its rider? It goes back to all riders.`)) return;
    runAction(o, riderId ? 'Rider assigned' : 'Rider removed', `${API_URL}/api/admin/orders/${orderId(o)}/rider`, { riderId });
    setAssignPick('');
  };

  if (!isAuthed) return <div className="p-20 text-center font-black text-white uppercase tracking-widest animate-pulse">Checking access…</div>;

  const visibleOrders = orders.filter(o => filterStatus === 'All' || o.status === filterStatus);
  const breakdown = selectedOrder ? parseJson<PriceBreakdown>(selectedOrder.priceBreakdown) : null;
  const instructions = selectedOrder ? parseJson<string[]>(selectedOrder.deliveryInstructions as string[] | string | null) : null;
  const selectedBusy = !!selectedOrder && busyId === orderId(selectedOrder);
  const selectedOpen = !!selectedOrder && !TERMINAL.includes(selectedOrder.status);
  const selectedVendor = !!selectedOrder && isVendorOrder(selectedOrder);
  const selectedPinLocked = !!selectedOrder && !selectedVendor && (selectedOrder.deliveryPinAttempts || 0) >= PIN_LOCK_ATTEMPTS && selectedOpen;
  const stallWa = selectedOrder?.restaurant?.whatsappNumber ? String(selectedOrder.restaurant.whatsappNumber).replace(/\D/g, '') : '';

  return (
    <div className="space-y-8 animate-fade-in relative pb-20">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tighter text-white uppercase">Orders</h1>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mt-1">Live order queue · Cash on Delivery and Wallet</p>
        </div>
        <button
          onClick={() => fetchOrders(currentPage)}
          disabled={loading}
          className="nexus-badge bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20 transition-all disabled:opacity-40"
        >
          ↻ Refresh ({totalOrders})
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FULFILMENT_FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilterFulfilment(f.value)}
            aria-pressed={filterFulfilment === f.value}
            className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all ${filterFulfilment === f.value ? 'bg-amber-500 text-black border-amber-500' : 'bg-white/5 text-gray-500 border-white/10 hover:text-white'}`}
          >
            {f.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-white/10" aria-hidden />
        <button
          onClick={() => setStuckHours(h => (h ? null : 6))}
          aria-pressed={!!stuckHours}
          title="Stall orders still Accepted / Out for delivery long after they were placed. They are never auto-cancelled: call the stall."
          className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all ${stuckHours ? 'bg-orange-500 text-black border-orange-500' : 'bg-white/5 text-gray-500 border-white/10 hover:text-white'}`}
        >
          Stall orders stuck &gt; {stuckHours || 6} h
        </button>
        {stuckHours && (
          <select
            value={stuckHours}
            onChange={e => setStuckHours(Number(e.target.value))}
            aria-label="Stuck for at least"
            className="rounded-xl border border-white/10 bg-black/40 px-2 py-1 text-[10px] font-bold text-gray-300"
          >
            {[2, 4, 6, 12, 24, 48].map(h => <option key={h} value={h}>{h} h</option>)}
          </select>
        )}
        {storeFilter && (
          <span className="ml-2 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-emerald-300">
            One store{orders[0]?.restaurant?.name ? `: ${orders[0].restaurant.name}` : ''}
            <button onClick={clearStoreFilter} className="text-emerald-200 hover:text-white" aria-label="Show all stores">✕</button>
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all ${filterStatus === s ? 'bg-blue-500 text-white border-blue-500' : 'bg-white/5 text-gray-500 border-white/10 hover:text-white'}`}
          >
            {s === 'All' ? 'All' : statusLabel(s)}
          </button>
        ))}
      </div>

      {notice && (
        <div className={`p-4 rounded-2xl border text-xs font-bold flex justify-between items-start gap-4 ${notice.kind === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-gray-500 hover:text-white">✕</button>
        </div>
      )}

      <div className="glass-card overflow-hidden border-white/10">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02]">
                {['Order', 'Customer', 'Store & items', 'Total', 'Payment', 'Status', 'Placed', ''].map(h => (
                  <th key={h} className="p-4 text-[10px] font-black uppercase text-gray-400 tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-10 text-center">
                    <div className="flex flex-col items-center justify-center gap-2 text-gray-500">
                      <div className="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                      <p className="text-[10px] uppercase font-black tracking-widest">Loading orders…</p>
                    </div>
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={8} className="p-10 text-center">
                    <p className="text-xs text-red-400 font-bold">{loadError}</p>
                    <button onClick={() => fetchOrders(currentPage)} className="mt-3 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase text-gray-300 hover:text-white">Try again</button>
                  </td>
                </tr>
              ) : visibleOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-gray-500 text-xs">
                    {filterStatus === 'All' ? 'No orders yet.' : `No ${statusLabel(filterStatus).toLowerCase()} orders.`}
                  </td>
                </tr>
              ) : (
                visibleOrders.map(order => (
                  <OrderRow
                    key={orderId(order)}
                    order={order}
                    busy={busyId === orderId(order)}
                    fresh={isFresh(orderId(order))}
                    onSelect={(o) => setSelectedId(orderId(o))}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="p-6 bg-white/[0.02] border-t border-white/5 flex items-center justify-between">
            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
              Page {currentPage} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={currentPage <= 1 || loading}
                onClick={() => fetchOrders(currentPage - 1)}
                className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase text-gray-400 hover:text-white disabled:opacity-30"
              >
                Previous
              </button>
              <button
                disabled={currentPage >= totalPages || loading}
                onClick={() => fetchOrders(currentPage + 1)}
                className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase text-gray-400 hover:text-white disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Order detail */}
      {selectedOrder && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm animate-fade-in" onClick={() => setSelectedId(null)}>
          <div className="glass-card max-w-3xl w-full p-8 space-y-6 animate-slide-up relative max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <button onClick={() => setSelectedId(null)} className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors" aria-label="Close">✕</button>

            <div className="flex justify-between items-start border-b border-white/5 pb-6 pr-10">
              <div>
                <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Order {shortId(orderId(selectedOrder))}</h3>
                <p className="text-[10px] text-gray-500 font-mono mt-1">{orderId(selectedOrder)}</p>
                <p className="text-[10px] text-gray-500 mt-1">Placed {new Date(selectedOrder.createdAt).toLocaleString()}</p>
              </div>
              <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${getStatusStyle(selectedOrder.status)}`}>
                {statusLabel(selectedOrder.status)}
              </div>
            </div>

            {selectedPinLocked && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-xs text-red-400 font-bold">
                The rider entered a wrong delivery PIN {selectedOrder.deliveryPinAttempts} times and is locked out. Call the customer to confirm they received the order before marking it delivered here.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-5">
                <div>
                  <h5 className="text-[9px] font-black text-blue-500 uppercase tracking-[0.2em] mb-2">Customer</h5>
                  <p className="text-lg font-black text-white">{selectedOrder.user?.name || 'Customer'}</p>
                  <p className="text-xs text-gray-400 font-bold">{selectedOrder.user?.phone || 'No phone on file'}</p>
                </div>
                <div>
                  <h5 className="text-[9px] font-black text-blue-500 uppercase tracking-[0.2em] mb-2">Delivery</h5>
                  <p className="text-xs text-white font-bold whitespace-pre-line">{selectedOrder.deliveryAddress || (selectedOrder.hostelGateDelivery ? 'Hostel gate' : 'No address on file')}</p>
                  {selectedOrder.deliverySlot && <p className="text-[10px] text-blue-400 font-black mt-1">Slot: {selectedOrder.deliverySlot}</p>}
                  {formatEta(selectedOrder.estDuration) && <p className="text-[10px] text-sky-400 font-black mt-1">Kitchen time: {formatEta(selectedOrder.estDuration)}</p>}
                  {Array.isArray(instructions) && instructions.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {instructions.map((t, i) => <li key={i} className="text-[10px] text-gray-300">• {t}</li>)}
                    </ul>
                  )}
                  <p className="text-[10px] text-gray-500 mt-2">Store: {selectedOrder.restaurant?.name || '—'}</p>
                  {selectedVendor ? (
                    <div className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                      <p className="text-[9px] font-black uppercase tracking-widest text-amber-400">Delivered by the stall</p>
                      <p className="mt-1 text-[11px] text-gray-300">{stallName(selectedOrder)} delivers this order itself and collects the cash. No Zenvy rider, no delivery PIN.</p>
                      {selectedOrder.outForDeliveryAt && <p className="mt-1 text-[10px] text-gray-500">Left the stall {new Date(selectedOrder.outForDeliveryAt).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>}
                      {stallWa && (
                        <a href={`https://wa.me/${stallWa.length === 10 ? `91${stallWa}` : stallWa}`} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[10px] font-bold text-emerald-400 underline">WhatsApp the stall ↗</a>
                      )}
                    </div>
                  ) : (
                    <div className="mt-1 space-y-2">
                      <p className="text-[10px] text-gray-500">
                        Rider: {selectedOrder.deliveryPartnerId ? ((assignRiders || []).find(r => r.id === selectedOrder.deliveryPartnerId)?.name || 'Assigned') : 'Not assigned yet'}
                      </p>
                      {selectedAssignable && (
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={assignPick}
                            onChange={e => setAssignPick(e.target.value)}
                            aria-label="Rider to assign"
                            className="rounded-xl border border-white/10 bg-black/40 px-2 py-1 text-[10px] font-bold text-gray-300"
                          >
                            <option value="">{assignRiders === null ? 'Loading riders…' : 'Choose a rider…'}</option>
                            {(assignRiders || []).filter(r => r.id !== selectedOrder.deliveryPartnerId).map(r => (
                              <option key={r.id} value={r.id}>{r.name}{r.isOnline ? ' · online' : ' · offline'}</option>
                            ))}
                          </select>
                          <button disabled={selectedBusy || !assignPick} onClick={() => assignRider(selectedOrder, assignPick)} className="px-3 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-xl text-[9px] font-black uppercase tracking-wider hover:bg-blue-500/20 disabled:opacity-30">
                            {selectedOrder.deliveryPartnerId ? 'Reassign' : 'Assign'}
                          </button>
                          {selectedOrder.deliveryPartnerId && (
                            <button disabled={selectedBusy} onClick={() => assignRider(selectedOrder, null)} className="px-3 py-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl text-[9px] font-black uppercase tracking-wider hover:bg-red-500/20 disabled:opacity-30">
                              Remove rider
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <h5 className="text-[9px] font-black text-blue-500 uppercase tracking-[0.2em] mb-2">Payment</h5>
                  <PaymentBadge order={selectedOrder} />
                  <ReceiptPanel key={orderId(selectedOrder)} order={selectedOrder} />
                  {selectedOrder.cancellationReason && (
                    <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
                      <span className="text-[8px] font-black uppercase tracking-widest block mb-1">Cancellation reason</span>
                      <p className="text-[11px] font-bold">{selectedOrder.cancellationReason}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <h5 className="text-[9px] font-black text-blue-500 uppercase tracking-[0.2em]">Items</h5>
                <div className="space-y-2 bg-white/[0.02] p-4 rounded-2xl border border-white/5 max-h-[200px] overflow-y-auto">
                  {(selectedOrder.items || []).length === 0 ? (
                    <p className="text-xs text-gray-500">No items recorded.</p>
                  ) : selectedOrder.items.map((item, i) => {
                    const unit = item.priceAtOrder ?? item.price;
                    const line = item.lineTotal ?? (unit != null ? unit * item.quantity : null);
                    return (
                      <div key={i} className="flex justify-between items-center text-xs gap-4">
                        <span className="text-white font-bold">{item.name || 'Item'} <span className="text-gray-500 ml-1">×{item.quantity}</span></span>
                        <span className="text-gray-400">{line != null ? rupees(line) : '—'}</span>
                      </div>
                    );
                  })}
                </div>
                {breakdown && (
                  <div className="space-y-1 text-[11px] text-gray-400">
                    {breakdown.subtotal != null && <div className="flex justify-between"><span>Subtotal</span><span>{rupees(breakdown.subtotal)}</span></div>}
                    {breakdown.deliveryFee != null && <div className="flex justify-between"><span>Delivery fee</span><span>{rupees(breakdown.deliveryFee)}</span></div>}
                    {!!breakdown.packagingFee && <div className="flex justify-between"><span>Packaging</span><span>{rupees(breakdown.packagingFee)}</span></div>}
                    {!!breakdown.taxes && <div className="flex justify-between"><span>Taxes</span><span>{rupees(breakdown.taxes)}</span></div>}
                    {(breakdown.discounts || []).map((d, i) => (
                      <div key={i} className="flex justify-between text-emerald-400"><span>{d.label}</span><span>−{rupees(d.amount)}</span></div>
                    ))}
                  </div>
                )}
                <div className="flex justify-between items-center pt-3 border-t border-white/5">
                  <span className="text-[10px] font-black text-white uppercase tracking-widest">Total</span>
                  <span className="text-xl font-black text-blue-500">{rupees(grandTotal(selectedOrder))}</span>
                </div>
              </div>
            </div>

            {/* Legacy UPI orders: manual verification only. New orders are COD or Wallet. */}
            {isLegacyUpiPending(selectedOrder) && (
              <div className="p-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 space-y-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">Legacy UPI payment awaiting verification</p>
                  <p className="text-[11px] text-gray-400 mt-1">UPI checkout is switched off. Check this older payment against the bank statement before accepting.</p>
                </div>
                <div className="flex flex-wrap gap-4 items-center text-xs">
                  <span className="text-gray-400">UTR: <span className="font-mono text-white">{selectedOrder.upiUTR || 'not provided'}</span></span>
                  {selectedOrder.upiScreenshot && /^(https?:|data:image\/)/i.test(selectedOrder.upiScreenshot) && (
                    <a href={selectedOrder.upiScreenshot} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">Open screenshot</a>
                  )}
                </div>
                <div className="flex gap-2">
                  <button disabled={selectedBusy} onClick={() => verifyUpi(selectedOrder, true)} className="px-4 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl text-[9px] font-black uppercase tracking-wider hover:bg-emerald-500/20 disabled:opacity-30">Payment received</button>
                  <button disabled={selectedBusy} onClick={() => verifyUpi(selectedOrder, false)} className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl text-[9px] font-black uppercase tracking-wider hover:bg-red-500/20 disabled:opacity-30">Reject payment</button>
                </div>
              </div>
            )}

            {selectedOpen && !isLegacyUpiPending(selectedOrder) && (
              <div className="space-y-3 pt-4 border-t border-white/5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Support actions</span>
                  <span className="text-[9px] text-gray-500">{selectedVendor ? 'The customer and Zenvy Vendor apps update automatically' : 'The customer, store and rider apps update automatically'}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {selectedOrder.status === 'Pending' && (
                    <button disabled={selectedBusy} onClick={() => acceptOrder(selectedOrder)} className="py-2.5 px-2 bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-xl text-[9px] font-black uppercase tracking-wider hover:bg-sky-500/20 disabled:opacity-30 transition-all">{selectedVendor ? 'Accept for stall' : 'Accept & dispatch'}</button>
                  )}
                  {selectedVendor && ['Accepted', 'Preparing', 'ReadyForPickup'].includes(selectedOrder.status) && (
                    <button disabled={selectedBusy} onClick={() => setStatus(selectedOrder, 'OutForDelivery')} className="py-2.5 px-2 bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded-xl text-[9px] font-black uppercase tracking-wider hover:bg-orange-500/20 disabled:opacity-30 transition-all">Out for delivery</button>
                  )}
                  {!selectedVendor && !['Pending', 'PickedUp', 'ArrivedAtGate'].includes(selectedOrder.status) && (
                    <button disabled={selectedBusy} onClick={() => setStatus(selectedOrder, 'PickedUp')} className="py-2.5 px-2 bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded-xl text-[9px] font-black uppercase tracking-wider hover:bg-orange-500/20 disabled:opacity-30 transition-all">Mark picked up</button>
                  )}
                  {selectedOrder.status !== 'Pending' && (
                    <button disabled={selectedBusy} onClick={() => setStatus(selectedOrder, 'Delivered')} className="py-2.5 px-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl text-[9px] font-black uppercase tracking-wider hover:bg-emerald-500/20 disabled:opacity-30 transition-all">Mark delivered</button>
                  )}
                  <button disabled={selectedBusy} onClick={() => cancelOrder(selectedOrder)} className="py-2.5 px-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl text-[9px] font-black uppercase tracking-wider hover:bg-red-500/20 disabled:opacity-30 transition-all">Cancel order</button>
                </div>
                {selectedBusy && <p className="text-[10px] text-gray-500">Working…</p>}
              </div>
            )}

            <button onClick={() => setSelectedId(null)} className="w-full py-3 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black uppercase text-gray-400 hover:text-white transition-all">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
