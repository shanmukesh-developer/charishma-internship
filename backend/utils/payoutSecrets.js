// Store bank account numbers (owner decision, 6 Nov 2026: ZenWe pays stores by bank transfer as well as UPI, so the
// full account number is kept). Encrypted at rest with AES-256-GCM; the column holds 'pd1:<iv>:<tag>:<ciphertext>'
// (base64). The key is PAYOUT_DETAILS_KEY when set (recommended: a long random secret in the Render environment),
// else derived from JWT_SECRET; both go through SHA-256 with a purpose label, so the key is never reused as-is.
//   CHANGING THE KEY makes stored numbers unreadable: decrypt then returns null and the admin page asks for the
//   number to be entered again (nothing is shown wrong, nothing crashes).
// Only admins ever see the full number, through the audited reveal (routes/revenueRoutes GET
// /stores/:id/payment-details?reveal=1). Everywhere else it is masked as ••••1234 (last 4 digits).
const crypto = require('crypto');

const PREFIX = 'pd1';
const keyOf = () => {
  const raw = process.env.PAYOUT_DETAILS_KEY || process.env.JWT_SECRET;
  if (!raw) throw new Error('No encryption key configured (PAYOUT_DETAILS_KEY or JWT_SECRET).');
  return crypto.createHash('sha256').update(`zenwe-payout-details:v1:${raw}`).digest();
};

/** Plain digits -> 'pd1:...' (throws when no key is configured, so a number is never stored in clear). */
const encryptAccount = (digits) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyOf(), iv);
  const ct = Buffer.concat([c.update(String(digits), 'utf8'), c.final()]);
  return `${PREFIX}:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
};

/** 'pd1:...' -> digits, or null when empty / unreadable (wrong key, damaged value). Never throws. */
const decryptAccount = (stored) => {
  if (!stored || typeof stored !== 'string') return null;
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', keyOf(), Buffer.from(parts[1], 'base64'));
    d.setAuthTag(Buffer.from(parts[2], 'base64'));
    const out = Buffer.concat([d.update(Buffer.from(parts[3], 'base64')), d.final()]).toString('utf8');
    return /^\d{9,18}$/.test(out) ? out : null;
  } catch {
    return null;
  }
};

/** '••••1234' from the last 4 digits (null when none). */
const maskAccount = (last4) => (last4 ? `••••${String(last4).slice(-4)}` : null);

module.exports = { encryptAccount, decryptAccount, maskAccount };
