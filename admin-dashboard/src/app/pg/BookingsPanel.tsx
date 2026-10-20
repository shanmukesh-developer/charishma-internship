"use client";
import { useCallback, useEffect, useState } from 'react';
import { FIELD, PGBooking, formatDate, pgRequest } from './pgApi';
import { FRESH_ROW_CLASS } from '@/lib/useLiveSync';

interface DuplicateInfo {
  index?: { built: boolean | null; duplicateGroups?: number } | null;
  groups: Array<{
    userId: string; hostelId: string; keepId: string;
    user?: { name?: string; phone?: string } | null; hostel?: { name?: string } | null;
    bookings: Array<{ id: string; status: string; createdAt?: string }>;
  }>;
}

const STATUS_STYLE: Record<string, string> = {
  Pending: 'border-warning/30 bg-warning-soft text-warning-text',
  Confirmed: 'border-success/30 bg-success-soft text-success-text',
  Cancelled: 'border-line text-fg-muted',
};

/** Booking requests from the app (GET /api/pg/admin/bookings). Confirming takes a bed; cancelling a confirmed one frees it. */
export function BookingsPanel({ onPendingCount, liveTick = 0, isFresh }: {
  onPendingCount: (n: number) => void;
  /** bumped by realtime `pg_booking` / `pg` events: quiet reload */
  liveTick?: number;
  isFresh?: (id: string) => boolean;
}) {
  const [status, setStatus] = useState('Pending');
  const [bookings, setBookings] = useState<PGBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // Older double taps can have left one student with several open requests at one PG; they also stop
  // the server's one-open-booking guard index from being built (GET /api/pg/admin/bookings/duplicates).
  const [dupes, setDupes] = useState<DuplicateInfo | null>(null);
  const [resolving, setResolving] = useState(false);
  const loadDupes = useCallback(async () => {
    try { setDupes(await pgRequest<DuplicateInfo>('/api/pg/admin/bookings/duplicates', { cache: 'reload' })); } catch { /* older backend: no banner */ }
  }, []);
  useEffect(() => { loadDupes(); }, [loadDupes, liveTick]);
  const resolveDupes = async () => {
    if (resolving || !dupes?.groups.length) return;
    const extra = dupes.groups.reduce((n, g) => n + g.bookings.length - 1, 0);
    if (!window.confirm(`Cancel ${extra} duplicate request${extra === 1 ? '' : 's'}?

For each student and PG one request is kept: the confirmed one, otherwise the newest. The others are cancelled (a confirmed duplicate gives its bed back). Students are not notified.`)) return;
    setResolving(true);
    setNotice(null);
    try {
      const res = await pgRequest<{ message?: string; failed?: unknown[] }>('/api/pg/admin/bookings/duplicates/resolve', { method: 'POST', body: '{}' });
      setNotice({ kind: res?.failed?.length ? 'error' : 'ok', text: `${res?.message || 'Duplicates resolved.'}${res?.failed?.length ? ` ${res.failed.length} could not be cancelled; retry.` : ''}` });
      await Promise.all([loadDupes(), load()]);
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Could not resolve the duplicates.' });
    } finally {
      setResolving(false);
    }
  };

  const load = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setError('');
    }
    try {
      const query = status === 'All' ? '' : `?status=${encodeURIComponent(status)}`;
      const data = await pgRequest<PGBooking[]>(`/api/pg/admin/bookings${query}`);
      const list = Array.isArray(data) ? data : [];
      setBookings(list);
      if (quiet) setError('');
      if (status === 'Pending') onPendingCount(list.length);
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : 'Could not load booking requests.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [status, onPendingCount]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (liveTick > 0) load(true); }, [liveTick, load]);

  const changeStatus = async (booking: PGBooking, next: 'Confirmed' | 'Cancelled') => {
    if (busy[booking.id]) return;
    const who = booking.user?.name || 'the student';
    const where = `${booking.hostel?.name || 'this PG'}${booking.room ? `, room ${booking.room.roomNumber}` : ''}`;
    const question = next === 'Confirmed'
      ? `Confirm ${who}'s booking at ${where}?\n\nThis reserves one bed and notifies the student.`
      : `Cancel ${who}'s booking at ${where}?${booking.status === 'Confirmed' ? '\n\nThe reserved bed is released.' : ''} The student is notified.`;
    if (!window.confirm(question)) return;
    setBusy(prev => ({ ...prev, [booking.id]: true }));
    setNotice(null);
    try {
      const res = await pgRequest<{ message?: string; booking?: Partial<PGBooking> }>(`/api/pg/admin/bookings/${booking.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: next }),
      });
      setNotice({ kind: 'ok', text: res?.message || `Booking ${next.toLowerCase()}.` });
      await load();
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Could not update the booking.' });
    } finally {
      setBusy(prev => ({ ...prev, [booking.id]: false }));
    }
  };

  return (
    <section className="space-y-4" aria-label="Booking requests">
      <div className="flex flex-wrap items-center gap-3">
        <select value={status} onChange={e => setStatus(e.target.value)} className={`${FIELD} w-auto`} aria-label="Status">
          <option value="Pending">Pending</option>
          <option value="Confirmed">Confirmed</option>
          <option value="Cancelled">Cancelled</option>
          <option value="All">All</option>
        </select>
        <button type="button" disabled={loading} onClick={() => load()} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg-muted hover:text-fg disabled:opacity-50">{loading ? 'Loading…' : 'Refresh'}</button>
        <p className="text-xs text-fg-muted">Students also get a WhatsApp link to the housing desk when they request. Confirm here once you have spoken to them.</p>
      </div>

      {dupes && dupes.groups.length > 0 && (
        <div role="alert" className="space-y-2 rounded-lg border border-warning/30 bg-warning-soft p-4 text-sm text-warning-text">
          <p className="font-semibold">Duplicate open requests: {dupes.groups.length} student{dupes.groups.length === 1 ? '' : 's'} with more than one open request at the same PG</p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-warning-text">
            {dupes.groups.slice(0, 8).map(g => (
              <li key={`${g.userId}:${g.hostelId}`}>{g.user?.name || 'Unknown student'} · {g.hostel?.name || 'PG removed'}: {g.bookings.length} requests ({g.bookings.map(b => b.status).join(', ')})</li>
            ))}
            {dupes.groups.length > 8 && <li>…and {dupes.groups.length - 8} more</li>}
          </ul>
          {dupes.index && dupes.index.built === false && <p className="text-xs text-warning-text">Until they are resolved the server cannot switch on its duplicate-booking guard.</p>}
          <button type="button" disabled={resolving} onClick={resolveDupes} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50">{resolving ? 'Resolving…' : 'Keep one per student, cancel the rest'}</button>
        </div>
      )}

      {notice && (
        <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-sm ${notice.kind === 'error' ? 'border-danger/30 bg-danger-soft text-danger-text' : 'border-success/30 bg-success-soft text-success-text'}`}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold opacity-70 hover:opacity-100">Dismiss</button>
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger-text">
          {error}<button type="button" onClick={() => load()} className="font-semibold underline">Retry</button>
        </div>
      )}

      {loading ? (
        <div role="status" className="rounded-lg border border-line p-8 text-sm text-fg-muted">Loading booking requests…</div>
      ) : !error && bookings.length === 0 ? (
        <div className="rounded-lg border border-line p-10 text-center">
          <h2 className="font-semibold">No {status === 'All' ? '' : `${status.toLowerCase()} `}booking requests</h2>
          <p className="mt-2 text-sm text-fg-muted">Requests appear here when students book a room in the app.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-surface-2/60 text-xs text-fg-muted">
              <tr><th className="p-3">Student</th><th className="p-3">PG & room</th><th className="p-3">Check-in</th><th className="p-3">Requested</th><th className="p-3">Status</th><th className="p-3 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {bookings.map(b => (
                <tr key={b.id} className={isFresh?.(b.id) ? FRESH_ROW_CLASS : undefined}>
                  <td className="p-3">
                    <p className="font-semibold text-fg">{b.user?.name || 'Unknown student'}</p>
                    <p className="text-xs text-fg-muted">{b.user?.phone || 'No phone'}{b.user?.email ? ` · ${b.user.email}` : ''}</p>
                  </td>
                  <td className="p-3">
                    <p className="text-fg">{b.hostel?.name || 'PG removed'}</p>
                    <p className="text-xs text-fg-muted">{b.room ? `Room ${b.room.roomNumber} · ${b.room.sharingType} seater · ${b.room.availableBeds} free` : 'Room removed'}</p>
                  </td>
                  <td className="p-3 text-fg-muted">{formatDate(b.checkInDate)}</td>
                  <td className="p-3 text-fg-muted">{formatDate(b.createdAt, true)}</td>
                  <td className="p-3"><span className={`rounded border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[b.status] || STATUS_STYLE.Cancelled}`}>{b.status}</span></td>
                  <td className="p-3 text-right">
                    {b.status === 'Pending' && (
                      <button type="button" disabled={!!busy[b.id] || !b.room || b.room.availableBeds <= 0} title={b.room && b.room.availableBeds <= 0 ? 'No free beds in this room' : undefined} onClick={() => changeStatus(b, 'Confirmed')} className="rounded-lg bg-success px-3 py-1.5 text-xs font-semibold text-on-solid hover:bg-success/90 disabled:opacity-40">Confirm</button>
                    )}
                    {b.status !== 'Cancelled' && (
                      <button type="button" disabled={!!busy[b.id]} onClick={() => changeStatus(b, 'Cancelled')} className="ml-2 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-fg-muted hover:border-danger/30 hover:text-danger-text disabled:opacity-40">Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
