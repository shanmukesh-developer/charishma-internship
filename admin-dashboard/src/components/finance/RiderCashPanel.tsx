"use client";
// C6 rider cash: who holds how much COD cash for Zenvy, record a deposit (cash / UPI + reference) or an
// adjustment (reason), per-rider ledger, and the read-only reconciliation check.
// Data: /api/admin/rider-cash, /rider-cash/:id/entries, /rider-cash/:id/deposit|adjust, /rider-cash/reconcile.
import React, { useCallback, useEffect, useState } from 'react';
import { adminRequest } from '@/lib/api';

interface Position { cashHeldPaise: number; zenvyOwesPaise: number; netPaise: number; earningsPaise: number; tipsPaise: number }
interface HoldingRow {
  riderId: string; name: string; phone: string; isOnline: boolean;
  cashHeldPaise: number; overLimit: boolean; depositNeededPaise: number;
  lastDepositAt: string | null; lastEntryAt: string | null; position: Position;
}
interface Holdings {
  limitPaise: number; limitEnabled: boolean; totalHeldPaise: number; overLimitCount: number; ledgerStart: string | null;
  riders: HoldingRow[];
}
interface Entry {
  id: string; type: string; label: string; amountPaise: number; balanceAfterPaise: number; orderId: string | null;
  method: string | null; reference: string | null; reason: string | null; actorType: string; createdAt: string;
}
interface EntriesResp { rider: { id: string; name: string; phone: string }; cashHeldPaise: number; inSync: boolean; ledgerPaise: number; position: Position; entries: Entry[]; page: number; hasMore: boolean }
interface ReconcileResp {
  ok: boolean; checkedAt: string; ledgerStart: string | null; ridersChecked: number; ordersChecked: number; problems: number;
  counts: Record<string, number>;
  mismatches: { riderId: string; name: string | null; heldPaise: number; ledgerPaise: number; differencePaise: number }[];
  withoutHistory: { riderId: string; name: string | null; heldPaise: number }[];
  missingRows: { orderId: string; riderId: string; expectedPaise: number; deliveredAt: string }[];
  duplicateRows: { orderId: string; rows: number }[];
  wrongRows: { orderId: string; rowRiderId: string; rowPaise: number; notACodDelivery?: boolean }[];
}

const rs = (paise: number) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const signed = (paise: number) => `${paise > 0 ? '+' : paise < 0 ? '−' : ''}${rs(Math.abs(paise))}`;
const when = (s: string | null) => (s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export default function RiderCashPanel() {
  const [data, setData] = useState<Holdings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [open, setOpen] = useState<HoldingRow | null>(null);
  const [recon, setRecon] = useState<ReconcileResp | null>(null);
  const [reconLoading, setReconLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await adminRequest<Holdings>('/api/admin/rider-cash'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load rider cash.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const runCheck = async () => {
    setReconLoading(true);
    try { setRecon(await adminRequest<ReconcileResp>('/api/admin/rider-cash/reconcile')); } catch (e) { setNotice({ kind: 'err', text: e instanceof Error ? e.message : 'Check failed.' }); } finally { setReconLoading(false); }
  };

  const recordMissing = async (orderId: string) => {
    const reason = prompt('Record the missing cash row for this COD order? Check with the rider first.\n\nReason (at least 5 characters):');
    if (!reason) return;
    try {
      await adminRequest(`/api/admin/rider-cash/orders/${orderId}/record`, { method: 'POST', body: JSON.stringify({ reason }) });
      setNotice({ kind: 'ok', text: `Cash row recorded for order #${orderId.slice(-6).toUpperCase()}.` });
      runCheck(); load();
    } catch (e) { setNotice({ kind: 'err', text: e instanceof Error ? e.message : 'Could not record it.' }); }
  };

  return (
    <div className="space-y-6">
      {notice && (
        <div className={`p-4 rounded-lg border text-xs font-semibold flex justify-between gap-4 ${notice.kind === 'err' ? 'bg-danger-soft border-danger/30 text-danger-text' : 'bg-success-soft border-success/30 text-success-text'}`}>
          <span>{notice.text}</span><button onClick={() => setNotice(null)} className="text-fg-muted hover:text-fg" aria-label="Dismiss"><span aria-hidden="true" className="text-base leading-none">×</span></button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-lg border border-line bg-surface shadow-xs p-8 bg-warning-soft">
          <p className="text-xs font-semibold text-warning-text mb-2">Cash riders hold for Zenvy</p>
          <h4 className="text-2xl font-semibold text-fg">{data ? rs(data.totalHeldPaise) : '—'}</h4>
        </div>
        <div className="rounded-lg border border-line bg-surface shadow-xs p-8 bg-surface-2/60">
          <p className="text-xs font-semibold text-fg-muted mb-2">COD cash limit</p>
          <h4 className="text-2xl font-semibold text-fg">{data ? (data.limitEnabled ? rs(data.limitPaise) : 'Off') : '—'}</h4>
          <p className="text-xs text-fg-muted mt-1">{data?.limitEnabled ? `${data.overLimitCount} rider(s) at the limit cannot take new COD orders.` : 'Riders are never blocked. Change on Config → Rider cash limit.'}</p>
        </div>
        <div className="rounded-lg border border-line bg-surface shadow-xs p-8 bg-surface-2/60">
          <p className="text-xs font-semibold text-fg-muted mb-2">Ledger started</p>
          <h4 className="text-sm font-semibold text-fg">{data ? when(data.ledgerStart) : '—'}</h4>
          <p className="text-xs text-fg-muted mt-1">Cash held before this is not known: record it with an adjustment.</p>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="p-8 border-b border-line flex flex-wrap gap-4 justify-between items-center">
          <div>
            <h4 className="text-lg font-semibold text-fg">Rider cash holdings</h4>
            <p className="text-xs text-fg-muted mt-1">COD cash collected minus deposits. Payouts never deduct it: collect it with a deposit.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={runCheck} disabled={reconLoading} className="px-4 py-2 bg-surface-2/60 text-fg-muted rounded-xl text-xs font-semibold disabled:opacity-30">{reconLoading ? 'Checking…' : 'Run cash check'}</button>
            <button onClick={load} disabled={loading} className="px-4 py-2 bg-info-soft text-info-text rounded-xl text-xs font-semibold disabled:opacity-30">↻ Refresh</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-2/60">
                {['Rider', 'Cash held', 'Zenvy owes (earnings + tips)', 'Net', 'Last deposit', ''].map((h) => (
                  <th key={h} className="px-6 py-4 text-xs font-semibold text-fg-muted border-b border-line">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.02]">
              {loading ? <tr><td colSpan={6} className="py-12 text-center text-xs text-fg-muted animate-pulse">Loading…</td></tr>
                : error ? <tr><td colSpan={6} className="py-12 text-center text-xs text-danger-text">{error}</td></tr>
                  : !data || data.riders.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-xs text-fg-muted">No rider holds cash yet.</td></tr>
                    : data.riders.map((r) => (
                      <tr key={r.riderId} className="hover:bg-surface-2/60">
                        <td className="px-6 py-4 text-sm font-semibold text-fg">{r.name}<span className="block text-xs text-fg-muted font-mono">{r.phone}</span></td>
                        <td className={`px-6 py-4 text-sm font-semibold ${r.overLimit ? 'text-danger-text' : 'text-warning-text'}`}>{rs(r.cashHeldPaise)}{r.overLimit && <span className="block text-xs">at limit</span>}</td>
                        <td className="px-6 py-4 text-sm text-fg-muted">{rs(r.position.zenvyOwesPaise)}</td>
                        <td className={`px-6 py-4 text-sm font-semibold ${r.position.netPaise < 0 ? 'text-danger-text' : 'text-success-text'}`}>
                          {r.position.netPaise < 0 ? `Rider owes ${rs(-r.position.netPaise)}` : r.position.netPaise > 0 ? `Zenvy owes ${rs(r.position.netPaise)}` : 'Settled'}
                        </td>
                        <td className="px-6 py-4 text-xs text-fg-muted">{when(r.lastDepositAt)}</td>
                        <td className="px-6 py-4"><button onClick={() => setOpen(r)} className="px-4 py-2 bg-success hover:bg-success/90 text-on-solid rounded-lg text-xs font-semibold">Deposit / ledger</button></td>
                      </tr>
                    ))}
            </tbody>
          </table>
        </div>
      </div>

      {recon && (
        <div className="rounded-lg border border-line bg-surface shadow-xs p-8 space-y-3">
          <h4 className="text-lg font-semibold text-fg">Cash check {recon.ok ? <span className="text-success-text">· all good</span> : <span className="text-danger-text">· {recon.problems} problem(s)</span>}</h4>
          <p className="text-xs text-fg-muted">{recon.ridersChecked} rider(s) and {recon.ordersChecked} COD order(s) since {when(recon.ledgerStart)} checked at {when(recon.checkedAt)}. The check never changes anything.</p>
          {recon.mismatches.map((m) => <p key={m.riderId} className="text-xs text-danger-text">{m.name || m.riderId}: cash held {rs(m.heldPaise)} but history sums to {rs(m.ledgerPaise)}.</p>)}
          {recon.withoutHistory.map((m) => <p key={m.riderId} className="text-xs text-danger-text">{m.name || m.riderId}: holds {rs(m.heldPaise)} with no history.</p>)}
          {recon.missingRows.map((m) => (
            <p key={m.orderId} className="text-xs text-danger-text flex items-center gap-3">
              COD order #{m.orderId.slice(-6).toUpperCase()} ({rs(m.expectedPaise)}, {when(m.deliveredAt)}) has no cash row.
              <button onClick={() => recordMissing(m.orderId)} className="px-3 py-1 bg-surface-2 rounded text-xs font-semibold text-fg">Record</button>
            </p>
          ))}
          {recon.duplicateRows.map((m) => <p key={m.orderId} className="text-xs text-danger-text">Order #{m.orderId.slice(-6).toUpperCase()} has {m.rows} cash rows.</p>)}
          {recon.wrongRows.map((m) => <p key={`${m.orderId}-${m.rowRiderId}`} className="text-xs text-danger-text">Order #{m.orderId.slice(-6).toUpperCase()}: {m.notACodDelivery ? 'cash row for an order that is not a delivered COD order' : 'cash row with the wrong rider or amount'} ({rs(m.rowPaise)}).</p>)}
        </div>
      )}

      {open && <RiderCashModal row={open} onClose={() => setOpen(null)} onChanged={(msg) => { setNotice({ kind: 'ok', text: msg }); load(); }} />}
    </div>
  );
}

function RiderCashModal({ row, onClose, onChanged }: { row: HoldingRow; onClose: () => void; onChanged: (msg: string) => void }) {
  const [entries, setEntries] = useState<EntriesResp | null>(null);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'deposit' | 'adjust'>('deposit');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'upi'>('cash');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [key, setKey] = useState(newKey);

  const loadEntries = useCallback(async (p: number) => {
    try {
      setEntries(await adminRequest<EntriesResp>(`/api/admin/rider-cash/${row.riderId}/entries?page=${p}&limit=20`));
      setPage(p);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load the ledger.'); }
  }, [row.riderId]);
  useEffect(() => { loadEntries(1); }, [loadEntries]);

  const submit = async () => {
    setErr(null);
    const n = Number(amount);
    if (!Number.isFinite(n) || n === 0 || (mode === 'deposit' && n < 0)) { setErr(mode === 'deposit' ? 'Enter the amount received (more than ₹0).' : 'Enter a non-zero amount (negative reduces the cash held).'); return; }
    const amountPaise = Math.round(n * 100);
    if (mode === 'deposit' && reference.trim().length < 3) { setErr(method === 'upi' ? 'Enter the UPI reference (UTR).' : 'Enter a receipt number or who received the cash.'); return; }
    if (mode === 'adjust' && reason.trim().length < 5) { setErr('Give a reason (at least 5 characters).'); return; }
    if (!confirm(mode === 'deposit' ? `Record ${rs(amountPaise)} received from ${row.name} by ${method.toUpperCase()} (${reference.trim()})?` : `Adjust ${row.name}'s cash held by ${signed(amountPaise)}?\nReason: ${reason.trim()}`)) return;
    setSaving(true);
    try {
      const body = mode === 'deposit'
        ? { amountPaise, method, reference: reference.trim(), note: reason.trim() || undefined, idempotencyKey: key }
        : { amountPaise, reason: reason.trim(), idempotencyKey: key };
      const res = await adminRequest<{ message: string; cashHeldPaise: number }>(`/api/admin/rider-cash/${row.riderId}/${mode}`, { method: 'POST', body: JSON.stringify(body) });
      onChanged(`${row.name}: ${res.message} Cash held now ${rs(res.cashHeldPaise)}.`);
      setAmount(''); setReference(''); setReason(''); setKey(newKey());
      loadEntries(1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-scrim/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="rounded-lg border border-line bg-surface shadow-xs w-full max-w-3xl max-h-[90vh] overflow-y-auto p-8 space-y-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start gap-4">
          <div>
            <h3 className="text-xl font-semibold text-fg">{row.name}</h3>
            <p className="text-xs text-fg-muted">{row.phone} · Cash held <span className="text-warning-text font-semibold">{rs(entries?.cashHeldPaise ?? row.cashHeldPaise)}</span>{entries && !entries.inSync && <span className="text-danger-text font-semibold"> · history does not match ({rs(entries.ledgerPaise)})</span>}</p>
            {entries && <p className="text-xs text-fg-muted mt-1">Zenvy owes {rs(entries.position.zenvyOwesPaise)} (earnings {rs(entries.position.earningsPaise)} + tips {rs(entries.position.tipsPaise)}) · Net {entries.position.netPaise < 0 ? `rider owes ${rs(-entries.position.netPaise)}` : `Zenvy owes ${rs(entries.position.netPaise)}`}</p>}
          </div>
          <button onClick={onClose} className="text-fg-muted hover:text-fg" aria-label="Dismiss"><span aria-hidden="true" className="text-base leading-none">×</span></button>
        </div>

        <div className="space-y-3 p-5 bg-surface-2/60 border border-line rounded-lg">
          <div className="flex gap-2">
            {(['deposit', 'adjust'] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setErr(null); }} className={`px-4 py-2 rounded-xl text-xs font-semibold ${mode === m ? 'bg-accent text-on-solid' : 'bg-surface-2/60 text-fg-muted'}`}>{m === 'deposit' ? 'Record deposit' : 'Adjustment'}</button>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input type="number" step="0.01" placeholder={mode === 'deposit' ? 'Amount received (₹)' : 'Amount ₹ (+ / −)'} value={amount} onChange={(e) => setAmount(e.target.value)} className="bg-surface-2/60 border border-line rounded-xl p-3 text-fg text-sm" />
            {mode === 'deposit' && (
              <>
                <select value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'upi')} className="bg-surface-2/60 border border-line rounded-xl p-3 text-fg text-sm">
                  <option value="cash">Cash handover</option>
                  <option value="upi">UPI to Zenvy</option>
                </select>
                <input placeholder={method === 'upi' ? 'UPI reference (UTR)' : 'Receipt no. / received by'} value={reference} onChange={(e) => setReference(e.target.value)} className="bg-surface-2/60 border border-line rounded-xl p-3 text-fg text-sm" />
              </>
            )}
          </div>
          <input placeholder={mode === 'deposit' ? 'Note (optional)' : 'Reason (required, shown to the rider)'} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full bg-surface-2/60 border border-line rounded-xl p-3 text-fg text-sm" />
          {err && <p className="text-xs font-semibold text-danger-text">{err}</p>}
          <button onClick={submit} disabled={saving} className="px-6 py-3 bg-success hover:bg-success/90 disabled:opacity-40 rounded-xl text-xs font-semibold text-on-solid">{saving ? 'Saving…' : mode === 'deposit' ? 'Record deposit' : 'Save adjustment'}</button>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-fg mb-3">Cash history</h4>
          {!entries ? <p className="text-xs text-fg-muted">Loading…</p> : entries.entries.length === 0 ? <p className="text-xs text-fg-muted">No cash history yet.</p> : (
            <table className="w-full text-left text-xs">
              <thead><tr className="text-xs text-fg-muted border-b border-line"><th className="py-2">When</th><th>What</th><th>Amount</th><th>Held after</th><th>Details</th></tr></thead>
              <tbody>
                {entries.entries.map((e) => (
                  <tr key={e.id} className="border-b border-line">
                    <td className="py-2 text-fg-muted">{when(e.createdAt)}</td>
                    <td className="text-fg">{e.label}</td>
                    <td className={e.amountPaise < 0 ? 'text-success-text' : 'text-warning-text'}>{signed(e.amountPaise)}</td>
                    <td className="text-fg-muted">{rs(e.balanceAfterPaise)}</td>
                    <td className="text-fg-muted">{[e.orderId ? `#${e.orderId.slice(-6).toUpperCase()}` : null, e.method ? e.method.toUpperCase() : null, e.reference, e.reason].filter(Boolean).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {entries && (entries.page > 1 || entries.hasMore) && (
            <div className="flex gap-2 mt-3">
              <button disabled={page <= 1} onClick={() => loadEntries(page - 1)} className="px-4 py-2 bg-surface-2/60 rounded-xl text-xs font-semibold text-fg-muted disabled:opacity-30">Newer</button>
              <button disabled={!entries.hasMore} onClick={() => loadEntries(page + 1)} className="px-4 py-2 bg-surface-2/60 rounded-xl text-xs font-semibold text-fg-muted disabled:opacity-30">Older</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
