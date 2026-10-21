"use client";
import { useConfirm } from '@/components/ui';
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { API_URL } from '@/lib/config';

// ─── Shapes returned by /api/admin/stats, /stats/volume, /health, /reviews ───
interface DashboardStats {
  revenue: string;
  activeRevenue: string;
  orderActivity: string;
  activeFleet: string;
  activeOrders: string;
  localVendorCount: string;
}

interface VolumePoint { hour: string; count: number; timestamp?: string | null }

/** Label in the admin's own time zone when the backend sends an ISO timestamp. */
const pointLabel = (p: VolumePoint) => {
  if (p.timestamp) {
    const d = new Date(p.timestamp);
    if (!Number.isNaN(d.getTime())) return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return p.hour;
};

interface Health { database?: string; persistence?: string; timestamp?: string }

interface Review {
  id: string;
  _id?: string;
  user?: { name?: string; phone?: string } | null;
  restaurantName?: string;
  rating: number | null;
  review: string | null;
  createdAt: string;
}

type Section<T> = { data: T | null; error: string | null };

const POLL_MS = 60000;

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

const settle = async <T,>(p: Promise<T>): Promise<Section<T>> => {
  try { return { data: await p, error: null }; }
  catch (err) { return { data: null, error: err instanceof Error ? err.message : 'Could not load.' }; }
};

const reviewId = (r: Review) => String(r.id || r._id || '');

const ErrorLine = ({ text, onRetry }: { text: string; onRetry: () => void }) => (
  <div className="py-8 text-center">
    <p className="text-xs text-danger-text font-semibold">{text}</p>
    <button onClick={onRetry} className="mt-3 px-4 py-2 bg-surface-2/60 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:text-fg">Try again</button>
  </div>
);

export default function AnalyticsIntel() {
  const confirm = useConfirm();
  const { isAuthed } = useAdminAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Section<DashboardStats>>({ data: null, error: null });
  const [volume, setVolume] = useState<Section<VolumePoint[]>>({ data: null, error: null });
  const [health, setHealth] = useState<Section<Health>>({ data: null, error: null });
  const [reviews, setReviews] = useState<Section<Review[]>>({ data: null, error: null });
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const deleting = useRef(false);

  const loadAll = useCallback(async (includeReviews: boolean) => {
    const [s, v, h, r] = await Promise.all([
      settle(requestJson<DashboardStats>(`${API_URL}/api/admin/stats`)),
      settle(requestJson<VolumePoint[]>(`${API_URL}/api/admin/stats/volume`)),
      settle(requestJson<Health>(`${API_URL}/api/admin/health`)),
      includeReviews ? settle(requestJson<Review[]>(`${API_URL}/api/admin/reviews`)) : Promise.resolve(null),
    ]);
    setStats(s);
    setVolume({ data: Array.isArray(v.data) ? v.data : v.data ? [] : null, error: v.error });
    setHealth(h);
    if (r) setReviews({ data: Array.isArray(r.data) ? r.data : r.data ? [] : null, error: r.error });
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  const loadReviews = useCallback(async () => {
    const r = await settle(requestJson<Review[]>(`${API_URL}/api/admin/reviews`));
    setReviews({ data: Array.isArray(r.data) ? r.data : r.data ? [] : null, error: r.error });
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    loadAll(true);
    const interval = setInterval(() => {
      if (!document.hidden) loadAll(false);
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [isAuthed, loadAll]);

  const deleteReview = async (rev: Review) => {
    if (deleting.current) return;
    const id = reviewId(rev);
    if (!id) return;
    if (!(await confirm({ title: `Remove this ${rev.rating ?? ''}★ review by ${rev.user?.name || 'a customer'} for ${rev.restaurantName || 'the store'}? The rating and text are deleted. This cannot be undone.` }))) return;
    deleting.current = true;
    setDeletingId(id);
    try {
      await requestJson(`${API_URL}/api/admin/reviews/${id}`, { method: 'DELETE' });
      setReviews(prev => ({ ...prev, data: (prev.data || []).filter(r => reviewId(r) !== id) }));
      setNotice({ kind: 'success', text: 'Review removed.' });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Could not remove the review.' });
    } finally {
      deleting.current = false;
      setDeletingId(null);
    }
  };

  if (!isAuthed) return <div className="p-20 text-center font-semibold text-fg animate-pulse">Checking access…</div>;

  const s = stats.data;
  const metrics = s ? [
    { label: 'Delivered revenue', value: s.revenue, sub: 'Order value of all delivered orders' },
    { label: 'In-progress value', value: s.activeRevenue, sub: `${s.activeOrders} orders not yet delivered or cancelled` },
    { label: 'Total orders', value: Number(s.orderActivity || 0).toLocaleString('en-IN'), sub: 'All orders ever placed' },
    { label: 'Approved riders', value: s.activeFleet, sub: `${s.localVendorCount} active local vendors listed` },
  ] : [];

  const points = volume.data || [];
  const maxCount = Math.max(1, ...points.map(p => p.count));
  const totalLast12h = points.reduce((sum, p) => sum + (p.count || 0), 0);
  const reviewList = reviews.data || [];

  return (
    <div className="space-y-10 animate-fade-in relative">
      <header className="flex flex-wrap gap-6 justify-between items-center bg-surface-2/60 p-8 rounded-lg border border-line bg-surface border border-line">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Analytics</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">Order volume, revenue and store performance over time.</p>
        </div>
        <div className="flex items-center gap-4">
          {lastUpdated && <span className="text-xs text-fg-muted font-semibold">Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          <button onClick={() => loadAll(true)} className="px-4 py-2 bg-info-soft text-info-text border border-info/30 rounded-lg text-xs font-semibold">↻ Refresh</button>
        </div>
      </header>

      {notice && (
        <div className={`p-4 rounded-lg border text-xs font-semibold flex justify-between items-start gap-4 ${notice.kind === 'error' ? 'bg-danger-soft border-danger/30 text-danger-text' : 'bg-success-soft border-success/30 text-success-text'}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-fg-muted hover:text-fg" aria-label="Dismiss"><span aria-hidden="true" className="text-base leading-none">×</span></button>
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center font-semibold text-fg-muted animate-pulse text-xs">Loading metrics…</div>
      ) : (
        <>
          {stats.error ? (
            <div className="glass-card"><ErrorLine text={stats.error} onRetry={() => loadAll(false)} /></div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {metrics.map(m => (
                <div key={m.label} className="rounded-lg border border-line bg-surface shadow-xs p-8">
                  <p className="stat-label tracking-[0.2em]">{m.label}</p>
                  <h4 className="text-3xl font-semibold text-fg mt-2">{m.value}</h4>
                  <p className="text-xs font-semibold text-fg-muted mt-2">{m.sub}</p>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
            <div className="rounded-lg border border-line bg-surface shadow-xs p-10 space-y-6 xl:col-span-2">
              <div className="flex justify-between items-baseline">
                <h3 className="text-xl font-semibold text-fg">Orders per hour</h3>
                <span className="text-xs text-fg-muted font-semibold">Last 12 hours · {totalLast12h} orders</span>
              </div>
              {volume.error ? (
                <ErrorLine text={volume.error} onRetry={() => loadAll(false)} />
              ) : points.length === 0 ? (
                <p className="py-16 text-center text-xs text-fg-muted">No orders in the last 12 hours.</p>
              ) : (
                <>
                  <div className="h-48 flex items-end gap-2 pt-6">
                    {points.map((p, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-1" title={`${pointLabel(p)}: ${p.count} orders`}>
                        <span className="text-xs font-semibold text-fg-muted">{p.count}</span>
                        <div className="w-full bg-info-soft rounded-t-lg" style={{ height: `${Math.max(4, (p.count / maxCount) * 100)}%` }} />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 text-xs font-semibold text-fg-muted">
                    {points.map((p, i) => <span key={i} className="flex-1 text-center">{pointLabel(p)}</span>)}
                  </div>
                  <p className="text-xs text-fg-subtle">Hours with no orders are not shown. Hour labels use the server clock.</p>
                </>
              )}
            </div>

            <div className="rounded-lg border border-line bg-surface shadow-xs p-10 space-y-4">
              <h3 className="text-xl font-semibold text-fg">System</h3>
              {health.error ? (
                <ErrorLine text={health.error} onRetry={() => loadAll(false)} />
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 bg-surface-2/60 rounded-lg border border-line">
                    <div>
                      <p className="text-sm font-semibold text-fg">API server</p>
                      <p className="text-xs text-fg-muted font-semibold">Responding</p>
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md border text-success-text bg-success-soft border-success/30">Online</span>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-surface-2/60 rounded-lg border border-line">
                    <div>
                      <p className="text-sm font-semibold text-fg">Database</p>
                      <p className="text-xs text-fg-muted font-semibold">{health.data?.database || 'Unknown'}</p>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${health.data?.persistence === 'PERSISTENT' ? 'text-success-text bg-success-soft border-success/30' : 'text-warning-text bg-warning-soft border-warning/30'}`}>
                      {health.data?.persistence === 'PERSISTENT' ? 'Persistent' : 'Not persistent'}
                    </span>
                  </div>
                  {health.data?.persistence && health.data.persistence !== 'PERSISTENT' && (
                    <p className="text-xs text-warning-text">The server is running on a temporary database. Data will be lost on restart.</p>
                  )}
                  <Link href="/analytics/rewards" className="block p-4 bg-info-soft rounded-lg border border-info/30 text-xs font-semibold text-info-text hover:bg-info-soft">
                    Rewards analytics →
                  </Link>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-line bg-surface shadow-xs p-10 space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-semibold text-fg">Recent reviews</h3>
              <div className="flex items-center gap-4">
                <span className="text-xs text-fg-muted">{reviewList.length} latest written reviews</span>
                <button onClick={loadReviews} className="px-3 py-1.5 bg-surface-2/60 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:text-fg">↻</button>
              </div>
            </div>

            {reviews.error ? (
              <ErrorLine text={reviews.error} onRetry={loadReviews} />
            ) : reviewList.length === 0 ? (
              <p className="text-xs text-fg-muted py-10 text-center">No written reviews yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {reviewList.map(rev => {
                  const id = reviewId(rev);
                  return (
                    <div key={id} className="p-5 bg-surface-2/60 border border-line rounded-lg flex flex-col gap-3">
                      <div className="flex justify-between items-center border-b border-line pb-2 gap-4">
                        <span className="text-xs font-semibold text-info-text">
                          {rev.user?.name || 'Customer'}
                          <span className="text-fg-muted ml-2">→ {rev.restaurantName || 'Store'}</span>
                        </span>
                        {rev.rating != null && <span className="text-warning-text font-semibold text-sm whitespace-nowrap">★ {rev.rating}</span>}
                      </div>
                      <p className="text-sm text-fg-muted break-words">{rev.review}</p>
                      <div className="flex justify-between items-center pt-2 border-t border-line">
                        <span className="text-xs text-fg-muted font-mono">{new Date(rev.createdAt).toLocaleString()}</span>
                        <button
                          onClick={() => deleteReview(rev)}
                          disabled={deletingId !== null}
                          className="px-4 py-1.5 bg-danger-soft text-danger-text hover:bg-danger-soft rounded text-xs font-semibold transition-all disabled:opacity-40"
                        >
                          {deletingId === id ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
