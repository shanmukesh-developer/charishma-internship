// ZCS partner-app test logins (runs on every startup from server.js, once per database).
//
// The owner tests every partner flow on a phone, so each partner app gets one clearly named test account
// (data/partner_test_accounts_v1_2026-10-27.json), ready to take orders:
//   ZCS Rider          DeliveryPartner "ZCS Test Rider"            approved (isApproved), offline until the app goes online
//   ZCS Restaurant     Restaurant "ZCS Test Restaurant"            RESTAURANT, live, open 24h, 2 test dishes
//   ZCS Vendor         Restaurant "ZCS Test Vendor Stall"          LOCAL_VENDOR, live, open 24h, 2 test items
//   ZCS Campus Stall   Restaurant "ZCS Test Campus Stall"          LOCAL_VENDOR (vendor login), live, open 24h, 2 test
//                      items; In-Campus Booking is left OFF with no UPI ID: students pay the stall's own UPI, so the
//                      owner adds a real UPI ID in the app and switches booking on in the admin portal
//   ZCS Auto Driver    AutoDriver "ZCS Test Auto Driver"           VERIFIED, with an APPROVED 8-seat test auto
//                      (AP 00 TST 0105: district 00 does not exist, so it can never be a real plate)
//   ZCS PG Partner     PgOwner "ZCS Test PG Owner"                 ACTIVE, no forced password change, linked to a
//                      new live listing "ZCS Test PG" with one room (not marked verified: no invented site visit)
// Rules, same pattern as scripts/auto_routes_seed.js:
//  - passwords: the data file holds bcrypt hashes only (bcryptjs, cost 10, the models' own hashing). Restaurant and
//    DeliveryPartner hash on create in a model hook, so those rows are written with { hooks: false } (the hash
//    would be hashed again) and the one other create hook (Restaurant.publishedAt) is applied here by hand.
//    AutoDriver / PgOwner have no hooks (their controllers hash), so the hash is stored as it is;
//  - phones: 10 digits starting 6-9 (every partner app and the auto / PG logins refuse anything else). India has
//    no reserved "fictional" mobile range, so the 60000001xx block is used: not a number anyone gave us, never sent
//    an SMS unless someone requests an OTP for it (forgot password / delete account) on these accounts;
//  - create-only: an account whose phone (or a store whose exact name) already exists in its table is skipped
//    and named in the result, never edited, so a real account is never touched and admin edits win;
//  - one transaction for every row and the GlobalConfig marker PARTNER_TEST_ACCOUNTS_V1_DONE: two instances
//    booting at once can never both create them, and once the marker exists this never runs again (a test
//    account the admin deletes is not re-created). The marker value lists every created id for clean removal.
// Delete the marker row to re-run. Set DISABLE_PARTNER_TEST_ACCOUNTS=true to switch this off.
const path = require('path');
const fs = require('fs');

const DATA_PATH = path.join(__dirname, '..', 'data', 'partner_test_accounts_v1_2026-10-27.json');
const DEFAULT_MARKER = 'PARTNER_TEST_ACCOUNTS_V1_DONE';
const MOBILE_RE = /^[6-9]\d{9}$/;
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const HOURS_24 = { start: '00:00', end: '00:00' }; // equal start / end = open 24h (utils/storeHours)

const tenDigits = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  const t = d.length === 12 && d.startsWith('91') ? d.slice(2) : (d.length === 11 && d.startsWith('0') ? d.slice(1) : d);
  return /^\d{10}$/.test(t) ? t : null;
};

/** Refuses a data file that could write a plaintext password, a bad phone or an unmarked name. */
const validateData = (data) => {
  const errors = [];
  const raw = JSON.stringify(data);
  if (/"password"\s*:/i.test(raw)) errors.push('data must never contain a "password" field (bcrypt passwordHash only)');
  const accounts = ['rider', 'restaurant', 'vendorStall', 'campusStall', 'autoDriver', 'pgOwner'];
  const phones = new Set();
  for (const key of accounts) {
    const a = data[key];
    if (!a) { errors.push(`${key}: missing`); continue; }
    if (!/^ZCS Test /.test(String(a.name || ''))) errors.push(`${key}: name must start with "ZCS Test "`);
    if (!MOBILE_RE.test(String(a.phone || ''))) errors.push(`${key}: phone must be 10 digits starting 6-9`);
    if (phones.has(a.phone)) errors.push(`${key}: phone used twice`);
    phones.add(a.phone);
    if (!BCRYPT_RE.test(String(a.passwordHash || ''))) errors.push(`${key}: passwordHash must be a bcrypt hash`);
  }
  for (const key of ['restaurant', 'vendorStall', 'campusStall']) {
    const s = data[key];
    if (!s) continue;
    if (!s.location) errors.push(`${key}: location required`);
    if (!Array.isArray(s.items) || !s.items.length) errors.push(`${key}: at least one item`);
    for (const it of s.items || []) if (!it.name || !(Number(it.price) > 0)) errors.push(`${key}: every item needs a name and a price`);
  }
  if (data.restaurant && String(data.restaurant.vendorType).toUpperCase() !== 'RESTAURANT') errors.push('restaurant: vendorType RESTAURANT');
  for (const key of ['vendorStall', 'campusStall']) if (data[key] && String(data[key].vendorType).toUpperCase() !== 'LOCAL_VENDOR') errors.push(`${key}: vendorType LOCAL_VENDOR`);
  if (data.autoDriver && !(data.autoDriver.vehicle && data.autoDriver.vehicle.registrationNumber)) errors.push('autoDriver: vehicle.registrationNumber required');
  if (data.pgOwner && !(data.pgOwner.listing && data.pgOwner.listing.name)) errors.push('pgOwner: listing.name required');
  if (errors.length) throw new Error(`partner test account data invalid: ${errors.join('; ')}`);
};

const runPartnerTestAccountsSeed = async ({ dataPath = DATA_PATH } = {}) => {
  if (String(process.env.DISABLE_PARTNER_TEST_ACCOUNTS || '').toLowerCase() === 'true') return { skipped: 'disabled' };
  const { getSequelize } = require('../config/db');
  const { getGlobalConfigModel } = require('../models/GlobalConfig');
  const { getRestaurantModel } = require('../models/Restaurant');
  const { getMenuItemModel } = require('../models/MenuItem');
  const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
  const { getUserModel } = require('../models/User');
  const { getPGHostelModel } = require('../models/PGHostel');
  const { getPGRoomModel } = require('../models/PGRoom');
  const autoRide = require('../modules/autoRide');
  const pgOwner = require('../modules/pgOwner');
  const sequelize = getSequelize();
  const GlobalConfig = getGlobalConfigModel();
  const Restaurant = getRestaurantModel();
  const MenuItem = getMenuItemModel();
  const DeliveryPartner = getDeliveryPartnerModel();
  const User = getUserModel();
  const PGHostel = getPGHostelModel();
  const PGRoom = getPGRoomModel();
  const AutoDriver = autoRide.getModel('AutoDriver');
  const AutoVehicle = autoRide.getModel('AutoVehicle');
  const PgOwner = pgOwner.getModel('PgOwner');
  const PgOwnerListing = pgOwner.getModel('PgOwnerListing');
  if (!sequelize || !GlobalConfig || !Restaurant || !MenuItem || !DeliveryPartner || !User || !PGHostel || !PGRoom
    || !AutoDriver || !AutoVehicle || !PgOwner || !PgOwnerListing) return { skipped: 'models not ready' };
  if (!fs.existsSync(dataPath)) return { skipped: 'no partner test account data' };
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const marker = data.marker || DEFAULT_MARKER;
  if (await GlobalConfig.findOne({ where: { key: marker } })) return { skipped: 'already done' };
  validateData(data);

  const { Op, fn, col, where: sqlWhere } = require('sequelize');
  const E = require('../modules/autoRide/enums');
  const { defaultLayout } = require('../modules/autoRide/services/layout');
  const { normalizeReg } = require('../modules/autoRide/services/util');
  const { LOCAL_VENDOR_TYPES } = require('../utils/vendorTypes');
  const result = { created: {}, skipped: {} };
  const now = new Date();

  try {
    await sequelize.transaction(async (t) => {
      const tx = { transaction: t };

      // ── Rider ──
      const rd = data.rider;
      if (await DeliveryPartner.findOne({ where: { phone: rd.phone }, attributes: ['id'], ...tx })) {
        result.skipped.rider = 'phone already has a rider account';
      } else {
        const row = await DeliveryPartner.create({
          name: rd.name, phone: rd.phone, password: rd.passwordHash, vehicleType: rd.vehicleType || 'Bike', vehicleNumber: rd.vehicleNumber || null,
          isApproved: true, isOnline: false, isAvailable: true, tokenVersion: 0,
        }, { ...tx, hooks: false });
        result.created.rider = row.id;
      }

      // ── Stores (restaurant + two stalls): phone, stall WhatsApp numbers and exact name must all be free ──
      const stallPhones = (await Restaurant.findAll({
        where: { vendorType: { [Op.in]: LOCAL_VENDOR_TYPES }, whatsappNumber: { [Op.ne]: null } }, attributes: ['whatsappNumber'], ...tx,
      })).map((s) => tenDigits(s.whatsappNumber)).filter(Boolean);
      for (const key of ['restaurant', 'vendorStall', 'campusStall']) {
        const s = data[key];
        if (await Restaurant.findOne({ where: { phone: s.phone }, attributes: ['id'], ...tx }) || stallPhones.includes(s.phone)) {
          result.skipped[key] = 'phone already used by a store';
          continue;
        }
        if (await Restaurant.findOne({ where: sqlWhere(fn('lower', col('name')), s.name.toLowerCase()), attributes: ['id'], ...tx })) {
          result.skipped[key] = 'a store with this name already exists';
          continue;
        }
        const store = await Restaurant.create({
          name: s.name, location: s.location, lat: s.lat ?? null, lon: s.lon ?? null, campus: s.campus || null,
          vendorType: String(s.vendorType).toUpperCase(), deliveryTime: s.deliveryTime || null,
          phone: s.phone, password: s.passwordHash, tokenVersion: 0,
          isActive: true, isOpenNow: true, isOffline: false, publishedAt: now, operatingHours: HOURS_24,
          stallDescription: s.stallDescription || null, tags: [], fcmTokens: [],
        }, { ...tx, hooks: false });
        const itemIds = [];
        for (const it of s.items) {
          const item = await MenuItem.create({
            restaurantId: store.id, name: it.name, price: Number(it.price), category: it.category || null,
            description: it.description || null, isVegetarian: it.isVegetarian !== false, isAvailable: true,
          }, tx);
          itemIds.push(item.id);
        }
        result.created[key] = { storeId: store.id, itemIds };
      }

      // ── Auto driver + approved auto ──
      const ad = data.autoDriver;
      const reg = normalizeReg(ad.vehicle.registrationNumber);
      if (await AutoDriver.findOne({ where: { phone: ad.phone }, attributes: ['id'], ...tx })) {
        result.skipped.autoDriver = 'phone already has a driver account';
      } else if (await AutoVehicle.findOne({ where: { registrationNumber: reg, status: { [Op.in]: E.VEHICLE_LIVE_STATUSES } }, attributes: ['id'], ...tx })) {
        result.skipped.autoDriver = 'registration number already on a live vehicle';
      } else {
        const cap = Math.max(1, Math.min(E.LIMITS.ABSOLUTE_MAX_CAPACITY, Number(ad.vehicle.capacity) || 8));
        const driver = await AutoDriver.create({
          name: ad.name, phone: ad.phone, password: ad.passwordHash, tokenVersion: 0, status: E.DRIVER_STATUS.VERIFIED,
          submittedAt: now, reviewedAt: now, licenceNumber: ad.licenceNumber || null, licenceExpiresOn: ad.licenceExpiresOn || null,
          documents: {}, preferredRouteIds: [], isOnline: false, fcmTokens: [],
        }, tx);
        const v = ad.vehicle;
        const vehicle = await AutoVehicle.create({
          driverId: driver.id, registrationNumber: reg, make: v.make || null, model: v.model || null, fuel: v.fuel || null,
          rcSeatingCapacity: cap, requestedCapacity: cap, approvedCapacity: cap, seatLayout: defaultLayout(cap),
          permitNumber: v.permitNumber || null, permitExpiresOn: v.permitExpiresOn || null, insuranceExpiresOn: v.insuranceExpiresOn || null,
          documents: {}, photos: [], status: E.VEHICLE_STATUS.APPROVED, reviewedAt: now,
        }, tx);
        result.created.autoDriver = { driverId: driver.id, vehicleId: vehicle.id };
      }

      // ── PG owner + live listing (PGHostel.ownerId is the creating admin's User id, as in the admin portal) ──
      const po = data.pgOwner;
      const l = po.listing;
      if (await PgOwner.findOne({ where: { phone: po.phone }, attributes: ['id'], ...tx })) {
        result.skipped.pgOwner = 'phone already has a PG owner account';
      } else {
        const owner = await PgOwner.create({
          name: po.name, phone: po.phone, email: null, password: po.passwordHash, status: 'ACTIVE',
          mustChangePassword: false, tokenVersion: 0, fcmTokens: [], createdBy: 'scripts/partner_test_accounts_seed.js',
        }, tx);
        const created = { ownerId: owner.id };
        const admin = await User.findOne({ where: { role: 'admin' }, order: [['createdAt', 'ASC']], attributes: ['id'], ...tx });
        if (!admin) {
          result.skipped.pgListing = 'no admin user to own the listing; link a PG to this owner in Admin > PG Partners';
        } else if (await PGHostel.findOne({ where: sqlWhere(fn('lower', col('name')), l.name.toLowerCase()), attributes: ['id'], ...tx })) {
          result.skipped.pgListing = 'a PG listing with this name already exists';
        } else {
          const pg = await PGHostel.create({
            ownerId: admin.id, name: l.name, address: l.address, area: l.area || null, distanceFromCollege: Number(l.distanceFromCollege) || 1,
            genderType: l.genderType || 'Co-ed', baseRent: Number(l.baseRent) || 1000, securityDeposit: Number(l.securityDeposit) || 0,
            totalRooms: Number(l.totalRooms) || (l.rooms || []).length, description: l.description || null,
            amenities: [], images: [], contactInfo: {}, isActive: true, isVerified: false,
          }, tx);
          const roomIds = [];
          for (const rm of l.rooms || []) {
            const room = await PGRoom.create({
              hostelId: pg.id, roomNumber: rm.roomNumber, sharingType: rm.sharingType, pricePerBed: rm.pricePerBed,
              totalBeds: rm.totalBeds, availableBeds: rm.availableBeds, roomType: rm.roomType || null, isActive: true,
            }, tx);
            roomIds.push(room.id);
          }
          await PgOwnerListing.create({ ownerId: owner.id, hostelId: pg.id, linkedBy: 'scripts/partner_test_accounts_seed.js' }, tx);
          created.hostelId = pg.id;
          created.roomIds = roomIds;
        }
        result.created.pgOwner = created;
      }

      await GlobalConfig.create({
        key: marker,
        value: { doneAt: now.toISOString(), ...result },
        description: `ZCS partner test logins (scripts/partner_test_accounts_seed.js, ${path.basename(dataPath)}); delete to re-run.`,
      }, tx);
    });
  } catch (err) {
    if (err && err.name === 'SequelizeUniqueConstraintError') {
      if (await GlobalConfig.findOne({ where: { key: marker } })) return { skipped: 'already done' }; // another instance finished first
    }
    throw err;
  }
  return result;
};

module.exports = { runPartnerTestAccountsSeed, validateData, DATA_PATH, DEFAULT_MARKER };
