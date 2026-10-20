"use client";
// C5 wallet ledger views: per-owner history (modal) and the read-only reconciliation check.
// Data: GET /api/admin/wallet/:ownerType/:ownerId/transactions and GET /api/admin/wallet/reconcile.
import React, { useCallback, useEffect, useState } from 'react';
import { API_URL } from '@/lib/config';

export type WalletOwnerType = 'user' | 'rider';

interface LedgerRow {
  id: string;
  type: string;
  label: string;
  amount: number;
  amountPaise: number;
  balanceAfter: number;
  ref: { type: string; id: string; label: string | null } | null;
  actorType: string;
  actorId: string | null;
  reason: string | null;
  createdAt: string;
}

interface LedgerResponse {
  owner: { id: string; name: string | null; phone: string | null; walletBalance: number; balancePaise: number };
  ledgerPaise: number;
  inSync: boolean;
  transactions: LedgerRow[];
  page: number;
  hasMore: boolean;
  total: number;
}

interface ReconcileRow {
  ownerType: WalletOwnerType;
  ownerId: string;
  name: string | null;
  phone: string | null;
  balancePaise: number;
  ledgerPaise: number;
  differencePaise: number;
  rows: number;
  ownerMissing?: boolean;
}

interface ReconcileResponse {
  ok: boolean;
  checkedAt: string;
  durationMs: number;
  ownersChecked: number;
  mismatchCount: number;
  withoutHistoryCount: number;
  mismatches: ReconcileRow[];
  withoutHistory: ReconcileRow[];
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  if (res.status === 401) throw new Error('Your session has expired. Please sign in again.');
  if (res.status === 403) throw new Error('You do not have permission to do that.');
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data && typeof data.message === 'string' && data.message.length < 200 ? data.message : fallback);
  return data as T;
}

export function WalletLedgerModal({ ownerType, ownerId, title, onClose }: { ownerType: WalletOwnerType; ownerId: string; title?: string; onClose: () => void }) {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/wallet/${ownerType}/${ownerId}/transactions?page=${p}&limit=50`, { cache: 'no-store' });
      const d = await readJson<LedgerResponse>(res, 'Could not load the wallet history.');
      setData(d);
      setRows((prev) => (p === 1 ? d.transactions : [...prev, ...d.transactions]));
      setPage(p);
    } catch (err) {
      setError(err instanceof TypeError ? 'Could not reach the server. Check your connection.' : (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ownerType, ownerId]);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] bg-scrim/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Wallet history" onClick={onClose}>
      <div className="rounded-lg border border-line bg-surface shadow-xs w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 p-6 border-b border-line">
          <div>
            <h3 className="text-xl font-semibold text-fg">Wallet history</h3>
            <p className="text-xs text-fg-muted font-semibold mt-1">
              {title || data?.owner.name || 'Account'} · {ownerType === 'rider' ? 'Rider' : 'Customer'}{data?.owner.phone ? ` · ${data.owner.phone}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-surface-2 text-fg text-xs font-semibold hover:bg-surface-3">Close</button>
        </div>
        {data && (
          <div className="flex flex-wrap gap-6 px-6 py-4 border-b border-line text-xs font-semibold">
            <span className="text-fg-muted">Balance <span className="text-fg">{rupees(data.owner.balancePaise)}</span></span>
            <span className="text-fg-muted">History total <span className="text-fg">{rupees(data.ledgerPaise)}</span></span>
            <span className="text-fg-muted">{data.total} entries</span>
            {data.inSync
              ? <span className="text-success-text">In sync</span>
              : <span className="text-danger-text">Does not match: {rupees(data.owner.balancePaise - data.ledgerPaise)} unexplained</span>}
          </div>
        )}
        <div className="overflow-auto flex-1">
          {error ? (
            <div role="alert" className="py-12 text-center">
              <p className="text-danger-text font-semibold">{error}</p>
              <button onClick={() => load(1)} className="mt-4 px-6 py-2 rounded-xl bg-surface-2 text-fg text-xs font-semibold hover:bg-surface-3">Retry</button>
            </div>
          ) : rows.length === 0 && !loading ? (
            <p className="py-12 text-center text-fg-muted font-semibold">No wallet changes recorded yet.</p>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-2/60 border-b border-line">
                  {['When', 'What', 'Amount', 'Balance after', 'By / reason'].map((h) => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold text-fg-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.03]">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 text-xs font-semibold text-fg-muted whitespace-nowrap">{new Date(r.createdAt).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-xs font-semibold text-fg">
                      {r.label}
                      <span className="block text-xs text-fg-muted font-semibold">{r.type}{r.ref ? ` · ${r.ref.label || r.ref.type} ${r.ref.id ? r.ref.id.slice(0, 8) : ''}` : ''}</span>
                    </td>
                    <td className={`px-4 py-3 text-sm font-semibold whitespace-nowrap ${r.amount < 0 ? 'text-danger-text' : 'text-success-text'}`}>{signed(r.amount)}</td>
                    <td className="px-4 py-3 text-xs font-semibold text-fg-muted whitespace-nowrap">{rupees(Math.round(r.balanceAfter * 100))}</td>
                    <td className="px-4 py-3 text-xs font-semibold text-fg-muted">
                      <span className="text-xs font-semibold text-fg-muted">{r.actorType}</span>
                      {r.reason ? <span className="block text-fg-muted break-words">{r.reason}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {loading && <p className="py-6 text-center text-fg-subtle font-semibold animate-pulse">Loading…</p>}
        </div>
        {data?.hasMore && !loading && (
          <div className="p-4 border-t border-line text-center">
            <button onClick={() => load(page + 1)} className="px-6 py-2 rounded-xl bg-surface-2 text-fg text-xs font-semibold hover:bg-surface-3">Load older</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Read-only check: every wallet's history total vs its balance. Never fixes anything. */
export function WalletReconcileCard() {
  const [data, setData] = useState<ReconcileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ ownerType: WalletOwnerType; ownerId: string; name: string | null } | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/wallet/reconcile?limit=100`, { cache: 'no-store' });
      setData(await readJson<ReconcileResponse>(res, 'Could not run the wallet check.'));
    } catch (err) {
      setError(err instanceof TypeError ? 'Could not reach the server. Check your connection.' : (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { run(); }, [run]);

  const list = (title: string, items: ReconcileRow[], hint: string) => (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-fg-muted">{title}</h4>
      <p className="text-xs text-fg-muted font-semibold">{hint}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-2/60 border-b border-line">
              {['Account', 'Balance', 'History total', 'Difference', ''].map((h) => (
                <th key={h} className="px-4 py-3 text-xs font-semibold text-fg-muted">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {items.map((m) => (
              <tr key={`${m.ownerType}:${m.ownerId}`}>
                <td className="px-4 py-3 text-xs font-semibold text-fg">
                  {m.name || (m.ownerMissing ? 'Deleted account' : 'Unnamed')}
                  <span className="block text-xs text-fg-muted font-semibold">{m.ownerType === 'rider' ? 'Rider' : 'Customer'}{m.phone ? ` · ${m.phone}` : ''}</span>
                </td>
                <td className="px-4 py-3 text-xs font-semibold text-fg-muted">{rupees(m.balancePaise)}</td>
                <td className="px-4 py-3 text-xs font-semibold text-fg-muted">{rupees(m.ledgerPaise)}</td>
                <td className="px-4 py-3 text-xs font-semibold text-danger-text">{rupees(m.differencePaise)}</td>
                <td className="px-4 py-3 text-right">
                  {!m.ownerMissing && (
                    <button onClick={() => setOpen({ ownerType: m.ownerType, ownerId: m.ownerId, name: m.name })} className="px-3 py-1.5 rounded-lg bg-surface-2 text-fg text-xs font-semibold hover:bg-surface-3">History</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="rounded-lg border border-line bg-surface shadow-xs p-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold text-fg">Wallet check</h3>
          <p className="text-xs text-fg-muted font-semibold mt-1 max-w-2xl">
            Compares every wallet&apos;s balance with the total of its history. It runs by itself every day at 04:30 IST and alerts admins when something is off. It only reports: nothing is ever changed automatically. Fix a real error with a wallet adjustment (with a reason) after checking the history.
          </p>
        </div>
        <button disabled={loading} onClick={run} className="px-5 py-2.5 rounded-xl bg-accent text-accent-fg text-xs font-semibold disabled:opacity-40">{loading ? 'Checking…' : 'Run check now'}</button>
      </div>
      {error && <p role="alert" className="text-danger-text font-semibold">{error}</p>}
      {data && (
        <>
          <div className="flex flex-wrap gap-6 text-xs font-semibold">
            <span className="text-fg-muted">Checked <span className="text-fg">{new Date(data.checkedAt).toLocaleString('en-IN')}</span></span>
            <span className="text-fg-muted">Wallets with history <span className="text-fg">{data.ownersChecked}</span></span>
            <span className={data.mismatchCount ? 'text-danger-text' : 'text-success-text'}>{data.mismatchCount} mismatch{data.mismatchCount === 1 ? '' : 'es'}</span>
            <span className={data.withoutHistoryCount ? 'text-warning-text' : 'text-success-text'}>{data.withoutHistoryCount} without history</span>
          </div>
          {data.ok && <p className="text-success-text font-semibold">All wallets match their history.</p>}
          {data.mismatches.length > 0 && list('Balance differs from history', data.mismatches, 'The balance was changed outside the wallet history (for example a direct database edit). Open the history to see the last recorded balance.')}
          {data.withoutHistory.length > 0 && list('Balance without any history', data.withoutHistory, 'These accounts have money but no history rows. Normally recorded automatically at the next server start or the next wallet change.')}
        </>
      )}
      {open && <WalletLedgerModal ownerType={open.ownerType} ownerId={open.ownerId} title={open.name || undefined} onClose={() => setOpen(null)} />}
    </div>
  );
}
