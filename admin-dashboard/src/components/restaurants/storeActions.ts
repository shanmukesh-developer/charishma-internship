import { Product, Store, adminRequest, dietOf, mrpOf, readSpecs, storeAppPath, storeId, vendorLabel } from '@/app/restaurants/catalogue';

type Banner = Record<string, unknown>;

export async function patchStore(id: string, patch: Record<string, unknown>): Promise<Store> {
  return adminRequest<Store>(`/api/admin/restaurants/${id}`, { method: 'POST', body: JSON.stringify(patch) });
}

async function readBanners(): Promise<Banner[]> {
  const cfg = await adminRequest<{ config?: { banners?: Banner[] } }>('/api/config');
  return Array.isArray(cfg?.config?.banners) ? cfg.config!.banners! : [];
}

export async function hasStoreBanner(id: string): Promise<boolean> {
  const banners = await readBanners();
  return banners.some(b => b.redirectUrl === storeAppPath(id));
}

/**
 * Removes the Home banner that links to this store, so ending a promotion or deactivating/deleting the store
 * never leaves a dead banner in /api/config. Returns an error message, or null.
 */
export async function removeStoreBanner(id: string): Promise<string | null> {
  try {
    // One atomic server-side removal (DELETE /api/config/banners): never rewrites the other banners,
    // so an edit made elsewhere at the same moment is kept.
    await adminRequest(`/api/config/banners?redirectUrl=${encodeURIComponent(storeAppPath(id))}`, { method: 'DELETE' });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'unknown error';
  }
}

/** Adds (or updates) a Home hero banner that opens this store (atomic, POST /api/config/banners). */
export async function upsertStoreBanner(store: Store, badge: string, offer: string): Promise<void> {
  if (!store.imageUrl) throw new Error('Add a cover photo before adding a Home banner.');
  const redirectUrl = storeAppPath(storeId(store));
  const banner = {
    imageUrl: store.imageUrl,
    tagline: badge || 'Featured',
    title1: store.name.toUpperCase(),
    title2: offer || vendorLabel(store.vendorType),
    description: `Order from ${store.name} on ZenWe.`,
    buttonText: 'ORDER NOW',
    redirectUrl,
    isActive: true,
  };
  await adminRequest('/api/config/banners', { method: 'POST', body: JSON.stringify({ banner }) });
}

/**
 * POST /api/admin/restaurants/:id/duplicate. The copy is a draft (hidden) without password, login phone,
 * push devices, rating or promotion. Store names must be unique (409 with a friendly message).
 */
export async function duplicateStore(id: string, name: string, copyMenu: boolean): Promise<Store> {
  return adminRequest<Store>(`/api/admin/restaurants/${id}/duplicate`, { method: 'POST', body: JSON.stringify({ name, copyMenu }) });
}

/** The bulk endpoints accept at most this many ids per call. */
export const BULK_CHUNK = 300;

export interface BulkResult {
  /** Rows actually updated. */
  count: number;
  /** Ids the server did not find. */
  notFound: number;
  /** Ids in chunks whose request failed (not updated). */
  failed: number;
  /** First failure message, if any chunk failed. */
  error?: string;
  /** Ids sent in chunks that succeeded (the server may still have skipped not-found ones). */
  okIds: string[];
}

/** Sends `ids` to a bulk endpoint in chunks of 300 (one after another) and adds up the results. */
async function bulkInChunks(path: string, ids: string[], patch: Record<string, unknown>): Promise<BulkResult> {
  const out: BulkResult = { count: 0, notFound: 0, failed: 0, okIds: [] };
  for (let i = 0; i < ids.length; i += BULK_CHUNK) {
    const chunk = ids.slice(i, i + BULK_CHUNK);
    try {
      const r = await adminRequest<{ count?: number; notFound?: number }>(path, { method: 'POST', body: JSON.stringify({ ids: chunk, patch }) });
      out.count += Number(r?.count) || 0;
      out.notFound += Number(r?.notFound) || 0;
      out.okIds.push(...chunk);
    } catch (e) {
      out.failed += chunk.length;
      if (!out.error) out.error = e instanceof Error ? e.message : 'Request failed.';
    }
  }
  return out;
}

/** POST /api/admin/restaurants/bulk-update, chunked (any number of ids). */
export function bulkUpdateStores(ids: string[], patch: { isActive?: boolean; isOpenNow?: boolean; isFeatured?: boolean }) {
  return bulkInChunks('/api/admin/restaurants/bulk-update', ids, patch);
}

/** POST /api/admin/menu-items/bulk-update, chunked (any number of ids). */
export function bulkUpdateItems(ids: string[], patch: Record<string, unknown>) {
  return bulkInChunks('/api/admin/menu-items/bulk-update', ids, patch);
}

/** "12 of 15 updated. 2 not found, 1 failed: <reason>" style summary for a bulk result. */
export function describeBulk(result: BulkResult, total: number, verb: string, noun = 'store'): string {
  const plural = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  if (result.count === total) return `${plural(total)} ${verb}.`;
  const parts = [`${result.count} of ${plural(total)} ${verb}.`];
  if (result.notFound) parts.push(`${result.notFound} not found (refresh the list).`);
  if (result.failed) parts.push(`${result.failed} failed${result.error ? `: ${result.error}` : '.'}`);
  const unchanged = total - result.count - result.notFound - result.failed;
  if (unchanged > 0) parts.push(`${unchanged} unchanged.`);
  return parts.join(' ');
}

/** Item fields for "Duplicate item" (same store). */
export function duplicateItemPayload(p: Product, restaurantId: string): Record<string, unknown> {
  return {
    restaurantId,
    name: p.name,
    price: p.price,
    category: p.category || null,
    description: p.description || null,
    imageUrl: p.imageUrl || p.image || null,
    isAvailable: p.isAvailable,
    dietType: dietOf(p),
    isEliteOnly: !!p.isEliteOnly,
    isSpecializedCake: !!p.isSpecializedCake,
    tags: p.tags || [],
    specs: readSpecs(p.specs),
    originalPrice: mrpOf(p),
  };
}
