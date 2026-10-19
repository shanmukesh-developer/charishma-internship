"use client";
import { FIELD, LABEL, MAX_NEARBY, NEARBY_CATEGORIES, NEARBY_LABEL, NearbyCategory, NearbyPlace, PGHostel, PgLocationGuide } from './pgApi';
import { AppPreview, SaveBar, compactObj, fieldIndex, intError, isBlank, multiLine, nextRowKey, oneLine, textError, useSectionEditor } from './contentShared';

type Unit = 'm' | 'km';
type Place = { key: string; name: string; category: NearbyCategory; distance: string; unit: Unit; walk: string };
type Draft = { howToReach: string; nearby: Place[] };

const toPlace = (n: NearbyPlace): Place => {
  const km = n.distanceM >= 1000 && n.distanceM % 100 === 0;
  return { key: nextRowKey('n'), name: n.name, category: n.category, distance: km ? String(n.distanceM / 1000) : String(n.distanceM), unit: km ? 'km' : 'm', walk: n.walkMinutes ? String(n.walkMinutes) : '' };
};
const toDraft = (v?: PgLocationGuide | null): Draft => ({ howToReach: v?.howToReach || '', nearby: (v?.nearby || []).map(toPlace) });

/** Metres sent to the server (km converted and rounded). NaN when unreadable. */
const metresOf = (p: Place) => {
  if (isBlank(p.distance)) return NaN;
  const n = Number(p.distance);
  return p.unit === 'km' ? Math.round(n * 1000) : n;
};
const named = (d: Draft) => d.nearby.filter(p => oneLine(p.name));
const toValue = (d: Draft): PgLocationGuide | null => {
  const nearby = named(d).map(p => {
    const walk = isBlank(p.walk) ? undefined : Number(p.walk);
    return { name: oneLine(p.name), category: p.category, distanceM: metresOf(p), ...(walk !== undefined ? { walkMinutes: walk } : {}) } as NearbyPlace;
  }).sort((a, b) => a.distanceM - b.distanceM);
  return compactObj<PgLocationGuide>({ howToReach: multiLine(d.howToReach), nearby }) || null;
};

// Same checks and messages as backend validateLocationGuide.
const placeError = (p: Place, i: number, seen: Set<string>): string | null => {
  const name = oneLine(p.name);
  if (!name) return null;
  const nameErr = textError(name, 60, `Place ${i + 1} name`);
  if (nameErr) return nameErr;
  if (isBlank(p.distance)) return `${name}: enter the distance.`;
  const m = metresOf(p);
  if (!Number.isInteger(m) || m < 1 || m > 50000) return `${name}: distance (metres) must be a whole number from 1 to 50000.`;
  const walkErr = intError(p.walk, 1, 120, `${name}: walking minutes`);
  if (walkErr) return walkErr;
  const k = name.toLowerCase();
  if (seen.has(k)) return `${name} is listed twice.`;
  seen.add(k);
  return null;
};
const placeErrors = (d: Draft) => { const seen = new Set<string>(); return d.nearby.map((p, i) => placeError(p, i, seen)); };
const validate = (d: Draft) => {
  if (named(d).length > MAX_NEARBY) return `nearby: at most ${MAX_NEARBY} items.`;
  return textError(multiLine(d.howToReach), 600, 'How to reach') || placeErrors(d).find(Boolean) || null;
};

const metresText = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10 || m} m` : `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km`);
const coord = (v: unknown) => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };

/** How to reach the PG and nearby places (the map pin itself is set on Details). */
export function LocationPanel({ pg, onSaved }: { pg: PGHostel; onSaved: (pg: Partial<PGHostel>) => void }) {
  const ed = useSectionEditor<Draft, PgLocationGuide>({ pgId: pg.id, path: 'location-guide', field: 'locationGuide', source: pg.locationGuide, toDraft, toValue, validate, noun: 'Location guide', onSaved });
  const d = ed.draft;
  const v = toValue(d);
  const errors = placeErrors(d);
  const ci = (pg.contactInfo || {}) as Record<string, unknown>;
  const lat = coord(ci.lat);
  const lng = coord(ci.lng);
  const hasPin = lat !== null && lng !== null && !(lat === 0 && lng === 0);
  const badIndex = fieldIndex(ed.badField, 'locationGuide.nearby');
  const badName = badIndex !== null ? v?.nearby?.[badIndex]?.name?.toLowerCase() : null;
  const setPlace = (key: string, patch: Partial<Place>) => ed.update(prev => ({ ...prev, nearby: prev.nearby.map(p => (p.key === key ? { ...p, ...patch } : p)) }));
  const count = named(d).length;

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">Shown under Location on the PG page. Leave blank to hide. Nearby places are listed nearest first.</p>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 p-4 text-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Map pin</p>
          {hasPin ? <p className="mt-1 text-gray-200">{lat}, {lng}</p> : <p className="mt-1 text-amber-300">No map pin yet. Students will not see an Open in Maps button.</p>}
          <p className="mt-1 text-xs text-gray-500">Latitude and longitude are edited on the Details tab.</p>
        </div>
        {hasPin && <a href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`} target="_blank" rel="noreferrer" className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-blue-300 hover:bg-white/5">Open in Google Maps</a>}
      </div>

      <label className={LABEL}>How to reach
        <textarea rows={3} maxLength={700} className={`${FIELD} resize-y normal-case tracking-normal`} placeholder="e.g. From SRM main gate, take the road towards Neerukonda. The PG is the second building after the temple." value={d.howToReach} onChange={e => ed.update(prev => ({ ...prev, howToReach: e.target.value }))} />
      </label>

      <fieldset className="space-y-3 rounded-xl border border-white/10 p-4">
        <legend className="px-1 text-sm font-bold text-blue-300">Nearby</legend>
        <p className="text-xs text-gray-500">{count} of {MAX_NEARBY}. Walking minutes are optional.</p>
        {d.nearby.length > 0 && (
          <ol className="space-y-2">
            {d.nearby.map((p, i) => {
              const bad = !!errors[i] || (!!badName && oneLine(p.name).toLowerCase() === badName);
              return (
                <li key={p.key} className="space-y-1">
                  <div className="grid grid-cols-2 items-center gap-2 md:grid-cols-[1fr_150px_150px_120px_auto]">
                    <input aria-label={`Place ${i + 1} name`} aria-invalid={bad} className={`${FIELD} ${bad ? 'border-red-500/60' : ''}`} maxLength={80} placeholder="Name, e.g. Apollo Pharmacy" value={p.name} onChange={e => setPlace(p.key, { name: e.target.value })} />
                    <select aria-label={`Place ${i + 1} category`} className={FIELD} value={p.category} onChange={e => setPlace(p.key, { category: e.target.value as NearbyCategory })}>
                      {NEARBY_CATEGORIES.map(c => <option key={c} value={c}>{NEARBY_LABEL[c]}</option>)}
                    </select>
                    <div className="flex gap-1">
                      <input aria-label={`Place ${i + 1} distance`} inputMode="decimal" className={FIELD} placeholder="Distance" value={p.distance} onChange={e => setPlace(p.key, { distance: e.target.value })} />
                      <select aria-label={`Place ${i + 1} distance unit`} className={`${FIELD} w-20`} value={p.unit} onChange={e => setPlace(p.key, { unit: e.target.value as Unit })}>
                        <option value="m">m</option><option value="km">km</option>
                      </select>
                    </div>
                    <input aria-label={`Place ${i + 1} walking minutes`} inputMode="numeric" className={FIELD} placeholder="Walk (min)" value={p.walk} onChange={e => setPlace(p.key, { walk: e.target.value })} />
                    <button type="button" onClick={() => ed.update(prev => ({ ...prev, nearby: prev.nearby.filter(x => x.key !== p.key) }))} aria-label={`Remove place ${i + 1}`} className="px-1 text-xs text-red-300/80 hover:text-red-300">Remove</button>
                  </div>
                  {errors[i] && <p className="text-xs text-red-300">{errors[i]}</p>}
                </li>
              );
            })}
          </ol>
        )}
        <button type="button" disabled={d.nearby.length >= MAX_NEARBY} onClick={() => ed.update(prev => ({ ...prev, nearby: [...prev.nearby, { key: nextRowKey('n'), name: '', category: 'college', distance: '', unit: 'm', walk: '' }] }))} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-white/5 disabled:opacity-40">Add place</button>
      </fieldset>

      <AppPreview empty={!v && !hasPin}>
        {hasPin && <p className="text-gray-300">Open in Maps</p>}
        {v?.howToReach && <div><p className="font-semibold text-white">How to reach</p><p className="whitespace-pre-line text-gray-300">{v.howToReach}</p></div>}
        {v?.nearby && <div><p className="font-semibold text-white">Nearby</p>
          <ul className="mt-1 space-y-0.5 text-gray-300">
            {v.nearby.map(n => (
              <li key={n.name} className="flex justify-between gap-3">
                <span>{n.name} <span className="text-gray-500">· {NEARBY_LABEL[n.category]}</span></span>
                <span className="text-gray-400">{Number.isFinite(n.distanceM) ? [metresText(n.distanceM), n.walkMinutes ? `${n.walkMinutes} min walk` : ''].filter(Boolean).join(' · ') : ''}</span>
              </li>
            ))}
          </ul>
        </div>}
      </AppPreview>
      <SaveBar dirty={ed.dirty} saving={ed.saving} message={ed.message} onSave={ed.save} onDiscard={ed.discard} />
    </div>
  );
}
