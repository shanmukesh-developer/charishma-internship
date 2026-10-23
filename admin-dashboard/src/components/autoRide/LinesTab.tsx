"use client";

// Union queue ("on charge") live lines: per stand (pickup point + route) the auto on charge and the autos
// waiting behind it in check-in order (all bookable), with seats booked in the app vs walk-ins. Backend: GET /lines.
// Refreshes on every Auto-Ride change (tick) and every 15 seconds.
import { useEffect } from 'react';
import { autoRideApi, type ChargeLine } from '@/lib/autoRideApi';
import { Badge, Button } from '@/components/ui';
import { useLoader } from './hooks';
import { Empty, ErrorBox, Loading, inr, timeOnly } from './ui';

const fareNote = (l: ChargeLine) => {
  if (!l.seatFare) return 'No seat fare set';
  if (l.fareSource === 'DEFAULT') return `${inr(l.seatFare)} a seat`;
  return `${inr(l.seatFare)} a seat (route ${l.fareSource === 'MIN' ? 'minimum' : 'maximum'}, no default set)`;
};

export default function LinesTab({ tick, go }: { tick: number; go: () => void }) {
  const { data, loading, error, reload } = useLoader('lines', tick, () => autoRideApi.lines());
  useEffect(() => {
    const t = setInterval(() => reload(), 15000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = data?.lines || [];
  const busy = lines.filter((l) => l.autos.length);
  const idle = lines.filter((l) => !l.autos.length);

  return (
    <section className="space-y-4" aria-label="Live lines">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-surface-2/60 p-4">
        <p className="text-sm text-fg-muted">
          Autos line up at each stand in the order they were put on charge, and students can book any of them. The first auto is on charge and leaves next; when it fills, leaves or is cancelled, the next one moves up. If an auto is cancelled or becomes unavailable, its bookings move to the next auto with room.
        </p>
        <Button size="sm" onClick={go}>Seat fares by route</Button>
      </div>
      {error && <ErrorBox text={error} retry={reload} />}
      {loading && !data ? <Loading text="Loading the lines…" /> : lines.length === 0 ? <Empty text="No stands yet. Add a route and a pickup point first." /> : (
        <>
          {busy.map((l) => (
            <article key={l.key} className="rounded-lg border border-line bg-surface shadow-xs">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
                <div>
                  <h3 className="text-base font-semibold text-fg">{l.pickup.name} to {l.route.destination}</h3>
                  <p className="text-sm text-fg-muted">{fareNote(l)} · {l.autos.length} auto{l.autos.length === 1 ? '' : 's'} in line</p>
                </div>
                {!l.seatFare && <Button size="sm" onClick={go}>Set the fare</Button>}
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-fg-muted">
                      <th className="px-4 py-2 font-medium">#</th>
                      <th className="px-4 py-2 font-medium">Auto</th>
                      <th className="px-4 py-2 font-medium">Driver</th>
                      <th className="px-4 py-2 font-medium">State</th>
                      <th className="px-4 py-2 font-medium">Seats</th>
                      <th className="px-4 py-2 font-medium">Since</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {l.autos.map((a) => (
                      <tr key={a.tripId} className={a.queueState === 'ON_CHARGE' ? 'bg-success-soft/40' : ''}>
                        <td className="px-4 py-2 tabular-nums text-fg">{a.position}</td>
                        <td className="px-4 py-2 font-mono text-xs text-fg">{a.registration || '–'}</td>
                        <td className="px-4 py-2 text-fg">{a.driverName || '–'}<span className="ml-2 text-xs text-fg-subtle">{a.driverPhoneMasked || ''}</span></td>
                        <td className="px-4 py-2">
                          {a.queueState === 'ON_CHARGE'
                            ? <Badge tone="success" dot>On charge</Badge>
                            : <Badge tone="neutral">Waiting</Badge>}
                        </td>
                        <td className="px-4 py-2 tabular-nums text-fg">
                          {a.appSeats + a.walkInSeats}/{a.capacity} filled
                          <span className="ml-2 text-xs text-fg-muted">{a.appSeats} app · {a.walkInSeats} walk-in{a.heldSeats ? ` · ${a.heldSeats} being booked` : ''}</span>
                        </td>
                        <td className="px-4 py-2 text-xs text-fg-muted">{a.queueState === 'ON_CHARGE' ? `On charge ${timeOnly(a.onChargeSince)}` : `In line ${timeOnly(a.checkedInAt)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
          {idle.length > 0 && (
            <div className="rounded-lg border border-line bg-surface shadow-xs">
              <p className="border-b border-line px-4 py-3 text-sm font-semibold text-fg">No autos in line</p>
              <ul className="divide-y divide-line">
                {idle.map((l) => (
                  <li key={l.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span className="text-fg">{l.pickup.name} to {l.route.destination}{!l.route.isActive || !l.pickup.isActive ? <span className="ml-2 text-xs text-fg-subtle">inactive</span> : null}</span>
                    <span className="text-fg-muted">{fareNote(l)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
