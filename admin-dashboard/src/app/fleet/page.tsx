"use client";
import { useState, useEffect, memo } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { useAdminSocket } from '@/components/AdminSocketProvider';
import dynamic from 'next/dynamic';
import { API_URL } from '@/lib/config';
import { useVisibleInterval } from '@/lib/useVisibleInterval';

const LiveRiderMap = dynamic(() => import('@/components/LiveRiderMap'), { ssr: false, loading: () => <div className="h-[600px] w-full rounded-lg bg-info-soft animate-pulse border border-info/30 flex items-center justify-center text-info-text font-semibold text-xl">Booting God-Mode Map...</div> });


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

const RiderRow = memo(({ rider, busy, onEdit, onToggleApproval, onResetSos }: {
  rider: Rider,
  busy: boolean,
  onEdit: (r: Rider) => void,
  onToggleApproval: (r: Rider) => void,
  onResetSos: (r: Rider) => void
}) => (
  <tr className="hover:bg-surface-2/60 transition-colors group">
    <td className="px-8 py-6">
      <span className="text-xs font-semibold text-info-text group-hover:text-info-text transition-colors">#{rider._id.slice(-6).toUpperCase()}</span>
    </td>
    <td className="px-8 py-6 text-sm font-semibold text-fg">
      {rider.name}
      {rider.vehicleType && <span className="ml-2 text-xs px-2 py-0.5 bg-info-soft text-info-text rounded-md">{rider.vehicleType}</span>}
    </td>
    <td className="px-8 py-6">
      <p className="text-xs text-fg-muted font-mono">{rider.phone}</p>
      <div className="mt-1 flex items-center gap-2">
         <span className="text-xs font-semibold text-success-text">{rider.completedDeliveries || 0} deliveries completed</span>
      </div>
    </td>
    <td className="px-8 py-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${rider.isOnline ? 'bg-success animate-pulse' : 'bg-surface-2'}`} />
          <span className={`text-xs font-semibold ${rider.isOnline ? 'text-success-text' : 'text-fg-muted'}`}>
            {rider.isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
        {rider.isSosActive && (
          <button
            disabled={busy}
            onClick={() => onResetSos(rider)}
            className="flex flex-col items-start gap-1 group/sos disabled:opacity-50"
          >
            <div className="flex items-center gap-2 bg-danger-soft border border-danger/30 px-3 py-1 rounded-lg animate-bounce group-hover/sos:bg-red-500/20 transition-all">
              <span className="text-xs font-semibold text-danger-text">Emergency SOS</span>
            </div>
            <span className="text-[7px] text-fg-subtle font-semibold ml-1 opacity-0 group-hover/sos:opacity-100 transition-opacity">Click to Resolve</span>
          </button>
        )}
      </div>
    </td>
    <td className="px-8 py-6">
        <div className="flex items-center gap-3">
          <button disabled={busy} onClick={() => onToggleApproval(rider)} className={`px-6 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-40 ${rider.isApproved ? 'bg-danger-soft text-danger-text' : 'bg-success-soft text-success-text'}`}>
            {busy ? 'Saving…' : rider.isApproved ? 'Deactivate' : 'Approve'}
          </button>
          {!rider.isApproved && <span className="text-xs font-semibold text-warning-text">Pending approval</span>}
          <button onClick={() => onEdit(rider)} className="text-info-text hover:text-info-text text-xs font-semibold transition-colors ml-2">Edit</button>
        </div>
    </td>
  </tr>
));
RiderRow.displayName = 'RiderRow';

export default function FleetManagement() {
  const { isAuthed } = useAdminAuth();
  const { socket, isConnected } = useAdminSocket();

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

  const handleMarkSettled = async (p: Payout, riderName: string) => {
    if (settlingId) return;
    const tips = Math.max(0, Number(p.unsettledTips) || 0);
    const total = (Number(p.totalDeliveryFees) || 0) + tips;
    // C6: a payout is recorded with the UTR of the transfer (required by the server).
    const utr = prompt(`Record ₹${total} paid to ${riderName}?\n• ₹${p.totalDeliveryFees} earnings (${p.totalDeliveries} deliveries)${tips ? `\n• ₹${tips} customer tips` : ''}${(Number(p.cashHeld) || 0) > 0 ? `\n\nThey also hold ₹${p.cashHeld} COD cash: NOT deducted here, collect it on Finance → Rider cash.` : ''}\n\nDeliveries completed after this list loaded are not included. Enter the UTR / payment reference of the transfer:`);
    if (utr === null) return;
    if (utr.trim().length < 3) { setNotice({ kind: 'error', text: 'A UTR / payment reference (at least 3 characters) is required to record a payout.' }); return; }
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
    if (!confirm(approve
      ? `Approve ${rider.name} as a delivery partner? They will be able to go online and take orders.`
      : `Deactivate ${rider.name}? They will no longer be able to take orders.`)) return;
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
    if (!confirm(`Mark ${rider.name}'s emergency as resolved and clear the SOS?`)) return;
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

  if (!isAuthed) return <div className="p-20 text-center font-semibold text-fg animate-pulse">Checking access…</div>;

  return (
    <div className="space-y-6 relative">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Riders</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">Delivery riders: approvals, live status, SOS and cash on hand.</p>
        </div>
        <div className="flex gap-4">
           <button onClick={() => { setActiveTab('roster'); setEditingRider(null); setNewRider(EMPTY_RIDER); setError(null); setIsAdding(true); }} className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg shadow-xs hover:bg-accent-hover">
              Add rider
           </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-line pb-4">
        {[
          { id: 'roster', label: 'All riders' },
          { id: 'payouts', label: 'Earnings and payouts' },
          { id: 'map', label: 'Live map' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-6 py-3 rounded-lg text-xs font-semibold transition-all ${
              activeTab === tab.id
                ? 'bg-accent text-on-solid'
                : 'bg-surface-2/60 text-fg-muted hover:text-fg hover:bg-surface-2'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {notice && (
        <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`flex items-center justify-between gap-4 rounded-lg border px-6 py-4 text-sm font-semibold ${notice.kind === 'error' ? 'border-danger/30 bg-danger-soft text-danger-text' : 'border-success/30 bg-success-soft text-success-text'}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-xs text-fg-muted hover:text-fg">Dismiss</button>
        </div>
      )}

      {(isAdding || editingRider) && activeTab === 'roster' && (
        <div className="rounded-lg border border-line bg-surface shadow-xs p-10 border-info/30 animate-slide-up">
           <h3 className="text-xl font-semibold text-fg mb-8">{editingRider ? `Edit ${editingRider.name}` : 'Add delivery partner'}</h3>
           {error && <div className="mb-6 text-danger-text text-xs font-semibold text-center animate-shake">{error}</div>}
           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <input placeholder="Full name" className="admin-input" value={newRider.name} onChange={(e) => setNewRider({...newRider, name: e.target.value})} />
              <input placeholder="Phone Number" className="admin-input" value={newRider.phone} onChange={(e) => setNewRider({...newRider, phone: e.target.value})} />
              <select className="admin-input" value={newRider.vehicleType} onChange={(e) => setNewRider({...newRider, vehicleType: e.target.value})}>
                 <option value="Bike">Bike (Standard)</option>
                 <option value="Electric">Electric (Eco)</option>
                 <option value="Cycle">Bicycle (Hostel Internal)</option>
                 <option value="Car">Car (Group Delivery)</option>
              </select>
              <input placeholder={editingRider ? 'New password (leave blank to keep)' : 'Password (min 6 characters)'} type="password" autoComplete="new-password" className="admin-input" value={newRider.password} onChange={(e) => setNewRider({...newRider, password: e.target.value})} />
           </div>
           <div className="flex gap-4 mt-10">
              <button disabled={isSubmitting} onClick={handleCreateRider} className="flex-1 py-5 bg-accent text-on-solid font-semibold rounded-lg text-xs disabled:opacity-40 hover:bg-accent-hover">
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-3">
                    <span className="w-4 h-4 border-2 border-line-strong border-t-line-strong rounded-full animate-spin" />
                    Processing...
                  </span>
                ) : editingRider ? 'Save changes' : 'Add rider'}
              </button>
              <button disabled={isSubmitting} onClick={closeForm} className="px-10 py-5 bg-surface-2/60 text-fg-muted font-semibold rounded-lg text-xs hover:bg-surface-2">Cancel</button>
           </div>
        </div>
      )}

      {activeTab === 'roster' && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={riderSearch}
            onChange={e => setRiderSearch(e.target.value)}
            placeholder="Search name or phone"
            aria-label="Search riders by name or phone"
            className="zv-control w-full sm:w-64"
          />
          <div role="radiogroup" aria-label="Approval" className="inline-flex items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5">
            {([['all', 'All'], ['pending', 'Waiting for approval'], ['approved', 'Approved']] as const).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={approvalFilter === v} onClick={() => setApprovalFilter(v)}
                className={`h-7 rounded px-2.5 text-sm font-medium ${approvalFilter === v ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted hover:text-fg'}`}>{l}</button>
            ))}
          </div>
          <span className="ml-auto text-sm text-fg-muted">Searches the riders on this page</span>
        </div>
      )}

      {activeTab === 'roster' && (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-2/60 border-b border-line">
                <th className="px-8 py-6 text-xs font-semibold text-fg-muted">Rider</th>
                <th className="px-8 py-6 text-xs font-semibold text-fg-muted">Name</th>
                <th className="px-8 py-6 text-xs font-semibold text-fg-muted">Contact</th>
                <th className="px-8 py-6 text-xs font-semibold text-fg-muted">Status</th>
                <th className="px-8 py-6 text-xs font-semibold text-fg-muted">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-fg">
              {loadError && (
                <tr><td colSpan={5} className="px-8 py-6 text-center">
                  <span role="alert" className="text-sm font-semibold text-danger-text">{loadError}</span>
                  <button onClick={() => fetchRiders(currentPage, riders.length === 0)} className="ml-4 text-xs font-semibold text-fg hover:underline">Retry</button>
                </td></tr>
              )}
              {loading ? (
                <tr><td colSpan={5} className="px-8 py-20 text-center text-fg-subtle animate-pulse font-semibold">Loading riders…</td></tr>
              ) : riders.length === 0 ? (
                !loadError && <tr><td colSpan={5} className="px-8 py-20 text-center text-fg-muted font-semibold">No delivery partners yet. Use &quot;Add rider&quot; to onboard one.</td></tr>
              ) : shownRiders.length === 0 ? (
                <tr><td colSpan={5} className="px-8 py-12 text-center text-fg-muted">No riders on this page match the search or filter.</td></tr>
              ) : shownRiders.map((rider) => (
                <RiderRow key={rider._id} rider={rider} busy={busyId === rider._id} onEdit={(r) => { setIsAdding(false); setError(null); setEditingRider(r); setNewRider({ name: r.name, phone: r.phone, password: '', vehicleType: r.vehicleType || 'Bike' }); }} onToggleApproval={handleToggleApproval} onResetSos={handleResetSos} />
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="p-6 bg-surface-2/60 border-t border-line flex items-center justify-between">
              <span className="text-xs font-semibold text-fg-muted">Page {currentPage} of {totalPages} · {totalRiders} riders</span>
              <div className="flex gap-2">
                 <button disabled={loading || currentPage <= 1} onClick={() => fetchRiders(currentPage - 1)} className="px-4 py-2 bg-surface-2/60 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:text-fg disabled:opacity-30">Prev</button>
                 <button disabled={loading || currentPage >= totalPages} onClick={() => fetchRiders(currentPage + 1)} className="px-4 py-2 bg-surface-2/60 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:text-fg disabled:opacity-30">Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'payouts' && (
        <div className="glass-card overflow-hidden animate-fade-in">
          <div className="p-8 border-b border-line flex justify-between items-center bg-surface-2/60">
            <h4 className="text-lg font-semibold text-fg">Fleet Earnings Settlement</h4>
            <button onClick={() => { setPayoutsLoading(true); fetchPayouts(); }} className="px-4 py-2 bg-info-soft text-info-text rounded-xl text-xs font-semibold">↻ Refresh Payouts</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-2/60">
                  <th className="px-8 py-4 text-xs font-semibold text-fg-muted border-b border-line">Rider ID</th>
                  <th className="px-8 py-4 text-xs font-semibold text-fg-muted border-b border-line">Total Deliveries</th>
                  <th className="px-8 py-4 text-xs font-semibold text-info-text border-b border-line">Unsettled earnings (delivery fee, ₹30 min)</th>
                  <th className="px-8 py-4 text-xs font-semibold text-fg-muted border-b border-line">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.02]">
                {payoutsError ? (
                  <tr><td colSpan={4} className="py-10 text-center"><span role="alert" className="text-sm font-semibold text-danger-text">{payoutsError}</span></td></tr>
                ) : payoutsLoading ? (
                  <tr><td colSpan={4} className="py-10 text-center text-fg-subtle animate-pulse text-xs font-semibold">Loading payouts…</td></tr>
                ) : payouts.length === 0 ? (
                  <tr><td colSpan={4} className="py-10 text-center text-fg-muted text-xs">No unsettled rider earnings.</td></tr>
                ) : payouts.map(p => {
                  const riderName = p.riderName || riders.find(r => r._id === p.riderId)?.name || String(p.riderId).slice(-6).toUpperCase();
                  return (
                    <tr key={p.riderId} className="hover:bg-surface-2/60">
                      <td className="px-8 py-4 text-sm font-semibold text-fg">
                        {riderName}
                        {p.riderPhone && <span className="block text-xs text-fg-muted font-mono mt-0.5">{p.riderPhone}</span>}
                      </td>
                      <td className="px-8 py-4 text-sm text-fg-muted font-mono">{p.totalDeliveries}</td>
                      <td className="px-8 py-4 text-lg font-semibold text-success-text">
                        ₹{p.totalDeliveryFees}
                        {(Number(p.unsettledTips) || 0) > 0 && <span className="block text-xs font-semibold text-warning-text">+ ₹{p.unsettledTips} tips</span>}
                        {(Number(p.cashHeld) || 0) > 0 && <span className="block text-xs font-semibold text-fg-muted">Holds ₹{p.cashHeld} COD cash (not deducted)</span>}
                      </td>
                      <td className="px-8 py-4">
                        <button disabled={!!settlingId} onClick={() => handleMarkSettled(p, riderName)} className="px-4 py-2 bg-success hover:bg-success/90 text-on-solid rounded-lg text-xs font-semibold disabled:opacity-40">{settlingId === p.riderId ? 'Settling…' : 'Mark Settled'}</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'map' && (
        <div className="animate-fade-in relative z-0">
          <div className="mb-6 flex justify-between items-end">
             <div>
                <h3 className="text-xl font-semibold text-fg">Global Fleet Tracking Network</h3>
                <p className="text-xs text-fg-muted mt-1">Real-time Node Intercept Array</p>
             </div>
             <div className="flex gap-2">
                <span className="flex items-center gap-2 px-3 py-1 bg-success-soft border border-success/30 text-success-text rounded text-xs font-semibold">
                  <span className="w-2 h-2 rounded-full bg-success animate-pulse" /> Live Uplink
                </span>
             </div>
          </div>
          <LiveRiderMap />
        </div>
      )}

      <style jsx>{`
        .admin-input { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 1.25rem; border-radius: 1.5rem; color: white; font-weight: 900; outline: none; }
        .admin-input:focus { border-color: rgba(37, 99, 235, 0.5); }
      `}</style>
    </div>
  );
}
