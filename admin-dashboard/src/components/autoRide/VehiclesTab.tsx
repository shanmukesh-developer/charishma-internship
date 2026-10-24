"use client";

import { useEffect, useState } from 'react';
import {
  autoRideApi, defaultLayout, layoutProblem, renumberLayout, toggleMaleOnly, seatsBesideDriver, LIMITS, VEHICLE_DOC_KEYS, VEHICLE_STATUSES, REQUIRED_VEHICLE_DOCS,
  type SeatLayout, type Vehicle,
} from '@/lib/autoRideApi';
import { useLoader, type Lookups } from './hooks';
import { Btn, ConfirmDialog, Doc, Empty, ErrorBox, Field, Loading, Msg, Pill, SeatGrid, Select, Toolbar, daysUntil, inputCls, istToday, maskPhone, short, when } from './ui';

const DOC_NAMES: Record<string, string> = { rc: 'RC', permit: 'Permit', insurance: 'Insurance', fitness: 'Fitness certificate', puc: 'PUC' };
const DOC_EXPIRY: Record<string, keyof Vehicle | null> = { rc: null, permit: 'permitExpiresOn', insurance: 'insuranceExpiresOn', fitness: 'fitnessExpiresOn', puc: 'pucExpiresOn' };

export default function VehiclesTab({ tick, onChanged, lookups, focusId, clearFocus }: { tick: number; onChanged: () => void; lookups: Lookups; focusId: string | null; clearFocus: () => void }) {
  const [status, setStatus] = useState(focusId ? 'ALL' : 'PENDING_REVIEW');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(focusId);
  useEffect(() => { if (focusId) { setStatus('ALL'); setOpenId(focusId); clearFocus(); } }, [focusId, clearFocus]);
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 400); return () => clearTimeout(t); }, [q]);
  const { data, loading, error, reload } = useLoader(`${status}|${query}`, tick, () => autoRideApi.vehicles(status, { q: query || undefined }));
  const rows = data?.vehicles || [];
  const platformMax = data?.platformMaxCapacity ?? 8;
  return (
    <section className="space-y-4" aria-label="Vehicles">
      <Toolbar>
        <Select name="Status" value={status} onChange={setStatus} options={[...VEHICLE_STATUSES, 'ALL']} />
        <label className="text-xs font-semibold text-fg-muted">Plate
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="AP07…" className="ml-2 border border-line bg-surface p-2 text-sm font-normal text-fg" />
        </label>
        <span className="text-sm text-fg-muted">{rows.length} vehicle{rows.length === 1 ? '' : 's'} · platform max {platformMax} passengers</span>
      </Toolbar>
      {error && <ErrorBox text={error} retry={reload} />}
      {loading ? <Loading text="Loading vehicles…" />
        : rows.length === 0 ? <Empty text={status === 'PENDING_REVIEW' ? 'No autos waiting for approval.' : 'No vehicles with this status.'} />
          : rows.map((v) => (
            <VehicleCard key={`${v.id}-${v.status}`} v={v} platformMax={platformMax} lookups={lookups} open={openId === v.id}
              toggle={() => setOpenId(openId === v.id ? null : v.id)} onChanged={() => { onChanged(); reload(); }} />
          ))}
    </section>
  );
}

function expiryFlags(v: Vehicle) {
  const out: string[] = [];
  for (const k of ['permitExpiresOn', 'insuranceExpiresOn', 'fitnessExpiresOn', 'pucExpiresOn'] as const) {
    const d = daysUntil(v[k]);
    if (d !== null && d < 0) out.push(`${k.replace('ExpiresOn', '')} expired`);
    else if (d !== null && d <= 30) out.push(`${k.replace('ExpiresOn', '')} in ${d}d`);
  }
  return out;
}

function VehicleCard({ v, platformMax, lookups, open, toggle, onChanged }: { v: Vehicle; platformMax: number; lookups: Lookups; open: boolean; toggle: () => void; onChanged: () => void }) {
  const driver = lookups.drivers.get(String(v.driverId));
  const flags = expiryFlags(v);
  const [action, setAction] = useState<'reject' | 'suspend' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const missingDocs = REQUIRED_VEHICLE_DOCS.filter((k) => !v.documents?.[k]);
  return (
    <article className="border border-line">
      <button type="button" onClick={toggle} className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-surface-2/60" aria-expanded={open}>
        <div>
          <p className="font-mono text-lg font-semibold">{v.registration || v.registrationNumber} <Pill s={v.status} /></p>
          <p className="text-sm text-fg-muted">{[v.make, v.model, v.year, v.fuel, v.colour].filter(Boolean).join(' · ') || 'No details'} · RC {v.rcSeatingCapacity} seats{v.approvedCapacity ? ` · approved ${v.approvedCapacity}` : ''}</p>
          <p className="text-xs text-fg-muted">Driver {driver ? `${driver.name} (${maskPhone(driver.phone)}) · ${driver.status.toLowerCase().replace('_', ' ')}` : `#${short(v.driverId)}`} · added {when(v.createdAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {flags.map((f) => <span key={f} className={`border px-2 py-0.5 text-xs font-semibold ${f.includes('expired') ? 'border-danger/30 text-danger-text' : 'border-warning/30 text-warning-text'}`}>{f}</span>)}
          {missingDocs.length > 0 && <span className="border border-danger/30 px-2 py-0.5 text-xs font-semibold text-danger-text">missing {missingDocs.join(', ')}</span>}
          <span className="text-sm font-semibold text-info-text">{open ? 'Close ▲' : 'Review ▼'}</span>
        </div>
      </button>
      {open && (
        <div className="space-y-5 border-t border-line bg-surface-2 p-5">
          {v.rejectionReason && <p className="text-sm text-danger-text">{v.status === 'SUSPENDED' ? 'Suspended' : 'Rejected'}: {v.rejectionReason}</p>}
          <div className="grid gap-3 text-sm md:grid-cols-4">
            <p>Permit no. <span className="font-mono">{v.permitNumber || '—'}</span></p>
            <p>RC seating <b>{v.rcSeatingCapacity}</b></p>
            <p>Driver asked for <b>{v.requestedCapacity ?? '—'}</b></p>
            <p>Reviewed {when(v.reviewedAt)}</p>
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold text-fg-muted">Papers (private, links expire)</h4>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {VEHICLE_DOC_KEYS.map((k) => {
                const ek = DOC_EXPIRY[k];
                return <Doc key={k} name={DOC_NAMES[k]} url={v.documentPreviews?.[k]} required={REQUIRED_VEHICLE_DOCS.includes(k)} expiry={ek ? (v[ek] as string | null) : undefined} />;
              })}
            </div>
          </div>
          {v.photoPreviews?.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold text-fg-muted">Photos</h4>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{v.photoPreviews.map((p, i) => <Doc key={i} name={`Photo ${i + 1}`} url={p} />)}</div>
            </div>
          )}
          {v.seatLayout && v.status === 'APPROVED' && (
            <div>
              <h4 className="mb-2 text-xs font-semibold text-fg-muted">Approved seat layout</h4>
              <SeatGrid layout={v.seatLayout} />
            </div>
          )}
          {['PENDING_REVIEW', 'REJECTED', 'SUSPENDED'].includes(v.status) && <ApprovePanel v={v} platformMax={platformMax} onDone={(text) => { setMsg({ ok: true, text }); onChanged(); }} />}
          <div className="flex flex-wrap gap-2">
            {v.status !== 'REJECTED' && <Btn tone="bad" onClick={() => { setMsg(null); setAction('reject'); }}>Reject</Btn>}
            {v.status === 'APPROVED' && <Btn tone="bad" onClick={() => { setMsg(null); setAction('suspend'); }}>Suspend</Btn>}
          </div>
          <Msg msg={msg} />
        </div>
      )}
      {action && (
        <ConfirmDialog open title={`${action === 'reject' ? 'Reject' : 'Suspend'} ${v.registration || v.registrationNumber}?`} tone="bad"
          confirmLabel={action === 'reject' ? 'Reject vehicle' : 'Suspend vehicle'}
          body={<p>{action === 'reject' ? 'The driver sees your reason and can fix the papers. An approved auto stops being usable for new trips.' : 'Upcoming trips with this auto (not already in progress) are ended as “vehicle unavailable”; passengers are notified and wallet payments refunded in full.'}</p>}
          reason={{ label: 'Reason (the driver sees this)', min: 5 }} onCancel={() => setAction(null)}
          onConfirm={async (reason) => {
            if (action === 'reject') await autoRideApi.rejectVehicle(v.id, reason); else await autoRideApi.suspendVehicle(v.id, reason);
            setAction(null);
            setMsg({ ok: true, text: action === 'reject' ? 'Vehicle rejected; the driver was notified.' : 'Vehicle suspended; the driver was notified.' });
            onChanged();
          }} />
      )}
    </article>
  );
}

function ApprovePanel({ v, platformMax, onDone }: { v: Vehicle; platformMax: number; onDone: (text: string) => void }) {
  const maxCap = Math.max(0, Math.min(Number(v.rcSeatingCapacity) || 0, platformMax));
  const initial = v.suggestedApprovedCapacity || maxCap;
  const [cap, setCap] = useState(String(initial || ''));
  const capN = Number(cap);
  const capOk = Number.isInteger(capN) && capN >= 1 && capN <= maxCap;
  const startLayout = (n: number): SeatLayout => (v.seatLayout && !layoutProblem(v.seatLayout, n) ? v.seatLayout : defaultLayout(n));
  const [layout, setLayout] = useState<SeatLayout>(() => startLayout(initial || 1));
  const [confirm, setConfirm] = useState(false);
  // Reset the layout when the capacity changes.
  useEffect(() => {
    if (capOk) setLayout(startLayout(capN));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capN, capOk]);
  const problem = capOk ? layoutProblem(layout, capN) : null;
  const edit = (fn: (rows: SeatLayout['rows']) => SeatLayout['rows']) => setLayout((l) => renumberLayout({ rows: fn(l.rows.map((r) => [...r])), maleOnlySeats: l.maleOnlySeats }));
  const seatNos = layout.rows.flat().filter((c): c is number => typeof c === 'number').sort((a, b) => a - b);
  const maleOnly = new Set(layout.maleOnlySeats ?? seatsBesideDriver(layout.rows));
  const toggleCell = (ri: number, ci: number) => edit((rows) => { rows[ri][ci] = rows[ri][ci] === null ? 0 : null; return rows; });
  const today = istToday();
  const expired = (['permitExpiresOn', 'insuranceExpiresOn', 'fitnessExpiresOn', 'pucExpiresOn'] as const).filter((k) => v[k] && String(v[k]).slice(0, 10) < today);
  if (!maxCap) return <p className="text-sm text-danger-text">The RC seating capacity is missing, so this auto cannot be approved.</p>;
  return (
    <div className="space-y-4 border border-success/30 bg-success-soft p-4">
      <h4 className="text-sm font-semibold text-success-text">Approve this auto</h4>
      <p className="text-xs text-fg-muted">Check the RC document yourself. Approved capacity can never be above the RC seating ({v.rcSeatingCapacity}) or the platform maximum ({platformMax}).</p>
      {expired.length > 0 && <p role="alert" className="text-sm font-semibold text-danger-text">Cannot approve: {expired.map((k) => k.replace('ExpiresOn', '')).join(', ')} expired.</p>}
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-48"><Field name="Approved capacity" hint={`1 to ${maxCap}`}><input type="number" min={1} max={maxCap} step={1} value={cap} onChange={(e) => setCap(e.target.value)} className={inputCls} /></Field></div>
        {!capOk && <p role="alert" className="text-sm text-danger-text">Enter a whole number from 1 to {maxCap}.</p>}
      </div>
      {capOk && (
        <div className="flex flex-wrap items-start gap-6">
          <SeatGrid layout={layout} editable onCellClick={toggleCell} />
          <div className="space-y-2 text-xs text-fg-muted">
            <p>Click a seat to turn it into a gap (or back). Seats are renumbered front to back, left to right. The driver seat is fixed.</p>
            <div className="space-y-1">
              <p className="font-semibold text-fg">Boys-only seats</p>
              <p>Seats beside the driver are for boys only (girls cannot sit there). Only boys can book a marked seat in the app; the driver can still mark any seat for a walk-in.</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Boys-only seats">
                {seatNos.map((n) => (
                  <button key={n} type="button" aria-pressed={maleOnly.has(n)} onClick={() => setLayout((l) => toggleMaleOnly(l, n))}
                    className={`min-w-9 border px-2 py-1 text-xs font-semibold ${maleOnly.has(n) ? 'border-info/40 bg-info-soft text-info-text' : 'border-line bg-surface text-fg-muted hover:bg-surface-2'}`}>
                    {n}{maleOnly.has(n) ? ' · Boys' : ''}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Btn onClick={() => edit((rows) => (rows.length < LIMITS.MAX_LAYOUT_ROWS ? [...rows, [0]] : rows))}>+ Row</Btn>
              <Btn onClick={() => edit((rows) => (rows.length > 1 ? rows.slice(0, -1) : rows))}>− Last row</Btn>
              <Btn onClick={() => edit((rows) => { const r = rows[rows.length - 1]; if (r.length < LIMITS.MAX_LAYOUT_COLS) r.push(0); return rows; })}>+ Seat in last row</Btn>
              <Btn onClick={() => edit((rows) => { const r = rows[rows.length - 1]; if (r.length > 1 && r[r.length - 1] !== 'D') r.pop(); return rows; })}>− Seat in last row</Btn>
              <Btn onClick={() => setLayout(defaultLayout(capN))}>Reset</Btn>
            </div>
            {problem ? <p role="alert" className="font-semibold text-danger-text">{problem}</p> : <p className="font-semibold text-success-text">Layout OK: {capN} passenger seats.</p>}
          </div>
        </div>
      )}
      <Btn tone="good" disabled={!capOk || !!problem || expired.length > 0} onClick={() => setConfirm(true)}>Approve for {capOk ? capN : '…'} passengers</Btn>
      {confirm && (
        <ConfirmDialog open tone="good" title={`Approve ${v.registration || v.registrationNumber} for ${capN} passengers?`} confirmLabel="Approve"
          body={<><p>RC seating {v.rcSeatingCapacity} · platform max {platformMax} · approved {capN}.</p><p>Every trip with this auto will use this capacity and layout. Make sure the permit, insurance and RC are genuine.</p></>}
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            const r = await autoRideApi.approveVehicle(v.id, { approvedCapacity: capN, seatLayout: layout });
            setConfirm(false);
            onDone(`Approved for ${r.vehicle.approvedCapacity} passengers. The driver was notified.`);
          }} />
      )}
    </div>
  );
}
