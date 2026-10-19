// Where uploaded image bytes live (future-ready infra, NEXT_STEPS item 5).
//
// Every upload is still ONE CampusMedia row (id, owner, purpose, mime, size, sha256, isPrivate) and every
// URL is still /api/campus/media/<id>: response shapes and stored links never change. Only the bytes move:
//
//   driver 'db' (default)  bytes in CampusMedia.bytes — exactly today's behaviour.
//   driver 's3'            bytes in an S3-compatible bucket (Cloudflare R2); the row keeps an EMPTY bytes
//                          value (the NOT NULL column needs no schema change). Key = <R2_KEY_PREFIX>/<id>.
//
// A row is "external" when its bytes are empty and its size is > 0. Reads look at the row, not at the
// driver: rows written before a switch keep being served from the database, rows written to R2 keep being
// served from R2 after a rollback to 'db' (as long as the R2 credentials stay set). An R2 failure while
// uploading falls back to storing the bytes in the database (logged), so uploads never fail because of R2.
//
// Env (all optional; nothing set = 'db', no behaviour change):
//   MEDIA_STORAGE=db|s3            driver for NEW uploads (s3 needs the R2_* settings below, else 'db' is used)
//   R2_ACCOUNT_ID                  Cloudflare account id → endpoint https://<id>.r2.cloudflarestorage.com
//   R2_ENDPOINT                    explicit S3 endpoint instead (any S3-compatible service, local test server)
//   R2_REGION                      signing region (default 'auto', what R2 expects)
//   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY   R2 API token (Object Read & Write on the bucket(s))
//   R2_BUCKET                      bucket for every object (PRIVATE: no public access)
//   R2_PUBLIC_BUCKET               separate bucket for public photos (needed for R2_PUBLIC_URL)
//   R2_PUBLIC_URL                  public base of R2_PUBLIC_BUCKET (r2.dev or a custom domain such as
//                                  https://media.<domain>). Public photos then redirect there (CDN). Ignored
//                                  unless R2_PUBLIC_BUCKET is set and differs from R2_BUCKET: a public
//                                  bucket must never hold ID cards / driver documents.
//   R2_KEY_PREFIX                  object key prefix (default 'campus-media')
//   MEDIA_PRIVATE_DELIVERY=proxy|redirect   private photos: streamed by the backend after the usual
//                                  owner / admin / signed-link check (default), or a 302 to a presigned
//                                  R2 GET valid MEDIA_PRESIGN_TTL_S seconds (default 300)
//
// Interface of a driver: { name, put(key, buf, meta), get(key, meta) -> { stream, size, contentType } | null,
//                           delete(key, meta), publicUrl(key, meta) -> string | null, signedUrl(key, meta) -> string | null }
const crypto = require('crypto');
const { Readable } = require('stream');

const EMPTY = Buffer.alloc(0);
const warned = new Set();
const warnOnce = (key, msg) => { if (!warned.has(key)) { warned.add(key); console.warn(msg); } };
const clean = (v) => String(v || '').trim();

const readConfig = (env = process.env) => {
  const accountId = clean(env.R2_ACCOUNT_ID);
  const endpoint = clean(env.R2_ENDPOINT).replace(/\/+$/, '') || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const bucket = clean(env.R2_BUCKET);
  let publicBucket = clean(env.R2_PUBLIC_BUCKET);
  let publicUrl = clean(env.R2_PUBLIC_URL).replace(/\/+$/, '');
  if (publicUrl && !/^https?:\/\/[^\s]+$/i.test(publicUrl)) {
    warnOnce('pubUrlBad', '[MEDIA_STORAGE] R2_PUBLIC_URL is not an absolute URL and is ignored.');
    publicUrl = '';
  }
  if (publicUrl && (!publicBucket || publicBucket === bucket)) {
    warnOnce('pubBucket', '[MEDIA_STORAGE] R2_PUBLIC_URL is ignored: set R2_PUBLIC_BUCKET to a separate public bucket (R2_BUCKET holds private documents and must stay private).');
    publicUrl = '';
  }
  if (!publicBucket || publicBucket === bucket) publicBucket = bucket;
  const configured = !!(endpoint && bucket && clean(env.R2_ACCESS_KEY_ID) && clean(env.R2_SECRET_ACCESS_KEY));
  const requested = clean(env.MEDIA_STORAGE).toLowerCase() === 's3' ? 's3' : 'db';
  const ttl = Number(env.MEDIA_PRESIGN_TTL_S);
  return {
    requested,
    configured,
    endpoint,
    region: clean(env.R2_REGION) || 'auto',
    accessKeyId: clean(env.R2_ACCESS_KEY_ID),
    secretAccessKey: clean(env.R2_SECRET_ACCESS_KEY),
    bucket,
    publicBucket,
    publicUrl,
    prefix: (clean(env.R2_KEY_PREFIX) || 'campus-media').replace(/^\/+|\/+$/g, ''),
    privateDelivery: clean(env.MEDIA_PRIVATE_DELIVERY).toLowerCase() === 'redirect' ? 'redirect' : 'proxy',
    presignTtlS: Number.isFinite(ttl) && ttl >= 30 && ttl <= 3600 ? Math.floor(ttl) : 300,
  };
};

let cfg = null;
let s3Client = null;
let clientFactory = null; // tests: inject a fake S3 client
const config = () => cfg || (cfg = readConfig());

/** Tests / scripts: re-read env (and optionally inject a client factory(cfg) -> S3Lite-like). */
const reload = (env = process.env, { factory } = {}) => {
  cfg = readConfig(env);
  s3Client = null;
  if (factory !== undefined) clientFactory = factory;
  return cfg;
};

const client = () => {
  const c = config();
  if (!c.configured) return null;
  if (!s3Client) {
    if (clientFactory) s3Client = clientFactory(c);
    else {
      const { S3Lite } = require('./s3Lite');
      s3Client = new S3Lite({ endpoint: c.endpoint, region: c.region, accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, timeoutMs: Math.max(1000, Number(process.env.MEDIA_STORAGE_TIMEOUT_MS) || 15000) });
    }
  }
  return s3Client;
};

/** Driver used for NEW uploads: 's3' only when requested AND configured. */
const driverName = () => {
  const c = config();
  if (c.requested === 's3' && !c.configured) {
    warnOnce('s3NotConfigured', '[MEDIA_STORAGE] MEDIA_STORAGE=s3 but R2 is not fully configured (R2_ACCOUNT_ID or R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY): uploads stay in the database.');
    return 'db';
  }
  return c.requested;
};

/** True when an object store can be read / written (R2 credentials set), whatever the upload driver. */
const objectStoreConfigured = () => config().configured;

const objectKey = (id) => `${config().prefix}/${String(id).toLowerCase()}`;
const bucketFor = (isPrivate) => (isPrivate ? config().bucket : config().publicBucket);

const bytesLength = (row) => {
  const b = row && row.bytes;
  if (b === null || b === undefined) return 0;
  if (Buffer.isBuffer(b)) return b.length;
  if (typeof b === 'string') return b.length;
  if (b && typeof b.length === 'number') return b.length;
  return 0;
};

/** The row's bytes live in the object store (empty bytes, real size). */
const isExternal = (row) => !!row && bytesLength(row) === 0 && Number(row.size) > 0;

// ── Drivers ─────────────────────────────────────────────────────────────────────────────────────
const mediaModel = () => {
  const { getCampusMediaModel } = require('../modules/campus/models/CampusMedia');
  return getCampusMediaModel && getCampusMediaModel();
};

const dbDriver = {
  name: 'db',
  // key = CampusMedia id. The row IS the object: put writes its bytes, delete is the row's own destroy.
  async put(key, buf) {
    const Media = mediaModel();
    await Media.update({ bytes: buf, size: buf.length }, { where: { id: key } });
    return { key };
  },
  async get(key) {
    const Media = mediaModel();
    const row = Media && await Media.findByPk(key);
    if (!row || isExternal(row)) return null;
    const bytes = Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes || []);
    return { stream: Readable.from([bytes]), size: bytes.length, contentType: row.mime };
  },
  async delete() { return true; },
  publicUrl(key) { return `/api/campus/media/${key}`; },
  signedUrl() { return null; }, // db media is signed by modules/campus/controllers/mediaController.signedMediaUrl
};

const s3Driver = {
  name: 's3',
  async put(key, buf, { contentType, isPrivate = false, sha256 } = {}) {
    const c = client();
    if (!c) throw new Error('object store not configured');
    await c.putObject(bucketFor(isPrivate), key, buf, {
      contentType: contentType || 'application/octet-stream',
      cacheControl: isPrivate ? 'private, max-age=86400' : 'public, max-age=31536000, immutable',
      metadata: sha256 ? { sha256 } : {},
    });
    return { key };
  },
  async get(key, { isPrivate = false } = {}) {
    const c = client();
    if (!c) return null;
    let obj = await c.getObject(bucketFor(isPrivate), key);
    // A row whose privacy flag changed after upload: look in the other bucket once.
    if (!obj && config().publicBucket !== config().bucket) obj = await c.getObject(bucketFor(!isPrivate), key);
    if (!obj) return null;
    return { stream: obj.stream, size: obj.contentLength, contentType: obj.contentType };
  },
  async delete(key, { isPrivate = false } = {}) {
    const c = client();
    if (!c) return false;
    await c.deleteObject(bucketFor(isPrivate), key);
    return true;
  },
  publicUrl(key, { isPrivate = false } = {}) {
    const c = config();
    if (isPrivate || !c.publicUrl) return null;
    return `${c.publicUrl}/${require('./s3Lite').encodeKeyPath(key)}`;
  },
  signedUrl(key, { isPrivate = false, ttlS } = {}) {
    const c = client();
    if (!c) return null;
    return c.presignGet(bucketFor(isPrivate), key, ttlS || config().presignTtlS);
  },
};

const DRIVERS = { db: dbDriver, s3: s3Driver };
const getDriver = (name = driverName()) => DRIVERS[name] || dbDriver;

// ── High-level helpers used by the upload / serve code ───────────────────────────────────────────

/**
 * Creates the CampusMedia row for new bytes. 'db': Media.create({... bytes }) exactly as before.
 * 's3': upload first (key from a fresh id), then the row with empty bytes; an upload failure falls back
 * to 'db' for this file. attrs: { ownerId, purpose, mime, size, sha256, isPrivate }.
 */
const createMediaRow = async (Media, attrs, buf) => {
  if (driverName() !== 's3') return Media.create({ ...attrs, bytes: buf });
  const id = crypto.randomUUID();
  const key = objectKey(id);
  const sha256 = attrs.sha256 || crypto.createHash('sha256').update(buf).digest('hex');
  try {
    await s3Driver.put(key, buf, { contentType: attrs.mime, isPrivate: !!attrs.isPrivate, sha256 });
  } catch (err) {
    console.warn('[MEDIA_STORAGE] R2 upload failed, kept in the database:', err.message);
    return Media.create({ ...attrs, bytes: buf });
  }
  try {
    return await Media.create({ ...attrs, id, sha256, size: buf.length, bytes: EMPTY });
  } catch (err) {
    s3Driver.delete(key, { isPrivate: !!attrs.isPrivate }).catch(() => {});
    throw err;
  }
};

/**
 * How to deliver an external row: { redirect, cacheControl } or { proxy: true }.
 * Public + R2_PUBLIC_URL → 302 to the CDN copy. Private + MEDIA_PRIVATE_DELIVERY=redirect → 302 to a
 * short presigned GET (no-store). Everything else streams through the backend.
 */
const deliveryPlan = (row) => {
  const key = objectKey(row.id);
  const isPrivate = !!row.isPrivate;
  if (!isPrivate) {
    const pub = s3Driver.publicUrl(key, { isPrivate });
    if (pub) return { redirect: pub, cacheControl: 'public, max-age=86400' };
    return { proxy: true };
  }
  if (config().privateDelivery === 'redirect') {
    const url = s3Driver.signedUrl(key, { isPrivate: true });
    if (url) return { redirect: url, cacheControl: 'private, no-store' };
  }
  return { proxy: true };
};

/** Stream of an external row's bytes ({ stream, size, contentType } or null). */
const readExternal = (row) => s3Driver.get(objectKey(row.id), { isPrivate: !!row.isPrivate });

/** Whole bytes of a row (db or external), for scripts. */
const readAllBytes = async (row) => {
  if (!isExternal(row)) return Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes || []);
  const c = client();
  if (!c) return null;
  let buf = await c.getObjectBuffer(bucketFor(!!row.isPrivate), objectKey(row.id));
  if (!buf && config().publicBucket !== config().bucket) buf = await c.getObjectBuffer(bucketFor(!row.isPrivate), objectKey(row.id));
  return buf;
};

/** Best-effort delete of the objects of rows that are gone (model hooks). Never throws. */
const deleteObjects = async (items) => {
  if (!objectStoreConfigured() || !items || !items.length) return 0;
  let n = 0;
  for (const it of items) {
    try { await s3Driver.delete(objectKey(it.id), { isPrivate: !!it.isPrivate }); n++; } catch (err) {
      console.warn('[MEDIA_STORAGE] could not delete object', String(it.id).slice(0, 8), err.message);
    }
  }
  return n;
};

/** For health / metrics (no secrets). */
const status = () => {
  const c = config();
  return {
    driver: driverName(),
    requested: c.requested,
    objectStore: c.configured ? { bucket: c.bucket, publicBucket: c.publicBucket !== c.bucket ? c.publicBucket : null, publicUrl: !!c.publicUrl, privateDelivery: c.privateDelivery } : null,
  };
};

module.exports = {
  EMPTY,
  readConfig,
  reload,
  config,
  client,
  driverName,
  objectStoreConfigured,
  objectKey,
  bucketFor,
  isExternal,
  getDriver,
  DRIVERS,
  createMediaRow,
  deliveryPlan,
  readExternal,
  readAllBytes,
  deleteObjects,
  status,
};
