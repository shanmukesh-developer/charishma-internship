"use client";
// Store payment details on the Revenue page (owner, 6 Nov 2026): where ZenWe sends a store's money.
//   PaymentSummary  compact, masked view (UPI ID + bank ••••1234) with copy; "Add payment details" when none.
//   PaymentDetailsDrawer  view + edit: UPI ID, account holder, account number typed twice, IFSC, bank, branch.
// Read:   GET /api/admin/revenue/stores/:id/payment-details (masked); ?reveal=1 shows the full account number
//         (audited STORE_BANK_DETAILS_REVEALED on the server; hidden again after 60 s here).
// Save:   PUT /api/admin/restaurants/:id/compliance (backend utils/storeCompliance: validated, audited masked).
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminRequest, ApiError } from '@/lib/api';
import { Button, Drawer, Field, IconEye, IconEyeOff, Input, Notice, Skeleton, useToast } from '@/components/ui';
import { CopyButton } from './RevenueBits';
import { errText, paymentOf, type PaymentInfo } from './revenueModel';

export interface PaymentTarget { storeId: string; name: string }

/** Masked payment details for a table cell or a settle row. */
export function PaymentSummary({ payment, name, onEdit, compact = false }: { payment: PaymentInfo; name: string; onEdit?: () => void; compact?: boolean }) {
  if (!payment.canPay) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-medium text-warning-text">No UPI or bank details</span>
        {onEdit && <Button size="sm" variant="secondary" onClick={onEdit}>{compact ? 'Add details' : 'Add payment details'}</Button>}
      </span>
    );
  }
  return (
    <div className="min-w-0 text-xs">
      {payment.payoutUpiId && (
        <p className="flex items-center gap-1"><span className="text-fg-subtle">UPI</span><span className={`${compact ? "max-w-[9rem]" : "max-w-[14rem]"} truncate font-mono text-fg`} title={payment.payoutUpiId}>{payment.payoutUpiId}</span><CopyButton value={payment.payoutUpiId} label={`Copy UPI ID of ${name}`} /></p>
      )}
      {payment.hasBank && (
        <p className="flex flex-wrap items-center gap-x-1 text-fg-muted">
          <span className="text-fg-subtle">Bank</span>
          <span className="font-mono text-fg">{payment.bankAccountMasked || '••••'}</span>
          {!compact && payment.bankIfsc && <span className="font-mono">{payment.bankIfsc}</span>}
          {!compact && payment.bankName && <span>· {payment.bankName}</span>}
        </p>
      )}
      {onEdit && <button type="button" onClick={onEdit} className="text-accent-text hover:underline">Payment details</button>}
    </div>
  );
}

interface Loaded extends PaymentInfo { storeId: string; name: string; bankAccountNumber?: string | null; revealProblem?: string | null }

const UPI_RE = /^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9.-]{1,63}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
type Key = 'payoutUpiId' | 'bankAccountHolder' | 'bankIfsc' | 'bankName' | 'bankBranch' | 'bankAccountNumber' | 'bankAccountNumberConfirm';

export function PaymentDetailsDrawer({ target, onClose, onSaved }: { target: PaymentTarget; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [form, setForm] = useState<Record<Key, string>>({ payoutUpiId: '', bankAccountHolder: '', bankIfsc: '', bankName: '', bankBranch: '', bankAccountNumber: '', bankAccountNumberConfirm: '' });
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const raw = await adminRequest<Record<string, unknown>>(`/api/admin/revenue/stores/${encodeURIComponent(target.storeId)}/payment-details`);
      const d: Loaded = { ...paymentOf(raw), storeId: target.storeId, name: typeof raw.name === 'string' ? raw.name : target.name };
      setData(d);
      setForm({ payoutUpiId: d.payoutUpiId || '', bankAccountHolder: d.bankAccountHolder || '', bankIfsc: d.bankIfsc || '', bankName: d.bankName || '', bankBranch: d.bankBranch || '', bankAccountNumber: '', bankAccountNumberConfirm: '' });
    } catch (e) {
      setLoadError(errText(e, 'Could not load the payment details.'));
    }
  }, [target]);
  useEffect(() => { load(); return () => { if (hideTimer.current) clearTimeout(hideTimer.current); }; }, [load]);

  const reveal = async () => {
    if (full) { setFull(null); return; }
    setRevealing(true);
    try {
      const raw = await adminRequest<Record<string, unknown>>(`/api/admin/revenue/stores/${encodeURIComponent(target.storeId)}/payment-details?reveal=1`);
      if (typeof raw.bankAccountNumber === 'string' && raw.bankAccountNumber) {
        setFull(raw.bankAccountNumber);
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setFull(null), 60_000);
      } else {
        toast.error(typeof raw.revealProblem === 'string' && raw.revealProblem ? raw.revealProblem : 'No full account number is saved for this store.');
      }
    } catch (e) {
      toast.error(errText(e, 'Could not show the account number.'));
    } finally {
      setRevealing(false);
    }
  };

  const set = (k: Key, v: string) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })); setSaveError(null); };
  const clean = {
    payoutUpiId: form.payoutUpiId.trim().toLowerCase(),
    bankAccountHolder: form.bankAccountHolder.trim().replace(/\s+/g, ' '),
    bankIfsc: form.bankIfsc.trim().toUpperCase().replace(/\s/g, ''),
    bankName: form.bankName.trim().replace(/\s+/g, ' '),
    bankBranch: form.bankBranch.trim().replace(/\s+/g, ' '),
    bankAccountNumber: form.bankAccountNumber.replace(/[\s-]/g, ''),
    bankAccountNumberConfirm: form.bankAccountNumberConfirm.replace(/[\s-]/g, ''),
  };
  const before: Record<string, string> = data ? { payoutUpiId: data.payoutUpiId || '', bankAccountHolder: data.bankAccountHolder || '', bankIfsc: data.bankIfsc || '', bankName: data.bankName || '', bankBranch: data.bankBranch || '' } : {};
  const changed = (['payoutUpiId', 'bankAccountHolder', 'bankIfsc', 'bankName', 'bankBranch'] as const).filter(k => clean[k] !== (before[k] || ''));
  const dirty = changed.length > 0 || !!clean.bankAccountNumber;

  const save = async () => {
    if (saving || !dirty) return;
    const e: Partial<Record<Key, string>> = {};
    if (clean.payoutUpiId && !UPI_RE.test(clean.payoutUpiId)) e.payoutUpiId = 'UPI ID must look like name@bank.';
    if (clean.bankIfsc && !IFSC_RE.test(clean.bankIfsc)) e.bankIfsc = 'IFSC is 11 characters: 4 letters, 0, then 6 letters or digits (e.g. SBIN0001234).';
    if (clean.bankAccountNumber && !/^\d{9,18}$/.test(clean.bankAccountNumber)) e.bankAccountNumber = 'Account number must be 9 to 18 digits.';
    else if (clean.bankAccountNumber && clean.bankAccountNumber !== clean.bankAccountNumberConfirm) e.bankAccountNumberConfirm = 'The two account numbers do not match.';
    for (const k of ['bankAccountHolder', 'bankName', 'bankBranch'] as const) if (clean[k] && (clean[k].length < 2 || clean[k].length > 120)) e[k] = 'Must be 2 to 120 characters.';
    const willHaveAccount = !!clean.bankAccountNumber || !!data?.hasBank;
    if (clean.bankAccountNumber && !clean.bankIfsc) e.bankIfsc = 'Add the IFSC too, so the bank transfer can be made.';
    if (willHaveAccount && !clean.bankAccountHolder) e.bankAccountHolder = 'Add the account holder name too.';
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    const body: Record<string, string | null> = {};
    for (const k of changed) body[k] = clean[k] || null;
    if (clean.bankAccountNumber) { body.bankAccountNumber = clean.bankAccountNumber; body.bankAccountNumberConfirm = clean.bankAccountNumberConfirm; }
    setSaving(true);
    setSaveError(null);
    try {
      await adminRequest(`/api/admin/restaurants/${encodeURIComponent(target.storeId)}/compliance`, { method: 'PUT', body: JSON.stringify(body) });
      toast.success(`Payment details of ${target.name} saved.`);
      setFull(null);
      onSaved();
      await load();
    } catch (err) {
      const field = err instanceof ApiError ? err.field : null;
      const msg = errText(err, 'Could not save the payment details.');
      if (field && field in form) setErrors(prev => ({ ...prev, [field as Key]: msg }));
      else setSaveError(msg);
      toast.error('Payment details were not saved.');
    } finally {
      setSaving(false);
    }
  };

  const input = (k: Key, label: string, help?: string, opts: { numeric?: boolean; noPaste?: boolean; disabled?: boolean; upper?: boolean; maxLength?: number } = {}) => (
    <Field label={label} hint={help} error={errors[k]}>
      <Input
        value={form[k]}
        disabled={saving || opts.disabled}
        autoComplete="off"
        inputMode={opts.numeric ? 'numeric' : undefined}
        maxLength={opts.maxLength ?? 120}
        onPaste={opts.noPaste ? e => e.preventDefault() : undefined}
        onChange={e => set(k, opts.numeric ? e.target.value.replace(/[^\d\s-]/g, '') : opts.upper ? e.target.value.toUpperCase() : e.target.value)}
      />
    </Field>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      dismissible={!saving}
      title={`Payment details: ${target.name}`}
      description="Where ZenWe sends this store's money. A UPI ID, a bank account, or both."
      footer={(
        <>
          <Button onClick={onClose} disabled={saving}>Close</Button>
          <Button variant="primary" loading={saving} disabled={!dirty || !data} onClick={save}>Save details</Button>
        </>
      )}
    >
      {loadError ? (
        <Notice tone="danger" title="Could not load" action={<Button size="sm" onClick={load}>Try again</Button>}>{loadError}</Notice>
      ) : !data ? (
        <div className="grid gap-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
      ) : (
        <div className="grid gap-5">
          <section className="rounded-lg border border-line bg-surface-2/50 p-3 text-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">On file now</p>
            {!data.canPay && <p className="text-warning-text">Nothing yet. Add a UPI ID or a bank account before paying this store.</p>}
            {data.payoutUpiId && <p className="flex items-center gap-1">UPI ID <span className="font-mono">{data.payoutUpiId}</span><CopyButton value={data.payoutUpiId} label="Copy UPI ID" /></p>}
            {(data.hasBank || data.bankAccountMasked) && (
              <div className="mt-1 grid gap-0.5">
                <p className="flex flex-wrap items-center gap-1">
                  Account <span className="font-mono">{full || data.bankAccountMasked || '—'}</span>
                  {full && <CopyButton value={full} label="Copy account number" />}
                  {data.hasBank && (
                    <Button size="sm" variant="ghost" loading={revealing} leftIcon={full ? <IconEyeOff size={13} /> : <IconEye size={13} />} onClick={reveal}>{full ? 'Hide' : 'Show'}</Button>
                  )}
                </p>
                <p className="text-fg-muted">{[data.bankAccountHolder, data.bankName, data.bankBranch, data.bankIfsc].filter(Boolean).join(' · ') || '—'}</p>
                {full && <p className="text-xs text-fg-subtle">Showing the full number is recorded in the audit log. It hides again in 60 seconds.</p>}
                {!data.hasBank && data.bankAccountMasked && <p className="text-xs text-warning-text">Only the last 4 digits are on file (from before full numbers were kept). Type the full number below to pay by bank.</p>}
              </div>
            )}
          </section>

          <section className="grid gap-3">
            <h3 className="text-sm font-semibold text-fg">UPI</h3>
            {input('payoutUpiId', 'UPI ID', 'Like name@okaxis. Leave empty to remove it.', { maxLength: 256 })}
          </section>
          <section className="grid gap-3">
            <h3 className="text-sm font-semibold text-fg">Bank account</h3>
            {input('bankAccountHolder', 'Account holder name')}
            <div className="grid gap-3 sm:grid-cols-2">
              {input('bankAccountNumber', 'Account number', data.hasBank ? `Leave empty to keep ${data.bankAccountMasked || 'the one on file'}.` : '9 to 18 digits.', { numeric: true, maxLength: 24 })}
              {input('bankAccountNumberConfirm', 'Account number again', 'Type it again (no pasting).', { numeric: true, noPaste: true, disabled: !form.bankAccountNumber.trim(), maxLength: 24 })}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {input('bankIfsc', 'IFSC', 'e.g. SBIN0001234', { upper: true, maxLength: 11 })}
              {input('bankName', 'Bank name', 'e.g. State Bank of India')}
            </div>
            {input('bankBranch', 'Branch (optional)')}
          </section>
          <p className="text-xs text-fg-subtle">Only admins can change these; the store app cannot. Every change is recorded with the old and new values masked. Confirm any change with the store owner by phone.</p>
          {saveError && <Notice tone="danger" title="Not saved">{saveError}</Notice>}
        </div>
      )}
    </Drawer>
  );
}
