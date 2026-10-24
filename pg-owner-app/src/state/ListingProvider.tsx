// The PG the owner is working on. Most owners run one PG; with several, the header switcher picks one and the
// choice is remembered. Also holds the owner-view detail of that PG (rooms, mess, photos ...) so every tab
// reads and updates one copy (GET /api/pg-owner/listings/:id; each save returns the fresh detail).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ownerApi } from '../api/ownerApi';
import { errorMessage } from '../lib/http';
import { safeGet, safeSet } from '../lib/storage';
import { STORAGE } from '../config';
import { useSession } from './SessionProvider';
import type { ListingBrief, ListingDetail } from '../types';

interface ListingCtx {
  listings: ListingBrief[];
  current: ListingBrief | null;
  select: (id: string) => void;
  detail: ListingDetail | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Put a fresh detail (from a save reply) in place. */
  setDetail: (d: ListingDetail) => void;
}

const Ctx = createContext<ListingCtx | null>(null);

export function ListingProvider({ children }: { children: React.ReactNode }) {
  const { owner } = useSession();
  const listings = useMemo(() => owner?.listings || [], [owner]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [detail, setDetailState] = useState<ListingDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { safeGet(STORAGE.listing).then((id) => { if (id) setChosen(id); }); }, []);
  const current = listings.find((l) => l.id === chosen) || listings[0] || null;
  const currentId = current?.id || null;
  const select = useCallback((id: string) => { setChosen(id); safeSet(STORAGE.listing, id); }, []);

  const reqId = useRef(0);
  const reload = useCallback(async () => {
    if (!currentId) { setDetailState(null); return; }
    const n = ++reqId.current;
    setLoading(true);
    try {
      const r = await ownerApi.listing(currentId);
      if (n === reqId.current) { setDetailState(r.listing); setError(null); }
    } catch (e) {
      if (n === reqId.current) setError(errorMessage(e));
    } finally {
      if (n === reqId.current) setLoading(false);
    }
  }, [currentId]);
  useEffect(() => {
    setDetailState((d) => (d && d.id === currentId ? d : null));
    reload();
  }, [reload, currentId]);

  const setDetail = useCallback((d: ListingDetail) => { if (d && d.id === currentId) setDetailState(d); }, [currentId]);

  const value = useMemo<ListingCtx>(() => ({ listings, current, select, detail, loading, error, reload, setDetail }),
    [listings, current, select, detail, loading, error, reload, setDetail]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useListing() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useListing outside ListingProvider');
  return v;
}
