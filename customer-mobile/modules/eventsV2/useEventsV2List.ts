/**
 * The listing's data: GET /api/campus-events (browse) with the chosen filters, paged by cursor, plus the matching
 * samples after the real events (demo layer). Clubs for the club filter come from GET /clubs.
 * Real numbers only: everything shown for a real event is what the server sent.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { campusEventsApi, CampusEventsError } from '../campusEvents/campusEventsApi';
import { useCampusEventsLive } from '../campusEvents/useCampusEventsLive';
import { demoClubs, demoEvents, EVENTS_V2_DEMO_CONTENT, isSampleId } from './eventsV2Demo';
import { TILE_CATEGORIES } from './eventsV2Theme';
import { matches, whenRange, type ClubItem, type EvCard, type Filter } from './eventsV2Data';

export function useEventsV2List(f: Filter) {
  const [real, setReal] = useState<EvCard[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [err, setErr] = useState<CampusEventsError | null>(null);
  const [more, setMore] = useState(false);
  const [clubs, setClubs] = useState<ClubItem[]>([]);
  const seq = useRef(0);
  const key = JSON.stringify(f);

  const query = useCallback((after: string | null) => {
    const cats = f.tile ? TILE_CATEGORIES[f.tile] : null;
    const r = whenRange(f.when);
    return campusEventsApi.browse({
      q: f.q?.trim() || null, category: cats ? cats.join(',') : null, from: r.from, to: r.to,
      price: f.price && f.price !== 'any' ? f.price : null, entityId: f.club && !isSampleId(f.club) ? f.club : null,
      cursor: after, limit: 20,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const load = useCallback(async () => {
    const my = ++seq.current;
    // A sample club has no real events: skip the server.
    if (f.club && isSampleId(f.club)) { setReal([]); setCursor(null); setErr(null); return; }
    try {
      const r = await query(null);
      if (my !== seq.current) return;
      setReal(r.events); setCursor(r.nextCursor); setErr(null);
    } catch (e: any) {
      if (my !== seq.current) return;
      setErr(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load events.'));
      setReal((cur) => cur || []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const loadMore = useCallback(async () => {
    if (!cursor || more) return;
    setMore(true);
    try {
      const r = await query(cursor);
      setReal((cur) => [...(cur || []), ...r.events.filter((e) => !(cur || []).some((x) => x.id === e.id))]);
      setCursor(r.nextCursor);
    } catch { /* keep what we have */ } finally { setMore(false); }
  }, [cursor, more, query]);

  useEffect(() => { setReal(null); load(); }, [load]);
  useEffect(() => {
    campusEventsApi.clubs().then((r) => setClubs(r.clubs.map((c) => ({ id: c.id, name: c.name, eventCount: c.eventCount, verified: c.verified })))).catch(() => setClubs([]));
  }, []);
  useCampusEventsLive(() => { load(); });

  const list = useMemo(() => {
    const samples = EVENTS_V2_DEMO_CONTENT ? (demoEvents() as EvCard[]).filter((e) => matches(e, f)) : [];
    return real ? [...real, ...samples] : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, key]);

  const allClubs = useMemo(() => [...clubs, ...(EVENTS_V2_DEMO_CONTENT ? demoClubs() : [])], [clubs]);
  return { list, realCount: real?.length || 0, err, off: err?.code === 'FEATURE_OFF', reload: load, loadMore, loadingMore: more, hasMore: !!cursor, clubs: allClubs };
}
