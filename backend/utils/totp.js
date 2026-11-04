// S1: RFC 6238 TOTP (HMAC-SHA1, 30 s step, 6 digits, ±1 step window) + RFC 4648 base32 + secret
// encryption at rest. No dependencies beyond node:crypto.
//
// Encryption key (AES-256-GCM):
//   TOTP_ENC_KEY set   -> its bytes (64 hex chars or base64 of 32 bytes; any other string is run through HKDF)
//   TOTP_ENC_KEY unset -> HKDF-SHA256(JWT_SECRET, salt 'zenvy-totp-v1', info 'admin-totp-secret')
// Stored as 'v1.<keyId>.<iv b64url>.<tag b64url>.<ciphertext b64url>' where keyId is 'e' (TOTP_ENC_KEY),
// 'o' (TOTP_ENC_KEY_OLD, for a key rotation) or 'j' (JWT-derived). Secrets encrypted with the JWT-derived key
// keep working after TOTP_ENC_KEY is set (and are re-encrypted with it on the next successful code).
const crypto = require('crypto');

const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const base32Encode = (buf) => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
};

const base32Decode = (str) => {
  const clean = String(str || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

/** RFC 4226 HOTP. */
const hotp = (key, counter, digits = DIGITS, algo = 'sha1') => {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac(algo, key).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
};

// Injectable clock (tests only).
let clockFn = () => Date.now();
const _setClock = (fn) => { clockFn = typeof fn === 'function' ? fn : () => Date.now(); };
const nowMs = () => clockFn();

const stepAt = (ms = nowMs()) => Math.floor(ms / 1000 / STEP_SECONDS);

/** RFC 6238 TOTP at time `ms` (key = raw secret bytes). */
const totp = (key, ms = nowMs(), { digits = DIGITS, algo = 'sha1' } = {}) => hotp(key, stepAt(ms), digits, algo);

const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Checks `code` against steps now-WINDOW..now+WINDOW. Returns the matched step, or null.
 * A step <= lastUsedStep is never accepted (no replay of a code already used).
 */
const verify = (key, code, { ms = nowMs(), window = WINDOW, lastUsedStep = null } = {}) => {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = stepAt(ms);
  let hit = null;
  for (let s = now - window; s <= now + window; s++) {
    if (safeEq(hotp(key, s), c)) hit = hit === null ? s : hit; // constant work: every step is computed
  }
  if (hit === null) return null;
  if (lastUsedStep !== null && lastUsedStep !== undefined && hit <= Number(lastUsedStep)) return null;
  return hit;
};

const newSecret = () => crypto.randomBytes(20); // 160-bit, RFC 4226 recommendation

/** otpauth:// URI for authenticator apps (Google Authenticator, Authy, 1Password, ...). */
const otpauthUri = ({ secretB32, account, issuer = 'ZENV Admin' }) => {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new (require('url').URLSearchParams)({ secret: secretB32, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${q.toString()}`;
};

// ── secret encryption ────────────────────────────────────────────────────────────────────────────
const hkdf = (ikm, info) => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(ikm)), Buffer.from('zenvy-totp-v1'), Buffer.from(info), 32));
const keyFromEnv = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  try {
    const b = Buffer.from(s, 'base64');
    if (b.length === 32 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return b;
  } catch { /* not base64 */ }
  return hkdf(s, 'admin-totp-secret');
};
const keys = (env = process.env) => {
  const out = {};
  const e = keyFromEnv(env.TOTP_ENC_KEY);
  if (e) out.e = e;
  const o = keyFromEnv(env.TOTP_ENC_KEY_OLD);
  if (o) out.o = o;
  if (env.JWT_SECRET) out.j = hkdf(env.JWT_SECRET, 'admin-totp-secret');
  return out;
};
const currentKeyId = (env = process.env) => (keyFromEnv(env.TOTP_ENC_KEY) ? 'e' : 'j');

const b64u = (b) => Buffer.from(b).toString('base64url');
const encryptSecret = (secret, env = process.env) => {
  const id = currentKeyId(env);
  const key = keys(env)[id];
  if (!key) throw new Error('No TOTP encryption key (set TOTP_ENC_KEY or JWT_SECRET).');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(secret), c.final()]);
  return `v1.${id}.${b64u(iv)}.${b64u(c.getAuthTag())}.${b64u(ct)}`;
};
/** -> { secret: Buffer, keyId, stale: boolean (not under the current key) }; throws when unreadable. */
const decryptSecret = (stored, env = process.env) => {
  const parts = String(stored || '').split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') throw new Error('unknown TOTP secret format');
  const [, id, iv, tag, ct] = parts;
  const k = keys(env);
  const order = [id, ...['e', 'o', 'j'].filter((x) => x !== id)];
  for (const kid of order) {
    if (!k[kid]) continue;
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', k[kid], Buffer.from(iv, 'base64url'));
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      const secret = Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]);
      return { secret, keyId: kid, stale: kid !== currentKeyId(env) };
    } catch { /* try the next key */ }
  }
  throw new Error('TOTP secret cannot be decrypted with the configured keys');
};

// ── recovery codes ───────────────────────────────────────────────────────────────────────────────
const RC_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i
const newRecoveryCode = () => {
  let s = '';
  const bytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i++) s += RC_ALPHABET[bytes[i] % RC_ALPHABET.length];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
};
const normalizeRecoveryCode = (c) => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hashRecoveryCode = (c) => crypto.createHash('sha256').update(`zenvy-rc:${normalizeRecoveryCode(c)}`).digest('hex');

module.exports = {
  STEP_SECONDS, DIGITS, WINDOW, _setClock, nowMs, base32Encode, base32Decode, hotp, totp, stepAt, verify, newSecret, otpauthUri,
  encryptSecret, decryptSecret, currentKeyId, newRecoveryCode, normalizeRecoveryCode, hashRecoveryCode,
};
