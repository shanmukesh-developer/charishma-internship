"use client";
import { useConfirm } from '@/components/ui';
import { useState } from 'react';
import { DAY_KEYS, DAY_LABEL, DayKey, FIELD, FoodTag, MessCell, MessMeal, MessTimetable, PGHostel, pgRequest } from './pgApi';
import { SaveBar, errorText } from './contentShared';

type MealDraft = { key: string; label: string; start: string; end: string };
type Cells = Record<DayKey, Record<string, { menu: string; tag: FoodTag; start?: string; end?: string }>>;
type Draft = { meals: MealDraft[]; cells: Cells; notes: string };

const DEFAULT_MEALS: MealDraft[] = [
  { key: 'breakfast', label: 'Breakfast', start: '07:30', end: '09:30' },
  { key: 'lunch', label: 'Lunch', start: '12:30', end: '14:00' },
  { key: 'snacks', label: 'Snacks', start: '17:00', end: '18:00' },
  { key: 'dinner', label: 'Dinner', start: '19:30', end: '21:30' },
];
const emptyCells = (): Cells => Object.fromEntries(DAY_KEYS.map(d => [d, {}])) as Cells;

// Old free-text timings like "8:00 AM - 9:30 AM" -> "08:00" / "09:30" (blank when unreadable).
const to24 = (t: string) => {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(t.trim());
  if (!m) return '';
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'am' && h === 12) h = 0;
  if (ap === 'pm' && h < 12) h += 12;
  return h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : '';
};
const legacySlot = (v: unknown): [string, string] => {
  if (v && typeof v === 'object') { const o = v as { start?: string; end?: string }; return [to24(o.start || ''), to24(o.end || '')]; }
  const [a, b] = String(v || '').split(/\s*(?:-|–|to)\s*/i);
  return a && b ? [to24(a), to24(b)] : ['', ''];
};
const LEGACY_DAYS: Record<string, DayKey> = { monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu', friday: 'fri', saturday: 'sat', sunday: 'sun' };

function toDraft(pg: PGHostel): { draft: Draft; legacy: boolean } {
  const t = pg.messTimetable;
  if (t && Array.isArray(t.meals) && t.meals.length) {
    const cells = emptyCells();
    for (const d of DAY_KEYS) for (const [k, c] of Object.entries(t.days?.[d] || {})) cells[d][k] = { menu: c.menu || '', tag: c.tag || null, ...(c.start ? { start: c.start, end: c.end } : {}) };
    return { draft: { meals: t.meals.map(m => ({ key: m.key, label: m.label, start: m.start || '', end: m.end || '' })), cells, notes: t.notes || '' }, legacy: false };
  }
  const menu = (pg.messMenu || {}) as Record<string, Record<string, string>>;
  const tt = (pg.foodTimetable || {}) as Record<string, unknown>;
  const hasLegacy = Object.values(menu).some(r => r && Object.values(r).some(Boolean)) || ['breakfast', 'lunch', 'dinner'].some(k => tt[k]);
  if (!hasLegacy) return { draft: { meals: [], cells: emptyCells(), notes: '' }, legacy: false };
  const meals = (['breakfast', 'lunch', 'dinner'] as const).map(k => { const [start, end] = legacySlot(tt[k]); return { key: k, label: k[0].toUpperCase() + k.slice(1), start, end }; });
  const cells = emptyCells();
  for (const [name, row] of Object.entries(menu)) {
    const d = LEGACY_DAYS[name.toLowerCase()];
    if (!d || !row) continue;
    for (const k of ['breakfast', 'lunch', 'dinner']) if (row[k]) cells[d][k] = { menu: String(row[k]), tag: null };
  }
  return { draft: { meals, cells, notes: '' }, legacy: true };
}

function toPayload(d: Draft): MessTimetable | null {
  if (!d.meals.length) return null;
  const keys = new Set(d.meals.map(m => m.key));
  const days: MessTimetable['days'] = {};
  for (const day of DAY_KEYS) {
    const row: Record<string, MessCell> = {};
    for (const [k, c] of Object.entries(d.cells[day] || {})) {
      if (!keys.has(k) || (!c.menu.trim() && !c.tag)) continue;
      row[k] = { menu: c.menu.trim(), tag: c.tag, ...(c.start ? { start: c.start, end: c.end } : {}) };
    }
    if (Object.keys(row).length) days[day] = row;
  }
  return { meals: d.meals.map((m): MessMeal => ({ key: m.key, label: m.label.trim(), start: m.start || null, end: m.end || null })), days, notes: d.notes.trim() };
}

function validate(d: Draft): string | null {
  const seen = new Set<string>();
  for (const m of d.meals) {
    if (!m.label.trim()) return 'Every meal needs a name.';
    if (seen.has(m.key)) return `"${m.label}" is listed twice.`;
    seen.add(m.key);
    if (!!m.start !== !!m.end) return `${m.label}: enter both a start and an end time, or neither.`;
    if (m.start && m.end <= m.start) return `${m.label}: the end time must be after the start time.`;
  }
  if (!d.meals.length && (d.notes.trim() || DAY_KEYS.some(day => Object.values(d.cells[day]).some(c => c.menu.trim())))) return 'Add at least one meal.';
  return null;
}

export function MessPanel({ pg, onSaved }: { pg: PGHostel; onSaved: (pg: Partial<PGHostel>) => void }) {
  const confirm = useConfirm();
  const [{ draft: start, legacy }] = useState(() => toDraft(pg));
  const [initial, setInitial] = useState<Draft>(start);
  const [draft, setDraft] = useState<Draft>(start);
  const [wasLegacy, setWasLegacy] = useState(legacy);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const dirty = JSON.stringify(toPayload(draft)) !== JSON.stringify(toPayload(initial)) || wasLegacy;
  const invalid = validate(draft);

  const setMeal = (i: number, patch: Partial<MealDraft>) => { setMessage(null); setDraft(prev => ({ ...prev, meals: prev.meals.map((m, j) => (j === i ? { ...m, ...patch } : m)) })); };
  const addMeal = () => setDraft(prev => {
    let n = prev.meals.length + 1;
    while (prev.meals.some(m => m.key === `meal_${n}`)) n++;
    return { ...prev, meals: [...prev.meals, { key: `meal_${n}`, label: '', start: '', end: '' }] };
  });
  const removeMeal = async (i: number) => {
    const m = draft.meals[i];
    const used = DAY_KEYS.some(d => draft.cells[d][m.key]?.menu);
    if (used && !(await confirm({ title: `Remove ${m.label || 'this meal'} and its menus?`, description: 'The menus entered for it on every day are removed from this draft.', confirmLabel: 'Remove meal', tone: 'danger' }))) return;
    setDraft(prev => ({ ...prev, meals: prev.meals.filter((_, j) => j !== i) }));
  };
  const setCell = (day: DayKey, key: string, patch: Partial<{ menu: string; tag: FoodTag }>) => {
    setMessage(null);
    setDraft(prev => ({ ...prev, cells: { ...prev.cells, [day]: { ...prev.cells[day], [key]: { ...(prev.cells[day][key] || { menu: '', tag: null }), ...patch } } } }));
  };
  const copyDay = async (from: DayKey) => {
    if (!(await confirm({ title: `Copy ${DAY_LABEL[from]}'s menu to every other day?`, description: 'Their current menus are replaced in this draft.', confirmLabel: 'Copy menu' }))) return;
    setDraft(prev => ({ ...prev, cells: Object.fromEntries(DAY_KEYS.map(d => [d, { ...prev.cells[from] }])) as Cells }));
  };

  const save = async () => {
    if (saving) return;
    if (invalid) { setMessage({ kind: 'error', text: invalid }); return; }
    setSaving(true);
    setMessage(null);
    try {
      const saved = await pgRequest<{ messTimetable: MessTimetable | null }>(`/api/pg/${pg.id}/mess`, { method: 'PUT', body: JSON.stringify({ messTimetable: toPayload(draft) }) });
      const next = toDraft({ ...pg, messTimetable: saved.messTimetable, messMenu: {}, foodTimetable: {} }).draft;
      setInitial(next);
      setDraft(next);
      setWasLegacy(false);
      onSaved({ messTimetable: saved.messTimetable });
      setMessage({ kind: 'ok', text: saved.messTimetable ? 'Mess timetable saved.' : 'Mess timetable cleared.' });
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e, 'Could not save the timetable.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {wasLegacy && <p className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-xs text-warning-text">Loaded from the older menu fields. Check the times and save to switch this PG to the new timetable.</p>}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-info-text">Meals and times</h3>
          <div className="flex gap-2">
            {!draft.meals.length && <button type="button" onClick={() => setDraft(prev => ({ ...prev, meals: DEFAULT_MEALS }))} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-2/60">Start with breakfast, lunch, snacks, dinner</button>}
            <button type="button" disabled={draft.meals.length >= 6} onClick={addMeal} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-2/60 disabled:opacity-40">Add meal</button>
          </div>
        </div>
        {draft.meals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-fg-muted">No meals yet.</p>
        ) : (
          <div className="space-y-2">
            {draft.meals.map((m, i) => (
              <div key={m.key} className="grid grid-cols-[1fr_120px_120px_auto] items-center gap-2">
                <input aria-label={`Meal ${i + 1} name`} className={FIELD} maxLength={30} placeholder="Meal name" value={m.label} onChange={e => setMeal(i, { label: e.target.value })} />
                <input aria-label={`${m.label || 'Meal'} starts`} type="time" className={FIELD} value={m.start} onChange={e => setMeal(i, { start: e.target.value })} />
                <input aria-label={`${m.label || 'Meal'} ends`} type="time" className={FIELD} value={m.end} onChange={e => setMeal(i, { end: e.target.value })} />
                <button type="button" onClick={() => removeMeal(i)} className="px-2 text-xs text-danger-text hover:text-danger-text" aria-label={`Remove ${m.label || 'meal'}`}>Remove</button>
              </div>
            ))}
            <p className="text-xs text-fg-muted">Times are IST. The app shows students which meal is being served now and how long until the next one.</p>
          </div>
        )}
      </section>

      {draft.meals.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-info-text">Weekly menu</h3>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2/60 text-left text-xs text-fg-muted">
                  <th className="w-28 px-3 py-2 font-semibold">Day</th>
                  {draft.meals.map(m => <th key={m.key} className="px-3 py-2 font-semibold">{m.label || 'Meal'}</th>)}
                </tr>
              </thead>
              <tbody>
                {DAY_KEYS.map(day => (
                  <tr key={day} className="border-t border-line align-top">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-fg">{DAY_LABEL[day]}</div>
                      <button type="button" onClick={() => copyDay(day)} className="mt-1 text-xs text-fg-muted hover:text-fg">Copy to all days</button>
                    </td>
                    {draft.meals.map(m => {
                      const c = draft.cells[day][m.key] || { menu: '', tag: null };
                      return (
                        <td key={m.key} className="px-2 py-2">
                          <textarea aria-label={`${DAY_LABEL[day]} ${m.label} menu`} rows={2} maxLength={300} className={`${FIELD} resize-y text-xs`} placeholder="Menu" value={c.menu} onChange={e => setCell(day, m.key, { menu: e.target.value })} />
                          <select aria-label={`${DAY_LABEL[day]} ${m.label} type`} className={`${FIELD} mt-1 py-1 text-xs`} value={c.tag || ''} onChange={e => setCell(day, m.key, { tag: (e.target.value || null) as FoodTag })}>
                            <option value="">No tag</option><option value="veg">Veg</option><option value="egg">Egg</option><option value="nonveg">Non-veg</option>
                          </select>
                          {c.start ? <p className="mt-1 text-xs text-fg-muted">This day: {c.start}–{c.end}</p> : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-info-text">Mess notes</h3>
        <textarea aria-label="Mess notes" rows={3} maxLength={1000} className={`${FIELD} resize-y`} placeholder="Special days, holiday menu, mess closed dates…" value={draft.notes} onChange={e => { setMessage(null); setDraft(prev => ({ ...prev, notes: e.target.value })); }} />
      </section>

      <SaveBar
        dirty={dirty}
        saving={saving}
        message={message || (invalid && dirty ? { kind: 'error', text: invalid } : null)}
        onSave={save}
        onDiscard={() => { setDraft(initial); setMessage(null); }}
        extra={initial.meals.length > 0 && !wasLegacy ? <button type="button" disabled={saving} onClick={async () => { if (await confirm({ title: 'Clear the whole mess timetable?', description: 'Every meal and menu is removed from this draft. Nothing changes in the app until you save.', confirmLabel: 'Clear timetable', tone: 'danger' })) { setDraft({ meals: [], cells: emptyCells(), notes: '' }); } }} className="text-xs text-danger-text hover:text-danger-text">Clear timetable</button> : null}
      />
    </div>
  );
}
