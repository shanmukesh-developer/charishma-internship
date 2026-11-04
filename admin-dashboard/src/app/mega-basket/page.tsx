"use client";

import {
  Button, DataTable, DescriptionList, Drawer, Notice as NoticeBox, PageHeader, SearchInput, Select, StatusPill, Toolbar, useConfirm,
  type Column, IconRefresh,
} from '@/components/ui';
import { formatDateTime, formatINR, formatPhone, humanize } from '@/lib/format';
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
  /** Delivery slot label ("Tue 27 Oct, 4:30–5:30 PM"); null on lists made before slots. */
  deliverySlot?: string | null;
  slotStart?: string | null;
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

const formatDate = (value: string) => formatDateTime(value, { short: true });

// The admin can cancel any basket that has not been delivered yet (same rule as the backend).
const ADMIN_CANCELLABLE = new Set(['Created', 'PaidEstimate', 'PartnerAssigned', 'Shopping', 'PriceApprovalPending', 'Approved', 'Purchased', 'Delivering']);

const STATUSES = ['Created', 'PaidEstimate', 'PartnerAssigned', 'Shopping', 'PriceApprovalPending', 'Approved', 'Purchased', 'Delivering', 'Delivered', 'Cancelled'];

export default function MegaBasketAdminPage() {
  const confirm = useConfirm();
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
    if (!(await confirm({ title: `Cancel ${who}'s basket #${basket.id.slice(-8).toUpperCase()}?`, description: `${shopping ? 'The shopper has already started; tell them to stop before you cancel. ' : ''}This cannot be undone.`, confirmLabel: 'Cancel basket', cancelLabel: 'Keep basket', tone: 'danger' }))) return;
    setCancellingId(basket.id);
    setNotice(null);
    try {
      const response = await fetch(`${API_URL}/api/mega-basket/${encodeURIComponent(basket.id)}/cancel`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled by ZenWe support' }),
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

  // Shopping lists were removed (28 Oct 2026): this page is no longer in the menu and no new list is created; it
  // stays reachable by URL so support can see and cancel a list a rider still holds.
  // Reload when a basket's status changes (the backend sends
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
    const onStatus = (payload: { id?: string | number } | undefined) => {
      if (payload?.id != null && basketIdsRef.current.has(String(payload.id))) bump();
    };
    socket.on('statusUpdated', onStatus);
    return () => {
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

  if (!isAuthed) return null; // AppShell shows the session check

  const totalOf = (b: MegaBasket) => Number(b.actualTotal ?? b.estimatedTotal ?? 0) + Number(b.shoppingFee || 0) + Number(b.deliveryFee || 0);
  const statusTone = (s: string) => (s === 'Delivered' ? 'success' : s === 'Cancelled' ? 'danger' : s === 'PriceApprovalPending' || s === 'Created' || s === 'PaidEstimate' ? 'warning' : 'info') as 'success' | 'danger' | 'warning' | 'info';
  const open = expandedId ? baskets.find(b => b.id === expandedId) || null : null;

  const columns: Column<MegaBasket>[] = [
    { key: 'id', header: 'Basket', width: '110px', cell: b => <span className="font-mono text-xs text-fg-muted">#{b.id.slice(-8).toUpperCase()}</span> },
    {
      key: 'customer',
      header: 'Customer',
      sortValue: b => b.user?.name || '',
      cell: b => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{b.user?.name || 'Student'}</p>
          <p className="truncate text-xs text-fg-muted">{b.user?.phone ? formatPhone(b.user.phone) : 'Phone unavailable'}</p>
        </div>
      ),
    },
    { key: 'delivery', header: 'Delivery', hideBelow: 'xl', cell: b => <span className="line-clamp-2 max-w-[260px] text-sm text-fg-muted">{b.deliverySlot && <span className="block font-medium text-fg">{b.deliverySlot}</span>}{b.deliveryAddress || [b.user?.hostelBlock, b.user?.roomNumber].filter(Boolean).join(', ') || 'Not specified'}</span> },
    { key: 'items', header: 'Items', align: 'right', hideBelow: 'lg', sortValue: b => (b.items || []).length, cell: b => <span className="tabular-nums">{(b.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)}</span> },
    { key: 'status', header: 'Status', sortValue: b => STATUSES.indexOf(b.status), cell: b => <StatusPill status={b.status} label={STATUS_LABELS[b.status] || humanize(b.status)} tone={statusTone(b.status)} /> },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      sortValue: b => totalOf(b),
      cell: b => (
        <div className="tabular-nums">
          <p className="font-medium text-fg">{formatINR(totalOf(b))}</p>
          <p className="text-xs text-fg-muted">{b.actualTotal != null ? 'Bill' : 'Estimate'}</p>
        </div>
      ),
    },
    { key: 'created', header: 'Placed', align: 'right', sortValue: b => new Date(b.createdAt), cell: b => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDate(b.createdAt)}</span> },
  ];

  return (
    <div className="text-fg">
      <PageHeader
        title="Mega Basket"
        description="Shopping-list orders that a rider buys and delivers: progress, payment and shopper. Stuck baskets can be cancelled before delivery. New baskets are cash on delivery; older UPI baskets are shown for reference."
        actions={<Button leftIcon={<IconRefresh size={14} />} loading={loading} onClick={() => setRefreshCount(count => count + 1)}>Refresh</Button>}
      />

      <Toolbar end={<span className="text-sm tabular-nums text-fg-muted">{filtered.length} of {baskets.length} baskets{baskets.length >= ADMIN_LIST_LIMIT ? ` (latest ${ADMIN_LIST_LIMIT})` : ''}</span>}>
        <SearchInput value={search} onChange={setSearch} placeholder="Basket ID, customer, phone, block" className="sm:w-72" />
        <Select aria-label="Status" value={status} onChange={event => setStatus(event.target.value)} className="w-auto min-w-[200px]">
          <option value="All">All statuses</option>
          {STATUSES.map(value => <option key={value} value={value}>{STATUS_LABELS[value] || value}</option>)}
        </Select>
      </Toolbar>

      {notice && <NoticeBox tone={notice.kind === 'error' ? 'danger' : 'success'} className="mb-3" onClose={() => setNotice(null)}><span className="text-fg">{notice.text}</span></NoticeBox>}

      <DataTable
        caption="Mega Basket orders"
        columns={columns}
        rows={filtered}
        rowKey={b => b.id}
        loading={loading}
        error={error || null}
        onRetry={() => setRefreshCount(count => count + 1)}
        onRowClick={b => setExpandedId(b.id)}
        initialSort={{ key: 'created', dir: 'desc' }}
        noun="baskets"
        resetPageKey={`${status}|${search}`}
        empty={{ title: 'No matching baskets', description: 'Recent customer baskets appear here.' }}
      />

      <Drawer
        open={!!open}
        onClose={() => setExpandedId(null)}
        size="lg"
        title={open ? `${open.user?.name || 'Student'}’s basket` : 'Basket'}
        description={open ? `#${open.id.slice(-8).toUpperCase()} · placed ${formatDate(open.createdAt)}` : undefined}
        headerActions={open ? <StatusPill status={open.status} label={STATUS_LABELS[open.status] || humanize(open.status)} tone={statusTone(open.status)} /> : undefined}
        footer={open && ADMIN_CANCELLABLE.has(open.status) ? (
          <Button variant="destructive" disabled={!!cancellingId} loading={cancellingId === open.id} onClick={() => cancelBasket(open)}>Cancel basket</Button>
        ) : undefined}
      >
        {open && (
          <div className="space-y-5">
            <DescriptionList
              columns={2}
              items={[
                { label: 'Customer', value: <>{open.user?.name || 'Student'}<span className="block text-fg-muted">{open.user?.phone ? formatPhone(open.user.phone) : 'Phone unavailable'}</span></> },
                { label: 'Delivery', value: open.deliveryAddress || [open.user?.hostelBlock, open.user?.roomNumber].filter(Boolean).join(', ') || 'Not specified' },
                ...(open.deliverySlot ? [{ label: 'Delivery slot', value: open.deliverySlot }] : []),
                { label: 'Payment', value: paymentText(open) },
                { label: 'Shopper', value: open.deliveryPartner?.name ? <>{open.deliveryPartner.name}{open.deliveryPartner.phone && <span className="block text-fg-muted">{formatPhone(open.deliveryPartner.phone)}</span>}</> : 'Unassigned' },
              ]}
            />
            <div>
              <p className="mb-1 text-xs text-fg-muted">Items</p>
              <div className="zv-table-wrap">
                <table className="zv-table">
                  <thead><tr><th>Item</th><th>Qty</th><th className="text-right">Estimated</th><th className="text-right">Actual</th><th>Status</th></tr></thead>
                  <tbody>
                    {(open.items || []).length === 0 ? (
                      <tr><td colSpan={5} className="text-center text-fg-muted">No items recorded.</td></tr>
                    ) : (open.items || []).map((item, index) => (
                      <tr key={item.id || `${item.name}-${index}`}>
                        <td>{item.name}</td>
                        <td className="tabular-nums">{item.quantity} {item.unit || ''}</td>
                        <td className="text-right tabular-nums">{item.priceEstimated != null ? formatINR(item.priceEstimated) : '–'}</td>
                        <td className="text-right tabular-nums">{item.priceActual != null ? formatINR(item.priceActual) : '–'}</td>
                        <td>{humanize(item.status || 'Pending')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <dl className="space-y-1 rounded-lg border border-line p-3 text-sm">
              <div className="flex justify-between"><dt className="text-fg-muted">Items (estimate)</dt><dd className="tabular-nums">{formatINR(open.estimatedTotal || 0)}</dd></div>
              {open.actualTotal != null && <div className="flex justify-between"><dt className="text-fg-muted">Items (bill)</dt><dd className="tabular-nums">{formatINR(open.actualTotal)}</dd></div>}
              <div className="flex justify-between"><dt className="text-fg-muted">Shopping fee</dt><dd className="tabular-nums">{formatINR(open.shoppingFee || 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-fg-muted">Delivery fee</dt><dd className="tabular-nums">{formatINR(open.deliveryFee || 0)}</dd></div>
              <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>{open.actualTotal != null ? 'Bill total' : 'Current estimate'}</dt><dd className="tabular-nums">{formatINR(totalOf(open))}</dd></div>
            </dl>
          </div>
        )}
      </Drawer>
    </div>
  );
}
