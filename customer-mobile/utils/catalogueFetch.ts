// Every product of one store type from GET /api/catalogue/items. The server sends at most 200 a page
// (backend catalogueController MAX_LIMIT), and the Groceries screens used to read only the first page: past 200
// products of a type the rest silently never showed. Pages are read until the server's total, at most 5 pages
// (1,000 products). One page failing fails the type, as before (the screens keep the other types).
import { apiFetch, readJson } from './auth';
import { API_URL } from '../constants/api';

const PAGE = 200;
const MAX_PAGES = 5;

export async function fetchCatalogueType(type: string): Promise<{ items: any[]; stores: any[] }> {
  const items: any[] = [];
  const stores = new Map<string, any>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await apiFetch(`${API_URL}/api/catalogue/items?type=${encodeURIComponent(type)}&limit=${PAGE}&offset=${page * PAGE}`);
    if (!res.ok) throw new Error(`catalogue ${res.status}`);
    const data = await readJson(res);
    const got = Array.isArray(data?.items) ? data.items : [];
    items.push(...got);
    (Array.isArray(data?.stores) ? data.stores : []).forEach((st: any) => {
      const sid = String(st?.id || st?._id || '');
      if (sid && !stores.has(sid)) stores.set(sid, st);
    });
    const total = Number(data?.total);
    if (got.length < PAGE || !Number.isFinite(total) || items.length >= total) break;
  }
  return { items, stores: [...stores.values()] };
}
