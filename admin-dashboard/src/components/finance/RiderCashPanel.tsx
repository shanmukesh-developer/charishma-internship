"use client";
// C6 rider cash: who holds how much COD cash for Zenvy, record a deposit (cash / UPI + reference) or an
// adjustment (reason), per-rider ledger, and the read-only reconciliation check.
// Data: /api/admin/rider-cash, /rider-cash/:id/entries, /rider-cash/:id/deposit|adjust, /rider-cash/reconcile.
import React, { useCallback, useEffect, useState } from 'react';
import { adminRequest } from '@/lib/api';
import {
  Badge, Button, DataTable, Drawer, Field, Input, LoadingState, Modal, Notice as NoticeBox, SectionTitle, SegmentedControl, Select,
  StatTile, Textarea, useConfirm, type Column, IconRefresh,
} from '@/components/ui';
import { formatDateTime, formatINR, humanize } from '@/lib/format';

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

const rs = (paise: number) => formatINR(Number(paise || 0) / 100);
const signed = (paise: number) => `${paise > 0 ? '+' : paise < 0 ? '−' : ''}${rs(Math.abs(paise))}`;
const when = (s: string | null) => (s ? formatDateTime(s) : '–');
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const short = (id: string) => `#${id.slice(-6).toUpperCase()}`;

export default function RiderCashPanel() {
  const [data, setData] = useState<Holdings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [open, setOpen] = useState<HoldingRow | null>(null);
  const [recon, setRecon] = useState<ReconcileResp | null>(null);
  const [reconLoading, setReconLoading] = useState(false);
  // "Record missing cash row" asks for a reason (was a browser prompt).
  const [missingFor, setMissingFor] = useState<string | null>(null);
  const [missingReason, setMissingReason] = useState('');

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

  const recordMissing = async (orderId: string, reason: string) => {
    if (!reason) return;
    try {
      await adminRequest(`/api/admin/rider-cash/orders/${orderId}/record`, { method: 'POST', body: JSON.stringify({ reason }) });
      setNotice({ kind: 'ok', text: `Cash row recorded for order #${orderId.slice(-6).toUpperCase()}.` });
      runCheck(); load();
    } catch (e) { setNotice({ kind: 'err', text: e instanceof Error ? e.message : 'Could not record it.' }); }
  };

  const columns: Column<HoldingRow>[] = [
    { key: 'rider', header: 'Rider', sortValue: r => r.name, cell: r => <div><p className="font-medium text-fg">{r.name}</p><p className="text-xs tabular-nums text-fg-muted">{r.phone}</p></div> },
    {
      key: 'held',
      header: 'Cash held',
      align: 'right',
      sortValue: r => r.cashHeldPaise,
      cell: r => <div className="tabular-nums"><p className={r.overLimit ? 'font-medium text-danger-text' : 'font-medium text-fg'}>{rs(r.cashHeldPaise)}</p>{r.overLimit && <Badge tone="danger">At limit</Badge>}</div>,
    },
    { key: 'owes', header: 'ZENV owes', align: 'right', hideBelow: 'lg', sortValue: r => r.position.zenvyOwesPaise, cell: r => <span className="tabular-nums text-fg-muted" title="Earnings plus tips">{rs(r.position.zenvyOwesPaise)}</span> },
    {
      key: 'net',
      header: 'Net',
      sortValue: r => r.position.netPaise,
      cell: r => (r.position.netPaise < 0
        ? <span className="text-danger-text">Rider owes {rs(-r.position.netPaise)}</span>
        : r.position.netPaise > 0 ? <span className="text-fg">ZENV owes {rs(r.position.netPaise)}</span> : <span className="text-fg-muted">Settled</span>),
    },
    { key: 'last', header: 'Last deposit', hideBelow: 'xl', sortValue: r => (r.lastDepositAt ? new Date(r.lastDepositAt) : null), cell: r => <span className="text-xs text-fg-muted">{when(r.lastDepositAt)}</span> },
    { key: 'action', header: <span className="sr-only">Action</span>, align: 'right', cell: r => <Button size="sm" onClick={() => setOpen(r)}>Deposit and history</Button> },
  ];

  return (
    <div className="space-y-6">
      {notice && (
        <NoticeBox tone={notice.kind === 'err' ? 'danger' : 'success'} onClose={() => setNotice(null)}>
          <span className="text-fg">{notice.text}</span>
        </NoticeBox>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatTile label="Cash riders hold for ZENV" value={data ? rs(data.totalHeldPaise) : null} loading={loading && !data} tone={data && data.totalHeldPaise > 0 ? 'warning' : 'neutral'} />
        <StatTile
          label="Cash-on-delivery limit"
          value={data ? (data.limitEnabled ? rs(data.limitPaise) : 'Off') : null}
          hint={data?.limitEnabled ? `${data.overLimitCount} ${data.overLimitCount === 1 ? 'rider is' : 'riders are'} at the limit and cannot take new cash orders` : 'Riders are never blocked. Change it on Settings and fees.'}
          loading={loading && !data}
        />
        <StatTile label="Ledger started" value={data ? when(data.ledgerStart) : null} hint="Cash held before this is not known: record it with an adjustment." loading={loading && !data} />
      </div>

      <section>
        <SectionTitle
          title="Rider cash holdings"
          description="Cash-on-delivery money collected minus deposits. Payouts never deduct it: collect it with a deposit."
          actions={
            <>
              <Button onClick={runCheck} loading={reconLoading}>Run cash check</Button>
              <Button leftIcon={<IconRefresh size={14} />} onClick={load} loading={loading}>Refresh</Button>
            </>
          }
        />
        <DataTable
          caption="Rider cash holdings"
          columns={columns}
          rows={data?.riders || []}
          rowKey={r => r.riderId}
          loading={loading}
          error={error}
          onRetry={load}
          onRowClick={r => setOpen(r)}
          noun="riders"
          empty={{ title: 'No rider holds cash yet' }}
        />
      </section>

      {recon && (
        <section className="rounded-lg border border-line bg-surface p-4 shadow-xs">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-fg">Cash check</h3>
            {recon.ok ? <Badge tone="success">All good</Badge> : <Badge tone="danger">{recon.problems} {recon.problems === 1 ? 'problem' : 'problems'}</Badge>}
          </div>
          <p className="mt-1 text-sm text-fg-muted">{recon.ridersChecked} riders and {recon.ordersChecked} cash orders since {when(recon.ledgerStart)}, checked {when(recon.checkedAt)}. The check never changes anything.</p>
          <ul className="mt-3 space-y-2 text-sm">
            {recon.mismatches.map((m) => <li key={m.riderId} className="text-danger-text">{m.name || m.riderId}: cash held {rs(m.heldPaise)} but the history adds up to {rs(m.ledgerPaise)}.</li>)}
            {recon.withoutHistory.map((m) => <li key={m.riderId} className="text-danger-text">{m.name || m.riderId}: holds {rs(m.heldPaise)} with no history.</li>)}
            {recon.missingRows.map((m) => (
              <li key={m.orderId} className="flex flex-wrap items-center gap-3 text-danger-text">
                Cash order {short(m.orderId)} ({rs(m.expectedPaise)}, delivered {when(m.deliveredAt)}) has no cash row.
                <Button size="sm" onClick={() => { setMissingReason(''); setMissingFor(m.orderId); }}>Record it</Button>
              </li>
            ))}
            {recon.duplicateRows.map((m) => <li key={m.orderId} className="text-danger-text">Order {short(m.orderId)} has {m.rows} cash rows.</li>)}
            {recon.wrongRows.map((m) => <li key={`${m.orderId}-${m.rowRiderId}`} className="text-danger-text">Order {short(m.orderId)}: {m.notACodDelivery ? 'cash row for an order that is not a delivered cash order' : 'cash row with the wrong rider or amount'} ({rs(m.rowPaise)}).</li>)}
          </ul>
        </section>
      )}

      {open && <RiderCashDrawer row={open} onClose={() => setOpen(null)} onChanged={(msg) => { setNotice({ kind: 'ok', text: msg }); load(); }} />}

      <Modal
        open={!!missingFor}
        onClose={() => setMissingFor(null)}
        size="sm"
        title={missingFor ? `Record the missing cash row for ${short(missingFor)}?` : 'Record missing cash row'}
        description="Check with the rider first."
        footer={<><Button onClick={() => setMissingFor(null)}>Cancel</Button><Button variant="primary" disabled={missingReason.trim().length < 5} onClick={() => { const id = missingFor; setMissingFor(null); if (id) recordMissing(id, missingReason); }}>Record</Button></>}
      >
        <Field label="Reason" required hint="At least 5 characters.">
          <Textarea rows={2} value={missingReason} onChange={e => setMissingReason(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}

function RiderCashDrawer({ row, onClose, onChanged }: { row: HoldingRow; onClose: () => void; onChanged: (msg: string) => void }) {
  const confirm = useConfirm();
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
    if (!(await confirm(mode === 'deposit'
      ? { title: `Record ${rs(amountPaise)} received from ${row.name}?`, description: `By ${method === 'upi' ? 'UPI' : 'cash'}, reference ${reference.trim()}.`, confirmLabel: 'Record deposit' }
      : { title: `Adjust ${row.name}'s cash held by ${signed(amountPaise)}?`, description: `Reason: ${reason.trim()}`, confirmLabel: 'Save adjustment' }))) return;
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

  const entryColumns: Column<Entry>[] = [
    { key: 'when', header: 'When', cell: e => <span className="whitespace-nowrap text-xs text-fg-muted">{when(e.createdAt)}</span> },
    { key: 'what', header: 'What', cell: e => <span className="text-fg">{e.label}</span> },
    { key: 'amount', header: 'Amount', align: 'right', cell: e => <span className="tabular-nums">{signed(e.amountPaise)}</span> },
    { key: 'after', header: 'Held after', align: 'right', cell: e => <span className="tabular-nums text-fg-muted">{rs(e.balanceAfterPaise)}</span> },
    { key: 'details', header: 'Details', cell: e => <span className="text-xs text-fg-muted">{[e.orderId ? short(e.orderId) : null, e.method ? humanize(e.method) : null, e.reference, e.reason].filter(Boolean).join(' · ') || '–'}</span> },
  ];

  return (
    <Drawer
      open
      onClose={onClose}
      size="xl"
      title={row.name}
      description={`${row.phone} · cash held ${rs(entries?.cashHeldPaise ?? row.cashHeldPaise)}`}
    >
      <div className="space-y-6">
        {entries && !entries.inSync && <NoticeBox tone="danger" title="History does not match">The cash history adds up to {rs(entries.ledgerPaise)}. Run the cash check on the main list.</NoticeBox>}
        {entries && (
          <p className="text-sm text-fg-muted">
            ZENV owes {rs(entries.position.zenvyOwesPaise)} (earnings {rs(entries.position.earningsPaise)} plus tips {rs(entries.position.tipsPaise)}). Net: {entries.position.netPaise < 0 ? `the rider owes ${rs(-entries.position.netPaise)}` : `ZENV owes ${rs(entries.position.netPaise)}`}.
          </p>
        )}

        <section className="space-y-4 rounded-lg border border-line p-4">
          <SegmentedControl ariaLabel="Entry type" value={mode} onChange={(m) => { setMode(m); setErr(null); }} options={[{ value: 'deposit', label: 'Record deposit' }, { value: 'adjust', label: 'Adjustment' }]} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={mode === 'deposit' ? 'Amount received' : 'Amount'} hint={mode === 'adjust' ? 'Negative reduces the cash held.' : undefined}>
              <Input prefix="₹" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            {mode === 'deposit' && (
              <>
                <Field label="How it was paid">
                  <Select value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'upi')}>
                    <option value="cash">Cash handover</option>
                    <option value="upi">UPI to ZENV</option>
                  </Select>
                </Field>
                <Field label={method === 'upi' ? 'UPI reference (UTR)' : 'Receipt number or received by'}>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                </Field>
              </>
            )}
          </div>
          <Field label={mode === 'deposit' ? 'Note' : 'Reason'} optional={mode === 'deposit'} required={mode === 'adjust'} hint={mode === 'adjust' ? 'Shown to the rider.' : undefined}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {err && <NoticeBox tone="danger"><span className="text-fg">{err}</span></NoticeBox>}
          <div className="flex justify-end">
            <Button variant="primary" onClick={submit} loading={saving}>{mode === 'deposit' ? 'Record deposit' : 'Save adjustment'}</Button>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-fg">Cash history</h3>
          {!entries ? <LoadingState label="Loading the history…" /> : (
            <DataTable caption="Cash history" columns={entryColumns} rows={entries.entries} rowKey={e => e.id} pageSize={0} dense maxHeight="none" empty={{ title: 'No cash history yet' }} />
          )}
          {entries && (entries.page > 1 || entries.hasMore) && (
            <div className="mt-3 flex gap-2">
              <Button size="sm" disabled={page <= 1} onClick={() => loadEntries(page - 1)}>Newer</Button>
              <Button size="sm" disabled={!entries.hasMore} onClick={() => loadEntries(page + 1)}>Older</Button>
            </div>
          )}
        </section>
      </div>
    </Drawer>
  );
}
