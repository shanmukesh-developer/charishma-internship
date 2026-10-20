"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FIELD, LABEL, MAX_PROMO_DAYS, PGHostel, PROMO_CTA_LABEL, PROMO_LABEL_TEXT, PROMO_STATE_LABEL, PgPromotion, PromoCta, PromoLabel,
  PromoState, PromoType, parseYouTubeId, pgRequest, uploadImage, youtubeThumb,
} from './pgApi';
import { PanelMessage, errorField, errorText, inr, oneLine, textError } from './contentShared';

type Form = {
  type: PromoType; headline: string; subline: string; hostelId: string; cta: PromoCta; label: PromoLabel;
  startsAt: string; endsAt: string; isActive: boolean; imageUrl: string; youtubeUrl: string;
};

const IST_MS = 330 * 60 * 1000;
/** ISO timestamp → 'YYYY-MM-DD' of that moment in IST. */
const istDate = (iso: string | number) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
/** 'YYYY-MM-DD' → start of that day in IST (same as the backend). */
const istStart = (ymd: string) => new Date(`${ymd}T00:00:00+05:30`).getTime();
/** 'YYYY-MM-DD' → end of that day in IST (the end date is inclusive, same as the backend). */
const istEnd = (ymd: string) => new Date(`${ymd}T23:59:59.999+05:30`).getTime();
const addDays = (ymd: string, n: number) => istDate(istStart(ymd) + n * 86400000);
const dayMonth = (ms: number, withYear: boolean) => new Date(ms).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
/** "20 Oct – 19 Nov 2026" (both years shown when they differ). */
const dateWindow = (from: string, to: string) => {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '—';
  const sameYear = istDate(a).slice(0, 4) === istDate(b).slice(0, 4);
  return `${dayMonth(a, !sameYear)} – ${dayMonth(b, true)}`;
};

const emptyForm = (): Form => {
  const today = istDate(Date.now());
  return { type: 'IMAGE', headline: '', subline: '', hostelId: '', cta: 'VIEW_PG', label: 'FEATURED', startsAt: today, endsAt: addDays(today, 30), isActive: true, imageUrl: '', youtubeUrl: '' };
};
const toForm = (p: PgPromotion): Form => ({
  type: p.type, headline: p.headline, subline: p.subline || '', hostelId: p.hostelId, cta: p.cta, label: p.label,
  startsAt: istDate(p.startsAt), endsAt: istDate(p.endsAt), isActive: p.isActive, imageUrl: p.imageUrl || '',
  youtubeUrl: p.youtubeId ? `https://youtu.be/${p.youtubeId}` : '',
});

/** Mirrors backend validatePromotion. `editing` = the stored row on an update. */
function validateForm(f: Form, editing: PgPromotion | null): string | null {
  const headline = oneLine(f.headline);
  if (!headline) return 'Write a headline (up to 40 characters).';
  const t = textError(headline, 40, 'Headline') || textError(oneLine(f.subline), 60, 'Subline');
  if (t) return t;
  if (!f.hostelId) return 'Choose the PG this promotion opens.';
  if (f.cta === 'WATCH_TOUR' && f.type !== 'VIDEO') return '"Watch tour" needs a video promotion.';
  if (f.type === 'VIDEO' && !parseYouTubeId(f.youtubeUrl)) return 'Paste a YouTube link (youtube.com/watch?v=…, youtu.be/… or youtube.com/shorts/…).';
  if (f.type === 'IMAGE' && !f.imageUrl) return 'Upload the promotion image.';
  if (!f.startsAt) return 'Start date: choose a date.';
  if (!f.endsAt) return 'End date: choose a date.';
  const s = istStart(f.startsAt);
  const e = istEnd(f.endsAt);
  if (!Number.isFinite(s)) return 'Start date is not a valid date.';
  if (!Number.isFinite(e)) return 'End date is not a valid date.';
  if (e <= s) return 'The end date cannot be before the start date.';
  if (e - s > MAX_PROMO_DAYS * 86400000) return `A promotion can run for at most ${MAX_PROMO_DAYS} days.`;
  const endChanged = !editing || istDate(editing.endsAt) !== f.endsAt;
  if (endChanged && e <= Date.now()) return 'The end date is already past.';
  return null;
}

/** Body for POST (everything) or PUT (only what changed; the stored video is kept when the link is unchanged). */
function buildBody(f: Form, editing: PgPromotion | null, nextPriority: number): Record<string, unknown> {
  const full: Record<string, unknown> = {
    type: f.type, headline: oneLine(f.headline), subline: oneLine(f.subline), hostelId: f.hostelId, cta: f.cta, label: f.label,
    startsAt: f.startsAt, endsAt: f.endsAt, isActive: f.isActive,
  };
  if (f.type === 'IMAGE') full.imageUrl = f.imageUrl;
  if (!editing) {
    if (f.type === 'VIDEO') full.youtubeUrl = f.youtubeUrl.trim();
    return { ...full, priority: nextPriority };
  }
  const was = toForm(editing);
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(full)) {
    const before = k === 'headline' || k === 'subline' ? oneLine(was[k]) : (was as Record<string, unknown>)[k];
    if (before !== v) body[k] = v;
  }
  if (f.type === 'VIDEO' && (editing.type !== 'VIDEO' || parseYouTubeId(f.youtubeUrl) !== editing.youtubeId)) body.youtubeUrl = f.youtubeUrl.trim();
  return body;
}

const STATE_CLASS: Record<PromoState, string> = {
  live: 'border-success/30 text-success-text', scheduled: 'border-info/30 text-info-text',
  ended: 'border-line text-fg-muted', paused: 'border-warning/30 text-warning-text',
};
const thumbOf = (type: PromoType, imageUrl: string | null | undefined, youtubeId: string | null | undefined) =>
  type === 'VIDEO' ? (youtubeId ? youtubeThumb(youtubeId) : null) : imageUrl || null;

/** What the card looks like on the PG list page in the app. */
function PreviewCard({ form, pg }: { form: Form; pg: PGHostel | undefined }) {
  const [small, setSmall] = useState(false);
  const ytId = form.type === 'VIDEO' ? parseYouTubeId(form.youtubeUrl) : null;
  const src = thumbOf(form.type, form.imageUrl, ytId);
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-fg-muted">Preview in the app</p>
      <div className="w-full max-w-sm overflow-hidden rounded-lg border border-line bg-surface">
        <div className="relative aspect-video w-full bg-surface-2/60">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" onLoad={e => { const i = e.currentTarget; setSmall(form.type === 'IMAGE' && i.naturalWidth > 0 && i.naturalWidth < 1200); }} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-fg-muted">{form.type === 'VIDEO' ? 'Paste a YouTube link' : 'Upload an image'}</div>
          )}
          <span className="absolute left-2 top-2 rounded bg-surface-2 px-2 py-0.5 text-xs font-semibold text-fg">{PROMO_LABEL_TEXT[form.label]}</span>
        </div>
        <div className="space-y-1 p-3">
          <p className="font-semibold text-fg">{oneLine(form.headline) || 'Headline'}</p>
          {oneLine(form.subline) && <p className="text-sm text-fg-muted">{oneLine(form.subline)}</p>}
          <p className="text-xs text-fg-muted">{pg ? `${pg.name} · From ${inr(pg.baseRent)}/month` : 'Choose a PG'}</p>
          <span className="mt-1 inline-block rounded-lg border border-line px-3 py-1 text-xs font-semibold text-fg">{PROMO_CTA_LABEL[form.cta]}</span>
        </div>
      </div>
      {small && <p className="text-xs text-warning-text">This image is under 1200 px wide and may look soft on large phones.</p>}
    </div>
  );
}

function PromoEditor({ editing, pgs, nextPriority, onCancel, onSaved }: {
  editing: PgPromotion | null; pgs: PGHostel[]; nextPriority: number; onCancel: () => void; onSaved: (p: PgPromotion, created: boolean) => void;
}) {
  const [form, setForm] = useState<Form>(() => (editing ? toForm(editing) : emptyForm()));
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<PanelMessage>(null);
  const [badField, setBadField] = useState<string | null>(null);
  const set = (patch: Partial<Form>) => { setMessage(null); setBadField(null); setForm(prev => ({ ...prev, ...patch })); };
  const choices = pgs.filter(p => p.isActive || p.id === form.hostelId);
  const pg = pgs.find(p => p.id === form.hostelId);
  const ytId = form.type === 'VIDEO' ? parseYouTubeId(form.youtubeUrl) : null;
  const bad = (...keys: string[]) => !!badField && keys.some(k => badField.toLowerCase().startsWith(k.toLowerCase()));
  const invalid = (on: boolean) => (on ? 'border-danger/30' : '');
  const body = buildBody(form, editing, nextPriority);
  const dirty = !editing || Object.keys(body).length > 0;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      set({ imageUrl: await uploadImage(file) });
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e, 'The image could not be uploaded.') });
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (saving || uploading) return;
    const err = validateForm(form, editing);
    if (err) { setMessage({ kind: 'error', text: err }); return; }
    if (editing && !Object.keys(body).length) { onCancel(); return; }
    setSaving(true);
    setMessage(null);
    setBadField(null);
    try {
      const saved = editing
        ? await pgRequest<PgPromotion>(`/api/pg/admin/promotions/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
        : await pgRequest<PgPromotion>('/api/pg/admin/promotions', { method: 'POST', body: JSON.stringify(body) });
      onSaved(saved, !editing);
    } catch (e) {
      setBadField(errorField(e));
      setMessage({ kind: 'error', text: errorText(e, 'Could not save the promotion.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="promo-editor-title" className="space-y-5 rounded-xl border border-line p-5">
      <h3 id="promo-editor-title" className="text-base font-semibold">{editing ? 'Edit promotion' : 'New promotion'}</h3>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div role="radiogroup" aria-label="Promotion type" className="flex gap-2">
            {(['IMAGE', 'VIDEO'] as PromoType[]).map(t => (
              <button key={t} type="button" role="radio" aria-checked={form.type === t} onClick={() => set({ type: t, cta: t === 'IMAGE' && form.cta === 'WATCH_TOUR' ? 'VIEW_PG' : form.cta })} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${form.type === t ? 'border-info/30 bg-info-soft text-info-text' : 'border-line text-fg-muted hover:text-fg'}`}>{t === 'IMAGE' ? 'Image' : 'Video'}</button>
            ))}
          </div>

          {form.type === 'IMAGE' ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-3">
                <label className={`cursor-pointer rounded-lg bg-surface-2 px-4 py-2.5 text-sm font-semibold text-fg hover:bg-surface-3 ${uploading ? 'pointer-events-none opacity-50' : ''} ${bad('imageUrl') ? 'ring-1 ring-red-500/60' : ''}`}>
                  {uploading ? 'Uploading…' : form.imageUrl ? 'Replace image' : 'Upload image'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading} onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                <span className="text-xs text-fg-muted">16:9, at least 1200 px wide. JPEG, PNG or WEBP; large photos are resized automatically.</span>
              </div>
            </div>
          ) : (
            <label className={LABEL}>YouTube link
              <input className={`${FIELD} ${invalid(bad('youtubeUrl') || (!!form.youtubeUrl.trim() && !ytId))}`} aria-invalid={!!form.youtubeUrl.trim() && !ytId} placeholder="https://youtu.be/…" value={form.youtubeUrl} onChange={e => set({ youtubeUrl: e.target.value })} />
              {form.youtubeUrl.trim() && !ytId && <span className="block text-xs normal-case text-danger-text">Not a YouTube video link. Use youtube.com/watch?v=…, youtu.be/… or youtube.com/shorts/….</span>}
            </label>
          )}

          <label className={LABEL}>Headline ({oneLine(form.headline).length}/40)
            <input className={`${FIELD} ${invalid(bad('headline'))}`} maxLength={60} placeholder="e.g. New twin rooms near SRM gate" value={form.headline} onChange={e => set({ headline: e.target.value })} />
          </label>
          <label className={LABEL}>Subline, optional ({oneLine(form.subline).length}/60)
            <input className={`${FIELD} ${invalid(bad('subline'))}`} maxLength={80} placeholder="e.g. Home-style food, 24×7 security" value={form.subline} onChange={e => set({ subline: e.target.value })} />
          </label>
          <label className={LABEL}>Opens this PG
            <select className={`${FIELD} ${invalid(bad('hostelId'))}`} value={form.hostelId} onChange={e => set({ hostelId: e.target.value })}>
              <option value="">Choose a listed PG</option>
              {choices.map(p => <option key={p.id} value={p.id}>{p.name}{p.isActive ? '' : ' (hidden: list it first)'}</option>)}
            </select>
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className={LABEL}>Button
              <select className={`${FIELD} ${invalid(bad('cta'))}`} value={form.cta} onChange={e => set({ cta: e.target.value as PromoCta })}>
                <option value="VIEW_PG">View PG</option>
                <option value="WATCH_TOUR" disabled={form.type !== 'VIDEO'}>Watch tour{form.type !== 'VIDEO' ? ' (video only)' : ''}</option>
                <option value="BOOK_VISIT">Book a visit</option>
              </select>
            </label>
            <label className={LABEL}>Label
              <select className={`${FIELD} ${invalid(bad('label'))}`} value={form.label} onChange={e => set({ label: e.target.value as PromoLabel })}>
                <option value="FEATURED">Featured</option><option value="SPONSORED">Sponsored</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-fg-muted">Sponsored when the PG paid for the slot; students see this label.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className={LABEL}>Start date<input type="date" className={`${FIELD} ${invalid(bad('start'))}`} value={form.startsAt} onChange={e => set({ startsAt: e.target.value })} /></label>
            <label className={LABEL}>End date<input type="date" className={`${FIELD} ${invalid(bad('end'))}`} value={form.endsAt} min={istDate(Date.now())} onChange={e => set({ endsAt: e.target.value })} /></label>
          </div>
          <p className="text-xs text-fg-muted">Dates are IST. The card shows from 12:00 AM on the start date until 11:59 PM on the end date. At most {MAX_PROMO_DAYS} days.</p>
          <label className="flex items-center gap-3 text-sm text-fg-muted">
            <input type="checkbox" checked={form.isActive} onChange={e => set({ isActive: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--accent))]" />
            Active (uncheck to pause without deleting)
          </label>
        </div>
        <PreviewCard form={form} pg={pg} />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        {message ? <span role={message.kind === 'error' ? 'alert' : 'status'} className={`mr-auto text-sm ${message.kind === 'error' ? 'text-danger-text' : 'text-success-text'}`}>{message.text}</span> : <span className="mr-auto text-xs text-fg-muted">{editing ? (dirty ? 'Unsaved changes' : 'No changes') : 'Not saved yet'}</span>}
        <button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg-muted hover:text-fg disabled:opacity-50">Cancel</button>
        <button type="button" disabled={saving || uploading || !dirty} onClick={save} className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-on-solid hover:bg-accent-hover disabled:opacity-40">{saving ? 'Saving…' : editing ? 'Save promotion' : 'Create promotion'}</button>
      </div>
    </section>
  );
}

/** Promotion cards on the PG list page in the app (across all PGs). */
export function PromotionsPanel({ pgs, liveTick = 0 }: { pgs: PGHostel[]; liveTick?: number }) {
  const [promos, setPromos] = useState<PgPromotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState<PgPromotion | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<PanelMessage>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setLoadError(''); }
    try {
      const data = await pgRequest<PgPromotion[]>('/api/pg/admin/promotions');
      setPromos(Array.isArray(data) ? data : []);
      setLoadError('');
    } catch (e) {
      if (!quiet) setLoadError(errorText(e, 'Could not load the promotions.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  // Live sync: reload quietly when the tick moves after mount (the first load above covers the rest).
  const mountTick = useRef(liveTick);
  useEffect(() => { if (liveTick !== mountTick.current) load(true); }, [liveTick, load]);

  const run = async (fn: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try { await fn(); } catch (e) { setMessage({ kind: 'error', text: errorText(e, fallback) }); } finally { setBusy(false); }
  };
  const move = (index: number, dir: -1 | 1) => run(async () => {
    const j = index + dir;
    if (j < 0 || j >= promos.length) return;
    const ids = promos.map(p => p.id);
    [ids[index], ids[j]] = [ids[j], ids[index]];
    const list = await pgRequest<PgPromotion[]>('/api/pg/admin/promotions/order', { method: 'PUT', body: JSON.stringify({ ids }) });
    setPromos(Array.isArray(list) ? list : promos);
  }, 'Could not change the order.');
  const toggle = (p: PgPromotion) => run(async () => {
    const saved = await pgRequest<PgPromotion>(`/api/pg/admin/promotions/${p.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !p.isActive }) });
    setPromos(prev => prev.map(x => (x.id === saved.id ? saved : x)));
    setMessage({ kind: 'ok', text: saved.isActive ? `"${saved.headline}" resumed.` : `"${saved.headline}" paused.` });
  }, 'Could not update the promotion.');
  const remove = (p: PgPromotion) => {
    if (!window.confirm(`Delete the promotion "${p.headline}"? It stops showing in the app.`)) return;
    run(async () => {
      await pgRequest(`/api/pg/admin/promotions/${p.id}`, { method: 'DELETE' });
      setPromos(prev => prev.filter(x => x.id !== p.id));
      if (editing && editing !== 'new' && editing.id === p.id) setEditing(null);
      setMessage({ kind: 'ok', text: 'Promotion deleted.' });
    }, 'Could not delete the promotion.');
  };
  const onSaved = (saved: PgPromotion, created: boolean) => {
    setEditing(null);
    setMessage({ kind: 'ok', text: created ? 'Promotion created.' : 'Promotion saved.' });
    setPromos(prev => (created ? [...prev, saved] : prev.map(x => (x.id === saved.id ? saved : x))));
    load(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-fg-muted">Cards shown at the top of the PG list in the app, in this order. Only live promotions for listed PGs are shown.</p>
          <p className="mt-1 text-xs text-fg-muted">Use Move up and Move down to change the order.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={loading} onClick={() => load()} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg-muted hover:text-fg disabled:opacity-50">{loading ? 'Loading…' : 'Refresh'}</button>
          <button type="button" disabled={editing !== null} onClick={() => { setEditing('new'); setMessage(null); }} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-solid hover:bg-accent-hover disabled:opacity-40">New promotion</button>
        </div>
      </div>

      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${message.kind === 'error' ? 'text-danger-text' : 'text-success-text'}`}>{message.text}</p>}

      {editing !== null && (
        <PromoEditor
          key={editing === 'new' ? 'new' : editing.id}
          editing={editing === 'new' ? null : editing} pgs={pgs}
          nextPriority={Math.min(999, promos.length)}
          onCancel={() => setEditing(null)} onSaved={onSaved}
        />
      )}

      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger-text">
          {loadError}<button type="button" onClick={() => load()} className="font-semibold underline">Retry</button>
        </div>
      )}
      {loading ? (
        <div role="status" className="rounded-xl border border-line p-8 text-sm text-fg-muted">Loading promotions…</div>
      ) : !loadError && promos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-fg-muted">No promotions yet.</div>
      ) : (
        <ol className="space-y-2" aria-label="Promotions">
          {promos.map((p, i) => {
            const src = thumbOf(p.type, p.imageUrl, p.youtubeId);
            return (
              <li key={p.id} className="grid grid-cols-[160px_1fr] gap-4 rounded-xl border border-line p-3">
                <div className="relative aspect-video w-[160px] overflow-hidden rounded-lg border border-line bg-surface-2/60">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {src && <img src={src} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{p.headline}</p>
                      <p className="truncate text-xs text-fg-muted">{p.pgName || 'PG not found'} · {PROMO_LABEL_TEXT[p.label]} · {p.ctaLabel || PROMO_CTA_LABEL[p.cta]} · {p.type === 'VIDEO' ? 'Video' : 'Image'}</p>
                    </div>
                    <span className={`shrink-0 rounded border px-2 py-0.5 text-xs font-semibold ${STATE_CLASS[p.state]}`}>{PROMO_STATE_LABEL[p.state]}</span>
                  </div>
                  <p className="text-xs text-fg-muted">{dateWindow(p.startsAt, p.endsAt)}</p>
                  <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                    <span className="text-fg-subtle">#{i + 1}</span>
                    <button type="button" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${p.headline} up`} className="rounded border border-line px-2 py-1 text-fg-muted hover:text-fg disabled:opacity-30">Move up</button>
                    <button type="button" disabled={busy || i === promos.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${p.headline} down`} className="rounded border border-line px-2 py-1 text-fg-muted hover:text-fg disabled:opacity-30">Move down</button>
                    <button type="button" disabled={busy} onClick={() => toggle(p)} className="rounded border border-line px-2 py-1 text-fg-muted hover:text-fg disabled:opacity-30">{p.isActive ? 'Pause' : 'Resume'}</button>
                    <button type="button" disabled={busy || editing !== null} onClick={() => { setEditing(p); setMessage(null); }} className="rounded border border-line px-2 py-1 text-fg-muted hover:text-fg disabled:opacity-30">Edit</button>
                    <button type="button" disabled={busy} onClick={() => remove(p)} className="ml-auto text-danger-text hover:text-danger-text disabled:opacity-30">Delete</button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
