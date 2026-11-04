"use client";

import { useMemo, useState } from 'react';
import { autoRideApi, ADMIN_CANCELLABLE, TRIP_STATUSES, type Booking, type QueueItem, type Trip } from '@/lib/autoRideApi';
import { useLoader, type Lookups } from './hooks';
import { Btn, ConfirmDialog, Empty, ErrorBox, Loading, Msg, Pill, SeatGrid, Select, Toolbar, inr, istToday, label, maskPhone, short, timeOnly, when } from './ui';

const DEPARTED = ['IN_PROGRESS', 'COMPLETED'];
const ENDED = ['CANCELLED', 'NO_SHOW', 'DRIVER_UNAVAILABLE', 'VEHICLE_UNAVAILABLE'];

export default function TripsTab({ tick, onChanged, lookups }: { tick: number; onChanged: () => void; lookups: Lookups }) {
  const [view, setView] = useState<'trips' | 'queues'>('trips');
  const [date, setDate] = useState(istToday());
  const [status, setStatus] = useState('ACTIVE');
  const [routeId, setRouteId] = useState('');
  const [pickupId, setPickupId] = useState('');
  const pickupOptions = useMemo(() => {
    const list = [...lookups.pickupById.values()].filter((p) => !routeId || String(p.routeId) === routeId);
    return [{ value: '', label: 'All pickup points' }, ...list.map((p) => ({ value: String(p.id), label: `${p.name} (${p.routeName})` }))];
  }, [lookups.pickupById, routeId]);
  return (
    <section className="space-y-4" aria-label="Trips and queues">
      <Toolbar>
        <div className="flex gap-1" role="group" aria-label="View">
          {(['trips', 'queues'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`border px-3 py-2 text-sm font-semibold ${view === v ? 'border-info/30 bg-info-soft' : 'border-line text-fg-muted'}`}>{v === 'trips' ? 'Trips' : 'Queues'}</button>
          ))}
        </div>
        <label className="text-xs font-semibold text-fg-muted">Date (IST)
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="ml-2 border border-line bg-surface p-2 text-sm font-normal text-fg" />
        </label>
        {date && <button type="button" onClick={() => setDate('')} className="text-xs text-fg-muted underline">{view === 'trips' ? 'Any date' : ''}</button>}
        {view === 'trips' && <Select name="Status" value={status} onChange={setStatus} options={[{ value: 'ACTIVE', label: 'Active (not ended)' }, { value: '', label: 'All' }, ...TRIP_STATUSES.map((t) => ({ value: t, label: label(t) }))]} />}
        <Select name="Route" value={routeId} onChange={(v) => { setRouteId(v); setPickupId(''); }} options={[{ value: '', label: 'All routes' }, ...lookups.routes.map((r) => ({ value: String(r.id), label: r.name }))]} />
        <Select name="Pickup" value={pickupId} onChange={setPickupId} options={pickupOptions} />
      </Toolbar>
      {lookups.error && <p className="text-xs text-warning-text">{lookups.error} Names may show as ids.</p>}
      {view === 'trips'
        ? <TripList tick={tick} onChanged={onChanged} lookups={lookups} date={date} status={status} routeId={routeId} pickupId={pickupId} />
        : <Queues tick={tick} lookups={lookups} date={date || istToday()} routeId={routeId} pickupId={pickupId} />}
    </section>
  );
}

function TripList({ tick, onChanged, lookups, date, status, routeId, pickupId }: { tick: number; onChanged: () => void; lookups: Lookups; date: string; status: string; routeId: string; pickupId: string }) {
  const { data, loading, error, reload } = useLoader(`${date}|${status}|${routeId}|${pickupId}`, tick, () => autoRideApi.trips({ date: date || undefined, status: status || undefined, routeId: routeId || undefined, pickupPointId: pickupId || undefined }));
  const [openId, setOpenId] = useState<string | null>(null);
  const all = data?.trips || [];
  // The server filters status / date / route / pickup point (the extra check here covers an older server).
  const rows = all.filter((t) => (!routeId || String(t.routeId) === routeId) && (!pickupId || String(t.pickupPointId) === pickupId));
  if (error) return <ErrorBox text={error} retry={reload} />;
  if (loading) return <Loading text="Loading trips…" />;
  if (!rows.length) return <Empty text="No trips match these filters." />;
  return (
    <div className="zv-table-wrap">
      <p className="p-3 text-xs text-fg-muted">{rows.length} trip{rows.length === 1 ? '' : 's'}{all.length >= 300 ? ' (latest 300 from the server)' : ''}</p>
      <table className="zv-table">
        <thead className="bg-surface-2/60 text-xs text-fg-muted">
          <tr><th className="p-3">Departure</th><th className="p-3">Route · pickup</th><th className="p-3">Driver</th><th className="p-3">Seats</th><th className="p-3">Fare</th><th className="p-3">Status</th><th className="p-3" /></tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {rows.map((t) => {
            const route = lookups.routeById.get(String(t.routeId));
            const pickup = lookups.pickupById.get(String(t.pickupPointId));
            const drv = lookups.drivers.get(String(t.driverId));
            const open = openId === t.id;
            return [
              <tr key={t.id} className={`align-top ${open ? 'bg-surface-2/60' : ''}`}>
                <td className="p-3"><p className="font-semibold">{when(t.departureAt)}</p>{t.delayMinutes > 0 && <p className="text-xs text-warning-text">+{t.delayMinutes} min delay</p>}<p className="text-xs text-fg-muted">#{short(t.id)}{t.queueNumber ? ` · queue ${String(t.queueNumber).padStart(2, '0')}` : ''}{t.periodKey ? ` · ${t.periodKey}` : ''}</p></td>
                <td className="p-3"><p>{route?.name || t.routeName || `#${short(t.routeId)}`}</p><p className="text-xs text-fg-muted">{pickup?.name || t.pickupName || `#${short(t.pickupPointId)}`} → {t.destination || route?.destination || '—'}</p></td>
                <td className="p-3 text-xs"><p className="font-semibold">{drv?.name || t.driverName || `#${short(t.driverId)}`}</p><p className="font-mono text-fg-muted">{drv ? maskPhone(drv.phone) : ''}</p></td>
                <td className="p-3 text-xs tabular-nums"><p className="font-semibold">{t.confirmedSeats}/{t.capacity} confirmed</p>{t.heldSeats > 0 && <p className="text-warning-text">{t.heldSeats} on hold</p>}{t.boardedSeats > 0 && <p className="text-info-text">{t.boardedSeats} boarded</p>}<p className="text-fg-muted">departs at {t.minSeatsToDepart}</p></td>
                <td className="p-3 text-xs">{inr(t.seatFare)}/seat{t.fullAutoFare ? <p className="text-fg-muted">full {inr(t.fullAutoFare)}</p> : null}{t.mode === 'PRIVATE' && <p className="font-semibold text-accent-text">Private</p>}</td>
                <td className="p-3"><Pill s={t.status} /><p className="mt-1 text-xs text-fg-muted">{t.availabilityLabel}</p></td>
                <td className="p-3 text-right"><Btn onClick={() => setOpenId(open ? null : t.id)}>{open ? 'Close' : 'Details'}</Btn></td>
              </tr>,
              open ? <tr key={`${t.id}-d`}><td colSpan={7} className="border-t border-line bg-surface-2 p-0"><TripDetail id={t.id} tick={tick} onChanged={() => { onChanged(); reload(); }} /></td></tr> : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/** What an admin cancellation does to each live booking (alloc.closeTripBookings: wallet refunded 100 %). */
export function refundEffect(bookings: Booking[]) {
  const live = bookings.filter((b) => ['HELD', 'CONFIRMED', 'BOARDED'].includes(b.status));
  const wallet = live.filter((b) => b.paymentMethod === 'WALLET' && (b.walletDebited > 0 || b.paymentStatus === 'PAID'));
  const walletTotal = wallet.reduce((s, b) => s + (Number(b.walletDebited) || Number(b.amount) || 0), 0);
  const cash = live.filter((b) => b.paymentMethod === 'CASH' && b.status !== 'HELD');
  const held = live.filter((b) => b.status === 'HELD');
  return { live, wallet, walletTotal, cash, held };
}

function TripDetail({ id, tick, onChanged }: { id: string; tick: number; onChanged: () => void }) {
  const { data, loading, error, reload } = useLoader(id, tick, () => autoRideApi.trip(id));
  const [cancel, setCancel] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (loading) return <div className="p-5"><Loading text="Loading trip…" /></div>;
  if (error || !data) return <div className="p-5"><ErrorBox text={error || 'Could not load the trip.'} retry={reload} /></div>;
  const t: Trip = data.trip;
  const fx = refundEffect(data.bookings);
  const seatState: Record<number, string> = {};
  for (const b of data.bookings) if (['HELD', 'CONFIRMED', 'BOARDED'].includes(b.status)) for (const n of b.seatNumbers) seatState[n] = b.status;
  const canCancel = ADMIN_CANCELLABLE.includes(t.status);
  return (
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="text-sm text-fg-muted">
          <p><Pill s={t.status} /> <span className="ml-2">{t.statusLabel}</span></p>
          <p className="mt-2">Departure {when(t.departureAt)}{t.originalDepartureAt && t.originalDepartureAt !== t.departureAt ? <span className="text-warning-text"> (was {timeOnly(t.originalDepartureAt)})</span> : null} · booking opens {when(t.bookingOpensAt)}</p>
          <p>Capacity {t.capacity} · confirmed {t.confirmedSeats} · held {t.heldSeats} · boarded {t.boardedSeats} · remaining {t.remainingSeats} · {t.mode.toLowerCase()} · seat selection {t.seatSelectionEnabled ? 'on' : 'off'}</p>
          {t.stops.length > 0 && <p>Stops: {t.stops.join(', ')}</p>}
          {t.cancelReason && <p className="text-danger-text">Reason: {t.cancelReason}</p>}
          {t.delayReason && <p className="text-warning-text">Delay: {t.delayReason}</p>}
        </div>
        {canCancel ? <Btn tone="bad" onClick={() => { setMsg(null); setCancel(true); }}>Cancel trip</Btn>
          : <p className="max-w-xs text-xs text-fg-muted">{t.status === 'IN_PROGRESS' ? 'A trip in progress cannot be cancelled; it completes or auto-completes.' : 'This trip has ended.'}</p>}
      </div>
      <Msg msg={msg} />
      <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
        <div><h4 className="mb-2 text-xs font-semibold text-fg-muted">Seats</h4><SeatGrid layout={t.seatLayout} seatState={seatState} /><p className="mt-2 text-xs text-fg-muted">Green confirmed / boarded · amber on hold</p></div>
        <div>
          <h4 className="mb-2 text-xs font-semibold text-fg-muted">Bookings ({data.bookings.length})</h4>
          {data.bookings.length === 0 ? <p className="text-sm text-fg-muted">No bookings.</p> : (
            <table className="zv-table zv-table-dense">
              <thead className="text-fg-muted"><tr><th className="py-1">Code</th><th>Passenger</th><th>Seats</th><th>Pay</th><th>Status</th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {data.bookings.map((b) => (
                  <tr key={b.id}><td className="py-1 font-mono font-semibold">{b.bookingCode}</td><td>{b.passenger?.name || '—'} <span className="font-mono text-fg-muted">{maskPhone(b.passenger?.phone)}</span></td><td>{b.seatCount}{b.seatNumbers.length ? ` (#${b.seatNumbers.join(', ')})` : ''}</td><td>{inr(b.amount)} · {b.paymentMethod ? label(b.paymentMethod) : '—'} · {b.paymentStatus ? label(b.paymentStatus) : ''}</td><td><Pill s={b.status} /></td></tr>
                ))}
              </tbody>
            </table>
          )}
          {data.privateRequests.length > 0 && (
            <>
              <h4 className="mb-2 mt-4 text-xs font-semibold text-fg-muted">Full-auto requests</h4>
              <ul className="space-y-1 text-xs">{data.privateRequests.map((r) => <li key={r.id}><Pill s={r.status} /> {r.passengers} passengers · {inr(r.fare)} · {label(r.paymentMethod)} · respond by {when(r.respondBy)}</li>)}</ul>
            </>
          )}
        </div>
      </div>
      <div>
        <h4 className="mb-2 text-xs font-semibold text-fg-muted">Timeline</h4>
        {data.events.length === 0 ? <p className="text-sm text-fg-muted">No events recorded.</p> : (
          <ol className="relative ml-2 border-l border-line">
            {data.events.map((e) => (
              <li key={e.id} className="mb-3 ml-4">
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-info/30 bg-surface" />
                <p className="text-xs text-fg-muted">{when(e.at)} · {e.actorType ? label(e.actorType) : 'System'}</p>
                <p className="text-sm">{e.from ? <>{label(e.from)} → </> : null}<b>{label(e.to)}</b></p>
                {e.note && <p className="text-xs text-fg-muted">{e.note}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
      {cancel && (
        <ConfirmDialog open title="Cancel this trip?" confirmLabel="Cancel trip" tone="bad"
          reason={{ label: 'Reason (passengers and the driver see this)', min: 5 }}
          body={<>
            <p>{fx.live.length ? `${fx.live.length} live booking${fx.live.length === 1 ? '' : 's'} will be cancelled and every passenger notified.` : 'No live bookings on this trip.'}</p>
            {fx.wallet.length > 0 && <p className="font-semibold text-success-text">{fx.wallet.length} wallet booking{fx.wallet.length === 1 ? '' : 's'}: {inr(fx.walletTotal)} refunded in full to ZenWe Wallet.</p>}
            {fx.cash.length > 0 && <p>{fx.cash.length} cash booking{fx.cash.length === 1 ? '' : 's'}: nothing was paid to ZenWe, nothing to refund.</p>}
            {fx.held.length > 0 && <p>{fx.held.length} seat hold{fx.held.length === 1 ? '' : 's'} released.</p>}
            <p className="text-xs text-fg-muted">This cannot be undone.</p>
          </>}
          onCancel={() => setCancel(false)}
          onConfirm={async (reason) => {
            const r = await autoRideApi.cancelTrip(t.id, reason);
            setCancel(false);
            setMsg({ ok: true, text: `Trip cancelled. ${r.bookingsCancelled} booking${r.bookingsCancelled === 1 ? '' : 's'} cancelled.` });
            onChanged();
            reload();
          }} />
      )}
    </div>
  );
}

function Queues({ tick, lookups, date, routeId, pickupId }: { tick: number; lookups: Lookups; date: string; routeId: string; pickupId: string }) {
  const { data, loading, error, reload } = useLoader(`${date}|${pickupId}`, tick, () => autoRideApi.queues({ date, pickupPointId: pickupId || undefined }));
  const items = (data?.queue || []).filter((q) => !routeId || String(lookups.pickupById.get(String(q.pickup?.id))?.routeId) === routeId);
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; landmark: string | null; periods: Map<string, QueueItem[]> }>();
    for (const q of items) {
      const k = String(q.pickup?.id || 'unknown');
      if (!map.has(k)) map.set(k, { name: q.pickup?.name || 'Unknown pickup', landmark: q.pickup?.landmark || null, periods: new Map() });
      const g = map.get(k)!;
      const pk = q.periodKey || 'ANY';
      if (!g.periods.has(pk)) g.periods.set(pk, []);
      g.periods.get(pk)!.push(q);
    }
    for (const g of map.values()) for (const list of g.periods.values()) list.sort((a, b) => (a.queueNumber || 0) - (b.queueNumber || 0));
    return [...map.entries()];
  }, [items]);
  if (error) return <ErrorBox text={error} retry={reload} />;
  if (loading) return <Loading text="Loading queues…" />;
  if (!groups.length) return <Empty text={`No autos in a queue on ${data?.date || date}.`} />;
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">Queue for {data?.date || date} (IST). Queue order is check-in order; the departure order can differ.</p>
      {groups.map(([k, g]) => (
        <article key={k} className="rounded-lg border border-line bg-surface p-4 shadow-xs">
          <h3 className="font-semibold">{g.name}{g.landmark && <span className="ml-2 text-sm font-normal text-fg-muted">{g.landmark}</span>}</h3>
          {[...g.periods.entries()].map(([pk, list]) => (
            <div key={pk} className="mt-3">
              <p className="text-xs font-semibold text-fg-muted">{pk === 'ANY' ? 'No period' : pk}</p>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {list.map((q) => {
                  const drv = lookups.drivers.get(String(q.driverId));
                  const departed = DEPARTED.includes(q.status);
                  const ended = ENDED.includes(q.status);
                  return (
                    <li key={q.id} className={`border p-3 ${departed ? 'border-line opacity-60' : ended ? 'border-danger/30 opacity-60' : q.status === 'FULL' ? 'border-accent/30' : 'border-info/30'}`}>
                      <p className="text-sm font-semibold">Auto {String(q.queueNumber || 0).padStart(2, '0')}
                        <span className="ml-2 font-semibold">{departed ? 'Departed' : ended ? label(q.status) : `${q.confirmedSeats}/${q.capacity}`}</span>
                      </p>
                      <p className="text-xs text-fg-muted">{drv?.name || `#${short(q.driverId)}`} · departs {timeOnly(q.departureAt)}</p>
                      {!departed && !ended && <p className="text-xs text-fg-muted">{q.availabilityLabel}{q.heldSeats ? ` · ${q.heldSeats} on hold` : ''}</p>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}
