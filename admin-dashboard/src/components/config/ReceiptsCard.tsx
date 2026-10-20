"use client";
// C8 receipts & compliance: platform GSTIN, GST rate, tax display (inclusive / breakdown), footer note and the
// "hide stores without FSSAI" switch (backend/utils/receiptSettings.js). GET/PUT /api/admin/receipt-settings
// (validated + audited, ifUpdatedAt guards against overwriting another admin's change).
import { useCallback, useEffect, useState } from 'react';
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
      && !confirm('Hide every store without an FSSAI licence number from customer listings? They also cannot take new orders until a number is added. Check Stores → FSSAI: missing first.')) return;
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

  const input = 'w-full bg-surface-2/60 border border-line rounded-lg p-3 text-fg font-semibold text-sm';
  const lbl = 'text-xs font-semibold text-fg-muted ml-1';

  return (
    <div className="rounded-lg border border-line bg-surface shadow-xs p-10 space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <h4 className="text-lg font-semibold text-fg">Receipts &amp; Compliance</h4>
          <p className="text-xs text-fg-muted font-semibold">Order receipts · platform GSTIN · tax display · FSSAI listing rule</p>
        </div>
        {data && (
          <span className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-surface-2/60 border border-line text-fg-muted">
            Receipts show: {data.effectiveTaxDisplayMode === 'breakdown' ? 'GST breakdown' : 'tax inclusive'}
          </span>
        )}
      </div>

      <div className="rounded-lg border border-warning/30 bg-warning-soft p-4 text-xs leading-relaxed text-warning-text">
        <p className="font-semibold text-xs text-warning-text mb-1">Set tax details on your CA&apos;s advice</p>
        Receipts print exactly what is saved here. Enter a GSTIN and GST rate only if your chartered accountant has
        confirmed them. Never type placeholder or made-up values.
      </div>

      {loadError && (
        <div className="flex items-center gap-3">
          <p className="text-xs font-semibold text-danger-text">{loadError}</p>
          <button onClick={load} className="px-3 py-1.5 bg-surface-2/60 border border-line rounded-xl text-xs font-semibold text-fg-muted">Retry</button>
        </div>
      )}

      {data && form && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2 md:col-span-2">
              <label htmlFor="rc-gstin" className={lbl}>Platform GSTIN (optional)</label>
              <input id="rc-gstin" className={`${input} `} maxLength={15} autoComplete="off" spellCheck={false} value={form.platformGstin} onChange={e => set('platformGstin', e.target.value)} />
              {gstin && !gstinOk && <p className="text-xs text-warning-text ml-1">15 characters in the GST format.</p>}
            </div>
            <div className="space-y-2">
              <label htmlFor="rc-rate" className={lbl}>GST rate % (optional)</label>
              <input id="rc-rate" className={input} inputMode="decimal" value={form.gstRatePercent} onChange={e => set('gstRatePercent', e.target.value.replace(/[^\d.]/g, ''))} />
              {rateText && !rateOk && <p className="text-xs text-warning-text ml-1">Above 0 and at most 28, up to 2 decimals.</p>}
            </div>
          </div>

          <fieldset className="space-y-3">
            <legend className={lbl}>Tax display on receipts</legend>
            <label className="flex items-start gap-3 rounded-lg border border-line bg-surface-2/60 p-4 cursor-pointer">
              <input type="radio" name="rc-mode" className="mt-1 accent-[rgb(var(--accent))]" checked={form.taxDisplayMode === 'inclusive'} onChange={() => set('taxDisplayMode', 'inclusive')} />
              <span>
                <span className="block text-sm font-semibold text-fg">Inclusive</span>
                <span className="block text-xs text-fg-muted">Receipts say &quot;{data.inclusiveNote}&quot; and show no separate GST lines.</span>
              </span>
            </label>
            <label className={`flex items-start gap-3 rounded-lg border border-line bg-surface-2/60 p-4 ${breakdownPossible ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
              <input type="radio" name="rc-mode" className="mt-1 accent-[rgb(var(--accent))]" disabled={!breakdownPossible} checked={form.taxDisplayMode === 'breakdown'} onChange={() => set('taxDisplayMode', 'breakdown')} />
              <span>
                <span className="block text-sm font-semibold text-fg">GST breakdown</span>
                <span className="block text-xs text-fg-muted">
                  Shows the GST contained in the amounts already charged, at the rate above. It never changes what anyone
                  pays. Use it only on your CA&apos;s advice.
                </span>
                {!breakdownPossible && <span className="block text-xs text-warning-text mt-1">Needs both a valid platform GSTIN and a GST rate first.</span>}
              </span>
            </label>
            {form.taxDisplayMode === 'breakdown' && !breakdownPossible && (
              <p className="text-xs text-warning-text">The GSTIN or rate is missing, so this saves as &quot;Inclusive&quot;.</p>
            )}
          </fieldset>

          <div className="space-y-2">
            <label htmlFor="rc-footer" className={lbl}>Receipt footer note (optional)</label>
            <textarea id="rc-footer" rows={2} maxLength={FOOTER_MAX} className={input} value={form.footerNote} onChange={e => set('footerNote', e.target.value)} />
            <p className="text-xs text-fg-muted ml-1">{form.footerNote.trim().length}/{FOOTER_MAX} · printed at the bottom of every receipt.</p>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-2/60 p-4">
            <button
              type="button"
              role="switch"
              id="rc-hide"
              aria-checked={form.hideStoresWithoutFssai}
              onClick={() => set('hideStoresWithoutFssai', !form.hideStoresWithoutFssai)}
              className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${form.hideStoresWithoutFssai ? 'bg-accent' : 'bg-surface-3'}`}
            >
              <span aria-hidden className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${form.hideStoresWithoutFssai ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
            <label htmlFor="rc-hide" className="cursor-pointer">
              <span className="block text-sm font-semibold text-fg">Hide stores without an FSSAI licence number from customer listings (they also cannot take new orders)</span>
              <span className="block text-xs text-fg-muted">Off by default. Only whether a number is on file counts; expiry and admin checks do not hide a store.</span>
            </label>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <button onClick={save} disabled={saving} className="px-6 py-3 bg-accent hover:bg-accent-hover disabled:opacity-50 rounded-lg text-xs font-semibold text-on-solid">
              {saving ? 'Saving…' : 'Save receipt settings'}
            </button>
            {error && <p className="text-xs font-semibold text-danger-text">{error}</p>}
            {notice && <p className="text-xs font-semibold text-success-text">{notice}</p>}
          </div>
        </>
      )}
    </div>
  );
}
