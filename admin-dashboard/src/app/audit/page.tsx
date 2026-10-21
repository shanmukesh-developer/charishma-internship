"use client";
import { readableText, ReadableValue } from '@/components/ui/Readable';
import {
  Badge, Button, DataTable, DescriptionList, Drawer, PageHeader, SearchInput, Toolbar,
  type Column, IconRefresh,
} from '@/components/ui';
import { formatDateTime, humanize, plural, shortId } from '@/lib/format';
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

const actionTone = (action: string): 'danger' | 'success' | 'info' | 'neutral' => {
  if (/DELETE|BAN|REJECT|REVOKE/.test(action)) return 'danger';
  if (/CREATE|APPROVE|SETTLED|REFUND/.test(action)) return 'success';
  if (/UPDATE|CHANGE/.test(action)) return 'info';
  return 'neutral';
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
  const [openId, setOpenId] = useState<string | null>(null);

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

  if (!isAuthed) return null; // AppShell shows the session check

  const q = search.trim().toLowerCase();
  const visible = logs.filter(log =>
    !q || [log.action, log.adminId, log.targetId, log.details].some(v => String(v || '').toLowerCase().includes(q))
  );
  const myId = user?.id ? String(user.id) : '';
  const who = (id: string | null) => (myId && id === myId ? 'You' : shortRef(id));
  const open = openId ? logs.find(l => l.id === openId) || null : null;

  const columns: Column<AuditLog>[] = [
    { key: 'time', header: 'Time', width: '150px', sortValue: l => new Date(l.timestamp), cell: l => <span className="whitespace-nowrap text-xs text-fg-muted" title={formatDateTime(l.timestamp)}>{formatDateTime(l.timestamp, { short: true })}</span> },
    { key: 'action', header: 'Action', sortValue: l => l.action || '', cell: l => <Badge tone={actionTone(l.action || '')}>{humanize((l.action || 'UNKNOWN').toLowerCase())}</Badge> },
    { key: 'admin', header: 'Admin', hideBelow: 'md', sortValue: l => l.adminId || '', cell: l => <span className={`text-xs ${myId && l.adminId === myId ? 'text-fg' : 'font-mono text-fg-muted'}`} title={l.adminId || ''}>{who(l.adminId)}</span> },
    { key: 'target', header: 'Target', hideBelow: 'lg', sortValue: l => l.targetId || '', cell: l => <span className="font-mono text-xs text-fg-muted" title={l.targetId || ''}>{shortRef(l.targetId)}</span> },
    { key: 'details', header: 'Details', cell: l => <p className="line-clamp-2 max-w-[480px] break-words text-xs text-fg-muted">{formatDetails(l.details) || '–'}</p> },
  ];

  return (
    <div className="text-fg">
      <PageHeader
        title="Audit log"
        description="Every admin action that changes money, accounts or settings: refunds, payouts, coupons, bans, deletions and more. Newest first."
        actions={<Button leftIcon={<IconRefresh size={14} />} loading={loading} onClick={() => fetchLogs(page)}>Refresh</Button>}
      />

      <Toolbar end={<span className="text-sm tabular-nums text-fg-muted">{plural(total, 'action')} · page {page} of {pages}</span>}>
        <SearchInput value={search} onChange={setSearch} placeholder="Filter this page: action, admin, target, details" className="sm:w-80" />
      </Toolbar>

      <DataTable
        caption="Audit log"
        columns={columns}
        rows={visible}
        rowKey={l => l.id}
        loading={loading}
        error={error}
        onRetry={() => fetchLogs(page)}
        onRowClick={l => setOpenId(l.id)}
        noun="actions"
        // The server pages 100 entries at a time (adminController getAuditLogs default limit).
        pagination={{ page, pages, total, pageSize: 100, onPage: p => fetchLogs(p) }}
        empty={{ title: q ? 'No entries on this page match' : 'No admin actions recorded yet', description: q ? 'The filter only searches the page you are on.' : undefined }}
      />

      <Drawer
        open={!!open}
        onClose={() => setOpenId(null)}
        size="md"
        title={open ? humanize((open.action || 'UNKNOWN').toLowerCase()) : 'Action'}
        description={open ? formatDateTime(open.timestamp) : undefined}
      >
        {open && (
          <div className="space-y-5">
            <DescriptionList
              columns={2}
              items={[
                { label: 'Admin', value: <span className="break-all font-mono text-xs">{myId && open.adminId === myId ? 'You' : open.adminId || '–'}</span> },
                { label: 'Target', value: <span className="break-all font-mono text-xs">{open.targetId || '–'}</span> },
                { label: 'Action code', value: <span className="font-mono text-xs">{open.action || '–'}</span> },
                { label: 'Entry', value: <span className="font-mono text-xs">{shortId(open.id)}</span> },
              ]}
            />
            <div>
              <p className="mb-1 text-xs text-fg-muted">Details</p>
              <div className="rounded-lg border border-line p-3 text-sm">
                {open.details ? <ReadableValue value={open.details} /> : <span className="text-fg-muted">No details recorded.</span>}
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
