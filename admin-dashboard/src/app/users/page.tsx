"use client";
import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { API_URL } from '@/lib/config';
import { useLiveSync } from '@/lib/useLiveSync';
import { WalletLedgerModal, WalletReconcileCard } from '@/components/wallet/WalletLedger';

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
  try {
    const parsed = JSON.parse(details);
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed)
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join(' · ');
    }
  } catch { /* plain text */ }
  return details;
}

const isAdminRole = (u: User) => String(u.role || '').toLowerCase() === 'admin';

const money = (n: number | null | undefined) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const UserCard = memo(({ user, busy, isSelf, onToggleElite, onToggleBan, onAdjustWallet, onShowWallet }: {
  user: User;
  busy: boolean;
  /** The signed-in admin's own account. */
  isSelf: boolean;
  onToggleElite: (user: User) => void;
  onToggleBan: (user: User) => void;
  onAdjustWallet: (user: User, amount: number, reason: string) => Promise<boolean>;
  onShowWallet: (user: User) => void;
}) => {
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
    <div className="rounded-lg border border-line bg-surface shadow-xs p-8 relative overflow-hidden border-line hover:border-line transition-all">
      <div className="flex items-start justify-between mb-8">
        <div className="w-14 h-14 rounded-lg bg-surface-2/60 border border-line flex items-center justify-center text-xl font-semibold text-fg relative">
          {(user.name || '?').trim().charAt(0).toUpperCase() || '?'}
          {!user.isActive && <div className="absolute -top-2 -right-2 w-4 h-4 bg-danger rounded-full border-2 border-line" title="Suspended" />}
        </div>
        <div className="flex flex-col gap-2 items-end">
          <button
            disabled={busy}
            onClick={() => onToggleElite(user)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-all disabled:opacity-40 ${user.isElite ? 'bg-accent text-warning-text border-line' : 'bg-surface-2/60 text-fg-muted border-line'}`}
            title={user.isElite ? 'Click to remove Elite' : 'Click to make Elite'}
          >
            {user.isElite ? 'Elite' : 'Standard'}
          </button>
          {(isSelf || isAdminRole(user)) ? (
            <span
              className="px-4 py-1.5 rounded-full text-xs font-semibold border bg-surface-2/60 text-fg-subtle border-line"
              title={isSelf ? 'You cannot suspend your own account.' : 'Admin accounts cannot be suspended from the dashboard.'}
            >
              {isSelf ? 'You' : 'Admin'}
            </span>
          ) : (
          <button
            disabled={busy}
            onClick={() => onToggleBan(user)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-all disabled:opacity-40 ${!user.isActive ? 'bg-danger-soft text-danger-text border-danger/30' : 'bg-surface-2/60 text-fg-muted border-line hover:border-danger/30 hover:text-danger-text'}`}
          >
            {!user.isActive ? 'Suspended · Reactivate' : 'Suspend'}
          </button>
          )}
        </div>
      </div>
      <h4 className="text-xl font-semibold text-fg line-clamp-1">{user.name || 'Unnamed user'}</h4>
      <p className="text-xs text-fg-muted font-semibold">{user.phone || 'No phone'}</p>
      <p className="text-xs text-fg-subtle font-semibold mb-4 truncate">{user.email || 'No email'}</p>

      <label className="block text-xs font-semibold text-fg-muted mb-2" htmlFor={`wallet-${user._id}`}>
        Wallet adjustment (₹, negative to deduct)
      </label>
      <div className="flex gap-2 mb-6">
        <input
          id={`wallet-${user._id}`}
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitWallet(); }}
          className="flex-1 min-w-0 bg-surface-2/60 border border-line rounded-xl px-4 py-2 text-xs text-fg outline-none focus:border-accent transition-all"
          placeholder="e.g. 100 or -50"
        />
        <button
          disabled={busy || !amountValid || !reasonValid}
          onClick={submitWallet}
          className="px-4 py-2 bg-success-soft border border-success/30 rounded-xl text-xs font-semibold text-success-text hover:bg-success/90 hover:text-fg transition-all disabled:opacity-30 disabled:hover:bg-success-soft disabled:hover:text-success-text"
        >
          {busy ? 'Saving…' : 'Apply'}
        </button>
      </div>
      <label className="sr-only" htmlFor={`wallet-reason-${user._id}`}>Reason for the wallet change</label>
      <input
        id={`wallet-reason-${user._id}`}
        type="text"
        value={reason}
        maxLength={300}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submitWallet(); }}
        className="w-full -mt-4 mb-2 bg-surface-2/60 border border-line rounded-xl px-4 py-2 text-xs text-fg outline-none focus:border-accent transition-all"
        placeholder="Reason (required, e.g. refund for missing item)"
        aria-invalid={amount.trim() !== '' && !reasonValid}
      />
      <div className="flex justify-between items-center mb-6">
        <span className={`text-xs font-semibold ${amount.trim() !== '' && !reasonValid ? 'text-warning-text' : 'text-fg-subtle'}`}>
          {amount.trim() !== '' && !reasonValid ? 'Add a reason of at least 5 characters.' : 'Shown to the customer in their wallet history.'}
        </span>
        <button onClick={() => onShowWallet(user)} className="text-xs font-semibold text-warning-text hover:underline">History</button>
      </div>
      <div className="pt-6 border-t border-line flex justify-between items-center text-xs font-semibold">
        <span className="text-fg-muted">{[user.role || 'student', user.hostelBlock].filter(Boolean).join(' · ')}</span>
        <span className="text-fg">{money(user.walletBalance)} wallet</span>
      </div>
    </div>
  );
});
UserCard.displayName = 'UserCard';

export default function UserManagement() {
  const { isAuthed, user: me } = useAdminAuth();
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

  const toggleElite = (user: User) => {
    const next = !user.isElite;
    if (!confirm(`${next ? 'Give' : 'Remove'} Elite status ${next ? 'to' : 'from'} ${user.name || user.phone || 'this user'}?`)) return;
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

  const toggleBan = (user: User) => {
    const suspend = user.isActive;
    if (suspend && (isAdminRole(user) || (me?.id && String(me.id) === String(user._id)))) {
      setNotice({ kind: 'error', text: 'Admin accounts (including your own) cannot be suspended from the dashboard, so the console can never lock itself out.' });
      return;
    }
    if (!confirm(suspend
      ? `Suspend ${user.name || user.phone || 'this user'}? They will not be able to use Zenvy until reactivated.`
      : `Reactivate ${user.name || user.phone || 'this user'}?`)) return;
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

  const adjustWallet = (user: User, amount: number, reason: string) => {
    const current = Number(user.walletBalance || 0);
    if (current + amount < 0) {
      setNotice({ kind: 'error', text: `Cannot deduct ${money(Math.abs(amount))}: ${user.name || 'this user'} only has ${money(current)}.` });
      return Promise.resolve(false);
    }
    const verb = amount > 0 ? `Add ${money(amount)} to` : `Deduct ${money(Math.abs(amount))} from`;
    if (!confirm(`${verb} ${user.name || user.phone || 'this user'}'s wallet?\nReason: ${reason}\nNew balance: ${money(current + amount)}`)) return Promise.resolve(false);
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
  const onShowWallet = useCallback((u: User) => setWalletOf(u), []);

  const filteredUsers = users;

  if (!isAuthed) return <div className="p-20 text-center font-semibold text-fg animate-pulse">Checking access…</div>;

  return (
    <div className="space-y-10 animate-fade-in relative">
      <header className="flex flex-wrap gap-6 justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Customers</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">Customer accounts, wallet balance and bans.</p>
        </div>
        <div className="flex gap-2 bg-surface-2 p-1.5 rounded-lg border border-line">
          <button onClick={() => setActiveTab('roster')} className={`px-6 py-2.5 rounded-xl text-xs font-semibold transition-all ${activeTab === 'roster' ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg'}`}>All users</button>
          <button onClick={() => setActiveTab('audit')} className={`px-6 py-2.5 rounded-xl text-xs font-semibold transition-all ${activeTab === 'audit' ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg'}`}>Admin audit log</button>
          <button onClick={() => setActiveTab('wallet')} className={`px-6 py-2.5 rounded-xl text-xs font-semibold transition-all ${activeTab === 'wallet' ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg'}`}>Wallet check</button>
        </div>
      </header>

      {notice && (
        <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`flex items-center justify-between gap-4 rounded-lg border px-6 py-4 text-sm font-semibold ${notice.kind === 'error' ? 'border-danger/30 bg-danger-soft text-danger-text' : 'border-success/30 bg-success-soft text-success-text'}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-xs text-fg-muted hover:text-fg">Dismiss</button>
        </div>
      )}

      {walletOf && <WalletLedgerModal ownerType="user" ownerId={walletOf._id} title={walletOf.name || walletOf.phone || undefined} onClose={() => setWalletOf(null)} />}

      {activeTab === 'wallet' ? (
        <WalletReconcileCard />
      ) : activeTab === 'roster' ? (
        <div className="rounded-lg border border-line bg-surface shadow-xs p-6">
          <div className="flex flex-col md:flex-row gap-3 md:items-center mb-10">
            <input type="text" placeholder="Search all users by name, email or phone…" className="flex-1 bg-surface-2/60 border border-line rounded-lg py-4 px-8 text-fg font-semibold outline-none" value={search} onChange={(e) => setSearch(e.target.value)} />
            <span className="text-xs font-semibold text-fg-muted">{totalUsers} accounts</span>
          </div>

          {loadError ? (
            <div role="alert" className="py-16 text-center">
              <p className="text-danger-text font-semibold">{loadError}</p>
              <button onClick={() => fetchUsers(userPage)} className="mt-4 px-6 py-2 rounded-xl bg-surface-2 text-fg text-xs font-semibold hover:bg-surface-3">Retry</button>
            </div>
          ) : loading ? (
            <div className="py-20 text-center animate-pulse text-fg-subtle font-semibold">Loading users…</div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-20 text-center text-fg-muted font-semibold">{search.trim() ? 'No users match this search.' : 'No users yet.'}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filteredUsers.map((user) => (
                <UserCard
                  key={user._id}
                  user={user}
                  busy={busyId === user._id}
                  isSelf={!!me?.id && String(me.id) === String(user._id)}
                  onToggleElite={onToggleElite}
                  onToggleBan={onToggleBan}
                  onAdjustWallet={onAdjustWallet}
                  onShowWallet={onShowWallet}
                />
              ))}
            </div>
          )}

          {userPages > 1 && (
            <div className="mt-10 flex items-center justify-between bg-surface-2/60 p-6 rounded-lg border border-line">
              <span className="text-xs font-semibold text-fg-muted">Page {userPage} / {userPages} ({totalUsers} total)</span>
              <div className="flex gap-2">
                <button disabled={loading || userPage <= 1} onClick={() => fetchUsers(userPage - 1)} className="px-5 py-2 bg-surface-2 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:text-fg disabled:opacity-30">Prev</button>
                <button disabled={loading || userPage >= userPages} onClick={() => fetchUsers(userPage + 1)} className="px-5 py-2 bg-surface-2 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:text-fg disabled:opacity-30">Next</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          {logsError ? (
            <div role="alert" className="py-16 text-center">
              <p className="text-danger-text font-semibold">{logsError}</p>
              <button onClick={() => fetchLogs(logPage)} className="mt-4 px-6 py-2 rounded-xl bg-surface-2 text-fg text-xs font-semibold hover:bg-surface-3">Retry</button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-2/60 border-b border-line">
                    <th className="px-8 py-5 text-xs font-semibold text-fg-muted">Time</th>
                    <th className="px-8 py-5 text-xs font-semibold text-fg-muted">Action</th>
                    <th className="px-8 py-5 text-xs font-semibold text-fg-muted">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line text-fg">
                  {logsLoading ? (
                    <tr><td colSpan={3} className="px-8 py-16 text-center text-fg-subtle animate-pulse font-semibold">Loading audit log…</td></tr>
                  ) : logs.length === 0 ? (
                    <tr><td colSpan={3} className="px-8 py-16 text-center text-fg-muted font-semibold">No admin actions recorded yet.</td></tr>
                  ) : logs.map((log, i) => (
                    <tr key={log._id || log.id || i} className="hover:bg-surface-2/60">
                      <td className="px-8 py-5 text-xs font-semibold text-fg-muted whitespace-nowrap">{log.timestamp ? new Date(log.timestamp).toLocaleString() : '—'}</td>
                      <td className="px-8 py-5"><span className="px-2 py-1 bg-info-soft text-info-text rounded-md text-xs font-semibold">{log.action.replaceAll('_', ' ')}</span></td>
                      <td className="px-8 py-5 text-sm font-semibold text-fg-muted break-all">{formatDetails(log.details)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {logPages > 1 && (
            <div className="p-6 bg-surface-2/60 border-t border-line flex items-center justify-between">
              <span className="text-xs font-semibold text-fg-muted">Page {logPage} / {logPages} ({totalLogs} entries)</span>
              <div className="flex gap-2">
                <button disabled={logsLoading || logPage <= 1} onClick={() => fetchLogs(logPage - 1)} className="px-5 py-2 bg-surface-2 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:text-fg disabled:opacity-30">Previous</button>
                <button disabled={logsLoading || logPage >= logPages} onClick={() => fetchLogs(logPage + 1)} className="px-5 py-2 bg-surface-2 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:text-fg disabled:opacity-30">Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
