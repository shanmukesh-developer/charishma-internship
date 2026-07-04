const jwt = require('jsonwebtoken');

const protect = async (req, res, next) => {
  let token = req.cookies?.token;

  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
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
    
    if (decoded.role === 'restaurant') {
       const { getRestaurantModel } = require('../models/Restaurant');
       const Restaurant = getRestaurantModel();
       if (Restaurant) {
         const dbRest = await Restaurant.findByPk(decoded.id);
         if (!dbRest) return res.status(401).json({ message: 'Restaurant not found' });
         req.user = { id: dbRest.id, role: 'restaurant', name: dbRest.name };
         return next();
       }
    }
    
    if (decoded.role === 'rider') {
       const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
       const DeliveryPartner = getDeliveryPartnerModel();
       if (DeliveryPartner) {
         const dbRider = await DeliveryPartner.findByPk(decoded.id);
         if (!dbRider) return res.status(401).json({ message: 'Rider not found' });
         req.user = { id: dbRider.id, role: 'rider', name: dbRider.name };
         return next();
       }
    }

    const { getUserModel } = require('../models/User');
    const User = getUserModel();
    if (User) {
      const dbUser = await User.findByPk(decoded.id);
      if (!dbUser) return res.status(401).json({ message: 'User not found' });
      if (dbUser.isActive === false) return res.status(403).json({ message: 'Account suspended. Please contact support.' });
      req.user = dbUser;
    } else {
      req.user = decoded;
    }
    return next();
  } catch (error) {
    console.warn('[AUTH_WARN] Token verification failed:', error.message);
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

const admin = (req, res, next) => {
  if (req.user && req.user.role && req.user.role.toLowerCase() === 'admin') {
    next();
  } else {
    console.warn(`[SECURITY_WARN] User ${req.user.id} attempted to access Admin route.`);
    res.status(403).json({ message: 'Forbidden: Admin access required' });
  }
};

const rider = (req, res, next) => {
  if (req.user && req.user.role && req.user.role.toLowerCase() === 'rider') {
    next();
  } else {
    console.warn(`[SECURITY_WARN] User ${req.user.id} attempted to access Rider route.`);
    res.status(403).json({ message: 'Forbidden: Delivery Partner access required' });
  }
};

const vendor = (req, res, next) => {
  const role = req.user?.role?.toLowerCase();
  if (role === 'restaurant' || role === 'admin') {
    next();
  } else {
    console.warn(`[SECURITY_WARN] User ${req.user.id} attempted to access Vendor route.`);
    res.status(403).json({ message: 'Forbidden: Restaurant or Admin access required' });
  }
};

module.exports = { protect, admin, rider, vendor };
