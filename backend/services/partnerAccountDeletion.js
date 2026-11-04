/**
 * C9: self-service account deletion for partner accounts that sign up in an app (Google Play "account
 * deletion" requirement): Zenvy Rider (DeliveryPartner) and Zenvy Auto Driver (AutoDriver).
 * Stores (restaurants / campus vendors) are created by Zenvy and closed by the Zenvy team on request.
 *
 * Mirrors the customer flow (services/accountDeletion.js):
 *   - re-authentication on top of the session: the account password, or a fresh SMS code sent to the
 *     account's own number (purpose 'delete_partner_account', see routes/partnerAccountRoutes.js);
 *   - blockers first (work in progress, money still to settle) so nothing is half-deleted;
 *   - the account row is ANONYMISED, not dropped: orders / trips, cash ledger, payouts, wallet ledger,
 *     incidents and trip events keep a valid partner id for accounting, tax and safety records, but that id no
 *     longer points at a name, phone, photo, documents, emergency contact, location or push token.
 *     Phone + password are replaced (login impossible), tokenVersion is bumped (every session ends at once),
 *     live sockets are dropped and the auth cache is cleared;
 *   - personal data is DELETED: profile / licence / document photos (private media), notifications, the
 *     partner's own support tickets without an order link, order-chat messages, login codes, draft trips;
 *   - an audit row (VerificationLog, action RIDER_ACCOUNT_DELETED / AUTO_DRIVER_ACCOUNT_DELETED) records
 *     who / when / which tables, without personal data.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');

const safeLog = (msg, err) => console.warn(`[PARTNER_ACCOUNT_DELETE] ${msg}:`, err && (err.parent?.code || err.name || err.message));
const tagOf = (id) => String(id).replace(/-/g, '').slice(0, 8);
const randomSecret = () => crypto.randomBytes(32).toString('base64url');

const model = (sequelize, name) => (sequelize && sequelize.models && sequelize.models[name]) || null;

/** Runs one clean-up step; a missing table / failure is recorded, never thrown. */
const step = async (summary, name, fn) => {
  try {
    const n = await fn();
    if (n) summary.deleted[name] = (summary.deleted[name] || 0) + n;
  } catch (err) {
    const missing = /no such table|does not exist|undefined_table|42P01/i.test(String(err && (err.message || '') + (err.parent?.code || '')));
    if (!missing) { safeLog(`${name} failed`, err); summary.failed.push(name); }
  }
};

const audit = async (sequelize, { kind, id, reason, summary }) => {
  const Log = model(sequelize, 'VerificationLog');
  if (!Log) return;
  try {
    await Log.create({
      adminId: `self:${kind}`,
      targetId: String(id),
      action: kind === 'rider' ? 'RIDER_ACCOUNT_DELETED' : 'AUTO_DRIVER_ACCOUNT_DELETED',
      details: JSON.stringify({ by: 'account owner (in-app, re-authenticated)', reasonGiven: !!reason, deleted: summary.deleted, failed: summary.failed }),
    });
  } catch (err) {
    safeLog('audit row failed', err);
  }
};

const deleteMedia = async (sequelize, ownerId) => {
  const Media = model(sequelize, 'CampusMedia');
  if (!Media) return 0;
  return Media.destroy({ where: { ownerId: String(ownerId) } });
};

const revokeSessions = (id) => {
  try { require('../middleware/authMiddleware').clearCachedUser(id); } catch { /* optional */ }
  try { require('../utils/realtime').disconnectRevokedSockets(id, null); } catch { /* optional */ }
};

// ── Rider (DeliveryPartner) ──────────────────────────────────────────────────────────────────────

const riderPrecheck = async (sequelize, partner) => {
  const blockers = [];
  const Order = model(sequelize, 'Order');
  if (Order) {
    const n = await Order.count({ where: { deliveryPartnerId: partner.id, status: { [Op.notIn]: ['Delivered', 'Cancelled'] } } }).catch(() => 0);
    if (n > 0) blockers.push({ code: 'ACTIVE_DELIVERIES', message: `You have ${n} deliver${n === 1 ? 'y' : 'ies'} in progress. Finish or hand ${n === 1 ? 'it' : 'them'} back first.` });
  }
  const Basket = model(sequelize, 'MegaBasket');
  if (Basket) {
    const n = await Basket.count({ where: { deliveryPartnerId: partner.id, status: { [Op.notIn]: ['Delivered', 'Cancelled'] } } }).catch(() => 0);
    if (n > 0) blockers.push({ code: 'ACTIVE_DELIVERIES', message: 'You have a Mega Basket delivery in progress. Finish it first.' });
  }
  const cash = Number(partner.cashHeldPaise) || 0;
  if (cash > 0) {
    blockers.push({ code: 'CASH_TO_DEPOSIT', message: `You still hold ₹${(cash / 100).toFixed(2)} cash collected for ZENV. Deposit it with the ZENV team first.` });
  }
  const wallet = Number(partner.walletBalance) || 0;
  if (wallet >= 0.01) {
    blockers.push({ code: 'BALANCE_TO_PAY_OUT', message: `ZENV still owes you ₹${wallet.toFixed(2)}. Contact ZENV support to receive it before you delete your account.` });
  }
  const Payout = model(sequelize, 'Payout');
  if (Payout) {
    const n = await Payout.count({ where: { partnerType: 'rider', partnerId: String(partner.id), status: 'PENDING' } }).catch(() => 0);
    if (n > 0) blockers.push({ code: 'PAYOUT_PENDING', message: 'A payout to you is still being processed. Please wait until it is paid.' });
  }
  return blockers;
};

const deleteRiderAccount = async ({ sequelize, partner, reason = null }) => {
  const blockers = await riderPrecheck(sequelize, partner);
  if (blockers.length) return { ok: false, status: 409, body: { code: blockers[0].code, message: blockers[0].message, blockers } };
  const id = partner.id;
  const phone = partner.phone;
  const summary = { deleted: {}, updated: {}, failed: [] };

  // 1. Anonymise FIRST: access is revoked even if a later clean-up step fails.
  const Rider = partner.constructor;
  const anon = {
    name: 'Deleted rider',
    phone: `deleted_${tagOf(id)}_${crypto.randomBytes(3).toString('hex')}`,
    password: randomSecret(), // hashed by the model hook: an unknown secret
    vehicleNumber: null,
    photoUrl: null,
    bio: null,
    emergencyContact: null,
    liveLocation: { lat: null, lng: null },
    isOnline: false,
    isAvailable: false,
    fcmTokens: [],
    isFcmActive: false,
    isSosActive: false,
    sosLocation: null,
    sosNote: null,
    isApproved: false,
    suspendedAt: new Date(),
    accountDeletedAt: new Date(),
    currentOrderId: null,
    tokenVersion: (Number(partner.tokenVersion) || 0) + 1,
  };
  for (const key of Object.keys(anon)) if (!Rider.rawAttributes[key]) delete anon[key];
  await partner.update(anon);
  revokeSessions(id);

  // 2. Personal data.
  await step(summary, 'CampusMedia', () => deleteMedia(sequelize, id));
  await step(summary, 'Notification', () => model(sequelize, 'Notification')?.destroy({ where: { userId: id } }));
  await step(summary, 'OrderMessage', () => model(sequelize, 'OrderMessage')?.destroy({ where: { senderType: 'rider', senderId: id } }));
  // Support tickets about an order are kept (dispute / refund record); the rest are personal.
  await step(summary, 'Ticket', () => model(sequelize, 'Ticket')?.destroy({ where: { riderId: id, orderId: null } }));
  if (phone) await step(summary, 'OtpCode', () => model(sequelize, 'OtpCode')?.destroy({ where: { phone } }));

  await audit(sequelize, { kind: 'rider', id, reason, summary });
  console.log(`[PARTNER_ACCOUNT_DELETE] rider ${tagOf(id)} closed${reason ? ' (reason given)' : ''}; failed: ${summary.failed.join(',') || 'none'}`);
  return { ok: true, summary };
};

// ── Auto-Ride driver (AutoDriver) ────────────────────────────────────────────────────────────────

const driverPrecheck = async (sequelize, driver) => {
  const blockers = [];
  const { ACTIVE_TRIP_STATUSES } = require('../modules/autoRide/enums');
  const Trip = model(sequelize, 'AutoTrip');
  if (Trip) {
    const n = await Trip.count({ where: { driverId: driver.id, status: { [Op.in]: ACTIVE_TRIP_STATUSES } } }).catch(() => 0);
    if (n > 0) blockers.push({ code: 'ACTIVE_TRIPS', message: 'You have a published or running trip. Complete or cancel it first.' });
  }
  const Req = model(sequelize, 'AutoPrivateRequest');
  if (Req) {
    const n = await Req.count({ where: { driverId: driver.id, status: { [Op.in]: ['REQUESTED', 'ACCEPTED'] } } }).catch(() => 0);
    if (n > 0) blockers.push({ code: 'ACTIVE_REQUESTS', message: 'You have an open full-auto request. Finish or decline it first.' });
  }
  return blockers;
};

const deleteAutoDriverAccount = async ({ sequelize, driver, reason = null }) => {
  const blockers = await driverPrecheck(sequelize, driver);
  if (blockers.length) return { ok: false, status: 409, body: { code: blockers[0].code, message: blockers[0].message, blockers } };
  const id = driver.id;
  const phone = driver.phone;
  const summary = { deleted: {}, updated: {}, failed: [] };

  // 1. Anonymise FIRST. Status SUSPENDED + reason: the row can never be used again (phone + password replaced).
  const Driver = driver.constructor;
  const anon = {
    name: 'Deleted driver',
    phone: `del_${crypto.randomBytes(6).toString('hex')}`, // STRING(16)
    password: await bcrypt.hash(randomSecret(), 10),
    tokenVersion: (Number(driver.tokenVersion) || 0) + 1,
    status: 'SUSPENDED',
    suspendedReason: 'Account deleted by the driver',
    emergencyContactName: null,
    emergencyContactPhone: null,
    licenceNumber: null,
    licenceExpiresOn: null,
    badgeNumber: null,
    documents: {},
    preferredRouteIds: [],
    isOnline: false,
    fcmTokens: [],
  };
  for (const key of Object.keys(anon)) if (!Driver.rawAttributes[key]) delete anon[key];
  await driver.update(anon);
  revokeSessions(id);

  // 2. Vehicles are KEPT (registration + capacity are part of the trip / safety record) but leave service and
  //    lose their document / photo references (the files are deleted below).
  try {
    const Vehicle = model(sequelize, 'AutoVehicle');
    if (Vehicle) {
      const [n] = await Vehicle.update({ status: 'SUSPENDED', documents: {}, photos: [] }, { where: { driverId: id } });
      if (n) summary.updated.AutoVehicle = n;
    }
  } catch (err) { safeLog('vehicles failed', err); summary.failed.push('AutoVehicle'); }
  // Draft trips were never published (no passengers): deleted.
  await step(summary, 'AutoTrip(draft)', () => model(sequelize, 'AutoTrip')?.destroy({ where: { driverId: id, status: 'DRAFT' } }));
  await step(summary, 'CampusMedia', () => deleteMedia(sequelize, id));
  await step(summary, 'Notification', () => model(sequelize, 'Notification')?.destroy({ where: { userId: id } }));
  if (phone) await step(summary, 'OtpCode', () => model(sequelize, 'OtpCode')?.destroy({ where: { phone } }));

  await audit(sequelize, { kind: 'auto_driver', id, reason, summary });
  console.log(`[PARTNER_ACCOUNT_DELETE] auto driver ${tagOf(id)} closed${reason ? ' (reason given)' : ''}; failed: ${summary.failed.join(',') || 'none'}`);
  return { ok: true, summary };
};

module.exports = { riderPrecheck, deleteRiderAccount, driverPrecheck, deleteAutoDriverAccount };
