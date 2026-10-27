"use client";
import { useConfirm } from '@/components/ui';
import { useState } from 'react';
import { FIELD, LABEL, PGHostel, normalizeGender } from './pgApi';

// Plain names: the app picks the icon. Older listings may still carry emoji labels; the app strips them.
const AMENITIES = ['WiFi', 'Mess / food', 'AC', 'Laundry', 'Hot water', 'Power backup', '24/7 security', 'CCTV', 'Housekeeping', 'Gym', 'Study room', 'Parking'];

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const toForm = (pg: PGHostel | null) => {
  const ci = (pg?.contactInfo || {}) as Record<string, unknown>;
  return {
    name: pg?.name || '',
    address: pg?.address || '',
    distanceFromCollege: pg ? str(pg.distanceFromCollege) : '',
    genderType: normalizeGender(pg?.genderType),
    baseRent: pg ? str(pg.baseRent) : '',
    securityDeposit: pg ? str(pg.securityDeposit ?? 0) : '0',
    description: pg?.description || '',
    isActive: pg?.isActive ?? true,
    isVerified: pg?.isVerified === true,
    area: pg?.area || '',
    amenities: pg?.amenities || [],
    rules: pg?.rules || [],
    contact: {
      ownerName: str(ci.ownerName), phone: str(ci.phone), email: str(ci.email),
      wardenName: str(ci.wardenName ?? ci.warden), emergencyContact: str(ci.emergencyContact),
      lat: str(ci.lat), lng: str(ci.lng),
    },
  };
};

type FormState = ReturnType<typeof toForm>;

/** Builds the PG payload (POST /api/pg, PUT /api/pg/:id) or returns a validation message. */
function buildPayload(f: FormState): { payload?: Record<string, unknown>; error?: string } {
  const distance = Number(f.distanceFromCollege);
  const rent = Number(f.baseRent);
  const deposit = Number(f.securityDeposit || 0);
  if (!f.name.trim()) return { error: 'Hostel name is required.' };
  if (!f.address.trim()) return { error: 'Address is required.' };
  if (f.area.trim().length > 80) return { error: 'Area must be at most 80 characters.' };
  if (!Number.isFinite(distance) || distance < 0 || distance > 100) return { error: 'Distance must be between 0 and 100 km.' };
  if (!Number.isFinite(rent) || rent <= 0) return { error: 'Enter the base rent per month.' };
  if (!Number.isFinite(deposit) || deposit < 0) return { error: 'Deposit cannot be negative.' };
  const coord = (v: string, max: number) => {
    if (!v.trim()) return null;
    const n = Number(v);
    return Number.isFinite(n) && Math.abs(n) <= max ? n : NaN;
  };
  const lat = coord(f.contact.lat, 90);
  const lng = coord(f.contact.lng, 180);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return { error: 'Latitude must be between -90 and 90 and longitude between -180 and 180.' };
  if ((lat === null) !== (lng === null)) return { error: 'Enter both latitude and longitude, or neither.' };
  return {
    payload: {
      name: f.name.trim(),
      address: f.address.trim(),
      distanceFromCollege: distance,
      genderType: f.genderType,
      baseRent: rent,
      securityDeposit: deposit,
      description: f.description.trim(),
      isActive: f.isActive,
      isVerified: f.isVerified,
      area: f.area.trim(),
      amenities: f.amenities,
      rules: f.rules,
      contactInfo: {
        ownerName: f.contact.ownerName.trim(), phone: f.contact.phone.trim(), email: f.contact.email.trim(),
        wardenName: f.contact.wardenName.trim(), emergencyContact: f.contact.emergencyContact.trim(), lat, lng,
      },
    },
  };
}

export function PgForm({ initial, onCancel, onSave }: {
  initial: PGHostel | null;
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const confirm = useConfirm();
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<FormState>) => setForm(prev => ({ ...prev, ...patch }));
  const setContact = (patch: Partial<FormState['contact']>) => setForm(prev => ({ ...prev, contact: { ...prev.contact, ...patch } }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const { payload, error: invalid } = buildPayload(form);
    if (!payload) return setError(invalid || 'Check the form.');
    if (initial?.isActive && !form.isActive && !(await confirm({ title: 'Hide this PG from the app?', description: 'Students can no longer see or book it.', confirmLabel: 'Save and hide', tone: 'danger' }))) return;
    setSaving(true);
    setError('');
    try {
      await onSave(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the PG.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <label className={LABEL}>Hostel name<input className={FIELD} required value={form.name} onChange={e => set({ name: e.target.value })} /></label>
        <label className={LABEL}>Address<input className={FIELD} required value={form.address} onChange={e => set({ address: e.target.value })} /></label>
        <label className={LABEL}>Area / locality<input className={FIELD} maxLength={80} placeholder="e.g. Neerukonda" value={form.area} onChange={e => set({ area: e.target.value })} /></label>
        <div className="grid grid-cols-2 gap-4 md:col-span-2 md:grid-cols-4">
          <label className={LABEL}>Distance (km)<input inputMode="decimal" className={FIELD} required value={form.distanceFromCollege} onChange={e => set({ distanceFromCollege: e.target.value })} /></label>
          <label className={LABEL}>For
            <select className={FIELD} value={form.genderType} onChange={e => set({ genderType: e.target.value })}>
              <option value="Boys">Boys</option><option value="Girls">Girls</option><option value="Co-ed">Co-ed</option>
            </select>
          </label>
          <label className={LABEL}>Base rent (₹/month)<input inputMode="numeric" className={FIELD} required value={form.baseRent} onChange={e => set({ baseRent: e.target.value })} /></label>
          <label className={LABEL}>Deposit (₹)<input inputMode="numeric" className={FIELD} value={form.securityDeposit} onChange={e => set({ securityDeposit: e.target.value })} /></label>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold text-info-text">Contact & location</legend>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className={LABEL}>Owner<input className={FIELD} value={form.contact.ownerName} onChange={e => setContact({ ownerName: e.target.value })} /></label>
          <label className={LABEL}>Phone<input inputMode="tel" className={FIELD} value={form.contact.phone} onChange={e => setContact({ phone: e.target.value })} /><span className="block text-xs font-normal normal-case text-fg-muted">Internal: not shown in the app</span></label>
          <label className={LABEL}>Email<input type="email" className={FIELD} value={form.contact.email} onChange={e => setContact({ email: e.target.value })} /><span className="block text-xs font-normal normal-case text-fg-muted">Internal: not shown in the app</span></label>
          <label className={LABEL}>Warden<input className={FIELD} value={form.contact.wardenName} onChange={e => setContact({ wardenName: e.target.value })} /></label>
          <label className={LABEL}>Emergency contact<input inputMode="tel" className={FIELD} value={form.contact.emergencyContact} onChange={e => setContact({ emergencyContact: e.target.value })} /><span className="block text-xs font-normal normal-case text-fg-muted">Internal: not shown in the app</span></label>
          <label className={LABEL}>Latitude<input inputMode="decimal" className={FIELD} value={form.contact.lat} onChange={e => setContact({ lat: e.target.value })} placeholder="e.g. 16.4632" /></label>
          <label className={LABEL}>Longitude<input inputMode="decimal" className={FIELD} value={form.contact.lng} onChange={e => setContact({ lng: e.target.value })} placeholder="e.g. 80.5064" /></label>
        </div>
      </fieldset>

      <p className="text-xs text-fg-muted">{initial ? 'House rules are edited on the House rules tab.' : 'Add house rules on the House rules tab after creating the PG.'}{form.rules.length ? ` The ${form.rules.length} rule${form.rules.length === 1 ? '' : 's'} from the older single list ${form.rules.length === 1 ? 'is' : 'are'} kept; that tab can move them into a group.` : ''}</p>

      <label className={LABEL}>Description<textarea className={`${FIELD} h-20 resize-none`} value={form.description} onChange={e => set({ description: e.target.value })} /></label>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-info-text">Amenities</legend>
        <div className="flex flex-wrap gap-2">
          {Array.from(new Set([...AMENITIES, ...form.amenities])).map(a => {
            const on = form.amenities.includes(a);
            return (
              <button key={a} type="button" aria-pressed={on} onClick={() => set({ amenities: on ? form.amenities.filter(x => x !== a) : [...form.amenities, a] })} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${on ? 'border-info/30 bg-info-soft text-info-text' : 'border-line text-fg-muted hover:text-fg'}`}>{a}</button>
            );
          })}
        </div>
      </fieldset>

      <label className="flex items-center gap-3 text-sm text-fg-muted">
        <input type="checkbox" checked={form.isActive} onChange={e => set({ isActive: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--accent))]" />
        Listed in the app (students can see and book it)
      </label>
      <label className="flex items-center gap-3 text-sm text-fg-muted">
        <input type="checkbox" checked={form.isVerified} onChange={e => set({ isVerified: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--accent))]" />
        Verified by the ZCS housing team (site visit done; shows a Verified mark)
      </label>
      {initial ? <p className="text-xs text-fg-muted">Rooms, photos, videos, mess timetable, timings, overview highlights, house rules, policies, safety, move-in, location and nearby, FAQ and reviews have their own tabs above.</p> : <p className="text-xs text-fg-muted">After creating the PG, add rooms, photos, videos, the mess timetable, timings, highlights, house rules, policies, safety, move-in details, the location guide and FAQ from its tabs.</p>}

      {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger-text">{error}</p>}

      <div className="flex justify-end gap-3 border-t border-line pt-4">
        <button type="button" onClick={onCancel} className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-fg-muted hover:text-fg">Cancel</button>
        <button type="submit" disabled={saving} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-on-solid hover:bg-accent-hover disabled:opacity-50">{saving ? 'Saving…' : initial ? 'Save PG' : 'Create PG'}</button>
      </div>
    </form>
  );
}
