"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, ReactNode } from 'react';
import {
  Store, VENDOR_TYPES, VendorGroup, adminRequest, formatINR, formatWhatsapp, isBookingOnlyStore, isLocalVendorType,
  isValidIndianMobile, readBrandTheme, readTags, storeId, tenDigits, vendorLabel,
} from '@/app/restaurants/catalogue';
import {
  Weekly, generatePassword, isOpenByHours, mapsUrl, operatingHoursPayload, parseMapLink, passwordStrength,
  primaryWindow, round6, summarizeWeekly, timeAgo, validateWeekly, weeklyFromStore, uniformWeekly,
} from './helpers';
import { ImagePicker, TagInput, WeeklyHoursEditor } from './inputs';
import { StorePreviewCard } from './StorePreviewCard';
import {
  Button, Callout, Chip, ConfirmModal, CopyButton, Drawer, Field, INPUT, Segmented, Toggle, cx, FOCUS_RING, useToast,
} from './ui';

// ─── State ───────────────────────────────────────────────────────────────────
export interface WizardState {
  name: string;
  vendorType: string;
  campus: string;
  description: string;
  tags: string[];
  location: string;
  zone: string;
  lat: string;
  lon: string;
  whatsapp: string;
  imageUrl: string;
  brandOn: boolean;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  weekly: Weekly;
  isOpenNow: boolean;
  deliveryTime: string;
  managedByZenvy: boolean;
  password: string;
  /** Partner / vendor app login phone (Restaurant.phone). Empty = none (stalls can still use the WhatsApp number). */
  loginPhone: string;
  packagingFee: string;
  minOrderValue: string;
  commissionType: 'percentage' | 'flat';
  commissionRate: string;
}

export type StepKey = 'basics' | 'location' | 'branding' | 'hours' | 'login' | 'commission' | 'review';
const STEP_META: Record<StepKey, { title: string; sub: string }> = {
  basics: { title: 'Basics', sub: 'Name, type, campus' },
  location: { title: 'Location & contact', sub: 'Address, map pin, WhatsApp' },
  branding: { title: 'Branding', sub: 'Cover photo, logo, colours' },
  hours: { title: 'Hours & delivery', sub: 'Weekly hours, delivery time' },
  login: { title: 'Partner login', sub: 'App sign-in: phone + password' },
  commission: { title: 'Commission & payouts', sub: 'What ZCS keeps' },
  review: { title: 'Review & publish', sub: 'Preview and go live' },
};

const DRAFT_KEY = 'zenvy.admin.storeWizard.v1';

const emptyState = (): WizardState => ({
  name: '', vendorType: 'RESTAURANT', campus: '', description: '', tags: [],
  location: '', zone: '', lat: '', lon: '', whatsapp: '',
  imageUrl: '', brandOn: false, logoUrl: '', primaryColor: '#E23744', secondaryColor: '#111111', accentColor: '#FFC72C',
  weekly: uniformWeekly('09:00', '22:00'), isOpenNow: true, deliveryTime: '30',
  managedByZenvy: false, password: '', loginPhone: '', packagingFee: '', minOrderValue: '', commissionType: 'percentage', commissionRate: '10',
});

export function stateFromStore(s: Store): WizardState {
  const brand = readBrandTheme(s.brandTheme);
  return {
    name: s.name || '',
    vendorType: (s.vendorType || 'RESTAURANT').toUpperCase(),
    campus: s.campus || '',
    description: s.stallDescription || '',
    tags: readTags(s.tags),
    location: s.location || '',
    zone: s.zone || '',
    lat: s.lat != null ? String(s.lat) : '',
    lon: s.lon != null ? String(s.lon) : '',
    whatsapp: tenDigits(s.whatsappNumber),
    imageUrl: s.imageUrl || '',
    brandOn: !!brand,
    logoUrl: s.logoUrl || (typeof brand?.logoUrl === 'string' ? brand.logoUrl : ''),
    primaryColor: brand?.primaryColor || '#E23744',
    secondaryColor: brand?.secondaryColor || '#111111',
    accentColor: brand?.accentColor || '#FFC72C',
    weekly: weeklyFromStore(s.operatingHours),
    isOpenNow: s.isOpenNow !== false,
    deliveryTime: s.deliveryTime != null ? String(s.deliveryTime) : '',
    managedByZenvy: !!s.isOffline,
    password: '',
    loginPhone: tenDigits(s.partnerPhone || s.phone),
    packagingFee: s.packagingFee ? String(s.packagingFee) : '',
    minOrderValue: s.minOrderValue ? String(s.minOrderValue) : '',
    commissionType: s.commissionType === 'flat' ? 'flat' : 'percentage',
    commissionRate: String(s.commissionRate ?? 10),
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
type Errors = Partial<Record<keyof WizardState | 'coords', string>>;

const feeError = (raw: string, max: number, label: string) => {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return !Number.isFinite(n) || n < 0 || n > max ? `${label} must be between ₹0 and ₹${max.toLocaleString('en-IN')}.` : null;
};

function validateStep(step: StepKey, s: WizardState, mode: 'create' | 'edit'): Errors {
  const e: Errors = {};
  const local = isLocalVendorType(s.vendorType);
  if (step === 'basics') {
    if (!s.name.trim()) e.name = 'Give the store a name customers will recognise.';
    else if (s.name.trim().length > 120) e.name = 'Keep the name under 120 characters.';
    if (!s.vendorType) e.vendorType = 'Pick what kind of store this is.';
    if (s.description.length > 3000) e.description = 'Keep the description under 3000 characters.';
  }
  if (step === 'location') {
    if (!s.location.trim()) e.location = 'Add where the store is, e.g. "Food court, Block A".';
    const hasLat = s.lat.trim() !== ''; const hasLon = s.lon.trim() !== '';
    if (hasLat !== hasLon) e.coords = 'Enter both latitude and longitude, or leave both empty.';
    else if (hasLat && (!Number.isFinite(Number(s.lat)) || Math.abs(Number(s.lat)) > 90 || !Number.isFinite(Number(s.lon)) || Math.abs(Number(s.lon)) > 180)) e.coords = 'Latitude must be −90…90 and longitude −180…180.';
    if (s.whatsapp.trim() && !isValidIndianMobile(s.whatsapp)) e.whatsapp = 'Use a 10-digit Indian mobile number starting with 6–9.';
    if (local && !s.whatsapp.trim()) e.whatsapp = 'Customers reach the stall about their order on this number, so it is required.';
  }
  if (step === 'branding' && s.brandOn) {
    if (!HEX.test(s.primaryColor) || !HEX.test(s.secondaryColor) || !HEX.test(s.accentColor)) e.primaryColor = 'Colours must be hex values like #E23744.';
  }
  if (step === 'hours') {
    const w = validateWeekly(s.weekly);
    if (w) e.weekly = w;
    if (!local && s.deliveryTime.trim() !== '') {
      const n = Number(s.deliveryTime);
      if (!Number.isInteger(n) || n < 5 || n > 240) e.deliveryTime = 'Whole minutes between 5 and 240, or leave empty to hide it.';
    }
    const pf = feeError(s.packagingFee, 500, 'Packaging fee');
    if (pf) e.packagingFee = pf;
    const mo = feeError(s.minOrderValue, 5000, 'Minimum order');
    if (mo) e.minOrderValue = mo;
  }
  if (step === 'login') {
    const pw = s.password.trim();
    if (s.loginPhone.trim() && !isValidIndianMobile(s.loginPhone)) e.loginPhone = 'Use a 10-digit Indian mobile number starting with 6–9.';
    if (pw && pw.length < 6) e.password = 'At least 6 characters (12+ recommended).';
    else if (mode === 'create' && local && !pw) e.password = 'Generate a password so the stall can sign in to the ZCS Vendor app and take orders.';
    else if (mode === 'create' && !local && !s.managedByZenvy && !pw) e.password = 'Generate a password so the partner can sign in, or switch on "Managed by ZCS".';
  }
  if (step === 'commission' && !local) {
    const n = Number(s.commissionRate);
    const max = s.commissionType === 'flat' ? 1000 : 100;
    if (s.commissionRate.trim() === '' || !Number.isFinite(n) || n < 0 || n > max) e.commissionRate = s.commissionType === 'flat' ? 'Between ₹0 and ₹1,000 per order.' : 'Between 0% and 100%.';
  }
  return e;
}

export function buildPayload(s: WizardState, existing: Store | null): Record<string, unknown> {
  const local = isLocalVendorType(s.vendorType);
  const prevBrand = readBrandTheme(existing?.brandTheme) || {};
  const body: Record<string, unknown> = {
    name: s.name.trim(),
    vendorType: s.vendorType,
    location: s.location.trim(),
    campus: s.campus.trim() || null,
    stallDescription: s.description.trim() || null,
    tags: s.tags,
    lat: s.lat.trim() === '' ? null : round6(Number(s.lat)),
    lon: s.lon.trim() === '' ? null : round6(Number(s.lon)),
    whatsappNumber: s.whatsapp.trim() ? tenDigits(s.whatsapp) : null,
    imageUrl: s.imageUrl.trim() || null,
    brandTheme: s.brandOn ? { ...prevBrand, primaryColor: s.primaryColor, secondaryColor: s.secondaryColor, accentColor: s.accentColor, fontColor: (prevBrand.fontColor as string) || '#FFFFFF', logoUrl: s.logoUrl || undefined } : null,
    logoUrl: s.logoUrl.trim() || null,
    phone: s.loginPhone.trim() ? tenDigits(s.loginPhone) : null,
    packagingFee: s.packagingFee.trim() === '' ? 0 : Math.round(Number(s.packagingFee) * 100) / 100,
    minOrderValue: s.minOrderValue.trim() === '' ? 0 : Math.round(Number(s.minOrderValue) * 100) / 100,
    operatingHours: operatingHoursPayload(s.weekly),
    isOpenNow: s.isOpenNow,
    deliveryTime: local || s.deliveryTime.trim() === '' ? null : Number(s.deliveryTime),
    isOffline: local ? false : s.managedByZenvy,
    commissionType: s.commissionType,
    commissionRate: local ? Number(existing?.commissionRate ?? 0) : Number(s.commissionRate),
  };
  if (s.zone.trim()) body.zone = s.zone.trim();
  else if (existing && existing.zone) body.zone = null; // emptied: the server puts back the default zone
  if (s.password.trim()) body.password = s.password.trim();
  return body;
}

// ─── Wizard ──────────────────────────────────────────────────────────────────
export interface WizardResult { store: Store; password: string | null; published: boolean }

export function StoreWizard({ mode, initial, startStep, stores, onClose, onSaved, onOpenStore }: {
  mode: 'create' | 'edit';
  initial: Store | null;
  startStep?: StepKey;
  stores: Store[];
  onClose: () => void;
  onSaved: (result: WizardResult) => void;
  onOpenStore: (id: string, tab?: string) => void;
}) {
  const toast = useToast();
  const titleId = useId();
  const [state, setState] = useState<WizardState>(() => (initial ? stateFromStore(initial) : emptyState()));
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [step, setStep] = useState<StepKey>(startStep || 'basics');
  const [visited, setVisited] = useState<Set<StepKey>>(() => new Set(mode === 'edit' ? (Object.keys(STEP_META) as StepKey[]) : ['basics']));
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState<null | 'draft' | 'publish' | 'save'>(null);
  // Photos still uploading (cover + logo): saving now would store the store without the new photo.
  const [photoUploads, setPhotoUploads] = useState(0);
  const onPhotoBusy = useCallback((busy: boolean) => setPhotoUploads(n => Math.max(0, n + (busy ? 1 : -1))), []);
  const [saveError, setSaveError] = useState('');
  const [done, setDone] = useState<WizardResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const initialJson = useRef(JSON.stringify(initial ? stateFromStore(initial) : emptyState()));
  const mainRef = useRef<HTMLDivElement | null>(null);

  const local = isLocalVendorType(state.vendorType);
  const steps = useMemo<StepKey[]>(() => (local
    ? ['basics', 'location', 'branding', 'hours', 'login', 'review']
    : ['basics', 'location', 'branding', 'hours', 'login', 'commission', 'review']), [local]);
  const index = Math.max(0, steps.indexOf(step));
  const set = (patch: Partial<WizardState>) => setState(prev => ({ ...prev, ...patch }));
  const dirty = JSON.stringify(state) !== initialJson.current;

  // Restore / autosave the create draft (never the password).
  useEffect(() => {
    if (mode !== 'create') return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { state?: Partial<WizardState>; step?: StepKey; savedAt?: string };
      if (saved?.state && saved.state.name !== undefined) {
        setState({ ...emptyState(), ...saved.state, password: '' });
        if (saved.step && saved.step !== 'review') setStep(saved.step);
        setVisited(new Set(Object.keys(STEP_META) as StepKey[]));
        setRestoredAt(saved.savedAt || null);
      }
    } catch { /* storage unavailable */ }
  }, [mode]);
  useEffect(() => {
    if (mode !== 'create' || done) return;
    const t = setTimeout(() => {
      try {
        if (!dirty) return;
        const { password: _pw, ...rest } = state;
        void _pw;
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ state: rest, step, savedAt: new Date().toISOString() }));
      } catch { /* storage unavailable */ }
    }, 500);
    return () => clearTimeout(t);
  }, [state, step, mode, done, dirty]);
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };

  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [step]);

  const stepErrors = (k: StepKey) => validateStep(k, state, mode);
  const goto = (k: StepKey) => {
    setErrors({});
    setStep(k);
    setVisited(prev => new Set(prev).add(k));
  };
  const next = () => {
    const e = stepErrors(step);
    if (Object.keys(e).length) {
      setErrors(e);
      setTimeout(() => mainRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus?.(), 0);
      return;
    }
    goto(steps[Math.min(index + 1, steps.length - 1)]);
  };
  const back = () => goto(steps[Math.max(index - 1, 0)]);

  const allIssues = useMemo(() => steps.filter(k => k !== 'review').map(k => ({ step: k, errors: validateStep(k, state, mode) })).filter(x => Object.keys(x.errors).length), [steps, state, mode]);

  const save = async (kind: 'draft' | 'publish' | 'save') => {
    if (saving || photoUploads > 0) return;
    if (allIssues.length) {
      goto(allIssues[0].step);
      setErrors(allIssues[0].errors);
      return;
    }
    setSaving(kind);
    setSaveError('');
    try {
      const body = buildPayload(state, initial);
      if (kind !== 'save') body.isActive = kind === 'publish';
      const path = initial ? `/api/admin/restaurants/${storeId(initial)}` : '/api/admin/restaurants';
      const saved = await adminRequest<Store>(path, { method: 'POST', body: JSON.stringify(body) });
      const result: WizardResult = { store: saved, password: body.password ? String(body.password) : null, published: kind === 'publish' || (kind === 'save' && !!initial?.isActive) };
      if (mode === 'create') clearDraft();
      onSaved(result);
      if (mode === 'create' || result.password) setDone(result);
      else onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save the store.';
      // 409s from the server: duplicate store name or login phone. Jump to the field.
      if (/already called/i.test(msg)) { goto('basics'); setErrors({ name: msg }); }
      else if (/^This WhatsApp number already signs in/i.test(msg)) { goto('location'); setErrors({ whatsapp: msg }); }
      else if (/phone number already signs in|^Login phone/i.test(msg)) { goto('login'); setErrors({ loginPhone: msg }); }
      else if (/^Packaging fee/i.test(msg)) { goto('hours'); setErrors({ packagingFee: msg }); }
      else if (/^Minimum order/i.test(msg)) { goto('hours'); setErrors({ minOrderValue: msg }); }
      setSaveError(msg);
    } finally {
      setSaving(null);
    }
  };

  const requestClose = () => {
    if (done) return onClose();
    if (mode === 'edit' && dirty) return setConfirmClose(true);
    if (mode === 'create' && dirty) toast.info('Draft kept on this device. Click "Add store" to continue where you left off.');
    onClose();
  };

  const preview = (
    <StorePreviewCard data={{
      name: state.name, imageUrl: state.imageUrl, tags: state.tags, description: state.description,
      deliveryTime: !local && state.deliveryTime ? Number(state.deliveryTime) || null : null,
      isOpen: state.isOpenNow && isOpenByHours(state.weekly), opensAt: primaryWindow(state.weekly).start,
      rating: initial?.rating ?? null, isFeatured: initial?.isFeatured, featuredBadge: initial?.featuredBadge, promoOffer: initial?.promoOffer,
      isLocal: local, whatsappNumber: state.whatsapp, logoUrl: state.logoUrl,
      brand: state.brandOn ? { primaryColor: state.primaryColor, secondaryColor: state.secondaryColor, accentColor: state.accentColor, logoUrl: state.logoUrl } : null,
    }} />
  );

  return (
    <Drawer onClose={requestClose} labelledBy={titleId} width="max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-success-text">{mode === 'create' ? 'New partner' : 'Edit partner'}</p>
          <h2 id={titleId} className="truncate text-lg font-semibold">{done ? 'All set' : mode === 'create' ? (state.name.trim() || 'Add a store') : `Edit ${initial?.name}`}</h2>
        </div>
        <div className="flex items-center gap-2">
          {mode === 'create' && !done && dirty && <span className="hidden text-xs text-fg-muted sm:inline">Draft autosaved on this device</span>}
          <button type="button" onClick={requestClose} aria-label="Close" className={cx('rounded-lg p-2 text-fg-muted hover:bg-surface-2/60 hover:text-fg', FOCUS_RING)}><span aria-hidden="true" className="text-base leading-none">×</span></button>
        </div>
      </div>

      {done ? (
        <SuccessPanel result={done} mode={mode} onOpenStore={onOpenStore} onClose={onClose} />
      ) : (
        <>
          {/* Mobile progress */}
          <div className="border-b border-line px-5 py-3 lg:hidden">
            <div className="flex items-center justify-between text-xs text-fg-muted">
              <span>Step {index + 1} of {steps.length} · <span className="font-semibold text-fg">{STEP_META[step].title}</span></span>
              <span>{Math.round(((index + 1) / steps.length) * 100)}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={index + 1} aria-label="Setup progress">
              <div className="h-full rounded-full bg-success transition-all" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            {/* Step rail */}
            <nav aria-label="Setup steps" className="hidden w-60 shrink-0 overflow-y-auto border-r border-line p-4 lg:block">
              <ol className="space-y-1">
                {steps.map((k, i) => {
                  const current = k === step;
                  const reachable = visited.has(k) || i <= index;
                  const hasIssue = visited.has(k) && k !== step && Object.keys(validateStep(k, state, mode)).length > 0;
                  const complete = visited.has(k) && !hasIssue && i < index;
                  return (
                    <li key={k}>
                      <button
                        type="button"
                        disabled={!reachable}
                        aria-current={current ? 'step' : undefined}
                        onClick={() => goto(k)}
                        className={cx('flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40', current ? 'bg-surface-2/60' : 'hover:bg-surface-2/60', FOCUS_RING)}
                      >
                        <span className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                          current ? 'bg-success text-accent-fg' : hasIssue ? 'bg-warning-soft text-warning-text' : complete ? 'bg-success-soft text-success-text' : 'bg-surface-2 text-fg-muted')}>
                          {hasIssue ? '!' : complete ? '✓' : i + 1}
                        </span>
                        <span className="min-w-0">
                          <span className={cx('block text-sm font-semibold', current ? 'text-fg' : 'text-fg-muted')}>{STEP_META[k].title}</span>
                          <span className="block truncate text-xs text-fg-muted">{STEP_META[k].sub}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              {local && <p className="mt-4 px-2 text-xs leading-relaxed text-fg-muted">Commission is skipped: customers pay the stall cash on delivery and the stall delivers itself.</p>}
            </nav>

            {/* Step body */}
            <div ref={mainRef} className="min-w-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
              {restoredAt && step !== 'review' && (
                <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-sm text-info-text">
                  <span>Restored your unsaved draft from {timeAgo(restoredAt)}. Passwords are never stored, so generate it again.</span>
                  <button type="button" className="font-semibold underline" onClick={() => { clearDraft(); setState(emptyState()); setRestoredAt(null); goto('basics'); }}>Start over</button>
                </div>
              )}
              <div className="mb-6">
                <h3 className="text-xl font-semibold">{STEP_META[step].title}</h3>
                <p className="mt-1 text-sm text-fg-muted">{STEP_HELP[step]}</p>
              </div>
              {step === 'basics' && <BasicsStep s={state} set={set} errors={errors} stores={stores} editingId={initial ? storeId(initial) : null} />}
              {step === 'location' && <LocationStep s={state} set={set} errors={errors} stores={stores} />}
              {step === 'branding' && <BrandingStep s={state} set={set} errors={errors} onPhotoBusy={onPhotoBusy} />}
              {step === 'hours' && <HoursStep s={state} set={set} errors={errors} />}
              {step === 'login' && <LoginStep s={state} set={set} errors={errors} mode={mode} initial={initial} />}
              {step === 'commission' && <CommissionStep s={state} set={set} errors={errors} />}
              {step === 'review' && <ReviewStep s={state} issues={allIssues} goto={goto} mode={mode} initial={initial} preview={preview} />}
              {saveError && <div className="mt-5"><Callout tone="red" title="Not saved">{saveError}</Callout></div>}
            </div>

            {/* Live preview */}
            {step !== 'review' && (
              <aside className="hidden w-[280px] shrink-0 overflow-y-auto border-l border-line p-5 xl:block" aria-label="Live preview">
                {preview}
              </aside>
            )}
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
            <Button variant="ghost" onClick={index === 0 ? requestClose : back}>{index === 0 ? 'Cancel' : '← Back'}</Button>
            <div className="flex flex-wrap items-center gap-2">
              {mode === 'edit' && (
                <Button variant={step === 'review' ? 'primary' : 'secondary'} loading={saving === 'save'} disabled={!dirty || !!saving || photoUploads > 0} title={photoUploads > 0 ? 'Wait for the photo to finish uploading' : undefined} onClick={() => save('save')}>
                  {dirty ? 'Save changes' : 'No changes'}
                </Button>
              )}
              {mode === 'create' && step === 'review' && (
                <>
                  <Button loading={saving === 'draft'} disabled={!!saving || photoUploads > 0} onClick={() => save('draft')} title={photoUploads > 0 ? 'Wait for the photo to finish uploading' : 'Hidden from customers until you publish'}>Save as draft</Button>
                  <Button variant="primary" loading={saving === 'publish'} disabled={!!saving || photoUploads > 0} title={photoUploads > 0 ? 'Wait for the photo to finish uploading' : undefined} onClick={() => save('publish')}>Publish now</Button>
                </>
              )}
              {step !== 'review' && <Button variant={mode === 'create' ? 'primary' : 'secondary'} onClick={next}>{index === steps.length - 2 ? 'Review →' : 'Next →'}</Button>}
            </div>
          </div>
        </>
      )}
      {confirmClose && (
        <ConfirmModal
          title="Discard your changes?"
          body={<p>You edited {initial?.name}. Closing now throws those edits away.</p>}
          actionLabel="Discard changes"
          tone="danger"
          onClose={() => setConfirmClose(false)}
          onConfirm={() => { setConfirmClose(false); onClose(); }}
        />
      )}
    </Drawer>
  );
}

const STEP_HELP: Record<StepKey, string> = {
  basics: 'Who is this partner? The type decides how customers buy from them.',
  location: 'Where riders pick up (or the stall sets off from), and how customers or ZCS reach the store.',
  branding: 'Photos sell. A clear cover photo is the single biggest boost to orders.',
  hours: 'When customers can order, and the bill rules. Outside these hours the app shows "Closed — opens at …".',
  login: 'How the partner signs in to accept orders: the ZCS Restaurant app, or ZCS Vendor for stalls.',
  commission: 'What ZCS keeps from each order. Payouts are settled from the Finance page.',
  review: 'Check everything once. Save as a draft to add the menu first, or publish straight away.',
};

type StepProps = { s: WizardState; set: (p: Partial<WizardState>) => void; errors: Errors };

// ─── Steps ───────────────────────────────────────────────────────────────────
function BasicsStep({ s, set, errors, stores, editingId }: StepProps & { stores: Store[]; editingId: string | null }) {
  const campuses = useMemo(() => uniq(stores.map(x => x.campus).filter(Boolean) as string[]), [stores]);
  const tagSuggestions = useMemo(() => {
    const counts = new Map<string, number>();
    stores.filter(x => (x.vendorType || 'RESTAURANT').toUpperCase() === s.vendorType).forEach(x => readTags(x.tags).forEach(t => counts.set(String(t), (counts.get(String(t)) || 0) + 1)));
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [stores, s.vendorType]);
  const dupe = stores.find(x => storeId(x) !== editingId && x.name.trim().toLowerCase() === s.name.trim().toLowerCase() && s.name.trim());
  const groups: VendorGroup[] = ['Food', 'Campus', 'Shops', 'Services'];
  const known = VENDOR_TYPES.some(v => v.value === s.vendorType);
  return (
    <div className="space-y-6">
      <Field label="Store name" required error={errors.name} help={dupe ? undefined : 'Exactly as on the signboard. Customers search by this.'}>
        {({ id, msgId, invalid }) => (
          <input id={id} data-autofocus aria-describedby={msgId} aria-invalid={invalid} className={INPUT} maxLength={120} value={s.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Sri Sai Tiffins" />
        )}
      </Field>
      {dupe && <Callout tone="amber">Another store is already called “{dupe.name}”. Store names must be unique (partners can sign in with the name), so the server will refuse this one. Add the block or campus.</Callout>}

      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-fg-muted">Store type <span className="text-danger-text" aria-hidden>*</span></legend>
        <div className="space-y-4">
          {groups.map(g => (
            <div key={g}>
              <p className="mb-1.5 text-xs font-semibold text-fg-muted">{g}</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label={`${g} store types`}>
                {VENDOR_TYPES.filter(v => v.group === g).map(v => {
                  const selected = s.vendorType === v.value;
                  return (
                    <button
                      key={v.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => set({ vendorType: v.value })}
                      className={cx('rounded-xl border p-3 text-left transition-colors', selected ? 'border-success/30 bg-success-soft' : 'border-line hover:border-line-strong hover:bg-surface-2/60', FOCUS_RING)}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-fg">{v.label}</span>
                        <span aria-hidden className={cx('h-4 w-4 shrink-0 rounded-full border-2', selected ? 'border-success/30 bg-success' : 'border-line-strong')} />
                      </span>
                      <span className="mt-1 block text-xs leading-snug text-fg-muted">{v.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!known && <Callout tone="amber">This store uses the type “{s.vendorType}”, which is not in the standard list. Pick one above to fix it, or leave it as is.</Callout>}
        </div>
      </fieldset>

      {isLocalVendorType(s.vendorType) && (
        <Callout tone="amber" title="Stall orders in ZCS">Customers order the stall&apos;s items in ZCS and pay the stall cash on delivery. The stall gets the order (customer name, phone and room) in the ZCS Vendor app and delivers it itself. No ZCS rider, no delivery PIN, no coupons.</Callout>
      )}
      {isBookingOnlyStore(s.vendorType) && (
        <Callout tone="sky" title="Booking-only service">Customers book this service from the app; it is never added to the basket.</Callout>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Campus" optional help="Shown to students of this campus first. Pick an existing one to keep names consistent.">
          {({ id, msgId }) => (
            <>
              <input id={id} aria-describedby={msgId} list="wizard-campuses" className={INPUT} value={s.campus} onChange={e => set({ campus: e.target.value })} placeholder="e.g. SRM" />
              <datalist id="wizard-campuses">{campuses.map(c => <option key={c} value={c} />)}</datalist>
            </>
          )}
        </Field>
        <Field label="Cuisines / what it sells" optional help="Shown under the name on the store card (first 3). Press Enter after each.">
          {({ id, msgId }) => <TagInput id={id} describedBy={msgId} value={s.tags} onChange={tags => set({ tags })} suggestions={tagSuggestions} placeholder="e.g. Biryani, South Indian" />}
        </Field>
      </div>
      {/* Up to 3000 characters (was 500, which cut pasted descriptions mid-word without a word). The app shows the
          first paragraph with "More"; headings, lists and **bold** keep their layout there. */}
      <Field label="Store description" optional error={errors.description} aside={<span className="text-xs text-fg-subtle">{s.description.length}/3000</span>} help="The first paragraph shows on the store page; customers tap More for the rest. Lines starting with ### become headings and - lines become lists.">
        {({ id, msgId, invalid }) => (
          <textarea id={id} aria-describedby={msgId} aria-invalid={invalid} className={cx(INPUT, 'h-40 resize-y')} maxLength={3000} value={s.description} onChange={e => set({ description: e.target.value })} placeholder="e.g. Home-style Andhra meals and evening tiffins since 2012." />
        )}
      </Field>
    </div>
  );
}

function LocationStep({ s, set, errors, stores }: StepProps & { stores: Store[] }) {
  const [link, setLink] = useState('');
  const [linkMsg, setLinkMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [locating, setLocating] = useState(false);
  const zones = useMemo(() => uniq(stores.map(x => x.zone).filter(Boolean) as string[]), [stores]);
  const locations = useMemo(() => uniq(stores.map(x => x.location).filter(Boolean)), [stores]);
  const readLink = () => {
    const r = parseMapLink(link);
    if ('error' in r) return setLinkMsg({ ok: false, text: r.error });
    set({ lat: String(r.lat), lon: String(r.lon) });
    setLinkMsg({ ok: true, text: `Pin set to ${r.lat}, ${r.lon}.` });
  };
  const useMyLocation = () => {
    if (!navigator.geolocation) return setLinkMsg({ ok: false, text: 'This browser cannot share its location.' });
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => { setLocating(false); set({ lat: String(round6(pos.coords.latitude)), lon: String(round6(pos.coords.longitude)) }); setLinkMsg({ ok: true, text: `Pin set to your current location (±${Math.round(pos.coords.accuracy)} m). Only use this while standing at the store.` }); },
      err => { setLocating(false); setLinkMsg({ ok: false, text: err.code === 1 ? 'Location permission was denied.' : 'Could not get your location.' }); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };
  const hasPin = s.lat.trim() !== '' && s.lon.trim() !== '' && !errors.coords;
  const wa = tenDigits(s.whatsapp);
  return (
    <div className="space-y-6">
      <Field label="Address / landmark" required error={errors.location} help="What a rider needs to find the counter, e.g. “Food court, Block A, ground floor”.">
        {({ id, msgId, invalid }) => (
          <>
            <input id={id} data-autofocus aria-describedby={msgId} aria-invalid={invalid} list="wizard-locations" className={INPUT} value={s.location} onChange={e => set({ location: e.target.value })} />
            <datalist id="wizard-locations">{locations.map(c => <option key={c} value={c} />)}</datalist>
          </>
        )}
      </Field>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Campus" optional help="Same as in Basics; change here if needed.">
          {({ id, msgId }) => <input id={id} aria-describedby={msgId} className={INPUT} value={s.campus} onChange={e => set({ campus: e.target.value })} />}
        </Field>
        <Field label="Delivery zone" optional help="Used for rider dispatch. Leave empty for the default zone.">
          {({ id, msgId }) => (
            <>
              <input id={id} aria-describedby={msgId} list="wizard-zones" className={INPUT} value={s.zone} onChange={e => set({ zone: e.target.value })} placeholder="Amaravathi_Central" />
              <datalist id="wizard-zones">{zones.map(z => <option key={z} value={z} />)}</datalist>
            </>
          )}
        </Field>
      </div>

      <section className="space-y-3 rounded-xl border border-line p-4" aria-labelledby="pin-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 id="pin-title" className="text-sm font-semibold">Map pin <span className="font-normal text-fg-muted">(optional)</span></h4>
            <p className="text-xs text-fg-muted">Gives riders exact pickup directions and distance.</p>
          </div>
          {hasPin && <a href={mapsUrl(Number(s.lat), Number(s.lon))} target="_blank" rel="noreferrer" className="text-xs font-semibold text-success-text hover:underline">Check on Google Maps ↗</a>}
        </div>
        <div className="flex flex-wrap gap-2">
          <input aria-label="Paste a Google Maps link or coordinates" className={cx(INPUT, 'min-w-[220px] flex-1')} value={link} onChange={e => { setLink(e.target.value); setLinkMsg(null); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); readLink(); } }} placeholder="Paste a Google Maps link, or 16.4632, 80.5064" />
          <Button onClick={readLink} disabled={!link.trim()}>Use map link</Button>
          <Button variant="ghost" onClick={useMyLocation} loading={locating}>Use my location</Button>
        </div>
        {linkMsg && <p role={linkMsg.ok ? 'status' : 'alert'} className={cx('text-xs', linkMsg.ok ? 'text-success-text' : 'text-danger-text')}>{linkMsg.text}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Latitude" error={errors.coords}>
            {({ id, msgId, invalid }) => <input id={id} aria-describedby={msgId} aria-invalid={invalid} inputMode="decimal" className={INPUT} value={s.lat} onChange={e => set({ lat: e.target.value })} placeholder="16.4632" />}
          </Field>
          <Field label="Longitude">
            {({ id }) => <input id={id} inputMode="decimal" className={INPUT} value={s.lon} onChange={e => set({ lon: e.target.value })} placeholder="80.5064" />}
          </Field>
        </div>
      </section>

      <Field
        label="WhatsApp / phone"
        required={isLocalVendorType(s.vendorType)}
        optional={!isLocalVendorType(s.vendorType)}
        error={errors.whatsapp}
        help={isLocalVendorType(s.vendorType) ? 'Customers can WhatsApp or call the stall about their order. The vendor can also sign in to ZCS Vendor with this number.' : 'ZCS support and riders use it to reach the store. Not shown to customers for regular stores.'}
        aside={wa.length === 10 && isValidIndianMobile(wa) ? <a className="text-xs font-semibold text-success-text hover:underline" href={`https://wa.me/91${wa}`} target="_blank" rel="noreferrer">Test on WhatsApp ↗</a> : null}
      >
        {({ id, msgId, invalid }) => (
          <div className="flex">
            <span className="flex items-center rounded-l-lg border border-r-0 border-line bg-surface-2/60 px-3 text-sm text-fg-muted">+91</span>
            <input id={id} aria-describedby={msgId} aria-invalid={invalid} inputMode="tel" autoComplete="off" className={cx(INPUT, 'rounded-l-none')} value={s.whatsapp} onChange={e => set({ whatsapp: e.target.value.replace(/[^\d+\s-]/g, '') })} placeholder="98765 43210" />
          </div>
        )}
      </Field>
    </div>
  );
}

function BrandingStep({ s, set, errors, onPhotoBusy }: StepProps & { onPhotoBusy: (busy: boolean) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-xs font-semibold text-fg-muted">Cover photo <span className="normal-case text-fg-subtle">recommended</span></p>
        <ImagePicker value={s.imageUrl} onChange={imageUrl => set({ imageUrl })} onBusyChange={onPhotoBusy} preset="cover" label="Cover photo" hint="Food or storefront, landscape, bright. JPEG / PNG / WEBP." />
        <p className="mt-2 text-xs text-fg-muted">Used on the Home card, the store page header and Home banners. Avoid text-heavy menus or logos only.</p>
      </div>
      <div className="grid gap-5 md:grid-cols-[180px_1fr]">
        <div>
          <p className="mb-2 text-xs font-semibold text-fg-muted">Logo <span className="normal-case text-fg-subtle">optional</span></p>
          <ImagePicker value={s.logoUrl} onChange={logoUrl => set({ logoUrl })} onBusyChange={onPhotoBusy} preset="logo" label="Logo" hint="Square, transparent PNG works best." aspect="aspect-square" />
        </div>
        <p className="self-center text-xs leading-relaxed text-fg-muted">Shown next to the store name in listings and on the store page. It does not need a brand kit.</p>
      </div>
      <section className="space-y-4 rounded-xl border border-line p-4">
        <Toggle
          checked={s.brandOn}
          onChange={brandOn => set({ brandOn })}
          label="Use brand colours"
          description="For chains and well-known brands. The store page in the app switches to the brand's colours. Leave off for a standard ZCS-styled page."
        />
        {s.brandOn && (
          <div>
            <div className="space-y-4">
              {([['primaryColor', 'Primary'], ['secondaryColor', 'Secondary'], ['accentColor', 'Accent (buttons)']] as const).map(([key, label]) => (
                <Field key={key} label={label} error={key === 'primaryColor' ? errors.primaryColor : undefined}>
                  {({ id, msgId, invalid }) => (
                    <div className="flex items-center gap-2">
                      <input type="color" aria-label={`${label} colour picker`} value={HEX.test(s[key]) ? s[key] : '#000000'} onChange={e => set({ [key]: e.target.value } as Partial<WizardState>)} className="h-10 w-12 cursor-pointer rounded-lg border border-line bg-transparent p-1" />
                      <input id={id} aria-describedby={msgId} aria-invalid={invalid} className={cx(INPUT, 'max-w-[140px] font-mono')} value={s[key]} onChange={e => set({ [key]: e.target.value } as Partial<WizardState>)} />
                    </div>
                  )}
                </Field>
              ))}
              <div className="h-12 rounded-lg" style={{ background: `linear-gradient(135deg, ${s.primaryColor}, ${s.secondaryColor})` }} aria-hidden />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function HoursStep({ s, set, errors }: StepProps) {
  const local = isLocalVendorType(s.vendorType);
  const openNow = isOpenByHours(s.weekly);
  return (
    <div className="space-y-6">
      <WeeklyHoursEditor value={s.weekly} onChange={weekly => set({ weekly })} error={errors.weekly} />
      <section className="space-y-4 rounded-xl border border-line p-4">
        <Toggle
          checked={s.isOpenNow}
          onChange={isOpenNow => set({ isOpenNow })}
          label="Accepting orders"
          description={s.isOpenNow
            ? `On: the store follows its hours (by these hours it is ${openNow ? 'open' : 'closed'} right now). The partner can also pause from their app.`
            : 'Off: the store shows as closed even during its hours, until switched back on.'}
        />
      </section>
      {!local && (
        <Field label="Typical delivery time" optional error={errors.deliveryTime} help="Prep + ride, in minutes. Shown on the store card. Leave empty to hide (better than a wrong promise).">
          {({ id, msgId, invalid }) => (
            <div className="flex items-center gap-3">
              <input id={id} aria-describedby={msgId} aria-invalid={invalid} inputMode="numeric" className={cx(INPUT, 'max-w-[120px]')} value={s.deliveryTime} onChange={e => set({ deliveryTime: e.target.value.replace(/\D/g, '') })} />
              <span className="text-sm text-fg-muted">minutes</span>
              <div className="flex gap-1.5">
                {['20', '30', '45'].map(m => (
                  <button key={m} type="button" onClick={() => set({ deliveryTime: m })} className={cx('rounded-full border px-2.5 py-1 text-xs font-semibold', s.deliveryTime === m ? 'border-success/30 text-success-text' : 'border-line text-fg-muted hover:text-fg', FOCUS_RING)}>{m}</button>
                ))}
              </div>
            </div>
          )}
        </Field>
      )}
      <section className="space-y-4 rounded-xl border border-line p-4" aria-labelledby="bill-rules-title">
        <div>
          <h4 id="bill-rules-title" className="text-sm font-semibold">Bill rules <span className="font-normal text-fg-muted">(optional)</span></h4>
          <p className="text-xs text-fg-muted">Added to the bill the server charges. Leave empty for none.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Packaging fee (₹ per order)" optional error={errors.packagingFee} help="₹0–500. Shown as its own line on the bill.">
            {({ id, msgId, invalid }) => <input id={id} aria-describedby={msgId} aria-invalid={invalid} inputMode="decimal" className={cx(INPUT, 'max-w-[160px]')} value={s.packagingFee} onChange={e => set({ packagingFee: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" />}
          </Field>
          <Field label="Minimum order (₹)" optional error={errors.minOrderValue} help="₹0–5,000 item subtotal. Smaller baskets are refused with a clear message.">
            {({ id, msgId, invalid }) => <input id={id} aria-describedby={msgId} aria-invalid={invalid} inputMode="decimal" className={cx(INPUT, 'max-w-[160px]')} value={s.minOrderValue} onChange={e => set({ minOrderValue: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" />}
          </Field>
        </div>
      </section>
    </div>
  );
}

function LoginStep({ s, set, errors, mode, initial }: StepProps & { mode: 'create' | 'edit'; initial: Store | null }) {
  const [show, setShow] = useState(true);
  const strength = passwordStrength(s.password);
  const id = initial ? storeId(initial) : null;
  const local = isLocalVendorType(s.vendorType);
  const app = local ? 'ZCS Vendor' : 'ZCS Restaurant';
  const effectivePhone = s.loginPhone.trim() ? tenDigits(s.loginPhone) : local ? tenDigits(s.whatsapp) : '';
  const phoneOk = !!effectivePhone && isValidIndianMobile(effectivePhone);
  return (
    <div className="space-y-6">
      {!local && (
        <section className="rounded-xl border border-line p-4">
          <Toggle
            checked={s.managedByZenvy}
            onChange={managedByZenvy => set({ managedByZenvy })}
            label="Managed by ZCS (no partner app)"
            description="For shops without a smartphone. Orders skip the kitchen-accept step and the ZCS team / rider handles them. You can still set a password later."
          />
        </section>
      )}
      {local && (
        <Callout tone="sky" title="The stall needs this to take orders">
          Stall orders reach only the {app} app (customer name, phone, room and items). Without a login the stall never sees them and orders time out after 15 minutes.
        </Callout>
      )}

      {local || !s.managedByZenvy || s.password ? (
        <section className="space-y-5">
          <Field
            label="Login phone"
            optional
            error={errors.loginPhone}
            help={local
              ? `The vendor signs in to ${app} with this number. Leave empty to use the WhatsApp number from the Location step.`
              : `The partner signs in to ${app} with this number (or the Store ID). Each number can sign in to one store only.`}
          >
            {({ id: fid, msgId, invalid }) => (
              <div className="flex max-w-sm">
                <span className="flex items-center rounded-l-lg border border-r-0 border-line bg-surface-2/60 px-3 text-sm text-fg-muted">+91</span>
                <input id={fid} aria-describedby={msgId} aria-invalid={invalid} inputMode="tel" autoComplete="off" className={cx(INPUT, 'rounded-l-none')} value={s.loginPhone} onChange={e => set({ loginPhone: e.target.value.replace(/[^\d+\s-]/g, '') })} placeholder={local && s.whatsapp ? formatWhatsapp(s.whatsapp) : '98765 43210'} />
              </div>
            )}
          </Field>
          <Field
            label={mode === 'edit' ? 'Reset password' : 'Password'}
            required={mode === 'create' && (local || !s.managedByZenvy)}
            optional={mode === 'edit'}
            error={errors.password}
            help={mode === 'edit'
              ? `Leave empty to keep the current password${initial?.hasPassword === false ? ' (none is set yet)' : ''}. A new one works immediately, the old one stops working, and phones already signed in are signed out.`
              : 'Generate a strong one. It is shown once after saving so you can share it; ZCS only stores a hash.'}
            aside={s.password ? <span className={cx('text-xs font-semibold', strength.score >= 3 ? 'text-success-text' : strength.score === 2 ? 'text-warning-text' : 'text-danger-text')}>{strength.label}</span> : null}
          >
            {({ id: fid, msgId, invalid }) => (
              <div className="flex flex-wrap gap-2">
                <input id={fid} aria-describedby={msgId} aria-invalid={invalid} type={show ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} className={cx(INPUT, 'min-w-[200px] flex-1 font-mono')} value={s.password} onChange={e => set({ password: e.target.value })} />
                <Button onClick={() => set({ password: generatePassword(12) })}>Generate strong</Button>
                <Button variant="ghost" onClick={() => setShow(v => !v)} aria-pressed={!show}>{show ? 'Hide' : 'Show'}</Button>
                {s.password && <CopyButton text={s.password} size="md" />}
              </div>
            )}
          </Field>
          <div className="grid gap-4 rounded-xl border border-line bg-surface-2/60 p-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-fg-muted">Signs in to {app} with</p>
              <p className="mt-1 text-sm text-fg">{phoneOk ? `Phone +91 ${formatWhatsapp(effectivePhone)}` : 'No login phone yet'}</p>
              <p className="mt-0.5 text-xs text-fg-muted">
                {id ? <>or Store ID <code className="rounded bg-surface-2/60 px-1 text-success-text">{id}</code></> : 'or the Store ID (shown after saving)'}{local ? '' : ` or the exact name “${s.name.trim() || '…'}”`}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-fg-muted">Password</p>
              <p className="mt-1 text-sm text-fg">{s.password ? 'Will be set when you save (shown once)' : initial?.hasPassword ? 'Set (unchanged)' : 'Not set'}</p>
              {initial && <p className="mt-0.5 text-xs text-fg-muted">{initial.pushDevices ? `App installed on ${initial.pushDevices} phone${initial.pushDevices === 1 ? '' : 's'}` : 'App not signed in on any phone yet'}</p>}
            </div>
          </div>
        </section>
      ) : (
        <Callout tone="sky">No partner login will be created. Switch the toggle off (or edit the store later) to give the partner app access.</Callout>
      )}
    </div>
  );
}

function CommissionStep({ s, set, errors }: StepProps) {
  const [sample, setSample] = useState('400');
  const rate = Number(s.commissionRate) || 0;
  const order = Math.max(0, Number(sample) || 0);
  const commission = s.commissionType === 'flat' ? Math.min(rate, order) : order * rate / 100;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold text-fg-muted">Commission model</p>
        <Segmented label="Commission model" value={s.commissionType} onChange={commissionType => set({ commissionType })} options={[
          { value: 'percentage', label: '% of order value' },
          { value: 'flat', label: '₹ fixed per order' },
        ]} />
      </div>
      <Field label={s.commissionType === 'flat' ? 'Amount per order (₹)' : 'Commission (%)'} required error={errors.commissionRate} help="Charged on the item subtotal only. The rider fee and ZCS coupons never reduce the partner's share.">
        {({ id, msgId, invalid }) => (
          <div className="flex flex-wrap items-center gap-2">
            <input id={id} aria-describedby={msgId} aria-invalid={invalid} inputMode="decimal" className={cx(INPUT, 'max-w-[140px]')} value={s.commissionRate} onChange={e => set({ commissionRate: e.target.value })} />
            {(s.commissionType === 'flat' ? ['0', '10', '20'] : ['0', '10', '15', '20']).map(v => (
              <button key={v} type="button" onClick={() => set({ commissionRate: v })} className={cx('rounded-full border px-2.5 py-1 text-xs font-semibold', s.commissionRate === v ? 'border-success/30 text-success-text' : 'border-line text-fg-muted hover:text-fg', FOCUS_RING)}>
                {s.commissionType === 'flat' ? `₹${v}` : `${v}%`}
              </button>
            ))}
          </div>
        )}
      </Field>
      <section className="rounded-xl border border-line bg-surface-2/60 p-4" aria-label="Payout example">
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          On an order of ₹
          <input aria-label="Example order value" inputMode="numeric" className={cx(INPUT, 'w-24 py-1.5')} value={sample} onChange={e => setSample(e.target.value.replace(/\D/g, ''))} />
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-surface-2/60 p-3"><dt className="text-xs text-fg-muted">Customer pays (items)</dt><dd className="mt-1 text-lg font-semibold">{formatINR(order)}</dd></div>
          <div className="rounded-lg bg-surface-2/60 p-3"><dt className="text-xs text-fg-muted">ZCS keeps</dt><dd className="mt-1 text-lg font-semibold text-warning-text">{formatINR(commission)}</dd></div>
          <div className="rounded-lg bg-success-soft p-3"><dt className="text-xs text-success-text">Partner receives</dt><dd className="mt-1 text-lg font-semibold text-success-text">{formatINR(order - commission)}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-fg-muted">Payments are Cash on Delivery or ZCS Wallet. Delivered orders are settled to the partner from Finance → Payouts.</p>
      </section>
    </div>
  );
}

function ReviewStep({ s, issues, goto, mode, initial, preview }: {
  s: WizardState; issues: { step: StepKey; errors: Errors }[]; goto: (k: StepKey) => void; mode: 'create' | 'edit'; initial: Store | null; preview: ReactNode;
}) {
  const local = isLocalVendorType(s.vendorType);
  const checks: { ok: boolean; text: string; step: StepKey; optional?: boolean }[] = [
    { ok: !!s.imageUrl, text: 'Cover photo added', step: 'branding', optional: true },
    { ok: s.tags.length > 0, text: 'Cuisines / categories tagged', step: 'basics', optional: true },
    { ok: !!s.whatsapp, text: 'Contact number', step: 'location', optional: !local },
    { ok: !!s.lat && !!s.lon, text: 'Map pin for riders', step: 'location', optional: true },
    local
      ? { ok: !!s.password || (mode === 'edit' && !!initial?.hasPassword), text: 'Stall can sign in to ZCS Vendor', step: 'login' as StepKey }
      : { ok: s.managedByZenvy || !!s.password || (mode === 'edit' && !!initial?.hasPassword), text: 'Partner can sign in (or managed by ZCS)', step: 'login' as StepKey },
  ];
  const loginPhone = s.loginPhone.trim() ? `+91 ${formatWhatsapp(s.loginPhone)}` : local && s.whatsapp ? `WhatsApp number (+91 ${formatWhatsapp(s.whatsapp)})` : 'Not set';
  const password = s.password ? 'Will be set (shown once after saving)' : mode === 'edit' ? (initial?.hasPassword ? 'Unchanged' : 'Not set') : 'Not set';
  const fees: [string, ReactNode][] = [
    ['Packaging fee', Number(s.packagingFee) > 0 ? `₹${s.packagingFee} per order` : 'None'],
    ['Minimum order', Number(s.minOrderValue) > 0 ? `₹${s.minOrderValue}` : 'None'],
  ];
  const rows: { step: StepKey; items: [string, ReactNode][] }[] = [
    { step: 'basics', items: [['Name', s.name || '—'], ['Type', vendorLabel(s.vendorType)], ['Campus', s.campus || '—'], ['Tags', s.tags.join(', ') || '—']] },
    { step: 'location', items: [['Address', s.location || '—'], ['Zone', s.zone || 'Default'], ['Map pin', s.lat && s.lon ? `${s.lat}, ${s.lon}` : 'Not set'], ['WhatsApp', s.whatsapp ? `+91 ${formatWhatsapp(s.whatsapp)}` : '—']] },
    { step: 'branding', items: [['Cover photo', s.imageUrl ? 'Added' : 'Missing'], ['Logo', s.logoUrl ? 'Added' : 'None'], ['Brand colours', s.brandOn ? 'On' : 'Off']] },
    { step: 'hours', items: [['Hours', summarizeWeekly(s.weekly)], ['Accepting orders', s.isOpenNow ? 'Yes' : 'Paused'], ...(local ? [] : [['Delivery time', s.deliveryTime ? `${s.deliveryTime} min` : 'Hidden'] as [string, ReactNode]]), ...fees] },
    { step: 'login', items: local
      ? [['App', 'ZCS Vendor'], ['Login phone', loginPhone], ['Password', password], ['Payment', 'Cash on delivery to the stall']]
      : [['Mode', s.managedByZenvy ? 'Managed by ZCS' : 'ZCS Restaurant app'], ['Login phone', loginPhone], ['Password', password]] },
    ...(local ? [] : [
      { step: 'commission' as StepKey, items: [['Commission', s.commissionType === 'flat' ? `₹${s.commissionRate} per order` : `${s.commissionRate}% of order`]] as [string, ReactNode][] },
    ]),
  ];
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
      <div className="space-y-5">
        {issues.length > 0 && (
          <Callout tone="red" title="Fix these before saving">
            <ul className="mt-1 space-y-1">
              {issues.map(i => Object.values(i.errors).map((msg, n) => (
                <li key={`${i.step}${n}`}><button type="button" className="text-left underline underline-offset-2" onClick={() => goto(i.step)}>{STEP_META[i.step].title}: {msg}</button></li>
              )))}
            </ul>
          </Callout>
        )}
        <section aria-label="Readiness" className="rounded-xl border border-line p-4">
          <h4 className="mb-3 text-sm font-semibold">Readiness</h4>
          <ul className="space-y-2">
            {checks.map(c => (
              <li key={c.text} className="flex items-center gap-3 text-sm">
                <span aria-hidden className={cx('flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold', c.ok ? 'bg-success-soft text-success-text' : c.optional ? 'bg-surface-2 text-fg-muted' : 'bg-warning-soft text-warning-text')}>{c.ok ? '✓' : c.optional ? '–' : '!'}</span>
                <span className={c.ok ? 'text-fg' : 'text-fg-muted'}>{c.text}{!c.ok && c.optional ? ' (optional)' : ''}</span>
                {!c.ok && <button type="button" onClick={() => goto(c.step)} className="ml-auto text-xs font-semibold text-success-text hover:underline">Add</button>}
              </li>
            ))}
            {mode === 'create' && (
              <li className="flex items-center gap-3 text-sm">
                <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-fg-muted">→</span>
                <span className="text-fg-muted">Menu: add products right after saving (one by one or paste a CSV).</span>
              </li>
            )}
          </ul>
        </section>
        {rows.map(r => (
          <section key={r.step} className="rounded-xl border border-line">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h4 className="text-sm font-semibold">{STEP_META[r.step].title}</h4>
              <button type="button" onClick={() => goto(r.step)} className={cx('rounded-md px-2 py-1 text-xs font-semibold text-success-text hover:bg-success-soft', FOCUS_RING)}>Edit</button>
            </div>
            <dl className="grid gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-2">
              {r.items.map(([k, v]) => (
                <div key={k} className="min-w-0"><dt className="text-xs text-fg-muted">{k}</dt><dd className="truncate text-fg">{v}</dd></div>
              ))}
            </dl>
          </section>
        ))}
        {mode === 'create' ? (
          <Callout tone="sky"><b>Save as draft</b> keeps the store hidden while you add the menu. <b>Publish now</b> makes it visible to customers immediately and it starts taking orders during its hours{local ? ' (the stall accepts and delivers them in ZCS Vendor)' : ''}.</Callout>
        ) : (
          <p className="text-xs text-fg-muted">Saving keeps the store {initial?.isActive ? 'live' : 'hidden'}; switch it on or off from the store list or the store page.</p>
        )}
      </div>
      <div className="lg:sticky lg:top-0">{preview}</div>
    </div>
  );
}

function SuccessPanel({ result, mode, onOpenStore, onClose }: { result: WizardResult; mode: 'create' | 'edit'; onOpenStore: (id: string, tab?: string) => void; onClose: () => void }) {
  const id = storeId(result.store);
  const [ack, setAck] = useState(!result.password);
  const local = isLocalVendorType(result.store.vendorType);
  const app = local ? 'ZCS Vendor' : 'ZCS Restaurant';
  const phone = tenDigits(result.store.partnerPhone || result.store.phone || (local ? result.store.whatsappNumber : '') || '');
  // WhatsApp link text never carries the password: a wa.me URL lands in browser history and link logs.
  const waText = `${app} app login\nStore: ${result.store.name}${phone ? `\nPhone: ${phone}` : ''}\nStore ID: ${id}\nOpen the ${app} app and sign in with ${phone ? 'your phone number' : 'the Store ID'}. Your password follows in a separate message.`;
  const loginText = `${app} app login\nStore: ${result.store.name}${phone ? `\nPhone: ${phone}` : ''}\nStore ID: ${id}${result.password ? `\nPassword: ${result.password}` : ''}\nOpen the ${app} app and sign in with ${phone ? 'your phone number' : 'the Store ID'} and the password.`;
  return (
    <div className="flex-1 overflow-y-auto px-5 py-8 sm:px-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="text-center">
          <div aria-hidden className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-2xl text-success-text"></div>
          <h3 className="text-2xl font-semibold">{mode === 'create' ? `${result.store.name} is ${result.published ? 'live' : 'saved as a draft'}` : 'Changes saved'}</h3>
          <p className="mt-2 text-sm text-fg-muted">
            {mode === 'create'
              ? result.published ? 'Customers can see it now. Add the menu so they can order.' : 'It is hidden from customers. Add the menu, then publish from the store page.'
              : 'The new password is active now.'}
          </p>
        </div>
        {(result.password || mode === 'create') && (
          <section className="space-y-3 rounded-xl border border-warning/30 bg-warning-soft p-4" aria-labelledby="creds-title">
            <div className="flex items-center justify-between gap-2">
              <h4 id="creds-title" className="font-semibold text-warning-text">{app} login details</h4>
              <Chip tone="amber">{result.password ? 'Shown once' : 'No password set'}</Chip>
            </div>
            <dl className="space-y-2 text-sm">
              {phone && <div className="flex flex-wrap items-center gap-2"><dt className="w-24 text-fg-muted">Phone</dt><dd className="flex-1"><code className="select-all text-success-text">{phone}</code></dd><CopyButton text={phone} /></div>}
              <div className="flex flex-wrap items-center gap-2"><dt className="w-24 text-fg-muted">Store ID</dt><dd className="flex-1"><code className="select-all break-all text-success-text">{id}</code></dd><CopyButton text={id} /></div>
              {result.password && <div className="flex flex-wrap items-center gap-2"><dt className="w-24 text-fg-muted">Password</dt><dd className="flex-1"><code className="select-all font-mono text-fg">{result.password}</code></dd><CopyButton text={result.password} /></div>}
            </dl>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <CopyButton text={loginText} label="Copy message for the partner" variant="amber" size="md" />
              {result.store.whatsappNumber && <a className="text-xs font-semibold text-success-text hover:underline" target="_blank" rel="noreferrer" href={`https://wa.me/${result.store.whatsappNumber}?text=${encodeURIComponent(waText)}`} title="Sends the login details without the password. Paste the password separately.">Send login (no password) on WhatsApp ↗</a>}
            </div>
            {result.password && (
              <label className="flex items-center gap-2 text-xs text-fg-muted">
                <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
                I have saved or shared the password. It cannot be shown again (only reset).
              </label>
            )}
          </section>
        )}
        <div className="flex flex-wrap justify-center gap-3">
          {mode === 'create' && <Button variant="primary" disabled={!ack} onClick={() => onOpenStore(id, 'menu')}>Add menu items →</Button>}
          <Button disabled={!ack} onClick={() => (mode === 'create' ? onOpenStore(id, 'overview') : onClose())}>{mode === 'create' ? 'Open store page' : 'Done'}</Button>
          {mode === 'create' && <Button variant="ghost" disabled={!ack} onClick={onClose}>Back to all stores</Button>}
        </div>
      </div>
    </div>
  );
}

const uniq = (list: string[]) => Array.from(new Set(list.map(s => s.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
