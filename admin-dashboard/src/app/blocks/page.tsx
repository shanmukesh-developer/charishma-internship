"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { API_URL } from '@/lib/config';
import { useVisibleInterval } from '@/lib/useVisibleInterval';
import { Button, DataTable, Notice, PageHeader, StatTile, type Column, IconRefresh } from '@/components/ui';
import { formatNumber, formatTime } from '@/lib/format';

interface BlockStats {
  name: string;
  count: number;
}

const REFRESH_MS = 30000;

export default function BlockWarsHUD() {
  const { isAuthed } = useAdminAuth();
  const [stats, setStats] = useState<BlockStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const fetchStats = useCallback(async (signal?: { cancelled: boolean }) => {
    try {
      const res = await fetch(`${API_URL}/api/blocks/activity`, { cache: 'no-store', credentials: 'include' });
      if (!res.ok) throw new Error(res.status >= 500 ? 'The server had a problem loading block activity.' : `Could not load block activity (${res.status}).`);
      const data = await res.json();
      if (signal?.cancelled) return;
      setStats(Array.isArray(data) ? data.filter((s: any) => s && typeof s.name === 'string').map((s: any) => ({ name: s.name, count: Number(s.count) || 0 })) : []);
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      if (signal?.cancelled) return;
      setError(err instanceof TypeError ? 'Could not reach the server. Check your connection.' : (err as Error).message);
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }, []);

  const signalRef = useRef({ cancelled: false });
  useEffect(() => {
    if (!isAuthed) return;
    const signal = { cancelled: false };
    signalRef.current = signal;
    fetchStats(signal);
    return () => { signal.cancelled = true; };
  }, [isAuthed, fetchStats]);
  // Auto-refresh, paused while the tab is hidden.
  useVisibleInterval(() => fetchStats(signalRef.current), REFRESH_MS, isAuthed);

  const total = stats.reduce((acc, curr) => acc + curr.count, 0);
  const maxCount = Math.max(...stats.map(s => s.count), 1);
  const leader = total > 0 ? stats[0] : null;

  if (!isAuthed) return null; // AppShell shows the session check

  type Row = BlockStats & { rank: number };
  const rows: Row[] = stats.map((b, i) => ({ ...b, rank: i + 1 }));
  const columns: Column<Row>[] = [
    {
      key: 'rank',
      header: 'Rank',
      width: '70px',
      sortValue: r => r.rank,
      cell: r => (total > 0 && r.count > 0
        ? <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${r.rank === 1 ? 'bg-accent text-on-solid' : 'bg-surface-2 text-fg-muted'}`}>{r.rank}</span>
        : <span className="text-fg-subtle">–</span>),
    },
    { key: 'name', header: 'Hostel block', sortValue: r => r.name, cell: r => <span className="font-medium text-fg">{r.name}</span> },
    {
      key: 'bar',
      header: 'Share of orders',
      hideBelow: 'md',
      cell: r => (
        <div className="flex items-center gap-3">
          <div className="h-1.5 w-full max-w-[320px] overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className={`h-full ${r.rank === 1 && r.count > 0 ? 'bg-accent' : 'bg-fg-subtle/50'}`} style={{ width: `${(r.count / maxCount) * 100}%` }} />
          </div>
          <span className="w-12 text-right text-xs tabular-nums text-fg-muted">{total > 0 ? `${Math.round((r.count / total) * 100)}%` : '0%'}</span>
        </div>
      ),
    },
    { key: 'count', header: 'Orders delivered', align: 'right', sortValue: r => r.count, cell: r => <span className="font-medium tabular-nums">{formatNumber(r.count)}</span> },
  ];

  return (
    <div className="text-fg">
      <PageHeader
        title="Block wars"
        description="Hostel block leaderboard: delivered orders in the last 30 days from students who saved their block. Refreshes every 30 seconds."
        meta={updatedAt ? <span className="text-xs text-fg-subtle">Updated {formatTime(updatedAt)}</span> : undefined}
        actions={<Button leftIcon={<IconRefresh size={14} />} onClick={() => { setLoading(stats.length === 0); fetchStats(); }}>Refresh</Button>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatTile label="Delivered orders (30 days)" value={formatNumber(total)} loading={loading} />
        <StatTile label="Leading block" value={leader ? leader.name : 'None yet'} loading={loading} />
        <StatTile label="Blocks" value={formatNumber(stats.length)} loading={loading} />
      </div>

      {error && stats.length > 0 && (
        <Notice tone="danger" className="mb-3" action={<Button size="sm" onClick={() => fetchStats()}>Retry</Button>}>
          {error} Showing the last loaded numbers.
        </Notice>
      )}

      <DataTable
        caption="Block leaderboard"
        columns={columns}
        rows={rows}
        rowKey={r => r.name}
        loading={loading}
        error={stats.length === 0 ? error : null}
        onRetry={() => { setLoading(true); fetchStats(); }}
        initialSort={{ key: 'rank', dir: 'asc' }}
        noun="blocks"
        empty={{ title: 'No hostel blocks configured' }}
      />

      {!loading && stats.length > 0 && (
        <p className="mt-3 text-sm text-fg-muted">
          {leader
            ? 'Counts only delivered orders from students who saved a hostel block in their profile. Use Push notifications to announce block offers.'
            : 'Rankings appear once delivered orders come in from students who have saved their hostel block.'}
        </p>
      )}
    </div>
  );
}
