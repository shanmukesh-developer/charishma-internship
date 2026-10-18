"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { useAdminSocket } from '@/components/AdminSocketProvider';
import { PGHostel, normalizeGender, pgRequest } from './pgApi';
import { useLiveSync, useFreshIds, liveLabel, FRESH_ROW_CLASS } from '@/lib/useLiveSync';
import { PgForm } from './PgForm';
import { RoomsPanel } from './RoomsPanel';
import { BookingsPanel } from './BookingsPanel';
import { PhotosPanel } from './PhotosPanel';
import { VideosPanel } from './VideosPanel';
import { MessPanel } from './MessPanel';
import { TimingsPanel } from './TimingsPanel';

type ManageTab = 'details' | 'rooms' | 'photos' | 'videos' | 'mess' | 'timings';
const MANAGE_TABS: [ManageTab, string][] = [['details', 'Details'], ['rooms', 'Rooms'], ['photos', 'Photos'], ['videos', 'Videos'], ['mess', 'Mess timetable'], ['timings', 'Timings']];

type View = 'listings' | 'bookings';

export default function PGAdminPage() {
  const { isAuthed } = useAdminAuth();
  const [view, setView] = useState<View>('listings');
  const [pgs, setPgs] = useState<PGHostel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<PGHostel | null>(null);
  const [manageTab, setManageTab] = useState<ManageTab>('details');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  const loadPgs = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setLoadError('');
    }
    try {
      const data = await pgRequest<PGHostel[]>('/api/pg/admin/admin-all');
      const list = Array.isArray(data) ? data : [];
      setPgs(list);
      if (quiet) setLoadError('');
      // Keep an open "manage" dialog pointing at the latest row (the details form keeps its own draft).
      setManaging(cur => (cur ? list.find(p => p.id === cur.id) || cur : cur));
    } catch (e) {
      if (!quiet) setLoadError(e instanceof Error ? e.message : 'Could not load PG listings.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const loadPendingCount = useCallback(async () => {
    try {
      const data = await pgRequest<unknown[]>('/api/pg/admin/bookings?status=Pending');
      setPendingCount(Array.isArray(data) ? data.length : null);
    } catch {
      setPendingCount(null); // the Bookings tab shows the error itself
    }
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    loadPgs();
    loadPendingCount();
  }, [isAuthed, loadPgs, loadPendingCount]);

  const { socket, notifyLive } = useAdminSocket();
  const { mark: markFresh, isFresh } = useFreshIds();
  const [roomsTick, setRoomsTick] = useState(0);
  const [bookingsTick, setBookingsTick] = useState(0);
  const managingIdRef = useRef<string | null>(null);
  managingIdRef.current = managing?.id ?? null;

  // Realtime sync: listings / rooms edited in another tab, and booking requests from the app.
  useLiveSync(['pg', 'pg_booking'], (events, { reconnect }) => {
    const pgEvents = events.filter(e => e.type === 'pg');
    const bookingEvents = events.filter(e => e.type === 'pg_booking');
    if (reconnect || pgEvents.length) {
      loadPgs(true);
      const openId = managingIdRef.current;
      if (reconnect || pgEvents.some(e => e.id === null || String(e.id) === openId)) setRoomsTick(t => t + 1);
    }
    if (reconnect || bookingEvents.length || pgEvents.some(e => e.scope === 'availability')) {
      loadPendingCount();
      setBookingsTick(t => t + 1);
    }
    if (reconnect) return;
    markFresh(pgEvents.filter(e => e.action !== 'deleted' && e.scope !== 'availability').map(e => e.id));
    markFresh(bookingEvents.map(e => e.id));
    const label = liveLabel(bookingEvents.filter(e => e.action === 'created'), 'PG booking request');
    if (label) notifyLive(label);
  }, { enabled: isAuthed });

  // A new PG booking request updates the pending badge.
  useEffect(() => {
    if (!socket || !isAuthed) return;
    const onBooking = () => { loadPendingCount(); };
    socket.on('admin_pg_booking', onBooking);
    return () => { socket.off('admin_pg_booking', onBooking); };
  }, [socket, isAuthed, loadPendingCount]);

  const createPg = async (payload: Record<string, unknown>) => {
    const pg = await pgRequest<PGHostel>('/api/pg', { method: 'POST', body: JSON.stringify(payload) });
    setPgs(prev => [...prev, pg]);
    setCreating(false);
    setNotice({ kind: 'ok', text: `${pg.name} created. Add rooms so students can book it.` });
    setManaging(pg);
    setManageTab('rooms');
  };

  const updatePg = async (payload: Record<string, unknown>) => {
    if (!managing) return;
    const pg = await pgRequest<PGHostel>(`/api/pg/${managing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    setPgs(prev => prev.map(p => (p.id === pg.id ? pg : p)));
    setManaging(pg);
    setNotice({ kind: 'ok', text: `${pg.name} saved.` });
  };

  // A content tab saved: keep the list card and the open dialog in step.
  const onContentSaved = useCallback((id: string, patch: Partial<PGHostel>) => {
    setPgs(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));
    setManaging(cur => (cur && cur.id === id ? { ...cur, ...patch } : cur));
  }, []);

  const toggleActive = async (pg: PGHostel) => {
    if (busy[pg.id]) return;
    if (pg.isActive && !window.confirm(`Hide "${pg.name}" from the app? Students can no longer see or book it.`)) return;
    setBusy(prev => ({ ...prev, [pg.id]: true }));
    try {
      // PUT /api/pg/:id writes every field it receives, so send the full listing with the new flag.
      const { id, ...rest } = pg;
      const saved = await pgRequest<PGHostel>(`/api/pg/${id}`, { method: 'PUT', body: JSON.stringify({ ...rest, isActive: !pg.isActive }) });
      setPgs(prev => prev.map(p => (p.id === saved.id ? saved : p)));
      setNotice({ kind: 'ok', text: saved.isActive ? `${saved.name} is listed.` : `${saved.name} is hidden.` });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Could not update the listing.' });
    } finally {
      setBusy(prev => ({ ...prev, [pg.id]: false }));
    }
  };

  const deletePg = async (pg: PGHostel) => {
    const typed = window.prompt(`Delete "${pg.name}" permanently?\n\nStudents lose access to it and its booking history loses the PG name. Hiding it is usually better.\n\nType the PG name to confirm:`);
    if (typed === null) return;
    if (typed.trim() !== pg.name.trim()) {
      setNotice({ kind: 'error', text: 'The name did not match, so nothing was deleted.' });
      return;
    }
    setBusy(prev => ({ ...prev, [pg.id]: true }));
    try {
      await pgRequest(`/api/pg/${pg.id}`, { method: 'DELETE' });
      setPgs(prev => prev.filter(p => p.id !== pg.id));
      if (managing?.id === pg.id) setManaging(null);
      setNotice({ kind: 'ok', text: `${pg.name} deleted.` });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Could not delete the listing.' });
      setBusy(prev => ({ ...prev, [pg.id]: false }));
    }
  };

  const onPendingCount = useCallback((n: number) => setPendingCount(n), []);

  if (!isAuthed) return <div className="p-10 text-center text-sm text-gray-400" role="status">Checking your admin session…</div>;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 text-white md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-blue-400">Housing</p>
          <h1 className="mt-1 text-2xl font-black">PG &amp; hostels</h1>
          <p className="mt-2 text-sm text-gray-400">Curate PG listings and rooms, and confirm students&apos; booking requests.</p>
        </div>
        {view === 'listings' && (
          <div className="flex items-center gap-3">
            <button type="button" disabled={loading} onClick={() => loadPgs()} className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-gray-300 hover:text-white disabled:opacity-50">{loading ? 'Loading…' : 'Refresh'}</button>
            <button type="button" onClick={() => setCreating(true)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500">Add PG</button>
          </div>
        )}
      </header>

      <div className="flex gap-1 border-b border-white/10" role="tablist">
        {([['listings', `Listings (${pgs.length})`], ['bookings', `Booking requests${pendingCount ? ` · ${pendingCount} pending` : ''}`]] as [View, string][]).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)} className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold ${view === key ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'}`}>{label}</button>
        ))}
      </div>

      {notice && (
        <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-sm ${notice.kind === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold opacity-70 hover:opacity-100">Dismiss</button>
        </div>
      )}

      {view === 'bookings' ? (
        <BookingsPanel onPendingCount={onPendingCount} liveTick={bookingsTick} isFresh={isFresh} />
      ) : (
        <>
          {loadError && (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
              {loadError}<button type="button" onClick={() => loadPgs()} className="font-bold underline">Retry</button>
            </div>
          )}
          {loading ? (
            <div role="status" className="rounded-lg border border-white/10 p-8 text-sm text-gray-400">Loading PG listings…</div>
          ) : !loadError && pgs.length === 0 ? (
            <div className="rounded-lg border border-white/10 p-10 text-center">
              <h2 className="font-bold">No PG listings yet</h2>
              <p className="mt-2 text-sm text-gray-400">Add a PG and its rooms to show it in the app.</p>
            </div>
          ) : (
            <section className="grid gap-4 md:grid-cols-2" aria-label="PG listings">
              {pgs.map(pg => (
                <article key={pg.id} className={`flex flex-col justify-between rounded-xl border p-5 ${pg.isActive ? 'border-white/10' : 'border-white/5 bg-white/[0.015]'} ${isFresh(pg.id) ? FRESH_ROW_CLASS : ''}`}>
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-lg font-bold">{pg.name}</h2>
                        <p className="mt-0.5 text-xs text-gray-500">{pg.address}</p>
                      </div>
                      <span className={`shrink-0 rounded border px-2 py-0.5 text-[11px] font-semibold ${pg.isActive ? 'border-emerald-500/30 text-emerald-300' : 'border-white/10 text-gray-400'}`}>{pg.isActive ? 'Listed' : 'Hidden'}</span>
                    </div>
                    <dl className="mt-4 grid grid-cols-3 gap-3 border-y border-white/5 py-3 text-sm">
                      <div><dt className="text-xs text-gray-500">Distance</dt><dd className="font-semibold">{pg.distanceFromCollege} km</dd></div>
                      <div><dt className="text-xs text-gray-500">For</dt><dd className="font-semibold">{normalizeGender(pg.genderType)}</dd></div>
                      <div><dt className="text-xs text-gray-500">From</dt><dd className="font-semibold">₹{Number(pg.baseRent).toLocaleString('en-IN')}/mo</dd></div>
                    </dl>
                    {!!pg.amenities?.length && <p className="mt-3 text-xs text-gray-400">{pg.amenities.join(' · ')}</p>}
                    <p className="mt-2 text-xs text-gray-500">
                      {[
                        pg.photos?.length ? `${pg.photos.length} photo${pg.photos.length === 1 ? '' : 's'}` : pg.images?.length ? `${pg.images.length} photo${pg.images.length === 1 ? '' : 's'} (no categories)` : '',
                        pg.videos?.length ? `${pg.videos.length} video${pg.videos.length === 1 ? '' : 's'}` : '',
                        pg.messTimetable?.meals?.length ? 'Mess timetable' : '',
                        pg.isVerified ? 'Verified' : '',
                      ].filter(Boolean).join(' · ')}
                      {!pg.photos?.length && !pg.images?.length && <span className="text-amber-300">No photos yet</span>}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => { setManaging(pg); setManageTab('details'); }} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold hover:bg-white/15">Edit details</button>
                    <button type="button" onClick={() => { setManaging(pg); setManageTab('rooms'); }} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:text-white">Rooms</button>
                    <button type="button" onClick={() => { setManaging(pg); setManageTab('photos'); }} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:text-white">Photos</button>
                    <button type="button" disabled={!!busy[pg.id]} onClick={() => toggleActive(pg)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:text-white disabled:opacity-50">{pg.isActive ? 'Hide' : 'List'}</button>
                    <button type="button" disabled={!!busy[pg.id]} onClick={() => deletePg(pg)} className="ml-auto rounded-lg px-2 py-1.5 text-xs font-semibold text-red-400/70 hover:text-red-300 disabled:opacity-50">Delete</button>
                  </div>
                </article>
              ))}
            </section>
          )}
        </>
      )}

      {(creating || managing) && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="pg-modal-title">
          <div className="my-8 w-full max-w-4xl rounded-2xl border border-white/10 bg-[#0d0f14] p-6 text-white shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <h2 id="pg-modal-title" className="text-xl font-bold">{creating ? 'Add PG' : managing?.name}</h2>
              <button type="button" onClick={() => { setCreating(false); setManaging(null); }} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-gray-300 hover:text-white">Close</button>
            </div>
            {managing && !creating && (
              <div className="mb-5 flex gap-1 overflow-x-auto border-b border-white/10" role="tablist">
                {MANAGE_TABS.map(([tab, label]) => (
                  <button key={tab} type="button" role="tab" aria-selected={manageTab === tab} onClick={() => setManageTab(tab)} className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold ${manageTab === tab ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'}`}>{label}</button>
                ))}
              </div>
            )}
            {creating ? (
              <PgForm initial={null} onCancel={() => setCreating(false)} onSave={createPg} />
            ) : managing && manageTab === 'details' ? (
              <PgForm key={managing.id} initial={managing} onCancel={() => setManaging(null)} onSave={updatePg} />
            ) : managing && manageTab === 'photos' ? (
              <PhotosPanel key={managing.id} pg={managing} onSaved={patch => onContentSaved(managing.id, patch)} />
            ) : managing && manageTab === 'videos' ? (
              <VideosPanel key={managing.id} pg={managing} onSaved={patch => onContentSaved(managing.id, patch)} />
            ) : managing && manageTab === 'mess' ? (
              <MessPanel key={managing.id} pg={managing} onSaved={patch => onContentSaved(managing.id, patch)} />
            ) : managing && manageTab === 'timings' ? (
              <TimingsPanel key={managing.id} pg={managing} onSaved={patch => onContentSaved(managing.id, patch)} />
            ) : managing ? (
              <RoomsPanel pgId={managing.id} liveTick={roomsTick} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
