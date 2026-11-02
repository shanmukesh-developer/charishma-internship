// Legacy item ids (orderPricing): old app builds send the ids the app used to hardcode ('groc-1', ...). The
// one-time import that created those stores and products from data/catalogue_seed.json was removed on 3 Nov 2026
// with the rest of the mock data (owner: "remove mock data from everywhere in the entire project"); its ledger rows
// stay in the database, so an old id still resolves while its product exists.
let legacyIndex = null; // Map<legacyId, Array<{ targetId, name }>>

// Old app builds send hardcoded ids ('groc-1', 'extra-candles', …). Map them to the imported
// MenuItem ids. The same old id was reused for different products in different screens, so an
// ambiguous id is resolved by the product name the app sends with it, or not at all.
const resolveLegacyItemId = async (legacyId, name) => {
  if (!legacyId || typeof legacyId !== 'string') return null;
  if (!legacyIndex) {
    const { getCatalogueImportLedgerModel } = require('../models/CatalogueImportLedger');
    const Ledger = getCatalogueImportLedgerModel();
    if (!Ledger) return null;
    const rows = await Ledger.findAll({ where: { kind: 'item' }, attributes: ['targetId', 'name', 'legacyIds'] });
    const index = new Map();
    for (const r of rows) {
      for (const lid of r.legacyIds || []) {
        if (!index.has(lid)) index.set(lid, []);
        index.get(lid).push({ targetId: r.targetId, name: r.name });
      }
    }
    legacyIndex = index;
  }
  const candidates = legacyIndex.get(legacyId) || [];
  if (candidates.length === 1) return candidates[0].targetId;
  if (candidates.length > 1 && name) {
    const n = String(name).trim().toLowerCase();
    const match = candidates.filter(c => (c.name || '').trim().toLowerCase() === n);
    if (match.length === 1) return match[0].targetId;
  }
  return null;
};

module.exports = { resolveLegacyItemId };
