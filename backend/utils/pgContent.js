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

// ── Public shapes ──────────────────────────────────────────────────────────────────────────────
const CONTACT_FIELDS = ['ownerName', 'phone', 'email', 'wardenName', 'emergencyContact'];
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

/** Detail shape (GET /api/pg/:id). `rooms`: the active rooms. */
const publicPg = (row, rooms = []) => {
  const pg = plain(row);
  const roomList = rooms.map(plain);
  const photos = photosOf(pg);
  const cover = photos.find((p) => p.isCover) || null;
  const roomTypes = buildRoomTypes(roomList, pg.securityDeposit);
  const prices = roomList.map((r) => num(r.pricePerBed)).filter((n) => n !== null && n > 0);
  const location = locationOf(pg);
  return {
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
    // Legacy fields for older app builds.
    messMenu: isObj(pg.messMenu) ? pg.messMenu : {},
    foodTimetable: isObj(pg.foodTimetable) ? pg.foodTimetable : {},
    contactInfo: { ...publicContact(pg.contactInfo), ...(location ? { lat: location.lat, lng: location.lng } : {}) },
    location,
    rooms: roomList.map(publicRoom),
    roomTypes,
    bedsAvailable: roomList.reduce((a, r) => a + (Number(r.availableBeds) || 0), 0),
    updatedAt: pg.updatedAt || null,
  };
};

/** List card shape (GET /api/pg). */
const publicPgListItem = (row, rooms = []) => {
  const d = publicPg(row, rooms);
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
  };
};

module.exports = {
  PHOTO_CATEGORIES, MAX_PHOTOS, MAX_VIDEOS, DAY_KEYS, FOOD_TAGS, TIMING_TIME_FIELDS,
  PgInputError, parseTime, parseYouTubeId, youtubeThumb, youtubeEmbed, youtubeWatch,
  validatePhotos, validateVideos, validateMessTimetable, validateTimings,
  photosOf, imagesFromPhotos, videosForRead, messForRead, legacyTimetable, timingsForRead,
  roomTypeKey, buildRoomTypes, publicRoom, publicPg, publicPgListItem, publicContact,
};
