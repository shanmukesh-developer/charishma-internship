"use client";
// Revenue page: "To settle" (one card per payment cycle, ONE action each) and "Waiting for payment".
//
// Create statements is a guided 3-step dialog: 1 Review (the exact statements, totals, cutoff) -> 2 Confirm (tick
// "I have checked these amounts") -> 3 Done (what was created, Mark paid on each). Mark paid asks for the UTR /
// UPI reference, shows the amount and where to send it (UPI ID and / or bank account), and confirms. A store with
// neither cannot be marked paid ("Add payment details first"; the server refuses it too). The app never sends money.
//
// Every money request: the button is disabled while it runs, only one runs at a time, it carries an
// Idempotency-Key that is reused when the admin presses Try again (so a retry after a dropped connection never
// creates or pays twice; the server replays the first answer), a toast says what happened, and the page reloads
// every number from the server afterwards. Nothing is updated optimistically.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminRequest } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, IconAlert, IconCheckCircle, IconRefresh, Input, Modal, Notice, Select, Skeleton, cn, useToast,
} from '@/components/ui';
import { CopyButton, Money } from './RevenueBits';
import { PaymentSummary, type PaymentTarget } from './PaymentDetails';
import {
  CYCLES, MISSING, checkPreview, cycleLabel, errCode, errText, newIdempotencyKey, paymentOf, plural, rupees, rupeesAbs,
  type Cycle, type MarkPaidResult, type PaymentInfo, type SettlePreview, type SettleResult, type Statement,
} from './revenueModel';

type PreviewState = { data: SettlePreview | null; error: string | null; loading: boolean };
const EMPTY_STATE: PreviewState = { data: null, error: null, loading: true };

export interface PayTarget { statement: Statement; payment: PaymentInfo }
type EditPayment = (t: PaymentTarget) => void;

/* ───────────────────────────────────────────── shared bits */

const direction = (net: number) => (net > 0 ? 'ZenWe pays the store' : net < 0 ? 'Store pays ZenWe' : 'Nothing to pay');

function Steps({ step }: { step: 1 | 2 | 3 }) {
  const names = ['Review', 'Confirm', 'Done'];
  return (
    <ol className="mb-4 flex items-center gap-2 text-xs" aria-label="Steps">
      {names.map((n, i) => {
        const k = (i + 1) as 1 | 2 | 3;
        const state = k < step ? 'done' : k === step ? 'now' : 'next';
        return (
          <li key={n} className="flex items-center gap-2" aria-current={state === 'now' ? 'step' : undefined}>
            <span className={cn('flex h-5 w-5 items-center justify-center rounded-full font-semibold tabular-nums', state === 'now' ? 'bg-accent text-accent-fg' : state === 'done' ? 'bg-success-soft text-success-text' : 'bg-surface-2 text-fg-subtle')}>{k}</span>
            <span className={state === 'next' ? 'text-fg-subtle' : 'font-medium text-fg'}>{n}</span>
            {k < 3 && <span className="h-px w-6 bg-line" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

/* ───────────────────────────────────────────── Create statements (3 steps) */

function SettleDialog({ preview, onClose, onChanged, onPay, onEditPayment }: { preview: SettlePreview; onClose: () => void; onChanged: () => void; onPay: (t: PayTarget) => void; onEditPayment: EditPayment }) {
  const toast = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [checked, setChecked] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  const [result, setResult] = useState<SettleResult | null>(null);
  const key = useRef(newIdempotencyKey('settle')); // one key for this plan; reused by Try again
  const inFlight = useRef(false);
  const t = preview.totals;
  const payOf = useMemo(() => new Map(preview.stores.map(s => [s.storeId, s.payment || paymentOf(null, s.payoutUpiId)])), [preview]);
  const payFor = (id: string) => payOf.get(id) || paymentOf(null);
  const noDetails = preview.stores.filter(s => s.netPaise > 0 && !payFor(s.storeId).canPay).length;

  const create = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    setError(null);
    try {
      const r = await adminRequest<SettleResult>('/api/admin/revenue/settle', {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current },
        body: JSON.stringify({
          cycle: preview.cycle, cutoff: preview.cutoff, planHash: preview.planHash,
          expected: preview.stores.map(s => ({ storeId: s.storeId, orderCount: s.orderCount, netPaise: s.netPaise })),
        }),
      });
      setResult({ ...r, created: r.created || [], alreadySettled: r.alreadySettled || [], changed: r.changed || [], skipped: r.skipped || [], failed: r.failed || [] });
      setStep(3);
      const made = (r.created || []).length;
      const problems = (r.changed || []).length + (r.failed || []).length;
      if (made && !problems) toast.success(`${plural(made, 'statement')} created. Now pay each store and mark it paid.`);
      else if (made) toast.warning(`${plural(made, 'statement')} created; ${problems} store${problems === 1 ? '' : 's'} need a fresh look.`);
      else toast.info('No new statements: everything up to the cutoff was already on a statement.');
    } catch (e) {
      const code = errCode(e);
      setError({ message: errText(e, 'Could not create the statements.'), code });
      toast.error('Statements were not created. See the message in the dialog.');
    } finally {
      inFlight.current = false;
      setRunning(false);
      onChanged(); // always reload from the server: after a failure some stores may still have been saved
    }
  };

  const stale = error && (error.code === 'CUTOFF_CHANGED' || error.code === 'INVALID_INPUT');
  return (
    <Modal
      open
      size="xl"
      dismissible={!running}
      onClose={onClose}
      title={`Create ${cycleLabel(preview.cycle).toLowerCase()} statements`}
      description={preview.cutoffLabel}
      footer={step === 1 ? (
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => setStep(2)}>Next: confirm</Button>
        </>
      ) : step === 2 ? (
        <>
          <Button onClick={() => setStep(1)} disabled={running}>Back</Button>
          {error && !stale ? (
            <Button variant="primary" loading={running} onClick={create}>Try again</Button>
          ) : (
            <Button variant="primary" loading={running} disabled={!checked || !!stale} onClick={create}>Create {plural(t.stores, 'statement')}</Button>
          )}
        </>
      ) : (
        <Button variant="primary" onClick={onClose}>Close</Button>
      )}
    >
      <Steps step={step} />
      {step === 1 && (
        <>
          <p className="mb-3 text-sm text-fg-muted">
            These statements will be saved as <b className="text-fg">waiting for payment</b>. One per store, covering every delivered order up to the cutoff that is not on a statement yet. No money moves.
          </p>
          {noDetails > 0 && <Notice tone="warning" className="mb-3">{plural(noDetails, 'store')} below {noDetails === 1 ? 'has' : 'have'} no UPI ID and no bank account. You can create the statement, but you cannot mark it paid until you add payment details.</Notice>}
          <div className="max-h-[45vh] overflow-auto rounded-md border border-line">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
              <thead className="text-xs text-fg-muted [&_th]:sticky [&_th]:top-0 [&_th]:border-b [&_th]:border-line [&_th]:bg-surface-2 [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium">
                <tr><th className="text-left">Store</th><th className="text-right">Orders</th><th className="text-right">Sales</th><th className="text-right">Commission</th><th className="text-right">Cash stall kept</th><th className="text-right">Statement</th></tr>
              </thead>
              <tbody className="[&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2">
                {preview.stores.map(s => (
                  <tr key={s.storeId}>
                    <td>
                      <p className="font-medium text-fg">{s.name}</p>
                      <p className="text-xs text-fg-muted">{s.kind === 'vendor' ? 'Stall' : 'Restaurant'}{s.firstDeliveredAt ? ` · orders from ${formatDate(s.firstDeliveredAt)}` : ''}</p>
                      {s.netPaise > 0 && (payFor(s.storeId).canPay
                        ? <PaymentSummary payment={payFor(s.storeId)} name={s.name} compact />
                        : <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs"><span className="font-medium text-warning-text">Add payment details first</span><Button size="sm" onClick={() => onEditPayment({ storeId: s.storeId, name: s.name })}>Add payment details</Button></p>)}
                    </td>
                    <td className="text-right tabular-nums">{s.orderCount}</td>
                    <td className="text-right"><Money paise={s.grossPaise} /></td>
                    <td className="text-right"><Money paise={-s.commissionPaise} neutral /></td>
                    <td className="text-right"><Money paise={s.adjustmentsPaise} neutral /></td>
                    <td className="text-right">
                      <Money paise={s.netPaise < 0 ? -s.netPaise : s.netPaise} strong className={s.netPaise < 0 ? 'text-danger-text' : ''} />
                      <p className="whitespace-nowrap text-xs text-fg-muted">{direction(s.netPaise)}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-fg-muted">Statements</dt><dd className="font-semibold tabular-nums">{t.stores}</dd></div>
            <div><dt className="text-xs text-fg-muted">Orders</dt><dd className="font-semibold tabular-nums">{t.orders}</dd></div>
            <div><dt className="text-xs text-fg-muted">ZenWe will pay stores</dt><dd><Money paise={t.zenwePaysPaise} strong /></dd></div>
            <div><dt className="text-xs text-fg-muted">Stalls will pay ZenWe</dt><dd><Money paise={t.storesPayZenwePaise} strong /></dd></div>
          </dl>
        </>
      )}
      {step === 2 && (
        <div className="grid gap-3">
          <div className="rounded-lg border border-line bg-surface-2/60 p-4 text-center">
            <p className="text-sm text-fg-muted">ZenWe will owe stores</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-fg">{rupees(t.zenwePaysPaise)}</p>
            <p className="mt-1 text-sm text-fg-muted">
              across {plural(t.stores, 'statement')} and {plural(t.orders, 'order')}
              {t.storesPayZenwePaise > 0 ? <> · stalls will owe ZenWe <b className="text-fg">{rupees(t.storesPayZenwePaise)}</b></> : null}
            </p>
            <p className="mt-1 text-xs text-fg-subtle">{preview.cutoffLabel}</p>
          </div>
          <Checkbox
            checked={checked}
            disabled={running}
            onChange={e => setChecked(e.target.checked)}
            label="I have checked these amounts."
            description="The statements are saved as waiting for payment. No money moves until you pay each store yourself and mark it paid."
          />
          {error && (
            <Notice tone="danger" title={stale ? 'The numbers changed since you opened this' : 'Statements were not created'}>
              {error.message}
              {stale ? ' Close this, look at the refreshed numbers, and start again.' : ' Press Try again: it is safe, nothing will be created twice.'}
            </Notice>
          )}
        </div>
      )}
      {step === 3 && result && (
        <div className="grid gap-3 text-sm">
          <Notice tone={result.changed.length || result.failed.length ? 'warning' : 'success'} title={result.message || 'Done'} />
          {result.created.length > 0 && (
            <div className="overflow-hidden rounded-md border border-line">
              <p className="border-b border-line bg-surface-2 px-3 py-2 text-xs font-medium text-fg-muted">Created, waiting for payment</p>
              <ul className="divide-y divide-line">
                {result.created.map(p => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="font-medium text-fg">{p.partnerName || MISSING}</p>
                      <p className="text-xs text-fg-muted">{plural(p.orderCount, 'order')} · {direction(p.netPaise)}</p>
                      {p.netPaise > 0 && <PaymentSummary payment={payFor(p.partnerId)} name={p.partnerName || 'store'} compact />}
                    </div>
                    <div className="flex items-center gap-3">
                      <Money paise={Math.abs(p.netPaise)} strong className={p.netPaise < 0 ? 'text-danger-text' : ''} />
                      {p.netPaise > 0 && !payFor(p.partnerId).canPay ? (
                        <Button size="sm" onClick={() => onEditPayment({ storeId: p.partnerId, name: p.partnerName || 'store' })}>Add payment details first</Button>
                      ) : p.netPaise !== 0 && <Button size="sm" variant="primary" onClick={() => onPay({ statement: p, payment: payFor(p.partnerId) })}>Mark paid…</Button>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {[...result.alreadySettled.map(s => ({ k: s.storeId, n: s.name, m: 'already on a statement, nothing new.' })),
            ...result.changed.map(s => ({ k: s.storeId, n: s.name, m: `numbers changed since the review, not settled. ${s.message}` })),
            ...result.skipped.map(s => ({ k: s.storeId, n: s.name, m: s.reason })),
            ...result.failed.map(s => ({ k: s.storeId, n: s.name, m: s.message }))].length > 0 && (
            <ul className="grid gap-1 rounded-md border border-line px-3 py-2 text-fg-muted">
              {result.alreadySettled.map(s => <li key={`a${s.storeId}`}><b className="text-fg">{s.name || s.storeId}</b>: already on a statement, nothing new.</li>)}
              {result.changed.map(s => <li key={`c${s.storeId}`} className="text-warning-text"><b>{s.name || s.storeId}</b>: numbers changed since the review, so it was not settled. Create statements again to include it.</li>)}
              {result.skipped.map(s => <li key={`s${s.storeId}`}><b className="text-fg">{s.name || s.storeId}</b>: {s.reason}</li>)}
              {result.failed.map(s => <li key={`f${s.storeId}`} className="text-danger-text"><b>{s.name || s.storeId}</b>: {s.message}</li>)}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ───────────────────────────────────────────── Mark paid */

export function MarkPaidDialog({ target, onClose, onChanged, onEditPayment }: { target: PayTarget; onClose: () => void; onChanged: () => void; onEditPayment: EditPayment }) {
  const toast = useToast();
  const { statement: p, payment } = target;
  const [method, setMethod] = useState(payment.hasUpi || !payment.hasBank ? 'upi' : 'bank');
  const [fullAcct, setFullAcct] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [utr, setUtr] = useState('');
  const [sent, setSent] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | 'paid' | 'already'>(null);
  const key = useRef(newIdempotencyKey('markpaid'));
  const inFlight = useRef(false);
  const ref = utr.trim();
  const refOk = ref.length >= 3;
  const toStore = p.netPaise > 0;
  const blocked = toStore && !payment.canPay;
  const methodOk = !toStore || (method === 'upi' ? payment.hasUpi : payment.hasBank);

  const reveal = async () => {
    if (fullAcct) { setFullAcct(null); return; }
    setRevealing(true);
    try {
      const raw = await adminRequest<Record<string, unknown>>(`/api/admin/revenue/stores/${encodeURIComponent(p.partnerId)}/payment-details?reveal=1`);
      if (typeof raw.bankAccountNumber === 'string' && raw.bankAccountNumber) setFullAcct(raw.bankAccountNumber);
      else toast.error(typeof raw.revealProblem === 'string' && raw.revealProblem ? raw.revealProblem : 'No full account number is saved for this store.');
    } catch (e) {
      toast.error(errText(e, 'Could not show the account number.'));
    } finally {
      setRevealing(false);
    }
  };

  const submit = async () => {
    if (inFlight.current || !refOk || !sent || blocked || !methodOk) return;
    inFlight.current = true;
    setRunning(true);
    setError(null);
    try {
      const r = await adminRequest<MarkPaidResult>('/api/admin/revenue/settle/mark-paid', {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current },
        body: JSON.stringify({ items: [{ payoutId: p.id, utr: ref, method }] }),
      });
      const failed = (r.failed || []).find(f => f.payoutId === p.id);
      if (failed) {
        // The server finished and refused this one (e.g. a different reference is already saved): a new attempt is a new action.
        key.current = newIdempotencyKey('markpaid');
        setError(failed.message || 'Not marked paid.');
        toast.error(`${p.partnerName || 'Statement'} was not marked paid.`);
      } else if ((r.alreadyPaid || []).some(x => x.id === p.id)) {
        setDone('already');
        toast.info(`${p.partnerName || 'Statement'} was already marked paid with this reference.`);
      } else {
        setDone('paid');
        toast.success(`${p.partnerName || 'Statement'} marked paid (${rupeesAbs(p.netPaise)}, ref ${ref}).`);
      }
    } catch (e) {
      setError(`${errText(e, 'Could not mark it paid.')} Press Try again: it is safe, it will never be marked twice.`);
      toast.error('Not marked paid. See the message in the dialog.');
    } finally {
      inFlight.current = false;
      setRunning(false);
      onChanged();
    }
  };

  return (
    <Modal
      open
      dismissible={!running}
      onClose={onClose}
      title={done ? 'Marked paid' : `Mark paid: ${p.partnerName || 'statement'}`}
      description={done ? undefined : 'Only after the money has actually moved. The reference is saved on the statement and cannot be changed later.'}
      footer={done ? <Button variant="primary" onClick={onClose}>Close</Button> : (
        <>
          <Button onClick={onClose} disabled={running}>Cancel</Button>
          {blocked
            ? <Button variant="primary" onClick={() => { onClose(); onEditPayment({ storeId: p.partnerId, name: p.partnerName || 'store' }); }}>Add payment details first</Button>
            : <Button variant="primary" loading={running} disabled={!refOk || !sent || !methodOk} onClick={submit}>{error ? 'Try again' : `Mark ${rupeesAbs(p.netPaise)} paid`}</Button>}
        </>
      )}
    >
      {done ? (
        <div className="flex items-start gap-3 text-sm">
          <IconCheckCircle size={20} className="mt-0.5 shrink-0 text-success-text" />
          <p className="text-fg">
            {p.partnerName}: <b>{rupeesAbs(p.netPaise)}</b> is recorded as paid with reference <span className="font-mono">{ref}</span>.
            {done === 'already' ? ' (It had already been saved with this reference, so nothing changed.)' : ''} The numbers on the page are refreshed.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="rounded-lg border border-line bg-surface-2/60 p-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-fg-muted">{toStore ? 'Pay the store' : 'The store pays ZenWe'}</span>
              <span className="text-2xl font-semibold tabular-nums text-fg">{rupeesAbs(p.netPaise)}</span>
            </div>
            {toStore ? (
              <div className="mt-2 grid gap-1 border-t border-line pt-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-fg-muted">UPI ID</span>
                  {payment.payoutUpiId ? <span className="inline-flex items-center gap-1 font-mono text-xs">{payment.payoutUpiId}<CopyButton value={payment.payoutUpiId} label="Copy UPI ID" /></span> : <span className="text-xs text-fg-subtle">not set</span>}
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-fg-muted">Bank account</span>
                  {payment.hasBank ? (
                    <span className="inline-flex flex-wrap items-center justify-end gap-1 text-xs">
                      <span className="font-mono">{fullAcct || payment.bankAccountMasked}</span>
                      {fullAcct && <CopyButton value={fullAcct} label="Copy account number" />}
                      <button type="button" onClick={reveal} disabled={revealing} className="text-accent-text hover:underline">{fullAcct ? 'Hide' : revealing ? '…' : 'Show'}</button>
                    </span>
                  ) : <span className="text-xs text-fg-subtle">not set</span>}
                </div>
                {payment.hasBank && (
                  <p className="text-right text-xs text-fg-muted">
                    {[payment.bankAccountHolder, payment.bankIfsc && `IFSC ${payment.bankIfsc}`, payment.bankName, payment.bankBranch].filter(Boolean).join(' · ')}
                    {payment.bankIfsc && <CopyButton value={payment.bankIfsc} label="Copy IFSC" />}
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-1 flex items-baseline justify-between gap-3"><span className="text-fg-muted">Store</span><span>{p.partnerName}</span></div>
            )}
            <p className="mt-1 text-xs text-fg-subtle">{plural(p.orderCount, 'order')} · up to {formatDateTime(p.periodEnd)} · statement created {formatDate(p.createdAt)}</p>
          </div>
          {blocked && (
            <Notice tone="warning" title="Add payment details first">
              This store has no UPI ID and no bank account, so there is nowhere known to send the money. Add the details, then come back to mark it paid.
            </Notice>
          )}
          <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
            <Field label="Paid by" error={!methodOk ? (method === 'upi' ? 'No UPI ID on file.' : 'No bank account on file.') : undefined}>
              <Select value={method} onChange={e => setMethod(e.target.value)} disabled={running || blocked} aria-label="Payment method">
                <option value="upi">UPI</option>
                <option value="bank">Bank transfer</option>
              </Select>
            </Field>
            <Field label="UTR / UPI reference" hint="From your bank or UPI app, e.g. 431298765432. At least 3 characters." error={utr && !refOk ? 'Too short.' : undefined}>
              <Input value={utr} onChange={e => setUtr(e.target.value)} maxLength={120} disabled={running || blocked} placeholder="431298765432" autoFocus aria-label="UTR / UPI reference" />
            </Field>
          </div>
          <Checkbox
            checked={sent}
            disabled={running || blocked}
            onChange={e => setSent(e.target.checked)}
            label={toStore
              ? `I have sent ${rupeesAbs(p.netPaise)} to ${p.partnerName || 'this store'} by ${method === 'upi' ? `UPI${payment.payoutUpiId ? ` (${payment.payoutUpiId})` : ''}` : `bank transfer${payment.bankAccountMasked ? ` (${payment.bankAccountMasked})` : ''}`}.`
              : `I have received ${rupeesAbs(p.netPaise)} from ${p.partnerName || 'this store'}.`}
          />
          {error && <Notice tone="danger" title="Not marked paid">{error}</Notice>}
        </div>
      )}
    </Modal>
  );
}

/* ───────────────────────────────────────────── the panel */

export default function SettlePanel({ refreshKey, onChanged, onEditPayment }: { refreshKey: number; onChanged: () => void; onEditPayment: EditPayment }) {
  const [state, setState] = useState<Record<Cycle, PreviewState>>({ daily: EMPTY_STATE, weekly: EMPTY_STATE, monthly: EMPTY_STATE });
  const [settling, setSettling] = useState<SettlePreview | null>(null);
  const [paying, setPaying] = useState<PayTarget | null>(null);
  const seq = useRef(0);

  const loadOne = useCallback(async (c: Cycle) => {
    setState(s => ({ ...s, [c]: { ...s[c], loading: true } }));
    try {
      const data = checkPreview(await adminRequest<unknown>(`/api/admin/revenue/settle/preview?cycle=${c}`));
      setState(s => ({ ...s, [c]: { data, error: null, loading: false } }));
    } catch (e) {
      // Keep nothing stale: a preview that failed to load cannot be settled from.
      setState(s => ({ ...s, [c]: { data: null, error: errText(e, 'Could not load.'), loading: false } }));
    }
  }, []);
  const loadAll = useCallback(() => {
    const id = ++seq.current;
    return Promise.all(CYCLES.map(c => loadOne(c.value))).then(() => id);
  }, [loadOne]);
  useEffect(() => { loadAll(); }, [loadAll, refreshKey]);

  const changed = useCallback(() => { onChanged(); }, [onChanged]);

  // Every statement waiting for payment (all cycles), oldest first, with its store's UPI ID.
  const pending = useMemo(() => {
    const seen = new Map<string, PayTarget>();
    for (const c of CYCLES) {
      const d = state[c.value].data;
      if (!d) continue;
      for (const st of d.pendingStatements) {
        if (!seen.has(st.id)) seen.set(st.id, { statement: st, payment: st.payment || paymentOf(null, st.payoutUpiId) });
      }
    }
    return [...seen.values()].sort((a, b) => String(a.statement.createdAt).localeCompare(String(b.statement.createdAt)));
  }, [state]);
  const anyLoading = CYCLES.some(c => state[c.value].loading);
  const pendingLoaded = CYCLES.every(c => state[c.value].data);
  const owedTotal = pending.reduce((a, p) => a + (p.statement.netPaise > 0 ? p.statement.netPaise : 0), 0);

  return (
    <>
      <Card className="mb-4">
        <CardHeader
          title="To settle"
          description="Delivered orders not on a statement yet, up to each cycle's cutoff (India time). Creating statements does not send money."
          actions={<Button size="sm" leftIcon={<IconRefresh size={14} />} loading={anyLoading} onClick={() => loadAll()}>Refresh</Button>}
        />
        <CardBody className="grid gap-3 md:grid-cols-3">
          {CYCLES.map(({ value: c, label }) => {
            const s = state[c];
            const d = s.data;
            return (
              <div key={c} className="flex min-w-0 flex-col rounded-lg border border-line bg-surface-2/40 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-fg">{label}</p>
                  {d && <Badge tone="neutral">{plural(d.storesInCycle, 'store')}</Badge>}
                </div>
                {s.loading && !d ? (
                  <div className="mt-3 grid gap-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-8 w-28" /><Skeleton className="h-8 w-full" /></div>
                ) : s.error ? (
                  <div className="mt-3 text-sm">
                    <p className="flex items-start gap-1.5 text-danger-text"><IconAlert size={14} className="mt-0.5 shrink-0" />{s.error}</p>
                    <Button size="sm" className="mt-2" onClick={() => loadOne(c)}>Try again</Button>
                  </div>
                ) : d && (
                  <>
                    <p className="mt-1 text-xs text-fg-muted">{d.cutoffLabel}</p>
                    {d.stores.length === 0 ? (
                      <p className="mt-3 flex-1 text-sm text-fg-muted">Nothing to settle. Every delivered order up to the cutoff is already on a statement.</p>
                    ) : (
                      <div className="mt-3 flex-1">
                        <p className="text-xs text-fg-muted">ZenWe will owe {plural(d.stores.filter(x => x.netPaise > 0).length, 'store')}</p>
                        <p className="text-2xl font-semibold tabular-nums text-fg">{rupees(d.totals.zenwePaysPaise)}</p>
                        <p className="text-xs text-fg-muted">
                          {plural(d.totals.orders, 'order')}
                          {d.totals.storesPayZenwePaise > 0 ? <> · stalls owe ZenWe <span className="font-medium text-danger-text">{rupees(d.totals.storesPayZenwePaise)}</span></> : null}
                        </p>
                      </div>
                    )}
                    <Button
                      variant={d.stores.length ? 'primary' : 'secondary'}
                      className="mt-3 w-full"
                      disabled={!d.stores.length || s.loading || !!settling}
                      onClick={() => setSettling(d)}
                    >
                      {d.stores.length ? `Review & create ${plural(d.totals.stores, 'statement')}` : 'Nothing to settle'}
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader
          title={`Waiting for payment${pendingLoaded ? ` (${pending.length})` : ''}`}
          description={pending.length ? <>Statements saved but not paid yet. ZenWe owes <b className="text-fg">{rupees(owedTotal)}</b> on them. Pay each store by UPI or bank, then press Mark paid.</> : 'Statements saved but not paid yet.'}
        />
        {!pendingLoaded && anyLoading ? (
          <CardBody><Skeleton className="h-16 w-full" /></CardBody>
        ) : pending.length === 0 ? (
          <CardBody><p className="py-4 text-center text-sm text-fg-muted">{pendingLoaded ? 'Nothing waiting for payment.' : 'Could not load every cycle above, so this list may be incomplete.'}</p></CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] border-separate border-spacing-0 text-sm">
              <thead className="text-xs text-fg-muted [&_th]:border-b [&_th]:border-line [&_th]:bg-surface-2 [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium">
                <tr><th className="text-left">Store</th><th className="hidden text-left lg:table-cell">Covers</th><th className="text-right">Amount</th><th className="text-left">Send to</th><th className="text-right"><span className="sr-only">Action</span></th></tr>
              </thead>
              <tbody className="[&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2">
                {pending.map(t => {
                  const p = t.statement;
                  return (
                    <tr key={p.id}>
                      <td><p className="font-medium text-fg">{p.partnerName || MISSING}</p><p className="text-xs text-fg-muted">{p.partnerType === 'vendor' ? 'Stall' : 'Restaurant'}</p></td>
                      <td className="hidden text-xs text-fg-muted lg:table-cell">{plural(p.orderCount, 'order')} up to {formatDateTime(p.periodEnd)}<br />created {formatDate(p.createdAt)}</td>
                      <td className="text-right">
                        <Money paise={Math.abs(p.netPaise)} strong className={p.netPaise < 0 ? 'text-danger-text' : ''} />
                        <p className="whitespace-nowrap text-xs text-fg-muted">{direction(p.netPaise)}</p>
                      </td>
                      <td>{p.netPaise > 0 ? <PaymentSummary payment={t.payment} name={p.partnerName || 'store'} /> : <span className="text-xs text-fg-subtle">{MISSING}</span>}</td>
                      <td className="text-right">
                        {p.netPaise > 0 && !t.payment.canPay
                          ? <Button size="sm" onClick={() => onEditPayment({ storeId: p.partnerId, name: p.partnerName || 'store' })}>Add payment details first</Button>
                          : <Button size="sm" variant="primary" disabled={!!paying} onClick={() => setPaying(t)}>Mark paid…</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {settling && (
        <SettleDialog
          preview={settling}
          onClose={() => setSettling(null)}
          onChanged={changed}
          onPay={t => { setSettling(null); setPaying(t); }}
          // The details drawer opens on its own (a dialog would cover it); review again after saving.
          onEditPayment={t => { setSettling(null); onEditPayment(t); }}
        />
      )}
      {paying && <MarkPaidDialog key={paying.statement.id} target={paying} onClose={() => setPaying(null)} onChanged={changed} onEditPayment={onEditPayment} />}
    </>
  );
}
