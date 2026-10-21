"use client";
import { useConfirm } from '@/components/ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAdminSocket } from '@/components/AdminSocketProvider';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { adminRequest } from '@/lib/api';
import { getAuthState } from '@/lib/session';
import { useLiveSync } from '@/lib/useLiveSync';

interface SOSData {
  riderId: string;
  riderName?: string;
  riderPhone?: string;
  timestamp?: string;
  lat?: number;
  lng?: number;
  location?: { lat?: number; lng?: number; stale?: boolean; at?: string } | null;
  /** Rider's short note from the SOS sheet (live alert, and stored on the rider row as sosNote). */
  note?: string;
  /** Order the rider was carrying when they pressed SOS. */
  orderId?: string | null;
}

/**
 * Siren drawn with Web Audio (no third-party audio file: nothing leaks the admin's IP / Referer,
 * and the CSP keeps media-src to 'self'). Browsers may block it until the page has been clicked.
 */
function playSiren() {
  try {
    const Ctx: typeof AudioContext | undefined = typeof window !== 'undefined'
      ? (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    gain.gain.value = 0.08;
    const t0 = ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      osc.frequency.setValueAtTime(700, t0 + i * 0.5);
      osc.frequency.linearRampToValueAtTime(1200, t0 + i * 0.5 + 0.25);
      osc.frequency.linearRampToValueAtTime(700, t0 + i * 0.5 + 0.5);
    }
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 3);
    osc.onended = () => { ctx.close().catch(() => {}); };
  } catch {
    /* autoplay blocked or no audio device */
  }
}

/** JSON columns can arrive as an object or (SQLite) a JSON string. */
const asLocation = (v: unknown, forceStale = false): { lat?: number; lng?: number; stale?: boolean; at?: string } | null => {
  let o = v;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return null; } }
  if (!o || typeof o !== 'object') return null;
  const { lat, lng, stale, at, ts } = o as { lat?: unknown; lng?: unknown; stale?: unknown; at?: unknown; ts?: unknown };
  if (lat == null || lng == null) return null;
  const when = typeof at === 'string' ? at : typeof ts === 'string' ? ts : undefined;
  return { lat: Number(lat), lng: Number(lng), ...(stale === true || forceStale ? { stale: true } : {}), ...(when ? { at: when } : {}) };
};

const coords = (s: SOSData) => {
  const lat = Number(s.lat ?? s.location?.lat);
  const lng = Number(s.lng ?? s.location?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
};

/**
 * Queue of active rider SOS alerts. Alerts that arrived while no admin tab was open are loaded from
 * the riders list (isSosActive = true) when the dashboard starts, and a second alert never hides the
 * first one. "Resolve" clears the rider's SOS on the server; "Hide" only closes it on this screen.
 */
export default function SOSAlertModal() {
  const confirm = useConfirm();
  const [queue, setQueue] = useState<SOSData[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { socket } = useAdminSocket();
  const { isAuthed } = useAdminAuth();
  const hidden = useRef<Set<string>>(new Set());

  const push = useCallback((data: SOSData) => {
    const riderId = String(data?.riderId || '');
    if (!riderId) return;
    hidden.current.delete(riderId);
    setQueue(prev => [...prev.filter(s => s.riderId !== riderId), { ...data, riderId, timestamp: data.timestamp || new Date().toISOString() }]);
  }, []);

  // Signed out (or session expired): this modal sits outside the auth gate, so drop rider data at once.
  useEffect(() => {
    if (isAuthed) return;
    setQueue([]);
    setError('');
    hidden.current.clear();
  }, [isAuthed]);

  // Riders whose SOS is still active on the server (sent while nobody was watching, or while this
  // tab's live socket was down). Only SOS riders are requested (?sosActive=1), not the whole fleet.
  const loadSeq = useRef(0);
  const loadActive = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const riderPage = (page: number) => adminRequest<{ riders?: any[]; pages?: number }>(`/api/admin/riders?sosActive=1&limit=100&page=${page}`, { cache: 'reload' });
      const first = await riderPage(1);
      const all: any[] = Array.isArray(first?.riders) ? [...first.riders] : [];
      const pages = Math.min(20, Number(first?.pages) || 1);
      if (all.length >= 100 && pages > 1) {
        const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => riderPage(i + 2)));
        rest.forEach(d => { if (Array.isArray(d?.riders)) all.push(...d.riders); });
      }
      const active: SOSData[] = all.filter(r => r?.isSosActive).map(r => ({
        riderId: String(r.id || r._id),
        riderName: r.name,
        riderPhone: r.phone,
        timestamp: r.sosAt || r.updatedAt,
        // Where the rider was when they pressed SOS; their last live position only as a fallback.
        location: asLocation(r.sosLocation) || asLocation(r.liveLocation, true),
        note: typeof r.sosNote === 'string' && r.sosNote.trim() ? r.sosNote : undefined,
        orderId: r.currentOrderId || null,
      }));
      if (seq !== loadSeq.current || getAuthState().status !== 'authed') return;
      const activeIds = new Set(active.map(s => s.riderId));
      setQueue(prev => {
        // Alerts resolved elsewhere while this tab was offline are dropped; new ones are added.
        const kept = prev.filter(s => activeIds.has(s.riderId));
        const known = new Set(kept.map(s => s.riderId));
        return [...kept, ...active.filter(s => !known.has(s.riderId) && !hidden.current.has(s.riderId))];
      });
    } catch {
      /* the live socket still delivers new alerts */
    }
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    loadActive();
    return () => { loadSeq.current++; };
  }, [isAuthed, loadActive]);

  // Socket came back after a drop: SOS alerts sent meanwhile are not replayed, so re-read them.
  useLiveSync([], (_events, { reconnect }) => { if (reconnect) loadActive(); }, { enabled: isAuthed });

  useEffect(() => {
    if (!socket) return;
    const handleSos = (data: SOSData) => {
      if (getAuthState().status !== 'authed') return;
      push(data);
      playSiren();
    };
    const handleReset = (evt: { type?: string; data?: { id?: string } } | undefined) => {
      if (evt?.type === 'RIDER_SOS_RESET' && evt.data?.id) {
        const id = String(evt.data.id);
        setQueue(prev => prev.filter(s => s.riderId !== id));
      }
    };
    socket.on('sos_received', handleSos);
    socket.on('systemUpdate', handleReset);
    return () => {
      socket.off('sos_received', handleSos);
      socket.off('systemUpdate', handleReset);
    };
  }, [socket, push]);

  const current = queue[0];
  if (!current || !isAuthed) return null;

  const hide = () => {
    hidden.current.add(current.riderId);
    setError('');
    setQueue(prev => prev.slice(1));
  };

  const resolve = async () => {
    if (busy) return;
    if (!(await confirm({ title: `Mark ${current.riderName || 'this rider'}'s SOS as resolved?`, description: 'Only do this after you have reached the rider.', confirmLabel: 'Mark resolved' }))) return;
    setBusy(true);
    setError('');
    try {
      await adminRequest(`/api/admin/riders/${encodeURIComponent(current.riderId)}/reset-sos`, { method: 'POST' });
      setQueue(prev => prev.filter(s => s.riderId !== current.riderId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve the SOS.');
    } finally {
      setBusy(false);
    }
  };

  const where = coords(current);
  const when = current.timestamp ? new Date(current.timestamp) : null;
  // Not a live fix (old phone fix, or the rider's last GPS from before the SOS): say how old it is.
  const fixAt = current.location?.at ? new Date(current.location.at) : null;
  const staleText = current.location?.stale
    ? `Last known location${fixAt && !Number.isNaN(fixAt.getTime()) ? ` (${fixAt.toLocaleString()})` : ''}, may be out of date ↗`
    : null;

  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="sos-title" className="fixed inset-0 z-[9999] flex items-center justify-center bg-scrim/50 p-4">
      <div className="bg-danger p-8 sm:p-10 rounded-lg border-4 border-danger/30 max-w-xl w-full text-center">
        <div className="text-6xl mb-4 animate-pulse" aria-hidden></div>
        <h2 id="sos-title" className="text-3xl sm:text-4xl font-semibold text-fg mb-4">Rider SOS</h2>
        {queue.length > 1 && <p className="text-sm font-semibold text-danger-text mb-2">{queue.length} active alerts. Showing the oldest first.</p>}
        <p className="text-xl text-fg font-semibold mb-1">Rider: {current.riderName || 'Unknown rider'}</p>
        {current.riderPhone && <a className="block text-lg text-fg underline mb-1" href={`tel:${current.riderPhone}`}>Call {current.riderPhone}</a>}
        {current.note && <p className="text-base text-fg font-semibold mb-1 break-words">“{String(current.note).slice(0, 200)}”</p>}
        {current.orderId && <p className="text-sm text-fg font-semibold mb-1">Carrying order #{String(current.orderId).slice(-6).toUpperCase()}</p>}
        <p className="text-sm text-danger-text mb-2 font-mono break-all">ID: {current.riderId}{when && !Number.isNaN(when.getTime()) ? ` · ${when.toLocaleString()}` : ''}</p>
        {where && (
          <a className="block text-sm text-fg underline mb-6" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${where.lat},${where.lng}`}>
            {staleText || 'Open location on the map ↗'}
          </a>
        )}
        {error && <p role="alert" className="text-sm font-semibold text-fg bg-surface-2 rounded-xl px-4 py-2 mb-4">{error}</p>}
        <div className="flex flex-col sm:flex-row gap-3 mt-4">
          <button
            onClick={resolve}
            disabled={busy}
            className="flex-1 py-4 bg-white text-danger-text font-semibold text-base rounded-lg hover:bg-danger-soft transition-all disabled:opacity-50"
          >
            {busy ? 'Resolving…' : 'Rider reached · Resolve'}
          </button>
          <button
            onClick={hide}
            disabled={busy}
            className="sm:w-40 py-4 bg-danger-soft text-fg font-semibold text-sm rounded-lg hover:bg-danger-soft transition-all disabled:opacity-50"
          >
            Hide for now
          </button>
        </div>
      </div>
    </div>
  );
}
