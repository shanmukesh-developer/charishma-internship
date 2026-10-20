"use client";
import { ENTRY_LABEL, ENTRY_TYPES, EntryType, FIELD, GUARD_LABEL, GUARD_MODES, GuardMode, LABEL, PGHostel, PgSafety } from './pgApi';
import { AppPreview, SaveBar, compactObj, multiLine, oneLine, textError, time12, useSectionEditor } from './contentShared';

type Tri = '' | 'yes' | 'no';
type Draft = {
  cctv: Tri; fireExtinguishers: Tri; firstAid: Tri; entry: EntryType | ''; guard: GuardMode | ''; guardFrom: string; guardTo: string;
  wardenName: string; wardenAvailability: string; emergency: string;
};
const tri = (b?: boolean): Tri => (b === true ? 'yes' : b === false ? 'no' : '');
const fromTri = (t: Tri) => (t === 'yes' ? true : t === 'no' ? false : undefined);

const toDraft = (v?: PgSafety | null): Draft => ({
  cctv: tri(v?.cctv), fireExtinguishers: tri(v?.fireExtinguishers), firstAid: tri(v?.firstAid),
  entry: v?.entry || '', guard: v?.guard || '', guardFrom: v?.guardFrom || '', guardTo: v?.guardTo || '',
  wardenName: v?.wardenName || '', wardenAvailability: v?.wardenAvailability || '', emergency: v?.emergency || '',
});
const toValue = (d: Draft): PgSafety | null => compactObj<PgSafety>({
  cctv: fromTri(d.cctv),
  entry: d.entry || undefined,
  guard: d.guard || undefined,
  guardFrom: d.guard === 'hours' ? d.guardFrom || undefined : undefined,
  guardTo: d.guard === 'hours' ? d.guardTo || undefined : undefined,
  fireExtinguishers: fromTri(d.fireExtinguishers),
  firstAid: fromTri(d.firstAid),
  wardenName: oneLine(d.wardenName),
  wardenAvailability: oneLine(d.wardenAvailability),
  emergency: multiLine(d.emergency),
}) || null;
const validate = (d: Draft) => {
  if (d.guard === 'hours' && (!d.guardFrom || !d.guardTo)) return 'Security guard hours: enter both times.';
  return textError(oneLine(d.wardenName), 60, 'Warden name')
    || textError(oneLine(d.wardenAvailability), 120, 'Warden availability')
    || textError(multiLine(d.emergency), 600, 'Emergency process');
};
const ENTRY_APP: Record<EntryType, string> = { biometric: 'Biometric entry', keycard: 'Key card entry', key: 'Key entry' };

function TriSelect({ label, value, onChange }: { label: string; value: Tri; onChange: (v: Tri) => void }) {
  return (
    <label className={LABEL}>{label}
      <select className={FIELD} value={value} onChange={e => onChange(e.target.value as Tri)}>
        <option value="">Not specified</option><option value="yes">Yes</option><option value="no">No</option>
      </select>
    </label>
  );
}

/** Entry, guard, safety equipment, warden and the emergency process. */
export function SafetyPanel({ pg, onSaved }: { pg: PGHostel; onSaved: (pg: Partial<PGHostel>) => void }) {
  const ed = useSectionEditor<Draft, PgSafety>({ pgId: pg.id, path: 'safety', field: 'safety', source: pg.safety, toDraft, toValue, validate, noun: 'Safety', onSaved });
  const d = ed.draft;
  const set = (patch: Partial<Draft>) => ed.update(prev => ({ ...prev, ...patch }));
  const v = toValue(d);
  const hoursBad = d.guard === 'hours' && (!d.guardFrom || !d.guardTo);
  const guardText = v?.guard === '24x7' ? 'Round the clock (24×7)' : v?.guard === 'night' ? 'At night' : v?.guard === 'hours' && v.guardFrom ? `${time12(v.guardFrom)} – ${time12(v.guardTo)}` : '';
  const checks = ([['CCTV cameras', v?.cctv], ['Fire extinguishers', v?.fireExtinguishers], ['First aid kit', v?.firstAid]] as const).filter(([, x]) => typeof x === 'boolean');

  return (
    <div className="space-y-5">
      <p className="text-xs text-fg-muted">Shown under Safety and staff on the PG page. Leave blank to hide.</p>
      <p role="note" className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning-text">Do not add phone numbers. Students reach the warden through the Zenvy housing desk.</p>

      <fieldset className="space-y-3 rounded-xl border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-info-text">Security</legend>
        <div className="grid gap-3 md:grid-cols-3">
          <label className={LABEL}>Entry
            <select className={FIELD} value={d.entry} onChange={e => set({ entry: e.target.value as EntryType | '' })}>
              <option value="">Not specified</option>
              {ENTRY_TYPES.map(t => <option key={t} value={t}>{ENTRY_LABEL[t]}</option>)}
            </select>
          </label>
          <label className={LABEL}>Security guard
            <select className={FIELD} value={d.guard} onChange={e => set({ guard: e.target.value as GuardMode | '' })}>
              <option value="">Not specified</option>
              {GUARD_MODES.map(m => <option key={m} value={m}>{GUARD_LABEL[m]}</option>)}
            </select>
          </label>
          <TriSelect label="CCTV" value={d.cctv} onChange={cctv => set({ cctv })} />
        </div>
        {d.guard === 'hours' && (
          <div className="grid max-w-md grid-cols-2 gap-3">
            <label className={LABEL}>Guard from<input type="time" aria-invalid={hoursBad && !d.guardFrom} className={`${FIELD} ${hoursBad && !d.guardFrom ? 'border-danger/30' : ''}`} value={d.guardFrom} onChange={e => set({ guardFrom: e.target.value })} /></label>
            <label className={LABEL}>Guard until<input type="time" aria-invalid={hoursBad && !d.guardTo} className={`${FIELD} ${hoursBad && !d.guardTo ? 'border-danger/30' : ''}`} value={d.guardTo} onChange={e => set({ guardTo: e.target.value })} /></label>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          <TriSelect label="Fire extinguishers" value={d.fireExtinguishers} onChange={fireExtinguishers => set({ fireExtinguishers })} />
          <TriSelect label="First aid kit" value={d.firstAid} onChange={firstAid => set({ firstAid })} />
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-info-text">Warden</legend>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={LABEL}>Name<input className={FIELD} maxLength={80} placeholder="e.g. Mr. Rao" value={d.wardenName} onChange={e => set({ wardenName: e.target.value })} /></label>
          <label className={LABEL}>Availability<input className={FIELD} maxLength={140} placeholder="e.g. On site, 8:00 AM to 10:00 PM" value={d.wardenAvailability} onChange={e => set({ wardenAvailability: e.target.value })} /></label>
        </div>
      </fieldset>

      <label className={LABEL}>In an emergency
        <textarea rows={4} maxLength={700} className={`${FIELD} resize-y normal-case tracking-normal`} placeholder="e.g. Tell the warden or the guard at the gate. The nearest hospital is listed under Location." value={d.emergency} onChange={e => set({ emergency: e.target.value })} />
      </label>

      <AppPreview empty={!v}>
        {v?.entry && <p><span className="text-fg-muted">Entry: </span>{ENTRY_APP[v.entry]}</p>}
        {guardText && <p><span className="text-fg-muted">Security guard: </span>{guardText}</p>}
        {checks.length > 0 && <p>{checks.map(([label, x]) => `${label}: ${x ? 'Yes' : 'No'}`).join(' · ')}</p>}
        {v?.wardenName && <p><span className="text-fg-muted">Warden: </span>{v.wardenName}{v.wardenAvailability ? ` · ${v.wardenAvailability}` : ''}</p>}
        {v?.wardenName && <p className="text-xs text-fg-muted">Students see a &quot;Contact through housing desk&quot; button, not a phone number.</p>}
        {v?.emergency && <p className="whitespace-pre-line"><span className="text-fg-muted">In an emergency: </span>{v.emergency}</p>}
      </AppPreview>
      <SaveBar dirty={ed.dirty} saving={ed.saving} message={ed.message} onSave={ed.save} onDiscard={ed.discard} />
    </div>
  );
}
