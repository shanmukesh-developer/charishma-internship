"use client";
// Splash ads (admin): full-screen store ads the customer app shows right after its intro. Each ad promotes one
// real store in one of 8 interactive styles; up to 8 run at once, one per style, and the app picks among them at
// random. No live ad = the app goes straight to Home. Backend: routes/adRoutes.js (/api/admin/splash-ads).
// Live: admin:changed 'splash_ad' / 'store'.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminRequest, ApiError, uploadImage } from '@/lib/api';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { useLiveSync } from '@/lib/useLiveSync';
import { formatDateTime } from '@/lib/format';
import ListImage from '@/components/ListImage';
import QRCode from 'qrcode';
import {
  Badge, Button, DataTable, Field, Input, Modal, Notice, PageHeader, Select, StatusPill, Switch, Textarea, useConfirm,
  type Column, IconPlus, IconRefresh,
} from '@/components/ui';

type StyleKey = 'tear' | 'scratch' | 'envelope' | 'gift' | 'glass' | 'coupon' | 'portal' | 'peel';
type AdState = 'live' | 'scheduled' | 'ended' | 'off';

interface SplashAd {
  id: string;
  restaurantId: string;
  style: StyleKey;
  styleLabel?: string;
  offerText: string;
  headline: string;
  subline: string | null;
  bannerText: string | null;
  imageUrl: string;
  colorA: string;
  colorB: string;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  priority: number;
  state: AdState;
  store: { id: string; name: string; isActive: boolean } | null;
  createdAt: string;
  updatedAt: string;
}
interface Store { id: string; name: string; imageUrl?: string | null; isActive?: boolean; vendorType?: string | null; location?: string | null }

// Same keys, order and wording as backend utils/splashAds.STYLES.
const STYLES: { key: StyleKey; label: string; description: string }[] = [
  { key: 'tear', label: 'Tear the paper', description: 'Rip a poster ad in two.' },
  { key: 'scratch', label: 'Scratch card', description: 'Rub to reveal.' },
  { key: 'envelope', label: 'Secret envelope', description: 'Break the seal, the card rises.' },
  { key: 'gift', label: 'Gift box', description: 'Pull the ribbon, the product rises.' },
  { key: 'glass', label: 'Wipe the glass', description: 'Wipe the fog off.' },
  { key: 'coupon', label: 'Pull the coupon', description: 'Tear the stub.' },
  { key: 'portal', label: 'Portal', description: 'Swipe a glowing ring open.' },
  { key: 'peel', label: 'Peel the sticker', description: 'Peel a corner.' },
];
const STYLE_LABEL = Object.fromEntries(STYLES.map(s => [s.key, s.label])) as Record<StyleKey, string>;
const STATE_LABEL: Record<AdState, string> = { live: 'Live', scheduled: 'Scheduled', ended: 'Ended', off: 'Off' };
const STATE_TONE = { live: 'success', scheduled: 'info', ended: 'neutral', off: 'warning' } as const;
const DEFAULT_A = '#7d2c12';
const DEFAULT_B = '#120805';
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const HTTPS_RE = /^https:\/\/\S{3,}$/i;
const MEDIA_RE = /^(https?:\/\/[^/\s]+)?\/api\/campus\/media\/[0-9a-f-]{36}(\?\S*)?$/i;

type Form = {
  restaurantId: string; style: StyleKey | ''; offerText: string; headline: string; subline: string; bannerText: string;
  imageUrl: string; colorA: string; colorB: string; startsAt: string; endsAt: string; priority: string; isActive: boolean;
};

/** ISO -> 'YYYY-MM-DDTHH:mm' in the browser's time zone (datetime-local input). */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
/** datetime-local value (browser time zone) -> ISO, or null when empty. */
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Headline: at most two lines, each trimmed (same as the backend). */
const cleanHeadline = (s: string) => s.replace(/\r\n?/g, '\n').split('\n').map(oneLine).filter(Boolean).join('\n');

const emptyForm = (): Form => ({
  restaurantId: '', style: '', offerText: '', headline: '', subline: '', bannerText: '', imageUrl: '',
  colorA: DEFAULT_A, colorB: DEFAULT_B, startsAt: '', endsAt: '', priority: '0', isActive: true,
});
const toForm = (a: SplashAd): Form => ({
  restaurantId: a.restaurantId, style: a.style, offerText: a.offerText, headline: a.headline, subline: a.subline || '',
  bannerText: a.bannerText || '', imageUrl: a.imageUrl, colorA: a.colorA || DEFAULT_A, colorB: a.colorB || DEFAULT_B,
  startsAt: toLocalInput(a.startsAt), endsAt: toLocalInput(a.endsAt), priority: String(a.priority ?? 0), isActive: a.isActive,
});

/** Mirrors backend validateSplashAd. Returns [field, message] or null. */
function validateForm(f: Form, editing: SplashAd | null): [string, string] | null {
  if (!f.restaurantId) return ['restaurantId', 'Choose the store this ad promotes.'];
  if (!f.style) return ['style', 'Choose a style.'];
  const offer = oneLine(f.offerText);
  if (!offer) return ['offerText', 'Write the offer (up to 24 characters).'];
  if (offer.length > 24) return ['offerText', 'Offer must be at most 24 characters.'];
  const lines = f.headline.replace(/\r\n?/g, '\n').split('\n').map(oneLine).filter(Boolean);
  if (!lines.length) return ['headline', 'Write the headline (up to 60 characters).'];
  if (lines.length > 2) return ['headline', 'Headline can have at most 2 lines.'];
  if (lines.join('\n').length > 60) return ['headline', 'Headline must be at most 60 characters.'];
  if (oneLine(f.subline).length > 90) return ['subline', 'Subline must be at most 90 characters.'];
  if (oneLine(f.bannerText).length > 40) return ['bannerText', 'Banner text must be at most 40 characters.'];
  const img = f.imageUrl.trim();
  if (!img) return ['imageUrl', 'Add the ad image (an uploaded photo or an https link).'];
  if (!HTTPS_RE.test(img) && !MEDIA_RE.test(img)) return ['imageUrl', 'The image must be an uploaded photo or an https:// link.'];
  if (!COLOR_RE.test(f.colorA)) return ['colorA', 'Colour A must be like #7d2c12.'];
  if (!COLOR_RE.test(f.colorB)) return ['colorB', 'Colour B must be like #120805.'];
  const s = f.startsAt ? new Date(f.startsAt).getTime() : null;
  const e = f.endsAt ? new Date(f.endsAt).getTime() : null;
  if (s !== null && e !== null && e <= s) return ['endsAt', 'The end must be after the start.'];
  const endChanged = !editing || toLocalInput(editing.endsAt) !== f.endsAt;
  if (e !== null && e <= Date.now() && (endChanged || (f.isActive && !editing?.isActive))) return ['endsAt', 'The end is already past.'];
  const p = Number(f.priority);
  if (!Number.isInteger(p) || p < 0 || p > 999) return ['priority', 'Priority must be a whole number from 0 to 999.'];
  return null;
}

/** Body for POST (everything) or PUT (only what changed). */
function buildBody(f: Form, editing: SplashAd | null): Record<string, unknown> {
  const full: Record<string, unknown> = {
    restaurantId: f.restaurantId, style: f.style, offerText: oneLine(f.offerText), headline: cleanHeadline(f.headline),
    subline: oneLine(f.subline), bannerText: oneLine(f.bannerText), imageUrl: f.imageUrl.trim(),
    colorA: f.colorA.toLowerCase(), colorB: f.colorB.toLowerCase(), startsAt: fromLocalInput(f.startsAt), endsAt: fromLocalInput(f.endsAt),
    priority: Number(f.priority) || 0, isActive: f.isActive,
  };
  if (!editing) return full;
  const was = toForm(editing);
  const before: Record<string, unknown> = {
    restaurantId: was.restaurantId, style: was.style, offerText: was.offerText, headline: was.headline, subline: was.subline,
    bannerText: was.bannerText, imageUrl: was.imageUrl, colorA: was.colorA, colorB: was.colorB, startsAt: fromLocalInput(was.startsAt),
    endsAt: fromLocalInput(was.endsAt), priority: Number(was.priority) || 0, isActive: was.isActive,
  };
  return Object.fromEntries(Object.entries(full).filter(([k, v]) => before[k] !== v));
}

const dateWindow = (a: Pick<SplashAd, 'startsAt' | 'endsAt'>) => {
  if (!a.startsAt && !a.endsAt) return 'Always';
  if (!a.startsAt) return `Until ${formatDateTime(a.endsAt, { short: true })}`;
  if (!a.endsAt) return `From ${formatDateTime(a.startsAt, { short: true })}`;
  return `${formatDateTime(a.startsAt, { short: true })} – ${formatDateTime(a.endsAt, { short: true })}`;
};
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** How the ad reads in the app: image, offer and headline on the two colours, plus the Home banner strip. */
function Preview({ form, store }: { form: Form; store: Store | undefined }) {
  const a = COLOR_RE.test(form.colorA) ? form.colorA : DEFAULT_A;
  const b = COLOR_RE.test(form.colorB) ? form.colorB : DEFAULT_B;
  const img = form.imageUrl.trim() || store?.imageUrl || '';
  const headline = cleanHeadline(form.headline);
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-fg-muted">Preview</p>
      <div className="mx-auto w-full max-w-[260px] overflow-hidden rounded-2xl border border-line shadow-sm" style={{ background: `linear-gradient(160deg, ${a} 0%, ${b} 100%)` }}>
        <div className="flex aspect-[9/16] flex-col p-4 text-white">
          <div className="flex items-center gap-2">
            {store?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={store.imageUrl} alt="" className="h-7 w-7 rounded-full border border-white/40 object-cover" />
            ) : <span className="h-7 w-7 rounded-full bg-white/20" />}
            <span className="truncate text-xs font-semibold opacity-90">{store?.name || 'Choose a store'}</span>
          </div>
          <div className="relative mt-4 flex-1 overflow-hidden rounded-xl bg-black/20">
            {img ? (
              <>
                {/* The whole photo stays visible (object-contain); a blurred copy fills the rest of the frame. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-md" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img} alt="" className="absolute inset-0 h-full w-full object-contain" />
              </>
            ) : <span className="absolute inset-0 flex items-center justify-center text-xs opacity-70">Add an image</span>}
            <span className="absolute left-2 top-2 rounded-md bg-white px-2 py-1 text-sm font-extrabold tracking-tight" style={{ color: a }}>{oneLine(form.offerText) || 'OFFER'}</span>
          </div>
          <p className="mt-3 whitespace-pre-line text-lg font-bold leading-tight">{headline || 'Your headline'}</p>
          {oneLine(form.subline) && <p className="mt-1 text-xs opacity-80">{oneLine(form.subline)}</p>}
          <p className="mt-3 text-center text-[11px] uppercase tracking-widest opacity-70">{form.style ? STYLE_LABEL[form.style] : 'Pick a style'}</p>
        </div>
      </div>
      {oneLine(form.bannerText) && (
        <div className="mx-auto flex max-w-[260px] items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          <Badge tone="neutral">Sponsored</Badge><span className="truncate text-fg">{oneLine(form.bannerText)}</span>
        </div>
      )}
    </div>
  );
}

function AdEditor({ open, editing, ads, stores, storesError, onReloadStores, onClose, onSaved }: {
  open: boolean; editing: SplashAd | null; ads: SplashAd[]; stores: Store[] | null; storesError: string;
  onReloadStores: () => void; onClose: () => void; onSaved: (ad: SplashAd, created: boolean) => void;
}) {
  const [form, setForm] = useState<Form>(() => (editing ? toForm(editing) : emptyForm()));
  const [storeQuery, setStoreQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<{ field: string | null; text: string } | null>(null);
  const set = (patch: Partial<Form>) => { setError(null); setForm(prev => ({ ...prev, ...patch })); };

  const store = stores?.find(s => s.id === form.restaurantId);
  const storeName = store?.name || (editing && editing.restaurantId === form.restaurantId ? editing.store?.name : '') || '';
  // Styles held by ANOTHER active ad (an active ad may not take them).
  const heldBy = useMemo(() => {
    const m = new Map<StyleKey, string>();
    for (const a of ads) if (a.isActive && a.id !== editing?.id) m.set(a.style, a.store?.name || 'another store');
    return m;
  }, [ads, editing]);
  const q = storeQuery.trim().toLowerCase();
  const matches = useMemo(() => (stores || [])
    .filter(s => !q || s.name.toLowerCase().includes(q) || String(s.vendorType || '').toLowerCase().includes(q) || String(s.location || '').toLowerCase().includes(q))
    .slice(0, 30), [stores, q]);
  const body = buildBody(form, editing);
  const dirty = !editing || Object.keys(body).length > 0;
  const fieldError = (f: string) => (error && error.field === f ? error.text : undefined);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try { set({ imageUrl: await uploadImage(file) }); } catch (e) { setError({ field: 'imageUrl', text: errText(e, 'The image could not be uploaded.') }); } finally { setUploading(false); }
  };

  const save = async () => {
    if (saving || uploading) return;
    const bad = validateForm(form, editing);
    if (bad) { setError({ field: bad[0], text: bad[1] }); return; }
    if (form.isActive && form.style && heldBy.has(form.style)) {
      setError({ field: 'style', text: `Style '${form.style}' is already used by the active ad for ${heldBy.get(form.style)}; pick another style or turn that one off.` });
      return;
    }
    if (editing && !Object.keys(body).length) { onClose(); return; }
    setSaving(true);
    setError(null);
    try {
      const saved = editing
        ? await adminRequest<SplashAd>(`/api/admin/splash-ads/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
        : await adminRequest<SplashAd>('/api/admin/splash-ads', { method: 'POST', body: JSON.stringify(body) });
      onSaved(saved, !editing);
    } catch (e) {
      setError({ field: e instanceof ApiError ? e.field : null, text: errText(e, 'Could not save the ad.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!saving}
      size="xl"
      title={editing ? 'Edit splash ad' : 'New splash ad'}
      description="Its store is credited on the customer app's service picker ('Brought to you by ...'); Preview on phone plays the full ad. Only live stores can run an ad, and each style can be used by one active ad at a time."
      footer={(
        <>
          <span className="mr-auto text-xs text-fg-muted">{editing ? (dirty ? 'Unsaved changes' : 'No changes') : 'Not saved yet'}</span>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={uploading || !dirty} onClick={save}>{editing ? 'Save ad' : 'Create ad'}</Button>
        </>
      )}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          {error && !error.field && <Notice tone="danger">{error.text}</Notice>}

          <Field
            label="Store"
            required
            error={fieldError('restaurantId') || (storesError ? <>{storesError} <button type="button" onClick={onReloadStores} className="underline">Retry</button></> : undefined)}
            hint={storeName ? <span className="text-success-text">Selected: {storeName}{store && store.isActive === false ? ' (hidden from customers)' : ''}</span> : 'Search by name, type or location.'}
          >
            <div className="relative">
              <Input
                type="text"
                placeholder={stores ? 'Search stores' : 'Loading stores…'}
                value={pickerOpen ? storeQuery : storeName || storeQuery}
                onFocus={() => { setPickerOpen(true); setStoreQuery(''); }}
                onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
                onChange={e => { setStoreQuery(e.target.value); setPickerOpen(true); }}
              />
              {pickerOpen && stores && (
                <div className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line bg-surface shadow-lg" role="listbox" aria-label="Stores">
                  {matches.length === 0 ? (
                    <div className="p-3 text-center text-sm text-fg-muted">No stores match.</div>
                  ) : matches.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      role="option"
                      aria-selected={s.id === form.restaurantId}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { set({ restaurantId: s.id }); setStoreQuery(''); setPickerOpen(false); }}
                      className="flex w-full items-center gap-3 border-b border-line px-3 py-2 text-left text-sm text-fg last:border-0 hover:bg-surface-2"
                    >
                      <ListImage src={s.imageUrl} thumb alt="" className="h-8 w-8 shrink-0 rounded object-cover" fallback={<span className="h-8 w-8 shrink-0 rounded bg-surface-2" />} />
                      <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                      <span className="shrink-0 text-xs text-fg-muted">{s.isActive === false ? 'Hidden' : (s.vendorType || '').toLowerCase().replace(/_/g, ' ')}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>

          <Field label="Style" required error={fieldError('style')} hint={form.style ? STYLES.find(s => s.key === form.style)?.description : 'How the student opens the ad.'}>
            <Select value={form.style} onChange={e => set({ style: e.target.value as StyleKey })}>
              <option value="">Choose a style</option>
              {STYLES.map(s => {
                const holder = heldBy.get(s.key);
                return (
                  <option key={s.key} value={s.key} disabled={!!holder && form.isActive}>
                    {s.label}: {s.description}{holder ? ` (in use by ${holder})` : ''}
                  </option>
                );
              })}
            </Select>
          </Field>

          <div className="grid gap-3 md:grid-cols-[160px_1fr]">
            <Field label={`Offer (${oneLine(form.offerText).length}/24)`} required error={fieldError('offerText')}>
              <Input maxLength={40} placeholder="20% OFF" value={form.offerText} onChange={e => set({ offerText: e.target.value })} />
            </Field>
            <Field label={`Headline (${cleanHeadline(form.headline).length}/60)`} required error={fieldError('headline')} hint="Up to two lines (press Enter once).">
              <Textarea rows={2} maxLength={80} placeholder={'Biryani that\nbreaks the rules'} value={form.headline} onChange={e => set({ headline: e.target.value })} />
            </Field>
          </div>
          <Field label={`Subline (${oneLine(form.subline).length}/90)`} optional error={fieldError('subline')}>
            <Input maxLength={120} placeholder="On every order above ₹199, today only" value={form.subline} onChange={e => set({ subline: e.target.value })} />
          </Field>
          <Field label={`Home banner text (${oneLine(form.bannerText).length}/40)`} optional error={fieldError('bannerText')} hint="Shown in the Sponsored strip on Home.">
            <Input maxLength={60} placeholder="Flat 20% off at Paradise" value={form.bannerText} onChange={e => set({ bannerText: e.target.value })} />
          </Field>

          <Field
            label="Image"
            required
            error={fieldError('imageUrl')}
            hint="An uploaded photo or an https:// link. Tall photos (9:16) look best."
            labelAction={(
              <div className="flex gap-1">
                <button type="button" disabled={!store?.imageUrl} onClick={() => set({ imageUrl: store?.imageUrl || '' })} className="rounded px-1.5 py-0.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40">Use store photo</button>
                <label className={`cursor-pointer rounded px-1.5 py-0.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg ${uploading ? 'pointer-events-none opacity-50' : ''}`}>
                  {uploading ? 'Uploading…' : 'Upload'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading} onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
              </div>
            )}
          >
            <Input placeholder="https://…" value={form.imageUrl} onChange={e => set({ imageUrl: e.target.value })} />
          </Field>

          <div className="grid gap-3 md:grid-cols-2">
            {(['colorA', 'colorB'] as const).map((k, i) => (
              <Field key={k} label={i === 0 ? 'Colour A (top)' : 'Colour B (bottom)'} error={fieldError(k)}>
                <div className="flex items-center gap-2">
                  <input type="color" aria-label={i === 0 ? 'Pick colour A' : 'Pick colour B'} value={COLOR_RE.test(form[k]) ? form[k] : (i === 0 ? DEFAULT_A : DEFAULT_B)} onChange={e => set({ [k]: e.target.value } as Partial<Form>)} className="h-9 w-12 cursor-pointer rounded border border-line bg-surface" />
                  <Input className="flex-1 font-mono" maxLength={7} value={form[k]} onChange={e => set({ [k]: e.target.value.trim() } as Partial<Form>)} />
                </div>
              </Field>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Starts" optional error={fieldError('startsAt')} hint="Empty = now.">
              <Input type="datetime-local" value={form.startsAt} onChange={e => set({ startsAt: e.target.value })} />
            </Field>
            <Field label="Ends" optional error={fieldError('endsAt')} hint="Empty = until switched off.">
              <Input type="datetime-local" value={form.endsAt} onChange={e => set({ endsAt: e.target.value })} />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Priority" error={fieldError('priority')} hint="0–999. Higher comes first in the list the app shuffles.">
              <Input type="number" min={0} max={999} step={1} value={form.priority} onChange={e => set({ priority: e.target.value })} />
            </Field>
            <div className="pt-6">
              <Switch checked={form.isActive} onChange={v => set({ isActive: v })} label="Active" description="Off keeps it as a draft (drafts may share a style)." />
            </div>
          </div>
        </div>
        <Preview form={form} store={store} />
      </div>
    </Modal>
  );
}

export default function SplashAdsPage() {
  const { isAuthed } = useAdminAuth();
  const confirm = useConfirm();
  const [ads, setAds] = useState<SplashAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[] | null>(null);
  const [storesError, setStoresError] = useState('');
  const [editing, setEditing] = useState<SplashAd | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminRequest<{ ads: SplashAd[] }>('/api/admin/splash-ads');
      setAds(Array.isArray(data?.ads) ? data.ads : []);
      setLoadError(null);
    } catch (e) {
      setLoadError(errText(e, 'Could not load the splash ads.'));
    } finally {
      setLoading(false);
    }
  }, []);
  const loadStores = useCallback(async () => {
    try {
      const list = await adminRequest<Store[]>('/api/admin/restaurants');
      setStores(Array.isArray(list) ? list : []);
      setStoresError('');
    } catch (e) {
      setStoresError(errText(e, 'Could not load the stores.'));
    }
  }, []);
  useEffect(() => { if (isAuthed) load(); }, [isAuthed, load]);
  // The store list is only needed by the editor: load it the first time the editor opens.
  useEffect(() => { if (isAuthed && editing !== null && stores === null) loadStores(); }, [isAuthed, editing, stores, loadStores]);

  useLiveSync(['splash_ad', 'store'], (events, { reconnect }) => {
    if (reconnect || events.some(e => e.type === 'splash_ad' || e.type === 'store')) load();
    if (events.some(e => e.type === 'store')) { if (editingRef.current !== null) loadStores(); else setStores(null); }
  }, { enabled: isAuthed, debounceMs: 800 });

  const toggle = async (a: SplashAd, next: boolean) => {
    if (busyId) return;
    setBusyId(a.id);
    setNotice(null);
    try {
      const saved = await adminRequest<SplashAd>(`/api/admin/splash-ads/${a.id}/active`, { method: 'PUT', body: JSON.stringify({ isActive: next }) });
      setAds(prev => prev.map(x => (x.id === saved.id ? saved : x)));
      setNotice({ kind: 'success', text: `${saved.store?.name || 'Ad'} (${STYLE_LABEL[saved.style]}) ${saved.isActive ? 'switched on' : 'switched off'}.` });
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e, 'Could not update the ad.') });
    } finally {
      setBusyId(null);
    }
  };
  // Preview on a phone: a signed 15 min link to this ad (works for switched-off and scheduled ads too).
  const [preview, setPreview] = useState<{ ad: SplashAd; webLink: string; qr: string } | null>(null);
  const openPreview = async (a: SplashAd) => {
    if (busyId) return;
    setBusyId(a.id);
    setNotice(null);
    try {
      const r = await adminRequest<{ code: string; link: string; webLink: string; expiresInSec: number }>(`/api/admin/splash-ads/${a.id}/preview`, { method: 'POST', body: '{}' });
      const qr = await QRCode.toDataURL(r.webLink, { margin: 1, width: 280, errorCorrectionLevel: 'M' });
      setPreview({ ad: a, webLink: r.webLink, qr });
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e, 'Could not make a preview link.') });
    } finally {
      setBusyId(null);
    }
  };
  const remove = async (a: SplashAd) => {
    if (busyId) return;
    if (!(await confirm({ title: `Delete the ${STYLE_LABEL[a.style]} ad for ${a.store?.name || 'this store'}?`, description: 'It stops showing in the app. This cannot be undone.', confirmLabel: 'Delete ad', tone: 'danger' }))) return;
    setBusyId(a.id);
    try {
      await adminRequest(`/api/admin/splash-ads/${a.id}`, { method: 'DELETE' });
      setAds(prev => prev.filter(x => x.id !== a.id));
      setNotice({ kind: 'success', text: 'Ad deleted.' });
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e, 'Could not delete the ad.') });
    } finally {
      setBusyId(null);
    }
  };
  const onSaved = (saved: SplashAd, created: boolean) => {
    setEditing(null);
    setNotice({ kind: 'success', text: created ? 'Ad created.' : 'Ad saved.' });
    setAds(prev => (created ? [saved, ...prev] : prev.map(x => (x.id === saved.id ? saved : x))));
    load();
  };

  // Which active ad holds each style.
  const holders = useMemo(() => {
    const m = new Map<StyleKey, SplashAd>();
    for (const a of ads) if (a.isActive) m.set(a.style, a);
    return m;
  }, [ads]);
  const liveCount = ads.filter(a => a.state === 'live' && a.store?.isActive !== false).length;

  if (!isAuthed) return null; // AppShell shows the session check

  const columns: Column<SplashAd>[] = [
    {
      key: 'store', header: 'Store', sortValue: a => a.store?.name || '',
      cell: a => (
        <div className="flex min-w-0 items-center gap-3">
          <ListImage src={a.imageUrl} thumb alt="" className="h-10 w-10 shrink-0 rounded object-cover" fallback={<span className="h-10 w-10 shrink-0 rounded bg-surface-2" />} />
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{a.store?.name || 'Store not found'}</p>
            {a.store && !a.store.isActive && <p className="text-xs text-warning-text">Store hidden: not shown</p>}
          </div>
        </div>
      ),
    },
    { key: 'style', header: 'Style', sortValue: a => STYLE_LABEL[a.style] || a.style, cell: a => <span className="whitespace-nowrap text-fg">{STYLE_LABEL[a.style] || a.style}</span> },
    {
      key: 'offer', header: 'Offer', sortValue: a => a.offerText,
      cell: a => (
        <div className="min-w-0 max-w-[260px]">
          <p className="truncate font-semibold text-fg">{a.offerText}</p>
          <p className="truncate text-xs text-fg-muted">{a.headline.replace(/\n/g, ' ')}</p>
        </div>
      ),
    },
    { key: 'dates', header: 'Dates', hideBelow: 'lg', sortValue: a => (a.startsAt ? new Date(a.startsAt) : null), cell: a => <span className="whitespace-nowrap text-xs text-fg-muted">{dateWindow(a)}</span> },
    { key: 'priority', header: 'Priority', align: 'right', sortValue: a => a.priority, cell: a => <span className="tabular-nums text-fg-muted">{a.priority}</span> },
    { key: 'state', header: 'Status', sortValue: a => a.state, cell: a => <StatusPill status={a.state} tone={STATE_TONE[a.state]} label={STATE_LABEL[a.state]} /> },
    {
      key: 'active', header: 'Active', sortValue: a => a.isActive,
      cell: a => <Switch size="sm" checked={a.isActive} disabled={busyId !== null} onChange={v => toggle(a, v)} label={<span className="sr-only">{a.isActive ? 'Switch off' : 'Switch on'}</span>} />,
    },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
      cell: a => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" disabled={busyId !== null || editing !== null} onClick={() => openPreview(a)}>Preview on phone</Button>
          <Button size="sm" variant="ghost" disabled={busyId !== null || editing !== null} onClick={() => { setNotice(null); setEditing(a); }}>Edit</Button>
          <Button size="sm" variant="ghost" className="text-danger-text" disabled={busyId !== null} loading={busyId === a.id} onClick={() => remove(a)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="text-fg">
      <PageHeader
        title="Splash ads"
        description="Sponsored stores for the customer app. From app 1.0.43 the app opens on the service picker (Food, Bakeries, Groceries, Fruits, Pickles, Tech Services) and credits the next live ad's store at its foot; a tap opens the store. Up to 8 run at once (one per style), in random order. Preview on phone still plays the full ad; app versions before 1.0.43 show it full screen after the intro."
        actions={(
          <>
            <Button leftIcon={<IconRefresh size={14} />} loading={loading} onClick={load}>Refresh</Button>
            <Button variant="primary" leftIcon={<IconPlus size={14} />} disabled={editing !== null} onClick={() => { setNotice(null); setEditing('new'); }}>New ad</Button>
          </>
        )}
      />

      <section aria-labelledby="styles-title" className="mb-5">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 id="styles-title" className="text-sm font-semibold text-fg">Styles</h2>
          <span className="text-xs text-fg-muted">{holders.size} of 8 styles taken · {liveCount} live now</span>
        </div>
        <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {STYLES.map(s => {
            const h = holders.get(s.key);
            return (
              <li key={s.key} className={`rounded-lg border p-3 ${h ? 'border-line bg-surface' : 'border-dashed border-line'}`}>
                <p className="text-sm font-semibold text-fg">{s.label}</p>
                <p className="text-xs text-fg-muted">{s.description}</p>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  {h ? (
                    <>
                      <StatusPill status={h.state} tone={STATE_TONE[h.state]} label={STATE_LABEL[h.state]} />
                      <span className="truncate text-fg">{h.store?.name || 'Store not found'}</span>
                    </>
                  ) : <span className="text-fg-subtle">Free</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {notice && <Notice tone={notice.kind === 'error' ? 'danger' : 'success'} className="mb-3" onClose={() => setNotice(null)}>{notice.text}</Notice>}

      <DataTable
        caption="Splash ads"
        columns={columns}
        rows={ads}
        rowKey={a => a.id}
        loading={loading && ads.length === 0}
        error={loadError}
        onRetry={load}
        pageSize={50}
        noun="ads"
        initialSort={{ key: 'priority', dir: 'desc' }}
        empty={{ title: 'No splash ads yet', description: 'The app goes straight to Home. Create one with New ad.', action: <Button variant="primary" leftIcon={<IconPlus size={14} />} onClick={() => setEditing('new')}>New ad</Button> }}
      />

      {preview && (
        <Modal
          open
          onClose={() => setPreview(null)}
          size="sm"
          title="Preview on phone"
          description={`${STYLE_LABEL[preview.ad.style]} ad for ${preview.ad.store?.name || 'this store'}. Only you see it; it does not switch the ad on.`}
          footer={<Button variant="primary" onClick={() => setPreview(null)}>Done</Button>}
        >
          <div className="flex flex-col items-center gap-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.qr} alt="QR code for the preview link" width={220} height={220} className="rounded-md bg-white p-2" />
            <p className="text-sm text-fg-muted">Scan with the phone camera, or send yourself the link and tap it. It opens the ZCS app and plays this ad once. The link works for 15 minutes.</p>
            <div className="flex w-full gap-2">
              <Input readOnly value={preview.webLink} aria-label="Preview link" onFocus={e => e.currentTarget.select()} />
              <Button variant="secondary" onClick={() => { navigator.clipboard?.writeText(preview.webLink).then(() => setNotice({ kind: 'success', text: 'Preview link copied.' })).catch(() => {}); }}>Copy</Button>
            </div>
          </div>
        </Modal>
      )}

      {editing !== null && (
        <AdEditor
          key={editing === 'new' ? 'new' : editing.id}
          open
          editing={editing === 'new' ? null : editing}
          ads={ads}
          stores={stores}
          storesError={storesError}
          onReloadStores={loadStores}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
