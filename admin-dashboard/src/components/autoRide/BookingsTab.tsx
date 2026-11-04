"use client";

import { useEffect, useState } from 'react';
import { autoRideApi, BOOKING_STATUSES, type Booking } from '@/lib/autoRideApi';
import { useLoader, type Lookups } from './hooks';
import { Btn, ConfirmDialog, Empty, ErrorBox, Loading, Msg, Pill, Select, Toolbar, errText, inr, label, maskPhone, short, when } from './ui';

export default function BookingsTab({ tick, onChanged, lookups }: { tick: number; onChanged: () => void; lookups: Lookups }) {
  const [status, setStatus] = useState('');
  const [code, setCode] = useState('');
  const [codeQ, setCodeQ] = useState('');
  const [phone, setPhone] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setCodeQ(code.toUpperCase().replace(/[^A-Z0-9]/g, '')), 400); return () => clearTimeout(t); }, [code]);
  const [phoneQ, setPhoneQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setPhoneQ(phone.replace(/\D/g, '').slice(-10)), 400); return () => clearTimeout(t); }, [phone]);
  // The server searches by the full 10-digit number, or by the last 4 digits together with the booking code.
  const serverPhone = phoneQ.length === 10 || (phoneQ.length === 4 && !!codeQ) ? phoneQ : '';
  const { data, loading, error, reload } = useLoader(`${status}|${codeQ}|${serverPhone}`, tick, () => autoRideApi.bookings({ status: status || undefined, code: codeQ || undefined, phone: serverPhone || undefined }));
  const all = data?.bookings || [];
  // Partial numbers are matched over the loaded rows only.
  const digits = phone.replace(/\D/g, '');
  const rows = digits && !serverPhone ? all.filter((b) => String(b.passenger?.phone || '').replace(/\D/g, '').includes(digits)) : all;
  return (
    <section className="space-y-4" aria-label="Bookings">
      <Toolbar>
        <label className="text-xs font-semibold text-fg-muted">Booking code
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ZA7K3Q" className="ml-2 w-32 border border-line bg-surface p-2 font-mono text-sm font-normal text-fg" />
        </label>
        <label className="text-xs font-semibold text-fg-muted">Phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="98765…" className="ml-2 w-36 border border-line bg-surface p-2 text-sm font-normal text-fg" />
        </label>
        <Select name="Status" value={status} onChange={setStatus} options={['', ...BOOKING_STATUSES]} />
        <span className="text-sm text-fg-muted">{rows.length} of {all.length}{serverPhone ? ' · searched by phone on the server' : all.length >= 300 ? ' (latest 300; type the full number, or the last 4 digits + code, to search all)' : ''}</span>
      </Toolbar>
      {error && <ErrorBox text={error} retry={reload} />}
      {loading ? <Loading text="Loading bookings…" /> : rows.length === 0 ? <Empty text={codeQ ? `No booking with code ${codeQ}.` : 'No bookings match.'} /> : (
        <div className="zv-table-wrap">
          <table className="zv-table">
            <thead className="bg-surface-2/60 text-xs text-fg-muted">
              <tr><th className="p-3">Code</th><th className="p-3">Passenger</th><th className="p-3">Trip</th><th className="p-3">Seats</th><th className="p-3">Payment</th><th className="p-3">Status</th><th className="p-3" /></tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {rows.map((b) => {
                const open = openId === b.id;
                return [
                  <tr key={b.id} className={`align-top ${open ? 'bg-surface-2/60' : ''}`}>
                    <td className="p-3"><p className="font-mono font-semibold">{b.bookingCode}</p><p className="text-xs text-fg-muted">{when(b.createdAt)}</p></td>
                    <td className="p-3"><p>{b.passenger?.name || `#${short(b.userId)}`}</p><p className="font-mono text-xs text-fg-muted">{maskPhone(b.passenger?.phone)}</p></td>
                    <td className="p-3 text-xs">{b.trip ? <><Pill s={b.trip.status} /><p className="mt-1 text-fg-muted">{when(b.trip.departureAt)}</p></> : `#${short(b.tripId)}`}<p className="text-fg-muted">Driver {lookups.drivers.get(String(b.driverId))?.name || `#${short(b.driverId)}`}</p></td>
                    <td className="p-3 text-xs">{b.seatCount}{b.seatNumbers.length ? ` (#${b.seatNumbers.join(', ')})` : ''}{b.type === 'PRIVATE' && <p className="font-semibold text-accent-text">Full auto</p>}</td>
                    <td className="p-3 text-xs"><p className="font-semibold">{inr(b.amount)}</p><p className="text-fg-muted">{b.paymentMethod ? label(b.paymentMethod) : '—'} · {b.paymentStatus ? label(b.paymentStatus) : '—'}</p>{b.refundAmount > 0 && <p className="text-success-text">Refund {inr(b.refundAmount)}</p>}</td>
                    <td className="p-3"><Pill s={b.status} />{b.pinLocked && <p className="mt-1 text-xs text-danger-text">PIN locked</p>}</td>
                    <td className="p-3 text-right"><Btn onClick={() => setOpenId(open ? null : b.id)}>{open ? 'Close' : 'Details'}</Btn></td>
                  </tr>,
                  open ? <tr key={`${b.id}-d`}><td colSpan={7} className="border-t border-line bg-surface-2 p-5"><BookingDetail b={b} onChanged={() => { onChanged(); reload(); }} /></td></tr> : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function BookingDetail({ b, onChanged }: { b: Booking; onChanged: () => void }) {
  const [cancel, setCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const walletPaid = b.paymentMethod === 'WALLET' && (b.walletDebited > 0 || b.paymentStatus === 'PAID');
  const retry = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await autoRideApi.retryRefund(b.id);
      setMsg(r.booking.status === 'REFUNDED' ? { ok: true, text: `Refunded ${inr(r.refunded)} to the passenger's ZENV Wallet.` } : { ok: false, text: `Refund still pending (attempt ${r.booking.refundAttempts}). Try again later.` });
      onChanged();
    } catch (e) { setMsg({ ok: false, text: errText(e, 'Could not retry the refund.') }); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <p className="text-xs font-semibold text-fg-muted">Passenger</p>
          <p>{b.passenger?.name || '—'}</p>
          <p className="font-mono">{b.passenger?.phone || '—'}</p>
          <p className="text-xs text-fg-muted">User #{short(b.userId)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-fg-muted">Booking</p>
          <p>{label(b.type)} · {b.seatCount} seat{b.seatCount === 1 ? '' : 's'}{b.seatNumbers.length ? ` (#${b.seatNumbers.join(', ')})` : ''}</p>
          <p className="text-xs text-fg-muted">Confirmed {when(b.confirmedAt)} · boarded {when(b.boardedAt)}</p>
          {b.holdExpiresAt && <p className="text-xs text-warning-text">Hold expires {when(b.holdExpiresAt)}</p>}
          {b.cancelledAt && <p className="text-xs text-danger-text">Cancelled {when(b.cancelledAt)} by {b.cancelledBy || '—'}{b.cancelReason ? `: ${b.cancelReason}` : ''}</p>}
        </div>
        <div>
          <p className="text-xs font-semibold text-fg-muted">Money</p>
          <p>{inr(b.amount)} · {b.paymentMethod ? label(b.paymentMethod) : '—'} · {b.paymentStatus ? label(b.paymentStatus) : '—'}</p>
          <p className="text-xs text-fg-muted">Wallet debited {inr(b.walletDebited)} · refund {inr(b.refundAmount)}{b.refundedAt ? ` on ${when(b.refundedAt)}` : ''} · attempts {b.refundAttempts}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {['HELD', 'CONFIRMED'].includes(b.status) && <Btn tone="bad" onClick={() => { setMsg(null); setCancel(true); }}>Cancel booking</Btn>}
        {b.status === 'REFUND_PENDING' && <Btn tone="primary" disabled={busy} onClick={retry}>{busy ? 'Retrying…' : 'Retry refund'}</Btn>}
      </div>
      <Msg msg={msg} />
      {cancel && (
        <ConfirmDialog open tone="bad" title={`Cancel booking ${b.bookingCode}?`} confirmLabel="Cancel booking" reason={{ label: 'Reason (the passenger sees this)', min: 5 }}
          body={<>
            <p>The seat{b.seatCount === 1 ? ' is' : 's are'} released and the passenger and driver are notified.</p>
            {b.status === 'HELD' ? <p>This is only a hold: nothing was paid.</p>
              : walletPaid ? <p className="font-semibold text-success-text">{inr(b.walletDebited || b.amount)} is refunded in full to the passenger&apos;s ZENV Wallet.</p>
                : <p>Cash booking: nothing was paid to ZENV, nothing to refund.</p>}
          </>}
          onCancel={() => setCancel(false)}
          onConfirm={async (reason) => {
            const r = await autoRideApi.cancelBooking(b.id, reason);
            setCancel(false);
            setMsg({ ok: true, text: `Cancelled (${label(r.booking.status)})${r.booking.refundAmount ? `, refund ${inr(r.booking.refundAmount)}` : ''}.` });
            onChanged();
          }} />
      )}
    </div>
  );
}
