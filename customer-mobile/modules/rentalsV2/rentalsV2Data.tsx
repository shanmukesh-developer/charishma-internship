/**
 * Rentals v2 data. One session store shared by every Rentals screen (each route mounts its own provider):
 *   vehicles  GET /api/rentals/listings         real student vehicles (bike / scooter -> Bike, car -> Car)
 *   campus    GET /api/rentals/eligibility      the student's campus (location line) and licence state
 *   rooms     GET /api/pg/home + /api/pg/:id    real PG stays, one room item per room type (PG v2 photos)
 *   samples   rentalsV2Demo.ts                  sample bikes, cars and flats (switchable, tagged "Sample")
 * Real items always come first. Browse only here; requests are sent from the booking sheet.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ImageSourcePropType } from 'react-native';
import { rentalsApi, type Eligibility, type Listing, type RentalsError, FUEL_LABEL } from '../rentals/rentalsApi';
import type { PgDetail, PgListItem, PgRoomType } from '../pg/pgApi';
import { reloadPgV2List, fetchPgDetail, gKey, placeText, roomTypeName } from '../pgV2/pgV2Data';
import { roomPhotos } from '../pgV2/pgV2Photos';
import { DEMO_ITEMS, RENTALS_V2_DEMO_CONTENT, demoArt, type Feature } from './rentalsV2Demo';
import type { Category } from './rentalsV2Theme';
import { apiFetch, readJson } from '../../utils/auth';
import { API_URL } from '../../constants/api';

export type LoadState = 'loading' | 'ready' | 'error';
type Img = ImageSourcePropType | { uri: string };

export interface RItem {
  id: string;
  category: Category;
  tags: string[];
  title: string;
  /** Second line in rows (PG name for rooms). */
  place: string | null;
  price: number | null;
  unit: 'day' | 'hour' | 'week' | 'month';
  priceWeek: number | null;
  priceMonth: number | null;
  deposit: number | null;
  rating: number | null;
  reviews: number;
  specs: string[];
  features: Feature[];
  area: string;
  distanceKm: number | null;
  cut: Img | null;
  photo: Img | null;
  gallery: Img[];
  owner: { name: string; verified: boolean; avatar: string | null } | null;
  about: string;
  fuel: string | null;
  gear: string | null;
  verified: boolean;
  isDemoContent: boolean;
  createdAt: number;
  popularity: number;
  listing?: Listing;
  pgId?: string;
  roomKey?: string;
}

// ── Mapping ──────────────────────────────────────────────────────────────────────────────────────
const SAMPLE = 'sample-';
export const isSampleId = (id: string) => id.startsWith(SAMPLE);

const cap = (s: string) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : s);

export function fromListing(l: Listing): RItem {
  const car = l.vehicleType === 'CAR';
  const fuel = l.fuel ? FUEL_LABEL[l.fuel] : null;
  const gear = l.transmission ? cap(l.transmission) : null;
  const tags: string[] = [];
  if (l.vehicleType === 'SCOOTER') tags.push('scooter');
  const day = l.pricePerDay || (l.pricePerHour ? l.pricePerHour * 24 : 0);
  if (!car && day >= 600) tags.push('premium');
  if (car && day >= 3500) tags.push('luxury');
  const features: Feature[] = car
    ? [l.seats ? { icon: 'seats', label: `${l.seats} seats` } : null, fuel ? { icon: 'fuel', label: fuel } : null, gear ? { icon: 'gauge', label: gear } : null, { icon: 'shield', label: 'Verified listing' }].filter(Boolean) as Feature[]
    : [{ icon: 'helmet', label: l.helmetIncluded ? 'Helmet included' : 'Bring a helmet' }, fuel ? { icon: 'fuel', label: fuel } : null, { icon: 'doc', label: 'RC checked' }, { icon: 'shield', label: 'Verified listing' }].filter(Boolean) as Feature[];
  return {
    id: l.id, category: car ? 'car' : 'bike', tags, title: l.title || [l.make, l.model].filter(Boolean).join(' ') || 'Vehicle',
    place: l.year ? String(l.year) : null,
    price: l.pricePerDay || l.pricePerHour || null, unit: l.pricePerDay ? 'day' : 'hour', priceWeek: null, priceMonth: null,
    deposit: l.securityDeposit || null,
    rating: l.ratingCount > 0 ? l.ratingAvg : null, reviews: l.ratingCount,
    specs: [fuel, gear].filter(Boolean) as string[], features,
    area: l.pickupLocation || 'On campus', distanceKm: null,
    cut: null, photo: l.photos[0] ? { uri: l.photos[0] } : null, gallery: l.photos.map((u) => ({ uri: u })),
    owner: l.owner ? { name: l.owner.name, verified: !!l.owner.verified, avatar: l.owner.avatar } : null,
    about: l.rules || '', fuel, gear, verified: true, isDemoContent: false,
    createdAt: l.createdAt ? Date.parse(l.createdAt) : 0, popularity: l.tripCount * 10 + l.ratingCount, listing: l,
  };
}

const AMENITY_FEATURE = (pg: PgDetail, t: PgRoomType): Feature[] => {
  const has = (re: RegExp) => pg.amenities.some((a) => re.test(a));
  const out: Feature[] = [];
  if (has(/wi-?fi|internet/i)) out.push({ icon: 'wifi', label: 'Wi-Fi' });
  if (t.hasAC) out.push({ icon: 'snow', label: 'AC' });
  out.push({ icon: 'bath', label: t.hasAttachedBathroom ? 'Attached bath' : 'Common bath' });
  if (has(/study|table|desk/i) || t.furnishing) out.push({ icon: 'desk', label: 'Study table' });
  if (out.length < 4 && has(/power|backup|inverter/i)) out.push({ icon: 'power', label: 'Power backup' });
  return out.slice(0, 4);
};

export function fromPgRoom(pg: PgDetail, t: PgRoomType, listItem?: PgListItem): RItem {
  const photos = roomPhotos(pg, t).map((p) => p.source as Img);
  const tags = [t.sharingType <= 1 ? 'single' : 'shared'];
  if (pg.messTimetable || listItem?.hasMess || listItem?.foodIncluded) tags.push('pg');
  const rs = listItem?.reviewSummary || pg.reviewSummary;
  return {
    id: `${pg.id}~${t.key}`, category: 'room', tags,
    title: `${roomTypeName(t.sharingType)} (${gKey(pg.genderType)})`, place: pg.name,
    price: t.rentFrom ?? pg.rentFrom ?? (pg.baseRent || null), unit: 'month', priceWeek: null, priceMonth: null,
    deposit: t.deposit ?? (pg.securityDeposit || null),
    rating: rs && rs.count > 0 && rs.average ? rs.average : null, reviews: rs?.count || 0,
    specs: [t.hasAC ? 'AC' : 'Non-AC', t.hasAttachedBathroom ? 'Attached bath' : 'Common bath'], features: AMENITY_FEATURE(pg, t),
    area: placeText(pg) || 'Near SRM University', distanceKm: Number(pg.distanceFromCollege) > 0 ? Number(pg.distanceFromCollege) : null,
    cut: null, photo: photos[0] || null, gallery: photos,
    owner: pg.contactInfo?.ownerName ? { name: pg.contactInfo.ownerName, verified: false, avatar: null } : null,
    about: pg.description || '', fuel: null, gear: null, verified: !!pg.isVerified, isDemoContent: false,
    createdAt: pg.createdAt ? Date.parse(pg.createdAt) : 0, popularity: (rs?.count || 0) * 2 + (t.availableBeds > 0 ? 1 : 0),
    pgId: pg.id, roomKey: t.key,
  };
}

const DEMO: RItem[] = DEMO_ITEMS.map((d) => {
  const art = demoArt(d.slug);
  return {
    id: SAMPLE + d.slug, category: d.category, tags: d.tags, title: d.title, place: null,
    price: d.price, unit: d.category === 'flat' ? 'month' : 'day', priceWeek: d.priceWeek ?? null, priceMonth: d.priceMonth ?? null,
    deposit: d.deposit, rating: d.rating, reviews: d.reviews, specs: d.specs, features: d.features,
    area: d.area, distanceKm: d.distanceKm, cut: art.cut, photo: art.gallery[0] || art.cut, gallery: art.gallery,
    owner: { name: d.owner, verified: false, avatar: null }, about: d.about, fuel: d.fuel || null, gear: d.gear || null,
    verified: false, isDemoContent: true, createdAt: Date.parse(d.createdAt), popularity: d.reviews * d.rating / 10,
  };
});

// ── Campuses near you (distances computed from coordinates, never typed in) ──────────────────────
export const SRM_AP = { lat: 16.4636, lng: 80.5069 };
export const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};
export const CAMPUSES = [
  { key: 'srm', name: 'SRM University', initials: 'SRM', at: SRM_AP, tint: ['#F6D77A', '#C9A24A'] as const, ink: '#3A2A05' },
  { key: 'vit', name: 'VIT University', initials: 'VIT', at: { lat: 16.4952, lng: 80.5006 }, tint: ['#5B7BD8', '#2B3F8F'] as const, ink: '#FFFFFF' },
  { key: 'amrita', name: 'Amrita University', initials: 'AU', at: { lat: 16.4316, lng: 80.5545 }, tint: ['#E2588C', '#A7285E'] as const, ink: '#FFFFFF' },
].map((c) => ({ ...c, km: haversineKm(SRM_AP, c.at) }));

// ── Store ────────────────────────────────────────────────────────────────────────────────────────
type Snap = {
  vehicles: Listing[]; vState: LoadState; vError: string | null; featureOff: boolean;
  rooms: RItem[]; rState: LoadState; elig: Eligibility | null; saved: Set<string>; recent: string[];
};
let snap: Snap = { vehicles: [], vState: 'loading', vError: null, featureOff: false, rooms: [], rState: 'loading', elig: null, saved: new Set(), recent: [] };
const subs = new Set<(s: Snap) => void>();
const emit = (patch: Partial<Snap>) => { snap = { ...snap, ...patch }; subs.forEach((f) => f(snap)); };
let started = false;
let vInflight: Promise<void> | null = null;
let rInflight: Promise<void> | null = null;

export const reloadVehicles = (): Promise<void> => {
  if (vInflight) return vInflight;
  vInflight = (async () => {
    try {
      const [b, e] = await Promise.all([
        rentalsApi.browse({ sort: 'recent' }).catch((err: RentalsError) => {
          if (err.code === 'FEATURE_OFF') return { listings: [] as Listing[], count: 0, campus: null, off: true };
          throw err;
        }),
        rentalsApi.eligibility().catch(() => null),
      ]);
      emit({ vehicles: b.listings.filter((l) => !l.isMine), vState: 'ready', vError: null, featureOff: !!(b as any).off, elig: e || snap.elig });
    } catch (err: any) {
      // Signed out: no student vehicles to show (browsing needs an account); samples and PG rooms still show.
      emit({ vState: snap.vehicles.length || err?.status === 401 ? 'ready' : 'error', vError: err?.status === 401 ? 'signin' : err?.code === 'NETWORK' ? 'offline' : 'server' });
    } finally {
      vInflight = null;
    }
  })();
  return vInflight;
};

export const reloadRooms = (): Promise<void> => {
  if (rInflight) return rInflight;
  rInflight = (async () => {
    try {
      await reloadPgV2List({ silent: true });
      const res = await apiFetch(`${API_URL}/api/pg/home`);
      const data = await readJson(res);
      const list: PgListItem[] = res.ok && data && Array.isArray(data.pgs) ? data.pgs : [];
      const details = await Promise.all(list.slice(0, 10).map((p) => fetchPgDetail(p.id)));
      const rooms: RItem[] = [];
      details.forEach((d, i) => {
        if (!d) return;
        (d.roomTypes || []).filter((t) => t.rentFrom !== null || d.rentFrom).slice(0, 3).forEach((t) => rooms.push(fromPgRoom(d, t, list[i])));
      });
      emit({ rooms, rState: rooms.length || res.ok ? 'ready' : 'error' });
    } catch {
      emit({ rState: snap.rooms.length ? 'ready' : 'error' });
    } finally {
      rInflight = null;
    }
  })();
  return rInflight;
};

export const reloadAll = () => Promise.all([reloadVehicles(), reloadRooms()]);

interface Store {
  items: RItem[];
  byCategory: (c: Category) => RItem[];
  find: (id: string) => RItem | null;
  vState: LoadState;
  vError: string | null;
  rState: LoadState;
  featureOff: boolean;
  elig: Eligibility | null;
  campusLine: string;
  saved: Set<string>;
  toggleSaved: (id: string) => void;
  recent: string[];
  addRecent: (q: string) => void;
  reload: () => void;
}
const Ctx = createContext<Store | null>(null);

export function RentalsV2Provider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<Snap>(snap);
  useEffect(() => {
    subs.add(setS);
    setS(snap);
    if (!started) { started = true; reloadAll(); }
    return () => { subs.delete(setS); };
  }, []);
  const toggleSaved = useCallback((id: string) => {
    const next = new Set(snap.saved);
    if (next.has(id)) next.delete(id); else next.add(id);
    emit({ saved: next });
  }, []);
  const addRecent = useCallback((q: string) => {
    const v = q.trim();
    if (v) emit({ recent: [v, ...snap.recent.filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, 6) });
  }, []);
  const value = useMemo<Store>(() => {
    const real = [...s.vehicles.map(fromListing), ...s.rooms];
    const items = [...real, ...(RENTALS_V2_DEMO_CONTENT ? DEMO : [])];
    const campus = s.elig?.campus?.name;
    return {
      items,
      byCategory: (c) => items.filter((i) => i.category === c),
      find: (id) => items.find((i) => i.id === id) || null,
      vState: s.vState, vError: s.vError, rState: s.rState, featureOff: s.featureOff, elig: s.elig,
      campusLine: campus ? (/mangalagiri|amaravati/i.test(campus) ? campus : `${campus}, Mangalagiri`) : 'SRM AP, Amaravati',
      saved: s.saved, toggleSaved, recent: s.recent, addRecent,
      reload: () => { reloadAll(); },
    };
  }, [s, toggleSaved, addRecent]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useRentalsV2 = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRentalsV2 outside RentalsV2Provider');
  return v;
};

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────
export const inr = (n: number | null | undefined) => (Number.isFinite(Number(n)) && n !== null ? `₹${Math.round(Number(n)).toLocaleString('en-IN')}` : '');
export const unitText = (u: RItem['unit']) => (u === 'month' ? '/month' : u === 'week' ? '/week' : u === 'hour' ? '/hr' : '/day');
export const kmText = (km: number | null | undefined) => {
  const v = Number(km);
  if (!Number.isFinite(v) || v <= 0) return '';
  return v < 1 ? `${Math.round(v * 1000)} m` : `${v.toFixed(1)} km`;
};

/** Search across every item: title, place, area, specs, category words. */
export const searchItems = (items: RItem[], q: string) => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  const CAT: Record<Category, string> = { bike: 'bike bikes scooter scooty motorcycle two wheeler', car: 'car cars suv sedan hatchback', room: 'room rooms pg hostel single shared', flat: 'flat flats apartment house 1bhk 2bhk' };
  return items.filter((i) => {
    const hay = `${i.title} ${i.place || ''} ${i.area} ${i.specs.join(' ')} ${i.tags.join(' ')} ${CAT[i.category]}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
};

/** Popular this week: real first (trips / reviews), then samples by reviews; mixes categories like the board. */
export const popularItems = (items: RItem[], n = 8) => {
  const real = items.filter((i) => !i.isDemoContent).sort((a, b) => b.popularity - a.popularity || b.createdAt - a.createdAt);
  const demo = items.filter((i) => i.isDemoContent).sort((a, b) => b.popularity - a.popularity);
  const order: Category[] = ['bike', 'car', 'room', 'flat'];
  const pool = [...real, ...demo];
  const out: RItem[] = [];
  while (out.length < n && pool.length) {
    const want = order[out.length % order.length];
    const idx = pool.findIndex((i) => i.category === want);
    out.push(pool.splice(idx >= 0 ? idx : 0, 1)[0]);
  }
  return out;
};

/** "From ₹99/day" for a category (lowest price among its items), '' when none. */
export const fromPrice = (items: RItem[], c: Category) => {
  const list = items.filter((i) => i.category === c && i.price);
  if (!list.length) return '';
  const min = list.reduce((a, b) => ((b.price || 0) < (a.price || 0) ? b : a));
  return `From ${inr(min.price)}${unitText(min.unit)}`;
};
