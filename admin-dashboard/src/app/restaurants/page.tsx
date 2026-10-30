"use client";
import { PageHeader, DataTable, Toolbar as KitToolbar, BulkBar, type Column } from '@/components/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { useLiveSync, useFreshIds, FRESH_ROW_CLASS } from '@/lib/useLiveSync';
import {
  FSSAI_STATUS_META, FssaiStatus, STATUS_META, Store, StoreStatus, adminRequest, formatINR, fssaiStatusOf, isBookingStall, isLocalVendorType,
  partnerAppName, readTags, storeId, storeStatus, vendorLabel, VENDOR_TYPES,
} from './catalogue';
import {
  Button, Callout, Chip, ConfirmModal, EmptyState, Field, INPUT, MenuButton, Modal, Skeleton, Thumb, Toggle,
  ToastProvider, TypedConfirmModal, cx, FOCUS_RING, useSlashFocus, useToast,
} from '@/components/restaurants/ui';
import dynamic from 'next/dynamic';
import type { StepKey } from '@/components/restaurants/StoreWizard';
import type { DrawerTab } from '@/components/restaurants/StoreDrawer';

// The wizard and the store drawer (with the menu manager) are most of this route's code but only
// open on demand: loaded the first time they are opened, so the store list paints sooner.
const PanelLoading = () => (
  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim/50" role="status" aria-live="polite">
    <div className="w-8 h-8 border-2 border-line border-t-line-strong rounded-full animate-spin" aria-label="Loading" />
  </div>
);
const StoreWizard = dynamic(() => import('@/components/restaurants/StoreWizard').then(m => m.StoreWizard), { ssr: false, loading: PanelLoading });
const StoreDrawer = dynamic(() => import('@/components/restaurants/StoreDrawer').then(m => m.StoreDrawer), { ssr: false, loading: PanelLoading });
import { useStoreStats } from '@/components/restaurants/useStoreStats';
import { bulkUpdateStores, describeBulk, duplicateStore, patchStore, removeStoreBanner } from '@/components/restaurants/storeActions';
import { summarizeWeekly, weeklyFromStore } from '@/components/restaurants/helpers';
import { QueryChange } from '@/components/shell/QueryChange';

const FILTERS_KEY = 'zenvy.admin.storeFilters.v1';
const DRAFT_KEY = 'zenvy.admin.storeWizard.v1';
/** 'hidden' = every store customers cannot see (never-published drafts + switched-off stores). */
type StatusFilter = 'all' | 'hidden' | StoreStatus;
const STATUS_FILTERS: StatusFilter[] = ['all', 'hidden', 'live', 'closed', 'draft', 'inactive'];
const isHidden = (s: Store) => !s.isActive;
type SortKey = 'name' | 'newest' | 'orders' | 'sales' | 'rating' | 'items' | 'attention';
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name A–Z' },
  { value: 'orders', label: 'Most orders today' },
  { value: 'sales', label: 'Highest sales today' },
  { value: 'rating', label: 'Best rated' },
  { value: 'items', label: 'Largest menu' },
  { value: 'newest', label: 'Newest first' },
  { value: 'attention', label: 'Needs attention first' },
];
const STATUS_TONE = { live: 'green', closed: 'amber', draft: 'slate', inactive: 'red' } as const;

type FssaiFilter = 'ALL' | FssaiStatus;
const FSSAI_FILTERS: { value: FssaiFilter; label: string }[] = [
  { value: 'ALL', label: 'FSSAI: all' },
  { value: 'MISSING', label: 'FSSAI: missing' },
  { value: 'EXPIRED', label: 'FSSAI: expired' },
  { value: 'PENDING', label: 'FSSAI: pending check' },
  { value: 'VERIFIED', label: 'FSSAI: verified' },
];

interface Filters { search: string; type: string; campus: string; status: StatusFilter; fssai: FssaiFilter; sort: SortKey }
const DEFAULT_FILTERS: Filters = { search: '', type: 'ALL', campus: 'ALL', status: 'all', fssai: 'ALL', sort: 'name' };

export default function StoresPage() {
  return (
    <ToastProvider>
      <StoresScreen />
    </ToastProvider>
  );
}

function StoresScreen() {
  const { isAuthed } = useAdminAuth();
  const toast = useToast();
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [wizard, setWizard] = useState<{ mode: 'create' | 'edit'; id?: string; step?: StepKey; preset?: { vendorType: string; campusBooking?: boolean } } | null>(null);
  const [drawer, setDrawer] = useState<{ id: string; tab: DrawerTab } | null>(null);
  // ?new=1 (header New > Store) opens the add-store wizard (once: the flag is dropped from the URL); ?store=<id>
  // [&tab=] opens that store. Runs on load and when a header / palette link changes the query of this open page.
  const openFromQuery = useCallback((qs: URLSearchParams) => {
    if (qs.get('new') === '1') {
      // &type=LOCAL_VENDOR starts the wizard as that store type; &booking=1 ("Add campus stall" on In-Campus Booking)
      // adds the In-Campus Booking step (UPI ID) and switches bookings on when the stall is saved.
      const type = String(qs.get('type') || '').toUpperCase();
      const campusBooking = qs.get('booking') === '1' && ['LOCAL_VENDOR', 'LOCAL', 'STALL'].includes(type);
      setWizard({ mode: 'create', ...(VENDOR_TYPES.some(v => v.value === type) ? { preset: { vendorType: type, ...(campusBooking ? { campusBooking: true } : {}) } } : {}) });
      const url = new URL(window.location.href);
      url.searchParams.delete('new');
      url.searchParams.delete('type');
      url.searchParams.delete('booking');
      window.history.replaceState(window.history.state, '', url.toString());
    }
    const sid = qs.get('store');
    if (sid) setDrawer(d => (d && d.id === sid ? d : { id: sid, tab: (qs.get('tab') as DrawerTab) || 'overview' }));
  }, []);
  const [deleting, setDeleting] = useState<Store | null>(null);
  const [duplicating, setDuplicating] = useState<Store | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: React.ReactNode; action: string; danger?: boolean; run: () => Promise<void> } | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useSlashFocus(searchRef);
  const stats = useStoreStats(isAuthed);
  const { mark: markFresh, isFresh } = useFreshIds();

  // ── persisted filters + deep link ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FILTERS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) || {};
        setFilters({
          ...DEFAULT_FILTERS,
          type: typeof saved.type === 'string' ? saved.type : 'ALL',
          campus: typeof saved.campus === 'string' ? saved.campus : 'ALL',
          status: STATUS_FILTERS.includes(saved.status) ? saved.status : 'all',
          fssai: FSSAI_FILTERS.some(o => o.value === saved.fssai) ? saved.fssai : 'ALL',
          sort: SORTS.some(o => o.value === saved.sort) ? saved.sort : 'name',
        });
      }
      setHasDraft(!!localStorage.getItem(DRAFT_KEY));
    } catch { /* storage unavailable */ }
    openFromQuery(new URLSearchParams(window.location.search));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try { const { search: _s, ...rest } = filters; void _s; localStorage.setItem(FILTERS_KEY, JSON.stringify(rest)); } catch { /* ignore */ }
  }, [filters]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (drawer) { url.searchParams.set('store', drawer.id); url.searchParams.set('tab', drawer.tab); }
    else { url.searchParams.delete('store'); url.searchParams.delete('tab'); }
    window.history.replaceState(window.history.state, '', url.toString());
  }, [drawer]);
  const setF = (patch: Partial<Filters>) => setFilters(prev => ({ ...prev, ...patch }));

  const loadStores = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setLoadError(''); }
    try {
      const data = await adminRequest<Store[]>('/api/admin/restaurants');
      // Tags normalised once here: every card, filter and the wizard can treat them as a list.
      setStores(Array.isArray(data) ? data.map(s => ({ ...s, tags: readTags(s.tags) })) : []);
      setLoadError('');
    } catch (e) {
      if (!quiet) setLoadError(e instanceof Error ? e.message : 'Could not load stores.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);
  useEffect(() => { if (isAuthed) loadStores(); }, [isAuthed, loadStores]);

  // ── realtime: other admins, the partner app and the auto-restock job ──
  const drawerIdRef = useRef<string | null>(null);
  drawerIdRef.current = drawer?.id || null;
  useLiveSync(['store', 'product'], (events, { reconnect }) => {
    loadStores(true);
    if (reconnect) return;
    const storeEvents = events.filter(e => e.type === 'store');
    markFresh(storeEvents.filter(e => e.action !== 'deleted').map(e => e.id));
    const removed = storeEvents.filter(e => e.action === 'deleted').map(e => String(e.id));
    if (drawerIdRef.current && removed.includes(drawerIdRef.current)) {
      setDrawer(null);
      toast.error('The store you were viewing was deleted in another session.');
    }
    const created = storeEvents.filter(e => e.action === 'created').length;
    if (created) toast.info(created > 1 ? `${created} new stores were added.` : 'A new store was added.');
  }, { enabled: isAuthed });

  const merge = useCallback((saved: Store) => {
    const id = storeId(saved);
    setStores(prev => prev.some(s => storeId(s) === id) ? prev.map(s => (storeId(s) === id ? { ...s, ...saved } : s)) : [...prev, { itemCount: 0, ...saved }]);
    loadStores(true); // refresh computed open/closed state and counts
  }, [loadStores]);

  // ── derived ──
  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    stores.forEach(s => { const t = (s.vendorType || 'RESTAURANT').toUpperCase(); counts.set(t, (counts.get(t) || 0) + 1); });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [stores]);
  const campusOptions = useMemo(() => {
    const counts = new Map<string, number>();
    stores.forEach(s => { const c = (s.campus || '').trim(); if (c) counts.set(c, (counts.get(c) || 0) + 1); });
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [stores]);
  const statusCounts = useMemo(() => {
    const c: Record<StoreStatus, number> = { live: 0, closed: 0, draft: 0, inactive: 0 };
    stores.forEach(s => { c[storeStatus(s)]++; });
    return c;
  }, [stores]);
  const fssaiCounts = useMemo(() => {
    const c: Record<FssaiStatus, number> = { MISSING: 0, EXPIRED: 0, PENDING: 0, VERIFIED: 0 };
    stores.forEach(s => { c[fssaiStatusOf(s).status]++; });
    return c;
  }, [stores]);

  const visible = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const list = stores.filter(s => {
      const type = (s.vendorType || 'RESTAURANT').toUpperCase();
      if (filters.type !== 'ALL' && type !== filters.type) return false;
      if (filters.campus !== 'ALL' && (s.campus || '').trim() !== filters.campus) return false;
      if (filters.status === 'hidden' ? !isHidden(s) : filters.status !== 'all' && storeStatus(s) !== filters.status) return false;
      if (filters.fssai !== 'ALL' && fssaiStatusOf(s).status !== filters.fssai) return false;
      return !q || [s.name, s.location, s.campus, vendorLabel(type), ...(s.tags || [])].some(v => String(v || '').toLowerCase().includes(q));
    });
    const attention = (s: Store) => (storeStatus(s) === 'draft' ? 0 : !s.imageUrl || (s.itemCount ?? 0) === 0 || (!s.hasPassword && !s.isOffline) ? 1 : storeStatus(s) === 'inactive' ? 2 : 3);
    const by: Record<SortKey, (a: Store, b: Store) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      newest: (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
      orders: (a, b) => stats.statsFor(storeId(b)).todayOrders - stats.statsFor(storeId(a)).todayOrders,
      sales: (a, b) => stats.statsFor(storeId(b)).todayRevenue - stats.statsFor(storeId(a)).todayRevenue,
      rating: (a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0),
      items: (a, b) => (b.itemCount ?? 0) - (a.itemCount ?? 0),
      attention: (a, b) => attention(a) - attention(b),
    };
    return [...list].sort((a, b) => by[filters.sort](a, b) || a.name.localeCompare(b.name));
  }, [stores, filters, stats]);

  const filtered = filters.search.trim() !== '' || filters.type !== 'ALL' || filters.campus !== 'ALL' || filters.status !== 'all' || filters.fssai !== 'ALL';
  const visibleIds = visible.map(storeId);
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));
  const drawerStore = drawer ? stores.find(s => storeId(s) === drawer.id) || null : null;
  const wizardStore = wizard?.id ? stores.find(s => storeId(s) === wizard.id) || null : null;

  // ── actions ──
  const withBusy = async (id: string, fn: () => Promise<void>) => {
    if (busy[id]) return;
    setBusy(b => ({ ...b, [id]: true }));
    try { await fn(); } finally { setBusy(b => ({ ...b, [id]: false })); }
  };
  const quickPatch = (store: Store, patch: Record<string, unknown>, text: string, undo?: Record<string, unknown>) =>
    withBusy(storeId(store), async () => {
      const id = storeId(store);
      // Optimistic: flip the row right away, roll back the patched fields if the server refuses.
      const before: Record<string, unknown> = {};
      for (const k of Object.keys(patch)) before[k] = (store as unknown as Record<string, unknown>)[k];
      setStores(prev => prev.map(s => (storeId(s) === id ? ({ ...s, ...patch } as Store) : s)));
      try {
        const saved = await patchStore(id, patch);
        merge(saved);
        toast.success(text, undo ? { label: 'Undo', onClick: () => quickPatch({ ...store, ...saved }, undo, 'Change undone.') } : undefined);
      } catch (e) {
        setStores(prev => prev.map(s => (storeId(s) === id ? ({ ...s, ...before } as Store) : s)));
        toast.error(e instanceof Error ? e.message : 'Could not update the store.');
      }
    });

  const toggleActive = (store: Store) => {
    const local = isLocalVendorType(store.vendorType);
    if (store.isActive) {
      setConfirm({
        title: `Hide ${store.name}?`,
        body: <p>It disappears from the customer app and stops taking orders until you publish it again.{store.isFeatured ? ' Its Home banner is removed too.' : ''}</p>,
        action: 'Hide store',
        danger: true,
        run: async () => {
          const saved = await patchStore(storeId(store), { isActive: false });
          merge(saved);
          setConfirm(null);
          const err = await removeStoreBanner(storeId(store));
          if (err) toast.error(`${store.name} is hidden, but its Home banner was not removed: ${err}`);
          else toast.success(`${store.name} is hidden.`, { label: 'Undo', onClick: () => quickPatch({ ...store, ...saved }, { isActive: true }, `${store.name} is live again.`) });
        },
      });
    } else if ((store.itemCount ?? 0) === 0) {
      setConfirm({
        title: `Publish ${store.name} without a menu?`,
        body: <p>Customers will see an empty store and cannot order{local ? ' from the stall' : ''}. Add items first for a better first impression.</p>,
        action: 'Publish anyway',
        run: async () => { const saved = await patchStore(storeId(store), { isActive: true }); merge(saved); setConfirm(null); toast.success(`${store.name} is live.`); },
      });
    } else {
      quickPatch(store, { isActive: true }, `${store.name} is live${local && !store.hasPassword ? '. Set a ZCS Vendor password so the stall can take orders' : ''}.`, { isActive: false });
    }
  };
  const toggleOpen = (store: Store) => {
    const paused = store.isOpenNow === false;
    quickPatch(store, { isOpenNow: paused }, paused ? `${store.name} is taking orders again.` : `${store.name} is paused. Customers see it as closed.`, { isOpenNow: !paused });
  };
  const toggleFeatured = (store: Store) => withBusy(storeId(store), async () => {
    try {
      if (store.isFeatured) {
        const saved = await patchStore(storeId(store), { isFeatured: false });
        merge(saved);
        const err = await removeStoreBanner(storeId(store));
        if (err) toast.error(`Promotion ended, but the Home banner was not removed: ${err}`);
        else toast.success(`${store.name} is no longer featured.`);
      } else {
        const saved = await patchStore(storeId(store), { isFeatured: true, featuredBadge: store.featuredBadge || 'Featured' });
        merge(saved);
        toast.success(`${store.name} is featured.`, { label: 'Customise', onClick: () => setDrawer({ id: storeId(store), tab: 'promote' }) });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the promotion.');
    }
  });

  const bulkSetActive = (active: boolean) => {
    const targets = stores.filter(s => selected.has(storeId(s)) && s.isActive !== active);
    if (!targets.length) { toast.info(`All selected stores are already ${active ? 'live' : 'hidden'}.`); return; }
    const empty = active ? targets.filter(s => (s.itemCount ?? 0) === 0).length : 0;
    setConfirm({
      title: `${active ? 'Publish' : 'Hide'} ${targets.length} store${targets.length === 1 ? '' : 's'}?`,
      body: (
        <div className="space-y-2">
          <p>{active ? 'They become visible to customers right away.' : 'They disappear from the customer app and stop taking orders. Their Home banners are removed.'}</p>
          {empty > 0 && <Callout tone="amber">{empty} of them have no menu items yet.</Callout>}
          <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-fg-muted">{targets.map(s => <li key={storeId(s)}>{s.name}</li>)}</ul>
        </div>
      ),
      action: active ? 'Publish all' : 'Hide all',
      danger: !active,
      run: async () => {
        // Chunks of 300 (the endpoint's limit), so every selected store is sent, not only the first 300.
        const result = await bulkUpdateStores(targets.map(storeId), { isActive: active });
        let bannerErrors = 0;
        if (!active) {
          // Only stores whose hide request went through lose their Home banner.
          for (const id of result.okIds) if (await removeStoreBanner(id)) bannerErrors++;
        }
        setConfirm(null);
        setSelected(new Set());
        await loadStores(true);
        const text = describeBulk(result, targets.length, active ? 'published' : 'hidden');
        if (result.count === targets.length && !bannerErrors) toast.success(text);
        else if (result.count === targets.length) toast.error(`${text} ${bannerErrors} Home banner(s) were not removed.`);
        else toast.error(`${text}${bannerErrors ? ` ${bannerErrors} Home banner(s) were not removed.` : ''}`);
      },
    });
  };
  const bulkSetOpen = async (open: boolean) => {
    const targets = stores.filter(s => selected.has(storeId(s)) && (s.isOpenNow !== false) !== open);
    if (!targets.length) { toast.info(`All selected stores are already ${open ? 'taking orders' : 'paused'}.`); return; }
    setConfirm({
      title: `${open ? 'Resume' : 'Pause'} ${targets.length} store${targets.length === 1 ? '' : 's'}?`,
      body: (
        <div className="space-y-2">
          <p>{open ? 'They start taking orders again right away.' : 'They stay visible but stop taking new orders until resumed.'}</p>
          <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-fg-muted">{targets.map(s => <li key={storeId(s)}>{s.name}</li>)}</ul>
        </div>
      ),
      action: open ? 'Resume all' : 'Pause all',
      danger: !open,
      run: async () => {
        const result = await bulkUpdateStores(targets.map(storeId), { isOpenNow: open });
        setConfirm(null);
        setSelected(new Set());
        await loadStores(true);
        const text = describeBulk(result, targets.length, open ? 'taking orders again' : 'paused');
        if (result.count === targets.length) toast.success(text); else toast.error(text);
      },
    });
  };

  const deleteStore = async (store: Store) => {
    const id = storeId(store);
    await adminRequest(`/api/admin/restaurants/${id}`, { method: 'DELETE' });
    setStores(prev => prev.filter(s => storeId(s) !== id));
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    if (drawer?.id === id) setDrawer(null);
    setDeleting(null);
    const err = await removeStoreBanner(id);
    if (err) toast.error(`${store.name} deleted, but its Home banner was not removed: ${err}`);
    else toast.success(`${store.name} deleted.`);
  };

  const openWizard = (mode: 'create' | 'edit', id?: string, step?: StepKey) => setWizard({ mode, id, step });

  if (!isAuthed) return null; // AppShell shows the session check

  const hiddenCount = statusCounts.draft + statusCounts.inactive;
  const kpis: { key: StatusFilter; label: string; value: number; tone: string; help: string }[] = [
    { key: 'all', label: 'All stores', value: stores.length, tone: 'text-fg', help: 'Every store, stall and service partner.' },
    { key: 'hidden', label: 'Hidden / Inactive', value: hiddenCount, tone: 'text-danger-text', help: 'Not visible to customers: drafts (never published, e.g. newly imported stores) plus stores that were switched off. Review them and switch them on.' },
    { key: 'live', label: 'Live now', value: statusCounts.live, tone: 'text-success-text', help: STATUS_META.live.help },
    { key: 'closed', label: 'Closed now', value: statusCounts.closed, tone: 'text-warning-text', help: STATUS_META.closed.help },
    { key: 'draft', label: 'Drafts', value: statusCounts.draft, tone: 'text-fg-muted', help: STATUS_META.draft.help },
    { key: 'inactive', label: 'Inactive', value: statusCounts.inactive, tone: 'text-danger-text', help: STATUS_META.inactive.help },
  ];

  const columns: Column<Store>[] = [
    {
      key: 'name',
      header: 'Store',
      sortValue: s => s.name,
      cell: store => {
        const id = storeId(store);
        const status = storeStatus(store);
        const local = isLocalVendorType(store.vendorType);
        return (
          <button type="button" onClick={() => setDrawer({ id, tab: 'overview' })} className={cx('flex w-full min-w-[220px] max-w-[520px] items-center gap-3 rounded-md text-left', FOCUS_RING)}>
            <Thumb src={store.imageUrl} alt={store.name} />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="truncate font-medium text-fg hover:underline">{store.name}</span>
                <Chip tone={STATUS_TONE[status]} dot title={status === 'closed' && store.closedReason ? store.closedReason : STATUS_META[status].help}>{status === 'closed' && store.isOpenNow === false ? 'Paused' : STATUS_META[status].label}</Chip>
                {store.isFeatured && <Chip tone="amber">{store.featuredBadge || 'Featured'}</Chip>}
                {store.isOffline && !local && <Chip title="No partner app; ZCS handles orders">Managed</Chip>}
                {local && (isBookingStall(store)
                  ? <Chip tone="sky" title="In-Campus Booking: students pre-book and collect at the stall, paying it by UPI">Pickup, UPI</Chip>
                  : <Chip tone="sky" title="Customers pay the stall cash; the stall delivers with ZCS Vendor">Stall, cash</Chip>)}
                <FssaiChip store={store} />
                {!store.hasPassword && !(store.isOffline && !local) && <Chip tone="amber" title={local ? `The stall cannot see its orders until it can sign in to ${partnerAppName(store)}` : 'The partner cannot sign in to accept orders'}>No login</Chip>}
              </span>
              <span className="mt-0.5 block truncate text-xs text-fg-muted">{vendorLabel(store.vendorType)} · {[store.location, store.campus].filter(Boolean).join(' · ')}</span>
              <span className="block truncate text-xs text-fg-subtle">{summarizeWeekly(weeklyFromStore(store.operatingHours))}{!local && store.deliveryTime ? ` · ${store.deliveryTime} min` : ''}</span>
            </span>
          </button>
        );
      },
    },
    {
      key: 'today',
      header: 'Today',
      align: 'right',
      hideBelow: 'lg',
      sortValue: s => stats.statsFor(storeId(s)).todayRevenue,
      cell: s => {
        const st = stats.statsFor(storeId(s));
        return (
          <div className="tabular-nums" title="Non-cancelled orders today (IST) and their item subtotal">
            <p className="text-fg">{stats.loading ? '…' : formatINR(st.todayRevenue)}</p>
            <p className="text-xs text-fg-muted">{stats.loading ? '' : `${st.todayOrders} ${st.todayOrders === 1 ? 'order' : 'orders'}`}</p>
          </div>
        );
      },
    },
    {
      key: 'menu',
      header: 'Items',
      align: 'right',
      hideBelow: 'lg',
      sortValue: s => s.itemCount ?? 0,
      cell: s => (
        <button type="button" onClick={() => setDrawer({ id: storeId(s), tab: 'menu' })} className={cx('rounded px-1 tabular-nums hover:underline', (s.itemCount ?? 0) === 0 ? 'text-warning-text' : 'text-fg', FOCUS_RING)} title="Open the menu">
          {s.itemCount ?? 0}
        </button>
      ),
    },
    {
      key: 'toggles',
      header: <span title="Live = visible to customers · Open = taking orders (off pauses the store) · Featured = promoted on Home">Live, open, featured</span>,
      align: 'center',
      width: '150px',
      cell: store => {
        const id = storeId(store);
        const local = isLocalVendorType(store.vendorType);
        const isBusy = !!busy[id];
        return (
          <div className="flex items-center justify-center gap-4" data-row-stop>
            <Toggle size="sm" srOnlyLabel label={`${store.name} visible to customers`} checked={store.isActive} disabled={isBusy} onChange={() => toggleActive(store)} />
            <Toggle size="sm" srOnlyLabel label={`${store.name} taking orders`} checked={store.isOpenNow !== false} disabled={isBusy || !store.isActive} onChange={() => toggleOpen(store)} />
            {local ? <span className="w-7 text-center text-xs text-fg-subtle" title="Stalls are not featured on Home">–</span> : <Toggle size="sm" tone="amber" srOnlyLabel label={`${store.name} featured`} checked={!!store.isFeatured} disabled={isBusy} onChange={() => toggleFeatured(store)} />}
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      width: '130px',
      cell: store => {
        const id = storeId(store);
        const local = isLocalVendorType(store.vendorType);
        return (
          <div className="flex items-center justify-end gap-1.5">
            <Button size="sm" onClick={() => setDrawer({ id, tab: 'overview' })}>Manage</Button>
            <MenuButton ariaLabel={`More actions for ${store.name}`} label="•••" items={[
              { label: 'Edit details', onSelect: () => openWizard('edit', id) },
              { label: 'Menu', onSelect: () => setDrawer({ id, tab: 'menu' }) },
              { label: 'Hours', onSelect: () => setDrawer({ id, tab: 'hours' }) },
              { label: local ? 'Vendor login' : 'Partner login', onSelect: () => setDrawer({ id, tab: 'login' as DrawerTab }) },
              { label: 'Licences, tax and payout', onSelect: () => setDrawer({ id, tab: 'compliance' as DrawerTab }) },
              ...(local ? [] : [{ label: 'Promote', onSelect: () => setDrawer({ id, tab: 'promote' as DrawerTab }) }]),
              'divider',
              { label: 'Duplicate store', onSelect: () => setDuplicating(store) },
              { label: 'Delete…', onSelect: () => setDeleting(store), danger: true },
            ]} />
          </div>
        );
      },
    },
  ];

  return (
    <div className="text-fg">
      <QueryChange onChange={openFromQuery} />
      <PageHeader
        title="Stores"
        description="Restaurants, shops and campus stalls: details, menus, hours, partner logins and whether customers can order. Changes reach the customer app live."
        actions={
          <>
            <Button onClick={() => { loadStores(); stats.reload(); }} disabled={loading} aria-label="Refresh stores">{loading ? 'Loading…' : 'Refresh'}</Button>
            <Button variant="primary" onClick={() => openWizard('create')}>
              Add store{hasDraft && <span className="rounded bg-accent-hover px-1.5 text-xs font-medium">draft saved</span>}
            </Button>
          </>
        }
      />

      {/* Status counts double as quick filters */}
      <section aria-label="Summary" className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {kpis.map(k => (
          <button
            key={k.key}
            type="button"
            title={k.help}
            aria-pressed={filters.status === k.key}
            onClick={() => setF({ status: k.key })}
            className={cx('rounded-lg border bg-surface p-3 text-left shadow-xs transition-colors', filters.status === k.key ? 'border-accent ring-1 ring-accent/30' : 'border-line hover:border-line-strong', FOCUS_RING)}
          >
            <p className="text-xs text-fg-muted">{k.label}</p>
            <div className={cx('mt-0.5 text-xl font-semibold tabular-nums', k.tone)}>{loading ? <Skeleton className="mt-1 h-6 w-10" /> : k.value}</div>
          </button>
        ))}
        <div className="rounded-lg border border-line bg-surface p-3 shadow-xs" title="Non-cancelled orders placed today (IST)">
          <p className="text-xs text-fg-muted">Orders today</p>
          <div className="mt-0.5 text-xl font-semibold tabular-nums">{stats.loading ? <Skeleton className="mt-1 h-6 w-10" /> : stats.totals.todayOrders}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-3 shadow-xs" title="Item subtotal of today's non-cancelled orders">
          <p className="text-xs text-fg-muted">Sales today</p>
          <div className="mt-0.5 text-xl font-semibold tabular-nums">{stats.loading ? <Skeleton className="mt-1 h-6 w-16" /> : formatINR(stats.totals.todayRevenue)}</div>
        </div>
      </section>

      <div className="mb-4 space-y-2">
        {!loading && hiddenCount > 0 && filters.status !== 'hidden' && (
          <Callout tone="amber">
            <span className="flex flex-wrap items-center justify-between gap-3">
              <span><b className="font-medium text-fg">{hiddenCount} {hiddenCount === 1 ? 'store is' : 'stores are'} hidden</b> from customers ({statusCounts.draft} never published, {statusCounts.inactive} switched off). Review them and switch them on with the Live toggle.</span>
              <button type="button" onClick={() => setFilters({ ...DEFAULT_FILTERS, status: 'hidden', sort: filters.sort })} className="font-medium text-fg underline">Show hidden stores</button>
            </span>
          </Callout>
        )}
        {stats.error && <Callout tone="amber">Order numbers are unavailable right now: {stats.error}</Callout>}
      </div>

      {/* Filters: one row */}
      <KitToolbar end={filtered ? <Button size="sm" variant="ghost" onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>Clear filters</Button> : undefined}>
        <div className="relative w-full sm:w-72">
          <input ref={searchRef} value={filters.search} onChange={e => setF({ search: e.target.value })} placeholder="Search name, area, campus or cuisine" aria-label="Search stores" className="zv-control pr-8" />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line bg-surface-2 px-1 text-2xs text-fg-subtle">/</kbd>
        </div>
        <select value={filters.type} onChange={e => setF({ type: e.target.value })} aria-label="Store type" className="zv-control w-auto">
          <option value="ALL">All types</option>
          {typeOptions.map(([t, n]) => <option key={t} value={t}>{vendorLabel(t)} ({n})</option>)}
        </select>
        <select value={filters.campus} onChange={e => setF({ campus: e.target.value })} aria-label="Campus" className="zv-control w-auto">
          <option value="ALL">All campuses</option>
          {campusOptions.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
        </select>
        <select value={filters.fssai} onChange={e => setF({ fssai: e.target.value as FssaiFilter })} aria-label="FSSAI licence" className="zv-control w-auto">
          {FSSAI_FILTERS.map(o => <option key={o.value} value={o.value}>{o.label}{o.value !== 'ALL' ? ` (${fssaiCounts[o.value]})` : ''}</option>)}
        </select>
        <select value={filters.sort} onChange={e => setF({ sort: e.target.value as SortKey })} aria-label="Sort by" className="zv-control w-auto">
          {SORTS.map(s => <option key={s.value} value={s.value}>Sort: {s.label}</option>)}
        </select>
      </KitToolbar>

      <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
        <Button size="sm" onClick={() => bulkSetActive(true)}>Publish</Button>
        <Button size="sm" variant="danger" onClick={() => bulkSetActive(false)}>Hide</Button>
        <Button size="sm" onClick={() => bulkSetOpen(false)}>Pause orders</Button>
        <Button size="sm" onClick={() => bulkSetOpen(true)}>Resume orders</Button>
      </BulkBar>

      {!loading && !loadError && stores.length === 0 ? (
        <EmptyState
          title="No stores yet"
          body="Add your first restaurant, shop or campus stall. The guided setup takes about 3 minutes; you can save a draft and finish later."
          action={<Button variant="primary" onClick={() => openWizard('create')}>Add your first store</Button>}
        />
      ) : (
        <DataTable
          caption="Stores"
          columns={columns}
          rows={visible}
          rowKey={s => storeId(s)}
          loading={loading}
          error={loadError}
          onRetry={() => loadStores()}
          selection={{ selected: Array.from(selected), onChange: keys => setSelected(new Set(keys)) }}
          rowClassName={s => (isFresh(storeId(s)) ? FRESH_ROW_CLASS : undefined)}
          pageSize={25}
          noun="stores"
          resetPageKey={JSON.stringify(filters)}
          empty={{ title: 'No stores match', description: 'Try another type, campus, status or search.', action: <Button onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>Clear filters</Button> }}
        />
      )}

      {wizard && (wizard.mode === 'create' || wizardStore) && (
        <StoreWizard
          mode={wizard.mode}
          initial={wizard.mode === 'edit' ? wizardStore : null}
          startStep={wizard.step}
          preset={wizard.mode === 'create' ? wizard.preset : undefined}
          stores={stores}
          onClose={() => { setWizard(null); try { setHasDraft(!!localStorage.getItem(DRAFT_KEY)); } catch { /* ignore */ } }}
          onSaved={({ store }) => {
            merge(store);
            markFresh([storeId(store)]);
            // Create shows its own success screen (with the one-time password).
            if (wizard.mode === 'edit') toast.success(`${store.name} saved.`);
            setHasDraft(false);
          }}
          onOpenStore={(id, tab) => { setWizard(null); setDrawer({ id, tab: (tab as DrawerTab) || 'overview' }); }}
        />
      )}

      {drawer && !drawerStore && !loading && (
        <Modal title="Store not found" size="sm" onClose={() => setDrawer(null)} footer={<Button onClick={() => setDrawer(null)}>Close</Button>}>
          <p className="text-sm text-fg-muted">This store may have been deleted, or the list is still refreshing.</p>
        </Modal>
      )}
      {drawer && drawerStore && !wizard && (
        <StoreDrawer
          store={drawerStore}
          tab={drawer.tab}
          onTab={tab => setDrawer({ id: drawer.id, tab })}
          onClose={() => setDrawer(null)}
          onEdit={step => openWizard('edit', drawer.id, step)}
          onChanged={merge}
          onToggleActive={() => toggleActive(drawerStore)}
          onToggleOpen={() => toggleOpen(drawerStore)}
          onDuplicate={() => setDuplicating(drawerStore)}
          onDelete={() => setDeleting(drawerStore)}
          stats={stats.statsFor(drawer.id)}
          busy={!!busy[drawer.id]}
        />
      )}

      {deleting && (
        <TypedConfirmModal
          title={`Delete ${deleting.name}?`}
          confirmText={deleting.name}
          actionLabel="Delete permanently"
          onClose={() => setDeleting(null)}
          onConfirm={() => deleteStore(deleting)}
          body={
            <div className="space-y-2">
              <p>This permanently removes the store, its <b>{deleting.itemCount ?? 0} menu items</b> and its partner login. Past orders keep their history. It cannot be undone.</p>
              <p className="text-fg-muted">Stores with orders still in progress cannot be deleted. To take it off the app for now, <button type="button" className="font-semibold text-success-text underline" onClick={() => { const s = deleting; setDeleting(null); if (s.isActive) toggleActive(s); }}>hide it instead</button>.</p>
            </div>
          }
        />
      )}
      {duplicating && (
        <DuplicateModal
          store={duplicating}
          existingNames={stores.map(s => s.name.toLowerCase())}
          onClose={() => setDuplicating(null)}
          onDone={copy => { setDuplicating(null); merge(copy); markFresh([storeId(copy)]); setDrawer({ id: storeId(copy), tab: 'overview' }); }}
        />
      )}
      {confirm && (
        <ConfirmModal title={confirm.title} body={confirm.body} actionLabel={confirm.action} tone={confirm.danger ? 'danger' : 'primary'} onClose={() => setConfirm(null)} onConfirm={confirm.run} />
      )}
    </div>
  );
}

// ─── FSSAI badge ─────────────────────────────────────────────────────────────
function FssaiChip({ store }: { store: Store }) {
  const { status, expiringSoon } = fssaiStatusOf(store);
  const meta = FSSAI_STATUS_META[status];
  const expiry = store.compliance?.fssaiExpiry ?? store.fssaiExpiry;
  return (
    <>
      <Chip tone={meta.tone} title={`${meta.help}${expiry ? ` Expiry: ${expiry}.` : ''}`}>{meta.label}</Chip>
      {expiringSoon && <Chip tone="amber" title={expiry ? `The FSSAI licence expires on ${expiry} (within 30 days).` : 'The FSSAI licence expires within 30 days.'}>FSSAI expires soon</Chip>}
    </>
  );
}

// ─── Duplicate store ─────────────────────────────────────────────────────────
function DuplicateModal({ store, existingNames, onClose, onDone }: { store: Store; existingNames: string[]; onClose: () => void; onDone: (copy: Store) => void }) {
  const toast = useToast();
  const [name, setName] = useState(`${store.name} (copy)`);
  const [copyMenu, setCopyMenu] = useState((store.itemCount ?? 0) > 0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const taken = existingNames.includes(name.trim().toLowerCase());

  const run = async () => {
    if (!name.trim() || running) return;
    setRunning(true);
    setError('');
    try {
      // One server call: the store and (optionally) its whole menu are copied in a single transaction.
      const copy = await duplicateStore(storeId(store), name.trim(), copyMenu);
      toast.success(`${copy.name} created as a draft${copy.itemCount ? ` with ${copy.itemCount} items` : ''}. Set a login password before publishing.`);
      onDone(copy);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not duplicate the store.');
      setRunning(false);
    }
  };

  return (
    <Modal title={`Duplicate ${store.name}`} description="Creates a hidden draft with the same details. Good for a second branch or a similar stall." size="md" onClose={running ? () => undefined : onClose} footer={<>
      <Button onClick={onClose} disabled={running}>Cancel</Button>
      <Button variant="primary" loading={running} disabled={!name.trim() || taken} onClick={run}>{running ? 'Copying…' : 'Duplicate'}</Button>
    </>}>
      <div className="space-y-4">
        <Field label="New store name" required help={taken ? undefined : 'Must be different, since partners can sign in with the store name.'} error={taken ? 'A store already has this name.' : null}>
          {({ id, msgId, invalid }) => <input id={id} data-autofocus aria-describedby={msgId} aria-invalid={invalid} className={INPUT} value={name} maxLength={120} onChange={e => setName(e.target.value)} />}
        </Field>
        <Toggle checked={copyMenu} onChange={setCopyMenu} disabled={(store.itemCount ?? 0) === 0} label={`Copy the menu (${store.itemCount ?? 0} items)`} description="Prices, photos, categories and stock are copied." />
        <p className="text-xs text-fg-muted">Not copied: login password and phone, signed-in phones, rating, promotion, orders and payouts.</p>
        {error && <Callout tone="red">{error}</Callout>}
      </div>
    </Modal>
  );
}

