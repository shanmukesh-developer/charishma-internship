"use client";
import { useState, useEffect } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { useAdminSocket } from '@/components/AdminSocketProvider';
import dynamic from 'next/dynamic';
import { API_URL } from '@/lib/config';
import { useVisibleInterval } from '@/lib/useVisibleInterval';
import {
  Badge, Button, DataTable, DescriptionList, Drawer, Field, Input, Modal, Notice as NoticeBox, PageHeader, SearchInput, SegmentedControl,
  Select, StatusDot, Tabs, Toolbar, useConfirm, type Column, IconPlus, IconRefresh,
} from '@/components/ui';
import { formatINR, formatPhone, shortId } from '@/lib/format';

const LiveRiderMap = dynamic(() => import('@/components/LiveRiderMap'), { ssr: false, loading: () => <div className="flex h-[600px] w-full items-center justify-center rounded-lg border border-line bg-surface-2 text-sm text-fg-muted" role="status">Loading the map…</div> });


interface Rider {
  _id: string;
  name: string;
  phone: string;
  isApproved: boolean;
  isOnline: boolean;
  isSosActive: boolean;
  vehicleType?: string;
  completedDeliveries?: number;
  currentOrderId?: string | null;
}

type Notice = { kind: 'ok' | 'error'; text: string } | null;

async function readError(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) return 'Your session has expired. Please sign in again.';
  if (res.status === 403) return 'You do not have permission to do that.';
  if (res.status >= 500) return 'The server had a problem. Please try again in a moment.';
  const data = await res.json().catch(() => null);
  return data && typeof data.message === 'string' && data.message.length < 200 ? data.message : fallback;
}

const errorText = (err: unknown, fallback: string) =>
  err instanceof TypeError ? 'Could not reach the server. Check your connection.' : (err as Error)?.message || fallback;

const EMPTY_RIDER = { name: '', phone: '', password: '', vehicleType: 'Bike' };

interface Payout {
  riderId: string;
  totalDeliveries: number;
  totalDeliveryFees: number;
  /** Customer tips credited to the rider and not yet paid out. */
  unsettledTips?: number;
  /** When the server built this list; sent back as `upTo` so later deliveries are not settled with it. */
  asOf?: string;
  riderName?: string;
  riderPhone?: string;
  /** C6: COD cash this rider holds for Zenvy (never deducted from a payout; collected on Finance → Rider cash). */
  cashHeld?: number;
}

export default function FleetManagement() {
  const { isAuthed } = useAdminAuth();
  const { socket, isConnected } = useAdminSocket();
  const confirm = useConfirm();
  // Rider whose details are open, and the payout waiting for its UTR (was a browser prompt).
  const [detailId, setDetailId] = useState<string | null>(null);
  const [settling, setSettling] = useState<{ p: Payout; riderName: string } | null>(null);
  const [utrInput, setUtrInput] = useState('');

  const [activeTab, setActiveTab] = useState<'roster' | 'payouts' | 'map'>('roster');

  const [riders, setRiders] = useState<Rider[]>([]);
  const [totalRiders, setTotalRiders] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);

  const [payouts, setPayouts] = useState<Payout[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payoutsError, setPayoutsError] = useState<string | null>(null);
  const [payoutsLoading, setPayoutsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingRider, setEditingRider] = useState<Rider | null>(null);
  const [newRider, setNewRider] = useState(EMPTY_RIDER);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  // Search and approval filter over the riders on this page (?search= from the global search, ?filter=pending from the overview).
  const [riderSearch, setRiderSearch] = useState('');
  const [approvalFilter, setApprovalFilter] = useState<'all' | 'pending' | 'approved'>('all');
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('search')) setRiderSearch(qs.get('search') || '');
    if (qs.get('filter') === 'pending') setApprovalFilter('pending');
  }, []);
  const shownRiders = riders.filter(r => {
    if (approvalFilter === 'pending' && r.isApproved) return false;
    if (approvalFilter === 'approved' && !r.isApproved) return false;
    const q = riderSearch.trim().toLowerCase();
    if (!q) return true;
    const digits = q.replace(/\D/g, '');
    return String(r.name || '').toLowerCase().includes(q) || (digits.length >= 3 && String(r.phone || '').replace(/\D/g, '').includes(digits));
  });

  const fetchRiders = async (page = 1, showSkeleton = true) => {
    try {
      if (showSkeleton) setLoading(true);
      const res = await fetch(`${API_URL}/api/admin/riders?page=${page}`, { credentials: 'include', cache: 'no-store' });
      if (!res.ok) throw new Error(await readError(res, 'Could not load riders.'));
      const data = await res.json();
      setRiders(Array.isArray(data.riders) ? data.riders : []);
      setTotalRiders(data.total || 0);
      setTotalPages(Math.max(1, data.pages || 1));
      setCurrentPage(page);
      setLoadError(null);
    } catch (err) {
      // Background refreshes keep the last good list; only surface the error.
      setLoadError(errorText(err, 'Could not load riders.'));
    } finally { if (showSkeleton) setLoading(false); }
  };

  const fetchPayouts = async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/fleet/payouts`, { credentials: 'include', cache: 'no-store' });
      if (!res.ok) throw new Error(await readError(res, 'Could not load rider payouts.'));
      const data = await res.json();
      setPayouts(Array.isArray(data) ? data : []);
      setPayoutsError(null);
    } catch (err) {
      setPayoutsError(errorText(err, 'Could not load rider payouts.'));
    } finally {
      setPayoutsLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthed) return;
    fetchRiders(1, true);
    fetchPayouts();
  }, [isAuthed]);

  // Polling fallback alongside socket events: 20 s while the live socket is down, 60 s while it is up;
  // paused while the tab is hidden.
  useVisibleInterval(() => {
    fetchRiders(currentPage, false);
    fetchPayouts();
  }, isConnected ? 60000 : 20000, isAuthed);

  // Real-time fleet socket events
  useEffect(() => {
    if (!socket) return;

    const handleRiderOnline = (data: { riderId: string }) => {
      const riderId = String(data.riderId);
      setRiders(prev => prev.map(r => String(r._id) === riderId ? { ...r, isOnline: true } : r));
    };

    const handleRiderOffline = (data: { riderId: string }) => {
      const riderId = String(data.riderId);
      setRiders(prev => prev.map(r => String(r._id) === riderId ? { ...r, isOnline: false } : r));
    };

    const handleRiderStatus = (data: { riderId: string, isOnline: boolean }) => {
      const riderId = String(data.riderId);
      setRiders(prev => prev.map(r => String(r._id) === riderId ? { ...r, isOnline: data.isOnline } : r));
    };

    const handleSos = (data: { riderId: string }) => {
      const riderId = String(data.riderId);
      setRiders(prev => prev.map(r => String(r._id) === riderId ? { ...r, isSosActive: true } : r));
    };

    // Deliveries often complete in bursts: one quiet refresh per 1.5 s window instead of one per event.
    let deliveryTimer: ReturnType<typeof setTimeout> | null = null;
    const handleDeliveryComplete = () => {
      if (deliveryTimer) return;
      deliveryTimer = setTimeout(() => {
        deliveryTimer = null;
        fetchRiders(currentPage, false);
        fetchPayouts();
      }, 1500);
    };

    socket.on('admin_rider_online', handleRiderOnline);
    socket.on('admin_rider_offline', handleRiderOffline);
    socket.on('admin_rider_status', handleRiderStatus);
    socket.on('sos_received', handleSos);
    socket.on('admin_delivery_complete', handleDeliveryComplete);

    return () => {
      socket.off('admin_rider_online', handleRiderOnline);
      socket.off('admin_rider_offline', handleRiderOffline);
      socket.off('admin_rider_status', handleRiderStatus);
      socket.off('sos_received', handleSos);
      socket.off('admin_delivery_complete', handleDeliveryComplete);
      if (deliveryTimer) clearTimeout(deliveryTimer);
    };
  }, [socket, currentPage]);

  // Opens the "record payout" form (the UTR used to be asked with a browser prompt).
  const handleMarkSettled = (p: Payout, riderName: string) => {
    if (settlingId) return;
    setUtrInput('');
    setSettling({ p, riderName });
  };
  const submitSettle = async (p: Payout, riderName: string, utr: string) => {
    if (settlingId) return;
    const tips = Math.max(0, Number(p.unsettledTips) || 0);
    if (utr.trim().length < 3) { setNotice({ kind: 'error', text: 'A UTR / payment reference (at least 3 characters) is required to record a payout.' }); return; }
    setSettling(null);
    setSettlingId(p.riderId);
    setNotice(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/finance/settle-rider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Settle only what this screen showed: deliveries up to the list's `asOf`, plus the tips seen.
        body: JSON.stringify({
          riderId: p.riderId,
          utr: utr.trim(),
          ...(p.asOf ? { upTo: p.asOf } : {}),
          ...(tips > 0 ? { includeTips: true, tipsAmount: tips } : {}),
        }),
        credentials: 'include'
      });
      if (!res.ok) throw new Error(await readError(res, 'Could not settle this payout.'));
      const data = await res.json().catch(() => ({}));
      const settledOrders = typeof data.updatedOrdersCount === 'number' ? data.updatedOrdersCount : null;
      const mismatch = settledOrders !== null && settledOrders !== p.totalDeliveries;
      const tipsNote = tips > 0 && Number(data.tipsSettled) !== tips ? ' Tips were NOT cleared (the balance changed); check the rider\'s tips again.' : '';
      setNotice({
        kind: mismatch || tipsNote ? 'error' : 'ok',
        text: `Payout for ${riderName} recorded (UTR ${utr.trim()}) and marked as settled${settledOrders !== null ? ` (${settledOrders} of ${p.totalDeliveries} orders shown)` : ''}.${mismatch ? ' The count differs from what was shown; recheck this rider\'s payouts.' : ''}${tipsNote}`,
      });
      setPayouts(prev => prev.filter(x => x.riderId !== p.riderId));
      fetchPayouts();
    } catch (err) {
      setNotice({ kind: 'error', text: errorText(err, 'Could not settle this payout.') });
    } finally {
      setSettlingId(null);
    }
  };

  const handleToggleApproval = async (rider: Rider) => {
    if (busyId) return;
    const approve = !rider.isApproved;
    if (!approve && rider.currentOrderId) {
      // A deactivated rider is locked out of the delivery routes, so their active order would get stuck.
      setNotice({ kind: 'error', text: `${rider.name} is delivering order #${String(rider.currentOrderId).slice(-6).toUpperCase()} right now. Reassign or finish that order (Orders page) before deactivating them.` });
      return;
    }
    if (!(await confirm(approve
      ? { title: `Approve ${rider.name}?`, description: 'They will be able to go online and take orders.', confirmLabel: 'Approve' }
      : { title: `Deactivate ${rider.name}?`, description: 'They will no longer be able to take orders, and their app sessions end.', confirmLabel: 'Deactivate', tone: 'danger' }))) return;
    setBusyId(rider._id);
    setNotice(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/riders/${rider._id}/approve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isApproved: approve })
      });
      if (!res.ok) throw new Error(await readError(res, 'Could not update rider status.'));
      setRiders(prev => prev.map(r => r._id === rider._id ? { ...r, isApproved: approve } : r));
      setNotice({ kind: 'ok', text: `${rider.name} ${approve ? 'approved' : 'deactivated'}.` });
    } catch (err) {
      setNotice({ kind: 'error', text: errorText(err, 'Could not update rider status.') });
    } finally {
      setBusyId(null);
    }
  };

  const handleResetSos = async (rider: Rider) => {
    if (busyId) return;
    if (!(await confirm({ title: `Clear ${rider.name}'s SOS?`, description: 'Only do this once you have spoken to the rider and the emergency is resolved.', confirmLabel: 'Mark resolved' }))) return;
    setBusyId(rider._id);
    setNotice(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/riders/${rider._id}/reset-sos`, { method: 'POST' });
      if (!res.ok) throw new Error(await readError(res, 'Could not clear the SOS.'));
      setRiders(prev => prev.map(r => r._id === rider._id ? { ...r, isSosActive: false } : r));
      setNotice({ kind: 'ok', text: `SOS cleared for ${rider.name}.` });
    } catch (err) {
      setNotice({ kind: 'error', text: errorText(err, 'Could not clear the SOS.') });
    } finally {
      setBusyId(null);
    }
  };

  const closeForm = () => { setIsAdding(false); setEditingRider(null); setError(null); setNewRider(EMPTY_RIDER); };

  const handleCreateRider = async () => {
    if (isSubmitting) return;
    setError(null);
    const name = newRider.name.trim();
    const phone = newRider.phone.replace(/\D/g, '').slice(-10);
    // Never trimmed silently: the rider would type exactly what the admin shared and be locked out.
    const password = newRider.password;
    if (name.length < 2) { setError('Enter the rider\'s full name.'); return; }
    if (!/^[6-9]\d{9}$/.test(phone)) { setError('Enter a valid 10-digit mobile number.'); return; }
    if (password && password !== password.trim()) { setError('The password starts or ends with a space. Remove the space so the rider can sign in with exactly what you share.'); return; }
    if (!editingRider && password.length < 6) { setError('Set a password of at least 6 characters for the rider app login.'); return; }
    if (editingRider && password && password.length < 6) { setError('New password must be at least 6 characters (leave blank to keep the current one).'); return; }
    if (password.length > 128) { setError('Password must be at most 128 characters.'); return; }
    setIsSubmitting(true);
    try {
      // Admin-only endpoints: the new rider is created approved (not the public, rate-limited sign-up).
      const endpoint = editingRider ? `${API_URL}/api/admin/riders/${editingRider._id}` : `${API_URL}/api/admin/riders`;
      const body: Record<string, string> = { name, phone, vehicleType: newRider.vehicleType };
      if (password) body.password = password;
      const res = await fetch(endpoint, {
        method: editingRider ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(await readError(res, 'Could not save this rider.'));
      setNotice({ kind: 'ok', text: editingRider ? `${name} updated.` : `${name} added. Share the password with them privately.` });
      const page = editingRider ? currentPage : 1;
      closeForm();
      fetchRiders(page);
    } catch (err) {
      setError(errorText(err, 'Could not save this rider.'));
    } finally { setIsSubmitting(false); }
  };

  if (!isAuthed) return null; // AppShell shows the session check

  const openAdd = () => { setActiveTab('roster'); setEditingRider(null); setNewRider(EMPTY_RIDER); setError(null); setIsAdding(true); };
  const openEdit = (r: Rider) => { setIsAdding(false); setError(null); setEditingRider(r); setNewRider({ name: r.name, phone: r.phone, password: '', vehicleType: r.vehicleType || 'Bike' }); };
  const detail = detailId ? riders.find(r => r._id === detailId) || null : null;
  const detailPayout = detail ? payouts.find(p => p.riderId === detail._id) : undefined;
  const pendingCount = riders.filter(r => !r.isApproved).length;

  const riderColumns: Column<Rider>[] = [
    {
      key: 'name',
      header: 'Rider',
      sortValue: r => r.name,
      cell: r => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{r.name}</p>
          <p className="text-xs text-fg-muted"><span className="font-mono">{shortId(r._id)}</span>{r.vehicleType ? ` · ${r.vehicleType}` : ''}</p>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', hideBelow: 'lg', cell: r => <span className="tabular-nums text-fg">{formatPhone(r.phone)}</span> },
    {
      key: 'status',
      header: 'Status',
      sortValue: r => (r.isSosActive ? 0 : r.isOnline ? 1 : 2),
      cell: r => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 text-sm text-fg">
            <StatusDot tone={r.isOnline ? 'success' : 'neutral'} />{r.isOnline ? 'Online' : 'Offline'}
          </span>
          {r.isSosActive && <Badge tone="danger" dot>SOS active</Badge>}
          {r.currentOrderId && <Badge tone="info">On order {shortId(r.currentOrderId)}</Badge>}
        </div>
      ),
    },
    {
      key: 'approval',
      header: 'Approval',
      sortValue: r => (r.isApproved ? 1 : 0),
      cell: r => (r.isApproved ? <Badge tone="success">Approved</Badge> : <Badge tone="warning">Waiting for approval</Badge>),
    },
    { key: 'deliveries', header: 'Deliveries', align: 'right', hideBelow: 'lg', sortValue: r => r.completedDeliveries || 0, cell: r => <span className="tabular-nums text-fg">{r.completedDeliveries || 0}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      width: '220px',
      cell: r => (
        <div className="flex items-center justify-end gap-1.5">
          {r.isSosActive && <Button size="sm" variant="destructive" disabled={busyId === r._id} onClick={() => handleResetSos(r)}>Resolve SOS</Button>}
          <Button size="sm" variant={r.isApproved ? 'ghost' : 'primary'} className={r.isApproved ? 'text-danger-text hover:text-danger-text' : ''} disabled={busyId === r._id} onClick={() => handleToggleApproval(r)}>
            {busyId === r._id ? 'Saving…' : r.isApproved ? 'Deactivate' : 'Approve'}
          </Button>
          <Button size="sm" onClick={() => openEdit(r)}>Edit</Button>
        </div>
      ),
    },
  ];

  const payoutColumns: Column<Payout>[] = [
    {
      key: 'rider',
      header: 'Rider',
      sortValue: p => p.riderName || '',
      cell: p => {
        const riderName = p.riderName || riders.find(r => r._id === p.riderId)?.name || String(p.riderId).slice(-6).toUpperCase();
        return (
          <div>
            <p className="font-medium text-fg">{riderName}</p>
            {p.riderPhone && <p className="text-xs text-fg-muted tabular-nums">{formatPhone(p.riderPhone)}</p>}
          </div>
        );
      },
    },
    { key: 'deliveries', header: 'Deliveries', align: 'right', sortValue: p => p.totalDeliveries, cell: p => <span className="tabular-nums">{p.totalDeliveries}</span> },
    {
      key: 'earnings',
      header: 'Unsettled earnings',
      align: 'right',
      sortValue: p => Number(p.totalDeliveryFees) || 0,
      cell: p => (
        <div className="tabular-nums">
          <p className="font-medium text-fg">{formatINR(p.totalDeliveryFees)}</p>
          {(Number(p.unsettledTips) || 0) > 0 && <p className="text-xs text-fg-muted">+ {formatINR(p.unsettledTips)} tips</p>}
        </div>
      ),
    },
    {
      key: 'cash',
      header: 'Cash held',
      align: 'right',
      hideBelow: 'lg',
      sortValue: p => Number(p.cashHeld) || 0,
      cell: p => ((Number(p.cashHeld) || 0) > 0
        ? <span className="tabular-nums text-warning-text" title="COD cash the rider holds for ZenWe. It is not deducted from the payout; collect it on Payments and payouts, Rider cash.">{formatINR(p.cashHeld)}</span>
        : <span className="text-fg-subtle">–</span>),
    },
    {
      key: 'action',
      header: <span className="sr-only">Action</span>,
      align: 'right',
      cell: p => {
        const riderName = p.riderName || riders.find(r => r._id === p.riderId)?.name || String(p.riderId).slice(-6).toUpperCase();
        return <Button size="sm" variant="primary" disabled={!!settlingId} loading={settlingId === p.riderId} onClick={() => handleMarkSettled(p, riderName)}>Record payout</Button>;
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Riders"
        description="Delivery riders: approvals, who is online, SOS alerts, and earnings to pay out."
        actions={<Button variant="primary" leftIcon={<IconPlus size={14} />} onClick={openAdd}>Add rider</Button>}
      >
        <Tabs
          ariaLabel="Riders sections"
          value={activeTab}
          onChange={setActiveTab}
          tabs={[
            { id: 'roster', label: 'All riders', count: totalRiders || null },
            { id: 'payouts', label: 'Earnings and payouts', count: payouts.length || null, attention: true },
            { id: 'map', label: 'Live map' },
          ]}
        />
      </PageHeader>

      {notice && (
        <NoticeBox tone={notice.kind === 'error' ? 'danger' : 'success'} className="mb-4" onClose={() => setNotice(null)}>
          <span className="text-fg">{notice.text}</span>
        </NoticeBox>
      )}

      {activeTab === 'roster' && (
        <>
          <Toolbar end={<span className="text-sm text-fg-muted">Search and filters apply to the riders on this page</span>}>
            <SearchInput value={riderSearch} onChange={setRiderSearch} placeholder="Search name or phone" />
            <SegmentedControl
              ariaLabel="Approval"
              value={approvalFilter}
              onChange={setApprovalFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'pending', label: 'Waiting for approval', count: pendingCount || null },
                { value: 'approved', label: 'Approved' },
              ]}
            />
          </Toolbar>
          <DataTable
            caption="Riders"
            columns={riderColumns}
            rows={shownRiders}
            rowKey={r => r._id}
            loading={loading}
            error={loadError}
            onRetry={() => fetchRiders(currentPage, riders.length === 0)}
            onRowClick={r => setDetailId(r._id)}
            rowClassName={r => (r.isSosActive ? 'bg-danger-soft/60' : undefined)}
            pagination={{ page: currentPage, pages: totalPages, total: totalRiders, onPage: p => fetchRiders(p) }}
            noun="riders"
            empty={riders.length === 0
              ? { title: 'No riders yet', description: 'Add a rider to give them a login for the rider app.', action: <Button variant="primary" onClick={openAdd}>Add rider</Button> }
              : { title: 'No riders match', description: 'No riders on this page match the search or filter.' }}
          />
        </>
      )}

      {activeTab === 'payouts' && (
        <>
          <Toolbar end={<Button leftIcon={<IconRefresh size={14} />} loading={payoutsLoading} onClick={() => { setPayoutsLoading(true); fetchPayouts(); }}>Refresh</Button>}>
            <p className="text-sm text-fg-muted">Earnings riders have not been paid yet (delivery fee per order, minimum ₹30, plus tips). Record a payout after you transfer the money.</p>
          </Toolbar>
          <DataTable
            caption="Unsettled rider earnings"
            columns={payoutColumns}
            rows={payouts}
            rowKey={p => p.riderId}
            loading={payoutsLoading}
            error={payoutsError}
            onRetry={() => { setPayoutsLoading(true); fetchPayouts(); }}
            noun="riders"
            empty={{ title: 'Nothing to pay out', description: 'Every rider’s earnings are settled.' }}
          />
        </>
      )}

      {activeTab === 'map' && (
        <div className="relative z-0">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-fg">Live map</h2>
              <p className="mt-0.5 text-sm text-fg-muted">Where online riders are right now, from the location their app shares.</p>
            </div>
            <Badge tone={isConnected ? 'success' : 'warning'} dot>{isConnected ? 'Live' : 'Reconnecting'}</Badge>
          </div>
          <LiveRiderMap />
        </div>
      )}

      {/* Rider details */}
      <Drawer
        open={!!detail}
        onClose={() => setDetailId(null)}
        size="md"
        title={detail?.name || 'Rider'}
        description={detail ? `${shortId(detail._id)}${detail.vehicleType ? ` · ${detail.vehicleType}` : ''}` : undefined}
        footer={detail ? (
          <>
            {detail.isSosActive && <Button variant="destructive" disabled={busyId === detail._id} onClick={() => handleResetSos(detail)}>Resolve SOS</Button>}
            <Button onClick={() => { openEdit(detail); setDetailId(null); }}>Edit</Button>
            <Button variant={detail.isApproved ? 'destructive' : 'primary'} disabled={busyId === detail._id} onClick={() => handleToggleApproval(detail)}>{detail.isApproved ? 'Deactivate' : 'Approve'}</Button>
          </>
        ) : undefined}
      >
        {detail && (
          <div className="space-y-5">
            {detail.isSosActive && <NoticeBox tone="danger" title="SOS is active">Call the rider now. Resolve the SOS once they are safe.</NoticeBox>}
            <DescriptionList
              columns={2}
              items={[
                { label: 'Phone', value: <a href={`tel:${detail.phone}`} className="text-accent-text hover:underline">{formatPhone(detail.phone)}</a> },
                { label: 'Status', value: detail.isOnline ? 'Online' : 'Offline' },
                { label: 'Approval', value: detail.isApproved ? 'Approved' : 'Waiting for approval' },
                { label: 'Deliveries completed', value: detail.completedDeliveries || 0 },
                { label: 'Current order', value: detail.currentOrderId ? <a href={`/orders?order=${encodeURIComponent(detail.currentOrderId)}`} className="text-accent-text hover:underline">{shortId(detail.currentOrderId)}</a> : 'None' },
                { label: 'Unsettled earnings', value: detailPayout ? `${formatINR(detailPayout.totalDeliveryFees)}${(Number(detailPayout.unsettledTips) || 0) > 0 ? ` + ${formatINR(detailPayout.unsettledTips)} tips` : ''}` : 'None' },
              ]}
            />
          </div>
        )}
      </Drawer>

      {/* Add / edit rider */}
      <Modal
        open={isAdding || !!editingRider}
        onClose={closeForm}
        dismissible={!isSubmitting}
        title={editingRider ? `Edit ${editingRider.name}` : 'Add rider'}
        description={editingRider ? 'Leave the password empty to keep the current one.' : 'The rider signs in to the rider app with this phone number and password.'}
        footer={
          <>
            <Button onClick={closeForm} disabled={isSubmitting}>Cancel</Button>
            <Button variant="primary" loading={isSubmitting} onClick={handleCreateRider}>{editingRider ? 'Save changes' : 'Add rider'}</Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); handleCreateRider(); }} noValidate>
          {error && <NoticeBox tone="danger"><span className="text-fg">{error}</span></NoticeBox>}
          <Field label="Full name" required>
            <Input value={newRider.name} onChange={e => setNewRider({ ...newRider, name: e.target.value })} autoComplete="off" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mobile number" required>
              <Input inputMode="numeric" placeholder="10-digit number" value={newRider.phone} onChange={e => setNewRider({ ...newRider, phone: e.target.value })} />
            </Field>
            <Field label="Vehicle">
              <Select value={newRider.vehicleType} onChange={e => setNewRider({ ...newRider, vehicleType: e.target.value })}>
                <option value="Bike">Bike</option>
                <option value="Electric">Electric bike</option>
                <option value="Cycle">Bicycle (inside campus)</option>
                <option value="Car">Car (group delivery)</option>
              </Select>
            </Field>
          </div>
          <Field label={editingRider ? 'New password' : 'Password'} required={!editingRider} optional={!!editingRider} hint="At least 6 characters. Share it with the rider privately.">
            <Input type="password" autoComplete="new-password" value={newRider.password} onChange={e => setNewRider({ ...newRider, password: e.target.value })} />
          </Field>
          <button type="submit" hidden aria-hidden />
        </form>
      </Modal>

      {/* Record payout: the UTR of the transfer is required (was a browser prompt). */}
      <Modal
        open={!!settling}
        onClose={() => setSettling(null)}
        size="sm"
        title={settling ? `Record payout to ${settling.riderName}` : 'Record payout'}
        description="Deliveries completed after this list loaded are not included."
        footer={
          <>
            <Button onClick={() => setSettling(null)}>Cancel</Button>
            <Button variant="primary" disabled={utrInput.trim().length < 3} onClick={() => settling && submitSettle(settling.p, settling.riderName, utrInput)}>Record payout</Button>
          </>
        }
      >
        {settling && (
          <div className="space-y-4">
            <dl className="space-y-1 rounded-lg border border-line p-3 text-sm">
              <div className="flex justify-between"><dt className="text-fg-muted">Earnings ({settling.p.totalDeliveries} deliveries)</dt><dd className="tabular-nums">{formatINR(settling.p.totalDeliveryFees)}</dd></div>
              {(Number(settling.p.unsettledTips) || 0) > 0 && <div className="flex justify-between"><dt className="text-fg-muted">Customer tips</dt><dd className="tabular-nums">{formatINR(settling.p.unsettledTips)}</dd></div>}
              <div className="flex justify-between border-t border-line pt-1 font-medium"><dt>Total to pay</dt><dd className="tabular-nums">{formatINR((Number(settling.p.totalDeliveryFees) || 0) + Math.max(0, Number(settling.p.unsettledTips) || 0))}</dd></div>
            </dl>
            {(Number(settling.p.cashHeld) || 0) > 0 && (
              <NoticeBox tone="warning">They also hold {formatINR(settling.p.cashHeld)} of cash-on-delivery money. It is not deducted here; collect it on Payments and payouts, Rider cash.</NoticeBox>
            )}
            <Field label="UTR or payment reference" required hint="At least 3 characters, from your bank transfer.">
              <Input value={utrInput} onChange={e => setUtrInput(e.target.value)} autoComplete="off" data-autofocus />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
