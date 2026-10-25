/**
 * Campus Events v2 data: one provider for the home (GET /sections, /clubs, /team-invitations, /status) plus the
 * filter helpers the listing shares with the sample layer. Real events always come first; samples (eventsV2Demo)
 * are added after them while EVENTS_V2_DEMO_CONTENT is on.
 * Modes: live (server on) · off (server switch off: samples + "Events open soon") · offline (saved copy or samples)
 * · signedOut (samples + sign in) · error · loading. Never invents numbers for real events.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ImageSourcePropType } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { readCache, writeCache } from '../../utils/swrCache';
import { campusEventsApi, CampusEventsError, istDate, istYmd, type EventCard, type SectionsResponse, type StatusResponse } from '../campusEvents/campusEventsApi';
import { useCampusEventsStatus } from '../campusEvents/ui';
import { useCampusEventsLive } from '../campusEvents/useCampusEventsLive';
import { demoClubs, demoEvents, EVENTS_V2_DEMO_CONTENT } from './eventsV2Demo';
import { TILE_CATEGORIES, type TileKey } from './eventsV2Theme';
import type { PriceKey, WhenKey } from './eventsV2Nav';

export type EvCard = EventCard & { isDemoContent?: boolean; art?: ImageSourcePropType };
export type Mode = 'loading' | 'live' | 'off' | 'offline' | 'signedOut' | 'error';
export interface ClubItem { id: string; name: string; eventCount: number; verified?: boolean; isDemoContent?: boolean }

interface Ctx {
  mode: Mode;
  status: StatusResponse | null;
  signedIn: boolean;
  /** Real events (deduped from featured, upcoming and the category sections), soonest first. */
  real: EvCard[];
  /** Real first, then samples. */
  all: EvCard[];
  clubs: ClubItem[];
  my: { registrations: number; tickets: number };
  invitations: number;
  isStaff: boolean;
  isOrganizer: boolean;
  needsCampus: boolean;
  errorMsg: string | null;
  reload: () => Promise<void>;
}
const DataCtx = createContext<Ctx | null>(null);
export const useEventsV2 = () => {
  const c = useContext(DataCtx);
  if (!c) throw new Error('useEventsV2 outside EventsV2Provider');
  return c;
};

const byStart = (a: EvCard, b: EvCard) => String(a.startAt || '9').localeCompare(String(b.startAt || '9'));
function flatten(s: SectionsResponse | null): EvCard[] {
  if (!s) return [];
  const m = new Map<string, EvCard>();
  for (const e of [...s.featured, ...s.upcoming, ...s.sections.flatMap((x) => x.events)]) if (!m.has(e.id)) m.set(e.id, e);
  return [...m.values()].sort(byStart);
}

export function EventsV2Provider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const uid = String((user as any)?._id || (user as any)?.id || '');
  const status = useCampusEventsStatus(!!uid);
  const cacheKey = uid ? `campusevents:sections:${uid}` : '';
  const [data, setData] = useState<SectionsResponse | null>(null);
  const [err, setErr] = useState<CampusEventsError | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [clubs, setClubs] = useState<ClubItem[]>([]);
  const [invitations, setInvitations] = useState(0);

  const reload = useCallback(async () => {
    if (!uid) { setLoaded(true); return; }
    try {
      const r = await campusEventsApi.sections();
      setData(r); setErr(null);
      if (cacheKey) writeCache(cacheKey, r);
      campusEventsApi.clubs().then((c) => setClubs(c.clubs.map((x) => ({ id: x.id, name: x.name, eventCount: x.eventCount, verified: x.verified })))).catch(() => {});
    } catch (e: any) {
      setErr(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load events.'));
    } finally {
      setLoaded(true);
    }
    campusEventsApi.invitations().then((r) => setInvitations(r.invitations.length)).catch(() => setInvitations(0));
  }, [uid, cacheKey]);

  useEffect(() => {
    let alive = true;
    if (cacheKey) readCache<SectionsResponse>(cacheKey).then((c) => { if (alive && c?.data && Array.isArray(c.data.upcoming)) setData((cur) => cur || c.data); });
    reload();
    return () => { alive = false; };
  }, [cacheKey, reload]);
  useCampusEventsLive(() => { reload(); }, !!uid);

  const value = useMemo<Ctx>(() => {
    const off = err?.code === 'FEATURE_OFF';
    const offline = !!err && err.isNetwork;
    const mode: Mode = !uid ? 'signedOut' : !loaded && !data ? 'loading' : off ? 'off' : data && !off ? 'live' : offline ? 'offline' : err ? 'error' : 'loading';
    const real = off ? [] : flatten(data);
    const samples = EVENTS_V2_DEMO_CONTENT ? (demoEvents() as EvCard[]) : [];
    const realClubs = off ? [] : clubs;
    return {
      mode, status, signedIn: !!uid, real, all: [...real, ...samples],
      clubs: [...realClubs, ...(EVENTS_V2_DEMO_CONTENT ? demoClubs() : [])],
      my: data?.my || { registrations: 0, tickets: 0 }, invitations,
      isStaff: !!status?.isStaff, isOrganizer: typeof status?.isOrganizer === 'boolean' ? status.isOrganizer : status?.organizer?.status === 'ACTIVE',
      needsCampus: data?.reason === 'CAMPUS_REQUIRED', errorMsg: err?.message || null, reload,
    };
  }, [uid, loaded, data, err, status, clubs, invitations, reload]);

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

// ── Filters (shared by the listing's server query and the samples) ───────────
export interface Filter { q?: string; tile?: TileKey; when?: WhenKey; price?: PriceKey; club?: string }

/** [from, to) ISO for a date filter (India time); null = no bound. */
export function whenRange(when?: WhenKey): { from: string | null; to: string | null } {
  if (!when || when === 'any') return { from: null, to: null };
  const start = (d: string) => new Date(`${d}T00:00:00+05:30`).toISOString();
  const days = when === 'today' ? 1 : when === 'week' ? 7 : 30;
  return { from: new Date().toISOString(), to: start(istDate(days)) };
}

export function matches(e: EvCard, f: Filter): boolean {
  const cats = f.tile ? TILE_CATEGORIES[f.tile] : null;
  if (cats && !cats.includes(e.category)) return false;
  if (f.price === 'free' && !e.price.isFree) return false;
  if (f.price === 'paid' && e.price.isFree) return false;
  if (f.club && e.organizer?.club?.id !== f.club && e.organizer?.name !== f.club) return false;
  const r = whenRange(f.when);
  if (r.to && e.startAt && (e.startAt >= r.to || (e.endAt || e.startAt) < (r.from || ''))) return false;
  const q = (f.q || '').trim().toLowerCase();
  if (q && ![e.title, e.venue, e.organizer?.name, e.organizer?.club?.name, e.categoryLabel, ...(e.tags || [])].some((s) => String(s || '').toLowerCase().includes(q))) return false;
  return true;
}

/** "This week" on the home: events starting in the next 7 days (or still running). */
export const inNextDays = (e: EvCard, days: number) => !!e.startAt && istYmd(e.startAt) < istDate(days);
