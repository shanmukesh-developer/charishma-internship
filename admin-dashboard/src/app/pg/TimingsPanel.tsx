"use client";
import { useState } from 'react';
import { FIELD, LABEL, PGHostel, PgTimings, pgRequest } from './pgApi';
import { SaveBar, errorText } from './contentShared';

type Draft = Required<Record<keyof PgTimings, string>>;
const KEYS: (keyof PgTimings)[] = ['gateOpen', 'gateClose', 'visitorFrom', 'visitorTo', 'checkIn', 'checkOut', 'quietFrom', 'quietTo', 'curfewNote'];
const toDraft = (t?: PgTimings | null): Draft => Object.fromEntries(KEYS.map(k => [k, (t && t[k]) || ''])) as Draft;
const toPayload = (d: Draft): PgTimings | null => {
  const out: PgTimings = {};
  for (const k of KEYS) if (d[k].trim()) out[k] = d[k].trim();
  return Object.keys(out).length ? out : null;
};
const validate = (d: Draft): string | null => {
  for (const [a, b, label] of [['gateOpen', 'gateClose', 'Gate'], ['visitorFrom', 'visitorTo', 'Visitor hours'], ['quietFrom', 'quietTo', 'Quiet hours']] as const) {
    if (!!d[a] !== !!d[b]) return `${label}: enter both times, or neither.`;
  }
  if (d.visitorFrom && d.visitorTo <= d.visitorFrom) return 'Visitor hours must end after they start.';
  return null;
};

const PAIRS: { title: string; hint: string; a: keyof PgTimings; b: keyof PgTimings; la: string; lb: string }[] = [
  { title: 'Gate', hint: 'When the main gate opens and closes.', a: 'gateOpen', b: 'gateClose', la: 'Opens', lb: 'Closes' },
  { title: 'Visitors', hint: 'When residents can have visitors.', a: 'visitorFrom', b: 'visitorTo', la: 'From', lb: 'Until' },
  { title: 'Check-in / check-out', hint: 'Move-in and move-out times. Either can be left blank.', a: 'checkIn', b: 'checkOut', la: 'Check-in', lb: 'Check-out' },
  { title: 'Quiet hours', hint: 'May run past midnight, e.g. 10:30 PM to 6:00 AM.', a: 'quietFrom', b: 'quietTo', la: 'From', lb: 'Until' },
];

export function TimingsPanel({ pg, onSaved }: { pg: PGHostel; onSaved: (pg: Partial<PGHostel>) => void }) {
  const [initial, setInitial] = useState<Draft>(() => toDraft(pg.timings));
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const dirty = JSON.stringify(toPayload(draft)) !== JSON.stringify(toPayload(initial));
  const set = (k: keyof PgTimings, v: string) => { setMessage(null); setDraft(prev => ({ ...prev, [k]: v })); };

  const save = async () => {
    if (saving) return;
    const invalid = validate(draft);
    if (invalid) { setMessage({ kind: 'error', text: invalid }); return; }
    setSaving(true);
    setMessage(null);
    try {
      const saved = await pgRequest<{ timings: PgTimings | null }>(`/api/pg/${pg.id}/timings`, { method: 'PUT', body: JSON.stringify({ timings: toPayload(draft) }) });
      const next = toDraft(saved.timings);
      setInitial(next);
      setDraft(next);
      onSaved({ timings: saved.timings });
      setMessage({ kind: 'ok', text: 'Timings saved.' });
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e, 'Could not save the timings.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-xs text-fg-muted">Times are IST. Leave a row blank to hide it in the app.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {PAIRS.map(row => (
          <fieldset key={row.title} className="space-y-2 rounded-xl border border-line p-4">
            <legend className="px-1 text-sm font-semibold text-info-text">{row.title}</legend>
            <p className="text-xs text-fg-muted">{row.hint}</p>
            <div className="grid grid-cols-2 gap-3">
              <label className={LABEL}>{row.la}<input type="time" className={FIELD} value={draft[row.a]} onChange={e => set(row.a, e.target.value)} /></label>
              <label className={LABEL}>{row.lb}<input type="time" className={FIELD} value={draft[row.b]} onChange={e => set(row.b, e.target.value)} /></label>
            </div>
          </fieldset>
        ))}
      </div>
      <label className={LABEL}>Curfew note
        <textarea rows={2} maxLength={300} className={`${FIELD} resize-y normal-case tracking-normal`} placeholder="e.g. Late entry after the gate closes needs a call to the warden." value={draft.curfewNote} onChange={e => set('curfewNote', e.target.value)} />
      </label>
      <SaveBar dirty={dirty} saving={saving} message={message} onSave={save} onDiscard={() => { setDraft(initial); setMessage(null); }} />
    </div>
  );
}
