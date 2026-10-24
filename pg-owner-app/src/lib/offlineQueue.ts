// Offline queue (same design as auto-driver-app/src/lib/offlineQueue.ts): ONLY actions that are safe to replay
// later and give the same result however many times they land:
//   MARK_READ    POST /notifications/read (mark the inbox read)
// Booking decisions, free-bed counts, rent entries and replies are never queued: they need a live answer
// (the bed may be gone, another phone may have changed the count), so the screens ask the owner to retry.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, NetworkError } from './http';
import { ownerApi } from '../api/ownerApi';
import { STORAGE } from '../config';

export type QueueType = 'MARK_READ';
export interface QueuedAction { type: QueueType; createdAt: number; attempts: number }
export interface FlushResult { done: QueueType[]; dropped: { type: QueueType; message: string }[]; remaining: number }

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
let cache: QueuedAction[] | null = null;
let flushing: Promise<FlushResult> | null = null;

async function load(): Promise<QueuedAction[]> {
  if (cache) return cache;
  let list: QueuedAction[] = [];
  try {
    const raw = await AsyncStorage.getItem(STORAGE.queue);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      list = parsed.filter((a) => a && a.type === 'MARK_READ' && Number.isFinite(Number(a.createdAt)))
        .map((a) => ({ type: a.type, createdAt: Number(a.createdAt), attempts: Number(a.attempts) || 0 }));
    }
  } catch { list = []; }
  cache = list.filter((a) => Date.now() - a.createdAt < MAX_AGE_MS);
  return cache;
}

async function save(list: QueuedAction[]): Promise<void> {
  cache = list;
  try { await AsyncStorage.setItem(STORAGE.queue, JSON.stringify(list)); } catch { /* keep in memory */ }
}

export async function enqueue(type: QueueType): Promise<void> {
  const list = [...(await load())];
  if (list.some((a) => a.type === type)) return; // one is enough (idempotent)
  list.push({ type, createdAt: Date.now(), attempts: 0 });
  await save(list);
}

export async function clearQueue(): Promise<void> { await save([]); }

async function send(type: QueueType) {
  if (type === 'MARK_READ') await ownerApi.markRead();
}

/** Single-flight: sends oldest first; network / server errors keep the item for the next try. */
export function flushQueue(): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = (async () => {
    const result: FlushResult = { done: [], dropped: [], remaining: 0 };
    const list = [...(await load())];
    const keep: QueuedAction[] = [];
    let stop = false;
    for (const a of list) {
      if (stop) { keep.push(a); continue; }
      try {
        await send(a.type);
        result.done.push(a.type);
      } catch (e) {
        if (e instanceof NetworkError || (e instanceof ApiError && (e.status >= 500 || e.status === 429))) {
          keep.push({ ...a, attempts: a.attempts + 1 });
          if (e instanceof NetworkError) stop = true;
        } else {
          result.dropped.push({ type: a.type, message: e instanceof Error ? e.message : 'Not sent' });
          if (e instanceof ApiError && e.status === 401) stop = true;
        }
      }
    }
    await save(keep);
    result.remaining = keep.length;
    return result;
  })().finally(() => { flushing = null; });
  return flushing;
}

/** Mark the inbox read now, or later when the internet is back. */
export async function markReadOrQueue(): Promise<void> {
  try {
    await ownerApi.markRead();
  } catch (e) {
    if (e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)) await enqueue('MARK_READ');
  }
}
