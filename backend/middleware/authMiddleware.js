const jwt = require('jsonwebtoken');

// ── In-Memory Auth Cache (Reduces DB lookups by ~80% under 500+ users) ──
const AUTH_CACHE = new Map();
const AUTH_CACHE_TTL = 60 * 1000; // 60 seconds
const AUTH_CACHE_MAX = 2000; // Max entries to prevent memory bloat

// S0: entries are keyed by account table + id (`restaurant:<id>`, `rider:<id>`, `user:<id>`), so a token of
// one account type can never be answered from another type's cached row.
const ACCOUNT_CLASSES = ['restaurant', 'rider', 'user'];
const accountClass = (role) => {
  const r = String(role || '').toLowerCase();
  return r === 'restaurant' || r === 'rider' ? r : 'user';
};
const cacheKey = (cls, userId) => `${cls}:${userId}`;

const getCachedUser = (cls, userId) => {
  const key = cacheKey(cls, userId);
  const entry = AUTH_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > AUTH_CACHE_TTL) {
    AUTH_CACHE.delete(key);
    return null;
  }
  return entry.user;
};

const setCachedUser = (cls, userId, user) => {
  // Evict oldest entries if cache is full
  if (AUTH_CACHE.size >= AUTH_CACHE_MAX) {
    const firstKey = AUTH_CACHE.keys().next().value;
    AUTH_CACHE.delete(firstKey);
  }
  AUTH_CACHE.set(cacheKey(cls, userId), { user, ts: Date.now() });
};

// Drop a cached account right after a ban / role change / approval change so it applies at once
// instead of after the 60 s TTL.
// B1: with REDIS_URL set the other instances drop the same entry (suspension / role / password
// changes take effect everywhere at once, not after the 60 s TTL). utils/cacheBus.
const clearCachedUser = require('../utils/cacheBus').wrap('auth.user', (userId) => {
  if (userId !== undefined && userId !== null) for (const cls of ACCOUNT_CLASSES) AUTH_CACHE.delete(cacheKey(cls, userId));
}, { resync: () => AUTH_CACHE.clear() });

const JWT_ERRORS = ['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'];

// An inactive account: deleted (role 'deleted', services/accountDeletion) -> 401 so every signed-in device signs out;
// suspended by ZCS -> 403 with a code the app shows as a notice (it keeps the session for when it is lifted).
const refuseInactive = (res, role) => (String(role || '').toLowerCase() === 'deleted'
  ? res.status(401).json({ message: 'This account was deleted.', code: 'ACCOUNT_DELETED' })
  : res.status(403).json({ message: 'Account suspended. Please contact support.', code: 'ACCOUNT_SUSPENDED' }));

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer') && !req.headers.authorization.includes('cookie-managed')) {
    token = req.headers.authorization.split(' ')[1];
  } else {
    token = req.cookies?.token;
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  try {
    token = token.replace(/['"]+/g, '').trim();

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('[AUTH_FATAL] JWT_SECRET is not configured on the server.');
      return res.status(500).json({ message: 'Server configuration error' });
    }
    const decoded = jwt.verify(token, secret);
    
    // Check cache first (avoids DB hit for 500+ concurrent users)
    // S0: an Auto-Ride driver token is never a customer / rider / store session (its own protectDriver),
    // and neither is a ZCS PG Partner token (modules/pgOwner protectOwner).
    if (['auto_driver', 'pg_owner'].includes(String(decoded.role || '').toLowerCase())) {
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
    const tokenClass = accountClass(decoded.role);
    const cached = getCachedUser(tokenClass, decoded.id);
    // S0: the cached row must be the same account type as the token, and a suspended account is refused
    // on the cached path too (not only on a cache miss).
    if (cached && accountClass(cached.role) === tokenClass) {
      // Sessions from before a password change (older tokenVersion) are signed out.
      if ((Number(decoded.tv) || 0) !== (Number(cached.tokenVersion) || 0)) {
        return res.status(401).json({ message: 'Your password was changed. Please sign in again.', code: 'SESSION_REVOKED' });
      }
      if (cached.isActive === false) return refuseInactive(res, cached.role);
      const { tokenVersion: _tv, twoFactorEnabled: _tf, ...user } = cached;
      // S1: an admin session without the 2-step claim has no admin powers when 2FA is on / required.
      req.user = tokenClass === 'user' ? require('../services/adminTwoFactor').applyTo(user, decoded, _tf) : user;
      return next();
    }
    
    if (decoded.role === 'restaurant') {
       const { getRestaurantModel } = require('../models/Restaurant');
       const Restaurant = getRestaurantModel();
       if (Restaurant) {
         const dbRest = await Restaurant.findByPk(decoded.id, { attributes: ['id', 'name', 'tokenVersion'] });
         if (!dbRest) return res.status(401).json({ message: 'Restaurant not found' });
         const tokenVersion = Number(dbRest.tokenVersion) || 0;
         setCachedUser('restaurant', decoded.id, { id: dbRest.id, role: 'restaurant', name: dbRest.name, tokenVersion });
         if ((Number(decoded.tv) || 0) !== tokenVersion) {
           return res.status(401).json({ message: 'Your password was changed. Please sign in again.', code: 'SESSION_REVOKED' });
         }
         req.user = { id: dbRest.id, role: 'restaurant', name: dbRest.name };
         return next();
       }
    }
    
    if (decoded.role === 'rider') {
       const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
       const DeliveryPartner = getDeliveryPartnerModel();
       if (DeliveryPartner) {
         const dbRider = await DeliveryPartner.findByPk(decoded.id, { attributes: ['id', 'name', 'tokenVersion'] });
         if (!dbRider) return res.status(401).json({ message: 'Rider not found' });
         const tokenVersion = Number(dbRider.tokenVersion) || 0;
         setCachedUser('rider', decoded.id, { id: dbRider.id, role: 'rider', name: dbRider.name, tokenVersion });
         if ((Number(decoded.tv) || 0) !== tokenVersion) {
           return res.status(401).json({ message: 'Your password was changed. Please sign in again.', code: 'SESSION_REVOKED' });
         }
         req.user = { id: dbRider.id, role: 'rider', name: dbRider.name };
         return next();
       }
    }

    const { getUserModel } = require('../models/User');
    const User = getUserModel();
    if (User) {
      const dbUser = await User.findByPk(decoded.id, { attributes: ['id', 'role', 'name', 'phone', 'email', 'hostelBlock', 'roomNumber', 'isActive', 'tokenVersion'] });
      if (!dbUser) return res.status(401).json({ message: 'User not found' });
      if (dbUser.isActive === false) return refuseInactive(res, dbUser.role);
      if ((Number(decoded.tv) || 0) !== (Number(dbUser.tokenVersion) || 0)) {
        return res.status(401).json({ message: 'Your password was changed. Please sign in again.', code: 'SESSION_REVOKED' });
      }
      const userPayload = {
        id: dbUser.id,
        role: dbUser.role || 'student',
        name: dbUser.name,
        phone: dbUser.phone,
        email: dbUser.email,
        hostelBlock: dbUser.hostelBlock,
        roomNumber: dbUser.roomNumber,
        isActive: dbUser.isActive
      };
      // S1: admins: is 2-step sign-in on? (cached with the row; enable / disable clear the cache)
      const tf = require('../services/adminTwoFactor');
      const twoFactorEnabled = String(userPayload.role).toLowerCase() === 'admin' ? await tf.isEnabled(dbUser.id) : false;
      req.user = tf.applyTo(userPayload, decoded, twoFactorEnabled);
      setCachedUser('user', decoded.id, { ...userPayload, tokenVersion: Number(dbUser.tokenVersion) || 0, twoFactorEnabled });
    } else {
      req.user = decoded;
    }
    return next();
  } catch (error) {
    // Only a bad or expired token means "not signed in". A database / pool failure while looking the account up
    // used to answer 401 too, and the apps drop their session on a 401: one slow database moment signed students
    // out (OTP again, favourites and addresses gone, push token detached). Now: 503, try again shortly.
    if (!JWT_ERRORS.includes(error && error.name)) {
      console.error('[AUTH_ERROR] Session check failed (not a token problem):', error && error.message);
      res.set('Retry-After', '2');
      return res.status(503).json({ message: 'Could not check your sign-in right now. Please try again in a moment.', code: 'AUTH_UNAVAILABLE' });
    }
    console.warn('[AUTH_WARN] Token verification failed:', error.message);
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

const admin = (req, res, next) => {
  if (req.user && typeof req.user.role === 'string' && req.user.role.toLowerCase() === 'admin') {
    next();
  } else {
    console.warn(`[SECURITY_WARN] User ${req.user?.id} attempted to access Admin route.`);
    res.status(403).json({ message: 'Forbidden: Admin access required' });
  }
};

const rider = (req, res, next) => {
  if (req.user && typeof req.user.role === 'string' && req.user.role.toLowerCase() === 'rider') {
    next();
  } else {
    console.warn(`[SECURITY_WARN] User ${req.user?.id} attempted to access Rider route.`);
    res.status(403).json({ message: 'Forbidden: Delivery Partner access required' });
  }
};

const vendor = (req, res, next) => {
  const role = req.user?.role;
  if (typeof role === 'string' && (role.toLowerCase() === 'restaurant' || role.toLowerCase() === 'admin')) {
    next();
  } else {
    console.warn(`[SECURITY_WARN] User ${req.user?.id} attempted to access Vendor route.`);
    res.status(403).json({ message: 'Forbidden: Restaurant or Admin access required' });
  }
};

// Rider route that also needs an admin-approved account (self sign-ups get a token before approval).
const approvedRider = async (req, res, next) => {
  if (!(req.user && typeof req.user.role === 'string' && req.user.role.toLowerCase() === 'rider')) {
    return res.status(403).json({ message: 'Forbidden: Delivery Partner access required' });
  }
  try {
    const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
    const partner = await getDeliveryPartnerModel().findByPk(req.user.id, { attributes: ['id', 'isApproved'] });
    if (!partner) return res.status(401).json({ message: 'Rider not found' });
    if (!partner.isApproved) {
      return res.status(403).json({ code: 'RIDER_NOT_APPROVED', message: 'Your account is waiting for admin approval.' });
    }
    return next();
  } catch (err) {
    console.error('[APPROVED_RIDER_ERROR]', err.message);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

/**
 * Optional-auth helper: true only when the request carries a valid token for a LIVE admin
 * account (DB role 'admin', not suspended, current tokenVersion). The JWT role claim alone is
 * never trusted: a demoted or banned admin's 30-day token must not keep admin powers.
 */
const isLiveAdminRequest = async (req) => {
  try {
    let raw = null;
    const h = req.headers && req.headers.authorization;
    if (h && h.startsWith('Bearer ')) raw = h.split(' ')[1];
    else if (req.cookies && req.cookies.token) raw = req.cookies.token;
    if (!raw || !process.env.JWT_SECRET) return false;
    const decoded = jwt.verify(String(raw).replace(/['"]+/g, '').trim(), process.env.JWT_SECRET);
    if (!decoded || !decoded.id) return false;
    const { getUserModel } = require('../models/User');
    const User = getUserModel();
    if (!User) return false;
    const u = await User.findByPk(decoded.id, { attributes: ['id', 'role', 'isActive', 'tokenVersion'] });
    return !!u && String(u.role || '').toLowerCase() === 'admin' && u.isActive !== false
      && (Number(decoded.tv) || 0) === (Number(u.tokenVersion) || 0)
      // S1: and a 2-step session when 2FA is on / required
      && (await require('../services/adminTwoFactor').effectiveRole('admin', decoded, u.id)) === 'admin';
  } catch {
    return false;
  }
};

// S0: student social features (Friends, After Dark chat / rooms, campus Pulse / Whispers / spots / groups,
// campus profile + ID verification) are for customer accounts only. Rider, store and Auto-Ride driver
// tokens get 403 (they used to reach e.g. the contacts lookup that maps phone numbers to students).
const STUDENT_ROLES = new Set(['student', 'admin', 'user', 'customer']);
const studentOnly = (req, res, next) => {
  const role = String((req.user && req.user.role) || '').toLowerCase();
  if (req.user && STUDENT_ROLES.has(role)) return next();
  return res.status(403).json({ code: 'STUDENTS_ONLY', message: 'This part of ZCS is only for student accounts.' });
};

// Claims of the token this request was authenticated with (after protect() verified it). Used by the
// session refresh endpoints to re-check the token's `tv` against a fresh DB read.
const presentedTokenClaims = (req) => {
  let raw = null;
  const h = req.headers && req.headers.authorization;
  if (h && h.startsWith('Bearer') && !h.includes('cookie-managed')) raw = h.split(' ')[1];
  else if (req.cookies && req.cookies.token) raw = req.cookies.token;
  if (!raw) return null;
  try { return jwt.decode(String(raw).replace(/['"]+/g, '').trim()) || null; } catch { return null; }
};

module.exports = { protect, admin, rider, vendor, approvedRider, clearCachedUser, isLiveAdminRequest, studentOnly, STUDENT_ROLES, presentedTokenClaims };
