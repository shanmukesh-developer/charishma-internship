"use client";

import { useEffect, useRef, useState } from 'react';
import { API_URL } from '@/lib/config';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { useAdminSocket } from '@/components/AdminSocketProvider';

interface BasketItem {
  id?: string;
  name: string;
  quantity: number;
  unit?: string;
  priceEstimated?: number;
  priceActual?: number;
  status?: string;
}

interface MegaBasket {
  id: string;
  status: string;
  estimatedTotal: number;
  actualTotal: number | null;
  shoppingFee: number;
  deliveryFee: number;
  deliveryAddress: string;
  paymentMethod: string;
  paymentStatus: string;
  upiUTR?: string | null;
  createdAt: string;
  items?: BasketItem[];
  user?: { name?: string; phone?: string; hostelBlock?: string; roomNumber?: string };
  deliveryPartner?: { name?: string; phone?: string } | null;
}

const STATUS_LABELS: Record<string, string> = {
  Created: 'Waiting for a shopper',
  PaidEstimate: 'Waiting for a shopper (legacy prepaid)',
  PartnerAssigned: 'Shopper assigned',
  Shopping: 'Shopping',
  PriceApprovalPending: 'Waiting for customer to approve prices',
  Approved: 'Prices approved',
  Purchased: 'Purchased',
  Delivering: 'Out for delivery',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
};
const ADMIN_LIST_LIMIT = 50; // GET /api/mega-basket/admin/all returns the latest 50

// New baskets are cash on delivery only; UPI baskets are legacy and shown for reference.
const paymentText = (basket: MegaBasket) => {
  if (basket.paymentMethod === 'UPI') {
    return `UPI (legacy) · ${basket.paymentStatus}${basket.upiUTR ? ` · UTR ${basket.upiUTR}` : ' · no UTR'}`;
  }
  const state = basket.paymentStatus === 'Completed' ? 'collected' : basket.paymentStatus === 'Failed' ? 'failed' : 'due at delivery';
  return `Cash on delivery · ${state}`;
};

const formatDate = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

// The admin can cancel any basket that has not been delivered yet (same rule as the backend).
const ADMIN_CANCELLABLE = new Set(['Created', 'PaidEstimate', 'PartnerAssigned', 'Shopping', 'PriceApprovalPending', 'Approved', 'Purchased', 'Delivering']);

const STATUSES = ['Created', 'PaidEstimate', 'PartnerAssigned', 'Shopping', 'PriceApprovalPending', 'Approved', 'Purchased', 'Delivering', 'Delivered', 'Cancelled'];

export default function MegaBasketAdminPage() {
  const { isAuthed } = useAdminAuth();
  const [baskets, setBaskets] = useState<MegaBasket[]>([]);
  const [status, setStatus] = useState('All');
  const [search, setSearch] = useState('');
  const [refreshCount, setRefreshCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const cancelBasket = async (basket: MegaBasket) => {
    if (cancellingId) return;
    const who = basket.user?.name || 'the student';
    const shopping = ['Shopping', 'PriceApprovalPending', 'Approved', 'Purchased', 'Delivering'].includes(basket.status);
    if (!confirm(`Cancel ${who}'s basket #${basket.id.slice(-8).toUpperCase()}?${shopping ? ' The shopper has already started; tell them to stop before you cancel.' : ''} This cannot be undone.`)) return;
    setCancellingId(basket.id);
    setNotice(null);
    try {
      const response = await fetch(`${API_URL}/api/mega-basket/${encodeURIComponent(basket.id)}/cancel`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled by Zenvy support' }),
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error('Your session has expired. Please sign in again.');
      if (!response.ok) throw new Error(data.message || `Could not cancel this basket (${response.status}).`);
      setBaskets(prev => prev.map(b => (b.id === basket.id ? { ...b, status: 'Cancelled' } : b)));
      setNotice({ kind: 'ok', text: `Basket #${basket.id.slice(-8).toUpperCase()} cancelled.` });
      setRefreshCount(count => count + 1);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof TypeError ? 'Could not reach the server. Check your connection and try again.' : err instanceof Error ? err.message : 'Could not cancel this basket.' });
    } finally {
      setCancellingId(null);
    }
  };
  const { socket } = useAdminSocket();

  const basketIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => { basketIdsRef.current = new Set(baskets.map(b => String(b.id))); }, [baskets]);

  // Reload when a customer creates a new basket, or a basket's status changes (the backend sends
  // `statusUpdated` { id, status } to admin-room; orders use the same event, so only known basket ids count).
  // Bursts of events become one quiet reload (no spinner) per 800 ms window.
  const quietReload = useRef(false);
  useEffect(() => {
    if (!socket) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        quietReload.current = true;
        setRefreshCount(count => count + 1);
      }, 800);
    };
    const onNew = () => bump();
    const onStatus = (payload: { id?: string | number } | undefined) => {
      if (payload?.id != null && basketIdsRef.current.has(String(payload.id))) bump();
    };
    socket.on('admin_newMegaBasket', onNew);
    socket.on('statusUpdated', onStatus);
    return () => {
      socket.off('admin_newMegaBasket', onNew);
      socket.off('statusUpdated', onStatus);
      if (timer) clearTimeout(timer);
    };
  }, [socket]);

  useEffect(() => {
    const controller = new AbortController();
    const quiet = quietReload.current;
    quietReload.current = false;
    const loadBaskets = async () => {
      if (!quiet) {
        setLoading(true);
        setError('');
      }
      try {
        const response = await fetch(`${API_URL}/api/mega-basket/admin/all`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) throw new Error('Your session has expired. Please sign in again.');
        if (response.status >= 500) throw new Error(`The server could not load Mega Baskets (${response.status}). Please try again.`);
        if (!response.ok) throw new Error(data.message || `Could not load Mega Baskets (${response.status}).`);
        setBaskets(Array.isArray(data) ? data : []);
      } catch (loadError) {
        if (!controller.signal.aborted) setError(loadError instanceof TypeError ? 'Could not reach the server. Check your connection and try again.' : loadError instanceof Error ? loadError.message : 'Could not load Mega Baskets.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    loadBaskets();
    return () => controller.abort();
  }, [refreshCount]);

  const filtered = baskets.filter(basket => {
    const matchesStatus = status === 'All' || basket.status === status;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [basket.id, basket.user?.name, basket.user?.phone, basket.deliveryAddress, basket.user?.hostelBlock, basket.upiUTR]
      .some(value => value?.toLowerCase().includes(query));
    return matchesStatus && matchesSearch;
  });

  if (!isAuthed) return <div className="p-10 text-center text-sm text-fg-muted" role="status">Checking your admin session…</div>;

  return (
    <div className="mx-auto max-w-7xl space-y-6 text-fg">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Mega Basket</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">Customer baskets, shopping progress, payment and shopper assignment. Stuck baskets can be cancelled before delivery. New baskets are cash on delivery; older UPI baskets are shown for reference.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-fg-muted">{filtered.length} of {baskets.length} baskets{baskets.length >= ADMIN_LIST_LIMIT ? ` (latest ${ADMIN_LIST_LIMIT})` : ''}</span>
          <button type="button" disabled={loading} onClick={() => setRefreshCount(count => count + 1)} className="border border-line px-4 py-2 text-sm font-semibold text-fg-muted hover:text-fg disabled:opacity-50">{loading ? 'Refreshing...' : 'Refresh'}</button>
        </div>
      </header>

      <section className="grid gap-3 border border-line bg-surface-2/60 p-4 md:grid-cols-[1fr_2fr]" aria-label="Mega Basket filters">
        <label className="space-y-1 text-xs font-semibold text-fg-muted">Status
          <select value={status} onChange={event => setStatus(event.target.value)} className="mt-1 w-full border border-line bg-surface p-2.5 text-sm text-fg">
            <option value="All">All</option>{STATUSES.map(value => <option key={value} value={value}>{STATUS_LABELS[value] || value}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-fg-muted">Search
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Basket ID, customer, phone, block, address" className="mt-1 w-full border border-line bg-surface p-2.5 text-sm font-normal text-fg placeholder:text-fg-subtle" />
        </label>
      </section>

      {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`flex items-center justify-between gap-3 border p-4 text-sm ${notice.kind === 'error' ? 'border-danger/30 bg-danger-soft text-danger-text' : 'border-success/30 bg-success-soft text-success-text'}`}>{notice.text}<button type="button" onClick={() => setNotice(null)} className="font-semibold underline">Dismiss</button></div>}
      {error && <div role="alert" className="flex items-center justify-between gap-3 border border-danger/30 bg-danger-soft p-4 text-sm text-danger-text">{error}<button type="button" onClick={() => setRefreshCount(count => count + 1)} className="font-semibold underline">Retry</button></div>}
      {loading ? <div role="status" className="border border-line p-8 text-sm text-fg-muted">Loading Mega Baskets...</div> : filtered.length === 0 ? (
        <div className="border border-line p-10 text-center"><h2 className="font-semibold">No matching baskets</h2><p className="mt-2 text-sm text-fg-muted">Recent customer baskets will appear here.</p></div>
      ) : (
        <section className="divide-y divide-line border border-line" aria-label="Mega Basket list">
          {filtered.map(basket => {
            const itemCount = basket.items?.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) || 0;
            const total = Number(basket.actualTotal ?? basket.estimatedTotal ?? 0) + Number(basket.shoppingFee || 0) + Number(basket.deliveryFee || 0);
            return (
              <article key={basket.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">{basket.user?.name || 'Student'}’s basket</h2>
                      <span className="border border-warning/30 bg-warning-soft px-2 py-1 text-xs font-semibold text-warning-text">{STATUS_LABELS[basket.status] || basket.status}</span>
                    </div>
                    <p className="mt-2 text-xs text-fg-muted">#{basket.id.slice(-8).toUpperCase()} · {formatDate(basket.createdAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                  {ADMIN_CANCELLABLE.has(basket.status) && (
                    <button type="button" disabled={!!cancellingId} onClick={() => cancelBasket(basket)} className="border border-danger/30 px-3 py-2 text-xs font-semibold text-danger-text hover:bg-danger-soft disabled:opacity-50">{cancellingId === basket.id ? 'Cancelling...' : 'Cancel basket'}</button>
                  )}
                  <button type="button" aria-expanded={expandedId === basket.id} onClick={() => setExpandedId(current => current === basket.id ? null : basket.id)} className="border border-line px-3 py-2 text-xs font-semibold text-fg-muted hover:text-fg">{expandedId === basket.id ? 'Hide items' : `View ${itemCount} items`}</button>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div><p className="text-xs text-fg-muted">Student</p><p className="mt-1">{basket.user?.phone || 'Phone unavailable'}</p></div>
                  <div><p className="text-xs text-fg-muted">Delivery</p><p className="mt-1">{basket.deliveryAddress || [basket.user?.hostelBlock, basket.user?.roomNumber].filter(Boolean).join(', ') || 'Not specified'}</p></div>
                  <div><p className="text-xs text-fg-muted">Payment</p><p className="mt-1">{paymentText(basket)}</p></div>
                  <div><p className="text-xs text-fg-muted">{basket.actualTotal != null ? 'Bill total' : 'Current estimate'}</p><p className="mt-1 font-semibold">₹{total}</p></div>
                </div>
                {expandedId === basket.id && (
                  <div className="mt-5 border-t border-line pt-4">
                    <div className="mb-3 flex flex-wrap gap-x-6 gap-y-2 text-sm"><span><span className="text-fg-muted">Shopper: </span>{basket.deliveryPartner?.name ? `${basket.deliveryPartner.name}${basket.deliveryPartner.phone ? ` (${basket.deliveryPartner.phone})` : ''}` : 'Unassigned'}</span><span><span className="text-fg-muted">Shopping fee: </span>₹{basket.shoppingFee || 0}</span><span><span className="text-fg-muted">Delivery fee: </span>₹{basket.deliveryFee || 0}</span><span><span className="text-fg-muted">Estimated items: </span>₹{basket.estimatedTotal || 0}</span>{basket.actualTotal != null && <span><span className="text-fg-muted">Actual items: </span>₹{basket.actualTotal}</span>}</div>
                    <div className="overflow-x-auto border border-line">
                      <table className="w-full text-left text-sm"><thead className="bg-surface-2/60 text-xs text-fg-muted"><tr><th className="p-3">Item</th><th className="p-3">Qty</th><th className="p-3">Estimated</th><th className="p-3">Actual</th><th className="p-3">Status</th></tr></thead>
                        <tbody className="divide-y divide-white/5">{(basket.items || []).map((item, index) => <tr key={item.id || `${item.name}-${index}`}><td className="p-3">{item.name}</td><td className="p-3">{item.quantity} {item.unit || ''}</td><td className="p-3">₹{item.priceEstimated ?? '—'}</td><td className="p-3">₹{item.priceActual ?? '—'}</td><td className="p-3">{item.status || 'Pending'}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}