'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { API_URL } from '@/lib/config';

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

  if (!isAuthed) return <div className="p-20 text-center font-semibold text-fg animate-pulse">Checking access…</div>;

  if (loading && !data) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-12 h-12 border-4 border-info/30 border-t-info/30 rounded-full animate-spin" />
    </div>
  );

  if (!data) return (
    <div className="py-20 text-center">
      <p className="text-sm text-danger-text font-semibold">{error || 'Could not load rewards analytics.'}</p>
      <button onClick={load} className="mt-4 px-4 py-2 bg-surface-2/60 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:text-fg">Try again</button>
    </div>
  );

  const tierTotal = Object.values(data.tierDistribution).reduce((s, n) => s + (Number(n) || 0), 0);
  const badges = Object.entries(data.badgeDistribution);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap gap-4 justify-between items-end">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-fg">Rewards</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">Rewards and spin-wheel analytics.</p>
        </div>
        <button onClick={load} disabled={loading} className="px-4 py-2 bg-info-soft text-info-text border border-info/30 rounded-lg text-xs font-semibold disabled:opacity-40">{loading ? 'Refreshing…' : '↻ Refresh'}</button>
      </div>
      {error && <p className="text-xs text-danger-text font-semibold">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard title="ZenPoints held" value={data.totalZenPoints.toLocaleString('en-IN')} icon="" color="blue" />
        <StatCard title="Spins used / earned" value={`${data.totalSpinsUsed} / ${data.totalSpinsEarned}`} icon="" color="amber" />
        <StatCard title="Students with orders" value={data.activeRewardUsers.toLocaleString('en-IN')} icon="" color="emerald" />
        <StatCard title="Spin redemption" value={`${data.redemptionRate}%`} icon="" color="rose" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="bg-surface border border-line p-8 rounded-lg border border-line">
          <h3 className="text-xl font-semibold text-fg mb-6 flex items-center gap-2">
            <span className="text-info-text"></span> Tier distribution
          </h3>
          {tierTotal === 0 ? (
            <p className="text-xs text-fg-muted">No students yet.</p>
          ) : (
            <div className="space-y-6">
              {Object.entries(data.tierDistribution).map(([tier, count]) => (
                <div key={tier} className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className={tier === 'None' ? 'text-fg-muted' : 'text-fg-muted'}>{tier === 'None' ? 'No tier yet' : tier}</span>
                    <span className="text-fg">{count}</span>
                  </div>
                  <div className="h-2 w-full bg-surface-2/60 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${(Number(count) / tierTotal) * 100}%` }}
                      className={`h-full transition-[width] duration-700 ${getTierColor(tier)}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-surface border border-line p-8 rounded-lg border border-line">
          <h3 className="text-xl font-semibold text-fg mb-6 flex items-center gap-2">
            <span className="text-warning-text"></span> Top customers by orders
          </h3>
          {data.topPerformers.length === 0 ? (
            <p className="text-xs text-fg-muted">No completed orders yet.</p>
          ) : (
            <div className="overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-xs font-semibold text-fg-muted border-b border-line">
                    <th className="pb-4">Student</th>
                    <th className="pb-4">Orders</th>
                    <th className="pb-4">Points</th>
                    <th className="pb-4">Tier</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.topPerformers.map((user, i) => (
                    <tr key={i} className="group hover:bg-surface-2/60 transition-colors">
                      <td className="py-4"><p className="text-sm font-semibold text-fg">{user.name || 'Student'}</p></td>
                      <td className="py-4 text-sm text-fg-muted font-mono">{user.completedOrders || 0}</td>
                      <td className="py-4 text-sm text-info-text font-semibold">{user.zenPoints || 0}</td>
                      <td className="py-4">
                        <span className={`text-xs font-semibold px-2 py-1 rounded-md ${getTierBadgeStyle(user.tier)}`}>
                          {user.tier === 'None' ? '—' : user.tier}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="bg-surface border border-line p-8 rounded-lg border border-line">
        <h3 className="text-xl font-semibold text-fg mb-6 flex items-center gap-2">
          <span className="text-danger-text"></span> Badges earned
        </h3>
        {badges.length === 0 ? (
          <p className="text-xs text-fg-muted">No badges earned yet.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {badges.map(([badge, count]) => (
              <div key={badge} className="p-4 rounded-lg bg-surface-2/60 border border-line flex flex-col items-center justify-center text-center gap-2 group hover:border-info/30 transition-all">
                <div className="w-10 h-10 rounded-full bg-info-soft flex items-center justify-center text-xl transition-transform">
                  {getBadgeIcon(badge)}
                </div>
                <p className="text-xs font-semibold text-fg-muted leading-tight">{badge}</p>
                <p className="text-lg font-semibold text-fg leading-none">{count}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ title, value, icon, color }: { title: string; value: string; icon: string; color: string }) {
  const colors = {
    blue: 'border-info/30 text-info-text',
    amber: 'border-warning/30 text-warning-text',
    emerald: 'border-success/30 text-success-text',
    rose: 'border-danger/30 text-danger-text'
  };

  return (
    <div className={`bg-surface border border-line p-6 rounded-lg border bg-surface-2 ${colors[color as keyof typeof colors]}`}>
      <div className="flex justify-between items-start mb-4">
        <span className="text-2xl">{icon}</span>
      </div>
      <div>
        <p className="text-xs font-semibold text-fg-muted mb-1">{title}</p>
        <p className="text-3xl font-semibold text-fg">{value}</p>
      </div>
    </div>
  );
}

function getTierColor(tier: string) {
  switch (tier) {
    case 'Elite': return 'bg-surface-2';
    case 'Diamond': return 'bg-surface-2';
    case 'Platinum': return 'bg-surface-2';
    case 'Gold': return 'bg-surface-2';
    case 'Silver': return 'bg-surface-2';
    case 'Bronze': return 'bg-surface-2';
    default: return 'bg-surface-2';
  }
}

function getTierBadgeStyle(tier: string) {
    switch (tier) {
      case 'Elite': return 'bg-accent-soft text-accent-text border border-accent/30';
      case 'Diamond': return 'bg-info-soft text-info-text border border-info/30';
      case 'Platinum': return 'bg-surface-2 text-fg border border-line';
      case 'Gold': return 'bg-warning-soft text-warning-text border border-warning/30';
      case 'Silver': return 'bg-surface-3 text-fg-muted border border-line-strong';
      case 'Bronze': return 'bg-warning-soft text-warning-text border border-warning/30';
      default: return 'bg-surface-3 text-fg-muted border border-line-strong';
    }
}

function getBadgeIcon(badge: string) {
    if (badge.includes('Beginner') || badge.includes('Bat') || badge.includes('Believer')) return '🌑';
    if (badge.includes('Scaler') || badge.includes('Shadow') || badge.includes('Streaker')) return '🌙';
    if (badge.includes('Grafter') || badge.includes('Ghost') || badge.includes('Guardian')) return '🌕';
    if (badge.includes('Pro') || badge.includes('Phantom') || badge.includes('Persistence')) return '⭐';
    if (badge.includes('Devotee') || badge.includes('Drifter') || badge.includes('Dynamo')) return '💎';
    if (badge.includes('Eater')) return '⚡';
    return '🔰';
}
