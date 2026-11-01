/**
 * C4: the facts the public /legal pages state, read from the same settings / env the code enforces, so
 * the policies never drift from what the app actually does. Every read fails soft to the code default.
 */
const num = (v, min, max, dflt) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
};
const on = (v) => ['1', 'true', 'yes', 'on'].includes(String(v || '').trim().toLowerCase());

const safe = async (fn, dflt) => {
  try {
    const v = await fn();
    return v === undefined || v === null ? dflt : v;
  } catch {
    return dflt;
  }
};

/** Third parties that actually receive data in this deployment (env-driven). */
const thirdParties = async (env = process.env) => {
  const list = [];
  list.push({ key: 'firebase', name: 'Google Firebase', what: 'phone number sign-in (SMS verification when used), push notifications (device push token, notification content) and crash reports from the apps (Crashlytics: device model, OS and app version and the error, not linked to your name or number)' });
  list.push({ key: 'google', name: 'Google Sign-In', what: 'your Google account name, email and profile photo, only if you choose "Continue with Google"' });
  if (String(env.FAST2SMS_API_KEY || '').trim()) list.push({ key: 'fast2sms', name: 'Fast2SMS', what: 'your mobile number and the one-time code, to deliver sign-in and verification SMS' });
  if (String(env.BREVO_API_KEY || '').trim()) list.push({ key: 'brevo', name: 'Brevo', what: 'your email address and the message, for account and service emails' });

  const { dbHostType } = require('../config/dbSettings');
  const db = dbHostType(env.DATABASE_URL);
  const dbName = db === 'supabase' ? 'Supabase' : db === 'render' ? 'Render' : null;
  const appHost = env.RENDER || env.RENDER_EXTERNAL_URL || env.RENDER_SERVICE_ID ? 'Render' : null;
  if (appHost && dbName && appHost === dbName) {
    list.push({ key: 'hosting', name: appHost, what: 'application hosting and database: all account, order and community data is stored here' });
  } else {
    list.push({ key: 'hosting', name: appHost || 'Our cloud hosting provider', what: 'application hosting (servers that run ZCS) and server logs' });
    list.push({ key: 'database', name: dbName || 'Our managed database provider', what: 'database hosting: all account, order and community data is stored here' });
  }

  let redis = false;
  try { redis = require('./redis').isConfigured(); } catch { redis = false; }
  if (redis) {
    const url = String(env.REDIS_URL || '');
    const cloud = /redis-cloud|redislabs|rlrcp\.com/i.test(url);
    list.push({ key: 'redis', name: cloud ? 'Redis Cloud' : 'Our managed Redis provider', what: 'short-lived cache, rate-limit counters and real-time message relay between our servers (no long-term storage)' });
  }

  let r2 = false;
  try { r2 = require('./mediaStorage').driverName() === 's3'; } catch { r2 = false; }
  const cfProxy = on(env.TRUST_CLOUDFLARE);
  if (r2 || cfProxy) {
    const parts = [];
    if (cfProxy) parts.push('network proxy and protection (your IP address and request data pass through it)');
    if (r2) parts.push('R2 file storage for uploaded photos and documents (private files are only served through short-lived signed links)');
    list.push({ key: 'cloudflare', name: 'Cloudflare', what: parts.join('; ') });
  }

  const wa = String(env.WHATSAPP_PROVIDER || 'CONSOLE').toUpperCase();
  if (wa !== 'CONSOLE') list.push({ key: 'whatsapp', name: 'Our WhatsApp messaging provider', what: 'your mobile number and order status messages' });

  const razorpay = await safe(async () => {
    if (!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET)) return false;
    return require('../modules/campusEvents/services/flag').readOnlineFlag();
  }, false);
  if (razorpay) list.push({ key: 'razorpay', name: 'Razorpay', what: 'online payment for Campus Events tickets that offer it (ZCS never sees your card or bank details)' });

  list.push({ key: 'osm', name: 'OpenStreetMap (Nominatim)', what: 'the address text you type when searching for a delivery location (sent through our server, not linked to your account)' });
  if (String(env.TURN_URLS || '').trim()) list.push({ key: 'turn', name: 'Our call relay (TURN) service', what: 'encrypted audio / video of calls when a direct connection is not possible (relayed live, never recorded)' });
  return list;
};

const gather = async (env = process.env) => {
  const legal = require('./legalSettings');
  const settings = await legal.getSettings();

  const AR = require('../modules/autoRide/enums').DEFAULT_SETTINGS;
  const autoRide = await safe(() => require('../modules/autoRide/services/flag').readSettings(), { ...AR });
  const autoRideWallet = await safe(() => require('../modules/autoRide/services/flag').readWalletFlag(), false);

  const CE = require('../modules/campusEvents/enums').DEFAULT_SETTINGS;
  const events = await safe(() => require('../modules/campusEvents/services/flag').readSettings(), { ...CE });
  const eventsWallet = await safe(() => require('../modules/campusEvents/services/flag').readWalletFlag(), false);

  const retention = await safe(() => require('../cron/retentionCron').getRetentionPolicy(), { chatDays: 7, pulseDays: 30 });

  // C7: rentals safety settings (condition photos, extra-charges cap and answer window).
  const rentalsSafety = require('../modules/rentals/services/safety');
  const rentals = await safe(() => rentalsSafety.readSettings(), { ...rentalsSafety.DEFAULTS });

  const friendsCfg = await safe(() => require('../modules/friends/services/featureFlags').getConfig(), null);
  const sla = (friendsCfg && friendsCfg.slaHours) || { low: 72, medium: 48, high: 24, critical: 4 };
  const autoHide = (friendsCfg && friendsCfg.autoHideThreshold) || 3;

  return {
    settings,
    grievanceComplete: legal.grievanceComplete(settings),
    autoRide,
    autoRideWallet,
    events,
    eventsWallet,
    retention,
    rentals,
    connectChatDays: num(env.CONNECT_CHAT_RETENTION_DAYS, 1, 365, 30),
    ugcAutoHide: num(env.UGC_AUTO_HIDE_REPORTS, 2, 50, 3),
    friendsAutoHide: autoHide,
    sla,
    orders: {
      // Same formulas as controllers/orderController.js.
      pendingTimeoutMin: require('./orderTimeouts').storeAcceptTimeoutMinutes(env),
      unclaimedTimeoutMin: Math.max(10, parseInt(env.UNCLAIMED_ORDER_TIMEOUT_MINUTES, 10) || 30),
      riderPickupTimeoutMin: Math.max(5, parseInt(env.RIDER_PICKUP_TIMEOUT_MIN, 10) || 20),
      customerCancelSeconds: 120,
    },
    walletTransfers: String(env.WALLET_TRANSFERS_ENABLED || '').toLowerCase() === 'true',
    thirdParties: await thirdParties(env),
  };
};

module.exports = { gather, thirdParties };
