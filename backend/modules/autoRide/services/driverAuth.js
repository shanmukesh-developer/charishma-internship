// Zenvy Auto Driver sessions: same JWT secret as the rest of Zenvy, role 'auto_driver', `tv` =
// AutoDriver.tokenVersion (a password change / admin sign-out bumps it and old sessions stop working).
// protect() (customers) never accepts these tokens (no User row), and protectDriver never accepts a
// customer / admin / rider token (role must be auto_driver and the AutoDriver row must exist).
const jwt = require('jsonwebtoken');
const { getModel } = require('../index');
const { fail, sendError } = require('./util');
const { DRIVER_STATUS } = require('../enums');

const ROLE = 'auto_driver';
const TTL = /^\d+[smhd]$/.test(String(process.env.AUTO_DRIVER_SESSION_TTL || '')) ? process.env.AUTO_DRIVER_SESSION_TTL : '30d';

const signDriverToken = (driver) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw fail(500, 'SERVER_CONFIG', 'Server configuration error. Please try again later.');
  return jwt.sign({ id: driver.id, role: ROLE, tv: Number(driver.tokenVersion) || 0 }, secret, { expiresIn: TTL });
};

const readToken = (req) => {
  const h = String((req.headers && req.headers.authorization) || '');
  if (h.startsWith('Bearer ')) return h.slice(7).replace(/['"]+/g, '').trim();
  return null;
};

/** Express middleware: live, non-suspended AutoDriver behind a current token. Sets req.driver. */
const protectDriver = async (req, res, next) => {
  try {
    const token = readToken(req);
    if (!token) throw fail(401, 'NOT_AUTHORISED', 'Please sign in to the ZCS Auto Driver app.');
    const secret = process.env.JWT_SECRET;
    if (!secret) throw fail(500, 'SERVER_CONFIG', 'Server configuration error. Please try again later.');
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch {
      throw fail(401, 'NOT_AUTHORISED', 'Your session has expired. Please sign in again.');
    }
    if (!decoded || decoded.role !== ROLE || !decoded.id) throw fail(401, 'NOT_AUTHORISED', 'Please sign in with your driver account.');
    const Driver = getModel('AutoDriver');
    const driver = Driver ? await Driver.findByPk(decoded.id) : null;
    if (!driver) throw fail(401, 'NOT_AUTHORISED', 'Driver account not found.');
    if ((Number(decoded.tv) || 0) !== (Number(driver.tokenVersion) || 0)) {
      throw fail(401, 'SESSION_REVOKED', 'Your password was changed. Please sign in again.');
    }
    if (driver.status === DRIVER_STATUS.SUSPENDED) {
      throw fail(403, 'DRIVER_SUSPENDED', driver.suspendedReason ? `Your driver account is suspended: ${driver.suspendedReason}` : 'Your driver account is suspended. Please contact ZCS support.');
    }
    req.driver = driver;
    req.user = { id: driver.id, role: ROLE, name: driver.name };
    return next();
  } catch (err) {
    return sendError(res, err, 'AUTORIDE_DRIVER_AUTH');
  }
};

module.exports = { ROLE, signDriverToken, protectDriver };
