const express = require('express');
const { URLSearchParams } = require('url');
const rateLimit = require('express-rate-limit');
const router = express.Router();

router.get('/', (req, res) => res.json({ status: 'ok' }));

// ── Nominatim proxy (customer profile address search) ─────────────────────────
// Nominatim's usage policy is max 1 request/second per app, and abuse gets Render's egress IP
// blocked for every user. So: only known params are forwarded, every client IP is rate limited,
// all calls are spaced >= 1.1 s apart server-wide, and answers are cached for 10 minutes.
// (Still public: the customer app calls it without a token. Add `protect` once it sends one.)
const ALLOWED_PARAMS = ['q', 'lat', 'lon', 'format', 'limit', 'countrycodes', 'addressdetails', 'zoom', 'accept-language'];
const MIN_GAP_MS = 1100;
const MAX_WAIT_MS = 4000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map(); // url -> { at, data }
let nextSlotAt = 0;

const nominatimLimiter = rateLimit({
  windowMs: 60 * 1000,
  // Per IP, and a whole hostel shares one: 30 a minute failed address search for most students during
  // onboarding. Cached answers cost nothing; uncached ones still queue one per second upstream.
  max: Math.max(30, Number(process.env.ADDRESS_LOOKUP_IP_MAX) || 150),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many address lookups. Please wait a moment.' },
  ...require('../utils/sharedRateLimit').expressStore('system.nominatimLimiter'),
});

// Signed-in students only, one lookup in the queue per account at a time (31 Oct 2026): anyone could hold the shared
// one-per-second queue with about one request a second, and every other student then got "busy". The only caller is
// the Profile address field (signed in).
const { protect } = require('../middleware/authMiddleware');
const pendingLookups = new Set();
router.get('/nominatim-proxy', protect, nominatimLimiter, async (req, res) => {
  const query = req.query || {};
  const endpoint = query.type === 'reverse' ? 'reverse' : 'search';
  const params = new URLSearchParams();
  for (const key of ALLOWED_PARAMS) {
    const v = query[key];
    if (typeof v === 'string' && v.length > 0 && v.length <= 200) params.set(key, v);
  }
  if (endpoint === 'search' && !params.get('q')) return res.status(400).json({ error: 'q is required' });
  if (endpoint === 'reverse' && !(params.get('lat') && params.get('lon'))) return res.status(400).json({ error: 'lat and lon are required' });
  if (!params.get('format')) params.set('format', 'json');
  const limit = Math.min(10, Math.max(1, parseInt(params.get('limit'), 10) || 5));
  params.set('limit', String(limit));

  const url = `https://nominatim.openstreetmap.org/${endpoint}?${params.toString()}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return res.json(hit.data);

  const who = String(req.user.id);
  if (pendingLookups.has(who)) return res.status(429).json({ error: 'Please wait for the last address search to finish.' });
  pendingLookups.add(who);
  try {
    // Server-wide spacing: take the next free 1.1 s slot, or give up if the queue is too long.
    const now = Date.now();
    const slot = Math.max(now, nextSlotAt);
    if (slot - now > MAX_WAIT_MS) return res.status(503).json({ error: 'Address search is busy. Please try again.' });
    nextSlotAt = slot + MIN_GAP_MS;
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
    return await lookup(url, res);
  } finally {
    pendingLookups.delete(who);
  }
});

// One upstream request (OpenStreetMap Nominatim asks for an app name and a real contact in the User-Agent).
const lookup = async (url, res) => {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ZCS-campus-app/1.0 (projectshanmukh@gmail.com)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return res.status(response.status === 429 ? 503 : 502).json({ error: 'Address search is unavailable right now.' });
    }
    const data = await response.json();
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(url, { at: Date.now(), data });
    res.json(data);
  } catch (error) {
    console.error('[NOMINATIM_PROXY_ERR]', error.message);
    res.status(502).json({ error: 'Address search is unavailable right now.' });
  }
};

module.exports = router;
