// Zenvy PG (paying-guest) listing content: photo gallery, YouTube room videos, weekly mess timetable,
// house timings, room types and the public read shapes.
//
// Every writer validates through here (routes/pgRoutes.js). Readers (the app, the admin dashboard) get
// shapes built by publicPg / publicPgListItem: no owner account id, no internal columns.
//
// Stored on PGHostel (TEXT JSON columns, added additively at startup by config/db.js addMissingColumns):
//   photos        [{ id, url, category, caption, order, roomType, isCover }]   max 20, exactly one cover
//   videos        [{ id, youtubeId, title, roomType, order }]                   max 15, admin only
//   messTimetable { meals: [{ key, label, start, end }], days: { mon: { <mealKey>: { menu, tag, start?, end? } } }, notes }
//   timings       { gateOpen, gateClose, visitorFrom, visitorTo, checkIn, checkOut, quietFrom, quietTo, curfewNote }
//   v2 sections (SECTION_WRITERS, one PUT each): highlights, houseRules, policies, safety, moveIn,
//   locationGuide, faq. Public reads add `sections` (the keys the app shows, hidden when empty) and
//   `reviewSummary`; phone numbers and emails from contactInfo are never public.
// Also here: stay reviews (validateReview / publicReview) and list-page promotions (validatePromotion).
// Legacy columns stay readable: `images` (kept in step with photos for older app builds), `messMenu`,
// `foodTimetable` (shown through messTimetable when no structured timetable was saved yet).
const crypto = require('crypto');

const PHOTO_CATEGORIES = ['ROOM', 'BATHROOM', 'MESS', 'BUILDING', 'COMMON_AREA', 'OTHER'];
const MAX_PHOTOS = 20;
const MAX_VIDEOS = 15;
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const FOOD_TAGS = ['veg', 'nonveg', 'egg'];
const TIMING_TIME_FIELDS = ['gateOpen', 'gateClose', 'visitorFrom', 'visitorTo', 'checkIn', 'checkOut', 'quietFrom', 'quietTo'];
const MAX_MEALS = 6;

class PgInputError extends Error {
  constructor(message, field) {
    super(message);
    this.code = 'INVALID_PG_CONTENT';
    this.field = field || null;
    this.status = 400;
  }
}
const fail = (message, field) => { throw new PgInputError(message, field); };

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// Plain one-line text: control characters removed, whitespace collapsed, length capped.
const cleanText = (v, max, field, { multiline = false } = {}) => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' && typeof v !== 'number') fail(`${field} must be text.`, field);
  let s = String(v);
  // eslint-disable-next-line no-control-regex
  s = multiline ? s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '') : s.replace(/[\u0000-\u001F\u007F]/g, ' ');
  s = multiline ? s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : s.replace(/\s+/g, ' ').trim();
  if (s.length > max) fail(`${field} must be at most ${max} characters.`, field);
  return s;
};

const newId = () => crypto.randomBytes(6).toString('hex');
const ID_RE = /^[a-z0-9]{6,24}$/;
const keepId = (v) => (typeof v === 'string' && ID_RE.test(v) ? v : newId());

// Room type keys link photos / videos to a kind of room. Rooms with a label ("Deluxe twin") use its slug;
// unlabelled rooms group by sharing + AC + bathroom, e.g. "2-sharing-ac-attached".
const ROOM_TYPE_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
const roomTypeKey = (room) => {
  const label = room && typeof room.roomType === 'string' ? room.roomType.trim() : '';
  if (label) return slug(label) || 'room';
  const n = Number(room && room.sharingType);
  return `${Number.isFinite(n) && n > 0 ? n : 1}-sharing-${room && room.hasAC ? 'ac' : 'non-ac'}-${room && room.hasAttachedBathroom === false ? 'shared' : 'attached'}`;
};
const cleanRoomTypeRef = (v, field) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') fail(`${field} must be a room type.`, field);
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (!ROOM_TYPE_RE.test(s)) fail(`${field} is not a valid room type.`, field);
  return s;
};

// ── Times ──────────────────────────────────────────────────────────────────────────────────────
// 24-hour "HH:MM". Accepts "7:30", "07:30", "7:30 AM", "7.30pm"; returns "07:30" or null for empty.
const parseTime = (v, field) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') fail(`${field} must be a time like 07:30.`, field);
  const s = v.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/.exec(s);
  if (!m) fail(`${field} must be a time like 07:30.`, field);
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (m[3]) {
    if (h < 1 || h > 12) fail(`${field} must be a time like 07:30.`, field);
    if (m[3] === 'am') h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (m[2] === undefined) {
    fail(`${field} must be a time like 07:30.`, field);
  }
  if (h > 23 || min > 59) fail(`${field} must be a real time (00:00 to 23:59).`, field);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};
const minutes = (hhmm) => (hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : null);
// A meal window must end after it starts (same day). Both or neither.
const timeRange = (start, end, field) => {
  const s = parseTime(start, `${field} start`);
  const e = parseTime(end, `${field} end`);
  if ((s === null) !== (e === null)) fail(`${field}: enter both a start and an end time, or neither.`, field);
  if (s !== null && minutes(e) <= minutes(s)) fail(`${field}: the end time must be after the start time.`, field);
  return { start: s, end: e };
};

// ── YouTube ────────────────────────────────────────────────────────────────────────────────────
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
/**
 * Video id from a YouTube link, or null. Accepted:
 *   https://www.youtube.com/watch?v=<id>   (also youtube.com / m.youtube.com, extra params ignored)
 *   https://youtu.be/<id>
 *   https://www.youtube.com/shorts/<id>
 * Anything else (other hosts, playlists, channels, embed links, look-alike domains) is null.
 */
const parseYouTubeId = (input) => {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.length > 500) return null;
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password || (u.port && u.port !== '443' && u.port !== '80')) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  let id = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    if (parts.length === 1) id = parts[0];
  } else if (YT_HOSTS.has(host)) {
    if (parts.length === 1 && parts[0] === 'watch') id = u.searchParams.get('v');
    else if (parts.length === 2 && parts[0] === 'shorts') id = parts[1];
  }
  return id && YT_ID_RE.test(id) ? id : null;
};
const youtubeThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const youtubeEmbed = (id) => `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0&modestbranding=1`;
const youtubeWatch = (id) => `https://www.youtube.com/watch?v=${id}`;

// ── Photos ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Validates a gallery. `storeUrl(url)` stores / normalises one image reference and resolves to
 * { ok, value, status, message } (utils/imageStore.storeImageRef) - injected so unit tests need no DB.
 * `isPrivateMedia(url)` resolves true when the url is a PRIVATE media row (never allowed on a listing).
 */
const validatePhotos = async (list, { storeUrl, isPrivateMedia } = {}) => {
  if (list === null || list === undefined) return [];
  if (!Array.isArray(list)) fail('photos must be a list.', 'photos');
  if (list.length > MAX_PHOTOS) fail(`A PG can have at most ${MAX_PHOTOS} photos.`, 'photos');
  const out = [];
  const seen = new Set();
  let covers = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const f = `photos[${i}]`;
    if (!isObj(p)) fail(`${f} must be a photo.`, f);
    const category = String(p.category || '').trim().toUpperCase();
    if (!PHOTO_CATEGORIES.includes(category)) fail(`${f}: category must be one of ${PHOTO_CATEGORIES.join(', ')}.`, `${f}.category`);
    const caption = cleanText(p.caption, 120, `${f} caption`);
    const roomType = cleanRoomTypeRef(p.roomType, `${f} room type`);
    let order = i;
    if (p.order !== undefined && p.order !== null && p.order !== '') {
      const n = Number(p.order);
      if (!Number.isInteger(n) || n < 0 || n > 999) fail(`${f}: order must be a whole number from 0 to 999.`, `${f}.order`);
      order = n;
    }
    if (typeof p.url !== 'string' || !p.url.trim()) fail(`${f}: upload the photo first.`, `${f}.url`);
    if (isPrivateMedia && (await isPrivateMedia(p.url))) fail(`${f}: that image is private and cannot be shown on a listing.`, `${f}.url`);
    const stored = storeUrl ? await storeUrl(p.url) : { ok: true, value: p.url.trim() };
    if (!stored || !stored.ok) {
      const e = new PgInputError(`${f}: ${(stored && stored.message) || 'that photo could not be used.'}`, `${f}.url`);
      if (stored && stored.status) e.status = stored.status;
      throw e;
    }
    if (!stored.value) fail(`${f}: upload the photo first.`, `${f}.url`);
    if (seen.has(stored.value)) fail(`${f}: that photo is already in the gallery.`, `${f}.url`);
    seen.add(stored.value);
    const isCover = p.isCover === true;
    if (isCover) covers++;
    out.push({ id: keepId(p.id), url: stored.value, category, caption, order, roomType, isCover, _i: i });
  }
  if (covers > 1) fail('Choose only one cover photo.', 'photos');
  out.sort((a, b) => a.order - b.order || a._i - b._i);
  out.forEach((p, i) => { p.order = i; delete p._i; });
  if (out.length && !covers) out[0].isCover = true;
  return out;
};
const normalisePhotosForRead = (photos) => {
  const list = (Array.isArray(photos) ? photos : [])
    .filter((p) => isObj(p) && typeof p.url === 'string' && p.url && !/^\s*data:/i.test(p.url))
    .map((p, i) => ({
      id: typeof p.id === 'string' ? p.id : `p${i}`,
      url: p.url,
      category: PHOTO_CATEGORIES.includes(p.category) ? p.category : 'OTHER',
      caption: typeof p.caption === 'string' ? p.caption : '',
      order: Number.isInteger(p.order) ? p.order : i,
      roomType: typeof p.roomType === 'string' && p.roomType ? p.roomType : null,
      isCover: p.isCover === true,
    }))
    .sort((a, b) => a.order - b.order);
  if (list.length && !list.some((p) => p.isCover)) list[0].isCover = true;
  return list;
};
/** Structured photos, or the legacy `images` list shown as OTHER photos (first = cover). */
const photosOf = (pg) => {
  const structured = normalisePhotosForRead(pg.photos);
  if (structured.length) return structured;
  const imgs = (Array.isArray(pg.images) ? pg.images : []).filter((u) => typeof u === 'string' && u.trim() && !/^\s*data:/i.test(u));
  return imgs.map((url, i) => ({ id: `legacy${i}`, url, category: 'OTHER', caption: '', order: i, roomType: null, isCover: i === 0 }));
};
/** Legacy `images` column value for a gallery: cover first, then gallery order. */
const imagesFromPhotos = (photos) => {
  const cover = photos.find((p) => p.isCover);
  return [...(cover ? [cover] : []), ...photos.filter((p) => p !== cover)].map((p) => p.url);
};

// ── Videos ─────────────────────────────────────────────────────────────────────────────────────
const validateVideos = (list) => {
  if (list === null || list === undefined) return [];
  if (!Array.isArray(list)) fail('videos must be a list.', 'videos');
  if (list.length > MAX_VIDEOS) fail(`A PG can have at most ${MAX_VIDEOS} videos.`, 'videos');
  const out = [];
  const seen = new Set();
  list.forEach((v, i) => {
    const f = `videos[${i}]`;
    if (!isObj(v)) fail(`${f} must be a video.`, f);
    const link = v.youtubeUrl !== undefined ? v.youtubeUrl : v.url;
    let youtubeId = parseYouTubeId(link);
    // Re-saving an existing row may send just the stored id.
    if (!youtubeId && (link === undefined || link === null || link === '') && typeof v.youtubeId === 'string' && YT_ID_RE.test(v.youtubeId)) youtubeId = v.youtubeId;
    if (!youtubeId) fail(`${f}: paste a YouTube link (youtube.com/watch?v=…, youtu.be/… or youtube.com/shorts/…).`, `${f}.youtubeUrl`);
    if (seen.has(youtubeId)) fail(`${f}: that video is already listed.`, `${f}.youtubeUrl`);
    seen.add(youtubeId);
    const title = cleanText(v.title, 100, `${f} title`);
    const roomType = cleanRoomTypeRef(v.roomType, `${f} room type`);
    let order = i;
    if (v.order !== undefined && v.order !== null && v.order !== '') {
      const n = Number(v.order);
      if (!Number.isInteger(n) || n < 0 || n > 999) fail(`${f}: order must be a whole number from 0 to 999.`, `${f}.order`);
      order = n;
    }
    out.push({ id: keepId(v.id), youtubeId, title, roomType, order, _i: i });
  });
  out.sort((a, b) => a.order - b.order || a._i - b._i);
  out.forEach((v, i) => { v.order = i; delete v._i; });
  return out;
};
const videosForRead = (videos) => (Array.isArray(videos) ? videos : [])
  .filter((v) => isObj(v) && typeof v.youtubeId === 'string' && YT_ID_RE.test(v.youtubeId))
  .sort((a, b) => (a.order || 0) - (b.order || 0))
  .map((v, i) => ({
    id: typeof v.id === 'string' ? v.id : `v${i}`,
    youtubeId: v.youtubeId,
    title: typeof v.title === 'string' ? v.title : '',
    roomType: typeof v.roomType === 'string' && v.roomType ? v.roomType : null,
    order: i,
    thumbnailUrl: youtubeThumb(v.youtubeId),
    embedUrl: youtubeEmbed(v.youtubeId),
    watchUrl: youtubeWatch(v.youtubeId),
  }));

// ── Mess timetable ─────────────────────────────────────────────────────────────────────────────
const MEAL_KEY_RE = /^[a-z][a-z0-9_]{1,19}$/;
const validateMessTimetable = (input) => {
  if (input === null || input === undefined) return null;
  if (!isObj(input)) fail('messTimetable must be an object.', 'messTimetable');
  const rawMeals = input.meals;
  if (!Array.isArray(rawMeals)) fail('messTimetable.meals must be a list of meals.', 'meals');
  if (rawMeals.length > MAX_MEALS) fail(`At most ${MAX_MEALS} meals a day.`, 'meals');
  const meals = [];
  const keys = new Set();
  rawMeals.forEach((m, i) => {
    const f = `meals[${i}]`;
    if (!isObj(m)) fail(`${f} must be a meal.`, f);
    const label = cleanText(m.label, 30, `${f} name`);
    if (!label) fail(`${f}: give the meal a name.`, `${f}.label`);
    const key = typeof m.key === 'string' && m.key.trim() ? m.key.trim().toLowerCase() : slug(label).replace(/-/g, '_');
    if (!MEAL_KEY_RE.test(key)) fail(`${f}: meal key must be 2-20 letters, digits or _.`, `${f}.key`);
    if (keys.has(key)) fail(`${f}: "${label}" is listed twice.`, `${f}.key`);
    keys.add(key);
    const { start, end } = timeRange(m.start, m.end, label);
    meals.push({ key, label, start, end });
  });
  // Meals in time order (meals without a time keep their place at the end).
  meals.sort((a, b) => (a.start === null) - (b.start === null) || (minutes(a.start) || 0) - (minutes(b.start) || 0));
  const rawDays = input.days === undefined || input.days === null ? {} : input.days;
  if (!isObj(rawDays)) fail('messTimetable.days must be an object keyed by day.', 'days');
  const days = {};
  for (const [dk, row] of Object.entries(rawDays)) {
    if (!DAY_KEYS.includes(dk)) fail(`Unknown day "${String(dk).slice(0, 12)}" (use mon … sun).`, 'days');
    if (row === null || row === undefined) continue;
    if (!isObj(row)) fail(`${DAY_NAMES[dk]} must map meals to menus.`, `days.${dk}`);
    const outRow = {};
    for (const [mk, cell] of Object.entries(row)) {
      if (!keys.has(mk)) fail(`${DAY_NAMES[dk]}: "${String(mk).slice(0, 20)}" is not one of the meals.`, `days.${dk}`);
      if (cell === null || cell === undefined) continue;
      const c = typeof cell === 'string' ? { menu: cell } : cell;
      if (!isObj(c)) fail(`${DAY_NAMES[dk]} ${mk} must be a menu.`, `days.${dk}.${mk}`);
      const menu = cleanText(c.menu, 300, `${DAY_NAMES[dk]} ${mk} menu`);
      let tag = c.tag === undefined || c.tag === null || c.tag === '' ? null : String(c.tag).toLowerCase().replace(/[^a-z]/g, '');
      if (tag === 'nonveg' || tag === 'veg' || tag === 'egg') { /* ok */ } else if (tag !== null) fail(`${DAY_NAMES[dk]} ${mk}: tag must be veg, nonveg or egg.`, `days.${dk}.${mk}.tag`);
      const range = timeRange(c.start, c.end, `${DAY_NAMES[dk]} ${mk}`);
      if (!menu && !tag && range.start === null) continue;
      outRow[mk] = { menu, tag, ...(range.start ? { start: range.start, end: range.end } : {}) };
    }
    if (Object.keys(outRow).length) days[dk] = outRow;
  }
  const notes = cleanText(input.notes, 1000, 'Mess notes', { multiline: true });
  if (!meals.length && (Object.keys(days).length || notes)) fail('Add at least one meal before writing menus.', 'meals');
  if (!meals.length) return null; // cleared
  return { meals, days, notes };
};

// Legacy columns -> timetable shape (real data only; nothing is invented).
const LEGACY_DAY = { monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu', friday: 'fri', saturday: 'sat', sunday: 'sun' };
const legacySlot = (slot) => {
  try {
    if (isObj(slot)) return timeRange(slot.start, slot.end, 'x');
    if (typeof slot === 'string' && slot.trim()) {
      const [a, b] = slot.split(/\s*(?:-|–|to)\s*/i);
      if (a && b) return timeRange(a, b, 'x');
    }
  } catch { /* unparseable legacy text: no time shown */ }
  return { start: null, end: null };
};
const legacyTimetable = (messMenu, foodTimetable) => {
  const menu = isObj(messMenu) ? messMenu : {};
  const tt = isObj(foodTimetable) ? foodTimetable : {};
  const base = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner']];
  const days = {};
  for (const [name, row] of Object.entries(menu)) {
    const dk = LEGACY_DAY[String(name).toLowerCase()];
    if (!dk || !isObj(row)) continue;
    const outRow = {};
    for (const [k] of base) {
      const text = typeof row[k] === 'string' ? row[k].trim().slice(0, 300) : '';
      if (text) outRow[k] = { menu: text, tag: null };
    }
    if (Object.keys(outRow).length) days[dk] = outRow;
  }
  const meals = base.map(([key, label]) => ({ key, label, ...legacySlot(tt[key]) }));
  const anyTime = meals.some((m) => m.start);
  if (!Object.keys(days).length && !anyTime) return null;
  return { meals: meals.filter((m) => m.start || Object.values(days).some((r) => r[m.key])), days, notes: '', legacy: true };
};
const messForRead = (pg) => {
  const t = pg.messTimetable;
  if (isObj(t) && Array.isArray(t.meals) && t.meals.length) {
    return { meals: t.meals, days: isObj(t.days) ? t.days : {}, notes: typeof t.notes === 'string' ? t.notes : '' };
  }
  return legacyTimetable(pg.messMenu, pg.foodTimetable);
};

// ── Timings ────────────────────────────────────────────────────────────────────────────────────
const validateTimings = (input) => {
  if (input === null || input === undefined) return null;
  if (!isObj(input)) fail('timings must be an object.', 'timings');
  const out = {};
  for (const f of TIMING_TIME_FIELDS) {
    const t = parseTime(input[f], f);
    if (t) out[f] = t;
  }
  for (const [a, b, label] of [['gateOpen', 'gateClose', 'Gate'], ['visitorFrom', 'visitorTo', 'Visitor hours']]) {
    if ((out[a] === undefined) !== (out[b] === undefined)) fail(`${label}: enter both times, or neither.`, a);
  }
  if (out.visitorFrom && minutes(out.visitorTo) <= minutes(out.visitorFrom)) fail('Visitor hours must end after they start.', 'visitorTo');
  if ((out.quietFrom === undefined) !== (out.quietTo === undefined)) fail('Quiet hours: enter both times, or neither.', 'quietFrom');
  const curfewNote = cleanText(input.curfewNote, 300, 'Curfew note', { multiline: true });
  if (curfewNote) out.curfewNote = curfewNote;
  return Object.keys(out).length ? out : null;
};
const timingsForRead = (pg) => (isObj(pg.timings) && Object.keys(pg.timings).length ? pg.timings : null);

// ── Rooms / room types ─────────────────────────────────────────────────────────────────────────
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const publicRoom = (r) => ({
  id: r.id,
  roomNumber: r.roomNumber,
  roomType: r.roomType || null,
  roomTypeKey: roomTypeKey(r),
  sharingType: r.sharingType,
  pricePerBed: r.pricePerBed,
  securityDeposit: num(r.securityDeposit),
  totalBeds: r.totalBeds,
  availableBeds: r.availableBeds,
  floorNumber: r.floorNumber,
  hasAttachedBathroom: r.hasAttachedBathroom,
  hasAC: r.hasAC,
  hasBalcony: r.hasBalcony,
  furnishing: r.furnishing,
});
/** Active rooms grouped into the cards the app shows (cheapest room with a free bed is the one booked). */
const buildRoomTypes = (rooms, pgDeposit) => {
  const groups = new Map();
  for (const r of rooms) {
    const key = roomTypeKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const out = [];
  for (const [key, list] of groups) {
    const first = list[0];
    const prices = list.map((r) => num(r.pricePerBed)).filter((n) => n !== null);
    const deposits = list.map((r) => num(r.securityDeposit)).filter((n) => n !== null);
    const free = list.filter((r) => Number(r.availableBeds) > 0)
      .sort((a, b) => (num(a.pricePerBed) || 0) - (num(b.pricePerBed) || 0) || Number(b.availableBeds) - Number(a.availableBeds));
    const sharing = Number(first.sharingType);
    out.push({
      key,
      label: (first.roomType && String(first.roomType).trim()) || `${Number.isFinite(sharing) && sharing > 0 ? sharing : 1}-sharing${first.hasAC ? ' AC' : ''}`,
      sharingType: first.sharingType,
      hasAC: list.every((r) => !!r.hasAC),
      hasAttachedBathroom: list.every((r) => r.hasAttachedBathroom !== false),
      hasBalcony: list.some((r) => !!r.hasBalcony),
      furnishing: first.furnishing || null,
      rentFrom: prices.length ? Math.min(...prices) : null,
      rentTo: prices.length ? Math.max(...prices) : null,
      deposit: deposits.length ? Math.min(...deposits) : num(pgDeposit),
      availableBeds: list.reduce((a, r) => a + (Number(r.availableBeds) || 0), 0),
      totalBeds: list.reduce((a, r) => a + (Number(r.totalBeds) || 0), 0),
      roomCount: list.length,
      bookRoomId: free.length ? free[0].id : null,
      roomIds: list.map((r) => r.id),
    });
  }
  return out.sort((a, b) => (a.rentFrom ?? Infinity) - (b.rentFrom ?? Infinity));
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// v2 listing sections. Each validator returns the cleaned value, or null / [] when the section is empty
// (the route then stores null and the app hides the section). Every free-text field refuses phone
// numbers: students reach staff through the Zenvy housing desk, never a personal number on a listing.
//
// Errors carry `field` as the path in the request body, always the same style:
//   highlights[1]   houseRules[0].rules[2]   policies.rent.lateFee   policies.extraCharges[0].unit
//   safety.cctv     moveIn.documents[3]      locationGuide.nearby[0].distanceM   faq[2].q
// The message names the field in words ("Late fee must be ...").
// ════════════════════════════════════════════════════════════════════════════════════════════════
const PHONE_RE = /(?:\+?\d[\s().-]{0,2}){8,}/;
// Decorative emoji / pictographs are dropped from listing text (plain, professional copy).
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2B00}-\u{2BFF}]/gu;
/** Text field: `label` names it in messages, `path` is the error field. */
const txt = (v, max, label, path, opts = {}) => {
  const raw = v === undefined || v === null ? '' : (typeof v === 'string' ? v.replace(EMOJI_RE, '') : v);
  let s;
  try { s = cleanText(raw, max, label, opts); } catch (e) { e.field = path; throw e; }
  if (s && PHONE_RE.test(s)) fail(`${label}: phone numbers are not shown on listings. Students contact staff through the Zenvy housing desk.`, path);
  return s;
};
const intIn = (v, min, max, label, path) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(`${label} must be a whole number from ${min} to ${max}.`, path);
  return n;
};
const amountIn = (v, max, label, path) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) fail(`${label} must be an amount from ₹0 to ₹${max.toLocaleString('en-IN')}.`, path);
  return Math.round(n);
};
const boolOrNull = (v, label, path) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'boolean') fail(`${label} must be yes or no.`, path);
  return v;
};
const listOf = (v, label, path, max) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail(`${label} must be a list.`, path);
  if (v.length > max) fail(`${label}: at most ${max} items.`, path);
  return v;
};
/** List of short unique lines (blank lines dropped). */
const lines = (v, label, path, { max, len }) => {
  const out = [];
  const seen = new Set();
  listOf(v, label, path, max).forEach((x, i) => {
    const s = txt(x, len, `${label} (line ${i + 1})`, `${path}[${i}]`);
    if (!s) return;
    const k = s.toLowerCase();
    if (seen.has(k)) fail(`${label}: "${s.slice(0, 40)}" is listed twice.`, `${path}[${i}]`);
    seen.add(k);
    out.push(s);
  });
  return out;
};
const oneOf = (v, allowed, label, path) => {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim().toLowerCase();
  if (!allowed.includes(s)) fail(`${label} must be one of ${allowed.join(', ')}.`, path);
  return s;
};
const compact = (o) => {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length)) continue;
    out[k] = v;
  }
  return out;
};
const objOrNull = (v, label, path) => {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) fail(`${label} must be an object.`, path);
  return v;
};
const timeAt = (v, label, path) => {
  try { return parseTime(v, label); } catch (e) { e.field = path; throw e; }
};

// ── Highlights (overview) ──────────────────────────────────────────────────────────────────────
const MAX_HIGHLIGHTS = 6;
const validateHighlights = (v) => {
  const out = lines(v, 'Highlights', 'highlights', { max: MAX_HIGHLIGHTS, len: 40 });
  out.forEach((s, i) => { if (s.length < 3) fail(`Highlight "${s}" is too short.`, `highlights[${i}]`); });
  return out;
};

// ── House rules by category ────────────────────────────────────────────────────────────────────
const RULE_CATEGORIES = ['visitors', 'overnight', 'gate', 'smoking', 'noise', 'cooking', 'pets', 'cleanliness', 'laundry', 'electricity', 'other'];
const RULE_CATEGORY_LABEL = {
  visitors: 'Visitors & guests', overnight: 'Overnight stays', gate: 'Gate & curfew', smoking: 'Smoking & alcohol',
  noise: 'Noise & quiet hours', cooking: 'Cooking & food', pets: 'Pets', cleanliness: 'Cleanliness', laundry: 'Laundry',
  electricity: 'Electricity & appliances', other: 'Other',
};
const MAX_RULES_PER_GROUP = 10;
const validateHouseRules = (v) => {
  const groups = listOf(v, 'House rules', 'houseRules', RULE_CATEGORIES.length);
  const out = [];
  const seen = new Set();
  groups.forEach((g, i) => {
    const f = `houseRules[${i}]`;
    if (!isObj(g)) fail('Each house rule group needs a category and rules.', f);
    const category = oneOf(g.category, RULE_CATEGORIES, 'Rule category', `${f}.category`);
    if (!category) fail('Choose a category for each group of rules.', `${f}.category`);
    if (seen.has(category)) fail(`${RULE_CATEGORY_LABEL[category]} is listed twice.`, `${f}.category`);
    seen.add(category);
    const rules = lines(g.rules, `${RULE_CATEGORY_LABEL[category]} rules`, `${f}.rules`, { max: MAX_RULES_PER_GROUP, len: 160 });
    if (rules.length) out.push({ category, rules });
  });
  return out.sort((a, b) => RULE_CATEGORIES.indexOf(a.category) - RULE_CATEGORIES.indexOf(b.category));
};
/** Public read: structured groups, else the legacy flat `rules` list as one group. */
const houseRulesForRead = (pg) => {
  const g = (Array.isArray(pg.houseRules) ? pg.houseRules : [])
    .filter((x) => isObj(x) && RULE_CATEGORIES.includes(x.category) && Array.isArray(x.rules))
    .map((x) => ({ category: x.category, label: RULE_CATEGORY_LABEL[x.category], rules: x.rules.filter((r) => typeof r === 'string' && r.trim()) }))
    .filter((x) => x.rules.length);
  if (g.length) return g;
  const legacy = (Array.isArray(pg.rules) ? pg.rules : []).filter((r) => typeof r === 'string' && r.trim()).map((r) => r.replace(EMOJI_RE, '').trim()).filter(Boolean);
  return legacy.length ? [{ category: 'other', label: 'General', rules: legacy }] : [];
};

// ── Policies ───────────────────────────────────────────────────────────────────────────────────
const PAYMENT_METHODS = ['cash', 'upi', 'bank'];
const INCLUDED_KEYS = ['food', 'wifi', 'electricity', 'water', 'housekeeping', 'laundry', 'maintenance'];
const CHARGE_UNITS = ['month', 'unit', 'use', 'day', 'kg', 'once'];
const LATE_FEE_UNITS = ['once', 'day'];
const MAX_EXTRA_CHARGES = 12;
const subset = (v, allowed, label, path) => {
  const out = [];
  listOf(v, label, path, allowed.length).forEach((x, i) => {
    const s = oneOf(x, allowed, label, `${path}[${i}]`);
    if (s && !out.includes(s)) out.push(s);
  });
  return allowed.filter((k) => out.includes(k));
};
const validatePolicies = (input) => {
  const P = 'policies';
  const v = objOrNull(input, 'Policies', P);
  if (!v) return null;
  const b = objOrNull(v.booking, 'Booking', `${P}.booking`) || {};
  const r = objOrNull(v.rent, 'Rent payment', `${P}.rent`) || {};
  const d = objOrNull(v.deposit, 'Security deposit', `${P}.deposit`) || {};
  const s = objOrNull(v.stay, 'Notice period and lock-in', `${P}.stay`) || {};
  const c = objOrNull(v.cancellation, 'Cancellation', `${P}.cancellation`) || {};
  const m = objOrNull(v.maintenance, 'Maintenance', `${P}.maintenance`) || {};
  const extraCharges = listOf(v.extraCharges, 'Extra charges', `${P}.extraCharges`, MAX_EXTRA_CHARGES).map((x, i) => {
    const f = `${P}.extraCharges[${i}]`;
    if (!isObj(x)) fail('Each extra charge needs an item, amount and unit.', f);
    const item = txt(x.item, 40, 'Charge name', `${f}.item`);
    const amount = amountIn(x.amount, 100000, `${item || 'Charge'} amount`, `${f}.amount`);
    const unit = oneOf(x.unit, CHARGE_UNITS, `${item || 'Charge'} unit`, `${f}.unit`);
    if (!item && amount === null) return null;
    if (!item) fail('Name the charge (e.g. Electricity).', `${f}.item`);
    if (amount === null) fail(`${item}: enter the amount.`, `${f}.amount`);
    if (!unit) fail(`${item}: choose what the amount is per.`, `${f}.unit`);
    return { item, amount, unit };
  }).filter(Boolean);
  const lateFee = amountIn(r.lateFee, 10000, 'Late fee', `${P}.rent.lateFee`);
  const lateFeeUnit = oneOf(r.lateFeeUnit, LATE_FEE_UNITS, 'Late fee unit', `${P}.rent.lateFeeUnit`);
  if (lateFee && !lateFeeUnit) fail('Late fee: choose once or per day.', `${P}.rent.lateFeeUnit`);
  const out = compact({
    booking: compact({
      steps: txt(b.steps, 600, 'How to book', `${P}.booking.steps`, { multiline: true }),
      tokenAmount: amountIn(b.tokenAmount, 100000, 'Token amount', `${P}.booking.tokenAmount`),
      confirmation: txt(b.confirmation, 300, 'Confirmation', `${P}.booking.confirmation`, { multiline: true }),
    }),
    rent: compact({
      dueDay: intIn(r.dueDay, 1, 28, 'Rent due day', `${P}.rent.dueDay`),
      lateFee,
      lateFeeUnit: lateFee ? lateFeeUnit : null,
      methods: subset(r.methods, PAYMENT_METHODS, 'Payment methods', `${P}.rent.methods`),
      notes: txt(r.notes, 300, 'Rent notes', `${P}.rent.notes`, { multiline: true }),
    }),
    deposit: compact({
      amount: amountIn(d.amount, 500000, 'Deposit amount', `${P}.deposit.amount`),
      refundDays: intIn(d.refundDays, 0, 180, 'Deposit refund days', `${P}.deposit.refundDays`),
      deductions: txt(d.deductions, 400, 'Deposit deductions', `${P}.deposit.deductions`, { multiline: true }),
    }),
    stay: compact({
      noticeMonths: intIn(s.noticeMonths, 0, 6, 'Notice period (months)', `${P}.stay.noticeMonths`),
      lockInMonths: intIn(s.lockInMonths, 0, 24, 'Lock-in (months)', `${P}.stay.lockInMonths`),
      notes: txt(s.notes, 300, 'Notice notes', `${P}.stay.notes`, { multiline: true }),
    }),
    cancellation: compact({
      freeCancelDays: intIn(c.freeCancelDays, 0, 90, 'Free cancellation days', `${P}.cancellation.freeCancelDays`),
      refundPercent: intIn(c.refundPercent, 0, 100, 'Refund percent', `${P}.cancellation.refundPercent`),
      text: txt(c.text, 600, 'Cancellation policy', `${P}.cancellation.text`, { multiline: true }),
    }),
    included: subset(v.included, INCLUDED_KEYS, 'Included in rent', `${P}.included`),
    extraCharges,
    maintenance: compact({
      responseHours: intIn(m.responseHours, 1, 168, 'Repair response (hours)', `${P}.maintenance.responseHours`),
      notes: txt(m.notes, 300, 'Maintenance notes', `${P}.maintenance.notes`, { multiline: true }),
    }),
  });
  return Object.keys(out).length ? out : null;
};

// ── Safety & staff ─────────────────────────────────────────────────────────────────────────────
const ENTRY_TYPES = ['biometric', 'keycard', 'key'];
const GUARD_MODES = ['24x7', 'night', 'hours'];
const validateSafety = (input) => {
  const P = 'safety';
  const v = objOrNull(input, 'Safety', P);
  if (!v) return null;
  const guard = oneOf(v.guard, GUARD_MODES, 'Security guard', `${P}.guard`);
  let guardFrom = null;
  let guardTo = null;
  if (guard === 'hours') {
    guardFrom = timeAt(v.guardFrom, 'Guard from', `${P}.guardFrom`);
    guardTo = timeAt(v.guardTo, 'Guard until', `${P}.guardTo`);
    if (!guardFrom) fail('Security guard hours: enter both times.', `${P}.guardFrom`);
    if (!guardTo) fail('Security guard hours: enter both times.', `${P}.guardTo`);
  }
  const out = compact({
    cctv: boolOrNull(v.cctv, 'CCTV', `${P}.cctv`),
    entry: oneOf(v.entry, ENTRY_TYPES, 'Entry', `${P}.entry`),
    guard, guardFrom, guardTo,
    fireExtinguishers: boolOrNull(v.fireExtinguishers, 'Fire extinguishers', `${P}.fireExtinguishers`),
    firstAid: boolOrNull(v.firstAid, 'First aid', `${P}.firstAid`),
    wardenName: txt(v.wardenName, 60, 'Warden name', `${P}.wardenName`),
    wardenAvailability: txt(v.wardenAvailability, 120, 'Warden availability', `${P}.wardenAvailability`),
    emergency: txt(v.emergency, 600, 'Emergency process', `${P}.emergency`, { multiline: true }),
  });
  return Object.keys(out).length ? out : null;
};

// ── Move-in ────────────────────────────────────────────────────────────────────────────────────
const validateMoveIn = (input) => {
  const P = 'moveIn';
  const v = objOrNull(input, 'Move-in', P);
  if (!v) return null;
  const out = compact({
    documents: lines(v.documents, 'Documents', `${P}.documents`, { max: 12, len: 80 }),
    bring: lines(v.bring, 'What to bring', `${P}.bring`, { max: 15, len: 60 }),
    provided: lines(v.provided, 'Provided', `${P}.provided`, { max: 15, len: 60 }),
    steps: lines(v.steps, 'Move-in steps', `${P}.steps`, { max: 8, len: 200 }),
  });
  return Object.keys(out).length ? out : null;
};

// ── Location guide ─────────────────────────────────────────────────────────────────────────────
const NEARBY_CATEGORIES = ['college', 'hospital', 'pharmacy', 'atm', 'bus_stop', 'supermarket', 'restaurant', 'gym', 'other'];
const MAX_NEARBY = 20;
const validateLocationGuide = (input) => {
  const P = 'locationGuide';
  const v = objOrNull(input, 'Location guide', P);
  if (!v) return null;
  const seen = new Set();
  const nearby = listOf(v.nearby, 'Nearby places', `${P}.nearby`, MAX_NEARBY).map((x, i) => {
    const f = `${P}.nearby[${i}]`;
    if (!isObj(x)) fail('Each nearby place needs a name and distance.', f);
    const name = txt(x.name, 60, 'Place name', `${f}.name`);
    if (!name) return null;
    const category = oneOf(x.category, NEARBY_CATEGORIES, `${name}: category`, `${f}.category`) || 'other';
    const distanceM = intIn(x.distanceM, 1, 50000, `${name}: distance (metres)`, `${f}.distanceM`);
    if (distanceM === null) fail(`${name}: enter the distance.`, `${f}.distanceM`);
    const walkMinutes = intIn(x.walkMinutes, 1, 120, `${name}: walking minutes`, `${f}.walkMinutes`);
    const k = name.toLowerCase();
    if (seen.has(k)) fail(`${name} is listed twice.`, `${f}.name`);
    seen.add(k);
    return compact({ name, category, distanceM, walkMinutes });
  }).filter(Boolean).sort((a, b) => a.distanceM - b.distanceM);
  const out = compact({ howToReach: txt(v.howToReach, 600, 'How to reach', `${P}.howToReach`, { multiline: true }), nearby });
  return Object.keys(out).length ? out : null;
};

// ── FAQ ────────────────────────────────────────────────────────────────────────────────────────
const MAX_FAQ = 20;
const validateFaq = (v) => {
  const seen = new Set();
  return listOf(v, 'FAQ', 'faq', MAX_FAQ).map((x, i) => {
    const f = `faq[${i}]`;
    if (!isObj(x)) fail('Each FAQ needs a question and an answer.', f);
    const q = txt(x.q, 160, `Question ${i + 1}`, `${f}.q`);
    const a = txt(x.a, 800, `Answer ${i + 1}`, `${f}.a`, { multiline: true });
    if (!q && !a) return null;
    if (!q) fail(`Question ${i + 1}: write the question.`, `${f}.q`);
    if (!a) fail(`"${q.slice(0, 40)}": write the answer.`, `${f}.a`);
    const k = q.toLowerCase();
    if (seen.has(k)) fail(`"${q.slice(0, 40)}" is asked twice.`, `${f}.q`);
    seen.add(k);
    return { id: keepId(x.id), q, a };
  }).filter(Boolean);
};

/** Sections a route writes: PUT /api/pg/:id/<path> { <field>: value } (each saved on its own, audited). */
const SECTION_WRITERS = {
  highlights: { field: 'highlights', validate: validateHighlights, audit: 'PG_HIGHLIGHTS_UPDATED' },
  'house-rules': { field: 'houseRules', validate: validateHouseRules, audit: 'PG_RULES_UPDATED' },
  policies: { field: 'policies', validate: validatePolicies, audit: 'PG_POLICIES_UPDATED' },
  safety: { field: 'safety', validate: validateSafety, audit: 'PG_SAFETY_UPDATED' },
  'move-in': { field: 'moveIn', validate: validateMoveIn, audit: 'PG_MOVEIN_UPDATED' },
  'location-guide': { field: 'locationGuide', validate: validateLocationGuide, audit: 'PG_LOCATION_UPDATED' },
  faq: { field: 'faq', validate: validateFaq, audit: 'PG_FAQ_UPDATED' },
};

// ── Reviews ────────────────────────────────────────────────────────────────────────────────────
const REVIEW_REPORT_REASONS = ['spam', 'offensive', 'fake', 'personal_info', 'other'];
const validateReview = (b) => {
  const v = isObj(b) ? b : {};
  const rating = Number(v.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail('Choose a rating from 1 to 5.', 'rating');
  const text = txt(v.text, 1000, 'Review', 'text', { multiline: true });
  if (text.length < 10) fail('Write at least a sentence about your stay (10 characters or more).', 'text');
  return { rating, text };
};
const firstNameOf = (name) => {
  const first = String(name || '').replace(EMOJI_RE, '').trim().split(/\s+/)[0] || '';
  const clean = first.replace(/[^\p{L}'.-]/gu, '').slice(0, 20);
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : 'Resident';
};
const publicReview = (r) => {
  const x = plain(r);
  return { id: x.id, rating: x.rating, text: x.text, firstName: x.firstName || 'Resident', createdAt: x.createdAt };
};

// ── Promotions (admin-curated cards on the PG list page) ───────────────────────────────────────
const PROMO_TYPES = ['IMAGE', 'VIDEO'];
const PROMO_CTAS = ['VIEW_PG', 'WATCH_TOUR', 'BOOK_VISIT'];
const PROMO_CTA_LABEL = { VIEW_PG: 'View PG', WATCH_TOUR: 'Watch tour', BOOK_VISIT: 'Book a visit' };
const PROMO_LABELS = ['FEATURED', 'SPONSORED'];
const MAX_PROMO_DAYS = 366;
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A plain date "2026-10-20" is an IST calendar day: a start date begins at 00:00 IST, an end date is
// inclusive and runs to 23:59:59.999 IST that day. Full ISO timestamps (and stored dates) are taken as given.
const parseDate = (v, label, path, { endOfDay = false } = {}) => {
  if (v === undefined || v === null || v === '') fail(`${label}: choose a date.`, path);
  const plainDay = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const d = new Date(plainDay ? `${v}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:30` : v);
  if (Number.isNaN(d.getTime())) fail(`${label} is not a valid date.`, path);
  return d;
};
/**
 * Cleans a promotion write. `current` = the stored row on an update (fields not sent keep their value).
 * Returns { values, imageUrl }; for IMAGE promos the route still stores imageUrl (utils/imageStore).
 */
const validatePromotion = (body, { current = null, now = new Date() } = {}) => {
  const b = isObj(body) ? body : {};
  const cur = current ? plain(current) : {};
  const pick = (k) => (b[k] !== undefined ? b[k] : cur[k]);
  const type = String(pick('type') || '').toUpperCase();
  if (!PROMO_TYPES.includes(type)) fail('type must be IMAGE or VIDEO.', 'type');
  const headline = txt(pick('headline'), 40, 'Headline', 'headline');
  if (!headline) fail('Write a headline (up to 40 characters).', 'headline');
  const subline = txt(pick('subline'), 60, 'Subline', 'subline');
  const hostelId = String(pick('hostelId') || '');
  if (!UUID_LIKE.test(hostelId)) fail('Choose the PG this promotion opens.', 'hostelId');
  const cta = String(pick('cta') || 'VIEW_PG').toUpperCase();
  if (!PROMO_CTAS.includes(cta)) fail(`cta must be one of ${PROMO_CTAS.join(', ')}.`, 'cta');
  if (cta === 'WATCH_TOUR' && type !== 'VIDEO') fail('"Watch tour" needs a video promotion.', 'cta');
  const label = String(pick('label') || 'FEATURED').toUpperCase();
  if (!PROMO_LABELS.includes(label)) fail('label must be FEATURED or SPONSORED.', 'label');
  let youtubeId = null;
  let imageUrl = null;
  if (type === 'VIDEO') {
    const link = b.youtubeUrl !== undefined && b.youtubeUrl !== null && b.youtubeUrl !== '' ? b.youtubeUrl : null;
    const stored = pick('youtubeId');
    youtubeId = link ? parseYouTubeId(link) : (typeof stored === 'string' && YT_ID_RE.test(stored) ? stored : null);
    if (!youtubeId) fail('Paste a YouTube link (youtube.com/watch?v=…, youtu.be/… or youtube.com/shorts/…).', 'youtubeUrl');
  } else {
    imageUrl = pick('imageUrl');
    if (typeof imageUrl !== 'string' || !imageUrl.trim()) fail('Upload the promotion image.', 'imageUrl');
  }
  const startsAt = parseDate(pick('startsAt'), 'Start date', 'startsAt');
  const endsAt = parseDate(pick('endsAt'), 'End date', 'endsAt', { endOfDay: true });
  if (endsAt <= startsAt) fail('The end date cannot be before the start date.', 'endsAt');
  if (endsAt - startsAt > MAX_PROMO_DAYS * 86400000) fail(`A promotion can run for at most ${MAX_PROMO_DAYS} days.`, 'endsAt');
  if ((!current || b.endsAt !== undefined) && endsAt <= now) fail('The end date is already past.', 'endsAt');
  const priority = intIn(pick('priority') ?? 0, 0, 999, 'Order', 'priority');
  const active = pick('isActive');
  return {
    values: { type, headline, subline: subline || null, hostelId, cta, label, youtubeId, startsAt, endsAt, priority: priority || 0, isActive: active === undefined || active === null ? true : active === true },
    imageUrl,
  };
};
const promoLive = (p, now = Date.now()) => p.isActive !== false && new Date(p.startsAt).getTime() <= now && new Date(p.endsAt).getTime() > now;
const publicPromotion = (row, pgItem) => {
  const p = plain(row);
  return {
    id: p.id,
    type: p.type,
    headline: p.headline,
    subline: p.subline || '',
    label: p.label,
    labelText: p.label === 'SPONSORED' ? 'Sponsored' : 'Featured',
    cta: p.cta,
    ctaLabel: PROMO_CTA_LABEL[p.cta] || 'View PG',
    imageUrl: p.type === 'IMAGE' ? p.imageUrl : youtubeThumb(p.youtubeId),
    video: p.type === 'VIDEO' ? { youtubeId: p.youtubeId, thumbnailUrl: youtubeThumb(p.youtubeId), embedUrl: youtubeEmbed(p.youtubeId), watchUrl: youtubeWatch(p.youtubeId) } : null,
    pg: pgItem ? { id: pgItem.id, name: pgItem.name, area: pgItem.area, rentFrom: pgItem.rentFrom, genderType: pgItem.genderType, isVerified: pgItem.isVerified } : null,
  };
};

// ── Public shapes ──────────────────────────────────────────────────────────────────────────────
// Names only: phone numbers and emails stay internal (students reach staff through the Zenvy housing desk).
const CONTACT_FIELDS = ['ownerName', 'wardenName'];
const publicContact = (ci) => {
  const c = isObj(ci) ? ci : {};
  const out = {};
  for (const f of CONTACT_FIELDS) {
    const v = f === 'wardenName' ? (c.wardenName || c.warden) : c[f];
    if (typeof v === 'string' && v.trim()) out[f] = v.trim().slice(0, 120);
  }
  return out;
};
const locationOf = (pg) => {
  const c = isObj(pg.contactInfo) ? pg.contactInfo : {};
  const lat = num(c.lat);
  const lng = num(c.lng);
  return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat, lng } : null;
};
const plain = (row) => (row && typeof row.get === 'function' ? row.get({ plain: true }) : row || {});

// Stored sections were validated on write; reads still keep to the known keys only.
const pickKeys = (o, keys) => {
  if (!isObj(o)) return null;
  const out = {};
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') out[k] = o[k];
  return Object.keys(out).length ? out : null;
};
const SAFETY_KEYS = ['cctv', 'entry', 'guard', 'guardFrom', 'guardTo', 'fireExtinguishers', 'firstAid', 'wardenName', 'wardenAvailability', 'emergency'];
const safetyForRead = (pg) => {
  const s = pickKeys(pg.safety, SAFETY_KEYS) || {};
  // Warden name from the older contact fields when the safety section has none (never a phone number).
  if (!s.wardenName) {
    const c = isObj(pg.contactInfo) ? pg.contactInfo : {};
    const w = typeof (c.wardenName || c.warden) === 'string' ? (c.wardenName || c.warden).trim().slice(0, 60) : '';
    if (w && !PHONE_RE.test(w)) s.wardenName = w;
  }
  return Object.keys(s).length ? s : null;
};
const policiesForRead = (pg) => pickKeys(pg.policies, ['booking', 'rent', 'deposit', 'stay', 'cancellation', 'included', 'extraCharges', 'maintenance']);
const moveInForRead = (pg) => pickKeys(pg.moveIn, ['documents', 'bring', 'provided', 'steps']);
const locationGuideForRead = (pg) => pickKeys(pg.locationGuide, ['howToReach', 'nearby']);
const highlightsForRead = (pg) => (Array.isArray(pg.highlights) ? pg.highlights.filter((h) => typeof h === 'string' && h.trim()).slice(0, MAX_HIGHLIGHTS) : []);
const faqForRead = (pg) => (Array.isArray(pg.faq) ? pg.faq.filter((f) => isObj(f) && typeof f.q === 'string' && typeof f.a === 'string').map((f, i) => ({ id: typeof f.id === 'string' ? f.id : `f${i}`, q: f.q, a: f.a })) : []);
const emptySummary = () => ({ average: null, count: 0 });

/**
 * Section keys the detail screen shows, in order (the section nav uses the same list). A section with no
 * content is left out: the contract is "hidden when empty", never a placeholder.
 */
const sectionsOf = (d) => [
  'overview',
  d.roomTypes.length ? 'rooms' : null,
  d.messTimetable && d.messTimetable.meals.length ? 'mess' : null,
  d.houseRules.length || d.timings ? 'rules' : null,
  d.policies || d.moveIn ? 'policies' : null,
  d.safety ? 'safety' : null,
  d.location || d.locationGuide ? 'location' : null,
  d.faq.length ? 'faq' : null,
  d.reviewSummary.count > 0 ? 'reviews' : null,
].filter(Boolean);

/** Detail shape (GET /api/pg/:id). `rooms`: the active rooms; `reviewSummary`: visible reviews only. */
const publicPg = (row, rooms = [], { reviewSummary = null } = {}) => {
  const pg = plain(row);
  const roomList = rooms.map(plain);
  const photos = photosOf(pg);
  const cover = photos.find((p) => p.isCover) || null;
  const roomTypes = buildRoomTypes(roomList, pg.securityDeposit);
  const prices = roomList.map((r) => num(r.pricePerBed)).filter((n) => n !== null && n > 0);
  const location = locationOf(pg);
  const d = {
    id: pg.id,
    name: pg.name,
    address: pg.address,
    area: pg.area || null,
    description: pg.description || '',
    distanceFromCollege: pg.distanceFromCollege,
    genderType: pg.genderType || 'Co-ed',
    baseRent: pg.baseRent,
    rentFrom: prices.length ? Math.min(...prices) : num(pg.baseRent),
    securityDeposit: pg.securityDeposit,
    totalRooms: pg.totalRooms,
    isActive: pg.isActive !== false,
    isVerified: pg.isVerified === true,
    amenities: Array.isArray(pg.amenities) ? pg.amenities.filter((a) => typeof a === 'string' && a.trim()) : [],
    rules: Array.isArray(pg.rules) ? pg.rules.filter((a) => typeof a === 'string' && a.trim()) : [],
    images: imagesFromPhotos(photos),
    photos,
    coverPhoto: cover ? cover.url : null,
    videos: videosForRead(pg.videos),
    messTimetable: messForRead(pg),
    timings: timingsForRead(pg),
    // v2 sections (null / [] when empty).
    highlights: highlightsForRead(pg),
    houseRules: houseRulesForRead(pg),
    policies: policiesForRead(pg),
    safety: safetyForRead(pg),
    moveIn: moveInForRead(pg),
    locationGuide: locationGuideForRead(pg),
    faq: faqForRead(pg),
    reviewSummary: reviewSummary || emptySummary(),
    // Legacy fields for older app builds.
    messMenu: isObj(pg.messMenu) ? pg.messMenu : {},
    foodTimetable: isObj(pg.foodTimetable) ? pg.foodTimetable : {},
    contactInfo: { ...publicContact(pg.contactInfo), ...(location ? { lat: location.lat, lng: location.lng } : {}) },
    location,
    rooms: roomList.map(publicRoom),
    roomTypes,
    bedsAvailable: roomList.reduce((a, r) => a + (Number(r.availableBeds) || 0), 0),
    createdAt: pg.createdAt || null,
    updatedAt: pg.updatedAt || null,
  };
  d.sections = sectionsOf(d);
  return d;
};

/** List card shape (GET /api/pg, /api/pg/home). */
const publicPgListItem = (row, rooms = [], opts = {}) => {
  const d = publicPg(row, rooms, opts);
  const included = d.policies && Array.isArray(d.policies.included) ? d.policies.included : [];
  return {
    id: d.id,
    name: d.name,
    address: d.address,
    area: d.area,
    distanceFromCollege: d.distanceFromCollege,
    genderType: d.genderType,
    baseRent: d.baseRent,
    rentFrom: d.rentFrom,
    securityDeposit: d.securityDeposit,
    isVerified: d.isVerified,
    amenities: d.amenities,
    coverPhoto: d.coverPhoto,
    images: d.coverPhoto ? [d.coverPhoto] : [],
    photoCount: d.photos.length,
    videoCount: d.videos.length,
    hasMess: !!(d.messTimetable && d.messTimetable.meals.length),
    roomTypeCount: d.roomTypes.length,
    bedsAvailable: d.bedsAvailable,
    hasRooms: d.rooms.length > 0,
    location: d.location,
    // Filters on the list page.
    hasAC: d.roomTypes.some((t) => t.hasAC),
    foodIncluded: included.includes('food'),
    highlights: d.highlights.slice(0, 2),
    reviewSummary: d.reviewSummary,
    createdAt: d.createdAt,
  };
};

module.exports = {
  PHOTO_CATEGORIES, MAX_PHOTOS, MAX_VIDEOS, DAY_KEYS, FOOD_TAGS, TIMING_TIME_FIELDS,
  PgInputError, parseTime, parseYouTubeId, youtubeThumb, youtubeEmbed, youtubeWatch,
  validatePhotos, validateVideos, validateMessTimetable, validateTimings,
  photosOf, imagesFromPhotos, videosForRead, messForRead, legacyTimetable, timingsForRead,
  roomTypeKey, buildRoomTypes, publicRoom, publicPg, publicPgListItem, publicContact,
  // v2
  RULE_CATEGORIES, RULE_CATEGORY_LABEL, PAYMENT_METHODS, INCLUDED_KEYS, CHARGE_UNITS, ENTRY_TYPES, GUARD_MODES,
  NEARBY_CATEGORIES, MAX_HIGHLIGHTS, MAX_FAQ, MAX_NEARBY, PHONE_RE,
  validateHighlights, validateHouseRules, validatePolicies, validateSafety, validateMoveIn, validateLocationGuide, validateFaq,
  houseRulesForRead, safetyForRead, SECTION_WRITERS, sectionsOf,
  REVIEW_REPORT_REASONS, validateReview, firstNameOf, publicReview,
  PROMO_TYPES, PROMO_CTAS, PROMO_CTA_LABEL, PROMO_LABELS, validatePromotion, promoLive, publicPromotion,
};
