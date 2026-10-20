"use client";
// C6 payout statements: partners with unpaid orders -> preview a statement for a period -> save it
// (PENDING, its orders are claimed) -> mark paid with the UTR (required) or cancel; history + CSV.
// Data: /api/admin/payouts/pending, /payouts/preview, POST /payouts, /payouts/:id/mark-paid|cancel, GET /payouts.
import React, { useCallback, useEffect, useState } from 'react';
import { adminRequest } from '@/lib/api';
import {
  Button, Checkbox, DataTable, Field, Input, LoadingState, Modal, Notice as NoticeBox, SectionTitle, SegmentedControl, Select, StatusPill,
  Textarea, type Column, IconDownload, IconRefresh,
} from '@/components/ui';
import { formatDate, formatINR, humanize } from '@/lib/format';

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

const rs = (paise: number) => `${paise < 0 ? '−' : ''}${formatINR(Math.abs(Number(paise || 0)) / 100)}`;
const day = (s: string | null) => (s ? formatDate(s) : '–');
const csvCell = (v: unknown) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const TYPE_LABEL: Record<PartnerType, string> = { restaurant: 'Restaurants', vendor: 'Stalls', rider: 'Riders' };

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

  // Mark paid / cancel collect their input in small forms (they used browser prompts); the requests are unchanged.
  const [paying, setPaying] = useState<PayoutRow | null>(null);
  const [payUtr, setPayUtr] = useState('');
  const [payMethod, setPayMethod] = useState('bank');
  const [cancelling, setCancelling] = useState<PayoutRow | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const markPaid = (p: PayoutRow) => { setPayUtr(''); setPayMethod('bank'); setPaying(p); };
  const submitPaid = async () => {
    const p = paying;
    if (!p) return;
    const utr = payUtr;
    if (utr.trim().length < 3) { setNotice({ kind: 'err', text: 'A UTR / payment reference (at least 3 characters) is required.' }); return; }
    const method = (payMethod || 'bank').trim().toLowerCase();
    setPaying(null);
    setBusy(p.id);
    try {
      await adminRequest(`/api/admin/payouts/${p.id}/mark-paid`, { method: 'POST', body: JSON.stringify({ utr: utr.trim(), method }) });
      setNotice({ kind: 'ok', text: `${p.partnerName}: ${rs(p.netPaise)} marked paid (UTR ${utr.trim()}).` });
      loadHistory(); loadPending();
    } catch (e) { setNotice({ kind: 'err', text: e instanceof Error ? e.message : 'Could not mark paid.' }); } finally { setBusy(null); }
  };
  const cancel = (p: PayoutRow) => { setCancelReason(''); setCancelling(p); };
  const submitCancel = async () => {
    const p = cancelling;
    const reason = cancelReason;
    if (!p || !reason) return;
    setCancelling(null);
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

  const pendingColumns: Column<PendingRow>[] = [
    { key: 'partner', header: 'Partner', sortValue: p => p.partnerName, cell: p => <div><p className="font-medium text-fg">{p.partnerName}</p>{p.phone && <p className="text-xs tabular-nums text-fg-muted">{p.phone}</p>}</div> },
    { key: 'orders', header: 'Orders', align: 'right', sortValue: p => p.orders, cell: p => <span className="tabular-nums">{p.orders}</span> },
    { key: 'since', header: 'Oldest delivery', hideBelow: 'lg', sortValue: p => (p.oldestDeliveredAt ? new Date(p.oldestDeliveredAt) : null), cell: p => <span className="text-xs text-fg-muted">{day(p.oldestDeliveredAt)}</span> },
    { key: 'gross', header: ptype === 'rider' ? 'Earnings' : 'Gross', align: 'right', hideBelow: 'lg', sortValue: p => p.grossPaise, cell: p => <span className="tabular-nums text-fg-muted">{rs(p.grossPaise)}</span> },
    ptype === 'rider'
      ? { key: 'tips', header: 'Tips', align: 'right', hideBelow: 'lg', cell: (p: PendingRow) => <span className="tabular-nums text-fg-muted">{rs(p.tipsPaise)}</span> }
      : { key: 'commission', header: 'Commission', align: 'right', hideBelow: 'lg', cell: (p: PendingRow) => <span className="tabular-nums text-fg-muted">−{rs(p.commissionPaise)}</span> },
    ...(ptype === 'vendor' ? [{ key: 'kept', header: 'Cash they kept', align: 'right' as const, hideBelow: 'xl' as const, cell: (p: PendingRow) => <span className="tabular-nums text-fg-muted">{rs(p.adjustmentsPaise)}</span> }] : []),
    { key: 'net', header: 'Net', align: 'right', sortValue: p => p.netPaise, cell: p => <span className={`font-semibold tabular-nums ${p.netPaise < 0 ? 'text-danger-text' : 'text-fg'}`}>{rs(p.netPaise)}</span> },
    { key: 'action', header: <span className="sr-only">Action</span>, align: 'right', cell: p => <Button size="sm" variant="primary" onClick={() => setTarget(p)}>Make statement</Button> },
  ];

  const historyColumns: Column<PayoutRow>[] = [
    { key: 'partner', header: 'Partner', sortValue: p => p.partnerName, cell: p => <div><p className="font-medium text-fg">{p.partnerName}</p><p className="font-mono text-xs text-fg-muted">{p.id.slice(0, 8)}</p></div> },
    { key: 'period', header: 'Period', hideBelow: 'lg', cell: p => <span className="text-xs text-fg-muted">{day(p.periodStart)} – {day(p.periodEnd)}</span> },
    { key: 'orders', header: 'Orders', align: 'right', sortValue: p => p.orderCount, cell: p => <span className="tabular-nums">{p.orderCount}</span> },
    { key: 'net', header: 'Net', align: 'right', sortValue: p => p.netPaise, cell: p => <span className={`font-medium tabular-nums ${p.netPaise < 0 ? 'text-danger-text' : 'text-fg'}`}>{rs(p.netPaise)}</span> },
    { key: 'status', header: 'Status', sortValue: p => p.status, cell: p => <div><StatusPill status={p.status} tone={p.status === 'PAID' ? 'success' : p.status === 'PENDING' ? 'warning' : 'neutral'} />{p.paidAt && <p className="mt-0.5 text-xs text-fg-muted">{day(p.paidAt)}</p>}</div> },
    { key: 'utr', header: 'UTR', hideBelow: 'xl', cell: p => <span className="font-mono text-xs text-fg-muted">{p.utr ? `${p.utr}${p.method ? ` (${humanize(p.method)})` : ''}` : '–'}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: p => (p.status === 'PENDING' ? (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => cancel(p)}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={busy !== null} loading={busy === p.id} onClick={() => markPaid(p)}>Mark paid</Button>
        </div>
      ) : null),
    },
  ];

  return (
    <div className="space-y-6">
      {notice && (
        <NoticeBox tone={notice.kind === 'err' ? 'danger' : 'success'} onClose={() => setNotice(null)}>
          <span className="text-fg">{notice.text}</span>
        </NoticeBox>
      )}

      <SegmentedControl
        ariaLabel="Partner type"
        value={ptype}
        onChange={setPtype}
        options={(Object.keys(TYPE_LABEL) as PartnerType[]).map(t => ({ value: t, label: TYPE_LABEL[t] }))}
      />

      <section>
        <SectionTitle
          title="Not yet on a statement"
          description={ptype === 'rider'
            ? 'Earnings (delivery fee, ₹30 when the fee is 0) plus tips. Cash the rider holds is not deducted: collect it under Rider cash.'
            : 'Item subtotal minus the commission fixed when each order was placed' + (ptype === 'vendor' ? ', minus the cash the stall collected itself (negative means the stall owes Zenvy).' : '.')}
          actions={<Button leftIcon={<IconRefresh size={14} />} onClick={loadPending} loading={loading}>Refresh</Button>}
        />
        <DataTable
          caption="Partners not yet on a statement"
          columns={pendingColumns}
          rows={pending}
          rowKey={p => p.partnerId}
          loading={loading}
          error={pendingErr}
          onRetry={loadPending}
          noun="partners"
          empty={{ title: 'Nothing to pay', description: 'Every delivered order is on a statement.' }}
        />
      </section>

      <section>
        <SectionTitle
          title="Statements"
          actions={
            <>
              <Select aria-label="Statement status" value={histStatus} onChange={(e) => setHistStatus(e.target.value as typeof histStatus)} className="w-auto">
                <option value="">All statuses</option><option value="PENDING">Pending</option><option value="PAID">Paid</option><option value="CANCELLED">Cancelled</option>
              </Select>
              <Button leftIcon={<IconDownload size={14} />} onClick={exportCsv} disabled={!history.length}>Export CSV</Button>
            </>
          }
        />
        <DataTable
          caption="Payout statements"
          columns={historyColumns}
          rows={history}
          rowKey={p => p.id}
          error={histErr}
          onRetry={loadHistory}
          noun="statements"
          empty={{ title: 'No statements yet' }}
        />
      </section>

      {target && <StatementModal partner={target} onClose={() => setTarget(null)} onSaved={(msg) => { setTarget(null); setNotice({ kind: 'ok', text: msg }); loadPending(); loadHistory(); }} />}

      <Modal
        open={!!paying}
        onClose={() => setPaying(null)}
        size="sm"
        title={paying ? `Mark ${rs(paying.netPaise)} to ${paying.partnerName} as ${paying.netPaise < 0 ? 'settled' : 'paid'}?` : 'Mark paid'}
        description={paying && paying.netPaise < 0 ? 'This partner owed Zenvy; record the money you received from them.' : 'Record this after the money has moved.'}
        footer={<><Button onClick={() => setPaying(null)}>Cancel</Button><Button variant="primary" disabled={payUtr.trim().length < 3} onClick={submitPaid}>Mark paid</Button></>}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <Field label="UTR or payment reference" required hint="At least 3 characters.">
            <Input value={payUtr} onChange={e => setPayUtr(e.target.value)} autoComplete="off" data-autofocus />
          </Field>
          <Field label="Method">
            <Select value={payMethod} onChange={e => setPayMethod(e.target.value)}>
              <option value="bank">Bank</option><option value="upi">UPI</option><option value="cash">Cash</option><option value="other">Other</option>
            </Select>
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        size="sm"
        title={cancelling ? `Cancel the statement for ${cancelling.partnerName}?` : 'Cancel statement'}
        description={cancelling ? `Its ${cancelling.orderCount} ${cancelling.orderCount === 1 ? 'order goes' : 'orders go'} back to unpaid.` : undefined}
        footer={<><Button onClick={() => setCancelling(null)}>Keep statement</Button><Button variant="destructive" disabled={cancelReason.trim().length < 5} onClick={submitCancel}>Cancel statement</Button></>}
      >
        <Field label="Reason" required hint="At least 5 characters.">
          <Textarea rows={2} value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
        </Field>
      </Modal>
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
    <Modal
      open
      onClose={onClose}
      size="md"
      title={`Statement for ${partner.partnerName}`}
      description="Pick the period (IST). Leave the dates empty to include everything up to now."
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={save} loading={loading && !!preview} disabled={!preview || (preview.orderCount === 0 && preview.tipsPaise === 0)}>Save statement</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" optional><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To" hint="Default: now"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        {partner.partnerType === 'rider' && <Checkbox checked={includeTips} onChange={(e) => setIncludeTips(e.target.checked)} label="Include the rider’s tip balance" />}
        {loading && !preview ? <LoadingState label="Calculating…" className="py-6" /> : preview && (
          <div className="space-y-1 rounded-lg border border-line p-3 text-sm">
            <p className="text-fg-muted">{preview.orderCount} {preview.orderCount === 1 ? 'order' : 'orders'}, {day(preview.periodStart)} – {day(preview.periodEnd)}</p>
            <p className="flex justify-between"><span className="text-fg-muted">{partner.partnerType === 'rider' ? 'Earnings' : 'Gross (item subtotal)'}</span><span className="tabular-nums">{rs(preview.grossPaise)}</span></p>
            {partner.partnerType !== 'rider' && <p className="flex justify-between"><span className="text-fg-muted">Commission (fixed per order)</span><span className="tabular-nums">−{rs(preview.commissionPaise)}</span></p>}
            {preview.adjustmentsPaise !== 0 && <p className="flex justify-between"><span className="text-fg-muted">Cash the stall collected itself</span><span className="tabular-nums">{rs(preview.adjustmentsPaise)}</span></p>}
            {partner.partnerType === 'rider' && <p className="flex justify-between"><span className="text-fg-muted">Tips</span><span className="tabular-nums">{rs(preview.tipsPaise)}</span></p>}
            <p className="flex justify-between border-t border-line pt-2 font-semibold"><span>{preview.netPaise < 0 ? 'Partner owes Zenvy' : 'Pay'}</span><span className={`tabular-nums ${preview.netPaise < 0 ? 'text-danger-text' : ''}`}>{rs(preview.netPaise)}</span></p>
            {partner.partnerType === 'rider' && (preview.cashHeldPaise || 0) > 0 && <p className="pt-1 text-xs text-warning-text">This rider also holds {rs(preview.cashHeldPaise || 0)} of cash-on-delivery money. It is not deducted here: record it as a deposit under Rider cash.</p>}
          </div>
        )}
        <Field label="Notes" optional><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {err && <NoticeBox tone="danger"><span className="text-fg">{err}</span></NoticeBox>}
      </div>
    </Modal>
  );
}
