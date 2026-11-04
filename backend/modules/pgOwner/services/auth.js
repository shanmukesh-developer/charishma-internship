// ZCS PG Partner sessions: same JWT secret as the rest of ZCS, role 'pg_owner', `tv` = PgOwner.tokenVersion
// (a password change, admin reset or suspension bumps it and old sessions stop working).
// protect() (customers / admins) refuses these tokens (middleware/authMiddleware.js), and protectOwner never
// accepts a customer / admin / partner token (role must be pg_owner and the PgOwner row must exist).
const jwt = require('jsonwebtoken');
const { getModel } = require('../index');
const { fail, sendError } = require('./util');
const { OWNER_STATUS } = require('../models');

const ROLE = 'pg_owner';
const TTL = /^\d+[smhd]$/.test(String(process.env.PG_OWNER_SESSION_TTL || '')) ? process.env.PG_OWNER_SESSION_TTL : '30d';

const signOwnerToken = (owner) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw fail(500, 'SERVER_CONFIG', 'Server configuration error. Please try again later.');
  return jwt.sign({ id: owner.id, role: ROLE, tv: Number(owner.tokenVersion) || 0 }, secret, { expiresIn: TTL });
};

const readToken = (req) => {
  const h = String((req.headers && req.headers.authorization) || '');
  if (h.startsWith('Bearer ')) return h.slice(7).replace(/['"]+/g, '').trim();
  return null;
};

const suspendedError = (owner) => fail(403, 'PG_OWNER_SUSPENDED', owner.suspendedReason
  ? `Your ZENV PG Partner account is suspended: ${owner.suspendedReason}`
  : 'Your ZENV PG Partner account is suspended. Please contact ZENV support.');

/** Express middleware: live, non-suspended PgOwner behind a current token. Sets req.owner. */
const protectOwner = async (req, res, next) => {
  try {
    const token = readToken(req);
    if (!token) throw fail(401, 'NOT_AUTHORISED', 'Please sign in to the ZENV PG Partner app.');
    const secret = process.env.JWT_SECRET;
    if (!secret) throw fail(500, 'SERVER_CONFIG', 'Server configuration error. Please try again later.');
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch {
      throw fail(401, 'NOT_AUTHORISED', 'Your session has expired. Please sign in again.');
    }
    if (!decoded || decoded.role !== ROLE || !decoded.id) throw fail(401, 'NOT_AUTHORISED', 'Please sign in with your PG owner account.');
    const Owner = getModel('PgOwner');
    const owner = Owner ? await Owner.findByPk(decoded.id) : null;
    if (!owner) throw fail(401, 'NOT_AUTHORISED', 'PG owner account not found.');
    if ((Number(decoded.tv) || 0) !== (Number(owner.tokenVersion) || 0)) {
      throw fail(401, 'SESSION_REVOKED', 'Your password was changed. Please sign in again.');
    }
    if (owner.status === OWNER_STATUS.SUSPENDED) throw suspendedError(owner);
    req.owner = owner;
    req.user = { id: owner.id, role: ROLE, name: owner.name };
    return next();
  } catch (err) {
    return sendError(res, err, 'PG_OWNER_AUTH');
  }
};

/** After protectOwner: the temporary password from the admin must be replaced before anything else. */
const requirePasswordChanged = (req, res, next) => {
  if (req.owner && req.owner.mustChangePassword) {
    return sendError(res, fail(403, 'PASSWORD_CHANGE_REQUIRED', 'Please set your own password first (Settings > Change password).'), 'PG_OWNER_AUTH');
  }
  return next();
};

module.exports = { ROLE, signOwnerToken, protectOwner, requirePasswordChanged, suspendedError };
