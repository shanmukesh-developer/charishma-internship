"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { API_URL } from '@/lib/config';
import { useVisibleInterval } from '@/lib/useVisibleInterval';

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

  if (!isAuthed) return <div className="p-20 text-center font-semibold text-fg animate-pulse">Checking access…</div>;

  return (
    <div className="space-y-10 animate-fade-in relative">
      <header className="flex flex-wrap gap-6 justify-between items-center bg-surface-2/60 p-8 rounded-lg border border-line bg-surface border border-line">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Block wars</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">Hostel block leaderboard.</p>
          {updatedAt && <p className="text-xs text-fg-subtle font-semibold mt-2">Updated {updatedAt.toLocaleTimeString()} · refreshes every 30s</p>}
        </div>
        <div className="bg-surface border border-line px-10 py-4 rounded-lg border border-line flex flex-col items-center">
          <span className="text-xs font-semibold text-info-text mb-1">Delivered orders (30d)</span>
          <span className="text-3xl font-semibold text-fg">{loading ? '—' : total}</span>
        </div>
      </header>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-4 rounded-lg border border-danger/30 bg-danger-soft px-6 py-4 text-sm font-semibold text-danger-text">
          <span>{error}{stats.length > 0 ? ' Showing the last loaded numbers.' : ''}</span>
          <button onClick={() => { setLoading(stats.length === 0); fetchStats(); }} className="text-xs text-fg hover:underline">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        {loading ? (
          <div className="py-20 text-center font-semibold text-fg-muted animate-pulse">Loading block activity…</div>
        ) : stats.length === 0 ? (
          !error && <div className="py-20 text-center text-fg-muted font-semibold">No hostel blocks configured.</div>
        ) : stats.map((block, i) => {
          const ranked = total > 0 && block.count > 0;
          return (
            <div key={block.name} className="rounded-lg border border-line bg-surface shadow-xs p-10 relative overflow-hidden">
              <div className="flex items-center justify-between relative z-10">
                <div className="flex items-center gap-8">
                  <div className={`w-12 h-12 rounded-[1.5rem] flex items-center justify-center text-xl font-semibold ${
                    !ranked ? 'bg-surface-2/60 text-fg-subtle' :
                    i === 0 ? 'bg-accent text-on-solid' :
                    i === 1 ? 'bg-surface-2 text-fg-muted' :
                    i === 2 ? 'bg-warning-soft text-warning-text' : 'bg-surface-2/60 text-fg-muted'
                  }`}>
                    {ranked ? i + 1 : '–'}
                  </div>
                  <div>
                    <h4 className="text-xl font-semibold text-fg">{block.name}</h4>
                    <p className="text-xs text-fg-muted font-semibold">Hostel block</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs font-semibold text-fg-muted block mb-1">Orders delivered</span>
                  <span className="text-3xl font-semibold text-fg">{block.count}</span>
                </div>
              </div>
              <div className="mt-8 w-full h-1.5 bg-surface-2/60 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-1000 ${i === 0 && ranked ? 'bg-accent' : 'bg-surface-3'}`}
                  style={{ width: `${(block.count / maxCount) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {!loading && stats.length > 0 && (
        <div className="rounded-lg border border-line bg-surface shadow-xs p-10 border-info/30 bg-info-soft">
          <div className="flex items-center gap-6">
            <div>
              <h4 className="text-sm font-semibold text-fg">{leader ? `${leader.name} is leading` : 'No deliveries in the last 30 days'}</h4>
              <p className="text-xs text-fg-muted leading-relaxed max-w-2xl">
                {leader
                  ? 'Counts only delivered orders from users who saved a hostel block in their profile. Use Config to announce block-specific offers.'
                  : 'Rankings appear once delivered orders come in from users who have saved their hostel block.'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
