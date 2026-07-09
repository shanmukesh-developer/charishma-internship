const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
const { getOrderModel } = require('../models/Order');
const { getUserModel } = require('../models/User');
const { getRestaurantModel } = require('../models/Restaurant');
const { sendPushToTokens } = require('../utils/push');
const { evaluateBadges } = require('../services/BadgeService');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { sendWhatsAppMessage } = require('../utils/whatsappUtil');

const { normalizePhone } = require('../utils/phoneUtils');

const generateToken = (id) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[AUTH_FATAL] JWT_SECRET is not configured.');
    return null; // The calling logic should handle this gracefully
  }
  return jwt.sign({ id, role: 'rider' }, secret, { expiresIn: '30d' });
};

// @desc    Register a new delivery partner (requires Firebase phone verification)
const registerPartner = async (req, res) => {
  const { name, phone, password, vehicleType } = req.body;

  try {
    const cleanPhone = normalizePhone(phone);

    // ── 1. Create partner ────────────────────────────────────────────────
    const DeliveryPartner = getDeliveryPartnerModel();
    const partnerExists = await DeliveryPartner.findOne({ where: { phone: cleanPhone } });
    if (partnerExists) return res.status(400).json({ message: 'Partner already exists' });

    const partner = await DeliveryPartner.create({ name, phone: cleanPhone, password, vehicleType });
    const token = generateToken(partner.id);
    
    // Check if request is made by an Admin to avoid overwriting their session cookie
    let skipCookie = false;
    let authHeader = req.headers.authorization;
    let tokenToCheck = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      tokenToCheck = authHeader.split(' ')[1].replace(/['"]+/g, '').trim();
    } else if (req.cookies?.token) {
      tokenToCheck = req.cookies.token.replace(/['"]+/g, '').trim();
    }

    if (tokenToCheck) {
      try {
        const decoded = jwt.verify(tokenToCheck, process.env.JWT_SECRET);
        if (decoded.role === 'admin') {
          skipCookie = true;
        } else {
          const { getUserModel } = require('../models/User');
          const User = getUserModel();
          if (User) {
            const dbUser = await User.findByPk(decoded.id);
            if (dbUser && dbUser.role && dbUser.role.toLowerCase() === 'admin') {
              skipCookie = true;
            }
          }
        }
      } catch (err) {}
    }

    if (!skipCookie) {
      res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 30 * 24 * 60 * 60 * 1000 });
    }
    res.status(201).json({ _id: partner.id, name: partner.name, token });
  } catch (error) {
    console.error('[PARTNER_REGISTER_ERROR]', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


// @desc    Auth partner & get token
const authPartner = async (req, res) => {
  const { phone, password } = req.body;

  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const cleanPhone = normalizePhone(phone);
    console.log(`[AUTH_PATH] Attempting login for phone: "${phone}" -> cleaned: "${cleanPhone}"`);

    const partner = await DeliveryPartner.findOne({ where: { phone: cleanPhone } });
    if (!partner) {
      console.log(`[AUTH_PATH] No partner found with phone: ${cleanPhone}`);
      return res.status(401).json({ message: 'Invalid phone or password' });
    }

    const isMatch = await partner.comparePassword(password);
    console.log(`[AUTH_PATH] Partner found. Password match: ${isMatch}`);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid phone or password' });
    }

    // ── 3. Return partner data and JWT token ────────────────────────────────
    const token = generateToken(partner.id);
    res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 30 * 24 * 60 * 60 * 1000 });

    // ── Streak Computation (IST) ───────────────────────────────────────
    const nowUtc = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const todayIST = new Date(nowUtc.getTime() + istOffset).toISOString().slice(0, 10);
    const lastLogin = partner.lastLoginDate ? String(partner.lastLoginDate) : null;

    if (lastLogin !== todayIST) {
      const yesterdayIST = new Date(nowUtc.getTime() + istOffset - 86400000).toISOString().slice(0, 10);
      if (lastLogin === yesterdayIST) {
        partner.loginStreak = (partner.loginStreak || 0) + 1;
      } else if (lastLogin === null || lastLogin < yesterdayIST) {
        partner.loginStreak = 1; // reset — missed a day
      }
      partner.lastLoginDate = todayIST;
      await partner.save();
    }
    // ─────────────────────────────────────────────────────────────────

    res.json({ 
      _id: partner.id, 
      name: partner.name, 
      phone: partner.phone,
      vehicleType: partner.vehicleType,
      isApproved: partner.isApproved,
      isAvailable: partner.isAvailable,
      walletBalance: partner.walletBalance,
      zenPoints: partner.zenPoints,
      completedDeliveries: partner.completedDeliveries,
      rating: partner.rating,
      loginStreak: partner.loginStreak || 1,
      token 
    });
  } catch (error) {
    console.error('[PARTNER_AUTH_ERROR]', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Accept an order
const acceptOrder = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const Order = getOrderModel();
    const partner = await DeliveryPartner.findByPk(req.user.id);
    if (!partner) return res.status(401).json({ message: 'Rider account not found' });
    if (!partner.isApproved) {
      return res.status(403).json({ message: 'Your account is pending verification by the logistics admin.' });
    }
    
    // 2. Atomic Claim: Use a conditional update to prevent race conditions (Rider A vs Rider B)
    const [updatedRows] = await Order.update(
      { deliveryPartnerId: req.user.id },
      { where: { id: req.params.orderId, deliveryPartnerId: null, status: { [Op.in]: ['Accepted', 'Preparing', 'ReadyForPickup'] } } }
    );

    if (updatedRows === 0) {
      return res.status(400).json({ message: 'Order was already claimed by another rider or cancelled.' });
    }

    // Since we successfully updated, we fetch the updated order object
    const updatedOrder = await Order.findByPk(req.params.orderId);
    
    // (Status advancement is strictly controlled by the Restaurant Portal until picked up)
    
    if (partner) { 
      partner.currentOrderId = updatedOrder.id; 
      await partner.save(); 
    }

    const io = req.app.get('io');
    io.to(updatedOrder.id.toString()).emit('statusUpdated', { id: updatedOrder.id, status: 'Accepted' });

    try {
      const User = getUserModel();
      const Restaurant = getRestaurantModel();
      const customer = await User.findByPk(updatedOrder.userId);
      const restaurant = await Restaurant.findByPk(updatedOrder.restaurantId);

      res.json({
        id: updatedOrder.id,
        restaurant: restaurant?.name || 'Restaurant',
        restaurantAddress: restaurant?.location || 'Station Alpha',
        restaurantPhone: restaurant?.whatsappNumber || '',
        customerName: customer?.name || 'Customer',
        customerPhone: customer?.phone || 'Hidden',
        drop: updatedOrder.deliveryAddress || (updatedOrder.hostelGateDelivery ? `${customer?.hostelBlock || 'Hostel'} (Gate)` : `${customer?.hostelBlock || 'Hostel'} (Room)`),
        items: updatedOrder.items,
        totalPrice: updatedOrder.totalPrice,
        finalPrice: updatedOrder.finalPrice,
        earnings: '₹30'
      });

      if (customer?.fcmTokens?.length > 0) {
        await sendPushToTokens(customer.fcmTokens, 'Order Accepted! 🛵', 'Your Zenvy rider is on the way.', { orderId: updatedOrder.id, type: 'ORDER_UPDATE' });
      }
    } catch (e) {
      console.error('[ACCEPT_ORDER_ERROR]', e);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Server error', error: e.message });
      }
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get all pending orders
const getPendingOrders = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.user.id);
    if (!partner) return res.status(401).json({ message: 'Rider account not found' });
    if (!partner.isApproved) {
      return res.status(403).json({ message: 'Your account is pending verification by the logistics admin.' });
    }

    const Order = getOrderModel();
    const User = getUserModel();
    const Restaurant = getRestaurantModel();
    const orders = await Order.findAll({ 
      where: { 
        status: { [Op.in]: ['Accepted', 'Preparing', 'ReadyForPickup'] },
        deliveryPartnerId: null
      }, 
      order: [['createdAt', 'DESC']],
      limit: 100
    });

    const userIds = [...new Set(orders.map(o => o.userId))];
    const restIds = [...new Set(orders.map(o => o.restaurantId))];
    
    const [users, restaurants] = await Promise.all([
      User.findAll({ where: { id: userIds } }),
      Restaurant.findAll({ where: { id: restIds } })
    ]);

    const userMap = Object.fromEntries(users.map(u => [u.id, u]));
    const restMap = Object.fromEntries(restaurants.map(r => [r.id, r]));

    const enrichedOrders = orders.map(order => {
      const restaurant = restMap[order.restaurantId];
      const customer = userMap[order.userId];
      return {
        id: order.id,
        restaurant: restaurant?.name || 'Restaurant',
        restaurantAddress: restaurant?.location || 'Location',
        customerName: customer?.name || 'Customer',
        customerPhone: customer?.phone || 'Hidden',
        drop: order.deliveryAddress || (order.hostelGateDelivery ? `${customer?.hostelBlock || 'Block'} (Gate)` : `${customer?.hostelBlock || 'Block'} (Room)`),
        items: order.items,
        totalPrice: order.totalPrice,
        finalPrice: order.finalPrice,
        earnings: '₹30',
        createdAt: order.createdAt
      };
    });

    res.json(enrichedOrders);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get order history
const getOrderHistory = async (req, res) => {
  try {
    const Order = getOrderModel();
    const Restaurant = getRestaurantModel();
    // Remove 24-hour filter to allow full history visibility across sessions
    const orders = await Order.findAll({
      where: { deliveryPartnerId: req.user.id, status: 'Delivered' },
      order: [['updatedAt', 'DESC']],
      limit: 100 // Increased limit for better history visibility
    });

    const restIds = [...new Set(orders.map(o => o.restaurantId))];
    const restaurants = await Restaurant.findAll({ where: { id: restIds } });
    const restMap = Object.fromEntries(restaurants.map(r => [r.id, r]));

    const enrichedOrders = orders.map(order => {
      const restaurant = restMap[order.restaurantId];
      return {
        id: order.id,
        restaurant: restaurant?.name || 'Restaurant',
        drop: order.deliveryAddress || (order.hostelGateDelivery ? 'Hostel Gate' : 'Room Delivery'),
        items: order.items,
        totalPrice: order.totalPrice,
        finalPrice: order.finalPrice,
        earnings: '₹30',
        deliveredAt: order.updatedAt
      };
    });

    res.json(enrichedOrders);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update order status
const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['PickedUp', 'Delivered'];
    if (!validStatuses.includes(status)) return res.status(400).json({ message: 'Invalid status' });

    const Order = getOrderModel();
    const order = await Order.findByPk(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.deliveryPartnerId !== req.user.id) return res.status(403).json({ message: 'Unauthorized' });

    if (status === 'PickedUp' && !['Accepted', 'Preparing', 'ReadyForPickup'].includes(order.status)) {
      return res.status(400).json({ message: 'Order must be Accepted or Ready by restaurant first' });
    }
    if (status === 'Delivered' && order.status !== 'PickedUp') {
      return res.status(400).json({ message: 'Must be PickedUp first' });
    }

    // ── Delivery PIN Validation ──────────────────────
    if (status === 'Delivered') {
      const { pin } = req.body;
      // Only enforce PIN check when the order actually has one set
      if (order.deliveryPin && order.deliveryPin.length > 0) {
        if (!pin || pin !== order.deliveryPin) {
          return res.status(400).json({ message: 'Invalid delivery PIN' });
        }
      }
    }

    order.status = status;
    await order.save();

    if (status === 'Delivered') {
      const earnings = 30; // Flat ₹30 per delivery
      const DeliveryPartner = getDeliveryPartnerModel();
      const User = getUserModel();
      const partner = await DeliveryPartner.findByPk(req.user.id);
      if (partner) {
        partner.currentOrderId = null;
        partner.totalEarnings = (partner.totalEarnings || 0) + earnings;
        partner.zenPoints = (partner.zenPoints || 0) + 5;
        await partner.save();
      }
      const customer = await User.findByPk(order.userId);
      if (customer) {
        const pts = Math.floor((order.finalPrice || order.totalPrice) / 100) * 10;
        customer.zenPoints = (customer.zenPoints || 0) + pts;
        customer.completedOrders = (customer.completedOrders || 0) + 1;
        
        // --- Achievements Logic (Multi-tier) ---
        const utcDate = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istDate = new Date(utcDate.getTime() + istOffset);
        const hour = istDate.getUTCHours();
        if (hour >= 22 || hour < 4) {
          customer.lateNightOrders = (customer.lateNightOrders || 0) + 1;
        }

        const newBadges = evaluateBadges(customer);
        if (newBadges.length > 0) {
          const currentBadges = Array.isArray(customer.badges) ? [...customer.badges] : [];
          customer.badges = [...currentBadges, ...newBadges];
          
          for (const badge of newBadges) {
            await sendPushToTokens(
              customer.fcmTokens,
              'New Achievement Unlocked! 🏆',
              `Congratulations! You've earned the "${badge}" badge.`
            );
          }
        }

        // Store for socket emission
        order.newBadges = newBadges;

        // --- Milestone Notifications ---
        if (customer.completedOrders % 2 === 0) {
          await sendPushToTokens(
            customer.fcmTokens,
            'Milestone Reached! 🎡',
            `You just completed your ${customer.completedOrders}th order! A Lucky Spin is waiting for you in the Vault.`
          );
        }
        await customer.save();
      }
    }

    const io = req.app.get('io');
    io.to(order.id.toString()).emit('statusUpdated', { 
      id: order.id,
      status: status,
      newBadges: status === 'Delivered' ? (order.newBadges || []) : [] 
    });
    res.json({ ...order.toJSON(), _id: order.id });

    try {
      const User = getUserModel();
      const customer = await User.findByPk(order.userId);
      if (customer?.fcmTokens?.length > 0) {
        const titles = { PickedUp: 'Order Picked Up! 🛵', Delivered: 'Order Delivered! 🎉' };
        const bodies = { PickedUp: 'Rider is on the way!', Delivered: 'Enjoy your meal!' };
        await sendPushToTokens(customer.fcmTokens, titles[status], bodies[status], { orderId: order.id, type: 'ORDER_UPDATE' });
      }
    } catch (e) {
      console.warn('[PUSH_NOTIFY_WARN] Failed to send update:', e.message);
    }
  } catch (error) {
    console.error('[DELIVERY_UPDATE_ERROR]', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Rider emergency-cancels an assigned order
const cancelOrderByRider = async (req, res) => {
  try {
    const Order = getOrderModel();
    const DeliveryPartner = getDeliveryPartnerModel();

    const order = await Order.findByPk(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.deliveryPartnerId !== req.user.id) return res.status(403).json({ message: 'Not your order' });
    if (!['Accepted', 'PickedUp'].includes(order.status)) {
      return res.status(400).json({ message: 'Cannot cancel at this stage' });
    }

    // Unassign rider & reset order to Pending so another rider can claim it
    order.deliveryPartnerId = null;
    order.status = 'Pending';
    await order.save();

    // Clear rider's current task
    const partner = await DeliveryPartner.findByPk(req.user.id);
    if (partner) {
      partner.currentOrderId = null;
      await partner.save();
    }

    const io = req.app.get('io');
    // Notify customer tracking page
    io.to(order.id.toString()).emit('statusUpdated', { id: order.id, status: 'Pending' });
    // Notify admin
    io.to('admin-room').emit('order_unassigned', { orderId: order.id, reason: 'Rider emergency cancel' });
    // Re-broadcast as new pending so other riders can pick it up
    io.emit('newOrder', { ...order.toJSON(), id: order.id, _id: order.id });

    res.json({ message: 'Order cancelled by rider. Reassigning...' });
  } catch (error) {
    console.error('[RIDER_CANCEL_ERROR]', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Toggle online status
const toggleOnline = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.user.id);
    if (!partner) return res.status(401).json({ message: 'Rider account not found' });
    if (!partner.isApproved) {
      return res.status(403).json({ message: 'Your account is pending verification by the logistics admin.' });
    }
    partner.isOnline = req.body.isOnline;
    await partner.save();
    res.json({ isOnline: req.body.isOnline });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Save FCM Token for partner
const saveFcmToken = async (req, res) => {
  const { fcmToken, appVersion } = req.body;
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.user.id);
    if (partner) {
      const tokens = partner.fcmTokens || [];
      const idx = tokens.findIndex(t => t.appVersion === appVersion);
      if (idx > -1) tokens[idx].token = fcmToken; else tokens.push({ token: fcmToken, appVersion });
      partner.fcmTokens = tokens;
      partner.changed('fcmTokens', true);
      await partner.save();
      res.json({ message: 'FCM Token saved' });
    } else {
      res.status(404).json({ message: 'Partner not found' });
    }
  } catch {
    res.status(500).json({ message: 'Failed to save token' });
  }
};

// @desc    Get all active orders for the logged in partner
const getActiveOrders = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.user.id);
    if (!partner) return res.status(401).json({ message: 'Rider account not found' });
    if (!partner.isApproved) {
      return res.status(403).json({ message: 'Your account is pending verification by the logistics admin.' });
    }

    const Order = getOrderModel();
    const User = getUserModel();
    const Restaurant = getRestaurantModel();
    
    const orders = await Order.findAll({
      where: { 
        deliveryPartnerId: req.user.id,
        status: ['Accepted', 'PickedUp', 'Preparing']
      },
      order: [['createdAt', 'ASC']]
    });

    const userIds = [...new Set(orders.map(o => o.userId))];
    const restIds = [...new Set(orders.map(o => o.restaurantId))];
    
    const [users, restaurants] = await Promise.all([
      User.findAll({ where: { id: userIds } }),
      Restaurant.findAll({ where: { id: restIds } })
    ]);

    const userMap = Object.fromEntries(users.map(u => [u.id, u]));
    const restMap = Object.fromEntries(restaurants.map(r => [r.id, r]));

    const enrichedOrders = orders.map(order => {
      const restaurant = restMap[order.restaurantId];
      const customer = userMap[order.userId];
      return {
        id: order.id,
        restaurant: restaurant?.name || 'Nexus Hub',
        restaurantAddress: restaurant?.location || 'Amaravathi Hub',
        restaurantPhone: restaurant?.whatsappNumber || '',
        customerName: customer?.name || 'Verified Customer',
        customerPhone: customer?.phone || 'Identity Protected',
        drop: order.deliveryAddress || (order.hostelGateDelivery ? `${customer?.hostelBlock || 'Block'} (Gate)` : `${customer?.hostelBlock || 'Block'} (Room)`),
        items: order.items,
        totalPrice: order.totalPrice,
        finalPrice: order.finalPrice,
        status: order.status,
        deliveryPin: order.deliveryPin,
        earnings: '₹30',
        createdAt: order.createdAt
      };
    });

    // ── Task Sequencing Logic ──────────────────────
    const tasks = [];
    // 1. Pickups first (for all orders in 'Accepted' or 'Preparing')
    enrichedOrders.filter(o => ['Accepted', 'Preparing'].includes(o.status)).forEach(o => {
      tasks.push({ type: 'PICKUP', orderId: o.id, location: o.restaurant, address: o.restaurantAddress });
    });
    // 2. Deliveries next (for all orders in 'PickedUp')
    enrichedOrders.filter(o => o.status === 'PickedUp').forEach(o => {
      tasks.push({ type: 'DELIVERY', orderId: o.id, location: o.customerName, address: o.drop });
    });

    res.json({ orders: enrichedOrders, taskSequence: tasks });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get today's leaderboard (top riders by earnings)
const getLeaderboard = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const Order = getOrderModel();
    const { Op } = require('sequelize');
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

    const deliveries = await Order.findAll({
      where: {
        status: 'Delivered',
        updatedAt: { [Op.gte]: startOfDay },
        deliveryPartnerId: { [Op.ne]: null }
      },
      attributes: ['deliveryPartnerId', 'finalPrice', 'totalPrice']
    });

    const earningsMap = {};
    const countMap = {};
    for (const d of deliveries) {
      const pid = d.deliveryPartnerId;
      const e = 30; // Flat ₹30 per delivery
      earningsMap[pid] = (earningsMap[pid] || 0) + e;
      countMap[pid] = (countMap[pid] || 0) + 1;
    }

    const partnerIds = Object.keys(earningsMap);
    if (partnerIds.length === 0) return res.json([]);

    const partners = await DeliveryPartner.findAll({
      where: { id: partnerIds },
      attributes: ['id', 'name']
    });

    const board = partners.map(p => ({
      id: p.id,
      name: p.name,
      earnings: earningsMap[p.id] || 0,
      orders: countMap[p.id] || 0,
      isMe: p.id === req.user.id
    })).sort((a, b) => b.earnings - a.earnings).slice(0, 10);

    res.json(board);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get rider's own profile
const getRiderProfile = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.user.id, {
      attributes: { exclude: ['password', 'fcmTokens'] }
    });
    if (!partner) return res.status(401).json({ message: 'Rider account not found (Nexus Session Expired)' });
    res.json({ ...partner.toJSON(), _id: partner.id });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get today's stats for current rider
const getTodayStats = async (req, res) => {
  try {
    const Order = getOrderModel();
    const { Op } = require('sequelize');
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const orders = await Order.findAll({
      where: {
        deliveryPartnerId: req.user.id,
        status: 'Delivered',
        updatedAt: { [Op.gte]: startOfDay }
      }
    });

    const earnings = orders.length * 30; // Flat ₹30 per delivery
    const count = orders.length;
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.user.id, { attributes: ['loginStreak'] });
    res.json({ earnings, orders: count, zenPoints: count * 5, streak: partner?.loginStreak || 1 });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update rider's own profile
const updateRiderProfile = async (req, res) => {
  try {
    const { name, vehicleType, vehicleNumber, bio, emergencyContact, photoUrl } = req.body;
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.user.id);
    if (!partner) return res.status(401).json({ message: 'Rider account not found (Nexus Session Expired)' });

    if (name) partner.name = name;
    if (vehicleType !== undefined) partner.vehicleType = vehicleType;
    if (vehicleNumber !== undefined) partner.vehicleNumber = vehicleNumber;
    if (bio !== undefined) partner.bio = bio;
    if (emergencyContact !== undefined) partner.emergencyContact = emergencyContact;
    if (photoUrl !== undefined) partner.photoUrl = photoUrl;

    await partner.save();

    // Broadcast updated profile to admin room for monitoring
    const io = req.app.get('io');
    const updatePayload = {
      riderId: partner.id,
      name: partner.name,
      photoUrl: partner.photoUrl,
      vehicleType: partner.vehicleType,
      vehicleNumber: partner.vehicleNumber,
      averageRating: partner.averageRating
    };
    io.to('admin-room').emit('rider_profile_updated', updatePayload);

    // Also broadcast to all active orders for this rider so customers see live updates
    const Order = getOrderModel();
    const activeOrders = await Order.findAll({
      where: {
        deliveryPartnerId: partner.id,
        status: ['Accepted', 'PickedUp', 'Preparing']
      },
      attributes: ['id']
    });
    
    activeOrders.forEach(order => {
      io.to(order.id.toString()).emit('rider_profile_updated', updatePayload);
    });

    res.json({ ...partner.toJSON(), _id: partner.id });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get public profile of a rider (customer tracking page, no auth)
const getPublicRiderProfile = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.params.id, {
      attributes: ['id', 'name', 'photoUrl', 'vehicleType', 'vehicleNumber', 'averageRating', 'totalRatings', 'bio']
    });
    if (!partner) return res.status(404).json({ message: 'Rider not found' });
    res.json({ ...partner.toJSON(), _id: partner.id });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Change rider's own password
const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  try {
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.user.id);
    if (!partner) {
      return res.status(404).json({ message: 'Rider account not found' });
    }
    const isMatch = await partner.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid current password' });
    }
    partner.password = newPassword;
    await partner.save();
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Notify arrival at gate
const notifyArrivalAtGate = async (req, res) => {
  try {
    const Order = getOrderModel();
    const User = getUserModel();
    const order = await Order.findByPk(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.deliveryPartnerId !== req.user.id) return res.status(403).json({ message: 'Unauthorized' });

    // Send push notification to the customer
    try {
      const customer = await User.findByPk(order.userId);
      if (customer && customer.fcmTokens && customer.fcmTokens.length > 0) {
        await sendPushToTokens(
          customer.fcmTokens,
          'Rider Arrived at Gate! 🛎️',
          'Your rider is waiting at the hostel gate. Please collect your order.',
          { orderId: order.id, type: 'GATE_ARRIVAL' }
        );
      }
    } catch (e) {
      console.warn('[PUSH_NOTIFY_WARN] Failed to send gate arrival update:', e.message);
    }

    // Send WhatsApp notification
    try {
      const customer = await User.findByPk(order.userId);
      if (customer && customer.phone) {
        await sendWhatsAppMessage(
          customer.phone,
          `🛎️ *Rider Arrived at Gate!*\n\nYour Zenvy rider is waiting at your hostel gate. Please collect your order.\n\n📍 *Tracking:* ${process.env.FRONTEND_URL || 'https://zenvy.app'}/orders/${order.id}`,
          'GATE_ARRIVAL'
        );
      }
    } catch (e) {
      console.warn('[WHATSAPP_NOTIFY_WARN] Failed to send WhatsApp gate arrival update:', e.message);
    }

    // Emit socket event to the order room
    const io = req.app.get('io');
    io.to(order.id.toString()).emit('driverAtGate', {
      message: 'Your rider is waiting at the hostel gate!'
    });

    res.json({ message: 'Gate arrival notification sent successfully' });
  } catch (error) {
    console.error('[GATE_ARRIVAL_ERROR]', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = { 
  registerPartner, authPartner, acceptOrder, getPendingOrders, getActiveOrders, 
  updateOrderStatus, toggleOnline, getOrderHistory, saveFcmToken, getLeaderboard,
  getRiderProfile, updateRiderProfile, getPublicRiderProfile, getTodayStats,
  cancelOrderByRider, changePassword, notifyArrivalAtGate
};
