'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { API_URL } from '@/lib/config';
import {
  Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, ErrorState, LoadingState, Notice, PageHeader, SectionTitle, StatTile,
  type Column, IconRefresh,
} from '@/components/ui';
import { formatNumber, plural } from '@/lib/format';

interface TopPerformer {
  name: string;
  completedOrders: number;
  zenPoints: number;
  tier: string;
}

interface AnalyticsData {
  totalSpinsEarned: number;
  totalSpinsUsed: number;
  totalZenPoints: number;
  activeRewardUsers: number;
  badgeDistribution: Record<string, number>;
  tierDistribution: Record<string, number>;
  topPerformers: TopPerformer[];
  redemptionRate: number | string;
}

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

export default function RewardsAnalytics() {
  const { isAuthed } = useAdminAuth();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await requestJson<AnalyticsData>(`${API_URL}/api/admin/rewards-analytics`);
      setData({
        totalSpinsEarned: Number(d?.totalSpinsEarned || 0),
        totalSpinsUsed: Number(d?.totalSpinsUsed || 0),
        totalZenPoints: Number(d?.totalZenPoints || 0),
        activeRewardUsers: Number(d?.activeRewardUsers || 0),
        badgeDistribution: d?.badgeDistribution || {},
        tierDistribution: d?.tierDistribution || {},
        topPerformers: Array.isArray(d?.topPerformers) ? d.topPerformers : [],
        redemptionRate: d?.redemptionRate ?? 0,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load rewards analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthed) load();
  }, [isAuthed, load]);

  if (!isAuthed) return null; // AppShell shows the session check

  const header = (
    <PageHeader
      title="Rewards"
      description="ZenWe Points, spin-wheel use, loyalty tiers and badges across all students."
      breadcrumbs={[{ label: 'Analytics', href: '/analytics' }, { label: 'Rewards' }]}
      actions={<Button leftIcon={<IconRefresh size={14} />} loading={loading} onClick={load}>Refresh</Button>}
    />
  );

  if (loading && !data) return <div className="text-fg">{header}<LoadingState label="Loading rewards…" /></div>;

  if (!data) return (
    <div className="text-fg">
      {header}
      <ErrorState title="Could not load rewards" message={error || undefined} onRetry={load} />
    </div>
  );

  const tierTotal = Object.values(data.tierDistribution).reduce((s, n) => s + (Number(n) || 0), 0);
  const tiers = Object.entries(data.tierDistribution);
  const badges = Object.entries(data.badgeDistribution).sort((a, b) => Number(b[1]) - Number(a[1]));

  type Performer = TopPerformer & { rank: number };
  const performerColumns: Column<Performer>[] = [
    { key: 'rank', header: '#', width: '48px', sortValue: u => u.rank, cell: u => <span className="tabular-nums text-fg-muted">{u.rank}</span> },
    { key: 'name', header: 'Student', sortValue: u => u.name || '', cell: u => <span className="font-medium text-fg">{u.name || 'Student'}</span> },
    { key: 'orders', header: 'Orders', align: 'right', sortValue: u => u.completedOrders || 0, cell: u => <span className="tabular-nums">{formatNumber(u.completedOrders || 0)}</span> },
    { key: 'points', header: 'ZenWe Points', align: 'right', sortValue: u => u.zenPoints || 0, cell: u => <span className="tabular-nums">{formatNumber(u.zenPoints || 0)}</span> },
    { key: 'tier', header: 'Tier', sortValue: u => u.tier, cell: u => (u.tier && u.tier !== 'None' ? <Badge tone={tierTone(u.tier)}>{u.tier}</Badge> : <span className="text-fg-subtle">–</span>) },
  ];

  return (
    <div className="text-fg">
      {header}
      {error && <Notice tone="danger" className="mb-4">{error} Showing the last loaded numbers.</Notice>}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="ZenWe Points held" value={formatNumber(data.totalZenPoints)} />
        <StatTile label="Spins used" value={`${formatNumber(data.totalSpinsUsed)} of ${formatNumber(data.totalSpinsEarned)}`} hint="Used of earned" />
        <StatTile label="Spin redemption" value={`${data.redemptionRate}%`} />
        <StatTile label="Students with orders" value={formatNumber(data.activeRewardUsers)} />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Tier distribution" description={tierTotal ? `${plural(tierTotal, 'student')} in total` : undefined} />
          <CardBody>
            {tierTotal === 0 ? (
              <EmptyState title="No students yet" />
            ) : (
              <div className="space-y-3">
                {tiers.map(([tier, count]) => {
                  const n = Number(count) || 0;
                  const pct = tierTotal ? Math.round((n / tierTotal) * 100) : 0;
                  return (
                    <div key={tier}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className={tier === 'None' ? 'text-fg-muted' : 'text-fg'}>{tier === 'None' ? 'No tier yet' : tier}</span>
                        <span className="tabular-nums text-fg-muted">{formatNumber(n)} · {pct}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
                        <div style={{ width: `${(n / tierTotal) * 100}%` }} className={`h-full rounded-full ${tier === 'None' ? 'bg-fg-subtle/50' : 'bg-accent'}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        <div>
          <SectionTitle title="Top customers by orders" />
          <DataTable
            caption="Top customers by orders"
            columns={performerColumns}
            rows={data.topPerformers.map((u, i) => ({ ...u, rank: i + 1 }))}
            rowKey={u => String(u.rank)}
            initialSort={{ key: 'rank', dir: 'asc' }}
            noun="students"
            empty={{ title: 'No completed orders yet' }}
          />
        </div>
      </div>

      <SectionTitle title="Badges earned" description="How many students hold each badge." />
      {badges.length === 0 ? (
        <Card><EmptyState title="No badges earned yet" /></Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          {badges.map(([badge, count]) => (
            <StatTile key={badge} label={badge} value={formatNumber(Number(count) || 0)} />
          ))}
        </div>
      )}
    </div>
  );
}

function tierTone(tier: string): 'neutral' | 'info' | 'success' | 'warning' | 'accent' {
  switch (tier) {
    case 'Elite': return 'accent';
    case 'Diamond': return 'info';
    case 'Gold': return 'warning';
    case 'Bronze': return 'warning';
    default: return 'neutral';
  }
}
