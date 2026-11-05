/**
 * Tech & repairs v2 data. Everything shown comes from the real catalogue:
 *   GET /api/catalogue/items?type=<shelf>&includeUnavailable=true   (repairs, tailoring, laundry: booking-only services;
 *                                                                    mattresses, electronics: campus store products)
 *   GET /api/catalogue/min-prices?types=...                          ("From ₹X" on the home tiles)
 * Same cache keys as the old category pages (`catalogue:<shelf>:all`), so a shelf opened before paints at once.
 * Prices, stock, store hours and photos are the server's. The server sends no ratings for these items, so none
 * are shown. Filter chips are worked out from the real item names / booking forms; a chip with no items is left out.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL } from '../../constants/api';
import { apiFetch } from '../../utils/auth';
import { peekCache, readCache, writeCache, useCollegeEpoch, getCollegeEpoch } from '../../utils/swrCache';
import { useLiveSync } from '../../utils/useLiveSync';
import { formatINR } from '../../utils/format';
import { takesSlotOrders } from '../../utils/storeOpenNow';
import { resolveServiceForm } from '../services/serviceForms';
import { TAILOR_GROUPS, deviceOfForm, groupItems, servicePriceLabel } from '../services/serviceFlow';

export type ShelfId = 'repairs' | 'tailoring' | 'laundry' | 'mattresses' | 'electronics';
export type ServiceShelf = 'repairs' | 'tailoring' | 'laundry';
export type ProductShelf = 'mattresses' | 'electronics';
export const SERVICE_SHELVES: ServiceShelf[] = ['repairs', 'tailoring', 'laundry'];
export const PRODUCT_SHELVES: ProductShelf[] = ['mattresses', 'electronics'];
export const ALL_SHELVES: ShelfId[] = ['repairs', 'tailoring', 'laundry', 'mattresses', 'electronics'];
export const isServiceShelf = (s: string): s is ServiceShelf => (SERVICE_SHELVES as string[]).includes(s);
export const isProductShelf = (s: string): s is ProductShelf => (PRODUCT_SHELVES as string[]).includes(s);

export interface ShelfItem {
  id: string;
  name: string;
  price: number;
  /** Store products only: the server's struck-through price, when higher than the price. */
  originalPrice: number | null;
  desc: string;
  image: string | null;
  /** In stock / taking bookings. */
  inStock: boolean;
  /** Server `orderable`: in stock and the store is open now (products). */
  orderable: boolean;
  storeName: string;
  storeId: string;
  restaurantId: string;
  category: string;
  bookingOnly: boolean;
  /** Admin-set (or automatic weight) choices from the server: components/ProductOptions. */
  options?: any[];
  /** Only when the server sends a real rating with reviews behind it. */
  rating: number | null;
  ratingCount: number;
}

export interface ShelfStore {
  id: string; name: string; isOpen: boolean; opensAt: string | null; closedReason: string | null; campusClosed: boolean; fssaiLicenseNumber: string | null;
  /** Delivery slots: closed now, but orders go to its next delivery slot (server takesSlotOrders). */
  takesSlotOrders: boolean;
}
/** Can a store's items be added now (open, or taking orders for its next delivery slot)? */
export const storeTakesOrders = (st: ShelfStore | undefined): boolean => !st || st.isOpen || st.takesSlotOrders;

export type LoadStatus = 'loading' | 'ready' | 'error' | 'offline' | 'waking';

/** Copy for each shelf. Every line restates what the booking flow and forms already promise (serviceForms.ts). */
export const SHELF_META: Record<ShelfId, { title: string; tile: string; tileSub: string; heroTitle: string; heroLine: string; minKey: string }> = {
  repairs: {
    title: 'Laptop & phone repairs', tile: 'Laptop & phone repairs', tileSub: 'Screens and upgrades',
    heroTitle: 'Laptop and phone repairs', heroLine: 'A technician checks your device and confirms the price before any work.', minKey: 'repairs',
  },
  tailoring: {
    title: 'Tailoring & stitching', tile: 'Tailoring', tileSub: 'Alter, stitch, fix',
    heroTitle: 'Tailoring and stitching', heroLine: 'Alterations, new stitching and fixes. The tailor confirms the price first.', minKey: 'tailoring',
  },
  laundry: {
    title: 'Laundry & dry cleaning', tile: 'Laundry', tileSub: 'Wash and dry clean',
    heroTitle: 'Wash, dry clean and ironing', heroLine: 'Collected from your room. The partner confirms the final price at pickup.', minKey: 'laundry',
  },
  mattresses: {
    title: 'Room essentials', tile: 'Room essentials', tileSub: 'Bedding and room gear',
    heroTitle: 'Room essentials', heroLine: 'Mattresses, bedding, buckets and racks from the campus store.', minKey: 'home',
  },
  electronics: {
    title: 'Chargers & gadgets', tile: 'Chargers & gadgets', tileSub: 'Chargers, audio, study gear',
    heroTitle: 'Chargers and gadgets', heroLine: 'Chargers, cables, power banks, audio and study gear from the campus store.', minKey: 'electronics',
  },
};

/** Three facts per service shelf, taken from the current booking flow (ServicesHome TRUST, serviceForms how-it-works). */
export type TrustIcon = 'house' | 'tag' | 'cash' | 'ruler' | 'clipboard';
export const SHELF_TRUST: Record<ServiceShelf, { icon: TrustIcon; text: string }[]> = {
  repairs: [{ icon: 'house', text: 'Doorstep pickup' }, { icon: 'tag', text: 'Quote before work' }, { icon: 'cash', text: 'Pay after repair' }],
  tailoring: [{ icon: 'ruler', text: 'Measured at hostel' }, { icon: 'tag', text: 'Quote before work' }, { icon: 'cash', text: 'Cash on delivery' }],
  laundry: [{ icon: 'house', text: 'Room pickup' }, { icon: 'clipboard', text: 'Weighed at pickup' }, { icon: 'cash', text: 'Pay on delivery' }],
};

const toItem = (it: any): ShelfItem => {
  const price = Number(it.price) || 0;
  const original = Number(it.originalPrice) || 0;
  const rating = Number(it.rating);
  const ratingCount = Number(it.ratingCount) || 0;
  return {
    id: String(it.id || it._id),
    name: String(it.name || ''),
    price,
    originalPrice: original > price ? original : null,
    desc: String(it.description || ''),
    image: it.imageUrl || it.image || null,
    inStock: it.isAvailable !== false,
    orderable: it.orderable !== false && it.isAvailable !== false,
    storeName: String(it.storeName || ''),
    storeId: String(it.storeId || it.restaurantId || ''),
    restaurantId: String(it.restaurantId || it.storeId || ''),
    category: String(it.category || ''),
    bookingOnly: !!it.bookingOnly,
    rating: Number.isFinite(rating) && rating > 0 && ratingCount > 0 ? rating : null,
    ratingCount,
    ...(Array.isArray(it.options) && it.options.length ? { options: it.options } : {}),
  };
};

const toStores = (data: any): Record<string, ShelfStore> => {
  const out: Record<string, ShelfStore> = {};
  (Array.isArray(data?.stores) ? data.stores : []).forEach((st: any) => {
    const id = String(st?.id || st?._id || '');
    if (id) out[id] = { id, name: String(st.name || ''), isOpen: st.isOpen !== false, opensAt: typeof st.opensAt === 'string' ? st.opensAt : null, closedReason: st.closedReason || null, campusClosed: !!st.campusClosed, takesSlotOrders: takesSlotOrders(st), fssaiLicenseNumber: typeof st.fssaiLicenseNumber === 'string' && st.fssaiLicenseNumber.trim() ? st.fssaiLicenseNumber.trim() : null };
  });
  return out;
};

const cacheKey = (shelf: ShelfId) => `catalogue:${shelf}:all`;

/** One shelf of the real catalogue: cached first paint, then the network; live admin / store edits refresh it in place. */
export function useShelf(shelf: ShelfId) {
  const first = peekCache<any>(cacheKey(shelf));
  const [items, setItems] = useState<ShelfItem[]>(() => (first && Array.isArray(first.items) ? first.items.map(toItem) : []));
  const [stores, setStores] = useState<Record<string, ShelfStore>>(() => (first ? toStores(first) : {}));
  const [status, setStatus] = useState<LoadStatus>(first ? 'ready' : 'loading');
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const hasData = useRef(!!first);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const apply = useCallback((data: any) => {
    setItems((Array.isArray(data?.items) ? data.items : []).map(toItem));
    setStores(toStores(data));
    hasData.current = true;
    setStatus('ready');
  }, []);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    if (mode === 'initial' && !hasData.current) {
      const cached = await readCache<any>(cacheKey(shelf));
      if (cached?.data && Array.isArray(cached.data.items) && mounted.current) apply(cached.data);
    }
    if (mode === 'refresh') setRefreshing(true);
    const requestEpoch = getCollegeEpoch();
    try {
      const res = await apiFetch(`${API_URL}/api/catalogue/items?type=${encodeURIComponent(shelf)}&includeUnavailable=true`);
      const data = await res.json().catch(() => null);
      // Unmounted, or the student changed college while this was on its way (the other college's shelf).
      if (!mounted.current || requestEpoch !== getCollegeEpoch()) return;
      if (!res.ok || !data || !Array.isArray(data.items)) {
        if (!hasData.current) {
          setStatus(res.status >= 502 && res.status <= 504 ? 'waking' : 'error');
          setMessage((data && typeof data.message === 'string' && data.message) || null);
        }
        return;
      }
      apply(data);
      writeCache(cacheKey(shelf), data);
      setMessage(null);
    } catch {
      if (mounted.current && !hasData.current) setStatus('offline');
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [shelf, apply]);

  useEffect(() => { load('initial'); }, [load]);
  // The student changed college: this shelf shows that college's stores (quietly, the current shelf stays meanwhile).
  const collegeEpoch = useCollegeEpoch();
  const epochAtMount = useRef(collegeEpoch);
  useEffect(() => {
    if (collegeEpoch === epochAtMount.current) return;
    epochAtMount.current = collegeEpoch;
    load('silent');
  }, [collegeEpoch, load]);
  useLiveSync({ types: ['store', 'product'], onChange: () => { load('silent'); } });

  const retry = useCallback(() => { setStatus('loading'); load('initial'); }, [load]);
  return { items, stores, status, message, refreshing, reload: load, retry };
}

/** "From ₹X" per home tile, from GET /api/catalogue/min-prices (the same call the old Others tab made). */
export function useMinPrices() {
  const key = 'servicesV2:minPrices';
  const [prices, setPrices] = useState<Record<string, number>>(() => peekCache<Record<string, number>>(key) || {});
  // Prices are per college (only its stores count): asked again when the student changes college.
  const collegeEpoch = useCollegeEpoch();
  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await readCache<Record<string, number>>(key);
      if (cached?.data && alive) setPrices(cached.data);
      try {
        const types = ALL_SHELVES.map((s) => SHELF_META[s].minKey).join(',');
        const res = await apiFetch(`${API_URL}/api/catalogue/min-prices?types=${encodeURIComponent(types)}`);
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (!alive || !data || typeof data !== 'object' || Array.isArray(data)) return;
        const clean = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Number(v)]).filter(([, v]) => Number.isFinite(v as number) && (v as number) > 0)) as Record<string, number>;
        setPrices(clean);
        writeCache(key, clean);
      } catch {
        // Tiles simply show no price line.
      }
    })();
    return () => { alive = false; };
  }, [collegeEpoch]);
  return prices;
}

// ── Prices ──────────────────────────────────────────────────────────────────────────────────

/** "From ₹2,999", "₹99 inspection", "₹59 per kg" for a service; "₹449" for a product. */
export function priceLine(shelf: ShelfId, item: Pick<ShelfItem, 'name' | 'price'>): { main: string; note: string | null } {
  if (isProductShelf(shelf)) return { main: formatINR(item.price), note: null };
  return servicePriceLabel(shelf, item);
}

/** The label over the price on the detail page ("Starting price", "Inspection charge", "Estimate"). */
export const priceCaption = (shelf: ServiceShelf, name: string) => resolveServiceForm(shelf, name).priceLabel;

// ── Filter chips ────────────────────────────────────────────────────────────────────────────

export interface Chip { key: string; label: string; test: (i: ShelfItem) => boolean }

const formId = (shelf: ServiceShelf, i: ShelfItem) => resolveServiceForm(shelf, i.name).id;

const CHIP_DEFS: Record<ShelfId, Chip[]> = {
  repairs: [
    { key: 'laptop', label: 'Laptop', test: (i) => deviceOfForm(resolveServiceForm('repairs', i.name)) === 'Laptop' },
    { key: 'phone', label: 'Phone', test: (i) => deviceOfForm(resolveServiceForm('repairs', i.name)) === 'Phone' },
    { key: 'checkup', label: 'Check-up', test: (i) => formId('repairs', i) === 'repairs.diagnosis' },
  ],
  tailoring: TAILOR_GROUPS.map((g) => ({ key: g.id, label: g.label, test: (i: ShelfItem) => groupItems(g, 'tailoring', [i]).length > 0 })),
  laundry: [
    { key: 'wash', label: 'Wash', test: (i) => formId('laundry', i) === 'laundry.wash' && !(/iron|press/i.test(i.name) && !/wash/i.test(i.name)) },
    { key: 'dryclean', label: 'Dry cleaning', test: (i) => formId('laundry', i) === 'laundry.dryClean' },
    { key: 'ironing', label: 'Ironing', test: (i) => /iron|press/i.test(i.name) && !/wash/i.test(i.name) },
    { key: 'bedding', label: 'Bedding', test: (i) => formId('laundry', i) === 'laundry.blanket' || /bedsheet|blanket|quilt/i.test(i.name) },
    { key: 'shoes', label: 'Shoes', test: (i) => formId('laundry', i) === 'laundry.shoes' },
  ],
  mattresses: [
    { key: 'bedding', label: 'Bedding', test: (i) => /mattress|pillow|bedsheet|topper|mosquito|net\b|bed\b/i.test(i.name) },
    { key: 'storage', label: 'Laundry & storage', test: (i) => /bucket|rack|hanger|basket|mug/i.test(i.name) },
  ],
  electronics: [
    { key: 'power', label: 'Chargers & power', test: (i) => /charg|cable|power\s*bank|extension|socket|hub|adapter/i.test(i.name) },
    { key: 'audio', label: 'Audio', test: (i) => /headphone|earbud|speaker|audio|rockerz/i.test(i.name) },
    { key: 'study', label: 'Study & desk', test: (i) => /lamp|calculator|keyboard|mouse|stand/i.test(i.name) },
  ],
};

/** "All" plus the chips that have at least one item on the shelf right now. */
export function chipsFor(shelf: ShelfId, items: ShelfItem[]): Chip[] {
  const all: Chip = { key: 'all', label: 'All', test: () => true };
  return [all, ...CHIP_DEFS[shelf].filter((c) => items.some(c.test))];
}

/** Text match used by the list search and the Tech & repairs search screen. */
export const matchesQuery = (i: ShelfItem, q: string) => {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return i.name.toLowerCase().includes(t) || i.desc.toLowerCase().includes(t) || i.storeName.toLowerCase().includes(t) || i.category.toLowerCase().includes(t);
};

/** Paths of the v2 screens. */
export const shelfPath = (shelf: ShelfId) => `/category/${shelf}`;
export const detailPath = (shelf: ServiceShelf, id: string) => `/services/${shelf}/${encodeURIComponent(id)}`;
export const SERVICES_HOME_PATH = '/(tabs)/services?tab=services';
