// Customer polish (22 Oct): favourite stores and saved delivery addresses, kept on the account so they
// survive a reinstall or a new phone. The app keeps a local copy and merges it in on first sync.
//   GET /api/users/favorites   -> { storeIds: [uuid] }
//   PUT /api/users/favorites   { storeIds: [uuid] } -> { storeIds }   (replaces the list, max 200)
//   GET /api/users/addresses   -> { addresses: [{ id, label, block, room, landmark }] }
//   PUT /api/users/addresses   { addresses: [...] } -> { addresses }   (replaces the list, max 10)
const crypto = require('crypto');
const { getUserModel } = require('../models/User');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FAVORITES = 200;
const MAX_ADDRESSES = 10;

const cleanText = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const cleanFavorites = (raw) => {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const id of raw) {
    const s = String(id || '').trim();
    if (UUID_RE.test(s) && !out.includes(s.toLowerCase())) out.push(s.toLowerCase());
    if (out.length >= MAX_FAVORITES) break;
  }
  return out;
};

const cleanAddresses = (raw) => {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    const label = cleanText(a.label, 24);
    const block = cleanText(a.block, 60);
    const room = cleanText(a.room, 30);
    const landmark = cleanText(a.landmark, 120);
    if (!block && !room && !landmark) continue; // an address needs somewhere to go
    const id = /^[a-z0-9-]{6,40}$/i.test(String(a.id || '')) ? String(a.id) : crypto.randomBytes(6).toString('hex');
    out.push({ id, label: label || 'Saved place', block, room, landmark });
    if (out.length >= MAX_ADDRESSES) break;
  }
  return out;
};

const loadUser = (id) => getUserModel().findByPk(id, { attributes: ['id', 'favoriteStores', 'savedAddresses'] });

const getFavorites = async (req, res) => {
  try {
    const u = await loadUser(req.user.id);
    if (!u) return res.status(404).json({ message: 'Account not found' });
    res.json({ storeIds: u.favoriteStores || [] });
  } catch (e) {
    console.error('[FAVORITES_GET_ERROR]', e.message);
    res.status(500).json({ message: 'Could not load your favourites right now.' });
  }
};

const putFavorites = async (req, res) => {
  const ids = cleanFavorites(req.body && req.body.storeIds);
  if (!ids) return res.status(400).json({ message: 'storeIds must be a list of store ids.' });
  try {
    const u = await loadUser(req.user.id);
    if (!u) return res.status(404).json({ message: 'Account not found' });
    u.favoriteStores = ids;
    await u.save({ fields: ['favoriteStores'] });
    res.json({ storeIds: ids });
  } catch (e) {
    console.error('[FAVORITES_PUT_ERROR]', e.message);
    res.status(500).json({ message: 'Could not save your favourites right now.' });
  }
};

const getAddresses = async (req, res) => {
  try {
    const u = await loadUser(req.user.id);
    if (!u) return res.status(404).json({ message: 'Account not found' });
    res.json({ addresses: u.savedAddresses || [] });
  } catch (e) {
    console.error('[ADDRESSES_GET_ERROR]', e.message);
    res.status(500).json({ message: 'Could not load your saved addresses right now.' });
  }
};

const putAddresses = async (req, res) => {
  const list = cleanAddresses(req.body && req.body.addresses);
  if (!list) return res.status(400).json({ message: 'addresses must be a list.' });
  try {
    const u = await loadUser(req.user.id);
    if (!u) return res.status(404).json({ message: 'Account not found' });
    u.savedAddresses = list;
    await u.save({ fields: ['savedAddresses'] });
    res.json({ addresses: list });
  } catch (e) {
    console.error('[ADDRESSES_PUT_ERROR]', e.message);
    res.status(500).json({ message: 'Could not save your addresses right now.' });
  }
};

module.exports = { getFavorites, putFavorites, getAddresses, putAddresses, cleanFavorites, cleanAddresses, MAX_FAVORITES, MAX_ADDRESSES };
