"use client";

import { useCallback, useEffect, useState } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { adminRequest as apiRequest } from '@/lib/api';


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

const statusColors: Record<string, string> = {
  Available: 'text-info-text bg-info-soft border-info/30',
  Matched: 'text-success-text bg-success-soft border-success/30',
  Completed: 'text-fg-muted bg-surface-2/60 border-line',
  Cancelled: 'text-danger-text bg-danger-soft border-danger/30',
};

/** fetch against the one backend; throws an Error carrying the server's friendly `message`. */
export default function BikePoolAdmin() {
  const { isAuthed } = useAdminAuth();
  const [pools, setPools] = useState<BikePool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

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
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr || '—';
    return d.toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const runAction = async (pool: BikePool, action: 'force-cancel' | 'mark-paid') => {
    if (busyId) return;
    const route = `${pool.origin} → ${pool.destination}`;
    const question = action === 'force-cancel'
      ? `Cancel the ride ${route} by ${pool.creator?.name || 'this student'}? Riders will no longer see it. This cannot be undone.`
      : `Mark the ride ${route} as paid? Only do this once the co-riders have settled up.`;
    if (!confirm(question)) return;
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

  return (
    <div className="space-y-8 animate-fade-in">
      <header>
        <h1 className="text-2xl font-semibold text-fg">Co-ride</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">Every co-ride listing, newest first. Zenvy does not collect ride money; co-riders settle directly</p>
      </header>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Total', value: stats.total, color: 'text-fg' },
          { label: 'Available', value: stats.active, color: 'text-info-text' },
          { label: 'Matched', value: stats.matched, color: 'text-success-text' },
          { label: 'Completed', value: stats.completed, color: 'text-fg-muted' },
          { label: 'Cancelled', value: stats.cancelled, color: 'text-danger-text' },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-line bg-surface shadow-xs p-5">
            <p className="text-xs text-fg-muted font-semibold">{s.label}</p>
            <p className={`text-3xl font-semibold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-danger/30 bg-danger-soft text-sm font-semibold text-danger-text flex justify-between items-center gap-4">
          <span>{error}</span>
          <button onClick={fetchPools} className="text-xs font-semibold underline">Retry</button>
        </div>
      )}
      {notice && (
        <div className="p-4 rounded-xl border border-success/30 bg-success-soft text-sm font-semibold text-success-text">{notice}</div>
      )}

      {/* Filter Bar */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'Available', 'Matched', 'Completed', 'Cancelled'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
              filter === f ? 'bg-accent border-accent/30 text-on-solid' : 'bg-surface-2/60 border-line text-fg-muted hover:bg-surface-2'
            }`}
          >
            {f === 'all' ? 'All' : f}
          </button>
        ))}
        <button onClick={fetchPools} disabled={loading} className="ml-auto disabled:opacity-50 px-4 py-2 bg-surface-2/60 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:bg-surface-2 transition-all">
          ↻ Refresh
        </button>
      </div>

      {/* Pool List */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-accent/30 border-t-accent/30 rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-fg-subtle text-xs">
          {error ? 'Listings could not be loaded.' : filter === 'all' ? 'No co-ride listings yet.' : `No ${filter.toLowerCase()} rides.`}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(pool => (
            <div key={pool.id} className="rounded-lg border border-line bg-surface shadow-xs p-5 space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusColors[pool.status] || 'text-fg-muted'}`}>
                    {pool.status}
                  </span>
                  <span className="ml-2 text-xs font-semibold text-fg-muted border border-line px-2 py-0.5 rounded-full">
                    {pool.creatorRole === 'rider' ? 'Rider' : 'Passenger'}
                  </span>
                </div>
                <span className="text-success-text font-semibold text-sm">{Number(pool.splitAmount) > 0 ? `₹${Number(pool.splitAmount)}/seat` : 'Free'}</span>
              </div>

              <div>
                <p className="text-fg font-semibold text-sm">{pool.origin} → {pool.destination}</p>
                <p className="text-xs text-fg-muted mt-0.5">
                  Departs: {formatDateTime(pool.departureTime)}
                  {pool.vehicleType ? ` · ${pool.vehicleType}` : ''}
                  {typeof pool.availableSeats === 'number' ? ` · ${pool.availableSeats} seat${pool.availableSeats === 1 ? '' : 's'} left` : ''}
                </p>
              </div>

              <div className="border-t border-line pt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-fg-subtle block">Creator</span>
                  <span className="text-fg font-semibold">{pool.creator?.name || 'Unknown'}</span>
                  {pool.creator?.phone && <span className="text-fg-muted block">{pool.creator.phone}</span>}
                </div>
                {pool.coRider && (
                  <div>
                    <span className="text-fg-subtle block">Co-Rider</span>
                    <span className="text-fg font-semibold">{pool.coRider.name}</span>
                    {pool.coRider.phone && <span className="text-fg-muted block">{pool.coRider.phone}</span>}
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center mt-2">
                <div className="flex gap-2 text-xs font-semibold">
                  <span className="border border-line px-2 py-1 rounded text-fg-muted">
                    Gender Pref: {pool.genderPreference || 'Any'}
                  </span>
                  <span className={`border px-2 py-1 rounded ${pool.paymentStatus === 'Paid' ? 'text-success-text border-success/30' : 'text-warning-text border-warning/30'}`}>
                    {pool.paymentStatus}
                  </span>
                </div>
                <div className="flex gap-2">
                  {pool.paymentStatus === 'Unpaid' && pool.status !== 'Cancelled' && Number(pool.splitAmount) > 0 && (
                    <button 
                      onClick={() => runAction(pool, 'mark-paid')}
                      disabled={busyId === pool.id}
                      className="disabled:opacity-50 px-2 py-1 bg-success-soft text-success-text border border-success/30 rounded hover:bg-success-soft text-xs font-semibold"
                    >
                      Mark Paid
                    </button>
                  )}
                  {(pool.status === 'Available' || pool.status === 'Matched') && (
                    <button 
                      onClick={() => runAction(pool, 'force-cancel')}
                      disabled={busyId === pool.id}
                      className="disabled:opacity-50 px-2 py-1 bg-danger-soft text-danger-text border border-danger/30 rounded hover:bg-danger-soft text-xs font-semibold"
                    >
                      {busyId === pool.id ? '...' : 'Cancel ride'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
