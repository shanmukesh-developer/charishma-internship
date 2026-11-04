/**
 * C8 order receipts.
 *
 *   Receipt number  ZNV/<financial year>/<6-digit sequence>, e.g. ZNV/2026-27/000123. The financial year
 *                   (April-March, IST) is the one the order was delivered in. Assigned exactly once, when the
 *                   order is Delivered (models/Order hooks; GET /api/orders/:id/receipt also assigns it for an
 *                   order delivered before C8). The counter row (ReceiptCounters) is incremented in the same
 *                   transaction that writes Order.receiptNumber WHERE receiptNumber IS NULL, so numbers are
 *                   unique, sequential and gap-free (a lost race rolls its increment back). Never changed after.
 *   Snapshot        seller + platform + tax-display details as they were at issue (Order.receiptSnapshot), so
 *                   a receipt never changes when a store later edits its licence or the owner its settings.
 *   Amounts         exactly the stored order numbers (priceBreakdown / finalPrice / billAmount): nothing is
 *                   recomputed or invented. Tax: "Prices inclusive of applicable taxes" (orderPricing has
 *                   taxes = 0, inclusive) unless RECEIPT_SETTINGS has a platform GSTIN + rate and breakdown
 *                   mode, in which case the GST contained in the amount charged is shown (never added).
 *   Link            /receipts/<token>: an HMAC-signed, short-lived (15 min) token naming the order, so the
 *                   receipt opens in a browser / share sheet without a login. Signed with a key derived from
 *                   JWT_SECRET that login tokens never use.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Transaction } = require('sequelize');

const PREFIX = 'ZNV';
const LINK_TTL_SEC = 15 * 60;
const IST_MS = 330 * 60 * 1000;

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Indian financial year label ('2026-27') of the IST date containing `d`. */
const financialYearOf = (d) => {
  const t = new Date(new Date(d || Date.now()).getTime() + IST_MS);
  const y = t.getUTCFullYear();
  const start = t.getUTCMonth() >= 3 ? y : y - 1; // April (month 3) starts the year
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};
const seriesOf = (d) => `${PREFIX}/${financialYearOf(d)}`;
const formatNumber = (series, n) => `${series}/${String(n).padStart(6, '0')}`;
const RECEIPT_NO_RE = /^ZNV\/\d{4}-\d{2}\/\d{6,}$/;

const parseJson = (v) => {
  if (v && typeof v === 'object') return v;
  if (typeof v !== 'string' || !v) return null;
  try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : null; } catch { return null; }
};

const sequelizeOf = () => {
  const { getOrderModel } = require('../models/Order');
  const Order = getOrderModel();
  return Order ? Order.sequelize : null;
};

/** Seller + platform + tax-display details right now (frozen into Order.receiptSnapshot at issue). */
const issuerSnapshot = async (restaurantId) => {
  const { getRestaurantModel } = require('../models/Restaurant');
  const Restaurant = getRestaurantModel();
  const store = Restaurant && restaurantId ? await Restaurant.findByPk(restaurantId, {
    attributes: ['id', 'name', 'location', 'legalName', 'fssaiLicenseNumber', 'fssaiLicenseType', 'fssaiExpiry', 'gstin', 'vendorType'],
  }) : null;
  const legal = await require('./legalSettings').getSettings();
  const rs = await require('./receiptSettings').getSettings();
  const mode = require('./receiptSettings').effectiveMode(rs);
  const { ymdOf } = require('./storeCompliance');
  return {
    v: 1,
    seller: store ? {
      id: store.id,
      name: store.name || null,
      legalName: store.legalName || null,
      address: store.location || null,
      fssaiLicenseNumber: store.fssaiLicenseNumber || null,
      fssaiLicenseType: store.fssaiLicenseType || null,
      fssaiExpiry: ymdOf(store.fssaiExpiry),
      gstin: store.gstin || null,
    } : { id: restaurantId || null, name: null, legalName: null, address: null, fssaiLicenseNumber: null, fssaiLicenseType: null, fssaiExpiry: null, gstin: null },
    platform: {
      name: legal.businessName || null,
      operatorName: legal.operatorName || null,
      address: legal.registeredAddress || null,
      contactEmail: legal.contactEmail || null,
      gstin: rs.platformGstin || null,
    },
    tax: mode === 'breakdown' ? { mode, ratePercent: rs.gstRatePercent } : { mode: 'inclusive', ratePercent: null },
    footerNote: rs.footerNote || null,
  };
};

class LostRace extends Error {}

/**
 * Gives a Delivered order its receipt number (once). Returns the number, or null when the order does not
 * exist / is not Delivered / the counter table is missing. Safe to call any number of times, in parallel.
 */
const assignReceiptNumber = async (orderId) => {
  const { getOrderModel } = require('../models/Order');
  const Order = getOrderModel();
  const sequelize = Order && Order.sequelize;
  if (!sequelize || !sequelize.models.ReceiptCounter || !orderId) return null;
  const order = await Order.findByPk(orderId, { attributes: ['id', 'status', 'receiptNumber', 'deliveredAt', 'updatedAt', 'restaurantId'] });
  if (!order) return null;
  if (order.receiptNumber) return order.receiptNumber;
  if (order.status !== 'Delivered') return null;
  const series = seriesOf(order.deliveredAt || order.updatedAt || new Date());
  // Counter row for this series (no-op when it exists; outside the transaction so it never conflicts).
  await sequelize.models.ReceiptCounter.bulkCreate([{ series, lastNumber: 0 }], { ignoreDuplicates: true });
  const snapshot = await issuerSnapshot(order.restaurantId);
  try {
    return await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (t) => {
      await sequelize.query('UPDATE "ReceiptCounters" SET "lastNumber" = "lastNumber" + 1, "updatedAt" = :now WHERE "series" = :series',
        { replacements: { series, now: new Date() }, transaction: t });
      const rows = await sequelize.query('SELECT "lastNumber" FROM "ReceiptCounters" WHERE "series" = :series',
        { replacements: { series }, type: sequelize.QueryTypes.SELECT, transaction: t });
      const n = rows && rows[0] ? Number(rows[0].lastNumber) : 0;
      if (!(n > 0)) throw new Error(`receipt counter ${series} missing`);
      const number = formatNumber(series, n);
      const [updated] = await Order.update(
        { receiptNumber: number, receiptIssuedAt: new Date(), receiptSnapshot: JSON.stringify(snapshot) },
        { where: { id: order.id, receiptNumber: null, status: 'Delivered' }, transaction: t, c8ReceiptAssign: true },
      );
      if (updated !== 1) throw new LostRace(); // someone else issued it first: roll our increment back
      return number;
    });
  } catch (err) {
    if (!(err instanceof LostRace)) throw err;
    const again = await Order.findByPk(order.id, { attributes: ['receiptNumber'] });
    return again ? again.receiptNumber || null : null;
  }
};

/** Who may read an order's receipt: its customer, the order's store, or an admin. */
const canView = (user, order) => {
  if (!user || !order) return false;
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin') return true;
  if (role === 'restaurant') return String(order.restaurantId) === String(user.id);
  if (role === 'rider' || role === 'auto_driver') return false;
  return String(order.userId) === String(user.id);
};

const itemLines = (items) => {
  let list = items;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }
  if (!Array.isArray(list)) return [];
  return list.map((it) => {
    const qty = Math.max(1, Math.floor(Number(it.quantity || it.qty) || 1));
    const unit = money(it.unitPrice !== undefined ? it.unitPrice : (it.priceAtOrder !== undefined ? it.priceAtOrder : it.price));
    const line = it.lineTotal !== undefined && it.lineTotal !== null ? money(it.lineTotal) : money(unit * qty);
    return { name: String(it.name || it.title || 'Item').slice(0, 200), quantity: qty, unitPrice: unit, lineTotal: line, isAddOn: !!it.isAddOn };
  });
};

/** Structured receipt from a stored order (+ its snapshot). Amounts are the stored ones, never recomputed. */
const buildReceipt = (order, { customerName = null } = {}) => {
  const o = order && typeof order.get === 'function' ? order.get({ plain: true }) : (order || {});
  const snap = parseJson(o.receiptSnapshot) || {};
  const pb = parseJson(o.priceBreakdown) || {};
  const has = (k) => pb[k] !== undefined && pb[k] !== null && Number.isFinite(Number(pb[k]));
  const billApproved = (o.isBillApproved === true || o.isBillApproved === 1) && Number(o.billAmount) > 0;
  const itemsSubtotal = billApproved ? money(o.billAmount) : money(has('subtotal') ? pb.subtotal : o.totalPrice);
  const deliveryFee = money(has('deliveryFee') ? pb.deliveryFee : o.deliveryFee);
  const packagingFee = money(has('packagingFee') ? pb.packagingFee : 0);
  const taxesCharged = money(has('taxes') ? pb.taxes : 0);
  let discounts;
  if (Array.isArray(pb.discounts)) {
    discounts = pb.discounts.map((d) => ({ label: String((d && d.label) || 'Discount').slice(0, 120), amount: money(d && d.amount) })).filter((d) => d.amount > 0);
  } else {
    discounts = [
      { label: 'Shared ride discount', amount: money(o.batchDiscount) },
      { label: 'Perk discount', amount: money(o.gateDiscount) },
    ].filter((d) => d.amount > 0);
  }
  const totalDiscount = money(has('totalDiscount') ? pb.totalDiscount : discounts.reduce((s, d) => s + d.amount, 0));
  const total = money(o.finalPrice);
  const adjustment = money(total - (itemsSubtotal + deliveryFee + packagingFee + taxesCharged - totalDiscount));
  const method = o.paymentMethod || null;
  const paid = {
    wallet: method === 'Wallet' ? total : 0,
    cash: method === 'COD' ? total : 0,
    online: method === 'UPI' || method === 'Card' ? total : 0,
  };
  const tax = snap.tax && snap.tax.mode === 'breakdown' && Number(snap.tax.ratePercent) > 0
    ? (() => {
      const r = Number(snap.tax.ratePercent);
      const taxable = money((total * 100) / (100 + r));
      const gst = money(total - taxable);
      const cgst = money(gst / 2);
      return {
        mode: 'breakdown', ratePercent: r, taxableValue: taxable, gstIncluded: gst, cgst, sgst: money(gst - cgst),
        note: `Prices are inclusive of GST. The total includes GST @ ${r}% (CGST ${r / 2}% + SGST ${r / 2}%).`,
      };
    })()
    : { mode: 'inclusive', note: require('./receiptSettings').INCLUSIVE_NOTE };
  const seller = snap.seller || {};
  const { fssaiDisplayText } = require('./storeCompliance');
  return {
    receiptNumber: o.receiptNumber || null,
    issuedAt: o.receiptIssuedAt || null,
    orderId: o.id,
    orderRef: String(o.id || '').slice(-6).toUpperCase(), // the app's order reference (last 6)
    placedAt: o.createdAt || null,
    deliveredAt: o.deliveredAt || null,
    status: o.status,
    fulfilment: o.fulfilment === 'VENDOR' ? 'VENDOR' : 'ZENVY',
    customer: { name: customerName ? String(customerName).trim().split(/\s+/)[0].slice(0, 40) : null },
    seller: {
      name: seller.name || null,
      legalName: seller.legalName || null,
      address: seller.address || null,
      fssaiLicenseNumber: seller.fssaiLicenseNumber || null,
      fssaiText: fssaiDisplayText(seller.fssaiLicenseNumber),
      gstin: seller.gstin || null,
    },
    platform: {
      name: (snap.platform && snap.platform.name) || null,
      operatorName: (snap.platform && snap.platform.operatorName) || null,
      address: (snap.platform && snap.platform.address) || null,
      contactEmail: (snap.platform && snap.platform.contactEmail) || null,
      gstin: (snap.platform && snap.platform.gstin) || null,
    },
    items: itemLines(o.items),
    itemsBasis: billApproved ? 'SHOP_BILL' : 'MENU',
    amounts: {
      itemsSubtotal, packagingFee, deliveryFee, taxesCharged, discounts, totalDiscount,
      ...(Math.abs(adjustment) >= 0.01 ? { adjustment } : {}),
      total,
    },
    payment: {
      method,
      status: o.paymentStatus || null,
      walletUsed: paid.wallet,
      cashCollected: paid.cash,
      ...(paid.online ? { paidOnline: paid.online } : {}),
      collectedBy: method === 'COD' ? (o.fulfilment === 'VENDOR' ? 'store' : 'rider') : null,
    },
    tax,
    footerNote: snap.footerNote || null,
    currency: 'INR',
  };
};

// ─── Signed links ─────────────────────────────────────────────────────────
const linkKey = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not configured');
  return crypto.createHash('sha256').update(`${s}:c8-receipt-link:v1`).digest();
};
const signLink = (orderId, { ttlSec = LINK_TTL_SEC } = {}) => jwt.sign({ oid: String(orderId), p: 'receipt' }, linkKey(), { expiresIn: ttlSec, algorithm: 'HS256' });
/** -> { orderId } | { error: 'expired' | 'invalid' } */
const verifyLink = (token) => {
  try {
    const d = jwt.verify(String(token || ''), linkKey(), { algorithms: ['HS256'] });
    if (!d || d.p !== 'receipt' || typeof d.oid !== 'string') return { error: 'invalid' };
    return { orderId: d.oid };
  } catch (err) {
    return { error: err && err.name === 'TokenExpiredError' ? 'expired' : 'invalid' };
  }
};
const linkFor = (req, orderId) => {
  const token = signLink(orderId);
  const base = require('./publicUrl').apiBase(req);
  return { url: `${base}/receipts/${token}`, expiresAt: new Date(Date.now() + LINK_TTL_SEC * 1000).toISOString() };
};

// ─── HTML ─────────────────────────────────────────────────────────────────
const esc = (v) => String(v === undefined || v === null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const rupees = (n) => `₹${money(n).toFixed(2)}`;
const fmtWhen = (d) => {
  if (!d) return '';
  const t = new Date(new Date(d).getTime() + IST_MS);
  if (!Number.isFinite(t.getTime())) return '';
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hh = t.getUTCHours(); const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${t.getUTCDate()} ${M[t.getUTCMonth()]} ${t.getUTCFullYear()}, ${((hh + 11) % 12) + 1}:${mm} ${hh < 12 ? 'AM' : 'PM'} IST`;
};

const SHELL_CSS = `
  :root { color-scheme: light dark; --bg:#ffffff; --fg:#1a1a1a; --muted:#5b5b5b; --line:#e3e3e3; --accent:#8a6d1f; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f0f10; --fg:#ececec; --muted:#a8a8a8; --line:#2a2a2c; --accent:#d8b65c; } }
  @media print { :root { --bg:#fff; --fg:#000; --muted:#444; --line:#bbb; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  main { max-width: 680px; margin: 0 auto; padding: 20px 16px 40px; overflow-wrap: anywhere; }
  h1 { font-size: 1.35rem; margin: 0 0 2px; }
  h2 { font-size: .95rem; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  p { margin: 3px 0; }
  .muted { color: var(--muted); font-size: .88rem; }
  table { width:100%; border-collapse: collapse; }
  th, td { padding: 6px 4px; border-bottom: 1px solid var(--line); vertical-align: top; text-align: left; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  tr.total td { font-weight: 700; border-top: 2px solid var(--fg); border-bottom: none; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  @media (max-width: 560px) { .grid { grid-template-columns: 1fr; } }
  .box { border:1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
  .note { margin-top: 14px; }
`;

const shell = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<style>${SHELL_CSS}</style>
</head>
<body><main>
${body}
</main></body>
</html>`;

const renderHtml = (rc) => {
  const s = rc.seller;
  const p = rc.platform;
  const a = rc.amounts;
  const rows = rc.items.map((it) => `<tr><td>${esc(it.name)}</td><td class="n">${it.quantity}</td><td class="n">${rupees(it.unitPrice)}</td><td class="n">${rupees(it.lineTotal)}</td></tr>`).join('');
  const amountRows = [
    [rc.itemsBasis === 'SHOP_BILL' ? 'Items (as per shop bill)' : 'Items total', a.itemsSubtotal],
    ...(a.packagingFee ? [['Packaging fee', a.packagingFee]] : []),
    ...(rc.fulfilment === 'VENDOR' && !a.deliveryFee ? [] : [['Delivery fee', a.deliveryFee]]),
    ...(a.taxesCharged ? [['Taxes', a.taxesCharged]] : []),
    ...a.discounts.map((d) => [d.label, -d.amount]),
    ...(a.adjustment ? [['Other adjustment', a.adjustment]] : []),
  ].map(([label, v]) => `<tr><td>${esc(label)}</td><td class="n">${v < 0 ? `− ${rupees(-v)}` : rupees(v)}</td></tr>`).join('');
  const pay = rc.payment;
  const payRows = [
    ...(pay.walletUsed ? [['Paid from ZENV Wallet', pay.walletUsed]] : []),
    ...(pay.cashCollected ? [[`Cash${pay.collectedBy === 'store' ? ' paid to the store' : ' collected on delivery'}`, pay.cashCollected]] : []),
    ...(pay.paidOnline ? [['Paid online', pay.paidOnline]] : []),
  ].map(([label, v]) => `<tr><td>${esc(label)}</td><td class="n">${rupees(v)}</td></tr>`).join('');
  const taxBlock = rc.tax.mode === 'breakdown'
    ? `<p>${esc(rc.tax.note)}</p><table><tr><td>Taxable value</td><td class="n">${rupees(rc.tax.taxableValue)}</td></tr><tr><td>CGST ${esc(rc.tax.ratePercent / 2)}%</td><td class="n">${rupees(rc.tax.cgst)}</td></tr><tr><td>SGST ${esc(rc.tax.ratePercent / 2)}%</td><td class="n">${rupees(rc.tax.sgst)}</td></tr></table>`
    : `<p>${esc(rc.tax.note)}.</p>`;
  const body = `
<h1>Receipt</h1>
<p class="muted">${esc(p.name || 'ZENV')}</p>
<div class="box" style="margin-top:10px">
  <p><strong>Receipt no.</strong> ${esc(rc.receiptNumber)}</p>
  <p><strong>Order</strong> #${esc(rc.orderRef)} · placed ${esc(fmtWhen(rc.placedAt))}</p>
  ${rc.deliveredAt ? `<p><strong>Delivered</strong> ${esc(fmtWhen(rc.deliveredAt))}</p>` : ''}
  ${rc.customer.name ? `<p><strong>Customer</strong> ${esc(rc.customer.name)}</p>` : ''}
</div>
<div class="grid" style="margin-top:12px">
  <div>
    <h2>Sold by</h2>
    <p><strong>${esc(s.name || 'Store')}</strong></p>
    ${s.legalName && s.legalName !== s.name ? `<p>${esc(s.legalName)}</p>` : ''}
    ${s.address ? `<p class="muted">${esc(s.address)}</p>` : ''}
    <p${s.fssaiLicenseNumber ? '' : ' class="muted"'}>${esc(s.fssaiText)}</p>
    ${s.gstin ? `<p>GSTIN ${esc(s.gstin)}</p>` : ''}
  </div>
  <div>
    <h2>Platform</h2>
    <p><strong>${esc(p.name || 'ZENV')}</strong></p>
    ${p.operatorName ? `<p class="muted">Operated by ${esc(p.operatorName)}</p>` : ''}
    ${p.address ? `<p class="muted">${esc(p.address).replace(/\r?\n/g, '<br>')}</p>` : ''}
    ${p.contactEmail ? `<p class="muted">${esc(p.contactEmail)}</p>` : ''}
    ${p.gstin ? `<p>GSTIN ${esc(p.gstin)}</p>` : ''}
  </div>
</div>
<h2>Items</h2>
<table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead><tbody>${rows}</tbody></table>
${rc.itemsBasis === 'SHOP_BILL' ? '<p class="muted">Item prices above are the menu estimates; you were charged the shop bill you approved.</p>' : ''}
<h2>Bill</h2>
<table><tbody>${amountRows}<tr class="total"><td>Total</td><td class="n">${rupees(a.total)}</td></tr></tbody></table>
<h2>Payment</h2>
<table><tbody>${payRows || '<tr><td>Payment</td><td class="n">' + esc(pay.method || '') + '</td></tr>'}</tbody></table>
<div class="note">${taxBlock}</div>
${rc.footerNote ? `<p class="muted note">${esc(rc.footerNote)}</p>` : ''}
<p class="muted note">This is a computer-generated receipt. To save it, use your browser's Print / Save as PDF.</p>`;
  return shell(`Receipt ${rc.receiptNumber || ''}`, body);
};

const renderMessage = (title, message) => shell(title, `<h1>${esc(title)}</h1><p class="note">${esc(message)}</p>`);

/** Startup (additive, idempotent, no data writes): one receipt number per order. Never throws. */
const runReceiptMigrations = async (sequelize) => {
  try {
    if (!sequelize || !sequelize.models.Order) return { ok: false };
    await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS "orders_receipt_number_unique" ON "Orders" ("receiptNumber") WHERE "receiptNumber" IS NOT NULL;');
    return { ok: true };
  } catch (err) {
    console.warn('⚠️ [RECEIPT_MIGRATION_WARN]', err.message);
    return { ok: false, error: err.message };
  }
};

module.exports = {
  runReceiptMigrations,
  PREFIX, LINK_TTL_SEC, RECEIPT_NO_RE, financialYearOf, seriesOf, formatNumber, issuerSnapshot, assignReceiptNumber,
  canView, buildReceipt, signLink, verifyLink, linkFor, renderHtml, renderMessage, sequelizeOf,
};
