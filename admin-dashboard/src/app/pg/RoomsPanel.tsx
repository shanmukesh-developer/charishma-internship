"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { FIELD, LABEL, PGRoom, pgRequest } from './pgApi';

type RoomDraft = {
  roomNumber: string; sharingType: string; pricePerBed: string; totalBeds: string; availableBeds: string;
  floorNumber: string; furnishing: string; hasAttachedBathroom: boolean; hasAC: boolean; hasBalcony: boolean; isActive: boolean;
  roomType: string; securityDeposit: string;
};

const NEW_ROOM: RoomDraft = {
  roomNumber: '', sharingType: '2', pricePerBed: '', totalBeds: '2', availableBeds: '2', floorNumber: '1',
  furnishing: 'Fully Furnished', hasAttachedBathroom: true, hasAC: false, hasBalcony: false, isActive: true,
  roomType: '', securityDeposit: '',
};

const toDraft = (r: PGRoom): RoomDraft => ({
  roomNumber: r.roomNumber, sharingType: String(r.sharingType), pricePerBed: String(r.pricePerBed), totalBeds: String(r.totalBeds),
  availableBeds: String(r.availableBeds), floorNumber: String(r.floorNumber ?? 0), furnishing: r.furnishing || 'Fully Furnished',
  hasAttachedBathroom: !!r.hasAttachedBathroom, hasAC: !!r.hasAC, hasBalcony: !!r.hasBalcony, isActive: r.isActive !== false,
  roomType: r.roomType || '', securityDeposit: r.securityDeposit === null || r.securityDeposit === undefined ? '' : String(r.securityDeposit),
});

function toPayload(d: RoomDraft): { payload?: Record<string, unknown>; error?: string } {
  const int = (v: string) => (/^-?\d+$/.test(v.trim()) ? Number(v) : NaN);
  const sharingType = int(d.sharingType);
  const totalBeds = int(d.totalBeds);
  const availableBeds = int(d.availableBeds);
  const floorNumber = int(d.floorNumber);
  const pricePerBed = Number(d.pricePerBed);
  if (!d.roomNumber.trim()) return { error: 'Room number is required.' };
  if (!Number.isFinite(pricePerBed) || pricePerBed <= 0) return { error: 'Enter the rent per bed.' };
  if (!(totalBeds >= 1 && totalBeds <= 20)) return { error: 'Total beds must be between 1 and 20.' };
  if (!(availableBeds >= 0 && availableBeds <= totalBeds)) return { error: 'Available beds must be between 0 and the total beds.' };
  if (!Number.isInteger(floorNumber) || floorNumber < 0 || floorNumber > 50) return { error: 'Floor must be a whole number between 0 and 50.' };
  const deposit = d.securityDeposit.trim() === '' ? null : Number(d.securityDeposit);
  if (deposit !== null && (!Number.isFinite(deposit) || deposit < 0 || deposit > 500000)) return { error: 'Deposit must be between ₹0 and ₹500000, or blank to use the PG deposit.' };
  if (d.roomType.trim().length > 48) return { error: 'Room type name must be at most 48 characters.' };
  return {
    payload: {
      roomNumber: d.roomNumber.trim(), sharingType, pricePerBed, totalBeds, availableBeds, floorNumber,
      furnishing: d.furnishing, hasAttachedBathroom: d.hasAttachedBathroom, hasAC: d.hasAC, hasBalcony: d.hasBalcony, isActive: d.isActive,
      roomType: d.roomType.trim() || null, securityDeposit: deposit,
    },
  };
}

function RoomFields({ draft, onChange }: { draft: RoomDraft; onChange: (d: RoomDraft) => void }) {
  const set = (patch: Partial<RoomDraft>) => onChange({ ...draft, ...patch });
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-7">
        <label className={LABEL}>Room<input className={FIELD} value={draft.roomNumber} onChange={e => set({ roomNumber: e.target.value })} /></label>
        <label className={LABEL}>Sharing
          <select className={FIELD} value={draft.sharingType} onChange={e => set({ sharingType: e.target.value })}>
            {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n} seater</option>)}
          </select>
        </label>
        <label className={LABEL}>Rent/bed (₹)<input inputMode="numeric" className={FIELD} value={draft.pricePerBed} onChange={e => set({ pricePerBed: e.target.value })} /></label>
        <label className={LABEL}>Floor<input inputMode="numeric" className={FIELD} value={draft.floorNumber} onChange={e => set({ floorNumber: e.target.value })} /></label>
        <label className={LABEL}>Total beds<input inputMode="numeric" className={FIELD} value={draft.totalBeds} onChange={e => set({ totalBeds: e.target.value })} /></label>
        <label className={LABEL}>Free beds<input inputMode="numeric" className={FIELD} value={draft.availableBeds} onChange={e => set({ availableBeds: e.target.value })} /></label>
        <label className={LABEL}>Furnishing
          <select className={FIELD} value={draft.furnishing} onChange={e => set({ furnishing: e.target.value })}>
            <option>Fully Furnished</option><option>Semi Furnished</option><option>Unfurnished</option>
          </select>
        </label>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr]">
        <label className={LABEL}>Room type name (optional)<input className={FIELD} maxLength={48} placeholder="e.g. Deluxe twin. Blank = grouped by sharing, AC and bath" value={draft.roomType} onChange={e => set({ roomType: e.target.value })} /></label>
        <label className={LABEL}>Deposit (₹, optional)<input inputMode="numeric" className={FIELD} placeholder="Blank = PG deposit" value={draft.securityDeposit} onChange={e => set({ securityDeposit: e.target.value })} /></label>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-300">
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.hasAttachedBathroom} onChange={e => set({ hasAttachedBathroom: e.target.checked })} className="h-4 w-4 accent-blue-500" /> Attached bath</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.hasAC} onChange={e => set({ hasAC: e.target.checked })} className="h-4 w-4 accent-blue-500" /> AC</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.hasBalcony} onChange={e => set({ hasBalcony: e.target.checked })} className="h-4 w-4 accent-blue-500" /> Balcony</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.isActive} onChange={e => set({ isActive: e.target.checked })} className="h-4 w-4 accent-emerald-500" /> Bookable</label>
      </div>
    </>
  );
}

function RoomRow({ pgId, room, onSaved, onDeleted }: { pgId: string; room: PGRoom; onSaved: (r: PGRoom) => void; onDeleted: (id: string) => void }) {
  const [draft, setDraft] = useState<RoomDraft>(() => toDraft(room));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(room));

  // Live refresh: when the room changes elsewhere (another admin tab, a booking taking a bed), follow it
  // unless this row has unsaved edits.
  const prevRoom = useRef(room);
  useEffect(() => {
    const before = prevRoom.current;
    prevRoom.current = room;
    if (before === room) return;
    setDraft(cur => (JSON.stringify(cur) === JSON.stringify(toDraft(before)) ? toDraft(room) : cur));
  }, [room]);

  const save = async () => {
    if (busy) return;
    const { payload, error } = toPayload(draft);
    if (!payload) return setMessage({ kind: 'error', text: error || 'Check the room.' });
    setBusy(true);
    setMessage(null);
    try {
      const saved = await pgRequest<PGRoom>(`/api/pg/${pgId}/rooms/${room.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      onSaved(saved);
      setDraft(toDraft(saved));
      setMessage({ kind: 'ok', text: 'Saved.' });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Could not save the room.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || !window.confirm(`Delete room ${room.roomNumber}? Pending requests for it can no longer be confirmed.`)) return;
    setBusy(true);
    try {
      await pgRequest(`/api/pg/${pgId}/rooms/${room.id}`, { method: 'DELETE' });
      onDeleted(room.id);
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Could not delete the room.' });
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-xl border p-4 ${draft.isActive ? 'border-white/10' : 'border-white/5 opacity-70'}`}>
      <RoomFields draft={draft} onChange={setDraft} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={!dirty || busy} onClick={save} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-40">{busy ? 'Saving…' : 'Save room'}</button>
        {dirty && <button type="button" disabled={busy} onClick={() => { setDraft(toDraft(room)); setMessage(null); }} className="text-xs text-gray-400 hover:text-white">Discard changes</button>}
        <button type="button" disabled={busy} onClick={remove} className="ml-auto text-xs font-semibold text-red-400/70 hover:text-red-300 disabled:opacity-50">Delete room</button>
        {message && <span role={message.kind === 'error' ? 'alert' : 'status'} className={`w-full text-xs ${message.kind === 'error' ? 'text-red-300' : 'text-emerald-300'}`}>{message.text}</span>}
      </div>
    </div>
  );
}

export function RoomsPanel({ pgId, liveTick = 0 }: { pgId: string; /** bumped by realtime `pg` events */ liveTick?: number }) {
  const [rooms, setRooms] = useState<PGRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<RoomDraft>(NEW_ROOM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setError('');
    }
    try {
      const data = await pgRequest<PGRoom[]>(`/api/pg/${pgId}/rooms-all`);
      setRooms(Array.isArray(data) ? [...data].sort((a, b) => String(a.roomNumber).localeCompare(String(b.roomNumber), undefined, { numeric: true })) : []);
      if (quiet) setError('');
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : 'Could not load rooms.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [pgId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (liveTick > 0) load(true); }, [liveTick, load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (creating) return;
    const { payload, error: invalid } = toPayload(draft);
    if (!payload) return setCreateError(invalid || 'Check the room.');
    setCreating(true);
    setCreateError('');
    try {
      const room = await pgRequest<PGRoom>(`/api/pg/${pgId}/rooms`, { method: 'POST', body: JSON.stringify(payload) });
      setRooms(prev => [...prev, room]);
      setDraft(NEW_ROOM);
      setAdding(false);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Could not add the room.');
    } finally {
      setCreating(false);
    }
  };

  const beds = rooms.filter(r => r.isActive).reduce((acc, r) => ({ total: acc.total + (r.totalBeds || 0), free: acc.free + (r.availableBeds || 0) }), { total: 0, free: 0 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-400">{rooms.length} rooms · {beds.free} of {beds.total} beds free</p>
        <button type="button" onClick={() => { setAdding(v => !v); setCreateError(''); }} className="rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-white/5">{adding ? 'Close' : 'Add room'}</button>
      </div>

      {adding && (
        <form onSubmit={create} className="rounded-xl border border-blue-500/30 bg-blue-500/[0.03] p-4">
          <RoomFields draft={draft} onChange={setDraft} />
          {createError && <p role="alert" className="mt-3 text-sm text-red-300">{createError}</p>}
          <button type="submit" disabled={creating} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50">{creating ? 'Adding…' : 'Add room'}</button>
        </form>
      )}

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}<button type="button" onClick={() => load()} className="font-bold underline">Retry</button>
        </div>
      )}
      {loading ? (
        <p role="status" className="text-sm text-gray-400">Loading rooms…</p>
      ) : !error && rooms.length === 0 ? (
        <p className="rounded-lg border border-white/10 p-6 text-center text-sm text-gray-400">No rooms yet. Students cannot book this PG until you add one.</p>
      ) : (
        <div className="space-y-3">
          {rooms.map(room => (
            <RoomRow key={room.id} pgId={pgId} room={room} onSaved={saved => setRooms(prev => prev.map(r => (r.id === saved.id ? saved : r)))} onDeleted={id => setRooms(prev => prev.filter(r => r.id !== id))} />
          ))}
        </div>
      )}
    </div>
  );
}
