"use client";
// C6 payout statements: partners with unpaid orders -> preview a statement for a period -> save it
// (PENDING, its orders are claimed) -> mark paid with the UTR (required) or cancel; history + CSV.
// Data: /api/admin/payouts/pending, /payouts/preview, POST /payouts, /payouts/:id/mark-paid|cancel, GET /payouts.
import React, { useCallback, useEffect, useState } from 'react';
import { adminRequest } from '@/lib/api';

type PartnerType = 'restaurant' | 'vendor' | 'rider';
interface PendingRow {
  partnerType: PartnerType; partnerId: string; partnerName: string; phone?: string; orders: number; oldestDeliveredAt: string | null;
  grossPaise: number; commissionPaise: number; adjustmentsPaise: number; tipsPaise: number; netPaise: number; cashHeldPaise?: number;
}
interface Statement {
  partnerType: PartnerType; partnerId: string; partnerName: string; periodStart: string | null; periodEnd: string; orderCount: number;
  grossPaise: number; commissionPaise: number; adjustmentsPaise: number; tipsPaise: number; netPaise: number; cashHeldPaise?: number;
  breakdown?: { rule?: string; stallCashCollectedPaise?: number };
}
interface PayoutRow extends Statement { id: string; status: 'PENDING' | 'PAID' | 'CANCELLED'; method: string | null; utr: string | null; paidAt: string | null; notes: string | null; createdAt: string }

const rs = (paise: number) => `${paise < 0 ? '−' : ''}₹${(Math.abs(Number(paise || 0)) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const csvCell = (v: unknown) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const TYPE_LABEL: Record<PartnerType, string> = { restaurant: 'Restaurants', vendor: 'Stalls (vendors)', rider: 'Riders' };

export default function PayoutsPanel() {
  const [ptype, setPtype] = useState<PartnerType>('restaurant');
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [pendingErr, setPendingErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<PayoutRow[]>([]);
  const [histStatus, setHistStatus] = useState<'' | 'PENDING' | 'PAID' | 'CANCELLED'>('');
  const [histErr, setHistErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [target, setTarget] = useState<PendingRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadPending = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminRequest<{ partners: PendingRow[] }>(`/api/admin/payouts/pending?partnerType=${ptype}`);
      setPending((r.partners || []).filter((p) => p.orders > 0 || p.tipsPaise > 0));
      setPendingErr(null);
    } catch (e) { setPendingErr(e instanceof Error ? e.message : 'Could not load.'); } finally { setLoading(false); }
  }, [ptype]);
  const loadHistory = useCallback(async () => {
    try {
      const q = new URLSearchParams({ partnerType: ptype, limit: '200', ...(histStatus ? { status: histStatus } : {}) });
      const r = await adminRequest<{ payouts: PayoutRow[] }>(`/api/admin/payouts?${q}`);
      setHistory(r.payouts || []);
      setHistErr(null);
    } catch (e) { setHistErr(e instanceof Error ? e.message : 'Could not load history.'); }
  }, [ptype, histStatus]);
  useEffect(() => { loadPending(); }, [loadPending]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const markPaid = async (p: PayoutRow) => {
    const utr = prompt(`Mark ${rs(p.netPaise)} to ${p.partnerName} as ${p.netPaise < 0 ? 'settled (received from them)' : 'paid'}?\n\nEnter the UTR / payment reference (required):`);
    if (utr === null) return;
    if (utr.trim().length < 3) { setNotice({ kind: 'err', text: 'A UTR / payment reference (at least 3 characters) is required.' }); return; }
    const method = (prompt('Method: bank, upi, cash or other', 'bank') || 'bank').trim().toLowerCase();
    setBusy(p.id);
    try {
      await adminRequest(`/api/admin/payouts/${p.id}/mark-paid`, { method: 'POST', body: JSON.stringify({ utr: utr.trim(), method }) });
      setNotice({ kind: 'ok', text: `${p.partnerName}: ${rs(p.netPaise)} marked paid (UTR ${utr.trim()}).` });
      loadHistory(); loadPending();
    } catch (e) { setNotice({ kind: 'err', text: e instanceof Error ? e.message : 'Could not mark paid.' }); } finally { setBusy(null); }
  };
  const cancel = async (p: PayoutRow) => {
    const reason = prompt(`Cancel this statement for ${p.partnerName}? Its ${p.orderCount} order(s) go back to unpaid.\n\nReason (at least 5 characters):`);
    if (!reason) return;
    setBusy(p.id);
    try {
      await adminRequest(`/api/admin/payouts/${p.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
      setNotice({ kind: 'ok', text: 'Statement cancelled.' });
      loadHistory(); loadPending();
    } catch (e) { setNotice({ kind: 'err', text: e instanceof Error ? e.message : 'Could not cancel.' }); } finally { setBusy(null); }
  };

  const exportCsv = () => {
    if (!history.length) return;
    const head = ['Statement', 'Partner type', 'Partner', 'Period start', 'Period end', 'Orders', 'Gross (INR)', 'Commission (INR)', 'Adjustments (INR)', 'Tips (INR)', 'Net (INR)', 'Status', 'Method', 'UTR', 'Paid at', 'Created'];
    const rows = history.map((p) => [p.id, p.partnerType, p.partnerName, p.periodStart ? new Date(p.periodStart).toISOString().slice(0, 10) : '', new Date(p.periodEnd).toISOString().slice(0, 10), p.orderCount,
      p.grossPaise / 100, p.commissionPaise / 100, p.adjustmentsPaise / 100, p.tipsPaise / 100, p.netPaise / 100, p.status, p.method || '', p.utr || '', p.paidAt ? new Date(p.paidAt).toISOString() : '', new Date(p.createdAt).toISOString()]);
    const csv = [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `zenvy_payouts_${ptype}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {notice && (
        <div className={`p-4 rounded-lg border text-xs font-semibold flex justify-between gap-4 ${notice.kind === 'err' ? 'bg-danger-soft border-danger/30 text-danger-text' : 'bg-success-soft border-success/30 text-success-text'}`}>
          <span>{notice.text}</span><button onClick={() => setNotice(null)} className="text-fg-muted hover:text-fg" aria-label="Dismiss"><span aria-hidden="true" className="text-base leading-none">×</span></button>
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        {(Object.keys(TYPE_LABEL) as PartnerType[]).map((t) => (
          <button key={t} onClick={() => setPtype(t)} className={`px-4 py-2 rounded-xl text-xs font-semibold ${ptype === t ? 'bg-accent text-on-solid' : 'bg-surface-2/60 text-fg-muted hover:text-fg'}`}>{TYPE_LABEL[t]}</button>
        ))}
      </div>

      <div className="glass-card overflow-hidden">
        <div className="p-8 border-b border-line flex flex-wrap gap-4 justify-between items-center">
          <div>
            <h4 className="text-lg font-semibold text-fg">Not yet on a statement</h4>
            <p className="text-xs text-fg-muted mt-1">
              {ptype === 'rider'
                ? 'Earnings (delivery fee, ₹30 when the fee is 0) + tips. Cash the rider holds is NOT deducted: collect it under Rider cash.'
                : 'Item subtotal minus the commission fixed when each order was placed' + (ptype === 'vendor' ? '; minus the cash the stall collected itself (negative = the stall owes Zenvy).' : '.')}
            </p>
          </div>
          <button onClick={loadPending} disabled={loading} className="px-4 py-2 bg-info-soft text-info-text rounded-xl text-xs font-semibold disabled:opacity-30">↻ Refresh</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead><tr className="bg-surface-2/60">
              {['Partner', 'Orders', 'Since', 'Gross', ptype === 'rider' ? 'Tips' : 'Commission', ptype === 'vendor' ? 'Cash they kept' : '', 'Net', ''].map((h, i) => (
                <th key={i} className="px-6 py-4 text-xs font-semibold text-fg-muted border-b border-line">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-white/[0.02]">
              {loading ? <tr><td colSpan={8} className="py-12 text-center text-xs text-fg-muted animate-pulse">Loading…</td></tr>
                : pendingErr ? <tr><td colSpan={8} className="py-12 text-center text-xs text-danger-text">{pendingErr}</td></tr>
                  : pending.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-xs text-fg-muted">Nothing to pay. Every delivered order is on a statement.</td></tr>
                    : pending.map((p) => (
                      <tr key={p.partnerId} className="hover:bg-surface-2/60">
                        <td className="px-6 py-4 text-sm font-semibold text-fg">{p.partnerName}{p.phone && <span className="block text-xs text-fg-muted font-mono">{p.phone}</span>}</td>
                        <td className="px-6 py-4 text-sm text-fg-muted font-mono">{p.orders}</td>
                        <td className="px-6 py-4 text-xs text-fg-muted">{day(p.oldestDeliveredAt)}</td>
                        <td className="px-6 py-4 text-sm text-fg-muted">{rs(p.grossPaise)}</td>
                        <td className="px-6 py-4 text-sm text-fg-muted">{ptype === 'rider' ? rs(p.tipsPaise) : `−${rs(p.commissionPaise)}`}</td>
                        <td className="px-6 py-4 text-sm text-fg-muted">{ptype === 'vendor' ? rs(p.adjustmentsPaise) : ''}</td>
                        <td className={`px-6 py-4 text-lg font-semibold ${p.netPaise < 0 ? 'text-danger-text' : 'text-success-text'}`}>{rs(p.netPaise)}</td>
                        <td className="px-6 py-4"><button onClick={() => setTarget(p)} className="px-4 py-2 bg-success hover:bg-success/90 text-on-solid rounded-lg text-xs font-semibold">Generate statement</button></td>
                      </tr>
                    ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="p-8 border-b border-line flex flex-wrap gap-4 justify-between items-center">
          <h4 className="text-lg font-semibold text-fg">Statements</h4>
          <div className="flex gap-2 flex-wrap">
            <select value={histStatus} onChange={(e) => setHistStatus(e.target.value as typeof histStatus)} className="bg-surface-2/60 border border-line rounded-xl px-3 py-2 text-xs text-fg">
              <option value="">All</option><option value="PENDING">Pending</option><option value="PAID">Paid</option><option value="CANCELLED">Cancelled</option>
            </select>
            <button onClick={exportCsv} disabled={!history.length} className="px-4 py-2 bg-success-soft text-success-text rounded-xl text-xs font-semibold disabled:opacity-30">Export CSV</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead><tr className="bg-surface-2/60">
              {['Partner', 'Period', 'Orders', 'Net', 'Status', 'UTR', ''].map((h) => <th key={h} className="px-6 py-4 text-xs font-semibold text-fg-muted border-b border-line">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-white/[0.02]">
              {histErr ? <tr><td colSpan={7} className="py-10 text-center text-xs text-danger-text">{histErr}</td></tr>
                : history.length === 0 ? <tr><td colSpan={7} className="py-10 text-center text-xs text-fg-muted">No statements yet.</td></tr>
                  : history.map((p) => (
                    <tr key={p.id} className="hover:bg-surface-2/60">
                      <td className="px-6 py-4 text-sm font-semibold text-fg">{p.partnerName}<span className="block text-xs text-fg-muted font-mono">{p.id.slice(0, 8)}</span></td>
                      <td className="px-6 py-4 text-xs text-fg-muted">{day(p.periodStart)} → {day(p.periodEnd)}</td>
                      <td className="px-6 py-4 text-sm text-fg-muted font-mono">{p.orderCount}</td>
                      <td className={`px-6 py-4 text-sm font-semibold ${p.netPaise < 0 ? 'text-danger-text' : 'text-fg'}`}>{rs(p.netPaise)}</td>
                      <td className="px-6 py-4"><span className={`text-xs font-semibold px-2 py-1 rounded ${p.status === 'PAID' ? 'bg-success-soft text-success-text' : p.status === 'PENDING' ? 'bg-warning-soft text-warning-text' : 'bg-surface-2/60 text-fg-muted'}`}>{p.status}</span>{p.paidAt && <span className="block text-xs text-fg-muted mt-1">{day(p.paidAt)}</span>}</td>
                      <td className="px-6 py-4 text-xs text-fg-muted font-mono">{p.utr ? `${p.utr}${p.method ? ` (${p.method})` : ''}` : '—'}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {p.status === 'PENDING' && (
                          <div className="flex gap-2">
                            <button onClick={() => markPaid(p)} disabled={busy !== null} className="px-3 py-2 bg-success hover:bg-success/90 text-on-solid rounded-lg text-xs font-semibold disabled:opacity-40">{busy === p.id ? '…' : 'Mark paid'}</button>
                            <button onClick={() => cancel(p)} disabled={busy !== null} className="px-3 py-2 bg-surface-2/60 text-fg-muted rounded-lg text-xs font-semibold disabled:opacity-40">Cancel</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      {target && <StatementModal partner={target} onClose={() => setTarget(null)} onSaved={(msg) => { setTarget(null); setNotice({ kind: 'ok', text: msg }); loadPending(); loadHistory(); }} />}
    </div>
  );
}

function StatementModal({ partner, onClose, onSaved }: { partner: PendingRow; onClose: () => void; onSaved: (msg: string) => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeTips, setIncludeTips] = useState(true);
  const [preview, setPreview] = useState<Statement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState('');

  const runPreview = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const q = new URLSearchParams({ partnerType: partner.partnerType, partnerId: partner.partnerId, includeTips: String(includeTips) });
      if (from) q.set('from', new Date(`${from}T00:00:00+05:30`).toISOString());
      if (to) q.set('to', new Date(`${to}T23:59:59.999+05:30`) > new Date() ? new Date().toISOString() : new Date(`${to}T23:59:59.999+05:30`).toISOString());
      setPreview(await adminRequest<Statement>(`/api/admin/payouts/preview?${q}`));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not preview.'); setPreview(null); } finally { setLoading(false); }
  }, [partner, from, to, includeTips]);
  useEffect(() => { runPreview(); }, [runPreview]);

  const save = async () => {
    if (!preview) return;
    setLoading(true); setErr(null);
    try {
      await adminRequest('/api/admin/payouts', {
        method: 'POST',
        body: JSON.stringify({
          partnerType: preview.partnerType, partnerId: preview.partnerId, from: from ? preview.periodStart : undefined, to: preview.periodEnd, includeTips,
          expectedOrders: preview.orderCount, expectedNetPaise: preview.netPaise, notes: notes.trim() || undefined,
        }),
      });
      onSaved(`Statement saved for ${preview.partnerName}: ${rs(preview.netPaise)} (${preview.orderCount} orders). Mark it paid once the money has moved.`);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.'); runPreview(); } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-scrim/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="rounded-lg border border-line bg-surface shadow-xs w-full max-w-xl p-8 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between"><h3 className="text-xl font-semibold text-fg">Statement · {partner.partnerName}</h3><button onClick={onClose} className="text-fg-muted hover:text-fg" aria-label="Dismiss"><span aria-hidden="true" className="text-base leading-none">×</span></button></div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-fg-muted font-semibold">From (IST, optional)<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full bg-surface-2/60 border border-line rounded-xl p-3 text-fg text-sm" /></label>
          <label className="text-xs text-fg-muted font-semibold">To (IST, default now)<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full bg-surface-2/60 border border-line rounded-xl p-3 text-fg text-sm" /></label>
        </div>
        {partner.partnerType === 'rider' && <label className="flex items-center gap-2 text-xs text-fg-muted"><input type="checkbox" checked={includeTips} onChange={(e) => setIncludeTips(e.target.checked)} /> Include the rider&apos;s tip balance</label>}
        {loading && !preview ? <p className="text-xs text-fg-muted">Calculating…</p> : preview && (
          <div className="space-y-1 text-sm p-4 bg-surface-2/60 rounded-lg border border-line">
            <p className="text-fg-muted">{preview.orderCount} order(s), {day(preview.periodStart)} → {day(preview.periodEnd)}</p>
            <p className="flex justify-between"><span className="text-fg-muted">{partner.partnerType === 'rider' ? 'Earnings' : 'Gross (item subtotal)'}</span><span className="text-fg">{rs(preview.grossPaise)}</span></p>
            {partner.partnerType !== 'rider' && <p className="flex justify-between"><span className="text-fg-muted">Commission (fixed per order)</span><span className="text-danger-text">−{rs(preview.commissionPaise)}</span></p>}
            {preview.adjustmentsPaise !== 0 && <p className="flex justify-between"><span className="text-fg-muted">Cash the stall collected itself</span><span className="text-danger-text">{rs(preview.adjustmentsPaise)}</span></p>}
            {partner.partnerType === 'rider' && <p className="flex justify-between"><span className="text-fg-muted">Tips</span><span className="text-fg">{rs(preview.tipsPaise)}</span></p>}
            <p className="flex justify-between border-t border-line pt-2 font-semibold"><span className="text-fg">{preview.netPaise < 0 ? 'Partner owes Zenvy' : 'Pay'}</span><span className={preview.netPaise < 0 ? 'text-danger-text' : 'text-success-text'}>{rs(preview.netPaise)}</span></p>
            {partner.partnerType === 'rider' && (preview.cashHeldPaise || 0) > 0 && <p className="text-xs text-warning-text pt-1">This rider also holds {rs(preview.cashHeldPaise || 0)} COD cash. It is not deducted here: record it as a deposit under Rider cash.</p>}
          </div>
        )}
        <input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full bg-surface-2/60 border border-line rounded-xl p-3 text-fg text-sm" />
        {err && <p className="text-xs font-semibold text-danger-text">{err}</p>}
        <div className="flex gap-3">
          <button onClick={save} disabled={loading || !preview || (preview.orderCount === 0 && preview.tipsPaise === 0)} className="px-6 py-3 bg-success hover:bg-success/90 disabled:opacity-40 rounded-xl text-xs font-semibold text-on-solid">Save statement</button>
          <button onClick={onClose} className="px-6 py-3 bg-surface-2/60 rounded-xl text-xs font-semibold text-fg-muted">Close</button>
        </div>
      </div>
    </div>
  );
}
