/**
 * Deals & spin v2 data: one small shared store (module level, so the Others home and the /deals/* routes see the
 * same numbers without re-downloading). Everything money-like is real and read-only here:
 *   GET /api/rewards/spin-eligibility  spinsAvailable, nextMilestoneIn, completedOrders, spinsUsed, prizes (server table)
 *   GET /api/rewards/coupons           the student's usable coupons (unused and not expired; server labels)
 *   GET /api/vault                     today's deals (claiming gives a real coupon; see claimDeal)
 * ZenPoints, wallet balance, streak and referral code come from the signed-in user (AuthContext).
 * The real spin rule (backend/controllers/rewardController.js): spins = floor(delivered orders / 2) - spins used.
 * Writes (use-spin, vault claim) live in useSpin / claimDeal and only run on a tap by the student.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '../../context/AuthContext';
import { API_URL, ENDPOINTS } from '../../constants/api';
import { apiFetch, readJson } from '../../utils/auth';

export type Prize = { label: string; display?: string; type?: string; value?: number | string };
export type Coupon = {
  id?: string; code: string; type: 'FREEDEL' | 'DISCOUNT' | string; value?: number; label?: string;
  expiryDate?: string | null; expiresInDays?: number | null; minOrderValue?: number | null;
  restaurantId?: string | null; menuItemId?: string | null; vaultItemId?: string | null; createdAt?: string;
};
export type Elig = { completedOrders: number; spinsUsed: number; spinsAvailable: number; nextMilestoneIn: number | null; prizes: Prize[] };
export type Status = 'idle' | 'loading' | 'ready' | 'error' | 'offline';

/** Display mirror of the server's 8-sector prize table (same order as SPIN_PRIZES), only to draw the wheel
 *  before the live table arrives (signed out, first frame). The server always picks the prize. */
export const PRIZE_MIRROR: Prize[] = [
  { label: 'FREE DEL', display: 'Free delivery', type: 'coupon' }, { label: '10 ZEN', type: 'points' }, { label: '20 ZEN', type: 'points' },
  { label: '5 ZEN', type: 'points' }, { label: '50 ZEN', type: 'points' }, { label: '100 ZEN', type: 'points' },
  { label: '5 ZEN', type: 'points' }, { label: '2 ZEN', type: 'points' },
];
/** The real rule, used in copy everywhere. */
export const ORDERS_PER_SPIN = 2;

interface State {
  uid: string;
  rewards: Status;
  elig: Elig | null;
  coupons: Coupon[];
  vault: Status;
  deals: any[];
  at: number;
}
let state: State = { uid: '', rewards: 'idle', elig: null, coupons: [], vault: 'idle', deals: [], at: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snap = () => state;

/** "10 ZenPoints 💎" -> "10 ZenPoints". */
export const stripEmoji = (t: string) => String(t || '').replace(/[\uD800-\uDFFF☀-➿️]/g, '').replace(/\s+/g, ' ').trim();
const isNetwork = (e: any) => e instanceof TypeError || /network|fetch|internet/i.test(String(e?.message || ''));

let inflight: Promise<void> | null = null;
async function loadRewards(uid: string) {
  if (!uid) { set({ rewards: 'ready', elig: null, coupons: [] }); return; }
  if (inflight) return inflight;
  set({ rewards: state.rewards === 'ready' && state.uid === uid ? 'ready' : 'loading' });
  inflight = (async () => {
    try {
      const [eRes, cRes] = await Promise.all([apiFetch(`${API_URL}/api/rewards/spin-eligibility`), apiFetch(`${API_URL}/api/rewards/coupons`)]);
      const e = await readJson(eRes);
      const c = await readJson(cRes);
      if (state.uid !== uid) return;
      if (!eRes.ok && !cRes.ok) throw new Error('rewards unavailable');
      const elig: Elig | null = eRes.ok && e ? {
        completedOrders: Number(e.completedOrders) || 0,
        spinsUsed: Number(e.spinsUsed) || 0,
        spinsAvailable: Math.max(0, Number(e.spinsAvailable) || 0),
        nextMilestoneIn: Number.isFinite(Number(e.nextMilestoneIn)) ? Number(e.nextMilestoneIn) : null,
        prizes: Array.isArray(e.prizes) ? e.prizes : [],
      } : state.elig;
      set({ elig, coupons: cRes.ok && Array.isArray(c) ? c : state.coupons, rewards: 'ready', at: Date.now() });
    } catch (err) {
      if (state.uid !== uid) return;
      // Keep what is on screen; only an empty screen shows the error / offline state.
      if (state.rewards !== 'ready') set({ rewards: isNetwork(err) ? 'offline' : 'error' });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function loadVault() {
  if (state.vault !== 'ready') set({ vault: 'loading' });
  try {
    const res = await apiFetch(ENDPOINTS.vaultList);
    const data = await readJson(res);
    if (!res.ok) throw new Error('vault');
    set({ deals: Array.isArray(data) ? data : [], vault: 'ready' });
  } catch (err) {
    if (state.vault !== 'ready') set({ vault: isNetwork(err) ? 'offline' : 'error' });
  }
}

/** Shared Deals data for the signed-in student (or signed-out: deals + the wheel only). */
export function useDeals() {
  const { user, refreshUser } = useAuth();
  const uid = String((user as any)?._id || (user as any)?.id || '');
  const s = useSyncExternalStore(subscribe, snap, snap);
  const reload = useCallback(async () => {
    await Promise.all([loadRewards(uid), loadVault(), uid ? refreshUser?.().catch?.(() => {}) : null]);
  }, [uid, refreshUser]);
  useEffect(() => {
    // A different account (or sign-out) must never see the previous student's spins or coupons.
    if (state.uid !== uid) set({ uid, rewards: 'idle', elig: null, coupons: [], at: 0 });
    // Fresh enough (30 s) when another Deals screen just loaded it.
    if (state.rewards === 'idle' || Date.now() - state.at > 30000) loadRewards(uid);
    if (state.vault === 'idle' || state.vault === 'error' || state.vault === 'offline') loadVault();
  }, [uid]);
  // Until the store has switched to this account, show nothing account-specific.
  const cur: State = s.uid === uid ? s : { ...s, uid, rewards: uid ? 'loading' : 'ready', elig: null, coupons: [] };
  const u: any = user || {};
  return {
    uid,
    signedIn: !!uid,
    user: u,
    status: cur.rewards,
    elig: cur.elig,
    spinsLeft: cur.elig?.spinsAvailable ?? 0,
    nextIn: cur.elig?.nextMilestoneIn ?? null,
    prizes: cur.elig?.prizes?.length ? cur.elig.prizes : PRIZE_MIRROR,
    livePrizes: !!cur.elig?.prizes?.length,
    coupons: cur.coupons,
    vaultStatus: cur.vault,
    deals: cur.deals,
    zenPoints: Number(u.zenPoints) || 0,
    wallet: Number(u.walletBalance) || 0,
    streak: Number(u.streakCount) || 0,
    referralCode: u.referralCode ? String(u.referralCode) : '',
    reload,
  };
}
export type DealsData = ReturnType<typeof useDeals>;

/** After a spin or a claim: patch what the server returned, then refresh. */
export function patchAfterSpin(p: { spinsAvailable?: number; spinsUsed?: number }) {
  if (!state.elig) return;
  set({ elig: { ...state.elig, spinsAvailable: Math.max(0, Number(p.spinsAvailable) || 0), spinsUsed: Number(p.spinsUsed) || state.elig.spinsUsed } });
}
export const refreshRewards = () => loadRewards(state.uid);
export const refreshVault = () => loadVault();

/** What a daily deal's coupon is worth, the way the server builds it (routes/vaultRoutes claim). */
export const dealTag = (item: any): string | null => {
  if (/free\s*delivery/i.test(String(item?.name || ''))) return 'Free delivery';
  const value = Math.max(0, (Number(item?.originalPrice) || 0) - (Number(item?.price) || 0));
  return value > 0 ? `₹${Math.round(value)} off` : null;
};
/** Minimum order for a coupon claimed from this deal (routes/vaultRoutes.js vaultMinOrder). */
export const dealMinOrder = (item: any): number => {
  const own = Number(item?.minOrderValue);
  if (Number.isFinite(own) && own > 0) return Math.round(own);
  const mrp = Number(item?.originalPrice);
  return Number.isFinite(mrp) && mrp > 0 ? Math.round(mrp) : 0;
};
/** Coupon headline: the server's label ("Free delivery", "₹50 off"), as a title ("Flat ₹50 off"). */
export const couponTitle = (c: Coupon) => {
  if (c.type === 'FREEDEL') return 'Free delivery';
  const v = Number(c.value) || 0;
  return v > 0 ? `Flat ₹${Math.round(v)} off` : (c.label || 'Coupon');
};
export const couponMin = (c: Coupon) => (Number(c.minOrderValue) > 0 ? Math.round(Number(c.minOrderValue)) : 0);
