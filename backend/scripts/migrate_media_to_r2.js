#!/usr/bin/env node
// Moves CampusMedia image bytes from the database to Cloudflare R2 (or back). DRY RUN by default.
//
//   node scripts/migrate_media_to_r2.js                       dry run: what would move, nothing written
//   node scripts/migrate_media_to_r2.js --apply               upload + verify every row still in the DB
//   node scripts/migrate_media_to_r2.js --apply --purge-after-verify
//                                                             ...and then empty the DB bytes of VERIFIED rows
//   node scripts/migrate_media_to_r2.js --to-db --apply       rollback: copy R2 objects back into the rows
//                                                             (--purge-after-verify also deletes the objects)
// Options: --batch=20 (rows per batch, 1..200)  --limit=N (stop after N rows)  --state=<file> (resume file,
//          default scripts/.migrate_media_state.json)  --reset-state  --sqlite=<path> (local test database)
//
// Safety:
//   • Without --apply nothing is written anywhere (database or bucket).
//   • A row's bytes are only emptied after the object was read BACK from R2 and its SHA-256 matched the
//     database bytes (and the row's stored sha256), and only with --purge-after-verify. The UPDATE is guarded
//     by the row's size and sha256, so a row that changed meanwhile is left alone.
//   • Resumable: progress (last createdAt + id) is saved after every batch; an object that is already in the
//     bucket with the same sha256 is not uploaded again; rows already in R2 are skipped.
//   • Needs the same env as the server: DATABASE_URL (+ DB_SSL) and R2_* (see utils/mediaStorage.js).
//     MEDIA_STORAGE does not matter here. Run it from the backend folder on your own machine or a Render shell.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch { /* optional */ }

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};

const APPLY = flag('apply');
const PURGE = flag('purge-after-verify');
const TO_DB = flag('to-db');
const BATCH = Math.max(1, Math.min(200, Number(opt('batch', 20)) || 20));
const LIMIT = Number(opt('limit', 0)) || 0;
const STATE_FILE = path.resolve(opt('state', path.join(__dirname, `.migrate_media_state${TO_DB ? '_to_db' : ''}.json`)));
const SQLITE = opt('sqlite', '');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log(...a);

const openDb = async () => {
  const { Sequelize } = require('sequelize');
  let sequelize;
  if (SQLITE) {
    sequelize = new Sequelize({ dialect: 'sqlite', storage: path.resolve(SQLITE), logging: false });
  } else {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set (or pass --sqlite=<file> for a local copy).');
    const dbSettings = require('../config/dbSettings');
    let host = '';
    try { host = new URL(url).hostname; } catch { /* ignore */ }
    const dialectOptions = {};
    const ssl = dbSettings.getSslOptions(host);
    if (ssl) dialectOptions.ssl = ssl;
    sequelize = new Sequelize(url, { dialect: 'postgres', dialectOptions, logging: false, pool: { max: 2, min: 0 } });
  }
  await sequelize.authenticate();
  const { initCampusMediaModel } = require('../modules/campus/models/CampusMedia');
  const Media = initCampusMediaModel(sequelize);
  return { sequelize, Media };
};

const loadState = () => {
  if (flag('reset-state')) return null;
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
};
const saveState = (state) => {
  if (!APPLY) return;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
};

const main = async () => {
  const storage = require('../utils/mediaStorage');
  const cfg = storage.config();
  log(`[media→${TO_DB ? 'db' : 'r2'}] ${APPLY ? 'APPLY' : 'DRY RUN (add --apply to write)'}${PURGE ? ' + purge after verify' : ''}; batch=${BATCH}${LIMIT ? ` limit=${LIMIT}` : ''}`);
  if (!cfg.configured && (APPLY || TO_DB)) {
    throw new Error('R2 is not configured: set R2_ACCOUNT_ID (or R2_ENDPOINT), R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.');
  }
  if (cfg.configured) log(`[media] bucket=${cfg.bucket}${cfg.publicBucket !== cfg.bucket ? ` publicBucket=${cfg.publicBucket}` : ''} prefix=${cfg.prefix}`);
  const { sequelize, Media } = await openDb();
  const { Op, fn, col } = require('sequelize');
  const s3 = cfg.configured ? storage.client() : null;

  const prev = loadState();
  const state = prev && prev.mode === (TO_DB ? 'to-db' : 'to-r2') ? prev : { mode: TO_DB ? 'to-db' : 'to-r2', cursor: null, stats: {} };
  if (prev && state === prev) log(`[media] resuming after ${state.cursor ? `${state.cursor.createdAt} / ${state.cursor.id}` : 'start'} (${STATE_FILE})`);
  const stats = Object.assign({ scanned: 0, candidates: 0, bytes: 0, uploaded: 0, alreadyThere: 0, verified: 0, verifyFailed: 0, purged: 0, restored: 0, missing: 0, errors: 0 }, state.stats || {});

  let processed = 0;
  for (;;) {
    const where = state.cursor
      ? { [Op.or]: [{ createdAt: { [Op.gt]: new Date(state.cursor.createdAt) } }, { createdAt: new Date(state.cursor.createdAt), id: { [Op.gt]: state.cursor.id } }] }
      : {};
    // Light listing first (no bytes), then the bytes of the candidates only.
    const page = await Media.findAll({
      where,
      attributes: ['id', 'size', 'sha256', 'isPrivate', 'mime', 'createdAt', [fn('LENGTH', col('bytes')), 'blen']],
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
      limit: BATCH,
      raw: true,
    });
    if (!page.length) break;
    for (const r of page) {
      stats.scanned++;
      const inDb = Number(r.blen) > 0;
      const external = !inDb && Number(r.size) > 0;
      const key = storage.objectKey(r.id);
      const bucket = storage.bucketFor(!!r.isPrivate);
      try {
        if (!TO_DB && inDb) {
          stats.candidates++;
          stats.bytes += Number(r.blen) || 0;
          if (APPLY) {
            const row = await Media.findByPk(r.id, { attributes: ['id', 'bytes', 'size', 'sha256', 'mime', 'isPrivate'] });
            const buf = Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes || []);
            const digest = sha(buf);
            if (row.sha256 && row.sha256 !== digest) {
              stats.verifyFailed++;
              log(`  ! ${r.id} stored sha256 does not match its bytes: left in the database`);
              continue;
            }
            const head = await s3.headObject(bucket, key);
            if (head && head.metadata && head.metadata.sha256 === digest && head.contentLength === buf.length) stats.alreadyThere++;
            else {
              await s3.putObject(bucket, key, buf, {
                contentType: row.mime || 'application/octet-stream',
                cacheControl: row.isPrivate ? 'private, max-age=86400' : 'public, max-age=31536000, immutable',
                metadata: { sha256: digest },
              });
              stats.uploaded++;
            }
            const back = await s3.getObjectBuffer(bucket, key);
            if (!back || back.length !== buf.length || sha(back) !== digest) {
              stats.verifyFailed++;
              log(`  ! ${r.id} verification FAILED (read-back differs): left in the database`);
              continue;
            }
            stats.verified++;
            if (PURGE) {
              const where2 = { id: row.id, size: row.size };
              if (row.sha256) where2.sha256 = row.sha256;
              const [n] = await Media.update({ bytes: storage.EMPTY, sha256: row.sha256 || digest }, { where: where2, hooks: false });
              if (n === 1) stats.purged++;
            }
          }
        } else if (TO_DB && external) {
          stats.candidates++;
          stats.bytes += Number(r.size) || 0;
          if (APPLY) {
            const buf = await s3.getObjectBuffer(bucket, key);
            if (!buf) { stats.missing++; log(`  ! ${r.id} object missing in ${bucket}/${key}`); continue; }
            if (buf.length !== Number(r.size) || (r.sha256 && sha(buf) !== r.sha256)) {
              stats.verifyFailed++;
              log(`  ! ${r.id} object does not match the row (size / sha256): row left as it is`);
              continue;
            }
            stats.verified++;
            const [n] = await Media.update({ bytes: buf }, { where: { id: r.id, size: r.size }, hooks: false });
            if (n === 1) stats.restored++;
            if (PURGE && n === 1) { await s3.deleteObject(bucket, key); stats.purged++; }
          }
        }
      } catch (err) {
        stats.errors++;
        log(`  ! ${r.id} ${err.message}`);
      }
      processed++;
      if (LIMIT && processed >= LIMIT) break;
    }
    const last = page[page.length - 1];
    state.cursor = { createdAt: new Date(last.createdAt).toISOString(), id: last.id };
    state.stats = stats;
    saveState(state);
    log(`[media] … scanned ${stats.scanned}, candidates ${stats.candidates} (${(stats.bytes / 1048576).toFixed(1)} MB)${APPLY ? `, verified ${stats.verified}, ${TO_DB ? `restored ${stats.restored}` : `uploaded ${stats.uploaded}, already there ${stats.alreadyThere}, purged ${stats.purged}`}` : ''}${stats.errors ? `, errors ${stats.errors}` : ''}`);
    if (LIMIT && processed >= LIMIT) break;
    if (page.length < BATCH) break;
  }
  await sequelize.close();
  log(`[media] DONE ${JSON.stringify(stats)}`);
  if (!APPLY) log('[media] dry run: nothing was written. Re-run with --apply.');
  else if (!TO_DB && !PURGE) log('[media] bytes are still in the database too. When the app has served from R2 for a while, re-run with --apply --purge-after-verify.');
  if (APPLY && !(LIMIT && processed >= LIMIT)) log(`[media] finished; delete ${STATE_FILE} (or pass --reset-state) before a fresh run.`);
  return stats;
};

if (require.main === module) {
  // exitCode (not process.exit): exiting while fetch keep-alive sockets close trips a libuv assertion on Windows.
  main().then((stats) => { process.exitCode = stats.errors || stats.verifyFailed ? 2 : 0; }).catch((err) => {
    console.error('[media] FAILED:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
