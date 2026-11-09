import { useEffect, useState } from 'react';
import { API_URL } from '../constants/api';
import { apiFetch } from './auth';
import { readCache, writeCache } from './swrCache';

/** Server limits (PUT /api/users/profile): hostelBlock <= 60, roomNumber <= 20 characters. */
export const HOSTEL_BLOCK_MAX = 60;
export const ROOM_NUMBER_MAX = 20;

/** "Room 304" / "room304" / " 304 " -> "304". */
export const cleanRoom = (room: unknown): string =>
  String(room || '').replace(/^\s*room\s*(no\.?|number|#)?\s*/i, '').trim().slice(0, ROOM_NUMBER_MAX);

export const cleanBlock = (block: unknown): string => String(block || '').trim().slice(0, HOSTEL_BLOCK_MAX);

/** "Ganga, Room 304" from the saved profile, or '' when nothing is saved. */
export const formatHostel = (user: any): string => {
  const block = cleanBlock(user?.hostelBlock);
  const room = cleanRoom(user?.roomNumber);
  if (block && room) return `${block}, Room ${room}`;
  if (block) return block;
  if (room) return `Room ${room}`;
  return '';
};

export type CampusBlocks = { code: string; name: string; blocks: string[]; city: string };

/**
 * Hostel blocks per campus from the admin-managed campus directory (GET /api/campus/campuses,
 * settings.hostelBlocks). Paints from the last good copy, then refreshes. Same source as checkout.
 */
export function useCampusHostelBlocks(enabled = true): CampusBlocks[] {
  const [list, setList] = useState<CampusBlocks[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const apply = (data: any[]) => {
      const out: CampusBlocks[] = [];
      data.forEach((c: any) => {
        const blocks = Array.isArray(c?.settings?.hostelBlocks)
          ? c.settings.hostelBlocks.filter((b: any) => typeof b === 'string' && b.trim()).map((b: string) => b.trim()).slice(0, 24)
          : [];
        // Every campus is kept (10 Nov 2026): Profile also reads its city to fill the City field; blocks may be empty.
        if (c?.code) out.push({ code: String(c.code), name: String(c?.shortName || c?.name || c?.code || 'Campus'), blocks, city: typeof c?.city === 'string' ? c.city.trim() : '' });
      });
      if (!cancelled) setList(out);
    };
    (async () => {
      const cached = await readCache<any[]>('campus:campuses');
      if (!cancelled && cached && Array.isArray(cached.data)) apply(cached.data);
      try {
        const res = await apiFetch(`${API_URL}/api/campus/campuses`);
        const data = await res.json().catch(() => null);
        if (cancelled || !res.ok || !Array.isArray(data)) return;
        writeCache('campus:campuses', data);
        apply(data);
      } catch {
        // The free-text field always works.
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);
  return list;
}

/** Saves hostel block + room on the profile. Returns the server's user object (for setUser). */
export async function saveHostelToProfile(block: string, room: string): Promise<any> {
  const res = await apiFetch(`${API_URL}/api/users/profile`, {
    method: 'PUT',
    body: JSON.stringify({ hostelBlock: cleanBlock(block), roomNumber: cleanRoom(room) }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || typeof data !== 'object') {
    throw new Error((data && typeof data.message === 'string' && data.message) || "Couldn't save your hostel and room.");
  }
  return data;
}
