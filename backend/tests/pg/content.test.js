// PG premium listing content: photo gallery (limit 20, categories, order, cover, private media refused),
// YouTube room videos (link parsing, admin only), weekly mess timetable + house timings validation, room
// types, and the public read shapes (no owner account id, no internal contact fields).
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let admin; let student; let owner;
test.before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
  student = await H.mkUser();
  owner = await H.mkUser();
});
test.after(H.teardown);

const C = () => H.r('utils/pgContent');

// ── YouTube parsing ──────────────────────────────────────────────────────────────────────────────
test('unit: YouTube links - watch, youtu.be and shorts give the 11-character id', () => {
  const { parseYouTubeId } = C();
  const id = 'dQw4w9WgXcQ';
  for (const ok of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s`,
    `https://m.youtube.com/watch?feature=share&v=${id}`,
    `http://www.youtube.com/watch?v=${id}`,
    `youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?si=abcDEF123`,
    `https://www.youtube.com/shorts/${id}`,
    `https://youtube.com/shorts/${id}?feature=share`,
    `  https://youtu.be/${id}  `,
  ]) assert.strictEqual(parseYouTubeId(ok), id, ok);
});

test('unit: YouTube links - other hosts, look-alikes, playlists, channels, bad ids are refused', () => {
  const { parseYouTubeId } = C();
  for (const bad of [
    '', null, undefined, 42, 'not a link',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQX',
    'https://www.youtube.com/watch?list=PL123',
    'https://www.youtube.com/@zenvy',
    'https://www.youtube.com/channel/UC123',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
    'https://evil.com/youtu.be/dQw4w9WgXcQ',
    'https://vimeo.com/123456',
    'javascript:alert(1)//youtu.be/dQw4w9WgXcQ',
    'ftp://youtu.be/dQw4w9WgXcQ',
    'https://user:pw@youtu.be/dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ/extra',
    'https://www.youtube.com/shorts/dQw4w9WgX<Q',
  ]) assert.strictEqual(parseYouTubeId(bad), null, String(bad));
});

// ── Times / timetable / timings (unit) ───────────────────────────────────────────────────────────
test('unit: times accept 24-hour and am/pm input and normalise to HH:MM', () => {
  const { parseTime, PgInputError } = C();
  assert.strictEqual(parseTime('7:30', 'x'), '07:30');
  assert.strictEqual(parseTime('07:30', 'x'), '07:30');
  assert.strictEqual(parseTime('7:30 PM', 'x'), '19:30');
  assert.strictEqual(parseTime('12am', 'x'), '00:00');
  assert.strictEqual(parseTime('12:15pm', 'x'), '12:15');
  assert.strictEqual(parseTime('', 'x'), null);
  for (const bad of ['24:00', '7:60', '13pm', '7', 'noon', '7:3', 'aa:bb']) assert.throws(() => parseTime(bad, 'x'), PgInputError, bad);
});

const mess = (extra = {}) => ({
  meals: [
    { key: 'dinner', label: 'Dinner', start: '19:30', end: '21:30' },
    { key: 'breakfast', label: 'Breakfast', start: '07:30', end: '09:30' },
    { key: 'lunch', label: 'Lunch', start: '12:30', end: '14:00' },
    { key: 'snacks', label: 'Snacks', start: '17:00', end: '18:00' },
  ],
  days: {
    mon: { breakfast: { menu: 'Idli, sambar, chutney', tag: 'veg' }, dinner: { menu: 'Chicken curry, rice', tag: 'non-veg' } },
    sun: { lunch: { menu: 'Special biryani', tag: 'nonveg', start: '13:00', end: '15:00' } },
  },
  notes: 'Festival days: special lunch.\nNo mess on the second Saturday.',
  ...extra,
});

test('unit: mess timetable - meals sorted by time, tags normalised, per-day time override kept', () => {
  const { validateMessTimetable } = C();
  const t = validateMessTimetable(mess());
  assert.deepStrictEqual(t.meals.map((m) => m.key), ['breakfast', 'lunch', 'snacks', 'dinner']);
  assert.strictEqual(t.days.mon.dinner.tag, 'nonveg');
  assert.deepStrictEqual(t.days.sun.lunch, { menu: 'Special biryani', tag: 'nonveg', start: '13:00', end: '15:00' });
  assert.ok(t.notes.includes('\n'));
  assert.strictEqual(validateMessTimetable(null), null);
  assert.strictEqual(validateMessTimetable({ meals: [] }), null);
});

test('unit: mess timetable - bad days, unknown meals, reversed times, bad tags, long text refused', () => {
  const { validateMessTimetable, PgInputError } = C();
  const cases = [
    mess({ days: { funday: {} } }),
    mess({ days: { mon: { brunch: { menu: 'x' } } } }),
    mess({ meals: [{ key: 'breakfast', label: 'Breakfast', start: '09:30', end: '07:30' }], days: {} }),
    mess({ meals: [{ key: 'breakfast', label: 'Breakfast', start: '07:30' }], days: {} }),
    mess({ meals: [{ key: 'breakfast', label: 'Breakfast', start: '25:00', end: '26:00' }], days: {} }),
    mess({ days: { mon: { breakfast: { menu: 'x', tag: 'vegan' } } } }),
    mess({ days: { mon: { breakfast: { menu: 'x'.repeat(301) } } } }),
    mess({ notes: 'x'.repeat(1001) }),
    mess({ meals: [{ key: 'a', label: 'Breakfast' }], days: {} }),
    mess({ meals: [{ label: 'Lunch' }, { label: 'lunch' }], days: {} }),
    mess({ meals: Array.from({ length: 7 }, (_, i) => ({ label: `Meal ${i}` })), days: {} }),
    { meals: [], days: { mon: { breakfast: 'x' } } },
    'not an object',
  ];
  for (const c of cases) assert.throws(() => validateMessTimetable(c), PgInputError, JSON.stringify(c).slice(0, 120));
});

test('unit: timings - pairs required, visitor window ordered, quiet hours may cross midnight', () => {
  const { validateTimings, PgInputError } = C();
  const t = validateTimings({ gateOpen: '6:00 am', gateClose: '22:30', visitorFrom: '10:00', visitorTo: '18:00', checkIn: '12:00', checkOut: '11:00', quietFrom: '22:00', quietTo: '06:00', curfewNote: 'Late entry needs a warden call.' });
  assert.deepStrictEqual(t, { gateOpen: '06:00', gateClose: '22:30', visitorFrom: '10:00', visitorTo: '18:00', checkIn: '12:00', checkOut: '11:00', quietFrom: '22:00', quietTo: '06:00', curfewNote: 'Late entry needs a warden call.' });
  assert.strictEqual(validateTimings({}), null);
  for (const bad of [{ gateOpen: '06:00' }, { visitorFrom: '18:00', visitorTo: '10:00' }, { quietFrom: '22:00' }, { checkIn: '25:00' }, { curfewNote: 'x'.repeat(301) }, []]) {
    assert.throws(() => validateTimings(bad), PgInputError, JSON.stringify(bad));
  }
});

test('unit: legacy messMenu / foodTimetable are shown through the timetable shape (no invented data)', () => {
  const { legacyTimetable } = C();
  const t = legacyTimetable({ Monday: { breakfast: 'Poha', lunch: '', dinner: 'Roti' } }, { breakfast: '8:00 AM - 9:30 AM', lunch: 'whenever', dinner: { start: '19:30', end: '21:00' } });
  assert.strictEqual(t.legacy, true);
  assert.deepStrictEqual(t.meals.find((m) => m.key === 'breakfast'), { key: 'breakfast', label: 'Breakfast', start: '08:00', end: '09:30' });
  assert.deepStrictEqual(t.meals.find((m) => m.key === 'dinner'), { key: 'dinner', label: 'Dinner', start: '19:30', end: '21:00' });
  assert.ok(!t.meals.some((m) => m.key === 'lunch'), 'a meal with no time and no menu is not shown');
  assert.deepStrictEqual(t.days.mon, { breakfast: { menu: 'Poha', tag: null }, dinner: { menu: 'Roti', tag: null } });
  assert.strictEqual(legacyTimetable({}, {}), null);
});

// ── Photos (API) ─────────────────────────────────────────────────────────────────────────────────
test('photos: categories, captions, order and one cover; images mirror the gallery cover-first; audited', async () => {
  const pg = await H.mkPg(admin);
  const photos = [
    { url: H.png(1), category: 'room', caption: 'Twin room, window side', order: 2, roomType: '2-sharing-ac-attached' },
    { url: H.png(2), category: 'BATHROOM', order: 0 },
    { url: H.png(3), category: 'MESS', caption: 'Dining hall', order: 1, isCover: true },
  ];
  const res = await H.api('PUT', `/api/pg/${pg.id}/photos`, admin.token, { photos });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  const out = res.body.photos;
  assert.deepStrictEqual(out.map((p) => p.category), ['BATHROOM', 'MESS', 'ROOM']);
  assert.deepStrictEqual(out.map((p) => p.order), [0, 1, 2]);
  assert.deepStrictEqual(out.map((p) => p.isCover), [false, true, false]);
  assert.strictEqual(out[2].roomType, '2-sharing-ac-attached');
  assert.strictEqual(out[2].caption, 'Twin room, window side');
  for (const p of out) assert.match(p.url, /\/api\/campus\/media\/[0-9a-f-]{36}$/);
  assert.strictEqual(res.body.coverPhoto, out[1].url);
  assert.strictEqual(res.body.images[0], out[1].url, 'legacy images start with the cover');
  assert.strictEqual(res.body.images.length, 3);
  const media = await H.ctx.M('CampusMedia').findAll({ raw: true, attributes: ['purpose', 'isPrivate'] });
  assert.ok(media.length >= 3 && media.every((m) => m.purpose === 'pg' && !m.isPrivate), 'stored as public pg media');
  assert.strictEqual((await H.auditRows('PG_PHOTOS_UPDATED', pg.id)).length, 1);

  // No cover chosen -> the first photo is the cover. Ids are kept on re-save.
  const again = await H.api('PUT', `/api/pg/${pg.id}/photos`, admin.token, { photos: out.map((p) => ({ ...p, isCover: false })) });
  assert.strictEqual(again.status, 200);
  assert.deepStrictEqual(again.body.photos.map((p) => p.id), out.map((p) => p.id));
  assert.strictEqual(again.body.photos[0].isCover, true);
});

test('photos: limit 20, bad category, two covers, duplicates, bad order, long caption, non-images refused', async () => {
  const pg = await H.mkPg(admin);
  const url = (i) => `https://cdn.example.com/pg/${i}.jpg`;
  const many = Array.from({ length: 21 }, (_, i) => ({ url: url(i), category: 'ROOM' }));
  let res = await H.api('PUT', `/api/pg/${pg.id}/photos`, admin.token, { photos: many });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.message, /at most 20/);
  res = await H.api('PUT', `/api/pg/${pg.id}/photos`, admin.token, { photos: many.slice(0, 20) });
  assert.strictEqual(res.status, 200, 'exactly 20 is fine');
  assert.strictEqual(res.body.photos.length, 20);
  const bad = [
    [{ url: url(1), category: 'KITCHEN' }],
    [{ url: url(1) }],
    [{ url: url(1), category: 'ROOM', isCover: true }, { url: url(2), category: 'ROOM', isCover: true }],
    [{ url: url(1), category: 'ROOM' }, { url: url(1), category: 'MESS' }],
    [{ url: url(1), category: 'ROOM', order: -1 }],
    [{ url: url(1), category: 'ROOM', order: 1.5 }],
    [{ url: url(1), category: 'ROOM', caption: 'x'.repeat(121) }],
    [{ url: url(1), category: 'ROOM', roomType: 'Bad Type!' }],
    [{ url: 'data:text/html;base64,PGgxPmhpPC9oMT4=', category: 'ROOM' }],
    [{ url: '', category: 'ROOM' }],
    [{ url: 'javascript:alert(1)', category: 'ROOM' }],
  ];
  for (const photos of bad) {
    const r = await H.api('PUT', `/api/pg/${pg.id}/photos`, admin.token, { photos });
    assert.strictEqual(r.status >= 400 && r.status < 500, true, `${JSON.stringify(photos).slice(0, 100)} -> ${r.status}`);
  }
  res = await H.api('PUT', `/api/pg/${pg.id}/photos`, admin.token, { photos: 'nope' });
  assert.strictEqual(res.status, 400);
  // The gallery is unchanged by refused saves.
  const read = await H.api('GET', `/api/pg/${pg.id}`);
  assert.strictEqual(read.body.photos.length, 20);
});

test('photos: private media (an ID card upload) can never be attached to a listing', async () => {
  const pg = await H.mkPg(admin);
  const { saveImageBytes } = H.r('utils/imageStore');
  const buf = Buffer.from(H.png(99).split(',')[1], 'base64');
  const saved = await saveImageBytes(buf, { ownerId: student.id, purpose: 'id_card' });
  const res = await H.api('PUT', `/api/pg/${pg.id}/photos`, admin.token, { photos: [{ url: `/api/campus/media/${saved.id}`, category: 'ROOM' }] });
  assert.strictEqual(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.message, /private/);
});

test('photos / videos / mess / timings: students and the listing owner account get 403, guests 401', async () => {
  const pg = await H.mkPg(admin);
  await H.ctx.M('PGHostel').update({ ownerId: owner.id }, { where: { id: pg.id } });
  const bodies = {
    photos: { photos: [{ url: 'https://cdn.example.com/a.jpg', category: 'ROOM' }] },
    videos: { videos: [{ youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' }] },
    mess: { messTimetable: mess() },
    timings: { timings: { gateOpen: '06:00', gateClose: '22:00' } },
  };
  for (const [section, body] of Object.entries(bodies)) {
    for (const who of [student, owner]) {
      const r = await H.api('PUT', `/api/pg/${pg.id}/${section}`, who.token, body);
      assert.strictEqual(r.status, 403, `${section} by non-admin -> ${r.status}`);
    }
    const g = await H.api('PUT', `/api/pg/${pg.id}/${section}`, null, body);
    assert.strictEqual(g.status, 401, `${section} by guest -> ${g.status}`);
  }
  const read = await H.api('GET', `/api/pg/${pg.id}`);
  assert.deepStrictEqual(read.body.videos, []);
  assert.deepStrictEqual(read.body.photos, []);
  assert.strictEqual(read.body.timings, null);
  assert.strictEqual(read.body.messTimetable, null);
});

// ── Videos (API) ─────────────────────────────────────────────────────────────────────────────────
test('videos: admin saves YouTube links as ids; thumbnail + privacy-enhanced embed in the read; audited', async () => {
  const pg = await H.mkPg(admin);
  const res = await H.api('PUT', `/api/pg/${pg.id}/videos`, admin.token, { videos: [
    { youtubeUrl: 'https://youtube.com/shorts/aaaaaaaaaaa', title: 'Room tour', roomType: '2-sharing-ac-attached', order: 1 },
    { youtubeUrl: 'https://www.youtube.com/watch?v=bbbbbbbbbbb&t=3', title: 'Mess walk-through', order: 0 },
  ] });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  const v = res.body.videos;
  assert.deepStrictEqual(v.map((x) => x.youtubeId), ['bbbbbbbbbbb', 'aaaaaaaaaaa']);
  assert.strictEqual(v[0].thumbnailUrl, 'https://i.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg');
  assert.strictEqual(v[0].embedUrl, 'https://www.youtube-nocookie.com/embed/bbbbbbbbbbb?playsinline=1&rel=0&modestbranding=1');
  assert.strictEqual(v[1].roomType, '2-sharing-ac-attached');
  assert.strictEqual((await H.auditRows('PG_VIDEOS_UPDATED', pg.id)).length, 1);
  const row = await H.ctx.M('PGHostel').findByPk(pg.id);
  assert.ok(!JSON.stringify(row.videos).includes('youtube.com'), 'only ids are stored');

  for (const videos of [
    [{ youtubeUrl: 'https://vimeo.com/1234' }],
    [{ youtubeUrl: 'https://youtu.be/short' }],
    [{ youtubeUrl: 'https://youtu.be/ccccccccccc' }, { youtubeUrl: 'https://www.youtube.com/watch?v=ccccccccccc' }],
    [{ youtubeUrl: 'https://youtu.be/ccccccccccc', title: 'x'.repeat(101) }],
    Array.from({ length: 16 }, (_, i) => ({ youtubeUrl: `https://youtu.be/${String(i).padStart(11, 'd')}` })),
  ]) {
    const r = await H.api('PUT', `/api/pg/${pg.id}/videos`, admin.token, { videos });
    assert.strictEqual(r.status, 400, `${JSON.stringify(videos).slice(0, 80)} -> ${r.status}`);
  }
  const cleared = await H.api('PUT', `/api/pg/${pg.id}/videos`, admin.token, { videos: [] });
  assert.strictEqual(cleared.status, 200);
  assert.deepStrictEqual(cleared.body.videos, []);
});

// ── Mess + timings (API) ─────────────────────────────────────────────────────────────────────────
test('mess timetable + timings: saved, validated (400 with the field), cleared with null; audited', async () => {
  const pg = await H.mkPg(admin);
  let res = await H.api('PUT', `/api/pg/${pg.id}/mess`, admin.token, { messTimetable: mess() });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(res.body.messTimetable.meals.map((m) => m.label), ['Breakfast', 'Lunch', 'Snacks', 'Dinner']);
  assert.strictEqual(res.body.messTimetable.days.mon.breakfast.tag, 'veg');
  res = await H.api('PUT', `/api/pg/${pg.id}/mess`, admin.token, { messTimetable: mess({ days: { mon: { breakfast: { menu: 'x', start: '10:00', end: '09:00' } } } }) });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.code, 'INVALID_PG_CONTENT');
  res = await H.api('PUT', `/api/pg/${pg.id}/timings`, admin.token, { timings: { gateOpen: '6:00', gateClose: '10:30 pm', checkIn: '12:00', curfewNote: 'Gate closes at 10:30 pm; call the warden for late entry.' } });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(res.body.timings, { gateOpen: '06:00', gateClose: '22:30', checkIn: '12:00', curfewNote: 'Gate closes at 10:30 pm; call the warden for late entry.' });
  res = await H.api('PUT', `/api/pg/${pg.id}/timings`, admin.token, { timings: { gateOpen: '06:00' } });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.field, 'gateOpen');
  assert.strictEqual((await H.auditRows('PG_MESS_UPDATED', pg.id)).length, 1);
  assert.strictEqual((await H.auditRows('PG_TIMINGS_UPDATED', pg.id)).length, 1);
  res = await H.api('PUT', `/api/pg/${pg.id}/mess`, admin.token, { messTimetable: null });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.messTimetable, null);
  res = await H.api('PUT', `/api/pg/${pg.id}/timings`, admin.token, { timings: null });
  assert.strictEqual(res.body.timings, null);
});

// ── Public read shapes ───────────────────────────────────────────────────────────────────────────
test('public detail + list: no owner id or internal contact fields; room types, rent from, beds, location', async () => {
  const pg = await H.mkPg(admin, { area: 'Neerukonda', isVerified: true });
  await H.mkRoom(admin, pg.id, { pricePerBed: 9000, availableBeds: 1 });
  const cheap = await H.mkRoom(admin, pg.id, { pricePerBed: 8500, availableBeds: 2 });
  await H.mkRoom(admin, pg.id, { sharingType: 3, hasAC: false, hasAttachedBathroom: false, pricePerBed: 6000, totalBeds: 3, availableBeds: 0 });
  await H.mkRoom(admin, pg.id, { roomType: 'Deluxe single', sharingType: 1, pricePerBed: 14000, totalBeds: 1, availableBeds: 1, securityDeposit: 20000 });
  await H.mkRoom(admin, pg.id, { pricePerBed: 1000, isActive: false });

  const res = await H.api('GET', `/api/pg/${pg.id}`);
  assert.strictEqual(res.status, 200);
  const d = res.body;
  assert.ok(!('ownerId' in d), 'owner account id is never public');
  assert.ok(!JSON.stringify(d).includes(admin.id), 'no admin account id anywhere');
  assert.ok(!('internalNote' in d.contactInfo));
  assert.deepStrictEqual(d.location, { lat: 16.4632, lng: 80.5064 });
  assert.strictEqual(d.isVerified, true);
  assert.strictEqual(d.area, 'Neerukonda');
  assert.strictEqual(d.rentFrom, 6000);
  assert.strictEqual(d.bedsAvailable, 4);
  assert.strictEqual(d.rooms.length, 4, 'inactive room hidden');
  const types = Object.fromEntries(d.roomTypes.map((t) => [t.key, t]));
  assert.deepStrictEqual(Object.keys(types).sort(), ['2-sharing-ac-attached', '3-sharing-non-ac-shared', 'deluxe-single']);
  assert.strictEqual(types['2-sharing-ac-attached'].rentFrom, 8500);
  assert.strictEqual(types['2-sharing-ac-attached'].rentTo, 9000);
  assert.strictEqual(types['2-sharing-ac-attached'].availableBeds, 3);
  assert.strictEqual(types['2-sharing-ac-attached'].bookRoomId, cheap.id, 'cheapest room with a free bed is booked');
  assert.strictEqual(types['2-sharing-ac-attached'].deposit, 10000, 'falls back to the PG deposit');
  assert.strictEqual(types['3-sharing-non-ac-shared'].bookRoomId, null, 'full');
  assert.strictEqual(types['deluxe-single'].deposit, 20000);
  assert.strictEqual(types['deluxe-single'].label, 'Deluxe single');

  const list = await H.api('GET', '/api/pg');
  assert.strictEqual(list.status, 200);
  const item = list.body.find((x) => x.id === pg.id);
  assert.ok(item);
  assert.ok(!('ownerId' in item) && !('contactInfo' in item) && !('rooms' in item));
  assert.strictEqual(item.rentFrom, 6000);
  assert.strictEqual(item.bedsAvailable, 4);
  assert.strictEqual(item.roomTypeCount, 3);
  assert.strictEqual(item.coverPhoto, null);
  assert.deepStrictEqual(item.images, []);
});

test('legacy rows: plain images become OTHER photos (first = cover); an old images PUT cannot override a gallery', async () => {
  const pg = await H.mkPg(admin, { images: ['https://cdn.example.com/old1.jpg', 'https://cdn.example.com/old2.jpg'] });
  let d = (await H.api('GET', `/api/pg/${pg.id}`)).body;
  assert.deepStrictEqual(d.photos.map((p) => [p.category, p.isCover]), [['OTHER', true], ['OTHER', false]]);
  assert.strictEqual(d.coverPhoto, 'https://cdn.example.com/old1.jpg');
  await H.api('PUT', `/api/pg/${pg.id}/photos`, admin.token, { photos: [{ url: 'https://cdn.example.com/new.jpg', category: 'BUILDING' }] });
  const put = await H.api('PUT', `/api/pg/${pg.id}`, admin.token, { images: ['https://cdn.example.com/stale.jpg'], name: 'Renamed Residency' });
  assert.strictEqual(put.status, 200);
  d = (await H.api('GET', `/api/pg/${pg.id}`)).body;
  assert.strictEqual(d.name, 'Renamed Residency');
  assert.deepStrictEqual(d.images, ['https://cdn.example.com/new.jpg']);
  assert.strictEqual(d.address, 'Neerukonda, Amaravati', 'a partial PUT keeps the other fields');
  assert.strictEqual(d.genderType, 'Boys');
});

test('inactive listings are 404 for students and visible to admins; non-UUID ids are 404', async () => {
  const pg = await H.mkPg(admin, { isActive: false });
  assert.strictEqual((await H.api('GET', `/api/pg/${pg.id}`, student.token)).status, 404);
  assert.strictEqual((await H.api('GET', `/api/pg/${pg.id}`, admin.token)).status, 200);
  assert.ok(!(await H.api('GET', '/api/pg')).body.some((x) => x.id === pg.id));
  assert.strictEqual((await H.api('PUT', '/api/pg/not-a-uuid/photos', admin.token, { photos: [] })).status, 404);
});

test('rooms: room type name and per-room deposit are validated', async () => {
  const pg = await H.mkPg(admin);
  let r = await H.api('POST', `/api/pg/${pg.id}/rooms`, admin.token, { roomNumber: '9', sharingType: 2, pricePerBed: 8000, totalBeds: 2, availableBeds: 2, securityDeposit: -1 });
  assert.strictEqual(r.status, 400);
  r = await H.api('POST', `/api/pg/${pg.id}/rooms`, admin.token, { roomNumber: '9', sharingType: 2, pricePerBed: 8000, totalBeds: 2, availableBeds: 2, roomType: 'x'.repeat(49) });
  assert.strictEqual(r.status, 400);
  const room = await H.mkRoom(admin, pg.id, { roomType: '  Premium   twin ', securityDeposit: 15000 });
  assert.strictEqual(room.roomType, 'Premium twin');
  r = await H.api('PUT', `/api/pg/${pg.id}/rooms/${room.id}`, admin.token, { roomType: '', securityDeposit: '' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.roomType, null);
  assert.strictEqual(r.body.securityDeposit, null);
  assert.strictEqual(r.body.pricePerBed, 8500, 'partial room PUT keeps other fields');
});
