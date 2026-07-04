const { getOrderModel } = require('../models/Order');
const { getUserModel } = require('../models/User');
const { getRestaurantModel } = require('../models/Restaurant');
const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
const { sendPushToTokens } = require('../utils/push');
const { updateStreak, calculateBadgePerks } = require('../middleware/rewardEngine');
const { getMenuItemModel } = require('../models/MenuItem');
const { sendWhatsAppMessage, formatOrderMessage } = require('../utils/whatsappUtil');
const { calculateCustomizationCost } = require('../utils/pricingSchema');
const { Op } = require('sequelize');

// @desc    Create a new order
// @route   POST /api/orders
const createOrder = async (req, res) => {
  const { restaurantId, items, totalPrice: _totalPrice, deliverySlot, deliveryAddress, coordinates, paymentMethod, upiUTR, upiScreenshot } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ message: 'No order items' });
  }

  // --- Geo-Fencing Validation (40 KM Radius) ---
  const isStandardCampus = deliveryAddress && (
    deliveryAddress.includes('SRM AP') || 
    deliveryAddress.includes('VIT AP') || 
    deliveryAddress.includes('Amrita')
  );

  if (!isStandardCampus && (!coordinates || !coordinates.lat || !coordinates.lng)) {
    return res.status(400).json({ 
      message: 'DELIVERY REJECTED: Coordinates are required for custom locations.' 
    });
  }

  if (coordinates && coordinates.lat && coordinates.lng) {
    const toRad = (value) => (value * Math.PI) / 180;
    const baseLat = 16.4632; // Central Hub Latitude (SRM AP)
    const baseLng = 80.5064; // Central Hub Longitude (SRM AP)
    const R = 6371; // Earth's radius in km
    
    const dLat = toRad(coordinates.lat - baseLat);
    const dLon = toRad(coordinates.lng - baseLng);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(baseLat)) * Math.cos(toRad(coordinates.lat)) * 
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
              
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const calculatedDistanceKm = R * c;
    
    if (calculatedDistanceKm > 40) {
      return res.status(400).json({ 
        message: `DELIVERY REJECTED: Location is ${calculatedDistanceKm.toFixed(1)} km away. Maximum allowed range is 40 km.` 
      });
    }
  }

  try {
    const Restaurant = getRestaurantModel();
    const targetRid = typeof restaurantId === 'object' ? (restaurantId._id || restaurantId.id) : restaurantId;
    const restaurant = await Restaurant.findByPk(targetRid);
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' });
    }

    // ── Dynamic Delivery Fee Calculation ──────────────────────
    let isSurge = false;
    try {
      const serverModule = require('../server');
      if (typeof serverModule.isSurgeActive === 'function') {
        isSurge = serverModule.isSurgeActive(restaurant.zone);
      }
    } catch { /* server module not ready — skip surge */ }

    // ── Dynamic Delivery Fee Calculation ──────────────────────
    const distanceKm = 0;
    const estDuration = 30;
    
    // Delivery fee logic: ₹50 flat for room orders, else ₹30 per unique restaurant
    const isRoomOrder = req.body.isRoomOrder || false;
    const uniqueRestaurantIds = [...new Set(items.map(i => i.restaurantId || restaurantId))];
    const calculatedFee = isRoomOrder ? 50 : (uniqueRestaurantIds.length * 30);

    // ── Multi-Order Batching (Efficiency Engine) ──────────
    const User = getUserModel();
    let currentUser = null;
    try {
      currentUser = await User.findByPk(req.user.id);
    } catch (dbErr) {
      console.error('dbErr on User.findByPk:', dbErr.message);
    }

    // Guard: user must exist in DB (may have been lost after DB reset)
    if (!currentUser) {
      console.warn(`[ORDER_GUARD] Account ID ${req.user.id} not found in database. Stale token detected.`);
      return res.status(401).json({ message: 'Account not found. Please logout and re-register.' });
    }
    const Order = getOrderModel();
    
    // Find active orders from same restaurant to same hostel block
    const batchableOrder = await Order.findOne({
      where: {
        restaurantId,
        status: ['Pending', 'Accepted', 'Preparing']
      },
      include: [{
        model: User,
        as: 'user', 
        where: { hostelBlock: currentUser?.hostelBlock || 'Unknown' }
      }]
    }).catch(() => null);

    let batchDiscount = 0;
    if (batchableOrder) {
      batchDiscount = Math.round(calculatedFee * 0.2); // 20% Batching Discount
      console.log(`[BATCH_ENGINE] Found stackable order ${batchableOrder.id}. Applying ₹${batchDiscount} discount.`);
    }

    // ── Badge Perks Engine (Gourmet Benefits) ──────────
    const perks = calculateBadgePerks(currentUser);
    let perkDiscount = 0;
    
    // Delivery Discount (based on percentage of fee)
    if (perks.deliveryDiscount > 0) {
      perkDiscount += Math.round(calculatedFee * perks.deliveryDiscount);
    }
    
    // Direct Order Discount (Flat)
    if (perks.orderDiscount > 0) {
      perkDiscount += perks.orderDiscount;
    }

    if (perkDiscount > 0) {
      console.log(`[PERKS_ENGINE] Applying ₹${perkDiscount} discount for status: ${perks.status}`);
    }

    // ── Backend Price Validation (Security Guard) ────────────
    const MenuItem = getMenuItemModel();
    
    const dbItemIds = items
      .map(i => i.menuItemId || i.id || i._id)
      .filter(id => typeof id !== 'string' || !id.startsWith('extra-'));
      
    const dbItems = await MenuItem.findAll({ where: { id: dbItemIds } });
    const itemMap = Object.fromEntries(dbItems.map(i => [i.id, i]));
    
    const EXTRA_PRICES = {
      'candles': 15, 'knife': 10, 'gift-wrap': 30, 'plates': 15, 'icecream': 30, 'forks': 10,
      'garlic-bread': 60, 'coke': 40, 'dip-cheese': 20, 'fries': 50, 'chili-flakes': 5, 'napkins': 10,
      'raita': 25, 'salan': 30, 'boiled-egg': 20, 'buttermilk': 25, 'thumbsup': 40, 'onion-salad': 15,
      'cookie': 20, 'muffin': 40, 'sandwich': 60, 'straw': 5, 'gift-box': 50, 'dry-fruits': 80,
      'saffron-milk': 35, 'coleslaw': 25, 'ketchup': 10, 'onion-rings': 45, 'chocolate-sauce': 15,
      'wafer': 20, 'nuts': 20, 'coffee': 30, 'naan': 40, 'salad': 20, 'lemon': 5, 'spring-roll': 50,
      'sweet-corn': 35, 'chili-sauce': 10, 'sambar': 15, 'chutney': 10, 'filter-coffee': 25,
      'curd': 15, 'water': 20, 'lassi': 35
    };

    let backendTotalPrice = 0;
    const validatedItems = [];
    
    for (const i of items) {
      const id = i.menuItemId || i.id || i._id;
      const qty = Math.min(20, Math.max(1, i.quantity || 1));
      
      if (typeof id === 'string' && id.startsWith('extra-')) {
         const extraKey = id.replace('extra-', '');
         const secureExtraPrice = EXTRA_PRICES[extraKey];
         
         if (secureExtraPrice === undefined) {
           return res.status(400).json({ message: `Invalid extra item: ${i.name || 'Unknown'}` });
         }
         
         backendTotalPrice += secureExtraPrice * qty;
         validatedItems.push({
           ...i,
           quantity: qty,
           price: secureExtraPrice,
           basePrice: secureExtraPrice,
           customizations: null,
           name: i.name,
           image: ''
         });
         continue;
      }

      const dbItem = itemMap[id];
      if (!dbItem) {
        return res.status(400).json({ message: `Invalid menu item: ${i.name || 'Unknown'}` });
      }

      if (!dbItem.isAvailable) {
        return res.status(400).json({ message: `Item just went out of stock: ${dbItem.name}` });
      }
      
      const basePrice = dbItem.price;
      const addOnPrice = calculateCustomizationCost(basePrice, dbItem, i.customizations);
      
      // Server-Side Verification: Calculate the true cost
      const secureItemPrice = basePrice + addOnPrice;
      
      // Prevent frontend from sending forged lower prices
      const frontendPrice = i.priceAtOrder || i.price || basePrice;
      if (frontendPrice < secureItemPrice) {
         console.warn(`[SECURITY_WARN] Forged price detected for ${dbItem.name}. Expected: ${secureItemPrice}, Got: ${frontendPrice}`);
         // Force the secure price to prevent revenue loss
      }

      backendTotalPrice += secureItemPrice * qty;
      validatedItems.push({
        ...i,
        quantity: qty,
        price: secureItemPrice,
        basePrice: basePrice,
        customizations: i.customizations,
        name: dbItem.name,
        image: dbItem.image || dbItem.imageUrl
      });
    }

    // ── Coupon Engine (One-Time Rewards) ──────────
    const { couponCode } = req.body;
    let couponDiscount = 0;
    let appliedCoupon = null;

    if (couponCode) {
      const { getCouponModel } = require('../models/Coupon');
      const Coupon = getCouponModel();
      
      // Atomic Coupon Claim to prevent concurrent use
      const [updatedRows] = await Coupon.update(
        { isUsed: true },
        { where: { code: couponCode, userId: req.user.id, isUsed: false } }
      );
      
      if (updatedRows === 0) {
        return res.status(400).json({ message: 'Invalid or already used reward code.' });
      }
      
      appliedCoupon = await Coupon.findOne({ where: { code: couponCode, userId: req.user.id } });
      if (appliedCoupon.type === 'FREEDEL') {
        couponDiscount = calculatedFee; // 100% Delivery discount
      }
    }

    const finalPrice = Math.max(0, backendTotalPrice + (calculatedFee - couponDiscount) - batchDiscount - perkDiscount);

    // ── Wallet Payment Engine (Atomic Deduction) ──────────
    if (paymentMethod === 'Wallet') {
      const User = getUserModel();
      const { getSequelize } = require('../config/db');
      
      // Atomic Update: Prevents negative balances and race conditions
      const [updatedRows] = await User.update(
        { walletBalance: getSequelize().literal(`walletBalance - ${finalPrice}`) },
        { 
          where: { 
            id: req.user.id, 
            walletBalance: { [Op.gte]: finalPrice } 
          } 
        }
      );

      if (updatedRows === 0) {
        // Rollback coupon if wallet fails
        if (appliedCoupon) {
          await appliedCoupon.update({ isUsed: false });
        }
        return res.status(400).json({ 
          message: `Insufficient Wallet Balance. Needed: ₹${finalPrice}.` 
        });
      }
      console.log(`[WALLET_ENGINE] User ${req.user.id} balance deducted securely by ₹${finalPrice}.`);
    }

    let createdOrder;
    try {
      createdOrder = await Order.create({
        userId: req.user.id,
        restaurantId: targetRid,
        items: validatedItems,
        totalPrice: backendTotalPrice,
        deliveryFee: calculatedFee,
        distance: distanceKm,
        estDuration,
        batchDiscount,
        gateDiscount: perkDiscount, // Reusing gateDiscount for Badge Perks
        finalPrice,
        deliverySlot: (deliverySlot || 'ASAP').replace(/[<>]/g, ''), // Basic XSS Sanitization
        deliveryAddress: (deliveryAddress || 'Amaravathi Center').replace(/[<>]/g, ''), // Sanitize Address
        hostelGateDelivery: false,
        isSurge: isSurge,
        paymentMethod,
        upiUTR: paymentMethod === 'UPI' ? upiUTR : null,
        upiScreenshot: paymentMethod === 'UPI' ? upiScreenshot : null,
        upiStatus: paymentMethod === 'UPI' ? 'Pending' : 'Verified', // Default to Verified for COD/Card for now
        status: restaurant.isOffline ? 'Accepted' : 'Pending',
        deliveryPin: Math.floor(1000 + Math.random() * 9000).toString()
      });
    } catch (orderCreateErr) {
      // ── Manual Rollback if Order fails ──────────────────────
      console.error('[ORDER_CREATE_ERROR] Rolling back deductions...', orderCreateErr);
      if (paymentMethod === 'Wallet') {
        const User = getUserModel();
        await User.increment('walletBalance', { by: finalPrice, where: { id: req.user.id } });
      }
      if (appliedCoupon) {
        await appliedCoupon.update({ isUsed: false });
      }
      return res.status(500).json({ message: 'Failed to create order. Deductions rolled back.' });
    }

    try {
      await updateStreak(req.user.id);
      const User = getUserModel();
      const user = await User.findByPk(req.user.id);
      if (user) {
        user.totalOrders = (user.totalOrders || 0) + 1;
        await user.save();
      }
    } catch (statsErr) {
      console.warn('[ORDER_STATS] stats update skipped:', statsErr.message);
    }

    const io = req.app.get('io');
    try {
      const { checkSurgeState } = require('../server');
      if (typeof checkSurgeState === 'function') {
        checkSurgeState(io, restaurant.zone || 'Amaravathi_Central');
      }
    } catch { /* surge check not critical */ }

    // Emit block order pulse for map UI
    try {
      if (currentUser && currentUser.hostelBlock) {
        io.emit('blockOrderPulse', { blockName: currentUser.hostelBlock });
      }
    } catch (e) {
      console.warn('[BLOCK_PULSE_WARN] Socket emit failed:', e.message);
    }

    res.status(201).json({ ...createdOrder.toJSON(), _id: createdOrder.id });

    // ── Universal Dispatch Logic ──────────────────────
    console.log(`[DISPATCH] Broadcasting newOrder event for Order ID: ${createdOrder.id}`);
    
    // 🟢 WhatsApp Integration: Send Confirmation to Customer
    try {
      if (currentUser && currentUser.phone) {
        const orderForMsg = await Order.findByPk(createdOrder.id, { 
          include: [{ model: getRestaurantModel(), as: 'restaurant', attributes: ['name'] }] 
        });
        const msg = formatOrderMessage(orderForMsg, 'CUSTOMER_CONFIRMATION');
        await sendWhatsAppMessage(currentUser.phone, msg, 'CONFIRMATION');
      }
    } catch (waErr) {
      console.error('[WHATSAPP_ERROR] Customer alert failed:', waErr.message);
    }

    // 1. Notify ALL online riders via socket instantly
    io.emit('newOrder', {
      id: createdOrder.id.toString(),
      restaurant: restaurant.name,
      restaurantAddress: restaurant.location,
      customerName: currentUser?.name || 'Customer',
      drop: createdOrder.deliveryAddress,
      items: createdOrder.items,
      totalPrice: createdOrder.totalPrice,
      finalPrice: createdOrder.finalPrice,
      earnings: `₹${createdOrder.deliveryFee}`,
      distance: createdOrder.distance,
      createdAt: createdOrder.createdAt
    });
    
    // 3. Notify Admin Command Terminal
    io.to('admin-room').emit('admin_newOrder', {
      id: createdOrder.id.toString(),
      restaurant: restaurant.name,
      customer: currentUser?.name || 'Customer',
      drop: createdOrder.deliveryAddress,
      totalPrice: createdOrder.totalPrice,
      finalPrice: createdOrder.finalPrice,
      paymentMethod: createdOrder.paymentMethod,
      upiStatus: createdOrder.upiStatus,
      createdAt: createdOrder.createdAt
    });

    // 2. Smart Proximity Dispatch (Targeted Push to Closest Riders)
    try {
      const { getCoordsForAddress, getHaversineDistance } = require('../utils/distance');
      const DeliveryPartner = getDeliveryPartnerModel();
      const onlineRiders = await DeliveryPartner.findAll({ where: { isOnline: true } });
      
      const restaurantCoords = getCoordsForAddress(restaurant.location);
      
      // Calculate distances and sort
      const ridersWithDistance = onlineRiders.map(rider => {
          const riderCoords = rider.lastLocation || { lat: 16.5062, lon: 80.6480 }; // Fallback to center
          const dist = getHaversineDistance(restaurantCoords.lat, restaurantCoords.lon, riderCoords.lat, riderCoords.lon);
          return { rider, dist };
      }).sort((a, b) => a.dist - b.dist);

      // Targeted Push Notifications (Top 5 closest)
      const targetRiders = ridersWithDistance.slice(0, 5);
      const riderTokens = [];
      targetRiders.forEach(({ rider }) => {
        if (rider.fcmTokens) riderTokens.push(...rider.fcmTokens.map(t => t.token));
      });

      if (riderTokens.length > 0) {
        const title = restaurant.isOffline ? '🛒 Offline Shop Order!' : '🛵 New Pending Order!';
        const body = restaurant.isOffline 
          ? `Go buy/pickup at ${restaurant.name} (Closest to you!)`
          : `New order from ${restaurant.name} is waiting for acceptance!`;

        await sendPushToTokens(
          riderTokens, 
          title, 
          body, 
          { orderId: createdOrder.id, distance: createdOrder.distance, type: 'NEW_ORDER' }
        );

        // 🟢 WhatsApp Integration: Targeted Alert to Rider
        try {
          const topRider = targetRiders[0]?.rider;
          if (topRider && topRider.phone) {
             const riderMsg = formatOrderMessage(createdOrder, 'RIDER_ALERT');
             await sendWhatsAppMessage(topRider.phone, riderMsg, 'RIDER_ALERT');
          }
        } catch (waRiderErr) {
          console.error('[WHATSAPP_ERROR] Rider alert failed:', waRiderErr.message);
        }
      }
    } catch (dispatchErr) {
      console.error('[DISPATCH_ERROR]', dispatchErr.message);
    }

    // 3. Optional Restaurant/Admin Portal Updates
    if (!restaurant.isOffline) {
      // Online Shop: Emit to Restaurant Portal
      io.to(`restaurant_${restaurant.id}`).emit('restaurant_newOrder', {
        id: createdOrder.id,
        items: createdOrder.items,
        totalPrice: createdOrder.totalPrice,
        address: createdOrder.deliveryAddress
      });
    }

  } catch (error) {
    console.error('[ORDER_CREATE_ERROR]', error.stack || error);
    const fs = require('fs');
    const path = require('path');
    const logPath = path.join(__dirname, '..', 'socket_debug.txt');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] [ORDER_CREATE_ERROR] Full Error: ${error.stack || error}\n`);
    res.status(400).json({ message: error.message || 'Invalid order data', error: error.message });
  }
};

// @desc    Restaurant/Admin accepts order & dispatches to Rider
const restaurantAcceptOrder = async (req, res) => {
  try {
    const Order = getOrderModel();
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'Pending') return res.status(400).json({ message: 'Order is not pending' });

    const { estDuration } = req.body;
    order.status = 'Accepted';
    if (estDuration) {
      order.estDuration = parseInt(estDuration, 10);
    }
    await order.save();

    const io = req.app.get('io');
    const statusPayload = { 
      id: order.id, 
      status: 'Accepted' 
    };
    io.to(order.id.toString()).emit('statusUpdated', statusPayload);

    // Fetch Restaurant to broadcast details to riders
    const Restaurant = getRestaurantModel();
    let restaurant = await Restaurant.findByPk(order.restaurantId);

    // ── Smart Proximity Dispatch ──────────────────────
    try {
      const { getCoordsForAddress, getHaversineDistance } = require('../utils/distance');
      const DeliveryPartner = getDeliveryPartnerModel();
      const onlineRiders = await DeliveryPartner.findAll({ where: { isOnline: true } });
      
      const restCoords = getCoordsForAddress(restaurant ? restaurant.location : '');
      const ridersWithDist = onlineRiders.map(rider => {
        const riderCoords = rider.lastLocation || { lat: 16.5062, lon: 80.6480 };
        const dist = getHaversineDistance(restCoords.lat, restCoords.lon, riderCoords.lat, riderCoords.lon);
        return { rider, dist };
      }).sort((a, b) => a.dist - b.dist);

      // Notify ALL via socket for real-time race
      io.emit('newOrder', {
        id: order.id,
        restaurant: restaurant ? restaurant.name : 'Unknown',
        restaurantAddress: restaurant ? restaurant.location : '',
        drop: order.deliveryAddress,
        items: order.items,
        totalPrice: order.totalPrice,
        finalPrice: order.finalPrice,
        earnings: `₹${order.deliveryFee}`,
        distance: order.distance
      });

      // Target closest 5 for Push Notifications
      const targetRiders = ridersWithDist.slice(0, 5);
      const riderTokens = [];
      targetRiders.forEach(({ rider }) => {
        if (rider.fcmTokens) riderTokens.push(...rider.fcmTokens.map(t => t.token));
      });

      if (riderTokens.length > 0) {
        await sendPushToTokens(
          riderTokens, 
          '🛵 New Order Ready!', 
          `${restaurant?.name || 'Restaurant'} is ready for pickup. Closest to you!`, 
          { orderId: order.id, distance: order.distance, type: 'NEW_ORDER' }
        );
      }
    } catch (dispatchErr) {
      console.error('[SMART_DISPATCH_ERROR]', dispatchErr.message);
    }

    res.json({ message: 'Order picked up/accepted by restaurant', orderId: order.id });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


// @desc    Get order by ID
const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    // Safe check for UUID format to prevent PostgreSQL 500 errors
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    

    if (!uuidRegex.test(id)) {
       return res.status(404).json({ message: 'Invalid Order ID format' });
    }

    const Order = getOrderModel();
    const Restaurant = getRestaurantModel();
    const DeliveryPartner = getDeliveryPartnerModel();

    const order = await Order.findByPk(id, {
      include: [
        { model: Restaurant, as: 'restaurant', attributes: ['name', 'location', 'imageUrl'] },
        { 
          model: DeliveryPartner, 
          as: 'deliveryPartner', 
          attributes: ['id', 'name', 'phone', 'photoUrl', 'averageRating', 'totalRatings', 'vehicleType', 'vehicleNumber', 'bio'] 
        }
      ]
    });
    if (!order) return res.status(404).json({ message: 'Order not found' });

    // ── IDOR Protection (Access Control Guard) ──────────────────────
    // Ensure the requester is either the owner of the order, an Admin, or the assigned Rider
    const isOwner = order.userId === req.user.id;
    const isAdmin = req.user.role && req.user.role.toLowerCase() === 'admin';
    const isAssignedRider = req.user.role && req.user.role.toLowerCase() === 'rider' && order.deliveryPartnerId === req.user.id;
    
    if (!isOwner && !isAdmin && !isAssignedRider) {
      console.warn(`[SECURITY_WARN] User ${req.user.id} attempted to access Order ${id} without permission.`);
      return res.status(403).json({ message: 'Access denied: You do not have permission to view this order.' });
    }

    const orderData = order.toJSON();
    // Map associations for legacy frontend compatibility (+ _id)
    if (orderData.deliveryPartner) {
        orderData.deliveryPartner._id = orderData.deliveryPartner.id;
    }

    
    // ── Rider Batching Transparency ──────────────────────
    if (order.deliveryPartnerId) {
      const otherOrders = await Order.count({
        where: {
          deliveryPartnerId: order.deliveryPartnerId,
          status: ['Accepted', 'PickedUp', 'Preparing'],
          id: { [Op.ne]: order.id }
        }
      });
      orderData.riderOtherOrders = otherOrders;
    }

    res.json({ ...orderData, _id: order.id });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get logged in user orders
const getMyOrders = async (req, res) => {
  try {
    const Order = getOrderModel();
    const orders = await Order.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
      limit: 50
    });
    res.json(orders.map(o => ({ ...o.toJSON(), _id: o.id })));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Rate an order
const rateOrder = async (req, res) => {
  const { rating, review, tipAmount } = req.body;
  try {
    const Order = getOrderModel();
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.userId !== req.user.id) return res.status(403).json({ message: 'Not authorized' });

    order.rating = rating;
    order.review = review;
    await order.save();

    // ── ZenPoints on Rating (+10 ZP) ──────────────────────
    try {
      const User = getUserModel();
      const user = await User.findByPk(req.user.id);
      if (user) {
        user.zenPoints = (user.zenPoints || 0) + 10;
        await user.save();
      }
    } catch (zpErr) {
      console.warn('[RATING_ZP] ZenPoints award skipped:', zpErr.message);
    }

    // ── Rider Rating Update ──────────────────────
    if (order.deliveryPartnerId) {
      const DeliveryPartner = getDeliveryPartnerModel();
      const partner = await DeliveryPartner.findByPk(order.deliveryPartnerId);
      if (partner) {
        const total = (partner.averageRating || 5) * (partner.totalRatings || 0) + rating;
        const count = (partner.totalRatings || 0) + 1;
        partner.averageRating = parseFloat((total / count).toFixed(1));
        partner.totalRatings = count;

        // ── Rider Tip (F4) ──────────────────────
        const tip = parseFloat(tipAmount) || 0;
        if (tip > 0 && order.deliveryPartnerId) {
          try {
            const User = getUserModel();
            const user = await User.findByPk(req.user.id);
            if (user && (user.walletBalance || 0) >= tip) {
              user.walletBalance = (user.walletBalance || 0) - tip;
              await user.save();
              partner.walletBalance = (partner.walletBalance || 0) + tip;
              console.log(`[TIP] ₹${tip} tipped to rider ${partner.id} from user ${req.user.id}`);
              // Notify rider via socket
              const io = req.app.get('io');
              if (io) {
                io.to(`rider_${partner.id}`).emit('rider_tip_received', {
                  amount: tip,
                  from: user.name || 'A customer',
                  orderId: order.id
                });
              }
            }
          } catch (tipErr) {
            console.warn('[TIP_ERROR] Tip transfer failed:', tipErr.message);
          }
        }

        await partner.save();
      }
    }
    res.json({ message: 'Rating submitted', rating });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


// @desc    Get all orders (Admin)
const getAllOrders = async (req, res) => {
  try {
    const Order = getOrderModel();
    const User = getUserModel();
    const Restaurant = getRestaurantModel();
    const { page = 1, limit = 50, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status && status !== 'All') where.status = status;

    const { count, rows: orders } = await Order.findAndCountAll({ 
      where,
      order: [['createdAt', 'DESC']], 
      limit: parseInt(limit),
      offset: parseInt(offset),
      include: [
        { model: User, as: 'user', attributes: ['name', 'phone'] },
        { model: Restaurant, as: 'restaurant', attributes: ['name'] }
      ]
    });

    res.json({
      orders: orders.map(o => {
        const oJson = o.toJSON();
        return { 
          ...oJson, 
          _id: o.id, 
          userId: oJson.user 
        };
      }),
      total: count,
      pages: Math.ceil(count / limit)
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Cancel an order
const cancelOrder = async (req, res) => {
  try {
    const Order = getOrderModel();
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    // ── Global Sabotage (BOLA/IDOR) Patch ──────────────────────
    const isOwner = order.userId === req.user.id;
    const isAdmin = req.user.role && req.user.role.toLowerCase() === 'admin';
    const isStillPending = order.status === 'Pending';
    
    // Only Owners and Admins can cancel orders. 
    // And Owners can ONLY cancel if it is still Pending (or within 120 seconds).
    if (!isOwner && !isAdmin) {
      console.warn(`[SECURITY_WARN] User ${req.user.id} attempted to cancel Order ${order.id} owned by ${order.userId}`);
      return res.status(403).json({ message: 'Not authorized to cancel this order' });
    }

    // Customer cancellation window: 120 seconds after placement (unless still Pending)
    if (isOwner && !isAdmin && !isStillPending) {
      const elapsed = (Date.now() - new Date(order.createdAt).getTime()) / 1000;
      if (elapsed > 120) {
        return res.status(400).json({ message: 'Cancellation window closed' });
      }
    }

    // ── Infinite Refund Exploit Patch ──────────────────────
    if (order.status === 'Cancelled') {
      console.warn(`[SECURITY_WARN] User ${req.user.id} attempted double-cancel on Order ${order.id}`);
      return res.status(400).json({ message: 'Order is already cancelled' });
    }

    const { reason } = req.body;
    order.status = 'Cancelled';
    if (reason) {
      order.cancellationReason = reason;
    }
    await order.save();

    // ── Refund Logic (Only for Wallet payments) ──────────────────────
    try {
      if (order.paymentMethod === 'Wallet') {
        const User = getUserModel();
        const user = await User.findByPk(order.userId);
        if (user) {
          user.walletBalance = (user.walletBalance || 0) + (order.finalPrice || order.totalPrice);
          await user.save();
          console.log(`[REFUND] ₹${order.finalPrice} refunded to wallet for user ${user.id}`);
        }
      }
    } catch (refundErr) {
      console.error('[REFUND_ERROR]', refundErr.message);
    }

    const io = req.app.get('io');
    const statusPayload = { id: order.id, status: 'Cancelled' };
    io.emit('orderCancelled', { orderId: order.id });
    io.to(order.id.toString()).emit('statusUpdated', statusPayload);

    res.json({ message: 'Order cancelled', orderId: order.id });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update order status (Admin)
// @route   PUT /api/orders/:id/status
const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const allowedStatuses = ['Pending', 'Accepted', 'PickedUp', 'Delivered', 'Cancelled'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` });
    }

    const Order = getOrderModel();
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (status === 'Delivered' && order.status !== 'Delivered') {
      const { evaluateBadges } = require('../services/BadgeService');
      const User = getUserModel();
      const user = await User.findByPk(order.userId);
      if (user) {
        // Award Points (10 pts per 100 spent)
        const pts = Math.floor((order.finalPrice || order.totalPrice) / 100) * 10;
        user.zenPoints = (user.zenPoints || 0) + pts;
        user.completedOrders = (user.completedOrders || 0) + 1;

        // Achievements Logic
        const hour = new Date().getHours();
        if (hour >= 22 || hour < 4) {
          user.lateNightOrders = (user.lateNightOrders || 0) + 1;
        }

        const newBadges = evaluateBadges(user);
        if (newBadges.length > 0) {
          const currentBadges = Array.isArray(user.badges) ? [...user.badges] : [];
          user.badges = [...currentBadges, ...newBadges];
        }
        await user.save();

        // Pass new badges to status update event
        order.newBadges = newBadges;
      }
    }

    order.status = status;
    await order.save();

    const io = req.app.get('io');
    const statusPayload = { 
      id: order.id, 
      status,
      newBadges: status === 'Delivered' ? (order.newBadges || []) : []
    };
    io.to(order.id.toString()).emit('statusUpdated', statusPayload);

    // 🟢 WhatsApp Integration: Status Update to Customer
    try {
      const User = getUserModel();
      const user = await User.findByPk(order.userId);
      if (user && user.phone) {
        const orderWithRest = await Order.findByPk(order.id, { 
          include: [{ model: getRestaurantModel(), as: 'restaurant', attributes: ['name'] }] 
        });
        const msg = formatOrderMessage(orderWithRest, 'STATUS_UPDATE');
        await sendWhatsAppMessage(user.phone, msg, 'STATUS_UPDATE');
      }
    } catch (waStatusErr) {
      console.error('[WHATSAPP_ERROR] Status update alert failed:', waStatusErr.message);
    }

    res.json({ message: 'Order status updated', orderId: order.id, status });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getSurgeStatus = async (req, res) => {
  const { isSurgeActive, SURGE_MULTIPLIER } = require('../server');
  res.json({ isSurge: isSurgeActive(), multiplier: SURGE_MULTIPLIER });
};

// @desc    Get spending stats for logged-in user (F12 - Spending Dashboard)
// @route   GET /api/orders/stats
const getOrderStats = async (req, res) => {
  try {
    const Order = getOrderModel();
    const User = getUserModel();

    const orders = await Order.findAll({
      where: { userId: req.user.id, status: 'Delivered' },
      order: [['createdAt', 'DESC']],
      limit: 200
    });

    const user = await User.findByPk(req.user.id, {
      attributes: ['streakCount', 'completedOrders', 'zenPoints']
    });

    // Monthly spend (last 6 months)
    const monthlyMap = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleString('default', { month: 'short', year: 'numeric' });
      monthlyMap[key] = 0;
    }
    orders.forEach(o => {
      const d = new Date(o.createdAt);
      const key = d.toLocaleString('default', { month: 'short', year: 'numeric' });
      if (monthlyMap[key] !== undefined) {
        monthlyMap[key] += (o.finalPrice || o.totalPrice || 0);
      }
    });
    const monthlySpend = Object.entries(monthlyMap).map(([month, total]) => ({ month, total: Math.round(total) }));

    // Top items
    const itemMap = {};
    orders.forEach(o => {
      const items = Array.isArray(o.items) ? o.items : [];
      items.forEach(item => {
        const name = item.name || 'Unknown';
        if (!itemMap[name]) itemMap[name] = { name, count: 0, spend: 0 };
        itemMap[name].count += (item.quantity || 1);
        itemMap[name].spend += (item.priceAtOrder || item.price || 0) * (item.quantity || 1);
      });
    });
    const topItems = Object.values(itemMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(i => ({ ...i, spend: Math.round(i.spend) }));

    const totalSpend = orders.reduce((s, o) => s + (o.finalPrice || o.totalPrice || 0), 0);
    const avgOrderValue = orders.length > 0 ? Math.round(totalSpend / orders.length) : 0;

    // Favourite restaurant by order count
    const restMap = {};
    orders.forEach(o => {
      if (o.restaurantId) {
        restMap[o.restaurantId] = (restMap[o.restaurantId] || 0) + 1;
      }
    });
    const topRestId = Object.entries(restMap).sort((a, b) => b[1] - a[1])[0]?.[0];
    let favoriteRestaurant = 'N/A';
    if (topRestId) {
      const Restaurant = getRestaurantModel();
      const rest = await Restaurant.findByPk(topRestId, { attributes: ['name'] });
      if (rest) favoriteRestaurant = rest.name;
    }

    res.json({
      monthlySpend,
      topItems,
      avgOrderValue,
      totalOrders: orders.length,
      favoriteRestaurant,
      currentStreak: user?.streakCount || 0,
      zenPoints: user?.zenPoints || 0
    });
  } catch (error) {
    console.error('[ORDER_STATS_ERROR]', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


const verifyUPIPayment = async (req, res) => {
  const { isVerified } = req.body; // boolean
  try {
    const Order = getOrderModel();
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.paymentMethod !== 'UPI') return res.status(400).json({ message: 'Not a UPI order' });

    if (isVerified) {
      order.upiStatus = 'Verified';
      order.paymentStatus = 'Completed';
      // Auto-accept if it was pending
      if (order.status === 'Pending') {
        order.status = 'Accepted';
      }
    } else {
      order.upiStatus = 'Rejected';
      order.status = 'Cancelled';
    }
    
    await order.save();
    
    const io = req.app.get('io');
    const statusPayload = { id: order.id, status: order.status };
    io.to(order.id.toString()).emit('statusUpdated', statusPayload);

    res.json({ message: `Payment ${isVerified ? 'Verified' : 'Rejected'}`, orderId: order.id, status: order.status });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Restaurant marks food as ready for pickup
const restaurantReadyOrder = async (req, res) => {
  try {
    const Order = getOrderModel();
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'Accepted' && order.status !== 'Preparing') {
       return res.status(400).json({ message: 'Order must be Accepted or Preparing to mark as Ready' });
    }

    order.status = 'ReadyForPickup';
    await order.save();

    const io = req.app.get('io');
    const statusPayload = { id: order.id, status: 'ReadyForPickup' };
    io.to(order.id.toString()).emit('statusUpdated', statusPayload);

    // Also notify the delivery partner if assigned
    if (order.deliveryPartnerId) {
      io.to(`rider_${order.deliveryPartnerId}`).emit('orderReady', { orderId: order.id });
    }

    res.json({ message: 'Order marked as Ready for Pickup', orderId: order.id });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = { createOrder, getOrderById, getMyOrders, rateOrder, getAllOrders, cancelOrder, updateOrderStatus, getSurgeStatus, restaurantAcceptOrder, verifyUPIPayment, restaurantReadyOrder, getOrderStats };
