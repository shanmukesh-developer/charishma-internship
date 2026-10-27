// Rider jobs that are not delivery orders: shopping lists (Mega Basket) and service pickups (laundry, tailoring,
// repairs). The server announces them to on-duty riders (socket 'rider_job' + push NEW_JOB, backend
// utils/riderJobs); this store keeps the open pool and the rider's own jobs fresh (socket events, pushes,
// app resume, a poll while on duty) and runs the claim / step actions. Screens use useJobs().
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { errorMessage } from '../services/apiClient';
import * as jobs from '../services/jobsApi';
import * as sock from '../services/socket';
import * as push from '../services/notifications';
import { POLL_ORDERS_MS } from '../config';
import { useRider } from './RiderStore';
import { useAppActive, useInterval } from './hooks';
import type { JobKind, RiderBasket, RiderService } from '../services/jobsApi';

export type OpenJob = { kind: JobKind; id: string } | null;

interface JobsContextValue {
  basketPool: RiderBasket[];
  servicePool: RiderService[];
  myBaskets: RiderBasket[];
  myServices: RiderService[];
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  openJob: OpenJob;
  setOpenJob: (j: OpenJob) => void;
  claim: (kind: JobKind, id: string) => Promise<boolean>;
  /** Runs one server step for a job, then refreshes. Shows the server's message on failure. */
  step: (fn: () => Promise<unknown>, okText?: string) => Promise<boolean>;
}

const Ctx = createContext<JobsContextValue | null>(null);

export function useJobs(): JobsContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useJobs outside JobsProvider');
  return v;
}

const JOB_PUSH_TYPES = ['NEW_JOB', 'JOB_UPDATE'];

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const r = useRider();
  const appActive = useAppActive();
  const inMain = r.phase === 'main';
  const approved = !!r.profile?.isApproved;
  const [basketPool, setBasketPool] = useState<RiderBasket[]>([]);
  const [servicePool, setServicePool] = useState<RiderService[]>([]);
  const [myBaskets, setMyBaskets] = useState<RiderBasket[]>([]);
  const [myServices, setMyServices] = useState<RiderService[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openJob, setOpenJob] = useState<OpenJob>(null);
  const seq = useRef(0);
  const onlineRef = useRef(r.isOnline);
  onlineRef.current = r.isOnline;
  const connectedRef = useRef(r.connected);
  connectedRef.current = r.connected;
  const toastRef = useRef(r.showToast);
  toastRef.current = r.showToast;

  const refresh = useCallback(async () => {
    if (!inMain || !approved) return;
    const mySeq = ++seq.current;
    const online = onlineRef.current;
    // An older server without these endpoints answers 404: treat as "no jobs", never as an error banner.
    const safe = async <T,>(p: Promise<T[]>): Promise<T[] | null> => {
      try {
        return await p;
      } catch (e: any) {
        if (e && e.status === 404) return [];
        throw e;
      }
    };
    try {
      const [mb, ms, pb, ps] = await Promise.all([
        safe(jobs.fetchMyBaskets()),
        safe(jobs.fetchMyServices()),
        online ? safe(jobs.fetchBasketPool()) : Promise.resolve([] as RiderBasket[]),
        online ? safe(jobs.fetchServicePool()) : Promise.resolve([] as RiderService[]),
      ]);
      if (mySeq !== seq.current) return;
      setMyBaskets(mb ?? []);
      setMyServices(ms ?? []);
      setBasketPool(pb ?? []);
      setServicePool(ps ?? []);
      setError(null);
      setLoaded(true);
    } catch (e) {
      if (mySeq !== seq.current) return;
      setError(errorMessage(e));
      setLoaded(true);
    }
  }, [inMain, approved]);

  const refreshSoon = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kick = useCallback(() => {
    if (refreshSoon.current) clearTimeout(refreshSoon.current);
    refreshSoon.current = setTimeout(() => {
      refreshSoon.current = null;
      refresh();
    }, 400);
  }, [refresh]);

  useEffect(() => {
    if (!inMain) {
      setBasketPool([]);
      setServicePool([]);
      setMyBaskets([]);
      setMyServices([]);
      setLoaded(false);
      setOpenJob(null);
      return;
    }
    refresh();
  }, [inMain, r.isOnline, refresh]);

  useEffect(() => {
    if (appActive) refresh();
  }, [appActive, refresh]);

  // Socket: pool changed / one of my jobs changed / reconnected (missed events are not replayed).
  useEffect(() => sock.onRiderJob(() => kick()), [kick]);

  // Push while the app runs (the tray / sound is the push itself).
  useEffect(() => {
    if (!inMain) return;
    return push.onPushReceived((data) => {
      if (JOB_PUSH_TYPES.includes(String(data?.type ?? ''))) kick();
    });
  }, [inMain, kick]);

  const hasMine = myBaskets.length + myServices.length > 0;
  useInterval(() => {
    if (appActive && inMain && (r.isOnline || hasMine)) refresh();
  }, POLL_ORDERS_MS * 2);

  const step = useCallback(
    async (fn: () => Promise<unknown>, okText?: string) => {
      if (!connectedRef.current) {
        toastRef.current('Needs internet.', 'error');
        return false;
      }
      try {
        await fn();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (okText) toastRef.current(okText, 'success');
        return true;
      } catch (e) {
        toastRef.current(errorMessage(e), 'error');
        return false;
      } finally {
        await refresh();
      }
    },
    [refresh],
  );

  const claim = useCallback(
    async (kind: JobKind, id: string) => {
      const ok = await step(() => (kind === 'basket' ? jobs.claimBasket(id) : jobs.claimService(id)), kind === 'basket' ? 'Shopping list is yours' : 'Pickup is yours');
      if (ok) setOpenJob({ kind, id });
      return ok;
    },
    [step],
  );

  // A job that is no longer mine (finished, cancelled, moved) closes its screen.
  useEffect(() => {
    if (!openJob || !loaded) return;
    const still = openJob.kind === 'basket' ? myBaskets.some((b) => b.id === openJob.id) : myServices.some((s) => s.id === openJob.id);
    if (!still) setOpenJob(null);
  }, [openJob, loaded, myBaskets, myServices]);

  const value = useMemo<JobsContextValue>(
    () => ({ basketPool, servicePool, myBaskets, myServices, loaded, error, refresh, openJob, setOpenJob, claim, step }),
    [basketPool, servicePool, myBaskets, myServices, loaded, error, refresh, openJob, claim, step],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
