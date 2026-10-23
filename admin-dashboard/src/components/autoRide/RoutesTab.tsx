"use client";

import { useConfirm } from '@/components/ui';
import { useState } from 'react';
import { autoRideApi, LIMITS, type OperatingPeriod, type PickupPoint, type Route, type RouteInput, type PickupInput } from '@/lib/autoRideApi';
import { useLoader } from './hooks';
import { Btn, Empty, ErrorBox, Field, Loading, Msg, Pill, errText, inputCls, inr } from './ui';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

interface RouteForm {
  name: string; originLabel: string; destinationLabel: string; distanceKm: string; seatFareMin: string; seatFareMax: string; seatFareDefault: string;
  fullFareMin: string; fullFareMax: string; minSeatsToDepartDefault: string; permittedStops: string; isActive: boolean; sortOrder: string;
  operatingPeriods: OperatingPeriod[];
}
const s = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const formOf = (r?: Route): RouteForm => ({
  name: r?.name || '', originLabel: r?.origin || 'SRM University-AP', destinationLabel: r?.destination || '', distanceKm: s(r?.distanceKm),
  seatFareMin: s(r?.seatFareMin), seatFareMax: s(r?.seatFareMax), seatFareDefault: s(r?.seatFareDefault), fullFareMin: s(r?.fullFareMin), fullFareMax: s(r?.fullFareMax),
  minSeatsToDepartDefault: s(r?.minSeatsToDepartDefault), permittedStops: (r?.permittedStops || []).join(', '), isActive: r ? r.isActive : true,
  sortOrder: s(r?.sortOrder ?? 0), operatingPeriods: r?.operatingPeriods ? r.operatingPeriods.map((p) => ({ ...p })) : [],
});

/** Client-side validation mirroring controllers/admin.js routeInput; returns [body, problem]. */
function toInput(f: RouteForm): [RouteInput | null, string | null] {
  for (const [k, n] of [['name', 'Route name'], ['originLabel', 'Origin'], ['destinationLabel', 'Destination']] as const) if (f[k].trim().length < 2) return [null, `${n} is required.`];
  const nums: Record<string, number | null> = {};
  const rules: [keyof RouteForm, string, number, number, boolean][] = [
    ['distanceKm', 'Distance', 0, 500, false], ['seatFareMin', 'Seat fare min', 0, LIMITS.MAX_FARE, false], ['seatFareMax', 'Seat fare max', 0, LIMITS.MAX_FARE, false],
    ['seatFareDefault', 'Default seat fare', 1, LIMITS.MAX_FARE, false],
    ['fullFareMin', 'Full-auto fare min', 0, LIMITS.MAX_FULL_FARE, false], ['fullFareMax', 'Full-auto fare max', 0, LIMITS.MAX_FULL_FARE, false],
    ['minSeatsToDepartDefault', 'Min seats to depart', 1, LIMITS.ABSOLUTE_MAX_CAPACITY, true], ['sortOrder', 'Sort order', 0, 10000, true],
  ];
  for (const [k, n, min, max, int] of rules) {
    const v = numOrNull(String(f[k]));
    if (v !== null && (!Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v)))) return [null, `${n} must be ${int ? 'a whole number' : 'a number'} from ${min} to ${max}.`];
    nums[k] = v;
  }
  if (nums.seatFareMin !== null && nums.seatFareMax !== null && nums.seatFareMin > nums.seatFareMax) return [null, 'Seat fare min is above the max.'];
  if (nums.seatFareDefault !== null && nums.seatFareMin !== null && nums.seatFareDefault < nums.seatFareMin) return [null, 'The default seat fare is below the minimum.'];
  if (nums.seatFareDefault !== null && nums.seatFareMax !== null && nums.seatFareDefault > nums.seatFareMax) return [null, 'The default seat fare is above the maximum.'];
  if (nums.fullFareMin !== null && nums.fullFareMax !== null && nums.fullFareMin > nums.fullFareMax) return [null, 'Full-auto fare min is above the max.'];
  if (f.operatingPeriods.length > 6) return [null, 'Up to 6 operating periods.'];
  const periods = f.operatingPeriods.map((p) => ({ key: p.key.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 20), label: p.label.trim() || p.key, start: p.start, end: p.end }));
  for (const [i, p] of periods.entries()) if (!p.key || !TIME_RE.test(p.start) || !TIME_RE.test(p.end) || p.start === p.end) return [null, `Period ${i + 1}: needs a key and different start / end times (HH:MM IST).`];
  if (new Set(periods.map((p) => p.key)).size !== periods.length) return [null, 'Period keys must be different.'];
  return [{
    name: f.name.trim(), originLabel: f.originLabel.trim(), destinationLabel: f.destinationLabel.trim(), distanceKm: nums.distanceKm,
    seatFareMin: nums.seatFareMin, seatFareMax: nums.seatFareMax, seatFareDefault: nums.seatFareDefault, fullFareMin: nums.fullFareMin, fullFareMax: nums.fullFareMax,
    minSeatsToDepartDefault: nums.minSeatsToDepartDefault, sortOrder: nums.sortOrder ?? 0, isActive: f.isActive, operatingPeriods: periods,
    permittedStops: f.permittedStops.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20),
  }, null];
}

export default function RoutesTab({ tick, onChanged }: { tick: number; onChanged: () => void }) {
  const { data, loading, error, reload } = useLoader('routes', tick, () => autoRideApi.routes());
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [showInactive, setShowInactive] = useState(true);
  const routes = (data?.routes || []).filter((r) => showInactive || r.isActive);
  const done = () => { setEditing(null); onChanged(); reload(); };
  return (
    <section className="space-y-4" aria-label="Routes and pickup points">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-surface-2/60 p-4">
        <p className="text-sm text-fg-muted">Routes are never deleted: switch a route or pickup point to inactive to hide it from drivers and passengers.</p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show inactive</label>
          <Btn tone="primary" onClick={() => setEditing('new')}>+ New route</Btn>
        </div>
      </div>
      {editing === 'new' && <RouteEditor onCancel={() => setEditing(null)} onSaved={done} />}
      {error && <ErrorBox text={error} retry={reload} />}
      {loading ? <Loading text="Loading routes…" /> : routes.length === 0 ? <Empty text="No routes yet. Create the first route, then add its pickup points." /> : routes.map((r) => (
        <article key={r.id} className={`border p-5 ${r.isActive ? 'border-line' : 'border-line opacity-70'}`}>
          {editing === r.id ? <RouteEditor route={r} onCancel={() => setEditing(null)} onSaved={done} /> : (
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">{r.name} {!r.isActive && <Pill s="INACTIVE" />}</h3>
                <p className="text-sm text-fg-muted">{r.origin} → {r.destination}{r.distanceKm !== null ? ` · ${r.distanceKm} km` : ''} · sort {r.sortOrder}</p>
                <p className="mt-1 text-sm text-fg-muted">On charge {r.chargeSeatFare ? `${inr(r.chargeSeatFare)} a seat${r.seatFareDefault ? '' : ' (no default set, the minimum is used)'}` : 'no seat fare set yet'}</p>
                <p className="mt-1 text-sm text-fg-muted">Seat fare {inr(r.seatFareMin)}–{inr(r.seatFareMax)} · full auto {inr(r.fullFareMin)}–{inr(r.fullFareMax)} · min seats to depart {r.minSeatsToDepartDefault ?? 'full'}</p>
                <p className="mt-1 text-xs text-fg-muted">Periods (IST): {r.operatingPeriods.length ? r.operatingPeriods.map((p) => `${p.label} ${p.start}–${p.end}`).join(' · ') : 'any time'}</p>
                {r.permittedStops.length > 0 && <p className="mt-1 text-xs text-fg-muted">Stops: {r.permittedStops.join(', ')}</p>}
              </div>
              <Btn onClick={() => setEditing(r.id)}>Edit route</Btn>
            </div>
          )}
          <Pickups route={r} onChanged={() => { onChanged(); reload(); }} />
        </article>
      ))}
    </section>
  );
}

function RouteEditor({ route, onCancel, onSaved }: { route?: Route; onCancel: () => void; onSaved: () => void }) {
  const confirm = useConfirm();
  const [f, setF] = useState<RouteForm>(() => formOf(route));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof RouteForm>(k: K, v: RouteForm[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const setPeriod = (i: number, patch: Partial<OperatingPeriod>) => set('operatingPeriods', f.operatingPeriods.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const save = async () => {
    const [body, problem] = toInput(f);
    if (!body) { setMsg({ ok: false, text: problem || 'Check the form.' }); return; }
    if (route && route.isActive && !body.isActive && !(await confirm({ title: 'Make this route inactive? Drivers can no longer publish trips on it and passengers stop seeing it. Existing trips are not cancelled.', confirmLabel: 'Make inactive', tone: 'danger' }))) return;
    setBusy(true);
    setMsg(null);
    try {
      if (route) await autoRideApi.updateRoute(route.id, body); else await autoRideApi.createRoute(body);
      onSaved();
    } catch (e) { setMsg({ ok: false, text: errText(e, 'Could not save the route.') }); } finally { setBusy(false); }
  };
  const txt = (k: keyof RouteForm, name: string, props: { type?: string; hint?: string; placeholder?: string } = {}) => (
    <Field name={name} hint={props.hint}><input type={props.type || 'text'} value={String(f[k])} placeholder={props.placeholder} onChange={(e) => set(k, e.target.value as never)} className={inputCls} /></Field>
  );
  return (
    <div className="mb-4 space-y-4 border border-info/30 bg-info-soft p-4">
      <h3 className="font-semibold">{route ? `Edit ${route.name}` : 'New route'}</h3>
      <div className="grid gap-3 md:grid-cols-3">
        {txt('name', 'Route name', { placeholder: 'Campus → Mangalagiri' })}
        {txt('originLabel', 'Origin')}
        {txt('destinationLabel', 'Destination')}
        {txt('distanceKm', 'Distance (km)', { type: 'number' })}
        {txt('seatFareMin', 'Seat fare min (₹)', { type: 'number' })}
        {txt('seatFareMax', 'Seat fare max (₹)', { type: 'number' })}
        {txt('seatFareDefault', 'Default seat fare (₹)', { type: 'number', hint: 'Used when a driver puts an auto on charge. Empty = the minimum' })}
        {txt('fullFareMin', 'Full-auto fare min (₹)', { type: 'number' })}
        {txt('fullFareMax', 'Full-auto fare max (₹)', { type: 'number' })}
        {txt('minSeatsToDepartDefault', 'Min seats to depart', { type: 'number', hint: 'Empty = the auto departs only when full' })}
        {txt('sortOrder', 'Sort order', { type: 'number' })}
        <div className="md:col-span-2">{txt('permittedStops', 'Permitted stops', { hint: 'Comma separated, up to 20' })}</div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} />Active (visible to drivers and passengers)</label>
      <div>
        <p className="text-xs font-semibold text-fg-muted">Operating periods (IST, up to 6; none = any time)</p>
        <div className="mt-2 space-y-2">
          {f.operatingPeriods.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input value={p.key} onChange={(e) => setPeriod(i, { key: e.target.value.toUpperCase() })} placeholder="KEY (MORNING)" aria-label="Period key" className={`${inputCls} w-36`} />
              <input value={p.label} onChange={(e) => setPeriod(i, { label: e.target.value })} placeholder="Label" aria-label="Period label" className={`${inputCls} w-36`} />
              <input type="time" value={p.start} onChange={(e) => setPeriod(i, { start: e.target.value })} aria-label="Start (IST)" className={`${inputCls} w-32`} />
              <span className="text-fg-muted">to</span>
              <input type="time" value={p.end} onChange={(e) => setPeriod(i, { end: e.target.value })} aria-label="End (IST)" className={`${inputCls} w-32`} />
              <button type="button" onClick={() => set('operatingPeriods', f.operatingPeriods.filter((_, j) => j !== i))} className="text-xs font-semibold text-danger-text underline">Remove</button>
            </div>
          ))}
          {f.operatingPeriods.length < 6 && <Btn onClick={() => set('operatingPeriods', [...f.operatingPeriods, { key: '', label: '', start: '08:00', end: '10:00' }])}>+ Period</Btn>}
        </div>
      </div>
      <Msg msg={msg} />
      <div className="flex gap-2"><Btn tone="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save route'}</Btn><Btn onClick={onCancel} disabled={busy}>Cancel</Btn></div>
    </div>
  );
}

function Pickups({ route, onChanged }: { route: Route; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold text-fg-muted">Pickup points ({route.pickupPoints.length})</h4>
        <Btn onClick={() => setEditing('new')}>+ Pickup point</Btn>
      </div>
      {editing === 'new' && <PickupEditor routeId={route.id} nextSeq={(route.pickupPoints.reduce((m, p) => Math.max(m, p.sequence), 0) || 0) + 1} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
      {route.pickupPoints.length === 0 ? <p className="mt-2 text-sm text-fg-muted">No pickup points: drivers cannot publish trips on this route until one exists.</p> : (
        <ul className="mt-2 divide-y divide-line">
          {route.pickupPoints.map((p) => (
            <li key={p.id} className={`py-2 ${p.isActive ? '' : 'opacity-60'}`}>
              {editing === p.id ? <PickupEditor routeId={route.id} p={p} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} /> : (
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div>
                    <span className="mr-2 font-mono text-xs text-fg-muted">#{p.sequence}</span><b>{p.name}</b>{!p.isActive && <span className="ml-2"><Pill s="INACTIVE" /></span>}
                    {p.landmark && <span className="ml-2 text-fg-muted">· {p.landmark}</span>}
                    {p.lat !== null && p.lon !== null && <span className="ml-2 font-mono text-xs text-fg-muted">{p.lat.toFixed(6)}, {p.lon.toFixed(6)}</span>}
                    {p.mapsUrl && <a href={p.mapsUrl} target="_blank" rel="noreferrer noopener" className="ml-2 text-xs font-semibold text-info-text underline">Map ↗</a>}
                  </div>
                  <Btn onClick={() => setEditing(p.id)}>Edit</Btn>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PickupEditor({ routeId, p, nextSeq = 1, onCancel, onSaved }: { routeId: string; p?: PickupPoint; nextSeq?: number; onCancel: () => void; onSaved: () => void }) {
  const confirm = useConfirm();
  const [name, setName] = useState(p?.name || '');
  const [landmark, setLandmark] = useState(p?.landmark || '');
  const [lat, setLat] = useState(p?.lat === null || p?.lat === undefined ? '' : String(p.lat));
  const [lon, setLon] = useState(p?.lon === null || p?.lon === undefined ? '' : String(p.lon));
  const [sequence, setSequence] = useState(String(p?.sequence ?? nextSeq));
  const [isActive, setIsActive] = useState(p ? p.isActive : true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    const la = numOrNull(lat);
    const lo = numOrNull(lon);
    const seq = numOrNull(sequence) ?? 0;
    if (name.trim().length < 2) return setMsg({ ok: false, text: 'Pickup point name is required.' });
    if ((la === null) !== (lo === null)) return setMsg({ ok: false, text: 'Give both latitude and longitude, or neither.' });
    if (la !== null && (!Number.isFinite(la) || la < -90 || la > 90)) return setMsg({ ok: false, text: 'Latitude must be between -90 and 90.' });
    if (lo !== null && (!Number.isFinite(lo) || lo < -180 || lo > 180)) return setMsg({ ok: false, text: 'Longitude must be between -180 and 180.' });
    if (!Number.isInteger(seq) || seq < 0 || seq > 1000) return setMsg({ ok: false, text: 'Sequence must be a whole number from 0 to 1000.' });
    if (p && p.isActive && !isActive && !(await confirm({ title: 'Make this pickup point inactive? Drivers can no longer pick it for new trips.', confirmLabel: 'Make inactive', tone: 'danger' }))) return;
    const body: PickupInput = { name: name.trim(), landmark: landmark.trim() || null, lat: la, lon: lo, sequence: seq, isActive };
    setBusy(true);
    setMsg(null);
    try {
      if (p) await autoRideApi.updatePickup(p.id, body); else await autoRideApi.createPickup(routeId, body);
      onSaved();
    } catch (e) { setMsg({ ok: false, text: errText(e, 'Could not save the pickup point.') }); } finally { setBusy(false); }
  };
  return (
    <div className="my-2 space-y-3 border border-line bg-surface-2 p-3">
      <div className="grid gap-3 md:grid-cols-6">
        <div className="md:col-span-2"><Field name="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Gate Stand" className={inputCls} /></Field></div>
        <div className="md:col-span-2"><Field name="Landmark"><input value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Opposite the main gate" className={inputCls} /></Field></div>
        <Field name="Latitude"><input type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)} className={inputCls} /></Field>
        <Field name="Longitude"><input type="number" step="any" value={lon} onChange={(e) => setLon(e.target.value)} className={inputCls} /></Field>
        <Field name="Sequence"><input type="number" min={0} max={1000} step={1} value={sequence} onChange={(e) => setSequence(e.target.value)} className={inputCls} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />Active</label>
      <Msg msg={msg} />
      <div className="flex gap-2"><Btn tone="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save pickup point'}</Btn><Btn disabled={busy} onClick={onCancel}>Cancel</Btn></div>
    </div>
  );
}
