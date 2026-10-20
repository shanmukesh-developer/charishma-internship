"use client";

import { useState } from 'react';
import { autoRideApi, INCIDENT_STATUSES, PRIVATE_STATUSES, type Incident } from '@/lib/autoRideApi';
import { useLoader, type Lookups } from './hooks';
import { Btn, Empty, ErrorBox, Loading, Msg, Pill, Select, Toolbar, errText, inputCls, inr, label, short, when } from './ui';

// ── Private (full-auto) requests ─────────────────────────────────────────────
export function PrivateTab({ tick, lookups }: { tick: number; lookups: Lookups }) {
  const [status, setStatus] = useState('REQUESTED');
  const { data, loading, error, reload } = useLoader(status, tick, () => autoRideApi.privateRequests(status || undefined));
  const rows = data?.requests || [];
  const now = Date.now();
  return (
    <section className="space-y-4" aria-label="Full-auto requests">
      <Toolbar>
        <Select name="Status" value={status} onChange={setStatus} options={['', ...PRIVATE_STATUSES]} />
        <span className="text-sm text-fg-muted">{rows.length} request{rows.length === 1 ? '' : 's'}</span>
      </Toolbar>
      {error && <ErrorBox text={error} retry={reload} />}
      {loading ? <Loading text="Loading requests…" /> : rows.length === 0 ? <Empty text={status === 'REQUESTED' ? 'No full-auto requests waiting for a driver.' : 'No requests match.'} /> : (
        <div className="overflow-x-auto border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2/60 text-xs text-fg-muted">
              <tr><th className="p-3">Requested</th><th className="p-3">Trip / driver</th><th className="p-3">Passengers</th><th className="p-3">Fare</th><th className="p-3">Respond by</th><th className="p-3">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {rows.map((r) => {
                const due = r.respondBy ? new Date(r.respondBy).getTime() : null;
                const mins = due ? Math.round((due - now) / 60000) : null;
                return (
                  <tr key={r.id} className="align-top">
                    <td className="p-3 text-xs"><p>{when(r.createdAt)}</p><p className="text-fg-muted">#{short(r.id)} · {r.passenger ? `${r.passenger.name}${r.passenger.phoneMasked ? ` ${r.passenger.phoneMasked}` : ''}` : `user #${short(r.userId)}`}</p></td>
                    <td className="p-3 text-xs"><p>Trip #{short(r.tripId)}</p><p className="text-fg-muted">{r.driverId ? lookups.drivers.get(String(r.driverId))?.name || r.driver?.name || `#${short(r.driverId)}` : '—'}</p></td>
                    <td className="p-3">{r.passengers}{r.purpose && <p className="max-w-[220px] text-xs text-fg-muted">“{r.purpose}”</p>}</td>
                    <td className="p-3 text-xs">{inr(r.fare)}{r.extraCharges ? <p className="text-fg-muted">incl. {inr(r.extraCharges.amount)} extra{r.extraCharges.note ? ` (${r.extraCharges.note})` : ''}</p> : null}<p className="text-fg-muted">{label(r.paymentMethod)}</p></td>
                    <td className="p-3 text-xs"><p>{when(r.respondBy)}</p>{r.status === 'REQUESTED' && mins !== null && <p className={mins < 0 ? 'font-semibold text-danger-text' : mins <= 3 ? 'font-semibold text-warning-text' : 'text-fg-muted'}>{mins < 0 ? 'overdue (expires on the next sweep)' : `${mins} min left`}</p>}{r.respondedAt && <p className="text-fg-muted">answered {when(r.respondedAt)}</p>}</td>
                    <td className="p-3"><Pill s={r.status} />{r.declineReason && <p className="mt-1 max-w-[200px] text-xs text-fg-muted">{r.declineReason}</p>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Incidents ─────────────────────────────────────────────────────────────
const SAFETY = ['SAFETY', 'HARASSMENT', 'RASH_DRIVING'];
export function IncidentsTab({ tick, onChanged }: { tick: number; onChanged: () => void }) {
  const [status, setStatus] = useState('ACTIVE');
  const { data, loading, error, reload } = useLoader(status, tick, () => autoRideApi.incidents(status));
  const rows = [...(data?.incidents || [])].sort((a, b) => Number(b.category === 'SAFETY') - Number(a.category === 'SAFETY'));
  return (
    <section className="space-y-4" aria-label="Incidents">
      <Toolbar>
        <Select name="Status" value={status} onChange={setStatus} options={[{ value: 'ACTIVE', label: 'Open + reviewing' }, ...INCIDENT_STATUSES.map((s) => ({ value: s, label: label(s) })), { value: 'ALL', label: 'All' }]} />
        <span className="text-sm text-fg-muted">{rows.length} report{rows.length === 1 ? '' : 's'} · safety reports first</span>
      </Toolbar>
      {error && <ErrorBox text={error} retry={reload} />}
      {loading ? <Loading text="Loading incidents…" /> : rows.length === 0 ? <Empty text="No incidents match." /> : rows.map((i) => <IncidentCard key={`${i.id}-${i.status}`} i={i} onChanged={() => { onChanged(); reload(); }} />)}
    </section>
  );
}

function IncidentCard({ i, onChanged }: { i: Incident; onChanged: () => void }) {
  const [status, setStatus] = useState(i.status);
  const [note, setNote] = useState(i.adminNote || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const safety = i.category === 'SAFETY';
  const serious = SAFETY.includes(i.category);
  const save = async () => {
    const closing = ['RESOLVED', 'DISMISSED'].includes(status);
    if (closing && !window.confirm(`Mark this report ${status.toLowerCase()}? The reporter is notified${note.trim() ? ' with your note' : ''}.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      await autoRideApi.updateIncident(i.id, status, note.trim() || undefined);
      setMsg({ ok: true, text: 'Saved.' });
      onChanged();
    } catch (e) { setMsg({ ok: false, text: errText(e, 'Could not update the incident.') }); } finally { setBusy(false); }
  };
  return (
    <article className={`border p-5 ${safety ? 'border-danger/30 bg-danger-soft' : serious ? 'border-warning/30' : 'border-line'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex flex-wrap items-center gap-2">
            {safety && <span className="bg-danger px-2 py-0.5 text-xs font-semibold text-on-solid">Safety</span>}
            {i.priority === 'HIGH' && <span className="border border-danger/30 px-2 py-0.5 text-xs font-semibold text-danger-text">High priority</span>}
            <span className={`text-sm font-semibold ${serious ? 'text-danger-text' : ''}`}>{label(i.category)}</span><Pill s={i.status} />
          </p>
          <p className="mt-1 text-xs text-fg-muted">{label(i.reporterType)} {i.reporter ? `${i.reporter.name}${i.reporter.phoneMasked ? ` ${i.reporter.phoneMasked}` : ''}` : `#${short(i.reporterId)}`} · {when(i.createdAt)}{i.tripId ? ` · trip #${short(i.tripId)}` : ''}{i.bookingId ? ` · booking #${short(i.bookingId)}` : ''}{i.resolvedAt ? ` · closed ${when(i.resolvedAt)}` : ''}</p>
        </div>
      </div>
      {i.description && <p className="mt-3 whitespace-pre-wrap text-sm text-fg">{i.description}</p>}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Select name="Status" value={status} onChange={setStatus} options={[...INCIDENT_STATUSES]} />
        <label className="min-w-[260px] flex-1 text-xs font-semibold text-fg-muted">Admin note (sent to the reporter when closed)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} className={`${inputCls} mt-1 font-normal normal-case`} />
        </label>
        <Btn tone="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Btn>
      </div>
      <div className="mt-2"><Msg msg={msg} /></div>
    </article>
  );
}

// ── Fares ─────────────────────────────────────────────────────────────────
export function FaresTab({ tick, lookups }: { tick: number; lookups: Lookups }) {
  const { data, loading, error, reload } = useLoader('fares', tick, () => autoRideApi.fares());
  if (error) return <ErrorBox text={error} retry={reload} />;
  if (loading || !data) return <Loading text="Loading fares…" />;
  const routeName = (id: string) => data.routes.find((r) => String(r.routeId) === String(id))?.name || `#${short(id)}`;
  return (
    <section className="space-y-6" aria-label="Fares">
      <p className="text-sm text-fg-muted">Last 30 days of published trips. Drivers set their own seat fare inside each route&apos;s bounds; anything outside is listed below (for example after bounds were tightened).</p>
      <div className="overflow-x-auto border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2/60 text-xs text-fg-muted"><tr><th className="p-3">Route</th><th className="p-3">Seat fare bounds</th><th className="p-3">Full-auto bounds</th><th className="p-3">Trips</th><th className="p-3">Avg seat fare</th></tr></thead>
          <tbody className="divide-y divide-white/10">
            {data.routes.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-fg-muted">No routes.</td></tr> : data.routes.map((r) => (
              <tr key={r.routeId}><td className="p-3 font-semibold">{r.name}</td><td className="p-3">{inr(r.seatFareMin)} – {inr(r.seatFareMax)}</td><td className="p-3">{inr(r.fullFareMin)} – {inr(r.fullFareMax)}</td><td className="p-3 tabular-nums">{r.trips}</td><td className="p-3">{r.avgSeatFare === null ? '—' : inr(r.avgSeatFare)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Trips outside route bounds ({data.outliers.length})</h3>
        {data.outliers.length === 0 ? <Empty text="Every trip in the last 30 days is inside its route's seat-fare bounds." /> : (
          <div className="overflow-x-auto border border-warning/30">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2/60 text-xs text-fg-muted"><tr><th className="p-3">Trip</th><th className="p-3">Departure</th><th className="p-3">Route</th><th className="p-3">Seat fare</th><th className="p-3">Full auto</th><th className="p-3">Driver</th><th className="p-3">Status</th></tr></thead>
              <tbody className="divide-y divide-white/10">
                {data.outliers.map((o) => {
                  const r = data.routes.find((x) => String(x.routeId) === String(o.routeId));
                  const f = Number(o.seatFare);
                  const low = r && r.seatFareMin !== null && f < r.seatFareMin;
                  return (
                    <tr key={o.id}><td className="p-3 font-mono text-xs">#{short(o.id)}</td><td className="whitespace-nowrap p-3 text-xs">{o.departureAt ? when(o.departureAt) : '—'}</td><td className="p-3">{routeName(o.routeId)}</td>
                      <td className="p-3 font-semibold text-warning-text">{inr(o.seatFare)} <span className="text-xs font-normal">{low ? `below ${inr(r?.seatFareMin)}` : `above ${inr(r?.seatFareMax)}`}</span></td>
                      <td className="p-3">{inr(o.fullAutoFare)}</td><td className="p-3 text-xs">{lookups.drivers.get(String(o.driverId))?.name || `#${short(o.driverId)}`}</td><td className="p-3"><Pill s={o.status} /></td></tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Audit ─────────────────────────────────────────────────────────────────
export function AuditTab({ tick }: { tick: number }) {
  const [target, setTarget] = useState('');
  const [query, setQuery] = useState('');
  const { data, loading, error, reload } = useLoader(query, tick, () => autoRideApi.audit(query || undefined));
  const rows = data?.entries || [];
  return (
    <section className="space-y-4" aria-label="Audit log">
      <Toolbar>
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(target.trim()); }}>
          <label className="text-xs font-semibold text-fg-muted">Target id
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Driver / vehicle / trip / booking id" className="ml-2 w-80 border border-line bg-surface p-2 font-mono text-xs font-normal text-fg" />
          </label>
          <Btn type="submit">Filter</Btn>
          {query && <Btn onClick={() => { setTarget(''); setQuery(''); }}>Clear</Btn>}
        </form>
        <span className="text-sm text-fg-muted">{rows.length} entr{rows.length === 1 ? 'y' : 'ies'}{rows.length >= 300 ? ' (latest 300)' : ''}</span>
      </Toolbar>
      {error && <ErrorBox text={error} retry={reload} />}
      {loading ? <Loading text="Loading audit log…" /> : rows.length === 0 ? <Empty text="No Auto-Ride admin actions recorded yet." /> : (
        <div className="overflow-x-auto border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2/60 text-xs text-fg-muted"><tr><th className="p-3">When</th><th className="p-3">Action</th><th className="p-3">Target</th><th className="p-3">Admin</th><th className="p-3">Details</th></tr></thead>
            <tbody className="divide-y divide-white/10">
              {rows.map((e) => (
                <tr key={String(e.id)} className="align-top">
                  <td className="whitespace-nowrap p-3 text-xs">{when(e.at)}</td>
                  <td className="p-3 text-xs font-semibold">{label(e.action.replace(/^AUTO_/, ''))}</td>
                  <td className="p-3"><button type="button" title="Filter by this target" onClick={() => { setTarget(e.targetId); setQuery(e.targetId); }} className="font-mono text-xs text-info-text underline">{e.targetId.length > 20 ? `#${short(e.targetId)}` : e.targetId}</button></td>
                  <td className="p-3 text-xs text-fg-muted">{e.actor?.name ? <span className="font-semibold text-fg">{e.actor.name}</span> : null} <span className="font-mono">#{short(e.adminId)}</span></td>
                  <td className="p-3"><code className="block max-w-xl whitespace-pre-wrap break-all text-xs text-fg-muted">{typeof e.details === 'string' ? e.details : JSON.stringify(e.details)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
