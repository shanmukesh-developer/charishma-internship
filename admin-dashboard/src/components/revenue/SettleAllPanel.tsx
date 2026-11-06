"use client";
// Settle all (Revenue page). Pick a cycle -> the server shows exactly which statements it would create (one per
// store of that cycle, its delivered orders not on any statement up to the cutoff) -> confirm with the totals ->
// PENDING statements are saved (nothing is paid by the app). Then pay each store from the bank / UPI and enter
// one reference per statement -> "Mark paid". Backend: POST /api/admin/revenue/settle and /settle/mark-paid.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminRequest } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  Badge, Button, Card, CardBody, CardHeader, Checkbox, Input, Modal, Notice, SegmentedControl, Select, Skeleton,
  IconRefresh,
} from '@/components/ui';
import {
  CYCLES, cycleLabel, rupees, type Cycle, type MarkPaidResult, type SettlePreview, type SettleResult, type Statement,
} from './revenueModel';

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function Amount({ paise, strong = false }: { paise: number; strong?: boolean }) {
  return <span className={`tabular-nums ${strong ? 'font-semibold' : ''} ${paise < 0 ? 'text-danger-text' : 'text-fg'}`}>{rupees(paise)}</span>;
}

export default function SettleAllPanel({ onChanged }: { onChanged: () => void }) {
  const [cycle, setCycle] = useState<Cycle>('weekly');
  const [preview, setPreview] = useState<SettlePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<SettleResult | null>(null);
  const [refs, setRefs] = useState<Record<string, { utr: string; method: string }>>({});
  const [paying, setPaying] = useState(false);
  const [payConfirm, setPayConfirm] = useState(false);
  const [payResult, setPayResult] = useState<MarkPaidResult | null>(null);

  const load = useCallback(async (c: Cycle) => {
    setLoading(true);
    setError(null);
    try {
      setPreview(await adminRequest<SettlePreview>(`/api/admin/revenue/settle/preview?cycle=${c}`));
    } catch (e) {
      setPreview(null);
      setError(errText(e, 'Could not load what would be settled.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(cycle); }, [cycle, load]);

  const create = async () => {
    if (!preview) return;
    setCreating(true);
    try {
      const r = await adminRequest<SettleResult>('/api/admin/revenue/settle', {
        method: 'POST',
        body: JSON.stringify({
          cycle: preview.cycle, cutoff: preview.cutoff, planHash: preview.planHash,
          expected: preview.stores.map(s => ({ storeId: s.storeId, orderCount: s.orderCount, netPaise: s.netPaise })),
        }),
      });
      setResult(r);
      setConfirming(false);
      onChanged();
      await load(preview.cycle);
    } catch (e) {
      setConfirming(false);
      setError(errText(e, 'Could not create the statements. Nothing was saved for the stores not listed as created.'));
      await load(cycle);
    } finally {
      setCreating(false);
    }
  };

  const pending = useMemo(() => preview?.pendingStatements || [], [preview]);
  const ready = useMemo(() => pending.filter(p => (refs[p.id]?.utr || '').trim().length >= 3), [pending, refs]);
  const readyTotal = ready.reduce((s, p) => s + p.netPaise, 0);

  const markPaid = async () => {
    setPaying(true);
    try {
      const r = await adminRequest<MarkPaidResult>('/api/admin/revenue/settle/mark-paid', {
        method: 'POST',
        body: JSON.stringify({ items: ready.map(p => ({ payoutId: p.id, utr: refs[p.id].utr.trim(), method: refs[p.id].method || 'upi' })) }),
      });
      setPayResult(r);
      setPayConfirm(false);
      setRefs(prev => {
        const next = { ...prev };
        for (const p of [...r.paid, ...r.alreadyPaid]) delete next[p.id];
        return next;
      });
      onChanged();
      await load(cycle);
    } catch (e) {
      setPayConfirm(false);
      setError(errText(e, 'Could not mark the statements paid.'));
    } finally {
      setPaying(false);
    }
  };

  const setRef = (id: string, patch: Partial<{ utr: string; method: string }>) =>
    setRefs(prev => ({ ...prev, [id]: { utr: prev[id]?.utr || '', method: prev[id]?.method || 'upi', ...patch } }));

  return (
    <Card>
      <CardHeader
        title="Settle all"
        description="Creates one statement per store for everything delivered and not yet settled up to the cutoff. Nothing is paid by the app: you pay each store, then enter its reference."
        actions={(
          <>
            <SegmentedControl ariaLabel="Settlement cycle" options={CYCLES} value={cycle} onChange={c => { setResult(null); setPayResult(null); setCycle(c); }} />
            <Button size="sm" leftIcon={<IconRefresh size={14} />} loading={loading} onClick={() => load(cycle)}>Refresh</Button>
          </>
        )}
      />
      <CardBody className="grid gap-4">
        {error && <Notice tone="danger" onClose={() => setError(null)}>{error}</Notice>}
        {result && (
          <Notice tone={result.failed.length || result.changed.length ? 'warning' : 'success'} title={result.message} onClose={() => setResult(null)}>
            <ul className="list-disc pl-4">
              {result.created.map(p => <li key={p.id}>{p.partnerName}: {p.orderCount} orders, {rupees(p.netPaise)} (pending payment)</li>)}
              {result.alreadySettled.map(s => <li key={s.storeId}>{s.name || s.storeId}: already on a statement, nothing new.</li>)}
              {result.changed.map(s => <li key={s.storeId}>{s.name || s.storeId}: numbers changed since the preview, not settled. {s.message}</li>)}
              {result.skipped.map(s => <li key={s.storeId}>{s.name || s.storeId}: {s.reason}</li>)}
              {result.failed.map(s => <li key={s.storeId}>{s.name || s.storeId}: {s.message}</li>)}
            </ul>
          </Notice>
        )}

        {loading && !preview ? (
          <div className="grid gap-2"><Skeleton className="h-5 w-72" /><Skeleton className="h-24 w-full" /></div>
        ) : preview && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="info">{cycleLabel(preview.cycle)}</Badge>
              <span className="text-fg">{preview.cutoffLabel}</span>
              <span className="text-fg-muted">· {preview.storesInCycle} store{preview.storesInCycle === 1 ? '' : 's'} on this cycle{preview.testStoresSkipped ? ` · ${preview.testStoresSkipped} test store${preview.testStoresSkipped === 1 ? '' : 's'} never settled` : ''}</span>
            </div>

            {preview.stores.length === 0 ? (
              <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-fg-muted">
                Nothing to settle for {cycleLabel(preview.cycle).toLowerCase()} stores: every delivered order up to the cutoff is already on a statement.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-surface-2 text-xs text-fg-muted">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Store</th>
                      <th className="px-3 py-2 text-right font-medium">Orders</th>
                      <th className="px-3 py-2 text-right font-medium">Item total</th>
                      <th className="px-3 py-2 text-right font-medium">Commission</th>
                      <th className="px-3 py-2 text-right font-medium">Cash stall kept</th>
                      <th className="px-3 py-2 text-right font-medium">Statement</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {preview.stores.map(s => (
                      <tr key={s.storeId}>
                        <td className="px-3 py-2">
                          <p className="font-medium text-fg">{s.name}</p>
                          <p className="text-xs text-fg-muted">{s.kind === 'vendor' ? 'Stall' : 'Restaurant'} · UPI {s.payoutUpiId || 'not set'}{s.firstDeliveredAt ? ` · from ${formatDate(s.firstDeliveredAt)}` : ''}</p>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.orderCount}</td>
                        <td className="px-3 py-2 text-right"><Amount paise={s.grossPaise} /></td>
                        <td className="px-3 py-2 text-right"><Amount paise={-s.commissionPaise} /></td>
                        <td className="px-3 py-2 text-right"><Amount paise={s.adjustmentsPaise} /></td>
                        <td className="px-3 py-2 text-right">
                          <Amount paise={s.netPaise} strong />
                          <p className="text-xs text-fg-muted">{s.netPaise >= 0 ? 'ZenWe pays the store' : 'Store pays ZenWe'}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-line-strong bg-surface-2/60 font-medium">
                    <tr>
                      <td className="px-3 py-2">{preview.totals.stores} statement{preview.totals.stores === 1 ? '' : 's'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{preview.totals.orders}</td>
                      <td className="px-3 py-2 text-right"><Amount paise={preview.totals.grossPaise} /></td>
                      <td className="px-3 py-2 text-right"><Amount paise={-preview.totals.commissionPaise} /></td>
                      <td className="px-3 py-2 text-right"><Amount paise={preview.totals.adjustmentsPaise} /></td>
                      <td className="px-3 py-2 text-right"><Amount paise={preview.totals.netPaise} strong /></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {preview.stores.length > 0 && (
              <div className="flex justify-end">
                <Button variant="primary" onClick={() => { setUnderstood(false); setConfirming(true); }}>
                  Create {preview.totals.stores} statement{preview.totals.stores === 1 ? '' : 's'}…
                </Button>
              </div>
            )}

            <div>
              <h3 className="mb-1 text-sm font-semibold text-fg">Waiting for payment ({pending.length})</h3>
              <p className="mb-2 text-xs text-fg-muted">Statements of {cycleLabel(preview.cycle).toLowerCase()} stores that are saved but not paid. Pay each one, type its UTR / UPI reference, then mark the filled ones paid. A wrong reference cannot be changed later.</p>
              {payResult && (
                <Notice className="mb-2" tone={payResult.failed.length ? 'warning' : 'success'} title={payResult.message} onClose={() => setPayResult(null)}>
                  {payResult.failed.length > 0 && <ul className="list-disc pl-4">{payResult.failed.map(f => <li key={f.payoutId}>{pending.find(p => p.id === f.payoutId)?.partnerName || f.payoutId}: {f.message}</li>)}</ul>}
                </Notice>
              )}
              {pending.length === 0 ? (
                <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-sm text-fg-muted">No statements waiting for payment.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-line">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-surface-2 text-xs text-fg-muted">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Store</th>
                        <th className="px-3 py-2 text-right font-medium">Amount</th>
                        <th className="px-3 py-2 text-left font-medium">Method</th>
                        <th className="px-3 py-2 text-left font-medium">UTR / reference</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {pending.map((p: Statement) => (
                        <tr key={p.id}>
                          <td className="px-3 py-2">
                            <p className="font-medium text-fg">{p.partnerName}</p>
                            <p className="text-xs text-fg-muted">{p.orderCount} orders · up to {formatDateTime(p.periodEnd)} · created {formatDate(p.createdAt)}</p>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Amount paise={p.netPaise} strong />
                            <p className="text-xs text-fg-muted">{p.netPaise >= 0 ? 'to pay' : 'to receive'}</p>
                          </td>
                          <td className="px-3 py-2">
                            <Select aria-label={`Payment method for ${p.partnerName}`} value={refs[p.id]?.method || 'upi'} onChange={e => setRef(p.id, { method: e.target.value })} className="w-28">
                              <option value="upi">UPI</option>
                              <option value="bank">Bank</option>
                              <option value="cash">Cash</option>
                              <option value="other">Other</option>
                            </Select>
                          </td>
                          <td className="px-3 py-2">
                            <Input aria-label={`Payment reference for ${p.partnerName}`} maxLength={120} placeholder="e.g. 431298765432" value={refs[p.id]?.utr || ''} onChange={e => setRef(p.id, { utr: e.target.value })} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {pending.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                  <span className="text-xs text-fg-muted">{ready.length} of {pending.length} have a reference</span>
                  <Button variant="primary" disabled={!ready.length} onClick={() => setPayConfirm(true)}>Mark {ready.length || ''} paid…</Button>
                </div>
              )}
            </div>
          </>
        )}
      </CardBody>

      {confirming && preview && (
        <Modal
          open
          size="lg"
          dismissible={!creating}
          onClose={() => setConfirming(false)}
          title={`Create ${preview.totals.stores} ${cycleLabel(preview.cycle).toLowerCase()} statement${preview.totals.stores === 1 ? '' : 's'}?`}
          description={preview.cutoffLabel}
          footer={(
            <>
              <Button onClick={() => setConfirming(false)} disabled={creating}>Cancel</Button>
              <Button variant="primary" loading={creating} disabled={!understood} onClick={create}>Create statements</Button>
            </>
          )}
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-fg-muted">Stores</dt><dd className="text-right tabular-nums">{preview.totals.stores}</dd>
            <dt className="text-fg-muted">Orders</dt><dd className="text-right tabular-nums">{preview.totals.orders}</dd>
            <dt className="text-fg-muted">Item total</dt><dd className="text-right"><Amount paise={preview.totals.grossPaise} /></dd>
            <dt className="text-fg-muted">ZenWe commission</dt><dd className="text-right"><Amount paise={-preview.totals.commissionPaise} /></dd>
            <dt className="text-fg-muted">Cash stalls already hold</dt><dd className="text-right"><Amount paise={preview.totals.adjustmentsPaise} /></dd>
            <dt className="font-medium text-fg">ZenWe will pay stores</dt><dd className="text-right"><Amount paise={preview.totals.zenwePaysPaise} strong /></dd>
            <dt className="font-medium text-fg">Stalls will pay ZenWe</dt><dd className="text-right"><Amount paise={preview.totals.storesPayZenwePaise} strong /></dd>
          </dl>
          <div className="mt-4">
            <Checkbox checked={understood} onChange={e => setUnderstood(e.target.checked)} label="I have checked these amounts. The statements are saved as pending; no money moves until I pay and mark each one paid." />
          </div>
        </Modal>
      )}

      {payConfirm && (
        <Modal
          open
          dismissible={!paying}
          onClose={() => setPayConfirm(false)}
          title={`Mark ${ready.length} statement${ready.length === 1 ? '' : 's'} paid?`}
          description="Only do this after the money has actually moved. Each reference is saved on its statement and cannot be changed."
          footer={(
            <>
              <Button onClick={() => setPayConfirm(false)} disabled={paying}>Cancel</Button>
              <Button variant="primary" loading={paying} onClick={markPaid}>Mark paid</Button>
            </>
          )}
        >
          <ul className="divide-y divide-line rounded-md border border-line text-sm">
            {ready.map(p => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className="truncate">{p.partnerName}</span>
                <span className="truncate font-mono text-xs text-fg-muted">{refs[p.id].method.toUpperCase()} {refs[p.id].utr.trim()}</span>
                <Amount paise={p.netPaise} strong />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-right text-sm">Net total <Amount paise={readyTotal} strong /></p>
        </Modal>
      )}
    </Card>
  );
}
