"use client";
import { readableText } from '@/components/ui/Readable';
import { useState, useEffect, useCallback } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { API_URL } from '@/lib/config';

interface AuditLog {
  id: string;
  adminId: string | null;
  targetId: string | null;
  action: string | null;
  details: string | null;
  timestamp: string;
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

const shortRef = (v: string | null) => {
  if (!v) return '—';
  return v.length > 12 ? `${v.slice(0, 8)}…` : v;
};

/** Pretty-print JSON details ({"code":"X"} → code: X) and leave plain text alone. */
const formatDetails = (raw: string | null) => {
  if (!raw) return '';
  // Readable labels and values (dates in IST, Yes / No, nested values in brackets) instead of raw JSON.
  return readableText(raw);
};

const actionTone = (action: string) => {
  if (/DELETE|BAN|REJECT|REVOKE/.test(action)) return 'text-danger-text bg-danger-soft border-danger/30';
  if (/CREATE|APPROVE|SETTLED|REFUND/.test(action)) return 'text-success-text bg-success-soft border-success/30';
  if (/UPDATE|CHANGE/.test(action)) return 'text-info-text bg-info-soft border-info/30';
  return 'text-warning-text bg-warning-soft border-warning/30';
};

export default function AuditPage() {
  const { isAuthed, user } = useAdminAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchLogs = useCallback(async (nextPage = 1) => {
    setLoading(true);
    try {
      const data = await requestJson<AuditLog[] | { logs?: AuditLog[]; total?: number; pages?: number }>(`${API_URL}/api/admin/audit?page=${nextPage}`);
      const list = Array.isArray(data) ? data : Array.isArray(data?.logs) ? data.logs : [];
      setLogs(list);
      setTotal(!Array.isArray(data) && typeof data?.total === 'number' ? data.total : list.length);
      setPages(!Array.isArray(data) && typeof data?.pages === 'number' ? Math.max(1, data.pages) : 1);
      setPage(nextPage);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the audit log.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthed) fetchLogs(1);
  }, [isAuthed, fetchLogs]);

  if (!isAuthed) return <div className="p-20 text-center font-semibold text-fg animate-pulse">Checking access…</div>;

  const q = search.trim().toLowerCase();
  const visible = logs.filter(log =>
    !q || [log.action, log.adminId, log.targetId, log.details].some(v => String(v || '').toLowerCase().includes(q))
  );
  const myId = user?.id ? String(user.id) : '';

  return (
    <div className="space-y-8 animate-fade-in relative">
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Audit log</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">{total} admin actions (refunds, payouts, coupons, deletions…) · page {page} of {pages}</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Filter this page: action, admin, target…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-surface-2/60 border border-line rounded-lg px-4 py-2 text-sm text-fg outline-none focus:border-accent transition-all w-72"
          />
          <button onClick={() => fetchLogs(page)} disabled={loading} className="px-4 py-2 bg-info-soft text-info-text border border-info/30 rounded-lg text-xs font-semibold disabled:opacity-40">↻ Refresh</button>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="zv-table">
            <thead>
              <tr className="border-b border-line bg-surface-2/60">
                {['Time', 'Action', 'Admin', 'Target', 'Details'].map(h => (
                  <th key={h} className="px-6 py-4 text-xs font-semibold text-fg-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {loading ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-xs text-fg-muted animate-pulse">Loading audit log…</td></tr>
              ) : error ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <p className="text-xs text-danger-text font-semibold">{error}</p>
                    <button onClick={() => fetchLogs(page)} className="mt-3 px-4 py-2 bg-surface-2/60 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:text-fg">Try again</button>
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-xs text-fg-muted">{q ? 'No entries on this page match your search.' : 'No admin actions recorded yet.'}</td></tr>
              ) : (
                visible.map((log) => {
                  const action = log.action || 'UNKNOWN';
                  const details = formatDetails(log.details);
                  return (
                    <tr key={log.id} className="hover:bg-surface-2/60 transition-colors align-top">
                      <td className="px-6 py-4 text-xs text-fg-muted font-medium whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                      <td className="px-6 py-4">
                        <span className={`text-xs font-semibold px-2 py-1 rounded-md border whitespace-nowrap ${actionTone(action)}`}>{action.replace(/_/g, ' ')}</span>
                      </td>
                      <td className="px-6 py-4 text-xs font-mono text-fg-muted" title={log.adminId || ''}>
                        {myId && log.adminId === myId ? 'You' : shortRef(log.adminId)}
                      </td>
                      <td className="px-6 py-4 text-xs font-mono text-fg-muted" title={log.targetId || ''}>{shortRef(log.targetId)}</td>
                      <td className="px-6 py-4 text-xs text-fg-muted max-w-md break-words">{details || '—'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-6 py-4">
            <span className="text-xs font-semibold text-fg-muted">Page {page} of {pages}</span>
            <div className="flex gap-2">
              <button disabled={loading || page <= 1} onClick={() => fetchLogs(page - 1)} className="px-5 py-2 bg-surface-2 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:text-fg disabled:opacity-30">Newer</button>
              <button disabled={loading || page >= pages} onClick={() => fetchLogs(page + 1)} className="px-5 py-2 bg-surface-2 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:text-fg disabled:opacity-30">Older</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
