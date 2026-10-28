"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { adminRequest } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { useLiveSync } from '@/lib/useLiveSync';
import { resizeAndUpload } from '@/components/restaurants/helpers';
import {
  Badge, Button, BulkBar, Card, Checkbox, DataTable, EmptyState, ErrorState, Field, IconButton, Input, LoadingState, Menu,
  Modal, Notice, PageHeader, SearchInput, SegmentedControl, Select, Switch, Textarea, Toolbar, buttonClass, useConfirm, useToast,
  IconArrowDown, IconArrowUp, IconEdit, IconImage, IconLayers, IconMore, IconPlus, IconTrash, IconUpload, type Column,
} from '@/components/ui';
import { formatINR, formatNumber, humanize } from '@/lib/format';

/**
 * Catalogue: one place to add, edit and delete the items of any store: restaurants, local vendors
 * (stalls) and the stores behind the customer app's Others section (Grocery, Toys, Seeds, ...).
 * Everything goes through the existing admin endpoints (each write is validated and audited there):
 *   GET  /api/admin/restaurants                       stores (source picker)
 *   GET  /api/admin/menu-items?restaurantId=          items of one store
 *   POST /api/admin/menu-items/new | /:id             create / edit (price checked on the server)
 *   POST /api/admin/menu-items/bulk-update            stock, category (rename) for many items
 *   DELETE /api/admin/menu-items/:id/delete           delete
 * Categories are the items' category names; their order follows the lowest specs.sortOrder (utils/menuSort.js).
 */

interface Store {
  id: string;
  name: string;
  vendorType: string;
  isLocalVendor?: boolean;
  isActive?: boolean;
  itemCount?: number;
}

interface Item {
  id: string;
  restaurantId: string;
  name: string;
  price: number;
  description?: string | null;
  imageUrl?: string | null;
  category?: string | null;
  isVegetarian?: boolean;
  dietType?: string | null;
  isAvailable?: boolean;
  originalPrice?: number | null;
  specs?: Record<string, unknown> | null;
}

type Source = 'restaurants' | 'vendors' | 'others';

const LOCAL_VENDOR_TYPES = ['LOCAL_VENDOR', 'LOCAL', 'STALL'];
const isStall = (s: Store) => LOCAL_VENDOR_TYPES.includes(String(s.vendorType || '').toUpperCase()) || s.isLocalVendor === true;
const isRestaurant = (s: Store) => !isStall(s) && ['RESTAURANT', ''].includes(String(s.vendorType || 'RESTAURANT').toUpperCase());
const sourceOf = (s: Store): Source => (isStall(s) ? 'vendors' : isRestaurant(s) ? 'restaurants' : 'others');
/** Food stores show veg / non-veg. */
const isFoodSource = (src: Source) => src === 'restaurants' || src === 'vendors';

const UNCATEGORISED = 'Uncategorised';
const catOf = (i: Item) => (i.category && i.category.trim()) || UNCATEGORISED;
const sortOrderOf = (i: Item) => { const n = Number((i.specs || {}).sortOrder); return Number.isFinite(n) ? n : Infinity; };
const imgSrc = (url?: string | null) => (!url ? '' : /^(https?:|data:|blob:)/.test(url) ? url : `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`);
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const STORE_KEY = 'zenvy_admin_catalogue_store';

const dietLabel = (i: Item) => {
  const d = i.dietType || (i.isVegetarian === false ? 'nonveg' : 'veg');
  return d === 'nonveg' ? 'Non-veg' : d === 'egg' ? 'Egg' : 'Veg';
};

export default function CataloguePage() {
  const { isAuthed } = useAdminAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [stores, setStores] = useState<Store[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);
  const [storesError, setStoresError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>('restaurants');
  const [storeId, setStoreId] = useState<string>('');

  const [items, setItems] = useState<Item[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [stock, setStock] = useState<'all' | 'in' | 'out'>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const wantNew = useRef(false);
  const [pendingNew, setPendingNew] = useState(false);

  // ── Stores ──
  const loadStores = useCallback(async () => {
    setStoresLoading(true);
    setStoresError(null);
    try {
      const list = await adminRequest<any[]>('/api/admin/restaurants');
      setStores((Array.isArray(list) ? list : []).map(r => ({
        id: String(r.id || r._id),
        name: String(r.name || 'Store'),
        vendorType: String(r.vendorType || 'RESTAURANT'),
        isLocalVendor: !!r.isLocalVendor,
        isActive: r.isActive !== false,
        itemCount: typeof r.menuItemCount === 'number' ? r.menuItemCount : typeof r.itemCount === 'number' ? r.itemCount : undefined,
      })));
    } catch (e) {
      setStoresError(errText(e, 'Could not load stores.'));
    } finally {
      setStoresLoading(false);
    }
  }, []);

  useEffect(() => { if (isAuthed) loadStores(); }, [isAuthed, loadStores]);

  // ?store=<id> or the last store used; ?new=1 opens "Add item" once a store is picked.
  useEffect(() => {
    if (stores.length === 0 || storeId) return;
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('new') === '1') { wantNew.current = true; setPendingNew(true); }
    let id = qs.get('store') || '';
    if (!id) { try { id = localStorage.getItem(STORE_KEY) || ''; } catch { /* ignore */ } }
    const hit = stores.find(s => s.id === id);
    if (hit) { setSource(sourceOf(hit)); setStoreId(hit.id); }
  }, [stores, storeId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (storeId) url.searchParams.set('store', storeId); else url.searchParams.delete('store');
    url.searchParams.delete('new');
    window.history.replaceState(window.history.state, '', url.toString());
    if (storeId) { try { localStorage.setItem(STORE_KEY, storeId); } catch { /* ignore */ } }
  }, [storeId]);

  const storesInSource = useMemo(
    () => stores.filter(s => sourceOf(s) === source).sort((a, b) => (source === 'others' ? a.vendorType.localeCompare(b.vendorType) : 0) || a.name.localeCompare(b.name)),
    [stores, source],
  );
  const store = stores.find(s => s.id === storeId) || null;

  // ── Items ──
  const loadItems = useCallback(async (quiet = false) => {
    if (!storeId) { setItems([]); return; }
    if (!quiet) { setItemsLoading(true); setItemsError(null); }
    try {
      const list = await adminRequest<any[]>(`/api/admin/menu-items?restaurantId=${encodeURIComponent(storeId)}`);
      setItems((Array.isArray(list) ? list : []).map(i => ({ ...i, id: String(i.id || i._id) })));
      setItemsError(null);
    } catch (e) {
      if (!quiet) setItemsError(errText(e, 'Could not load items.'));
    } finally {
      if (!quiet) setItemsLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    setSelected([]); setCategory(''); setSearch('');
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (wantNew.current && storeId && !itemsLoading) { wantNew.current = false; setPendingNew(false); setEditing('new'); }
  }, [storeId, itemsLoading]);

  // Products changed elsewhere (store app, another admin): refresh quietly.
  useLiveSync(['product'], () => { loadItems(true); }, { enabled: isAuthed && !!storeId });

  const categories = useMemo(() => {
    const rank = new Map<string, number>();
    items.forEach(i => { const c = catOf(i); rank.set(c, Math.min(rank.get(c) ?? Infinity, sortOrderOf(i))); });
    return Array.from(rank.keys()).sort((a, b) => (rank.get(a)! - rank.get(b)!) || a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(i =>
      (!category || catOf(i) === category) &&
      (stock === 'all' || (stock === 'in' ? i.isAvailable !== false : i.isAvailable === false)) &&
      (!q || i.name.toLowerCase().includes(q) || String(i.description || '').toLowerCase().includes(q)));
  }, [items, search, category, stock]);

  const patchLocal = (id: string, patch: Partial<Item>) => setItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)));

  const saveItem = async (id: string, body: Record<string, unknown>) => {
    const saved = await adminRequest<any>(`/api/admin/menu-items/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(body) });
    return { ...saved, id: String(saved.id || saved._id) } as Item;
  };

  const toggleStock = async (item: Item, next: boolean) => {
    patchLocal(item.id, { isAvailable: next });
    try {
      const saved = await saveItem(item.id, { isAvailable: next });
      patchLocal(item.id, saved);
    } catch (e) {
      patchLocal(item.id, { isAvailable: item.isAvailable });
      toast.error(errText(e, 'Could not change the stock.'));
    }
  };

  const savePrice = async (item: Item, price: number) => {
    const saved = await saveItem(item.id, { price });
    patchLocal(item.id, saved);
    toast.success(`${item.name}: price is now ${formatINR(saved.price)}.`);
  };

  const deleteItem = async (item: Item) => {
    if (!(await confirm({ title: `Delete ${item.name}?`, description: 'It disappears from the store in the customer app at once. This cannot be undone.', tone: 'danger' }))) return;
    setBusy(item.id);
    try {
      await adminRequest(`/api/admin/menu-items/${encodeURIComponent(item.id)}/delete`, { method: 'DELETE' });
      setItems(prev => prev.filter(i => i.id !== item.id));
      setSelected(prev => prev.filter(id => id !== item.id));
      toast.success(`${item.name} deleted.`);
    } catch (e) {
      toast.error(errText(e, 'Could not delete the item.'));
    } finally {
      setBusy(null);
    }
  };

  const bulkStock = async (ids: string[], isAvailable: boolean, label?: string) => {
    if (!ids.length) return;
    setBusy('bulk');
    try {
      await adminRequest('/api/admin/menu-items/bulk-update', { method: 'POST', body: JSON.stringify({ ids, patch: { isAvailable } }) });
      setItems(prev => prev.map(i => (ids.includes(i.id) ? { ...i, isAvailable } : i)));
      toast.success(`${label || `${formatNumber(ids.length)} ${ids.length === 1 ? 'item' : 'items'}`} marked ${isAvailable ? 'in stock' : 'out of stock'}.`);
      setSelected([]);
    } catch (e) {
      toast.error(errText(e, 'Could not update the items.'));
    } finally {
      setBusy(null);
    }
  };

  const bulkDelete = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!(await confirm({
      title: `Delete ${formatNumber(ids.length)} ${ids.length === 1 ? 'item' : 'items'}?`,
      description: 'They disappear from the store in the customer app at once. This cannot be undone.',
      confirmLabel: `Delete ${formatNumber(ids.length)}`,
      tone: 'danger',
    }))) return;
    setBusy('bulk');
    let done = 0;
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await adminRequest(`/api/admin/menu-items/${encodeURIComponent(id)}/delete`, { method: 'DELETE' });
        done++;
      } catch {
        failed.push(id);
      }
    }
    setItems(prev => prev.filter(i => !ids.includes(i.id) || failed.includes(i.id)));
    setSelected(failed);
    setBusy(null);
    if (failed.length) toast.error(`${done} deleted, ${failed.length} could not be deleted. They are still selected.`);
    else toast.success(`${done} ${done === 1 ? 'item' : 'items'} deleted.`);
  };

  if (!isAuthed) return null;

  const food = isFoodSource(source);
  const columns: Column<Item>[] = [
    {
      key: 'name',
      header: 'Item',
      sortValue: i => i.name,
      cell: i => (
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-surface-2 text-fg-subtle">
            <Thumb url={i.imageUrl} size={16} />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{i.name}</p>
            {i.description && <p className="max-w-[360px] truncate text-xs text-fg-muted">{i.description}</p>}
          </div>
        </div>
      ),
    },
    { key: 'category', header: 'Category', sortValue: i => catOf(i), hideBelow: 'lg', cell: i => <span className={i.category ? 'text-fg' : 'text-fg-subtle'}>{catOf(i)}</span> },
    ...(food ? [{
      key: 'diet', header: 'Type', hideBelow: 'xl' as const, sortValue: (i: Item) => dietLabel(i),
      cell: (i: Item) => <Badge tone={dietLabel(i) === 'Veg' ? 'success' : dietLabel(i) === 'Egg' ? 'warning' : 'danger'} dot>{dietLabel(i)}</Badge>,
    }] : []),
    { key: 'price', header: 'Price', align: 'right', width: '140px', sortValue: i => Number(i.price), cell: i => <PriceCell item={i} onSave={savePrice} /> },
    {
      key: 'stock', header: 'In stock', align: 'center', width: '90px', sortValue: i => i.isAvailable !== false,
      cell: i => (
        <div className="flex justify-center" data-row-stop>
          <Switch size="sm" checked={i.isAvailable !== false} onChange={next => toggleStock(i, next)} disabled={busy === 'bulk'} />
          <span className="sr-only">{i.isAvailable !== false ? 'In stock' : 'Out of stock'}</span>
        </div>
      ),
    },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', width: '88px',
      cell: i => (
        <div className="flex justify-end gap-0.5">
          <IconButton label={`Edit ${i.name}`} size="sm" onClick={() => setEditing(i)}><IconEdit size={14} /></IconButton>
          <IconButton label={`Delete ${i.name}`} size="sm" disabled={busy === i.id} onClick={() => deleteItem(i)} className="hover:text-danger-text"><IconTrash size={14} /></IconButton>
        </div>
      ),
    },
  ];

  const sourceOptions: { value: Source; label: string; count?: number }[] = [
    { value: 'restaurants', label: 'Restaurants', count: stores.filter(s => sourceOf(s) === 'restaurants').length },
    { value: 'vendors', label: 'Local vendors', count: stores.filter(s => sourceOf(s) === 'vendors').length },
    { value: 'others', label: 'Others section', count: stores.filter(s => sourceOf(s) === 'others').length },
  ];

  const inStockCount = items.filter(i => i.isAvailable !== false).length;

  return (
    <div>
      <PageHeader
        title="Catalogue"
        description="Add, edit and delete the items customers can order, for any restaurant, local vendor or Others section store."
        actions={
          store ? (
            <>
              <Button leftIcon={<IconLayers size={14} />} onClick={() => setCatsOpen(true)} disabled={items.length === 0}>Categories</Button>
              <Button variant="primary" leftIcon={<IconPlus size={14} />} onClick={() => { setNewCategory(null); setEditing('new'); }}>Add item</Button>
            </>
          ) : undefined
        }
      />

      {/* Source picker: type of store, then the store */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-4 p-4">
          <div>
            <p className="mb-1 text-sm font-medium text-fg">Section</p>
            <SegmentedControl ariaLabel="Section" value={source} onChange={v => { setSource(v); setStoreId(''); }} options={sourceOptions} />
          </div>
          <Field label={source === 'others' ? 'Category and store' : 'Store'} className="min-w-[260px] flex-1 sm:max-w-md">
            <Select value={storeId} onChange={e => setStoreId(e.target.value)} disabled={storesLoading || storesInSource.length === 0}>
              <option value="">{storesLoading ? 'Loading stores…' : storesInSource.length ? 'Pick a store' : 'No stores in this section'}</option>
              {source === 'others'
                ? Array.from(new Set(storesInSource.map(s => s.vendorType))).map(type => (
                    <optgroup key={type} label={humanize(type)}>
                      {storesInSource.filter(s => s.vendorType === type).map(s => (
                        <option key={s.id} value={s.id}>{s.name}{s.isActive ? '' : ' (hidden)'}</option>
                      ))}
                    </optgroup>
                  ))
                : storesInSource.map(s => <option key={s.id} value={s.id}>{s.name}{s.isActive ? '' : ' (hidden)'}</option>)}
            </Select>
          </Field>
          {store && (
            <p className="pb-1.5 text-sm text-fg-muted">
              {formatNumber(items.length)} items · {formatNumber(inStockCount)} in stock
              {!store.isActive && <> · <span className="text-warning-text">store hidden from customers</span></>}
              {' · '}<Link href={`/restaurants?store=${encodeURIComponent(store.id)}`} className="text-accent-text hover:underline">Store settings</Link>
            </p>
          )}
        </div>
        {storesError && <div className="px-4 pb-4"><Notice tone="danger" action={<Button size="sm" onClick={loadStores}>Try again</Button>}>{storesError}</Notice></div>}
      </Card>

      {!store ? (
        <Card>
          {storesLoading ? <LoadingState label="Loading stores…" /> : storesError ? <ErrorState message={storesError} onRetry={loadStores} /> : (
            <EmptyState
              title={pendingNew ? 'Pick the store for the new item' : 'Pick a store'}
              description={pendingNew ? 'Choose a section and the store above; the Add item form opens right after.' : 'Choose a section and a store above to see and edit its items.'}
            />
          )}
        </Card>
      ) : (
        <>
          <Toolbar
            end={
              <Menu
                label="More"
                trigger={p => <IconButton {...p} label="More actions" variant="secondary"><IconMore size={16} /></IconButton>}
                items={[
                  { label: 'Mark all shown in stock', onSelect: () => bulkStock(filtered.map(i => i.id), true, 'All shown items') , disabled: filtered.length === 0 },
                  { label: 'Mark all shown out of stock', onSelect: () => bulkStock(filtered.map(i => i.id), false, 'All shown items'), disabled: filtered.length === 0 },
                  'separator',
                  { label: 'Bulk import (CSV) in Stores', href: `/restaurants?store=${encodeURIComponent(store.id)}&tab=menu` },
                ]}
              />
            }
          >
            <SearchInput value={search} onChange={setSearch} placeholder="Search items" />
            <Select aria-label="Category" value={category} onChange={e => setCategory(e.target.value)} className="w-auto min-w-[170px]">
              <option value="">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
            <SegmentedControl
              ariaLabel="Stock"
              value={stock}
              onChange={setStock}
              options={[{ value: 'all', label: 'All' }, { value: 'in', label: 'In stock' }, { value: 'out', label: 'Out of stock' }]}
            />
          </Toolbar>

          <BulkBar count={selected.length} onClear={() => setSelected([])}>
            <Button size="sm" disabled={busy === 'bulk'} onClick={() => bulkStock(selected, true)}>Mark in stock</Button>
            <Button size="sm" disabled={busy === 'bulk'} onClick={() => bulkStock(selected, false)}>Mark out of stock</Button>
            <Button size="sm" variant="destructive" leftIcon={<IconTrash size={14} />} loading={busy === 'bulk'} onClick={bulkDelete}>Delete</Button>
          </BulkBar>

          <DataTable
            caption={`Items of ${store.name}`}
            columns={columns}
            rows={filtered}
            rowKey={i => i.id}
            loading={itemsLoading}
            error={itemsError}
            onRetry={() => loadItems()}
            selection={{ selected, onChange: setSelected }}
            pageSize={50}
            noun="items"
            resetPageKey={`${storeId}|${search}|${category}|${stock}`}
            empty={items.length === 0
              ? { title: 'No items yet', description: 'Add the first item customers can order from this store.', action: <Button variant="primary" leftIcon={<IconPlus size={14} />} onClick={() => setEditing('new')}>Add item</Button> }
              : { title: 'No items match', description: 'Change the search or filters.' }}
          />
        </>
      )}

      {store && editing && (
        <ItemModal
          key={editing === 'new' ? `new-${newCategory || ''}` : editing.id}
          store={store}
          food={food}
          item={editing === 'new' ? null : editing}
          categories={categories.filter(c => c !== UNCATEGORISED)}
          defaultCategory={editing === 'new' ? (newCategory ?? (category && category !== UNCATEGORISED ? category : '')) : ''}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            setItems(prev => (created ? [...prev, saved] : prev.map(i => (i.id === saved.id ? { ...i, ...saved } : i))));
            toast.success(created ? `${saved.name} added.` : `${saved.name} saved.`);
            setEditing(null);
          }}
        />
      )}

      {store && (
        <CategoriesModal
          open={catsOpen}
          onClose={() => setCatsOpen(false)}
          items={items}
          categories={categories}
          onAdd={name => { setCatsOpen(false); setNewCategory(name); setEditing('new'); }}
          onChanged={() => loadItems(true)}
          bulkStock={bulkStock}
        />
      )}
    </div>
  );
}

/** Item photo, or a placeholder when there is none or it fails to load. */
function Thumb({ url, size, alt = '' }: { url?: string | null; size: number; alt?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [url]);
  if (!url || failed) return <IconImage size={size} />;
  return <img src={imgSrc(url)} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className="h-full w-full object-cover" />;
}

/* ───────────────────────── Inline price edit ───────────────────────── */

function PriceCell({ item, onSave }: { item: Item; onSave: (item: Item, price: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const start = () => { setValue(String(item.price ?? '')); setError(null); setEditing(true); };
  const commit = async () => {
    const n = Number(value);
    if (value.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100000) { setError('₹0 to ₹1,00,000'); return; }
    const rounded = Math.round(n * 100) / 100;
    if (rounded === Number(item.price)) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(item, rounded);
      setEditing(false);
    } catch (e) {
      setError(errText(e, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };
  if (!editing) {
    return (
      <button type="button" onClick={start} className="group inline-flex items-center gap-1.5 rounded px-1 py-0.5 tabular-nums hover:bg-surface-2" title="Change price">
        <span className="font-medium text-fg">{formatINR(item.price)}</span>
        {item.originalPrice ? <span className="text-xs text-fg-subtle line-through">{formatINR(item.originalPrice)}</span> : null}
        <IconEdit size={12} className="text-fg-subtle opacity-0 group-hover:opacity-100" />
      </button>
    );
  }
  return (
    <div className="ml-auto w-28" data-row-stop>
      <Input
        autoFocus
        prefix="₹"
        inputMode="decimal"
        aria-label={`Price of ${item.name}`}
        value={value}
        invalid={!!error}
        disabled={saving}
        onChange={e => { setValue(e.target.value); setError(null); }}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        onBlur={() => { if (!saving) commit(); }}
        className="h-7 text-right"
      />
      {error && <p className="mt-0.5 text-right text-2xs text-danger-text">{error}</p>}
    </div>
  );
}

/* ───────────────────────── Add / edit item ───────────────────────── */

function ItemModal({ store, food, item, categories, defaultCategory, onClose, onSaved }: {
  store: Store;
  food: boolean;
  item: Item | null;
  categories: string[];
  defaultCategory: string;
  onClose: () => void;
  onSaved: (item: Item, created: boolean) => void;
}) {
  const [name, setName] = useState(item?.name || '');
  const [price, setPrice] = useState(item ? String(item.price ?? '') : '');
  const [mrp, setMrp] = useState(item?.originalPrice ? String(item.originalPrice) : '');
  const [cat, setCat] = useState(item?.category || defaultCategory || '');
  const [description, setDescription] = useState(item?.description || '');
  const [diet, setDiet] = useState<string>(item?.dietType || (item?.isVegetarian === false ? 'nonveg' : 'veg'));
  const [inStock, setInStock] = useState(item ? item.isAvailable !== false : true);
  const [imageUrl, setImageUrl] = useState(item?.imageUrl || '');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Enter the item name.';
    else if (name.trim().length > 200) e.name = 'Keep the name under 200 characters.';
    const p = Number(price);
    if (price.trim() === '' || !Number.isFinite(p) || p < 0 || p > 100000) e.price = 'Enter a price between ₹0 and ₹1,00,000.';
    if (mrp.trim() !== '') {
      const m = Number(mrp);
      if (!Number.isFinite(m) || m <= 0 || m > 100000) e.mrp = 'Enter a positive amount.';
      else if (Number.isFinite(p) && m < p) e.mrp = 'MRP cannot be lower than the price.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    setFormError(null);
    try {
      setImageUrl(await resizeAndUpload(file, 'item'));
    } catch (e) {
      setFormError(errText(e, 'The photo could not be uploaded.'));
    } finally {
      setUploading(false);
    }
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (saving || uploading || !validate()) return;
    setSaving(true);
    setFormError(null);
    const body: Record<string, unknown> = {
      name: name.trim(),
      price: Math.round(Number(price) * 100) / 100,
      category: cat.trim(),
      description: description.trim(),
      imageUrl: imageUrl || '',
      isAvailable: inStock,
      originalPrice: mrp.trim() === '' ? null : Number(mrp),
      ...(food ? { dietType: diet } : {}),
      ...(item ? {} : { restaurantId: store.id }),
    };
    // Only send fields that changed when editing, so a stale form never overwrites newer values.
    if (item) {
      if (body.name === item.name) delete body.name;
      if (body.price === Number(item.price)) delete body.price;
      if ((body.category as string) === (item.category || '')) delete body.category;
      if ((body.description as string) === (item.description || '')) delete body.description;
      if ((body.imageUrl as string) === (item.imageUrl || '')) delete body.imageUrl;
      if (body.isAvailable === (item.isAvailable !== false)) delete body.isAvailable;
      if ((body.originalPrice ?? null) === (item.originalPrice ?? null)) delete body.originalPrice;
      if (food && body.dietType === (item.dietType || (item.isVegetarian === false ? 'nonveg' : 'veg'))) delete body.dietType;
      if (Object.keys(body).length === 0) { onClose(); return; }
    }
    try {
      const saved = await adminRequest<any>(`/api/admin/menu-items/${item ? encodeURIComponent(item.id) : 'new'}`, { method: 'POST', body: JSON.stringify(body) });
      onSaved({ ...saved, id: String(saved.id || saved._id) }, !item);
    } catch (e) {
      setFormError(errText(e, 'Could not save the item.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!saving}
      size="lg"
      title={item ? `Edit ${item.name}` : 'Add item'}
      description={`${store.name} · ${humanize(store.vendorType)}`}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" type="submit" form="catalogue-item-form" loading={saving} disabled={uploading}>{item ? 'Save changes' : 'Add item'}</Button>
        </>
      }
    >
      <form id="catalogue-item-form" onSubmit={save} noValidate className="space-y-4">
        {formError && <Notice tone="danger">{formError}</Notice>}
        <div className="flex gap-4">
          <div className="shrink-0">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2 text-fg-subtle">
              <Thumb url={imageUrl} size={22} alt="Item photo" />
            </div>
            <div className="mt-2 flex flex-col gap-1">
              <label className={buttonClass('secondary', 'sm', uploading ? 'pointer-events-none opacity-50' : 'cursor-pointer')}>
                <IconUpload size={12} />{uploading ? 'Uploading…' : imageUrl ? 'Change' : 'Upload photo'}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploading} onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {imageUrl && <Button size="sm" variant="ghost" onClick={() => setImageUrl('')}>Remove</Button>}
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <Field label="Name" required error={errors.name}>
              <Input value={name} onChange={e => setName(e.target.value)} maxLength={200} data-autofocus />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Price" required error={errors.price}>
                <Input prefix="₹" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} />
              </Field>
              <Field label="MRP" optional error={errors.mrp} hint="Shown struck through when higher than the price.">
                <Input prefix="₹" inputMode="decimal" value={mrp} onChange={e => setMrp(e.target.value)} />
              </Field>
            </div>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" optional hint="Pick one or type a new name.">
            <Input list="catalogue-categories" value={cat} onChange={e => setCat(e.target.value)} maxLength={80} />
          </Field>
          {food ? (
            <Field label="Food type">
              <Select value={diet} onChange={e => setDiet(e.target.value)}>
                <option value="veg">Veg</option>
                <option value="nonveg">Non-veg</option>
                <option value="egg">Egg</option>
              </Select>
            </Field>
          ) : <div />}
        </div>
        <datalist id="catalogue-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
        <Field label="Description" optional>
          <Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} />
        </Field>
        <Switch checked={inStock} onChange={setInStock} label="In stock" description="Out-of-stock items stay listed but customers cannot add them to the cart." />
      </form>
    </Modal>
  );
}

/* ───────────────────────── Categories ───────────────────────── */

function CategoriesModal({ open, onClose, items, categories, onAdd, onChanged, bulkStock }: {
  open: boolean;
  onClose: () => void;
  items: Item[];
  categories: string[];
  onAdd: (name: string) => void;
  onChanged: () => void;
  bulkStock: (ids: string[], isAvailable: boolean, label?: string) => Promise<void>;
}) {
  const toast = useToast();
  const [order, setOrder] = useState<string[]>(categories);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const [adding, setAdding] = useState('');
  const [working, setWorking] = useState<string | null>(null);
  const [selectedCat, setSelectedCat] = useState<string[]>([]);

  useEffect(() => { if (open) { setOrder(categories); setRenaming(null); setAdding(''); setSelectedCat([]); } }, [open, categories]);

  const itemsIn = (c: string) => items.filter(i => catOf(i) === c);
  const orderChanged = order.join('\u0000') !== categories.join('\u0000');

  const move = (idx: number, dir: -1 | 1) => setOrder(prev => {
    const next = [...prev];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return prev;
    [next[idx], next[j]] = [next[j], next[idx]];
    return next;
  });

  const rename = async (from: string) => {
    const to = renameTo.trim();
    if (!to || to === from) { setRenaming(null); return; }
    setWorking(from);
    try {
      await adminRequest('/api/admin/menu-items/bulk-update', { method: 'POST', body: JSON.stringify({ ids: itemsIn(from).map(i => i.id), patch: { category: to } }) });
      toast.success(`Renamed to ${to}.`);
      setRenaming(null);
      onChanged();
    } catch (e) {
      toast.error(errText(e, 'Could not rename the category.'));
    } finally {
      setWorking(null);
    }
  };

  // Category order = lowest specs.sortOrder of its items: renumber every item, keeping item order inside each category.
  const saveOrder = async () => {
    setWorking('order');
    let failed = 0;
    for (const [ci, c] of order.entries()) {
      const list = itemsIn(c).sort((a, b) => (sortOrderOf(a) - sortOrderOf(b)) || a.name.localeCompare(b.name));
      for (const [ii, it] of list.entries()) {
        const sortOrder = (ci + 1) * 1000 + (ii + 1) * 10;
        if (sortOrderOf(it) === sortOrder) continue;
        try {
          await adminRequest(`/api/admin/menu-items/${encodeURIComponent(it.id)}`, { method: 'POST', body: JSON.stringify({ specs: { sortOrder } }) });
        } catch {
          failed++;
        }
      }
    }
    setWorking(null);
    onChanged();
    if (failed) toast.error(`The new order was saved for most items, but ${failed} could not be updated. Try again.`);
    else { toast.success('Category order saved.'); onClose(); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={working === null}
      size="md"
      title="Categories"
      description="Categories are the item groups customers see in this store. Use the arrows to change their order."
      footer={
        <>
          <Button onClick={onClose} disabled={working !== null}>Close</Button>
          <Button variant="primary" disabled={!orderChanged} loading={working === 'order'} onClick={saveOrder}>Save order</Button>
        </>
      }
    >
      <ul className="divide-y divide-line rounded-lg border border-line">
        {order.map((c, idx) => {
          const list = itemsIn(c);
          const inStock = list.filter(i => i.isAvailable !== false).length;
          return (
            <li key={c} className="flex items-center gap-2 px-3 py-2">
              <Checkbox
                aria-label={`Select ${c}`}
                checked={selectedCat.includes(c)}
                onChange={() => setSelectedCat(prev => (prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]))}
              />
              <div className="min-w-0 flex-1">
                {renaming === c ? (
                  <Input
                    autoFocus
                    aria-label={`New name for ${c}`}
                    value={renameTo}
                    maxLength={80}
                    onChange={e => setRenameTo(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') rename(c); if (e.key === 'Escape') setRenaming(null); }}
                    className="h-7"
                  />
                ) : (
                  <>
                    <p className="truncate text-sm font-medium text-fg">{c}</p>
                    <p className="text-xs text-fg-muted">{list.length} {list.length === 1 ? 'item' : 'items'} · {inStock} in stock</p>
                  </>
                )}
              </div>
              {renaming === c ? (
                <>
                  <Button size="sm" variant="primary" loading={working === c} onClick={() => rename(c)}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                </>
              ) : (
                <>
                  <IconButton size="sm" label={`Move ${c} up`} disabled={idx === 0 || working !== null} onClick={() => move(idx, -1)}><IconArrowUp size={14} /></IconButton>
                  <IconButton size="sm" label={`Move ${c} down`} disabled={idx === order.length - 1 || working !== null} onClick={() => move(idx, 1)}><IconArrowDown size={14} /></IconButton>
                  {c !== UNCATEGORISED && (
                    <IconButton size="sm" label={`Rename ${c}`} disabled={working !== null || orderChanged} title={orderChanged ? 'Save the new order first' : undefined} onClick={() => { setRenaming(c); setRenameTo(c); }}><IconEdit size={14} /></IconButton>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {selectedCat.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-sm">
          <span className="text-fg-muted">{selectedCat.length} selected:</span>
          <Button size="sm" onClick={async () => { await bulkStock(selectedCat.flatMap(c => itemsIn(c).map(i => i.id)), false, `Items in ${selectedCat.join(', ')}`); setSelectedCat([]); }}>Hide (mark out of stock)</Button>
          <Button size="sm" onClick={async () => { await bulkStock(selectedCat.flatMap(c => itemsIn(c).map(i => i.id)), true, `Items in ${selectedCat.join(', ')}`); setSelectedCat([]); }}>Show (mark in stock)</Button>
        </div>
      )}
      <p className="mt-2 text-xs text-fg-muted">To hide a whole category, mark its items out of stock. Customers then cannot order them until you show it again.</p>

      <form
        className="mt-4 flex items-end gap-2"
        onSubmit={e => { e.preventDefault(); const n = adding.trim(); if (n) onAdd(n); }}
      >
        <Field label="New category" hint="A category appears once it has an item. You will add its first item next." className="flex-1">
          <Input value={adding} onChange={e => setAdding(e.target.value)} maxLength={80} />
        </Field>
        <Button type="submit" disabled={!adding.trim()} className="mb-5">Add</Button>
      </form>
    </Modal>
  );
}
