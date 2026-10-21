"use client";
import {
  Badge, Button, ButtonLink, Card, CardBody, CardHeader, DataTable, EmptyState, ErrorState, Notice, PageHeader, SectionTitle, Skeleton, StatTile, StatusPill, useConfirm,
  type Column, IconRefresh,
} from '@/components/ui';
import { formatDateTime, formatNumber, formatTime, plural } from '@/lib/format';
import { useState, useEffect, useCallback, useRef } from 'react';
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
    if (!Number.isNaN(d.getTime())) return formatTime(d);
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
    if (!(await confirm({ title: `Remove this ${rev.rating != null ? `${rev.rating}★ ` : ''}review?`, description: `By ${rev.user?.name || 'a customer'} for ${rev.restaurantName || 'the store'}. The rating and text are deleted. This cannot be undone.`, confirmLabel: 'Remove review', tone: 'danger' }))) return;
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

  if (!isAuthed) return null; // AppShell shows the session check

  const s = stats.data;
  const metrics = s ? [
    { label: 'Delivered revenue', value: s.revenue, sub: 'Order value of all delivered orders' },
    { label: 'In-progress value', value: s.activeRevenue, sub: `${s.activeOrders} orders not yet delivered or cancelled` },
    { label: 'Total orders', value: formatNumber(Number(s.orderActivity || 0)), sub: 'All orders ever placed' },
    { label: 'Approved riders', value: s.activeFleet, sub: `${s.localVendorCount} active local vendors listed` },
  ] : [];

  const points = volume.data || [];
  const maxCount = Math.max(1, ...points.map(p => p.count));
  const totalLast12h = points.reduce((sum, p) => sum + (p.count || 0), 0);
  const reviewList = reviews.data || [];

  const reviewColumns: Column<Review>[] = [
    {
      key: 'who',
      header: 'Store and customer',
      sortValue: r => r.restaurantName || '',
      cell: r => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{r.restaurantName || 'Store'}</p>
          <p className="truncate text-xs text-fg-muted">{r.user?.name || 'Customer'}</p>
        </div>
      ),
    },
    { key: 'rating', header: 'Rating', sortValue: r => r.rating ?? -1, cell: r => (r.rating != null ? <Badge tone={r.rating >= 4 ? 'success' : r.rating >= 3 ? 'warning' : 'danger'}>★ {r.rating}</Badge> : <span className="text-fg-subtle">–</span>) },
    { key: 'review', header: 'Review', cell: r => <p className="line-clamp-2 max-w-[520px] break-words text-sm text-fg">{r.review}</p> },
    { key: 'created', header: 'Written', align: 'right', sortValue: r => new Date(r.createdAt), cell: r => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDateTime(r.createdAt, { short: true })}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: r => <Button size="sm" variant="ghost" className="text-danger-text" disabled={deletingId !== null} loading={deletingId === reviewId(r)} onClick={() => deleteReview(r)}>Remove</Button>,
    },
  ];

  const tileLabels = ['Delivered revenue', 'In-progress value', 'Total orders', 'Approved riders'];

  return (
    <div className="text-fg">
      <PageHeader
        title="Analytics"
        description="Revenue, order volume, system health and the latest written reviews. Refreshes every minute."
        meta={lastUpdated ? <span className="text-xs text-fg-subtle">Updated {formatTime(lastUpdated)}</span> : undefined}
        actions={(
          <>
            <ButtonLink href="/analytics/rewards">Rewards</ButtonLink>
            <Button leftIcon={<IconRefresh size={14} />} onClick={() => loadAll(true)}>Refresh</Button>
          </>
        )}
      />

      {notice && <Notice tone={notice.kind === 'error' ? 'danger' : 'success'} className="mb-4" onClose={() => setNotice(null)}>{notice.text}</Notice>}

      {stats.error ? (
        <Card className="mb-5"><ErrorState title="Could not load the totals" message={stats.error} onRetry={() => loadAll(false)} /></Card>
      ) : (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {loading
            ? tileLabels.map(label => <StatTile key={label} label={label} value="" loading />)
            : metrics.map(m => <StatTile key={m.label} label={m.label} value={m.value} hint={m.sub} />)}
        </div>
      )}

      <div className="mb-5 grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Orders per hour" description={`Last 12 hours · ${plural(totalLast12h, 'order')}`} />
          <CardBody>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : volume.error ? (
              <ErrorState message={volume.error} onRetry={() => loadAll(false)} />
            ) : points.length === 0 ? (
              <EmptyState title="No orders in the last 12 hours" />
            ) : (
              <>
                <div className="flex h-48 items-end gap-2 border-b border-line" role="img" aria-label={`Orders per hour: ${points.map(p => `${pointLabel(p)} ${p.count}`).join(', ')}`}>
                  {points.map((p, i) => (
                    <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${pointLabel(p)}: ${plural(p.count, 'order')}`}>
                      <span className="text-xs tabular-nums text-fg-muted">{p.count}</span>
                      <div className="w-full max-w-[40px] rounded-t bg-accent/80" style={{ height: `${Math.max(3, (p.count / maxCount) * 100)}%` }} />
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex gap-2 text-xs tabular-nums text-fg-muted">
                  {points.map((p, i) => <span key={i} className="flex-1 text-center">{pointLabel(p)}</span>)}
                </div>
                <p className="mt-3 text-xs text-fg-subtle">Hours with no orders are not shown.</p>
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="System" />
          <CardBody>
            {loading ? (
              <Skeleton className="h-24 w-full" />
            ) : health.error ? (
              <ErrorState message={health.error} onRetry={() => loadAll(false)} />
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-fg">API server</p>
                    <p className="text-xs text-fg-muted">Responding</p>
                  </div>
                  <StatusPill status="online" tone="success" label="Online" />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-fg">Database</p>
                    <p className="text-xs text-fg-muted">{health.data?.database || 'Unknown'}</p>
                  </div>
                  <StatusPill
                    status={health.data?.persistence || 'unknown'}
                    tone={health.data?.persistence === 'PERSISTENT' ? 'success' : 'warning'}
                    label={health.data?.persistence === 'PERSISTENT' ? 'Persistent' : 'Not persistent'}
                  />
                </div>
                {health.data?.persistence && health.data.persistence !== 'PERSISTENT' && (
                  <Notice tone="warning">The server is running on a temporary database. Data will be lost on restart.</Notice>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <SectionTitle
        title="Recent reviews"
        description="The latest written reviews. Remove reviews that are abusive or not about the order."
        actions={<Button size="sm" leftIcon={<IconRefresh size={14} />} onClick={loadReviews}>Refresh</Button>}
      />
      <DataTable
        caption="Recent reviews"
        columns={reviewColumns}
        rows={reviewList}
        rowKey={r => reviewId(r)}
        loading={loading}
        error={reviews.error}
        onRetry={loadReviews}
        initialSort={{ key: 'created', dir: 'desc' }}
        noun="reviews"
        empty={{ title: 'No written reviews yet' }}
      />
    </div>
  );
}
