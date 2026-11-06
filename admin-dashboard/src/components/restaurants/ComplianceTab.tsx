"use client";
// C8 seller compliance: legal name, FSSAI licence, GSTIN, PAN (write-only, shown masked), payout UPI and bank
// details. Saved with PUT /api/admin/restaurants/:id/compliance (validated + audited server side); FSSAI checked
// with POST /api/admin/restaurants/:id/fssai-verification. The full PAN is never shown. The bank account number
// (6 Nov 2026: stores are paid by bank too) is typed twice, stored encrypted and shown here only as ••••1234;
// admins can reveal it on the Revenue page (audited).
import { useEffect, useMemo, useState } from 'react';
import {
  FSSAI_STATUS_META, FssaiLicenseType, Store, StoreCompliance, adminRequest, fssaiStatusOf, storeId,
} from '@/app/restaurants/catalogue';
import { ApiError } from '@/lib/api';
import { Button, Callout, Chip, Field, INPUT, SELECT, cx, useToast } from './ui';

type FormKey = 'legalName' | 'fssaiLicenseNumber' | 'fssaiLicenseType' | 'fssaiExpiry' | 'gstin' | 'payoutUpiId' | 'bankAccountHolder' | 'bankIfsc' | 'bankName' | 'bankBranch';
type Form = Record<FormKey, string>;
type ErrorKey = FormKey | 'pan' | 'bankAccountNumber' | 'bankAccountNumberConfirm' | 'bankAccountLast4';

const FORM_KEYS: FormKey[] = ['legalName', 'fssaiLicenseNumber', 'fssaiLicenseType', 'fssaiExpiry', 'gstin', 'payoutUpiId', 'bankAccountHolder', 'bankIfsc', 'bankName', 'bankBranch'];
const FSSAI_KEYS: FormKey[] = ['fssaiLicenseNumber', 'fssaiLicenseType', 'fssaiExpiry'];
const FSSAI_TYPES: { value: FssaiLicenseType; label: string }[] = [
  { value: 'BASIC', label: 'Basic (registration)' },
  { value: 'STATE', label: 'State licence' },
  { value: 'CENTRAL', label: 'Central licence' },
];

// Mirrors backend utils/storeCompliance.js (the server re-checks everything).
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const UPI_RE = /^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9.-]{1,63}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** Compliance view of a store row: `compliance` when sent, else the flat fields. */
export function complianceOf(store: Store): StoreCompliance {
  const c = store.compliance;
  if (c) return c;
  const st = fssaiStatusOf(store);
  return {
    legalName: store.legalName ?? null,
    fssaiLicenseNumber: store.fssaiLicenseNumber ?? null,
    fssaiLicenseType: store.fssaiLicenseType ?? null,
    fssaiExpiry: store.fssaiExpiry ?? null,
    fssaiSubmittedAt: store.fssaiSubmittedAt ?? null,
    fssaiVerifiedAt: store.fssaiVerifiedAt ?? null,
    fssaiVerifiedBy: store.fssaiVerifiedBy ?? null,
    fssaiStatus: st.status,
    fssaiExpiringSoon: st.expiringSoon,
    fssaiText: store.fssaiLicenseNumber ? `FSSAI Lic. No. ${store.fssaiLicenseNumber}` : 'FSSAI licence not provided',
    gstin: store.gstin ?? null,
    panMasked: store.panMasked ?? null,
    hasPan: !!store.panMasked,
    payoutUpiId: store.payoutUpiId ?? null,
    bankAccountHolder: store.bankAccountHolder ?? null,
    bankAccountLast4: store.bankAccountLast4 ?? null,
    bankIfsc: store.bankIfsc ?? null,
    bankName: store.bankName ?? null,
    bankBranch: store.bankBranch ?? null,
  };
}

const formFrom = (c: StoreCompliance): Form => ({
  legalName: c.legalName || '',
  fssaiLicenseNumber: c.fssaiLicenseNumber || '',
  fssaiLicenseType: c.fssaiLicenseType || '',
  fssaiExpiry: c.fssaiExpiry || '',
  gstin: c.gstin || '',
  payoutUpiId: c.payoutUpiId || '',
  bankAccountHolder: c.bankAccountHolder || '',
  bankIfsc: c.bankIfsc || '',
  bankName: c.bankName || '',
  bankBranch: c.bankBranch || '',
});

const norm = (k: FormKey, v: string) => {
  const t = v.trim();
  if (k === 'fssaiLicenseNumber') return t.replace(/[\s-]/g, '');
  if (k === 'gstin' || k === 'bankIfsc') return t.toUpperCase().replace(/\s/g, '');
  if (k === 'payoutUpiId') return t.toLowerCase();
  if (k === 'legalName' || k === 'bankAccountHolder' || k === 'bankName' || k === 'bankBranch') return t.replace(/\s+/g, ' ');
  return t;
};

function validate(form: Form, pan: string, bankAccount: string, bankAccountAgain: string): Partial<Record<ErrorKey, string>> {
  const e: Partial<Record<ErrorKey, string>> = {};
  const v = (k: FormKey) => norm(k, form[k]);
  if (v('legalName') && (v('legalName').length < 2 || v('legalName').length > 200)) e.legalName = 'Legal name must be 2 to 200 characters.';
  if (v('fssaiLicenseNumber') && !/^\d{14}$/.test(v('fssaiLicenseNumber'))) e.fssaiLicenseNumber = 'FSSAI licence number must be exactly 14 digits.';
  if (v('fssaiExpiry') && !/^\d{4}-\d{2}-\d{2}$/.test(v('fssaiExpiry'))) e.fssaiExpiry = 'Use a real date.';
  if (v('gstin') && !GSTIN_RE.test(v('gstin'))) e.gstin = 'GSTIN must be 15 characters in the GST format.';
  const p = pan.trim().toUpperCase().replace(/\s/g, '');
  if (p && !PAN_RE.test(p)) e.pan = 'PAN must be 10 characters (5 letters, 4 digits, 1 letter).';
  if (v('payoutUpiId') && (v('payoutUpiId').length > 256 || !UPI_RE.test(v('payoutUpiId')))) e.payoutUpiId = 'Payout UPI ID must look like name@bank.';
  if (v('bankAccountHolder') && (v('bankAccountHolder').length < 2 || v('bankAccountHolder').length > 120)) e.bankAccountHolder = 'Account holder name must be 2 to 120 characters.';
  const acct = bankAccount.replace(/[\s-]/g, '');
  if (acct && !/^\d{9,18}$/.test(acct)) e.bankAccountNumber = 'Bank account number must be 9 to 18 digits.';
  else if (acct && bankAccountAgain.replace(/[\s-]/g, '') !== acct) e.bankAccountNumberConfirm = 'The two account numbers do not match.';
  for (const k of ['bankName', 'bankBranch'] as const) if (v(k) && (v(k).length < 2 || v(k).length > 120)) e[k] = 'Must be 2 to 120 characters.';
  if (v('bankIfsc') && !IFSC_RE.test(v('bankIfsc'))) e.bankIfsc = 'IFSC must be 11 characters (4 letters, 0, then 6 letters or digits), e.g. SBIN0001234.';
  return e;
}

const when = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
};

interface ComplianceResponse { success?: boolean; compliance: StoreCompliance; changed?: boolean }

export function ComplianceTab({ store, onChanged }: { store: Store; onChanged: (s: Store) => void }) {
  const toast = useToast();
  const id = storeId(store);
  const current = useMemo(() => complianceOf(store), [store]);
  const initial = useMemo(() => formFrom(current), [current]);
  const [form, setForm] = useState<Form>(initial);
  const [pan, setPan] = useState('');
  const [clearPan, setClearPan] = useState(false);
  const [bankAccount, setBankAccount] = useState('');
  const [bankAccountAgain, setBankAccountAgain] = useState('');
  const [clearBank, setClearBank] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<ErrorKey, string>>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');

  const changedKeys = FORM_KEYS.filter(k => norm(k, form[k]) !== norm(k, initial[k]));
  const dirty = changedKeys.length > 0 || !!pan.trim() || clearPan || !!bankAccount.trim() || clearBank;
  const fssaiDirty = changedKeys.some(k => FSSAI_KEYS.includes(k));
  // A live update from elsewhere refreshes the form when there are no local edits.
  useEffect(() => { if (!dirty) setForm(initial); }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: FormKey, v: string) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })); setFormError(''); };

  const apply = (c: StoreCompliance) => {
    onChanged({
      ...store,
      legalName: c.legalName, fssaiLicenseNumber: c.fssaiLicenseNumber, fssaiLicenseType: c.fssaiLicenseType, fssaiExpiry: c.fssaiExpiry,
      fssaiSubmittedAt: c.fssaiSubmittedAt, fssaiVerifiedAt: c.fssaiVerifiedAt, fssaiVerifiedBy: c.fssaiVerifiedBy, gstin: c.gstin,
      panMasked: c.panMasked, payoutUpiId: c.payoutUpiId, bankAccountHolder: c.bankAccountHolder, bankAccountLast4: c.bankAccountLast4,
      bankIfsc: c.bankIfsc, bankName: c.bankName, bankBranch: c.bankBranch, compliance: c,
    });
  };

  const save = async () => {
    if (saving || !dirty) return;
    const e = validate(form, pan, bankAccount, bankAccountAgain);
    setErrors(e);
    setFormError('');
    if (Object.values(e).some(Boolean)) return;
    const body: Record<string, string | null> = {};
    for (const k of changedKeys) { const v = norm(k, form[k]); body[k] = v === '' ? null : v; }
    // Write-only fields are sent only when the admin typed a new value (or asked to clear them).
    if (clearPan) body.pan = null;
    else if (pan.trim()) body.pan = pan.trim().toUpperCase().replace(/\s/g, '');
    if (clearBank) body.bankAccountLast4 = null;
    else if (bankAccount.trim()) { body.bankAccountNumber = bankAccount.replace(/[\s-]/g, ''); body.bankAccountNumberConfirm = bankAccountAgain.replace(/[\s-]/g, ''); }
    setSaving(true);
    try {
      const d = await adminRequest<ComplianceResponse>(`/api/admin/restaurants/${id}/compliance`, { method: 'PUT', body: JSON.stringify(body) });
      setPan(''); setClearPan(false); setBankAccount(''); setBankAccountAgain(''); setClearBank(false);
      setForm(formFrom(d.compliance));
      apply(d.compliance);
      toast.success(d.changed === false ? 'No change to save.' : fssaiDirty && current.fssaiVerifiedAt ? 'Saved. The FSSAI details changed, so the licence needs checking again.' : 'Licences, tax and payout details saved.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save.';
      const field = err instanceof ApiError ? err.field : null;
      const key = field === 'bankAccountLast4' ? 'bankAccountNumber' : field;
      if (key && (FORM_KEYS as string[]).concat(['pan', 'bankAccountNumber', 'bankAccountNumberConfirm']).includes(key)) setErrors(prev => ({ ...prev, [key as ErrorKey]: msg }));
      else setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const verify = async (verified: boolean) => {
    if (verifying) return;
    setVerifying(true);
    setVerifyError('');
    try {
      const d = await adminRequest<ComplianceResponse>(`/api/admin/restaurants/${id}/fssai-verification`, { method: 'POST', body: JSON.stringify({ verified }) });
      apply(d.compliance);
      toast.success(verified ? 'FSSAI licence marked as checked.' : 'FSSAI verification removed.');
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Could not update the verification.');
    } finally {
      setVerifying(false);
    }
  };

  const meta = FSSAI_STATUS_META[current.fssaiStatus];
  const input = (k: FormKey, ids: { id: string; msgId: string; invalid: boolean }, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={ids.id} aria-describedby={ids.msgId} aria-invalid={ids.invalid} autoComplete="off" spellCheck={false} className={INPUT} value={form[k]} onChange={e => set(k, e.target.value)} {...extra} />
  );

  return (
    <div className="max-w-3xl space-y-6">
      <Callout tone="sky" title="Licences, tax & payout">
        Enter only what the store has given you (licence certificate, GST registration, bank or UPI proof). Nothing here is checked
        with FSSAI, GSTN or the bank automatically: the server checks the format and records every change in the audit log.
      </Callout>

      {/* FSSAI verification */}
      <section className="space-y-3 rounded-xl border border-line bg-surface-2/60 p-4" aria-labelledby="fssai-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="fssai-title" className="text-sm font-semibold">FSSAI licence check</h3>
          <span className="flex flex-wrap gap-1.5">
            <Chip tone={meta.tone} dot title={meta.help}>{meta.label}</Chip>
            {current.fssaiExpiringSoon && <Chip tone="amber">Expires soon{current.fssaiExpiry ? ` (${current.fssaiExpiry})` : ''}</Chip>}
          </span>
        </div>
        <p className="text-sm text-fg-muted">{current.fssaiText}{current.fssaiLicenseType ? ` · ${current.fssaiLicenseType}` : ''}{current.fssaiExpiry ? ` · expires ${current.fssaiExpiry}` : ''}</p>
        {current.fssaiVerifiedAt ? (
          <p className="text-xs text-fg-muted">Checked {when(current.fssaiVerifiedAt)}{current.fssaiVerifiedBy ? ` by admin ${current.fssaiVerifiedBy.slice(0, 8)}` : ''}.</p>
        ) : current.fssaiSubmittedAt ? (
          <p className="text-xs text-fg-muted">Submitted {when(current.fssaiSubmittedAt)}, not checked yet.</p>
        ) : null}
        <p className="text-xs text-fg-muted">Check the number and expiry against the store&apos;s licence certificate before marking it as checked.</p>
        <div className="flex flex-wrap items-center gap-2">
          {current.fssaiStatus === 'VERIFIED' ? (
            <Button size="sm" variant="danger" loading={verifying} onClick={() => verify(false)}>Revoke verification</Button>
          ) : (
            <Button size="sm" variant="primary" loading={verifying} disabled={current.fssaiStatus === 'MISSING' || current.fssaiStatus === 'EXPIRED' || fssaiDirty} onClick={() => verify(true)}>Mark as checked</Button>
          )}
          {fssaiDirty && <span className="text-xs text-warning-text">Save the FSSAI changes first.</span>}
          {current.fssaiStatus === 'MISSING' && <span className="text-xs text-fg-muted">Add the licence number below first.</span>}
          {current.fssaiStatus === 'EXPIRED' && <span className="text-xs text-fg-muted">Enter the renewed licence&apos;s expiry date first.</span>}
        </div>
        {verifyError && <Callout tone="red">{verifyError}</Callout>}
      </section>

      {/* Business + FSSAI */}
      <section className="space-y-4" aria-labelledby="legal-title">
        <h3 id="legal-title" className="text-sm font-semibold">Business &amp; food licence</h3>
        <Field label="Legal name" optional error={errors.legalName} help="The registered business or owner name, as on the licence.">
          {ids => input('legalName', ids, { maxLength: 200 })}
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field className="sm:col-span-3" label="FSSAI licence number" optional error={errors.fssaiLicenseNumber} help="Exactly 14 digits, from the licence or registration certificate.">
            {ids => input('fssaiLicenseNumber', ids, { inputMode: 'numeric', maxLength: 20 })}
          </Field>
          <Field label="Licence type" optional error={errors.fssaiLicenseType}>
            {({ id: fid, msgId, invalid }) => (
              <select id={fid} aria-describedby={msgId} aria-invalid={invalid} className={SELECT} value={form.fssaiLicenseType} onChange={e => set('fssaiLicenseType', e.target.value)}>
                <option value="">Not set</option>
                {FSSAI_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            )}
          </Field>
          <Field label="Expiry date" optional error={errors.fssaiExpiry}>
            {ids => input('fssaiExpiry', ids, { type: 'date' })}
          </Field>
        </div>
        {fssaiDirty && current.fssaiVerifiedAt && <Callout tone="amber">Changing the FSSAI number, type or expiry removes the current verification. Check the licence again after saving.</Callout>}
      </section>

      {/* Tax */}
      <section className="space-y-4 border-t border-line pt-5" aria-labelledby="tax-title">
        <h3 id="tax-title" className="text-sm font-semibold">Tax</h3>
        <Field label="GSTIN" optional error={errors.gstin} help="15 characters in the GST format. Leave empty if the store is not GST-registered.">
          {ids => input('gstin', ids, { maxLength: 15, className: cx(INPUT, '') })}
        </Field>
        <Field
          label={current.hasPan ? 'Replace PAN' : 'PAN'}
          optional
          error={errors.pan}
          help={current.hasPan ? `On file: ${current.panMasked || 'masked'}. The full PAN is never shown. Type a new one only to replace it.` : '10 characters. Stored privately and only ever shown masked.'}
        >
          {({ id: fid, msgId, invalid }) => (
            <div className="space-y-2">
              <input id={fid} aria-describedby={msgId} aria-invalid={invalid} autoComplete="off" spellCheck={false} maxLength={10} disabled={clearPan} className={cx(INPUT, '')} value={pan} placeholder={current.hasPan ? 'New PAN (leave empty to keep)' : ''} onChange={e => { setPan(e.target.value); setErrors(er => ({ ...er, pan: undefined })); }} />
              {current.hasPan && (
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={clearPan} onChange={e => { setClearPan(e.target.checked); if (e.target.checked) setPan(''); }} />
                  Remove the PAN on file
                </label>
              )}
            </div>
          )}
        </Field>
      </section>

      {/* Payout */}
      <section className="space-y-4 border-t border-line pt-5" aria-labelledby="payout-title">
        <h3 id="payout-title" className="text-sm font-semibold">Payout</h3>
        <p className="text-xs text-fg-muted">Only ZenWe admins can change payout details (the store app cannot), so a stolen store login cannot redirect payouts. Confirm any change with the owner directly.</p>
        <Field label="Payout UPI ID" optional error={errors.payoutUpiId} help="Like name@bank.">
          {ids => input('payoutUpiId', ids, { maxLength: 256 })}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bank account holder" optional error={errors.bankAccountHolder}>
            {ids => input('bankAccountHolder', ids, { maxLength: 120 })}
          </Field>
          <Field label="IFSC" optional error={errors.bankIfsc} help="11 characters, e.g. SBIN0001234.">
            {ids => input('bankIfsc', ids, { maxLength: 11, className: cx(INPUT, '') })}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bank name" optional error={errors.bankName} help="e.g. State Bank of India.">
            {ids => input('bankName', ids, { maxLength: 120 })}
          </Field>
          <Field label="Branch" optional error={errors.bankBranch}>
            {ids => input('bankBranch', ids, { maxLength: 120 })}
          </Field>
        </div>
        <Field
          label="Bank account number"
          optional
          error={errors.bankAccountNumber}
          help={`9 to 18 digits. Saved encrypted; shown as ••••1234.${current.bankAccountLast4 ? ` On file: ••••${current.bankAccountLast4}.` : ''} Leave empty to keep it.`}
        >
          {({ id: fid, msgId, invalid }) => (
            <div className="space-y-2">
              <input id={fid} aria-describedby={msgId} aria-invalid={invalid} autoComplete="off" inputMode="numeric" maxLength={24} disabled={clearBank} className={INPUT} value={bankAccount} onChange={e => { setBankAccount(e.target.value.replace(/[^\d\s-]/g, '')); setErrors(er => ({ ...er, bankAccountNumber: undefined })); }} />
              {bankAccount.trim() && (
                <input aria-label="Bank account number again" placeholder="Type the account number again" autoComplete="off" inputMode="numeric" maxLength={24} className={INPUT} value={bankAccountAgain} onPaste={e => e.preventDefault()} onChange={e => { setBankAccountAgain(e.target.value.replace(/[^\d\s-]/g, '')); setErrors(er => ({ ...er, bankAccountNumberConfirm: undefined })); }} />
              )}
              {errors.bankAccountNumberConfirm && <p className="text-xs text-danger-text">{errors.bankAccountNumberConfirm}</p>}
              {current.bankAccountLast4 && (
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={clearBank} onChange={e => { setClearBank(e.target.checked); if (e.target.checked) setBankAccount(''); }} />
                  Remove the account ••••{current.bankAccountLast4}
                </label>
              )}
            </div>
          )}
        </Field>
      </section>

      {formError && <Callout tone="red">{formError}</Callout>}
      <div className="flex items-center gap-3">
        <Button variant="primary" loading={saving} disabled={!dirty} onClick={save}>{dirty ? 'Save details' : 'Saved'}</Button>
        {dirty && <Button variant="ghost" onClick={() => { setForm(initial); setPan(''); setClearPan(false); setBankAccount(''); setBankAccountAgain(''); setClearBank(false); setErrors({}); setFormError(''); }}>Undo changes</Button>}
      </div>
    </div>
  );
}
