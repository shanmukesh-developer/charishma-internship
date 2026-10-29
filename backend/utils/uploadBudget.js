// Per-account upload budget for the generic upload routes (POST /api/upload, POST /api/services/documents).
// 29 Oct 2026 security pass: any signed-in account could loop uploads (2 MB photos, 5 MB PDFs, new random bytes
// each time so nothing deduplicates) and fill the database. Each account may store MAX_FILES files and
// MAX_BYTES bytes per rolling hour; admins are exempt (catalogue work uploads many photos). In memory per
// process: a restart resets it, which is fine for abuse control (same as the campus media budget).
const WINDOW_MS = 60 * 60 * 1000;
const MAX_FILES = 60;
const MAX_BYTES = 150 * 1024 * 1024;

const log = new Map(); // ownerId -> [{ at, bytes }]
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of log) if (!list.length || now - list[list.length - 1].at >= WINDOW_MS) log.delete(k);
}, 10 * 60 * 1000).unref?.();

/**
 * Records an upload of `bytes` for `ownerId` when the budget allows it. Returns null when allowed, else
 * { retryAfter } in seconds (nothing recorded). `exempt`: admins.
 */
const take = (ownerId, bytes, { exempt = false } = {}) => {
  if (exempt || !ownerId) return null;
  const now = Date.now();
  const key = String(ownerId);
  const list = (log.get(key) || []).filter((e) => now - e.at < WINDOW_MS);
  const used = list.reduce((sum, e) => sum + e.bytes, 0);
  if (list.length >= MAX_FILES || used + (Number(bytes) || 0) > MAX_BYTES) {
    log.set(key, list);
    const oldest = list.length ? list[0].at : now;
    return { retryAfter: Math.max(60, Math.ceil((oldest + WINDOW_MS - now) / 1000)) };
  }
  list.push({ at: now, bytes: Number(bytes) || 0 });
  log.set(key, list);
  return null;
};

/** The refusal every route sends (429, Retry-After). */
const refuse = (res, over) => {
  res.set('Retry-After', String(over.retryAfter));
  return res.status(429).json({ code: 'UPLOAD_LIMIT', retryAfter: over.retryAfter, message: 'Too many uploads from this account in the last hour. Please try again later.' });
};

const isAdmin = (user) => String((user && user.role) || '').toLowerCase() === 'admin';

module.exports = { take, refuse, isAdmin, MAX_FILES, MAX_BYTES, _reset: () => log.clear() };
