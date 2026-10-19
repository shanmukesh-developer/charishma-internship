// Store / menu photos that point at upload.wikimedia.org -> our own CampusMedia rows (ON by default since 20 Oct 2026, owner approved; REHOST_WIKIMEDIA_IMAGES=false turns it off).
//
// Why: Wikimedia refuses React Native's default User-Agent (403, robot policy T400119) and rate-limits
// hotlinked thumbnails per IP (429 after ~15-20 requests, measured 19 Oct 2026). A campus Wi-Fi shares
// one IP, so menu photos fail at random in every app. Copying each photo once into the media table
// (served from /api/campus/media/<id> with immutable caching) removes the dependency.
//
// • Background job 'media.wikimediaRehost' (jobs/index.js): runs unless REHOST_WIKIMEDIA_IMAGES=false,
//   3 min after boot and then every 6 h until nothing is left. Can also be run by hand:
//     node scripts/rehost_wikimedia_images.js            dry run: counts only, nothing fetched or written
//     node scripts/rehost_wikimedia_images.js --apply    fetch + store + rewrite the rows
// • Gentle: one Wikimedia request every 2 s with a descriptive User-Agent, honours Retry-After, stops the
//   run after 3 refusals in a row (the next run continues). At most MAX_PER_RUN photos per run.
// • Fetches the 500 px thumbnail (enough for list and detail views, about 30-80 KB) and falls back to the
//   stored URL when that size does not exist.
// • Each row update is conditional on the value it read, so an edit made meanwhile is never overwritten.
// • Wikimedia Commons photos are mostly CC BY-SA: copying them does not remove the attribution duty.
//   Real stores should replace them with their own photos.
const { Op } = require('sequelize');

const HOST = 'https://upload.wikimedia.org/';
const USER_AGENT = `ZenvyMediaCopy/1.0 (https://hostelbites-backend-jwmt.onrender.com; ${process.env.SUPPORT_EMAIL || 'projectshanmukh@gmail.com'})`;
const MAX_PER_RUN = 120;
const GAP_MS = 2000;
const MAX_REFUSALS = 3;
const MAX_BYTES = 2 * 1024 * 1024;

// [modelName, column, ownerColumn, purpose]
const TARGETS = [
  ['Restaurant', 'imageUrl', 'id', 'store'],
  ['Restaurant', 'logoUrl', 'id', 'store'],
  ['MenuItem', 'imageUrl', 'restaurantId', 'menu'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const enabled = () => String(process.env.REHOST_WIKIMEDIA_IMAGES || '').trim().toLowerCase() !== 'false';

/** 500 px thumbnail of a Commons file URL (thumb or original), or null when the URL has no such form. */
const thumb500 = (url) => {
  const path = url.slice(HOST.length - 1);
  const t = /^(\/wikipedia\/[^/]+\/thumb\/.+\/)(\d+)px-([^/?#]+)$/.exec(path);
  if (t) return Number(t[2]) > 500 ? `${HOST.slice(0, -1)}${t[1]}500px-${t[3]}` : null;
  const o = /^\/wikipedia\/([^/]+)\/([0-9a-f]\/[0-9a-f]{2})\/([^/?#]+\.(?:jpe?g|png|webp))$/i.exec(path);
  return o ? `${HOST}wikipedia/${o[1]}/thumb/${o[2]}/${o[3]}/500px-${o[3]}` : null;
};

/** { ok, buf } | { ok: false, refused, retryAfterMs, status } */
const fetchImage = async (url, fetchImpl) => {
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
  if (res.status === 429 || res.status === 403) {
    const ra = Number(res.headers.get('retry-after'));
    return { ok: false, refused: true, status: res.status, retryAfterMs: Number.isFinite(ra) && ra > 0 ? Math.min(ra, 300) * 1000 : 60000 };
  }
  if (!res.ok) return { ok: false, status: res.status };
  const len = Number(res.headers.get('content-length'));
  if (len && len > MAX_BYTES) return { ok: false, status: 413 };
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > MAX_BYTES) return { ok: false, status: 413 };
  return { ok: true, buf };
};

const runWikimediaRehost = async ({ apply = true, log = console.log, fetchImpl = globalThis.fetch, gapMs = GAP_MS, maxPerRun = MAX_PER_RUN, sequelize: seq = null, base: baseOverride = null } = {}) => {
  const summary = { urls: 0, copied: 0, rowsUpdated: 0, failed: 0, refused: 0, left: 0, dryRun: !apply };
  const base = baseOverride || require('../utils/publicUrl').apiBase(null, { renderFallback: true });
  if (apply && !/^https?:\/\//i.test(base)) return { ...summary, skippedReason: 'NO_PUBLIC_API_URL' };
  const sequelize = seq || require('../config/db').getSequelize();
  if (!sequelize) return { ...summary, skippedReason: 'NO_DB' };
  const { saveImageBytes } = require('../utils/imageStore');

  // url -> [{ Model, column, id, owner, purpose }]
  const refs = new Map();
  for (const [modelName, column, ownerCol, purpose] of TARGETS) {
    const Model = sequelize.models[modelName];
    if (!Model || !Model.rawAttributes[column]) continue;
    const attrs = ['id', column, ...(ownerCol !== 'id' && Model.rawAttributes[ownerCol] ? [ownerCol] : [])];
    const rows = await Model.findAll({ where: { [column]: { [Op.like]: `${HOST}%` } }, attributes: attrs, raw: true });
    for (const r of rows) {
      const url = String(r[column]);
      if (!refs.has(url)) refs.set(url, []);
      refs.get(url).push({ Model, column, id: r.id, owner: r[ownerCol], purpose });
    }
  }
  summary.urls = refs.size;
  if (!apply) {
    summary.left = refs.size;
    summary.rows = [...refs.values()].reduce((n, l) => n + l.length, 0);
    return summary;
  }

  let refusals = 0;
  let done = 0;
  for (const [url, list] of refs) {
    if (done >= maxPerRun) break;
    done++;
    let got = null;
    const small = thumb500(url);
    for (const candidate of small ? [small, url] : [url]) {
      got = await fetchImage(candidate, fetchImpl);
      await sleep(gapMs);
      if (got.ok || got.refused) break;
    }
    if (!got.ok) {
      if (got.refused) {
        summary.refused++;
        refusals++;
        if (refusals >= MAX_REFUSALS) { log(`[WIKI_REHOST] Wikimedia refused ${refusals} times in a row; continuing next run.`); break; }
        await sleep(got.retryAfterMs);
      } else {
        summary.failed++;
        log(`[WIKI_REHOST] ${got.status || 'network'} for ${url.slice(0, 140)}`);
      }
      continue;
    }
    refusals = 0;
    try {
      // One media row per store (owner) and purpose; the same bytes are de-duplicated by saveImageBytes.
      const byOwner = new Map();
      for (const ref of list) {
        const key = `${ref.owner || ''}|${ref.purpose}`;
        if (!byOwner.has(key)) {
          const saved = await saveImageBytes(got.buf, { ownerId: ref.owner, purpose: ref.purpose, isPrivate: false });
          byOwner.set(key, `${base}/api/campus/media/${saved.id}`);
        }
        const next = byOwner.get(key);
        const [n] = await ref.Model.update({ [ref.column]: next }, { where: { id: ref.id, [ref.column]: url }, hooks: false });
        summary.rowsUpdated += Number(n) || 0;
      }
      summary.copied++;
    } catch (err) {
      summary.failed++;
      log(`[WIKI_REHOST] could not store ${url.slice(0, 140)}: ${err.message}`);
    }
  }
  summary.left = Math.max(0, refs.size - summary.copied);
  if (summary.rowsUpdated) {
    // Listing caches and connected apps pick the new links up at once.
    try { require('../utils/realtime').publish('store', 'updated', null); } catch { /* best effort */ }
  }
  return summary;
};

module.exports = { runWikimediaRehost, thumb500, enabled, TARGETS };

if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
  (async () => {
    const { connectDB } = require('../config/db');
    await connectDB();
    const r = await runWikimediaRehost({ apply: process.argv.includes('--apply') });
    console.log('[WIKI_REHOST]', JSON.stringify(r));
    process.exit(0);
  })().catch((err) => {
    console.error('[WIKI_REHOST] failed:', err.message);
    process.exit(1);
  });
}
