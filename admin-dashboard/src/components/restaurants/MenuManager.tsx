"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DietType, Product, Store, adminRequest, dietOf, isBookingOnlyStore, isBookingStall, isLocalVendorType, mrpOf, readSpecs, storeId } from '@/app/restaurants/catalogue';
import { useLiveSync, useFreshIds, FRESH_ROW_CLASS, LiveEvent } from '@/lib/useLiveSync';
import { parseCsv, photoLinkNote, timeAgo } from './helpers';
import { ImagePicker, TagInput } from './inputs';
import { bulkUpdateItems, describeBulk, duplicateItemPayload } from './storeActions';
import {
  AutoWeightsNote, DetailDraft, OptionGroupsEditor, ProductDetailsEditor,
  detailsFromSpecs, serializeDetails, useChoiceGroups, validateOptions, variantMinPrice,
} from './ProductOptionsEditor';
import { API_URL } from '@/lib/config';
import {
  Button, Callout, Chip, ConfirmModal, EmptyState, Field, INPUT, MenuButton, Modal, Segmented, Skeleton, Toggle, cx, FOCUS_RING, useToast,
} from './ui';

const itemId = (p: Product) => p._id || p.id || '';
const sortOrderOf = (p: Product) => {
  const n = Number(readSpecs(p.specs).sortOrder);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
};
const UNCATEGORISED = 'Uncategorised';
const catOf = (p: Product) => (p.category || '').trim() || UNCATEGORISED;

async function inBatches<T>(items: T[], size: number, fn: (item: T, i: number) => Promise<void>, onProgress?: (done: number) => void) {
  let done = 0;
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map((item, j) => fn(item, i + j).finally(() => { done++; onProgress?.(done); })));
  }
}

/** The Menu tab of a store: categories, items, stock, reorder, bulk CSV add. */
export function MenuManager({ store }: { store: Store }) {
  const id = storeId(store);
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [stock, setStock] = useState<'all' | 'in' | 'out'>('all');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<Product[] | null>(null);
  const [reordering, setReordering] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const local = isLocalVendorType(store.vendorType);
  const bookingOnly = isBookingOnlyStore(store.vendorType);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setLoadError(''); }
    try {
      const data = await adminRequest<Product[]>(`/api/admin/menu-items?restaurantId=${encodeURIComponent(id)}`);
      setProducts(Array.isArray(data) ? data : []);
      setLoadError('');
    } catch (e) {
      if (!quiet) setLoadError(e instanceof Error ? e.message : 'Could not load the menu.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const { mark: markFresh, isFresh } = useFreshIds();
  const editingRef = useRef<string | null>(null);
  editingRef.current = editing && editing !== 'new' ? itemId(editing) : null;
  const mine = (e: LiveEvent) => e.type === 'product' && (e.storeId !== undefined ? String(e.storeId) === id : e.id === null);
  useLiveSync(['product'], (events, { reconnect }) => {
    const relevant = events.filter(mine);
    if (!reconnect && !relevant.length) return;
    load(true);
    if (reconnect) return;
    markFresh(relevant.filter(e => e.action !== 'deleted').map(e => e.id));
    const open = editingRef.current;
    if (open && relevant.some(e => String(e.id) === open && e.scope !== 'stock')) {
      toast.info('This item was just changed elsewhere (another admin or the partner app). Saving now overwrites that change.');
    }
  });

  const update = (p: Product, saved: Partial<Product>) => setProducts(prev => prev.map(x => (itemId(x) === itemId(p) ? { ...x, ...saved } : x)));

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) {
      const c = catOf(p);
      map.set(c, Math.min(map.get(c) ?? Number.POSITIVE_INFINITY, sortOrderOf(p)));
    }
    return Array.from(map.entries()).sort((a, b) => (a[1] - b[1]) || a[0].localeCompare(b[0])).map(([c]) => c);
  }, [products]);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = products.filter(p => {
      if (category !== 'All' && catOf(p) !== category) return false;
      if (stock === 'in' && !p.isAvailable) return false;
      if (stock === 'out' && p.isAvailable) return false;
      return !q || [p.name, p.category, p.description].some(v => String(v || '').toLowerCase().includes(q));
    });
    return categories
      .map(c => ({ category: c, items: list.filter(p => catOf(p) === c).sort((a, b) => (sortOrderOf(a) - sortOrderOf(b)) || a.name.localeCompare(b.name)) }))
      .filter(g => g.items.length);
  }, [products, categories, search, category, stock]);

  const visibleIds = useMemo(() => grouped.flatMap(g => g.items.map(itemId)), [grouped]);
  const outCount = products.filter(p => !p.isAvailable).length;
  const filtering = !!search.trim() || category !== 'All' || stock !== 'all';

  // ── single-item actions ──
  const setStockState = async (p: Product, isAvailable: boolean, until: Date | null = null) => {
    const pid = itemId(p);
    if (busy[pid]) return;
    setBusy(b => ({ ...b, [pid]: true }));
    try {
      const saved = await adminRequest<Product>(`/api/admin/menu-items/${pid}`, { method: 'POST', body: JSON.stringify({ isAvailable, outOfStockUntil: until ? until.toISOString() : null }) });
      update(p, saved);
      toast.success(isAvailable ? `${p.name} is back in stock.` : until ? `${p.name} is out of stock until ${until.toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', weekday: 'short' })}.` : `${p.name} marked out of stock.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update stock.');
    } finally {
      setBusy(b => ({ ...b, [pid]: false }));
    }
  };

  const duplicate = async (p: Product) => {
    const specs = { ...readSpecs(p.specs) };
    const order = sortOrderOf(p);
    if (Number.isFinite(order)) specs.sortOrder = order + 0.5; else delete specs.sortOrder;
    try {
      const saved = await adminRequest<Product>('/api/admin/menu-items/new', {
        method: 'POST',
        body: JSON.stringify({ ...duplicateItemPayload(p, id), name: `${p.name} (copy)`.slice(0, 200), specs }),
      });
      setProducts(prev => [...prev, saved]);
      markFresh([itemId(saved)]);
      toast.success(`Duplicated as “${saved.name}”.`, { label: 'Edit', onClick: () => setEditing(saved) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not duplicate the item.');
    }
  };

  const deleteItems = async (items: Product[]) => {
    // Tracked by id: two items can share a name, and a name match hid a deleted twin (or kept a failed one).
    const failedIds = new Set<string>();
    await inBatches(items, 4, async p => {
      try { await adminRequest(`/api/admin/menu-items/${itemId(p)}/delete`, { method: 'DELETE' }); }
      catch { failedIds.add(itemId(p)); }
    });
    const removed = new Set(items.map(itemId).filter(id => !failedIds.has(id)));
    setProducts(prev => prev.filter(p => !removed.has(itemId(p))));
    // Keep the failed ones selected so the admin can retry them.
    setSelected(new Set(failedIds));
    setConfirmDelete(null);
    const failedNames = items.filter(p => failedIds.has(itemId(p))).map(p => p.name);
    if (failedNames.length) toast.error(`Could not delete: ${failedNames.join(', ')}`);
    else toast.success(items.length === 1 ? `${items[0].name} deleted.` : `${items.length} items deleted.`);
  };

  // ── bulk ──
  const selectedItems = products.filter(p => selected.has(itemId(p)));
  const bulkPatch = async (patch: Record<string, unknown>, label: string) => {
    const items = selectedItems;
    try {
      // Chunks of 300 ids (the endpoint's limit), each chunk in one server transaction.
      const result = await bulkUpdateItems(items.map(itemId), patch);
      const ok = result.count;
      const okIds = new Set(result.okIds);
      setProducts(prev => prev.map(p => (okIds.has(itemId(p)) ? { ...p, ...(patch as Partial<Product>) } : p)));
      if (ok === items.length) toast.success(`${label}: ${ok} item${ok === 1 ? '' : 's'}.`);
      else toast.error(`${label}: ${describeBulk(result, items.length, 'updated', 'item')} Reloading the menu.`);
      load(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the items.');
    }
    setSelected(new Set());
  };
  const [moveTo, setMoveTo] = useState<string | null>(null);

  // ── reorder (specs.sortOrder) ──
  const persistOrder = async (ordered: Product[]) => {
    const changes = ordered.map((p, i) => ({ p, order: (i + 1) * 10 })).filter(({ p, order }) => sortOrderOf(p) !== order);
    if (!changes.length) return;
    setReordering(true);
    setProducts(prev => prev.map(p => {
      const c = changes.find(x => itemId(x.p) === itemId(p));
      return c ? { ...p, specs: { ...readSpecs(p.specs), sortOrder: c.order } } : p;
    }));
    let failed = 0;
    await inBatches(changes, 4, async ({ p, order }) => {
      try { await adminRequest(`/api/admin/menu-items/${itemId(p)}`, { method: 'POST', body: JSON.stringify({ specs: { sortOrder: order } }) }); }
      catch { failed++; }
    });
    setReordering(false);
    if (failed) { toast.error(`${failed} item(s) could not be moved. Reloading the menu.`); load(true); }
  };
  const fullOrder = () => categories.flatMap(c => products.filter(p => catOf(p) === c).sort((a, b) => (sortOrderOf(a) - sortOrderOf(b)) || a.name.localeCompare(b.name)));
  const moveItem = (p: Product, dir: -1 | 1) => {
    const list = fullOrder();
    const idx = list.findIndex(x => itemId(x) === itemId(p));
    const target = idx + dir;
    if (target < 0 || target >= list.length || catOf(list[target]) !== catOf(p)) return;
    [list[idx], list[target]] = [list[target], list[idx]];
    persistOrder(list);
  };
  const moveCategory = (c: string, dir: -1 | 1) => {
    const cats = [...categories];
    const i = cats.indexOf(c);
    const j = i + dir;
    if (j < 0 || j >= cats.length) return;
    [cats[i], cats[j]] = [cats[j], cats[i]];
    const byCat = (cat: string) => products.filter(p => catOf(p) === cat).sort((a, b) => (sortOrderOf(a) - sortOrderOf(b)) || a.name.localeCompare(b.name));
    persistOrder(cats.flatMap(byCat));
  };

  const saveItem = async (payload: Record<string, unknown>, existing: Product | null) => {
    const saved = await adminRequest<Product>(`/api/admin/menu-items/${existing ? itemId(existing) : 'new'}`, {
      method: 'POST',
      body: JSON.stringify(existing ? payload : { ...payload, restaurantId: id }),
    });
    setProducts(prev => (existing ? prev.map(p => (itemId(p) === itemId(existing) ? { ...p, ...saved } : p)) : [...prev, saved]));
    markFresh([itemId(saved)]);
    return saved;
  };

  const toggleSel = (pid: string) => setSelected(prev => { const n = new Set(prev); if (n.has(pid)) n.delete(pid); else n.add(pid); return n; });
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(x => selected.has(x));

  return (
    <div className="space-y-4">
      {local && (isBookingStall(store)
        ? <Callout tone="amber">In-Campus Booking menu: students pre-book these in ZCS, pay the stall by UPI and collect at the counter. The stall can also mark items in or out of stock from the ZCS Campus Stall app.</Callout>
        : <Callout tone="amber">Stall menu: customers order these in ZCS and pay the stall cash on delivery. The stall can also mark items in or out of stock from ZCS Vendor.</Callout>)}
      {bookingOnly && <Callout tone="sky">Booking-only service: these prices are what service bookings are charged (print jobs use the per-page and binding rows).</Callout>}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items" aria-label="Search items" className={cx(INPUT, 'min-w-[180px] flex-1 py-2')} />
        <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Category" className={cx(INPUT.replace('w-full ', ''), 'w-auto py-2')}>
          <option value="All">All categories ({products.length})</option>
          {categories.map(c => <option key={c} value={c}>{c} ({products.filter(p => catOf(p) === c).length})</option>)}
        </select>
        <Segmented size="sm" label="Stock" value={stock} onChange={setStock} options={[{ value: 'all', label: 'All' }, { value: 'in', label: 'In stock' }, { value: 'out', label: `Out${outCount ? ` (${outCount})` : ''}` }]} />
        <div className="ml-auto flex gap-2">
          <Button onClick={() => setCsvOpen(true)}>Bulk add (CSV)</Button>
          <Button variant="primary" onClick={() => setEditing('new')}>+ Add item</Button>
        </div>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-success/30 bg-surface px-3 py-2 text-sm" role="region" aria-label="Bulk actions">
          <span className="font-semibold text-success-text">{selected.size} selected</span>
          <Button size="sm" onClick={() => bulkPatch({ isAvailable: true, outOfStockUntil: null }, 'Marked in stock')}>In stock</Button>
          <Button size="sm" onClick={() => bulkPatch({ isAvailable: false }, 'Marked out of stock')}>Out of stock</Button>
          <Button size="sm" onClick={() => setMoveTo('')}>Move to category…</Button>
          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(selectedItems)}>Delete</Button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-xs font-semibold text-fg-muted hover:text-fg">Clear</button>
        </div>
      )}

      {loadError && (
        <Callout tone="red"><span className="flex items-center justify-between gap-3">{loadError}<button type="button" onClick={() => load()} className="font-semibold underline">Retry</button></span></Callout>
      )}

      {loading ? (
        <div className="space-y-2" role="status" aria-label="Loading menu">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="flex items-center gap-3 rounded-xl border border-line p-3"><Skeleton className="h-12 w-12" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-1/5" /></div><Skeleton className="h-6 w-16" /></div>)}
        </div>
      ) : !loadError && products.length === 0 ? (
        <EmptyState
          icon=""
          title="No menu yet"
          body={`Customers cannot order until ${store.name} has items. Add them one by one, or paste a whole menu from a spreadsheet.`}
          action={<><Button variant="primary" onClick={() => setEditing('new')}>+ Add first item</Button><Button onClick={() => setCsvOpen(true)}>Paste a menu (CSV)</Button></>}
        />
      ) : !loadError && grouped.length === 0 ? (
        <EmptyState title="No items match" body="Try another search, category or stock filter." action={<Button onClick={() => { setSearch(''); setCategory('All'); setStock('all'); }}>Clear filters</Button>} />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 px-1 text-xs text-fg-muted">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={allVisibleSelected} onChange={e => setSelected(e.target.checked ? new Set(visibleIds) : new Set())} aria-label="Select all visible items" />
              Select all {filtering ? 'shown' : ''}
            </label>
            <span>{reordering ? 'Saving order…' : filtering ? 'Clear filters to reorder' : 'Use ↑ ↓ to reorder'}</span>
          </div>
          {grouped.map((g, gi) => {
            const isCollapsed = collapsed.has(g.category);
            const inStock = g.items.filter(p => p.isAvailable).length;
            return (
              <section key={g.category} className="overflow-hidden rounded-xl border border-line" aria-labelledby={`cat-${gi}`}>
                <header className="flex items-center gap-2 bg-surface-2/60 px-3 py-2">
                  <button type="button" onClick={() => setCollapsed(prev => { const n = new Set(prev); if (n.has(g.category)) n.delete(g.category); else n.add(g.category); return n; })} aria-expanded={!isCollapsed} className={cx('flex flex-1 items-center gap-2 text-left', FOCUS_RING)}>
                    <span aria-hidden className={cx('text-xs text-fg-muted transition-transform', isCollapsed ? '-rotate-90' : '')}>▾</span>
                    <h3 id={`cat-${gi}`} className="text-sm font-semibold">{g.category}</h3>
                    <span className="text-xs text-fg-muted">{g.items.length} item{g.items.length === 1 ? '' : 's'}{inStock < g.items.length ? ` · ${g.items.length - inStock} out` : ''}</span>
                  </button>
                  {!filtering && (
                    <span className="flex gap-1">
                      <button type="button" disabled={reordering || categories.indexOf(g.category) === 0} onClick={() => moveCategory(g.category, -1)} aria-label={`Move ${g.category} up`} className={cx('rounded px-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30', FOCUS_RING)}>↑</button>
                      <button type="button" disabled={reordering || categories.indexOf(g.category) === categories.length - 1} onClick={() => moveCategory(g.category, 1)} aria-label={`Move ${g.category} down`} className={cx('rounded px-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30', FOCUS_RING)}>↓</button>
                    </span>
                  )}
                </header>
                {!isCollapsed && (
                  <ul className="divide-y divide-white/5">
                    {g.items.map((p, i) => (
                      <ItemRow
                        key={itemId(p)}
                        p={p}
                        fresh={isFresh(itemId(p))}
                        busy={!!busy[itemId(p)]}
                        selected={selected.has(itemId(p))}
                        onSelect={() => toggleSel(itemId(p))}
                        canUp={!filtering && !reordering && i > 0}
                        canDown={!filtering && !reordering && i < g.items.length - 1}
                        onMove={dir => moveItem(p, dir)}
                        onEdit={() => setEditing(p)}
                        onDuplicate={() => duplicate(p)}
                        onDelete={() => setConfirmDelete([p])}
                        onStock={setStockState}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          <p className="px-1 text-xs text-fg-subtle">The customer app and partner apps show categories and items in this order.</p>
        </div>
      )}

      {editing && (
        <ItemEditor
          initial={editing === 'new' ? null : editing}
          storeName={store.name}
          vendorType={store.vendorType}
          categories={categories.filter(c => c !== UNCATEGORISED)}
          bookingOnly={bookingOnly}
          nextSortOrder={(products.reduce((m, p) => Math.max(m, Number.isFinite(sortOrderOf(p)) ? sortOrderOf(p) : 0), 0) || 0) + 10}
          onClose={() => setEditing(null)}
          onSave={saveItem}
          onSaved={(saved, again) => {
            toast.success(editing === 'new' ? `${saved.name} added.` : `${saved.name} saved.`);
            setEditing(again ? 'new' : null);
          }}
        />
      )}
      {csvOpen && (
        <CsvImportModal
          storeId={id}
          existing={products}
          allowFree={bookingOnly}
          onClose={() => setCsvOpen(false)}
          onImported={items => { setProducts(prev => [...prev, ...items]); markFresh(items.map(itemId)); }}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title={confirmDelete.length === 1 ? `Delete ${confirmDelete[0].name}?` : `Delete ${confirmDelete.length} items?`}
          body={<><p>This removes {confirmDelete.length === 1 ? 'it' : 'them'} from the menu permanently. Past orders keep their history.</p><p className="text-fg-muted">To hide an item for now, mark it out of stock instead.</p></>}
          actionLabel="Delete"
          tone="danger"
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => deleteItems(confirmDelete)}
        />
      )}
      {moveTo !== null && (
        <Modal title={`Move ${selected.size} item${selected.size === 1 ? '' : 's'}`} size="sm" onClose={() => setMoveTo(null)} footer={<>
          <Button onClick={() => setMoveTo(null)}>Cancel</Button>
          <Button variant="primary" disabled={!moveTo.trim()} onClick={() => { const c = moveTo.trim(); setMoveTo(null); bulkPatch({ category: c }, `Moved to ${c}`); }}>Move</Button>
        </>}>
          <Field label="Category" help="Pick an existing category or type a new one.">
            {({ id: fid, msgId }) => (<>
              <input id={fid} data-autofocus aria-describedby={msgId} list="move-cats" className={INPUT} value={moveTo} onChange={e => setMoveTo(e.target.value)} />
              <datalist id="move-cats">{categories.filter(c => c !== UNCATEGORISED).map(c => <option key={c} value={c} />)}</datalist>
            </>)}
          </Field>
        </Modal>
      )}
    </div>
  );
}

const DIET_META: Record<DietType, { label: string; border: string; dot: string }> = {
  veg: { label: 'Vegetarian', border: 'border-success/30', dot: 'bg-success' },
  egg: { label: 'Contains egg', border: 'border-warning/30', dot: 'bg-accent' },
  nonveg: { label: 'Non-vegetarian', border: 'border-danger/30', dot: 'bg-danger' },
};

function DietMark({ diet }: { diet: DietType }) {
  const m = DIET_META[diet];
  return (
    <span title={m.label} aria-label={m.label} className={cx('inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-lg border', m.border)}>
      <span className={cx('h-1.5 w-1.5 rounded-full', m.dot)} />
    </span>
  );
}

function ItemRow({ p, fresh, busy, selected, onSelect, canUp, canDown, onMove, onEdit, onDuplicate, onDelete, onStock }: {
  p: Product; fresh: boolean; busy: boolean; selected: boolean; onSelect: () => void; canUp: boolean; canDown: boolean;
  onMove: (dir: -1 | 1) => void; onEdit: () => void; onDuplicate: () => void; onDelete: () => void;
  onStock: (p: Product, isAvailable: boolean, until?: Date | null) => void;
}) {
  const specs = readSpecs(p.specs);
  const mrp = mrpOf(p) ?? NaN;
  const price = Number(p.price);
  const off = Number.isFinite(mrp) && mrp > price ? Math.round((1 - price / mrp) * 100) : 0;
  const until = p.outOfStockUntil ? new Date(p.outOfStockUntil) : null;
  const img = p.imageUrl || p.image;
  // A photo that fails to load, or one borrowed from another website, is flagged so it gets replaced.
  const [brokenImg, setBrokenImg] = useState('');
  const imgBroken = !!img && brokenImg === img;
  const linkNote = photoLinkNote(img);
  const twoHours = () => new Date(Date.now() + 2 * 3600 * 1000);
  const tomorrow9 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; };
  return (
    <li className={cx('flex flex-wrap items-center gap-3 px-3 py-2.5 sm:flex-nowrap', !p.isAvailable && 'bg-surface-2/60', fresh && FRESH_ROW_CLASS)}>
      <input type="checkbox" checked={selected} onChange={onSelect} className="h-4 w-4 shrink-0 accent-[rgb(var(--accent))]" aria-label={`Select ${p.name}`} />
      <span className="flex shrink-0 flex-col">
        <button type="button" disabled={!canUp} onClick={() => onMove(-1)} aria-label={`Move ${p.name} up`} className={cx('rounded px-1 text-xs leading-4 text-fg-muted hover:text-fg disabled:opacity-20', FOCUS_RING)}>▲</button>
        <button type="button" disabled={!canDown} onClick={() => onMove(1)} aria-label={`Move ${p.name} down`} className={cx('rounded px-1 text-xs leading-4 text-fg-muted hover:text-fg disabled:opacity-20', FOCUS_RING)}>▼</button>
      </span>
      <button type="button" onClick={onEdit} className={cx('flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left', FOCUS_RING)}>
        {img && !imgBroken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" loading="lazy" onError={() => setBrokenImg(img)} className={cx('h-12 w-12 shrink-0 rounded-lg border border-line object-cover', !p.isAvailable && 'grayscale')} />
        ) : imgBroken ? (
          <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-danger/40 text-[10px] font-semibold text-danger-text">Broken</span>
        ) : (
          <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-xs text-fg-subtle">No photo</span>
        )}
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <DietMark diet={dietOf(p)} />
            <span className={cx('truncate font-semibold', p.isAvailable ? 'text-fg' : 'text-fg-muted')}>{p.name}</span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
            <span className="font-semibold text-fg">₹{price.toLocaleString('en-IN')}</span>
            {off > 0 && <><span className="line-through">₹{mrp.toLocaleString('en-IN')}</span><span className="text-success-text">{off}% off</span></>}
            {typeof specs.weight === 'string' && specs.weight && <span>· {specs.weight}</span>}
            {p.isEliteOnly && <Chip tone="violet">Elite</Chip>}
            {p.isSpecializedCake && <Chip tone="amber">Specialized cake</Chip>}
            {!!specs.bookingOnly && <Chip tone="sky">Booking</Chip>}
            {!img && <span className="text-warning-text">· add a photo</span>}
            {imgBroken ? (
              <span className="text-danger-text">· photo does not load: replace it</span>
            ) : linkNote ? (
              <span className={linkNote.tone === 'danger' ? 'text-danger-text' : 'text-warning-text'} title={linkNote.text}>· {linkNote.short}</span>
            ) : null}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-2">
        <div className="text-right">
          <Toggle size="sm" checked={p.isAvailable} disabled={busy} onChange={v => onStock(p, v, null)} label={`${p.name} in stock`} srOnlyLabel />
        </div>
        <span className={cx('hidden w-24 text-xs sm:block', p.isAvailable ? 'text-success-text' : 'text-danger-text')}>
          {p.isAvailable ? 'In stock' : until && until > new Date() ? `Back ${timeUntil(until)}` : 'Out of stock'}
        </span>
        <MenuButton ariaLabel={`More actions for ${p.name}`} label="•••" items={[
          { label: 'Edit', onSelect: onEdit },
          { label: 'Duplicate', onSelect: onDuplicate },
          'divider',
          { label: 'Out of stock for 2 hours', onSelect: () => onStock(p, false, twoHours()), disabled: busy },
          { label: 'Out of stock until tomorrow 9 AM', onSelect: () => onStock(p, false, tomorrow9()), disabled: busy },
          'divider',
          { label: 'Delete', onSelect: onDelete, danger: true },
        ]} />
      </div>
    </li>
  );
}

const timeUntil = (d: Date) => {
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
};

// ─── Item editor ─────────────────────────────────────────────────────────────
function ItemEditor({ initial, storeName, vendorType, categories, bookingOnly, nextSortOrder, onClose, onSave, onSaved }: {
  initial: Product | null;
  storeName: string;
  vendorType?: string | null;
  categories: string[];
  bookingOnly: boolean;
  nextSortOrder: number;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>, existing: Product | null) => Promise<Product>;
  onSaved: (saved: Product, addAnother: boolean) => void;
}) {
  const specs = readSpecs(initial?.specs);
  const blank = () => ({
    name: '', price: '', mrp: '', weight: '', category: categories[0] || '', description: '', imageUrl: '',
    isAvailable: true, diet: 'veg' as DietType, isEliteOnly: false, isSpecializedCake: false, tags: [] as string[],
  });
  const [form, setForm] = useState(() => initial ? {
    name: initial.name || '',
    price: String(initial.price ?? ''),
    mrp: mrpOf(initial) != null ? String(mrpOf(initial)) : '',
    weight: typeof specs.weight === 'string' ? specs.weight : '',
    category: initial.category || '',
    description: initial.description || '',
    imageUrl: initial.imageUrl || initial.image || '',
    isAvailable: initial.isAvailable ?? true,
    diet: dietOf(initial),
    isEliteOnly: !!initial.isEliteOnly,
    isSpecializedCake: !!initial.isSpecializedCake,
    tags: (initial.tags || []).map(String),
  } : blank());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<null | 'save' | 'again'>(null);
  const [error, setError] = useState('');
  const set = (patch: Partial<typeof form>) => setForm(prev => ({ ...prev, ...patch }));
  const isBooking = !!specs.bookingOnly || bookingOnly;
  const [photoBusy, setPhotoBusy] = useState(false);
  // Customer choices (specs.options) and ordered product details (specs.details): docs/PRODUCT_OPTIONS.md.
  // A weight-sold grocery / bakery product with no saved choices shows its automatic weights (never saved as they
  // are; see useChoiceGroups).
  const choice = useChoiceGroups(specs, form, vendorType);
  const { groups, setGroups } = choice;
  const [details, setDetails] = useState<DetailDraft[]>(() => detailsFromSpecs(specs));
  const [showOptionErrors, setShowOptionErrors] = useState(false);
  const optionErrors = useMemo(() => validateOptions(groups, details), [groups, details]);
  // The admin's own weight / size group sets the price (its lowest); automatic weights follow the price instead.
  const hasVariant = groups.some(g => g.type === 'variant') && !choice.usingAuto;
  const fromPrice = variantMinPrice(groups);
  // Unsaved changes: a stray click outside, Esc or Cancel asks first (a long product entry was lost in one click).
  const snapshot = JSON.stringify([form, choice.specsPatch(), serializeDetails(details)]);
  const startSnap = useRef(snapshot);
  const resetSnap = useRef(false);
  if (resetSnap.current) { startSnap.current = snapshot; resetSnap.current = false; }
  const requestClose = () => {
    if (saving) return;
    if (snapshot !== startSnap.current && !window.confirm('Discard the changes to this item?')) return;
    onClose();
  };
  const errorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [error]);

  const validate = () => {
    const e: Record<string, string> = {};
    const price = hasVariant ? (fromPrice ?? NaN) : Number(form.price);
    if (!form.name.trim()) e.name = 'Name the item as it appears on the menu.';
    if (hasVariant) { if (fromPrice === null) e.price = 'Give each weight / size a price below.'; }
    // ₹0 only for booking-only services (priced after a quote); a ₹0 product would be given away free.
    else if (form.price.trim() === '' || !Number.isFinite(price) || price < 0 || (price === 0 && !isBooking) || price > 100000) e.price = isBooking ? 'Enter a price between ₹0 and ₹1,00,000.' : 'Enter a price above ₹0 (up to ₹1,00,000).';
    if (form.mrp.trim() !== '') {
      const mrp = Number(form.mrp);
      if (!Number.isFinite(mrp) || mrp <= 0) e.mrp = 'MRP must be a positive amount, or empty.';
      else if (Number.isFinite(price) && mrp < price) e.mrp = 'MRP cannot be lower than the selling price.';
    }
    return e;
  };

  const submit = async (again: boolean) => {
    if (saving || photoBusy) return;
    const e = validate();
    setErrors(e);
    const optionsInvalid = Object.keys(optionErrors).length > 0;
    if (optionsInvalid) setShowOptionErrors(true);
    if (Object.keys(e).length || optionsInvalid) return;
    setSaving(again ? 'again' : 'save');
    setError('');
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        // With a weight / size group the product price is its lowest weight price (the server sets the same).
        price: hasVariant && fromPrice !== null ? fromPrice : Math.round(Number(form.price) * 100) / 100,
        category: form.category.trim() || null,
        description: form.description.trim() || null,
        imageUrl: form.imageUrl.trim() || null,
        isAvailable: form.isAvailable,
        dietType: form.diet,
        isVegetarian: form.diet === 'veg',
        isEliteOnly: form.isEliteOnly,
        isSpecializedCake: form.isSpecializedCake,
        tags: form.tags,
        // MRP: column + specs.originalPrice are kept in step by the server; null clears it.
        originalPrice: form.mrp.trim() === '' ? null : Number(form.mrp),
        specs: {
          weight: form.weight.trim() || null,
          // The admin's own choices (null removes them; automatic weights are never saved) and the automatic-weights
          // switch (false = removed). null removes a key: the server merges specs keys.
          ...choice.specsPatch(),
          details: serializeDetails(details),
          ...(initial ? {} : { sortOrder: nextSortOrder }),
          // Items added to a booking-only service store carry the flag like its imported items do
          // (the list shows the Booking chip from it; the server also checks the store type).
          ...(isBooking ? { bookingOnly: true } : {}),
        },
      };
      if (form.isAvailable) payload.outOfStockUntil = null;
      const saved = await onSave(payload, initial);
      if (again) {
        setForm({ ...blank(), category: form.category }); setErrors({}); setSaving(null); resetSnap.current = true;
        choice.useAutomatic(); setDetails([]); setShowOptionErrors(false);
      }
      onSaved(saved, again);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the item.');
      setSaving(null);
    }
  };

  const price = hasVariant ? (fromPrice ?? NaN) : Number(form.price); const mrp = Number(form.mrp);
  const discount = form.mrp && Number.isFinite(price) && Number.isFinite(mrp) && mrp > price && price >= 0 ? Math.round((1 - price / mrp) * 100) : null;

  return (
    <Modal
      title={initial ? `Edit ${initial.name}` : 'Add menu item'}
      description={storeName}
      size="xl"
      onClose={requestClose}
      footer={<>
        <Button onClick={requestClose} disabled={!!saving}>Cancel</Button>
        {!initial && <Button loading={saving === 'again'} disabled={!!saving || photoBusy} onClick={() => submit(true)}>Save &amp; add another</Button>}
        <Button variant="primary" loading={saving === 'save'} disabled={!!saving || photoBusy} title={photoBusy ? 'Wait for the photo to finish uploading' : undefined} onClick={() => submit(false)}>{initial ? 'Save item' : 'Add item'}</Button>
      </>}
    >
      <form onSubmit={e => { e.preventDefault(); submit(false); }} className="grid gap-6 md:grid-cols-[1fr_220px]">
        <div className="space-y-5">
          {isBooking && <Callout tone="sky">Booking-only service: this price is what service bookings are charged.</Callout>}
          <Field label="Item name" required error={errors.name}>
            {({ id, msgId, invalid }) => <input id={id} data-autofocus aria-describedby={msgId} aria-invalid={invalid} className={INPUT} maxLength={200} value={form.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Chicken Dum Biryani" />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            {hasVariant ? (
              <Field label="Selling price (₹)" error={errors.price} help="Lowest weight / size price.">
                {({ id, msgId, invalid }) => <input id={id} aria-describedby={msgId} aria-invalid={invalid} readOnly className={cx(INPUT, 'cursor-default bg-surface-2 text-fg-muted')} value={fromPrice !== null ? `₹${fromPrice.toLocaleString('en-IN')} (lowest weight)` : 'Set weight prices below'} />}
              </Field>
            ) : (
              <Field label="Selling price (₹)" required error={errors.price}>
                {({ id, msgId, invalid }) => <input id={id} aria-describedby={msgId} aria-invalid={invalid} inputMode="decimal" className={INPUT} value={form.price} onChange={e => set({ price: e.target.value })} />}
              </Field>
            )}
            <Field label="MRP (₹)" optional error={errors.mrp} help={discount ? `Shows ${discount}% off` : 'Crossed-out price'}>
              {({ id, msgId, invalid }) => <input id={id} aria-describedby={msgId} aria-invalid={invalid} inputMode="decimal" className={INPUT} value={form.mrp} onChange={e => set({ mrp: e.target.value })} />}
            </Field>
            <Field label="Pack size" optional help="e.g. 500 g, Half, 6 pcs">
              {({ id, msgId }) => <input id={id} aria-describedby={msgId} className={INPUT} value={form.weight} onChange={e => set({ weight: e.target.value })} />}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" optional help="Items are grouped by category in the app.">
              {({ id, msgId }) => (<>
                <input id={id} aria-describedby={msgId} list="item-cats" className={INPUT} value={form.category} onChange={e => set({ category: e.target.value })} placeholder="e.g. Biryani" />
                <datalist id="item-cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
              </>)}
            </Field>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-fg-muted">Food type</p>
              <Segmented<DietType> label="Food type" value={form.diet} onChange={diet => set({ diet })} options={[
                { value: 'veg', label: <span className="flex items-center gap-1.5"><DietMark diet="veg" /> Veg</span> },
                { value: 'egg', label: <span className="flex items-center gap-1.5"><DietMark diet="egg" /> Egg</span> },
                { value: 'nonveg', label: <span className="flex items-center gap-1.5"><DietMark diet="nonveg" /> Non-veg</span> },
              ]} />
            </div>
          </div>
          <Field label="Description" optional aside={<span className="text-xs text-fg-subtle">{form.description.length}/1000</span>}>
            {({ id, msgId }) => <textarea id={id} aria-describedby={msgId} className={cx(INPUT, 'h-20 resize-none')} maxLength={1000} value={form.description} onChange={e => set({ description: e.target.value })} placeholder="Ingredients, portion, spice level…" />}
          </Field>
          <Field label="Tags" optional help="Helps search, e.g. spicy, bestseller.">
            {({ id, msgId }) => <TagInput id={id} describedBy={msgId} value={form.tags} onChange={tags => set({ tags })} />}
          </Field>
          <div className="grid gap-4 rounded-xl border border-line p-4 sm:grid-cols-2">
            <Toggle checked={form.isAvailable} onChange={isAvailable => set({ isAvailable })} label="In stock" description="Off shows SOLD OUT in the app." />
            <Toggle tone="amber" checked={form.isEliteOnly} onChange={isEliteOnly => set({ isEliteOnly })} label="Elite members only" description="Only ZCS Elite customers can add it." />
            <Toggle tone="amber" checked={form.isSpecializedCake} onChange={isSpecializedCake => set({ isSpecializedCake })} label="Specialized cake" description="Custom or designer cake: orders close 2½ hours before the delivery slot (normal cakes 2 hours)." />
          </div>
          <AutoWeightsNote usingAuto={choice.usingAuto} autoOff={choice.autoOff} packLabel={choice.packLabel} onUseAutomatic={choice.useAutomatic} />
          <OptionGroupsEditor groups={groups} onChange={setGroups} errors={optionErrors} showAllErrors={showOptionErrors} />
          <ProductDetailsEditor details={details} onChange={setDetails} errors={optionErrors} showAllErrors={showOptionErrors} />
          {showOptionErrors && Object.keys(optionErrors).length > 0 && <Callout tone="red">Fix the highlighted choices or details before saving.</Callout>}
          {error && <div ref={errorRef}><Callout tone="red">{error}</Callout></div>}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-fg-muted">Photo</p>
          <ImagePicker value={form.imageUrl} onChange={imageUrl => set({ imageUrl })} onBusyChange={setPhotoBusy} preset="item" label="Item photo" hint="Square, close-up, good light." aspect="aspect-square" />
          {initial?.createdAt && <p className="pt-2 text-xs text-fg-subtle">Added {timeAgo(initial.createdAt)}</p>}
        </div>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

// ─── CSV import ──────────────────────────────────────────────────────────────
const CSV_TEMPLATE = `name,price,mrp,category,veg,in_stock,weight,description,image
Chicken Dum Biryani,220,,Biryani,no,yes,Full,Hyderabadi style with raita,
Paneer Butter Masala,180,200,Curries,yes,yes,,Rich tomato gravy,
Masala Dosa,60,,Tiffins,yes,yes,,,
Egg Fried Rice,110,,Chinese,egg,yes,,,`;

const COLUMN_ALIASES: Record<string, string> = {
  name: 'name', item: 'name', 'item name': 'name', product: 'name',
  price: 'price', 'selling price': 'price', rate: 'price',
  mrp: 'mrp', 'original price': 'mrp',
  category: 'category', section: 'category',
  veg: 'veg', vegetarian: 'veg', 'veg/non-veg': 'veg', 'veg / non-veg': 'veg', diet: 'veg', 'food type': 'veg',
  in_stock: 'in_stock', 'in stock': 'in_stock', stock: 'in_stock', available: 'in_stock',
  weight: 'weight', 'pack size': 'weight', size: 'weight', quantity: 'weight',
  description: 'description', desc: 'description',
  image: 'image', image_url: 'image', 'image url': 'image', photo: 'image',
};
const DEFAULT_ORDER = ['name', 'price', 'mrp', 'category', 'veg', 'in_stock', 'weight', 'description', 'image'];

interface BulkError extends Error { rows?: { index: number; message: string }[] }

/** POST /api/admin/menu-items/bulk. Throws a BulkError with per-row messages when the server refuses the batch. */
async function fetchBulk(restaurantId: string, items: Record<string, unknown>[]): Promise<Product[]> {

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/admin/menu-items/bulk`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurantId, items }) });
  } catch {
    throw Object.assign(new Error('Could not reach the server. Check your connection and try again.'), { rows: [] }) as BulkError;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = res.status === 401 ? 'Your session has expired. Please sign in again.'
      : res.status >= 500 ? `The server could not complete this request (${res.status}). Please try again.`
      : (data && typeof data.message === 'string' ? data.message : `Request failed (${res.status}).`);
    const rows = Array.isArray(data?.errors) ? (data.errors as { index: number; message: string }[]) : [];
    throw Object.assign(new Error(msg), { rows }) as BulkError;
  }
  return Array.isArray(data?.items) ? (data.items as Product[]) : [];
}

interface CsvRow { line: number; data: Record<string, unknown>; errors: string[]; duplicate: boolean; status?: 'done' | 'failed'; failReason?: string }

// Cells are read strictly: a value the import does not recognise is a row error, never a silent default
// ("Out of stock" was read as in stock and "Non-Veg Pickle" as veg).
const cellKey = (v: string) => v.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
const STOCK_YES = ['yes', 'y', 'true', '1', 'in', 'in stock', 'instock', 'available', 'avl'];
const STOCK_NO = ['no', 'n', 'false', '0', 'out', 'out of stock', 'outofstock', 'sold out', 'soldout', 'unavailable', 'not available'];
/** "in_stock" column: yes / no (empty = in stock). null = not recognised. */
const stockFromCell = (v: string): boolean | null => {
  const s = cellKey(v);
  if (!s) return true;
  if (STOCK_YES.includes(s)) return true;
  if (STOCK_NO.includes(s)) return false;
  return null;
};
const DIET_VEG = ['yes', 'y', 'true', '1', 'veg', 'v', 'vegetarian', 'pure veg', 'eggless'];
const DIET_NONVEG = ['no', 'n', 'false', '0', 'non veg', 'nonveg', 'nv', 'non vegetarian', 'nonvegetarian'];
const DIET_EGG = ['egg', 'e', 'eggetarian', 'contains egg', 'with egg'];
/** "veg" column: yes / no / egg (also veg, non-veg, nv, e; empty = veg). null = not recognised. */
const dietFromCell = (v: string): DietType | null => {
  const s = cellKey(v);
  if (!s) return 'veg';
  if (DIET_EGG.includes(s)) return 'egg';
  if (DIET_NONVEG.includes(s)) return 'nonveg';
  if (DIET_VEG.includes(s)) return 'veg';
  return null;
};

function CsvImportModal({ storeId: sid, existing, allowFree, onClose, onImported }: {
  storeId: string; existing: Product[]; allowFree: boolean; onClose: () => void; onImported: (items: Product[]) => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [skipDupes, setSkipDupes] = useState(true);
  const [rows, setRows] = useState<CsvRow[] | null>(null);
  const [headerNote, setHeaderNote] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const existingNames = useMemo(() => new Set(existing.map(p => p.name.trim().toLowerCase())), [existing]);

  const parse = (src: string) => {
    const table = parseCsv(src);
    if (!table.length) { setRows([]); setHeaderNote(''); return; }
    const head = table[0].map(h => COLUMN_ALIASES[h.trim().toLowerCase()] || '');
    const hasHeader = head.includes('name') && head.includes('price');
    const cols = hasHeader ? head : DEFAULT_ORDER;
    setHeaderNote(hasHeader ? `Columns: ${head.filter(Boolean).join(', ')}` : `No header row found; reading columns as ${DEFAULT_ORDER.join(', ')}.`);
    const seen = new Set<string>();
    const out: CsvRow[] = (hasHeader ? table.slice(1) : table).map((cells, i) => {
      const get = (k: string) => { const idx = cols.indexOf(k); return idx >= 0 ? String(cells[idx] ?? '').trim() : ''; };
      const errors: string[] = [];
      const name = get('name');
      const priceRaw = get('price').replace(/[₹,\s]/g, '');
      const mrpRaw = get('mrp').replace(/[₹,\s]/g, '');
      const price = Number(priceRaw);
      const mrp = mrpRaw ? Number(mrpRaw) : null;
      if (!name) errors.push('Name missing');
      if (name.length > 200) errors.push('Name over 200 characters');
      // ₹0 only in booking-only service stores (priced after a quote); a ₹0 product would be given away free.
      if (!priceRaw || !Number.isFinite(price) || price < 0 || price > 100000) errors.push(allowFree ? 'Price must be 0–1,00,000' : 'Price must be above 0, up to 1,00,000');
      else if (price === 0 && !allowFree) errors.push('Price must be above 0');
      const diet = dietFromCell(get('veg'));
      if (diet === null) errors.push(`Veg column "${get('veg').slice(0, 20)}": write yes, no or egg`);
      const inStock = stockFromCell(get('in_stock'));
      if (inStock === null) errors.push(`In-stock column "${get('in_stock').slice(0, 20)}": write yes or no`);
      if (mrp !== null && (!Number.isFinite(mrp) || mrp <= 0)) errors.push('MRP is not a number');
      else if (mrp !== null && Number.isFinite(price) && mrp < price) errors.push('MRP below price');
      const image = get('image');
      if (image && !/^https?:\/\//i.test(image)) errors.push('Image must be an http(s) link');
      else if (image && photoLinkNote(image)?.tone === 'danger') errors.push(`Image: ${photoLinkNote(image)?.text}`);
      const key = name.toLowerCase();
      const duplicate = !!name && (existingNames.has(key) || seen.has(key));
      seen.add(key);
      return {
        line: i + (hasHeader ? 2 : 1),
        errors,
        duplicate,
        data: {
          name, price: Math.round(price * 100) / 100, category: get('category') || null, description: get('description') || null,
          imageUrl: image || null, dietType: diet || 'veg', isAvailable: inStock !== false, isEliteOnly: false, tags: [],
          ...(mrp !== null && Number.isFinite(mrp) ? { originalPrice: mrp } : {}),
          specs: { ...(get('weight') ? { weight: get('weight') } : {}) },
        },
      };
    });
    setRows(out);
  };

  const importable = (rows || []).filter(r => !r.errors.length && !(skipDupes && r.duplicate) && r.status !== 'done');
  const errorCount = (rows || []).filter(r => r.errors.length).length;
  const dupeCount = (rows || []).filter(r => r.duplicate).length;

  const run = async () => {
    if (!importable.length || importing) return;
    setImporting(true);
    setProgress(0);
    let order = existing.reduce((m, p) => Math.max(m, Number.isFinite(sortOrderOf(p)) ? sortOrderOf(p) : 0), 0);
    const queue = importable.map(r => ({ r, sortOrder: (order += 10) }));
    const added: Product[] = [];
    const results = new Map<number, { status: 'done' | 'failed'; failReason?: string }>();
    // POST /api/admin/menu-items/bulk is all-or-nothing (max 300 rows per call): a call with a bad row saves none
    // and returns per-row errors, which are marked below.
    for (let i = 0; i < queue.length; i += 300) {
      const chunk = queue.slice(i, i + 300);
      try {
        const res = await fetchBulk(sid, chunk.map(({ r, sortOrder }) => {
          const data = r.data as { specs: Record<string, unknown> };
          return { ...r.data, specs: { ...data.specs, sortOrder } };
        }));
        added.push(...res);
        chunk.forEach(({ r }) => results.set(r.line, { status: 'done' }));
      } catch (e) {
        const err = e as BulkError;
        const byIndex = new Map((err.rows || []).map(x => [x.index, x.message]));
        chunk.forEach(({ r }, idx) => results.set(r.line, { status: 'failed', failReason: byIndex.get(idx) || (byIndex.size ? 'Not saved (another row has an error)' : err.message || 'Failed') }));
      }
      setProgress(Math.min(queue.length, i + chunk.length));
    }
    setRows(prev => (prev || []).map(r => (results.has(r.line) ? { ...r, ...results.get(r.line) } : r)));
    setImporting(false);
    if (added.length) onImported(added);
    const failed = queue.length - added.length;
    if (!failed) { toast.success(`${added.length} item${added.length === 1 ? '' : 's'} added to the menu.`); onClose(); }
    else toast.error(`${added.length} added, ${failed} not saved. Rows are marked below; fix them and import again.`);
  };

  const loadFile = async (file?: File | null) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('CSV files up to 2 MB.'); return; }
    const t = await file.text();
    setText(t);
    parse(t);
  };

  return (
    <Modal
      title="Bulk add items"
      description="Paste rows from Google Sheets / Excel, or a CSV file. You will see a preview before anything is saved."
      size="xl"
      onClose={importing ? () => undefined : onClose}
      footer={<>
        {rows && <span className="mr-auto text-xs text-fg-muted">{importable.length} ready · {errorCount} with errors{dupeCount ? ` · ${dupeCount} duplicate${dupeCount === 1 ? '' : 's'}` : ''}</span>}
        <Button onClick={onClose} disabled={importing}>Cancel</Button>
        {rows ? (
          <Button variant="primary" loading={importing} disabled={!importable.length} onClick={run}>
            {importing ? `Adding ${progress}/${importable.length}…` : `Add ${importable.length} item${importable.length === 1 ? '' : 's'}`}
          </Button>
        ) : (
          <Button variant="primary" disabled={!text.trim()} onClick={() => parse(text)}>Preview</Button>
        )}
      </>}
    >
      {!rows ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span>Columns: <b className="text-fg">name, price</b> (required), mrp, category, veg (yes / no / egg), in_stock (yes/no), weight, description, image (link).</span>
            <button type="button" className="font-semibold text-success-text hover:underline" onClick={() => setText(CSV_TEMPLATE)}>Insert example</button>
            <a className="font-semibold text-success-text hover:underline" download="zenvy-menu-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`}>Download template</a>
          </div>
          <textarea
            data-autofocus
            aria-label="Menu rows"
            className={cx(INPUT, 'h-64 font-mono text-xs')}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={'name,price,category,veg\nVeg Fried Rice,120,Chinese,yes'}
          />
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={() => fileRef.current?.click()}>Choose CSV file</Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={e => { loadFile(e.target.files?.[0]); e.target.value = ''; }} aria-label="CSV file" />
            <span className="text-xs text-fg-muted">Photos can be added per item afterwards.</span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-fg-muted">{headerNote}</p>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-fg-muted"><input type="checkbox" checked={skipDupes} onChange={e => setSkipDupes(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" /> Skip names already on the menu</label>
              <button type="button" className="text-xs font-semibold text-success-text hover:underline" disabled={importing} onClick={() => setRows(null)}>← Edit rows</button>
            </div>
          </div>
          {rows.length === 0 ? (
            <EmptyState title="No rows found" body="Paste at least one line with a name and a price." />
          ) : (
            <div className="max-h-[50vh] overflow-auto rounded-xl border border-line">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="sticky top-0 bg-surface text-xs text-fg-muted">
                  <tr><th className="p-2">Line</th><th className="p-2">Name</th><th className="p-2 text-right">Price</th><th className="p-2 text-right">MRP</th><th className="p-2">Category</th><th className="p-2">Veg</th><th className="p-2">Stock</th><th className="p-2">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {rows.map(r => {
                    const d = r.data as { name: string; price: number; category: string | null; dietType: DietType; isAvailable: boolean; originalPrice?: number };
                    const skipped = skipDupes && r.duplicate && !r.errors.length;
                    return (
                      <tr key={r.line} className={cx(r.errors.length ? 'bg-danger-soft' : skipped ? 'opacity-50' : '', r.status === 'done' && 'bg-success-soft')}>
                        <td className="p-2 text-fg-muted">{r.line}</td>
                        <td className="p-2 font-semibold text-fg">{d.name || <span className="text-danger-text">—</span>}</td>
                        <td className="p-2 text-right">{Number.isFinite(d.price) ? `₹${d.price}` : '—'}</td>
                        <td className="p-2 text-right text-fg-muted">{d.originalPrice ? `₹${d.originalPrice}` : '—'}</td>
                        <td className="p-2 text-fg-muted">{d.category || '—'}</td>
                        <td className="p-2"><DietMark diet={d.dietType} /></td>
                        <td className="p-2">{d.isAvailable ? 'In' : 'Out'}</td>
                        <td className="p-2">
                          {r.status === 'done' ? <Chip tone="green">Added</Chip>
                            : r.status === 'failed' ? <Chip tone="red" title={r.failReason}>Failed: {r.failReason}</Chip>
                            : r.errors.length ? <span className="text-danger-text">{r.errors.join(' · ')}</span>
                            : r.duplicate ? <Chip tone="amber">{skipped ? 'Duplicate, skipped' : 'Duplicate'}</Chip>
                            : <Chip tone="green">Ready</Chip>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {importing && (
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={importable.length} aria-valuenow={progress} aria-label="Import progress">
              <div className="h-full bg-success transition-all" style={{ width: `${importable.length ? (progress / importable.length) * 100 : 0}%` }} />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
