"use client";
import { useEffect, useState } from 'react';
import { PGRoom, pgRequest, roomTypeOptions } from './pgApi';

/** Room types of a PG (for linking photos and videos to a kind of room). */
export function useRoomTypes(pgId: string) {
  const [options, setOptions] = useState<{ key: string; label: string }[]>([]);
  useEffect(() => {
    let alive = true;
    pgRequest<PGRoom[]>(`/api/pg/${pgId}/rooms-all`)
      .then(rooms => { if (alive) setOptions(roomTypeOptions(Array.isArray(rooms) ? rooms : [])); })
      .catch(() => { if (alive) setOptions([]); });
    return () => { alive = false; };
  }, [pgId]);
  return options;
}

/** Save / discard row shared by the content panels. */
export function SaveBar({ dirty, saving, onSave, onDiscard, message, extra }: {
  dirty: boolean; saving: boolean; onSave: () => void; onDiscard: () => void;
  message: { kind: 'ok' | 'error'; text: string } | null; extra?: React.ReactNode;
}) {
  return (
    <div className="sticky bottom-0 -mx-6 mt-6 flex flex-wrap items-center gap-3 border-t border-white/10 bg-[#0d0f14] px-6 py-4">
      {message && <span role={message.kind === 'error' ? 'alert' : 'status'} className={`mr-auto text-sm ${message.kind === 'error' ? 'text-red-300' : 'text-emerald-300'}`}>{message.text}</span>}
      {!message && <span className="mr-auto text-xs text-gray-500">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>}
      {extra}
      {dirty && <button type="button" disabled={saving} onClick={onDiscard} className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-gray-300 hover:text-white disabled:opacity-50">Discard</button>}
      <button type="button" disabled={!dirty || saving} onClick={onSave} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
    </div>
  );
}

export const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
