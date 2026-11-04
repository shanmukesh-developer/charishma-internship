"use client";
import { readableText } from '@/components/ui/Readable';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { API_URL } from '@/lib/config';
import { useLiveSync } from '@/lib/useLiveSync';
import { WalletLedgerModal, WalletReconcileCard } from '@/components/wallet/WalletLedger';
import {
  Badge, Button, DataTable, DescriptionList, Drawer, Field, Input, Notice as NoticeBox, PageHeader, SearchInput, Tabs, Toolbar,
  useConfirm, type Column, IconHistory, ButtonLink, IconDownload,
} from '@/components/ui';
import { formatDateTime, formatINR, formatPhone, humanize } from '@/lib/format';

interface User {
  _id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role?: string | null;
  hostelBlock?: string | null;
  isElite: boolean;
  isActive: boolean;
  walletBalance: number | null;
}

interface AuditLog {
  _id?: string;
  id?: string;
  action: string;
  details: string | null;
  targetId?: string | null;
  timestamp: string;
}

type Notice = { kind: 'ok' | 'error'; text: string } | null;

const FRIENDLY_FALLBACK = 'Something went wrong. Please try again.';

/** Reads a friendly `message` from an error response, never raw HTML/stack text. */
async function readError(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) return 'Your session has expired. Please sign in again.';
  if (res.status === 403) return 'You do not have permission to do that.';
  if (res.status >= 500) return 'The server had a problem. Please try again in a moment.';
  const data = await res.json().catch(() => null);
  return data && typeof data.message === 'string' && data.message.length < 200 ? data.message : fallback;
}

/** Audit `details` is stored as a JSON string; show it as readable key: value pairs. */
function formatDetails(details: string | null): string {
  if (!details) return '—';
  return readableText(details);
}

const isAdminRole = (u: User) => String(u.role || '').toLowerCase() === 'admin';

/** CSV cell: spreadsheet formula injection guarded ("=HYPERLINK(...)" stays text), quotes escaped. */
const csvCell = (v: unknown) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const downloadCsv = (name: string, head: string[], rows: unknown[][]) => {
  const csv = [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};


const money = (n: number | null | undefined) => formatINR(Number(n || 0));

/** Admin wallet change: amount (negative deducts) and a reason the customer sees (same rules as before). */
function WalletAdjustForm({ user, busy, onAdjustWallet }: {
  user: User;
  busy: boolean;
  onAdjustWallet: (user: User, amount: number, reason: string) => Promise<boolean>;
}) {
  const [amount, setAmount] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const parsed = Number(amount);
  const amountValid = amount.trim() !== '' && Number.isFinite(parsed) && parsed !== 0 && Math.abs(parsed) <= 10000;
  // C5: every admin wallet change needs a reason (saved in the wallet history + audit log).
  const reasonValid = reason.trim().length >= 5 && reason.trim().length <= 300;

  const submitWallet = async () => {
    if (!amountValid || !reasonValid || busy) return;
    const ok = await onAdjustWallet(user, parsed, reason.trim());
    if (ok) { setAmount(''); setReason(''); }
  };

  return (
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); submitWallet(); }} noValidate>
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Field label="Amount" hint="Negative to deduct. Up to ₹10,000." error={amount.trim() !== '' && !amountValid ? 'Enter a non-zero amount up to ₹10,000.' : undefined}>
          <Input prefix="₹" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="100 or -50" />
        </Field>
        <Field label="Reason" hint="Shown to the customer in their wallet history." error={amount.trim() !== '' && !reasonValid ? 'Add a reason of at least 5 characters.' : undefined}>
          <Input value={reason} maxLength={300} onChange={e => setReason(e.target.value)} placeholder="For example, refund for a missing item" />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={!amountValid || !reasonValid} loading={busy}>Apply change</Button>
      </div>
    </form>
  );
}

export default function UserManagement() {
  const { isAuthed, user: me } = useAdminAuth();
  const confirm = useConfirm();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [userPages, setUserPages] = useState(1);
  const [userPage, setUserPage] = useState(1);

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [logPages, setLogPages] = useState(1);
  const [logPage, setLogPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [search, setSearch] = useState('');
  // ?search=<name or phone> from the global search prefills the server search.
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('search');
    if (s) setSearch(s);
  }, []);
  const [activeTab, setActiveTab] = useState<'roster' | 'audit' | 'wallet'>('roster');
  const [walletOf, setWalletOf] = useState<User | null>(null);

  // The search runs on the server (name, phone or email across ALL users), not just the loaded page.
  const searchRef = useRef('');
  // quiet = background refresh (realtime event): keep the table on screen instead of a spinner.
  const fetchUsers = useCallback(async (page = 1, quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError(null);
    try {
      const q = searchRef.current.trim();
      const res = await fetch(`${API_URL}/api/admin/users?page=${page}${q ? `&search=${encodeURIComponent(q)}` : ''}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(await readError(res, 'Could not load users.'));
      const data = await res.json();
      setUsers(Array.isArray(data.users) ? data.users : []);
      setTotalUsers(data.total || 0);
      setUserPages(Math.max(1, data.pages || 1));
      setUserPage(page);
    } catch (err) {
      if (!quiet) setLoadError(err instanceof TypeError ? 'Could not reach the server. Check your connection.' : (err as Error).message || FRIENDLY_FALLBACK);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const logsLoaded = useRef(false);
  const fetchLogs = useCallback(async (page = 1) => {
    setLogsLoading(true);
    setLogsError(null);
    try {
      logsLoaded.current = true;
      const res = await fetch(`${API_URL}/api/admin/audit?page=${page}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(await readError(res, 'Could not load the audit log.'));
      const data = await res.json();
      // The backend returns { logs, total, pages } (100 per page); a plain array (older backends) is still accepted.
      if (Array.isArray(data)) {
        setLogs(data);
        setTotalLogs(data.length);
        setLogPages(1);
        setLogPage(1);
      } else {
        setLogs(Array.isArray(data.logs) ? data.logs : []);
        setTotalLogs(data.total || 0);
        setLogPages(Math.max(1, data.pages || 1));
        setLogPage(page);
      }
    } catch (err) {
      setLogsError(err instanceof TypeError ? 'Could not reach the server. Check your connection.' : (err as Error).message || FRIENDLY_FALLBACK);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    fetchUsers(1);
  }, [isAuthed, fetchUsers]);

  // The audit log is a separate tab: load it the first time that tab is opened, not on every visit.
  useEffect(() => {
    if (isAuthed && activeTab === 'audit' && !logsLoaded.current) fetchLogs(1);
  }, [isAuthed, activeTab, fetchLogs]);

  // Realtime sync: another admin (or the app) changed a user; quietly refetch the page being shown.
  useLiveSync(['user'], () => { fetchUsers(userPage, true); }, { enabled: isAuthed, debounceMs: 1000 });

  // Debounced server-side search: typing re-queries page 1 with ?search=.
  useEffect(() => {
    if (!isAuthed) return;
    const q = search.trim();
    if (q === searchRef.current.trim()) return;
    const t = setTimeout(() => {
      searchRef.current = q;
      fetchUsers(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search, isAuthed, fetchUsers]);

  const patchUser = (id: string, patch: Partial<User>) =>
    setUsers(prev => prev.map(u => (u._id === id ? { ...u, ...patch } : u)));

  const runAction = async (user: User, request: () => Promise<Response>, onSuccess: (data: any) => void, successText: string, failText: string) => {
    if (busyId) return false;
    setBusyId(user._id);
    setNotice(null);
    try {
      const res = await request();
      if (!res.ok) throw new Error(await readError(res, failText));
      const data = await res.json().catch(() => ({}));
      onSuccess(data);
      setNotice({ kind: 'ok', text: successText });
      if (logsLoaded.current) fetchLogs(logPage);
      return true;
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof TypeError ? 'Could not reach the server. Nothing was changed.' : (err as Error).message || failText });
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const toggleElite = async (user: User) => {
    const next = !user.isElite;
    if (!(await confirm({ title: `${next ? 'Give' : 'Remove'} Elite status ${next ? 'to' : 'from'} ${user.name || user.phone || 'this user'}?`, description: next ? 'Elite members get the perks set for Elite in the app.' : 'They go back to a standard account.', confirmLabel: next ? 'Make Elite' : 'Remove Elite' }))) return;
    runAction(
      user,
      () => fetch(`${API_URL}/api/admin/users/${user._id}/elite`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isElite: next }),
      }),
      () => patchUser(user._id, { isElite: next }),
      `${user.name || 'User'} is now ${next ? 'Elite' : 'Standard'}.`,
      'Could not change Elite status.'
    );
  };

  const toggleBan = async (user: User) => {
    const suspend = user.isActive;
    if (suspend && (isAdminRole(user) || (me?.id && String(me.id) === String(user._id)))) {
      setNotice({ kind: 'error', text: 'Admin accounts (including your own) cannot be suspended from the dashboard, so the console can never lock itself out.' });
      return;
    }
    if (!(await confirm(suspend
      ? { title: `Suspend ${user.name || user.phone || 'this user'}?`, description: 'They will not be able to use ZENV until they are reactivated.', confirmLabel: 'Suspend', tone: 'danger' }
      : { title: `Reactivate ${user.name || user.phone || 'this user'}?`, description: 'They can use ZENV again straight away.', confirmLabel: 'Reactivate' }))) return;
    runAction(
      user,
      () => fetch(`${API_URL}/api/admin/users/${user._id}/ban`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !suspend }),
      }),
      () => patchUser(user._id, { isActive: !suspend }),
      `${user.name || 'User'} ${suspend ? 'suspended' : 'reactivated'}.`,
      `Could not ${suspend ? 'suspend' : 'reactivate'} this user.`
    );
  };

  const adjustWallet = async (user: User, amount: number, reason: string): Promise<boolean> => {
    const current = Number(user.walletBalance || 0);
    if (current + amount < 0) {
      setNotice({ kind: 'error', text: `Cannot deduct ${money(Math.abs(amount))}: ${user.name || 'this user'} only has ${money(current)}.` });
      return false;
    }
    const verb = amount > 0 ? `Add ${money(amount)} to` : `Deduct ${money(Math.abs(amount))} from`;
    if (!(await confirm({ title: `${verb} ${user.name || user.phone || 'this user'}'s wallet?`, description: `Reason: ${reason}. New balance: ${money(current + amount)}. The customer sees this in their wallet history.`, confirmLabel: amount > 0 ? 'Add money' : 'Deduct money', tone: amount > 0 ? 'default' : 'danger' }))) return false;
    // One key per confirmed change: a retried / double-sent request is applied once.
    const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return runAction(
      user,
      () => fetch(`${API_URL}/api/admin/users/${user._id}/wallet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ amount, reason }),
      }),
      (data) => patchUser(user._id, { walletBalance: typeof data.walletBalance === 'number' ? data.walletBalance : current + amount }),
      `Wallet updated for ${user.name || 'user'}.`,
      'Could not update the wallet.'
    );
  };

  // Stable handler identities so the memoized UserCards do not all re-render on every keystroke
  // in the search box (the handlers themselves change every render).
  const handlersRef = useRef({ toggleElite, toggleBan, adjustWallet });
  handlersRef.current = { toggleElite, toggleBan, adjustWallet };
  const onToggleElite = useCallback((u: User) => handlersRef.current.toggleElite(u), []);
  const onToggleBan = useCallback((u: User) => handlersRef.current.toggleBan(u), []);
  const onAdjustWallet = useCallback((u: User, amount: number, reason: string) => handlersRef.current.adjustWallet(u, amount, reason), []);

  const filteredUsers = users;

  if (!isAuthed) return null; // AppShell shows the session check

  const detail = detailId ? users.find(u => u._id === detailId) || null : null;
  const detailIsSelf = !!detail && !!me?.id && String(me.id) === String(detail._id);
  const detailProtected = !!detail && (detailIsSelf || isAdminRole(detail));

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: 'Customer',
      sortValue: u => u.name || '',
      cell: u => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-fg-muted">{(u.name || '?').trim().charAt(0).toUpperCase() || '?'}</span>
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{u.name || 'Unnamed user'}</p>
            <p className="truncate text-xs text-fg-muted">{u.email || 'No email'}</p>
          </div>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', cell: u => <span className="tabular-nums text-fg">{u.phone ? formatPhone(u.phone) : '–'}</span> },
    { key: 'block', header: 'Hostel block', hideBelow: 'xl', sortValue: u => u.hostelBlock || '', cell: u => <span className="text-fg-muted">{u.hostelBlock || '–'}</span> },
    {
      key: 'type',
      header: 'Account',
      hideBelow: 'lg',
      sortValue: u => (u.isElite ? 0 : 1),
      cell: u => (
        <div className="flex flex-wrap gap-1">
          {isAdminRole(u) ? <Badge tone="accent">Admin</Badge> : <Badge>{humanize(u.role || 'student')}</Badge>}
          {u.isElite && <Badge tone="warning">Elite</Badge>}
        </div>
      ),
    },
    { key: 'status', header: 'Status', sortValue: u => (u.isActive ? 1 : 0), cell: u => (u.isActive ? <Badge tone="success" dot>Active</Badge> : <Badge tone="danger" dot>Suspended</Badge>) },
    { key: 'wallet', header: 'Wallet', align: 'right', sortValue: u => Number(u.walletBalance || 0), cell: u => <span className="font-medium tabular-nums text-fg">{money(u.walletBalance)}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Customer accounts: find someone, adjust their wallet, change Elite status or suspend an account."
      >
        <Tabs
          ariaLabel="Customers sections"
          value={activeTab}
          onChange={setActiveTab}
          tabs={[
            { id: 'roster', label: 'All customers', count: totalUsers || null },
            { id: 'audit', label: 'Admin audit log' },
            { id: 'wallet', label: 'Wallet check' },
          ]}
        />
      </PageHeader>

      {notice && (
        <NoticeBox tone={notice.kind === 'error' ? 'danger' : 'success'} className="mb-4" onClose={() => setNotice(null)}>
          <span className="text-fg">{notice.text}</span>
        </NoticeBox>
      )}

      {walletOf && <WalletLedgerModal ownerType="user" ownerId={walletOf._id} title={walletOf.name || walletOf.phone || undefined} onClose={() => setWalletOf(null)} />}

      {activeTab === 'wallet' ? (
        <WalletReconcileCard />
      ) : activeTab === 'roster' ? (
        <>
          <Toolbar end={
            <>
              <span className="text-sm tabular-nums text-fg-muted">{totalUsers.toLocaleString('en-IN')} accounts</span>
              <Button
                leftIcon={<IconDownload size={14} />}
                disabled={filteredUsers.length === 0}
                onClick={() => downloadCsv(`zenv_customers_page${userPage}_${new Date().toISOString().slice(0, 10)}.csv`,
                  ['Customer ID', 'Name', 'Phone', 'Email', 'Hostel block', 'Account', 'Elite', 'Status', 'Wallet (INR)'],
                  filteredUsers.map(u => [u._id, u.name || '', u.phone || '', u.email || '', u.hostelBlock || '', u.role || 'student', u.isElite ? 'Yes' : 'No', u.isActive ? 'Active' : 'Suspended', Number(u.walletBalance || 0)]))}
              >
                Export page (CSV)
              </Button>
            </>
          }>
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, phone or email" className="sm:w-80" />
          </Toolbar>
          <DataTable
            caption="Customers"
            columns={columns}
            rows={filteredUsers}
            rowKey={u => u._id}
            loading={loading}
            error={loadError}
            onRetry={() => fetchUsers(userPage)}
            onRowClick={u => setDetailId(u._id)}
            pagination={{ page: userPage, pages: userPages, total: totalUsers, onPage: p => fetchUsers(p) }}
            noun="customers"
            empty={{ title: search.trim() ? 'No customers match' : 'No customers yet', description: search.trim() ? 'The search looks at every customer’s name, phone and email.' : undefined }}
          />
        </>
      ) : (
        <DataTable
          caption="Admin audit log"
          columns={[
            { key: 'time', header: 'Time', width: '190px', cell: (log: AuditLog) => <span className="whitespace-nowrap text-xs text-fg-muted">{log.timestamp ? formatDateTime(log.timestamp) : '–'}</span> },
            { key: 'action', header: 'Action', width: '220px', cell: (log: AuditLog) => <Badge tone="info">{humanize(log.action)}</Badge> },
            { key: 'details', header: 'Details', cell: (log: AuditLog) => <span className="break-all text-sm text-fg-muted">{formatDetails(log.details)}</span> },
          ]}
          rows={logs}
          rowKey={(log, i) => String(log._id || log.id || i)}
          loading={logsLoading}
          error={logsError}
          onRetry={() => fetchLogs(logPage)}
          pagination={{ page: logPage, pages: logPages, total: totalLogs, onPage: p => fetchLogs(p) }}
          noun="entries"
          empty={{ title: 'No admin actions recorded yet' }}
        />
      )}

      {/* Customer details */}
      <Drawer
        open={!!detail}
        onClose={() => setDetailId(null)}
        size="lg"
        title={detail?.name || 'Unnamed user'}
        description={detail ? [detail.phone ? formatPhone(detail.phone) : null, detail.email].filter(Boolean).join(' · ') || undefined : undefined}
        headerActions={detail ? (detail.isActive ? <Badge tone="success" dot>Active</Badge> : <Badge tone="danger" dot>Suspended</Badge>) : undefined}
      >
        {detail && (
          <div className="space-y-6">
            <DescriptionList
              columns={2}
              items={[
                { label: 'Wallet balance', value: <span className="text-base font-semibold tabular-nums">{money(detail.walletBalance)}</span> },
                { label: 'Account', value: `${isAdminRole(detail) ? 'Admin' : humanize(detail.role || 'student')}${detail.isElite ? ', Elite' : ''}` },
                { label: 'Hostel block', value: detail.hostelBlock || '–' },
                { label: 'Customer ID', value: <span className="break-all font-mono text-xs">{detail._id}</span> },
              ]}
            />

            <div className="flex flex-wrap gap-2">
              <ButtonLink size="sm" href={`/orders?customer=${encodeURIComponent(detail._id)}&name=${encodeURIComponent(detail.name || detail.phone || 'Customer')}`}>Orders</ButtonLink>
              {detail.phone && <ButtonLink size="sm" href={`/tickets?search=${encodeURIComponent(String(detail.phone).replace(/\D/g, '').slice(-10))}`}>Support tickets</ButtonLink>}
            </div>

            <section className="space-y-3 rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-fg">Adjust wallet</h3>
                <Button size="sm" variant="ghost" leftIcon={<IconHistory size={14} />} onClick={() => setWalletOf(detail)}>Wallet history</Button>
              </div>
              <WalletAdjustForm key={detail._id} user={detail} busy={busyId === detail._id} onAdjustWallet={onAdjustWallet} />
            </section>

            <section className="space-y-3 rounded-lg border border-line p-4">
              <h3 className="text-sm font-semibold text-fg">Membership and access</h3>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-fg">{detail.isElite ? 'Elite member' : 'Standard account'}</p>
                  <p className="text-xs text-fg-muted">Elite members get the Elite perks in the app.</p>
                </div>
                <Button size="sm" disabled={busyId === detail._id} onClick={() => onToggleElite(detail)}>{detail.isElite ? 'Remove Elite' : 'Make Elite'}</Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                <div>
                  <p className="text-sm text-fg">{detail.isActive ? 'Account active' : 'Account suspended'}</p>
                  <p className="text-xs text-fg-muted">
                    {detailProtected
                      ? (detailIsSelf ? 'You cannot suspend your own account.' : 'Admin accounts cannot be suspended from the dashboard.')
                      : detail.isActive ? 'Suspending stops them from using ZENV until reactivated.' : 'Reactivating lets them use ZENV again.'}
                  </p>
                </div>
                {!detailProtected && (
                  <Button size="sm" variant={detail.isActive ? 'destructive' : 'primary'} disabled={busyId === detail._id} onClick={() => onToggleBan(detail)}>
                    {detail.isActive ? 'Suspend' : 'Reactivate'}
                  </Button>
                )}
              </div>
            </section>
          </div>
        )}
      </Drawer>
    </div>
  );
}
