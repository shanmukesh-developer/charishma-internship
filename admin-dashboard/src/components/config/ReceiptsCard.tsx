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

  const input = 'w-full bg-white/5 border border-white/10 rounded-2xl p-3 text-white font-bold text-sm';
  const lbl = 'text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1';

  return (
    <div className="glass-card p-10 space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="w-10 h-10 bg-sky-600/20 rounded-xl flex items-center justify-center text-xl">🧾</div>
        <div className="flex-1 min-w-[200px]">
          <h4 className="text-lg font-black text-white uppercase tracking-tight">Receipts &amp; Compliance</h4>
          <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Order receipts · platform GSTIN · tax display · FSSAI listing rule</p>
        </div>
        {data && (
          <span className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white/5 border border-white/10 text-gray-300">
            Receipts show: {data.effectiveTaxDisplayMode === 'breakdown' ? 'GST breakdown' : 'tax inclusive'}
          </span>
        )}
      </div>

      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-[12px] leading-relaxed text-amber-100">
        <p className="font-black uppercase tracking-widest text-[10px] text-amber-300 mb-1">Set tax details on your CA&apos;s advice</p>
        Receipts print exactly what is saved here. Enter a GSTIN and GST rate only if your chartered accountant has
        confirmed them. Never type placeholder or made-up values.
      </div>

      {loadError && (
        <div className="flex items-center gap-3">
          <p className="text-xs font-bold text-red-400">{loadError}</p>
          <button onClick={load} className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase text-gray-300">Retry</button>
        </div>
      )}

      {data && form && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2 md:col-span-2">
              <label htmlFor="rc-gstin" className={lbl}>Platform GSTIN (optional)</label>
              <input id="rc-gstin" className={`${input} uppercase`} maxLength={15} autoComplete="off" spellCheck={false} value={form.platformGstin} onChange={e => set('platformGstin', e.target.value)} />
              {gstin && !gstinOk && <p className="text-[11px] text-amber-300 ml-1">15 characters in the GST format.</p>}
            </div>
            <div className="space-y-2">
              <label htmlFor="rc-rate" className={lbl}>GST rate % (optional)</label>
              <input id="rc-rate" className={input} inputMode="decimal" value={form.gstRatePercent} onChange={e => set('gstRatePercent', e.target.value.replace(/[^\d.]/g, ''))} />
              {rateText && !rateOk && <p className="text-[11px] text-amber-300 ml-1">Above 0 and at most 28, up to 2 decimals.</p>}
            </div>
          </div>

          <fieldset className="space-y-3">
            <legend className={lbl}>Tax display on receipts</legend>
            <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4 cursor-pointer">
              <input type="radio" name="rc-mode" className="mt-1 accent-blue-500" checked={form.taxDisplayMode === 'inclusive'} onChange={() => set('taxDisplayMode', 'inclusive')} />
              <span>
                <span className="block text-sm font-black text-white">Inclusive</span>
                <span className="block text-[11px] text-gray-400">Receipts say &quot;{data.inclusiveNote}&quot; and show no separate GST lines.</span>
              </span>
            </label>
            <label className={`flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4 ${breakdownPossible ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
              <input type="radio" name="rc-mode" className="mt-1 accent-blue-500" disabled={!breakdownPossible} checked={form.taxDisplayMode === 'breakdown'} onChange={() => set('taxDisplayMode', 'breakdown')} />
              <span>
                <span className="block text-sm font-black text-white">GST breakdown</span>
                <span className="block text-[11px] text-gray-400">
                  Shows the GST contained in the amounts already charged, at the rate above. It never changes what anyone
                  pays. Use it only on your CA&apos;s advice.
                </span>
                {!breakdownPossible && <span className="block text-[11px] text-amber-300 mt-1">Needs both a valid platform GSTIN and a GST rate first.</span>}
              </span>
            </label>
            {form.taxDisplayMode === 'breakdown' && !breakdownPossible && (
              <p className="text-[11px] text-amber-300">The GSTIN or rate is missing, so this saves as &quot;Inclusive&quot;.</p>
            )}
          </fieldset>

          <div className="space-y-2">
            <label htmlFor="rc-footer" className={lbl}>Receipt footer note (optional)</label>
            <textarea id="rc-footer" rows={2} maxLength={FOOTER_MAX} className={input} value={form.footerNote} onChange={e => set('footerNote', e.target.value)} />
            <p className="text-[11px] text-gray-500 ml-1">{form.footerNote.trim().length}/{FOOTER_MAX} · printed at the bottom of every receipt.</p>
          </div>

          <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <button
              type="button"
              role="switch"
              id="rc-hide"
              aria-checked={form.hideStoresWithoutFssai}
              onClick={() => set('hideStoresWithoutFssai', !form.hideStoresWithoutFssai)}
              className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${form.hideStoresWithoutFssai ? 'bg-amber-500' : 'bg-white/15'}`}
            >
              <span aria-hidden className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${form.hideStoresWithoutFssai ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
            <label htmlFor="rc-hide" className="cursor-pointer">
              <span className="block text-sm font-black text-white">Hide stores without an FSSAI licence number from customer listings (they also cannot take new orders)</span>
              <span className="block text-[11px] text-gray-400">Off by default. Only whether a number is on file counts; expiry and admin checks do not hide a store.</span>
            </label>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <button onClick={save} disabled={saving} className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white">
              {saving ? 'Saving…' : 'Save receipt settings'}
            </button>
            {error && <p className="text-xs font-bold text-red-400">{error}</p>}
            {notice && <p className="text-xs font-bold text-emerald-400">{notice}</p>}
          </div>
        </>
      )}
    </div>
  );
}
