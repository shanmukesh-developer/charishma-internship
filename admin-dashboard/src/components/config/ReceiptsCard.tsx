"use client";
// C8 receipts & compliance: platform GSTIN, GST rate, tax display (inclusive / breakdown), footer note and the
// "hide stores without FSSAI" switch (backend/utils/receiptSettings.js). GET/PUT /api/admin/receipt-settings
// (validated + audited, ifUpdatedAt guards against overwriting another admin's change).
import {
  Badge, Button, Card, CardBody, CardFooter, CardHeader, Field, Input, LoadingState, Notice, Switch, Textarea, useConfirm,
} from '@/components/ui';
import React, { useCallback, useEffect, useState } from 'react';
import { adminRequest as apiRequest, ApiError } from '@/lib/api';

type TaxMode = 'inclusive' | 'breakdown';
interface Settings {
  platformGstin: string;
  taxDisplayMode: TaxMode;
  gstRatePercent: number | null;
  footerNote: string;
  hideStoresWithoutFssai: boolean;
}
interface ReceiptResponse {
  settings: Settings;
  defaults: Settings;
  effectiveTaxDisplayMode: TaxMode;
  breakdownAllowed: boolean;
  inclusiveNote: string;
  updatedAt: string | null;
  changed?: boolean;
}
interface Form { platformGstin: string; gstRatePercent: string; taxDisplayMode: TaxMode; footerNote: string; hideStoresWithoutFssai: boolean }

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const FOOTER_MAX = 300;

const formFrom = (s: Settings): Form => ({
  platformGstin: s.platformGstin || '',
  gstRatePercent: s.gstRatePercent == null ? '' : String(s.gstRatePercent),
  taxDisplayMode: s.taxDisplayMode,
  footerNote: s.footerNote || '',
  hideStoresWithoutFssai: !!s.hideStoresWithoutFssai,
});
const validRate = (n: number) => Number.isFinite(n) && n > 0 && n <= 28 && Math.round(n * 100) === n * 100;

export default function ReceiptsCard() {
  const confirm = useConfirm();
  const [data, setData] = useState<ReceiptResponse | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const d = await apiRequest<ReceiptResponse>('/api/admin/receipt-settings');
      setData(d);
      setForm(formFrom(d.settings));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load receipt settings.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { if (form) { setForm({ ...form, [k]: v }); setNotice(null); } };

  const gstin = form ? form.platformGstin.trim().toUpperCase().replace(/\s/g, '') : '';
  const rateText = form ? form.gstRatePercent.trim() : '';
  const rate = rateText === '' ? null : Number(rateText);
  const gstinOk = !!gstin && GSTIN_RE.test(gstin);
  const rateOk = rate !== null && validRate(rate);
  const breakdownPossible = gstinOk && rateOk;

  const save = async () => {
    if (!data || !form || saving) return;
    setError(null);
    setNotice(null);
    if (gstin && !GSTIN_RE.test(gstin)) return setError('Platform GSTIN must be 15 characters in the GST format.');
    if (rate !== null && !validRate(rate)) return setError('GST rate must be a percentage above 0 and at most 28, with up to 2 decimals.');
    if (form.footerNote.trim().length > FOOTER_MAX) return setError(`Footer note must be at most ${FOOTER_MAX} characters.`);
    if (/[<>]/.test(form.footerNote)) return setError('Footer note cannot contain < or >.');
    const mode: TaxMode = form.taxDisplayMode === 'breakdown' && !breakdownPossible ? 'inclusive' : form.taxDisplayMode;
    if (form.hideStoresWithoutFssai && !data.settings.hideStoresWithoutFssai
      && !(await confirm({ title: 'Hide stores without an FSSAI licence number?', description: 'They disappear from customer listings and cannot take new orders until a number is added. Check Stores, filter FSSAI: missing, first.', confirmLabel: 'Hide stores', tone: 'danger' }))) return;
    setSaving(true);
    try {
      const d = await apiRequest<ReceiptResponse>('/api/admin/receipt-settings', {
        method: 'PUT',
        body: JSON.stringify({
          platformGstin: gstin,
          gstRatePercent: rate,
          taxDisplayMode: mode,
          footerNote: form.footerNote.trim(),
          hideStoresWithoutFssai: form.hideStoresWithoutFssai,
          ifUpdatedAt: data.updatedAt || undefined,
        }),
      });
      setData(d);
      setForm(formFrom(d.settings));
      setNotice(d.changed === false ? 'No change to save.' : 'Saved. New receipts use it right away.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.code === 'CONFIG_CONFLICT') {
        // The 409 carries the fresh settings: show them so the admin can re-apply their change.
        const fresh = err.data as Partial<ReceiptResponse> | null;
        if (fresh && fresh.settings) {
          setData(fresh as ReceiptResponse);
          setForm(formFrom(fresh.settings));
        } else load();
      }
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const modeOption = (value: TaxMode, title: string, body: React.ReactNode, disabled = false) => (
    <label className={`flex items-start gap-3 rounded-lg border p-3 ${form?.taxDisplayMode === value ? 'border-accent/50 bg-accent-soft/40' : 'border-line'} ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-surface-2'}`}>
      <input type="radio" name="rc-mode" className="mt-1 accent-[rgb(var(--accent))]" disabled={disabled} checked={form?.taxDisplayMode === value} onChange={() => set('taxDisplayMode', value)} />
      <span>
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="block text-xs text-fg-muted">{body}</span>
      </span>
    </label>
  );

  return (
    <Card>
      <CardHeader
        title="Receipts and compliance"
        description="Order receipts, platform GSTIN, tax display and the FSSAI listing rule. New receipts use changes right away."
        actions={data ? <Badge>Receipts show: {data.effectiveTaxDisplayMode === 'breakdown' ? 'GST breakdown' : 'tax inclusive'}</Badge> : undefined}
      />
      <CardBody className="space-y-5">
        <Notice tone="warning" title="Set tax details on your CA’s advice">
          Receipts print exactly what is saved here. Enter a GSTIN and GST rate only if your chartered accountant has
          confirmed them. Never type placeholder or made-up values.
        </Notice>

        {loadError && <Notice tone="danger" action={<Button size="sm" onClick={load}>Retry</Button>}>{loadError}</Notice>}
        {!data && !loadError && <LoadingState label="Loading receipt settings…" />}

        {data && form && (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Platform GSTIN" optional className="md:col-span-2" error={gstin && !gstinOk ? '15 characters in the GST format.' : undefined}>
                <Input className="font-mono uppercase" maxLength={15} autoComplete="off" spellCheck={false} value={form.platformGstin} onChange={e => set('platformGstin', e.target.value)} />
              </Field>
              <Field label="GST rate %" optional error={rateText && !rateOk ? 'Above 0 and at most 28, up to 2 decimals.' : undefined}>
                <Input inputMode="decimal" value={form.gstRatePercent} onChange={e => set('gstRatePercent', e.target.value.replace(/[^\d.]/g, ''))} />
              </Field>
            </div>

            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-sm font-medium text-fg">Tax display on receipts</legend>
              {modeOption('inclusive', 'Inclusive', <>Receipts say “{data.inclusiveNote}” and show no separate GST lines.</>)}
              {modeOption('breakdown', 'GST breakdown', (
                <>
                  Shows the GST contained in the amounts already charged, at the rate above. It never changes what anyone pays. Use it only on your CA’s advice.
                  {!breakdownPossible && <span className="mt-1 block text-warning-text">Needs both a valid platform GSTIN and a GST rate first.</span>}
                </>
              ), !breakdownPossible)}
              {form.taxDisplayMode === 'breakdown' && !breakdownPossible && (
                <p className="text-xs text-warning-text">The GSTIN or rate is missing, so this saves as “Inclusive”.</p>
              )}
            </fieldset>

            <Field label="Receipt footer note" optional hint={`${form.footerNote.trim().length}/${FOOTER_MAX} · printed at the bottom of every receipt.`}>
              <Textarea rows={2} maxLength={FOOTER_MAX} value={form.footerNote} onChange={e => set('footerNote', e.target.value)} />
            </Field>

            <Switch
              checked={form.hideStoresWithoutFssai}
              onChange={v => set('hideStoresWithoutFssai', v)}
              label="Hide stores without an FSSAI licence number"
              description="Hidden stores also cannot take new orders. Off by default. Only whether a number is on file counts; expiry and admin checks do not hide a store."
            />

            {error && <Notice tone="danger">{error}</Notice>}
            {notice && <Notice tone="success">{notice}</Notice>}
          </>
        )}
      </CardBody>
      {data && form && (
        <CardFooter>
          <Button variant="primary" loading={saving} onClick={save}>Save receipt settings</Button>
        </CardFooter>
      )}
    </Card>
  );
}
