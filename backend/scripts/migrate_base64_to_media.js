// One-off, idempotent migration: moves legacy inline base64 images (data:image/...;base64,...)
// out of TEXT columns into the CampusMedia table and rewrites each column to the short media URL.
//
// • Runs in the background a minute after server start (server.js) and can also be run by hand:
//     node scripts/migrate_base64_to_media.js
// • Only rows whose value still starts with 'data:' are touched; each write is conditional on the
//   value being unchanged since it was read, so a concurrent user edit is never overwritten.
// • Values that are not real images (failed sniff) are left alone and counted as `skipped`.
// • Needs an absolute API base for the new URLs: PUBLIC_API_URL, or RENDER_EXTERNAL_URL (set by
//   Render automatically). Without one it does nothing (relative URLs would break clients).
const { Op } = require('sequelize');
const { withStatementTimeout } = require('../config/dbSettings');

// [modelName, column, ownerColumn|null, purpose, isPrivate, kind]  kind: 'text' | 'jsonArray'
const TARGETS = [
  ['User', 'profileImage', 'id', 'avatar', false, 'text'],
  ['DeliveryPartner', 'photoUrl', 'id', 'avatar', false, 'text'],
  ['Order', 'proofImage', 'deliveryPartnerId', 'delivery_proof', false, 'text'],
  ['Order', 'itemPhotoUrl', 'deliveryPartnerId', 'basket', false, 'text'],
  ['Order', 'billProofUrl', 'deliveryPartnerId', 'bill', false, 'text'],
  ['Order', 'upiScreenshot', 'userId', 'other', false, 'text'],
  ['MegaBasketItem', 'photoProofUrl', null, 'basket', false, 'text'],
  ['ServiceBooking', 'attachmentUrl', 'userId', 'service', false, 'text'],
  ['Restaurant', 'imageUrl', 'id', 'store', false, 'text'],
  ['Restaurant', 'logoUrl', 'id', 'store', false, 'text'],
  ['MenuItem', 'imageUrl', 'restaurantId', 'menu', false, 'text'],
  ['VaultItem', 'imageUrl', null, 'vault', false, 'text'],
  ['BirthdayCelebration', 'candidatePhotoUrl', 'userId', 'birthday', false, 'text'],
  ['WallSubmission', 'imageUrl', 'userId', 'wall', false, 'text'],
  ['CommunityPost', 'imageUrl', 'userId', 'post', false, 'text'],
  ['CommunityPost', 'userAvatar', 'userId', 'avatar', false, 'text'],
  ['CampusLostAndFound', 'imageUrl', 'userId', 'lost_found', false, 'text'],
  ['Message', 'mediaUrl', 'senderId', 'chat', false, 'text'],
  ['Conversation', 'groupAvatar', null, 'avatar', false, 'text'],
  ['CampusProfile', 'idCardImageUrl', 'userId', 'id_card', true, 'text'],
  ['CampusVerification', 'idCardImageUrl', 'userId', 'id_card', true, 'text'],
  ['PGHostel', 'images', 'ownerId', 'pg', false, 'jsonArray'],
];

const BATCH = 10;               // rows per query (a row can hold several MB)
const MAX_ROWS_PER_COLUMN = 2000; // per run; the next boot continues
const PAUSE_MS = 150;           // between batches, to stay gentle on the shared DB
const SCAN_TIMEOUT_MS = 120 * 1000; // per batch scan (see withStatementTimeout below)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// utils/publicUrl: PUBLIC_API_URL, else RENDER_EXTERNAL_URL (no request here), else ''.
const apiBase = () => require('../utils/publicUrl').apiBase(null, { renderFallback: true });

const runBase64MediaMigration = async ({ log = console.log } = {}) => {
  const base = apiBase();
  const summary = { moved: 0, skipped: 0, failed: 0, columns: {} };
  if (!/^https?:\/\//i.test(base)) {
    log('[BASE64_MIGRATION] Skipped: set PUBLIC_API_URL (or run on Render) so new image URLs are absolute.');
    return { ...summary, skippedReason: 'NO_PUBLIC_API_URL' };
  }
  const { getSequelize } = require('../config/db');
  const sequelize = getSequelize();
  if (!sequelize) return { ...summary, skippedReason: 'NO_DB' };
  const { decodeBase64Image, saveImageBytes, isDataUrl } = require('../utils/imageStore');

  const toMediaUrl = async (value, ownerId, purpose, isPrivate) => {
    const buf = decodeBase64Image(value, 8 * 1024 * 1024);
    if (!buf || buf === 'too_large') return null;
    try {
      const saved = await saveImageBytes(buf, { ownerId, purpose, isPrivate });
      return `${base}/api/campus/media/${saved.id}`;
    } catch {
      return null; // not a real image (sniff failed) or media table unavailable
    }
  };

  for (const [modelName, column, ownerCol, purpose, isPrivate, kind] of TARGETS) {
    const Model = sequelize.models[modelName];
    if (!Model || !Model.rawAttributes[column]) continue;
    const key = `${modelName}.${column}`;
    const stats = { moved: 0, skipped: 0, failed: 0 };
    const seenSkip = new Set();
    try {
      let processed = 0;
      while (processed < MAX_ROWS_PER_COLUMN) {
        const where = { [column]: { [Op.like]: kind === 'jsonArray' ? '%data:image%' : 'data:%' } };
        if (seenSkip.size) where.id = { [Op.notIn]: [...seenSkip] };
        const attrs = ['id', column];
        if (ownerCol && ownerCol !== 'id' && Model.rawAttributes[ownerCol]) attrs.push(ownerCol);
        // The LIKE scan reads (and de-TOASTs) every row of the column: on a big table it can outlast
        // the pool's statement_timeout (DB_STATEMENT_TIMEOUT_MS, 15 s), so this one query gets its own
        // limit (SET LOCAL in its own read-only transaction; SQLite: plain query).
        const rows = await withStatementTimeout(sequelize, SCAN_TIMEOUT_MS, (t) => Model.findAll({ where, attributes: attrs, limit: BATCH, raw: true, ...(t ? { transaction: t } : {}) }));
        if (!rows.length) break;
        for (const row of rows) {
          processed++;
          const raw = row[column];
          const owner = ownerCol ? row[ownerCol] : null;
          let next = null;
          if (kind === 'jsonArray') {
            let list = raw;
            if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = null; } }
            if (!Array.isArray(list)) { seenSkip.add(row.id); stats.skipped++; continue; }
            const out = [];
            let changed = false;
            for (const item of list) {
              if (isDataUrl(item)) {
                const url = await toMediaUrl(item, owner, purpose, isPrivate);
                if (url) { out.push(url); changed = true; } else { out.push(item); }
              } else {
                out.push(item);
              }
            }
            if (!changed) { seenSkip.add(row.id); stats.skipped++; continue; }
            next = JSON.stringify(out);
          } else {
            next = await toMediaUrl(raw, owner, purpose, isPrivate);
            if (!next) { seenSkip.add(row.id); stats.skipped++; continue; }
          }
          try {
            // Conditional on the value we read (raw SQL: model setters would re-encode JSON).
            const table = Model.getTableName();
            const tableName = typeof table === 'string' ? table : table.tableName;
            const [, meta] = await sequelize.query(
              `UPDATE "${tableName}" SET "${column}" = :next WHERE "id" = :id AND "${column}" = :prev`,
              { replacements: { next, id: row.id, prev: raw } }
            );
            const changedRows = meta && typeof meta.rowCount === 'number' ? meta.rowCount : (meta && typeof meta.changes === 'number' ? meta.changes : 1);
            if (changedRows) stats.moved++; else { stats.skipped++; seenSkip.add(row.id); }
          } catch (err) {
            stats.failed++;
            seenSkip.add(row.id);
            log(`[BASE64_MIGRATION] ${key} ${row.id}: ${err.message}`);
          }
        }
        await sleep(PAUSE_MS);
      }
    } catch (err) {
      log(`[BASE64_MIGRATION] ${key} stopped: ${err.message}`);
      stats.failed++;
    }
    if (stats.moved || stats.skipped || stats.failed) summary.columns[key] = stats;
    summary.moved += stats.moved;
    summary.skipped += stats.skipped;
    summary.failed += stats.failed;
  }
  return summary;
};

module.exports = { runBase64MediaMigration, TARGETS };

if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
  (async () => {
    const { connectDB } = require('../config/db');
    await connectDB();
    const r = await runBase64MediaMigration();
    console.log('[BASE64_MIGRATION]', JSON.stringify(r));
    process.exit(0);
  })().catch((err) => {
    console.error('[BASE64_MIGRATION] failed:', err.message);
    process.exit(1);
  });
}
