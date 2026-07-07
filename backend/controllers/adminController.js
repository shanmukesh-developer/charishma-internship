const { getRestaurantModel } = require('../models/Restaurant');
const { getMenuItemModel } = require('../models/MenuItem');
const { getUserModel } = require('../models/User');
const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
const { getOrderModel } = require('../models/Order');
const { getVaultItemModel } = require('../models/VaultItem');
const { getGlobalConfigModel } = require('../models/GlobalConfig');
const { getVerificationLogModel } = require('../models/VerificationLog');
const { Op } = require('sequelize');

let cachedRestaurantsResponse = null;
const clearRestaurantsCache = () => {
  cachedRestaurantsResponse = null;
};

const broadcastSystemUpdate = (req, type, data) => {
  const io = req.app.get('io');
  if (io) io.emit('systemUpdate', { type, data });
};

exports.getSystemHealth = async (req, res) => {
  try {
    const { getSequelize } = require('../config/db');
    const sequelize = getSequelize();
    const dialect = sequelize.getDialect();
    res.json({
      database: dialect.toUpperCase(),
      persistence: dialect === 'postgres' ? 'PERSISTENT' : 'VOLATILE',
      timestamp: new Date()
    });
  } catch (error) {
    res.status(500).json({ message: 'Health Check Failed' });
  }
};

const logAuditAction = async (req, targetId, action, details) => {
  try {
    const VerificationLog = getVerificationLogModel();
    await VerificationLog.create({
      adminId: req.user?.id ? req.user.id.toString() : 'admin_default',
      targetId: targetId ? targetId.toString() : 'global',
      action,
      details: typeof details === 'string' ? details : JSON.stringify(details),
    });
  } catch (error) {
    console.error('[AUDIT_LOG_ERROR]', error);
  }
};

// ─── Public Endpoints ─────────────────────────────────────────
exports.getRestaurants = async (req, res) => {
  try {
    if (cachedRestaurantsResponse) {
      return res.json(cachedRestaurantsResponse);
    }

    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    const { Op } = require('sequelize');

    // Batch-fetch all restaurants and their menu items in 2 queries (eliminates N+1)
    const restaurants = await Restaurant.findAll({ where: { isActive: true } });
    const restaurantIds = restaurants.map(r => r.id);

    const allMenuItems = restaurantIds.length > 0
      ? await MenuItem.findAll({ where: { restaurantId: { [Op.in]: restaurantIds } } })
      : [];

    // Index menu items by restaurantId for O(1) lookup
    const menuByRestaurant = {};
    for (const m of allMenuItems) {
      const mObj = m.toJSON();
      let mTags = mObj.tags || [];
      if (typeof mTags === 'string') {
        try { mTags = JSON.parse(mTags); } catch { mTags = []; }
      }
      const item = { ...mObj, tags: mTags, _id: m.id, id: m.id, image: mObj.imageUrl || mObj.image };
      if (!menuByRestaurant[m.restaurantId]) menuByRestaurant[m.restaurantId] = [];
      menuByRestaurant[m.restaurantId].push(item);
    }

    const result = restaurants.map(r => {
      const rObj = r.toJSON();
      let tags = rObj.tags || [];
      if (typeof tags === 'string') {
        try { tags = JSON.parse(tags); } catch { tags = []; }
      }
      return {
        ...rObj,
        _id: r.id,
        id: r.id,
        tags,
        categories: tags,
        // Map deliveryTime (integer minutes) to time string for frontend compatibility
        time: rObj.deliveryTime ? `${rObj.deliveryTime} min` : (rObj.time || '30-50 min'),
        menu: menuByRestaurant[r.id] || []
      };
    });

    cachedRestaurantsResponse = result;
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getRestaurantById = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    const restaurant = await Restaurant.findByPk(req.params.id);
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' });
    const menu = await MenuItem.findAll({ where: { restaurantId: restaurant.id } });
    const resObj = restaurant.toJSON();
    let tags = resObj.tags || [];
    if (typeof tags === 'string') {
      try { tags = JSON.parse(tags); } catch { tags = []; }
    }

    res.json({ 
      ...resObj, 
      _id: restaurant.id, 
      id: restaurant.id,
      tags,
      categories: tags,
      time: resObj.deliveryTime ? `${resObj.deliveryTime} min` : (resObj.time || '30-50 min'),
      menu: menu.map(m => {
        const mObj = m.toJSON();
        let mTags = mObj.tags || [];
        if (typeof mTags === 'string') {
          try { mTags = JSON.parse(mTags); } catch { mTags = []; }
        }
        return { ...mObj, tags: mTags, _id: m.id, id: m.id, image: mObj.imageUrl || mObj.image };
      })
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getMenuItemById = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();
    const Restaurant = getRestaurantModel();
    const VaultItem = getVaultItemModel();
    
    let item = await MenuItem.findByPk(req.params.id);
    let restaurant;

    if (!item) {
      // Fallback: Check VaultItem if MenuItem not found
      item = await VaultItem.findByPk(req.params.id);
      if (!item) return res.status(404).json({ message: 'Product not found (Nexus Error: 404)' });
      
      const itemObj = item.toJSON();
      return res.json({ 
        ...itemObj, 
        _id: item.id, 
        id: item.id, 
        image: itemObj.imageUrl || itemObj.image,
        restaurantName: 'Zenvy Exclusive Vault', 
        restaurantId: 'vault_prime' 
      });
    }

    restaurant = await Restaurant.findByPk(item.restaurantId);
    const itemObj = item.toJSON();
    let tags = itemObj.tags || [];
    if (typeof tags === 'string') {
      try { tags = JSON.parse(tags); } catch { tags = []; }
    }
    res.json({ 
      ...itemObj, 
      _id: item.id, 
      id: item.id, 
      tags,
      image: itemObj.imageUrl || itemObj.image,
      restaurantName: restaurant?.name || 'Zenvy Kitchen', 
      restaurantId: restaurant?.id 
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.searchAll = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ restaurants: [], items: [] });
    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();

    const matchedRestaurants = await Restaurant.findAll({
      where: {
        name: { [Op.iLike]: `%${q}%` },
        isActive: true
      }
    });

    const matchedItems = await MenuItem.findAll({
      where: {
        [Op.or]: [
          { name: { [Op.iLike]: `%${q}%` } },
          { category: { [Op.iLike]: `%${q}%` } }
        ],
        isAvailable: true
      }
    });

    res.json({
      restaurants: matchedRestaurants.map(r => ({ ...r.toJSON(), _id: r.id })),
      items: matchedItems.map(m => ({ ...m.toJSON(), _id: m.id }))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─── Restaurant & Menu Control ────────────────────────────────
exports.getAllRestaurants = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const restaurants = await Restaurant.findAll();
    res.json(restaurants.map(r => ({ ...r.toJSON(), _id: r.id })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getAllMenuItems = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();
    const where = req.query.restaurantId ? { restaurantId: req.query.restaurantId } : {};
    const items = await MenuItem.findAll({ where });
    res.json(items.map(i => ({ ...i.toJSON(), _id: i.id })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createRestaurant = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const data = { ...req.body };
    delete data._id; // Ensure we don't try to insert a custom string ID into UUID field
    const restaurant = await Restaurant.create(data);
    clearRestaurantsCache();
    broadcastSystemUpdate(req, 'RESTAURANT_CREATED', restaurant);
    await logAuditAction(req, restaurant.id, 'CREATE_RESTAURANT', { name: restaurant.name });
    res.status(201).json({ ...restaurant.toJSON(), _id: restaurant.id });
  } catch (error) {
    console.error('[CREATE_REST_ERROR]', error);
    res.status(400).json({ message: error.message });
  }
};

exports.updateRestaurant = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const restaurant = await Restaurant.findByPk(req.params.id);
    if (!restaurant) return res.status(404).json({ message: 'Not found' });
    await restaurant.update(req.body);
    clearRestaurantsCache();
    broadcastSystemUpdate(req, 'RESTAURANT_UPDATED', restaurant);
    await logAuditAction(req, restaurant.id, 'UPDATE_RESTAURANT', { name: restaurant.name });
    res.json({ ...restaurant.toJSON(), _id: restaurant.id });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.upsertMenuItem = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();
    const { id } = req.params;
    let menuItem;
    if (id && id !== 'new') {
      menuItem = await MenuItem.findByPk(id);
      if (menuItem) await menuItem.update(req.body);
      else menuItem = await MenuItem.create(req.body);
    } else {
      menuItem = await MenuItem.create(req.body);
    }
    clearRestaurantsCache();
    broadcastSystemUpdate(req, 'MENU_UPDATED', menuItem);
    const io = req.app.get('io');
    if (io) {
      io.emit('inventory_updated', { itemId: menuItem.id, isAvailable: menuItem.isAvailable });
    }
    await logAuditAction(req, menuItem.id, 'UPSERT_MENU_ITEM', { name: menuItem.name });
    res.json({ ...menuItem.toJSON(), _id: menuItem.id });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.deleteMenuItem = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();
    const item = await MenuItem.findByPk(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    await item.destroy();
    clearRestaurantsCache();
    broadcastSystemUpdate(req, 'MENU_ITEM_DELETED', { id: req.params.id });
    await logAuditAction(req, req.params.id, 'DELETE_MENU_ITEM', { id: req.params.id });
    res.json({ message: 'Menu item deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─── Fleet Management ──────────────────────────────────────────
exports.getAllRiders = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows: riders } = await DeliveryPartner.findAndCountAll({ 
      attributes: { exclude: ['password'] },
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    res.json({
      riders: riders.map(r => ({ ...r.toJSON(), _id: r.id })),
      total: count,
      pages: Math.ceil(count / limit)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.approveRider = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const rider = await DeliveryPartner.findByPk(req.params.id);
    if (!rider) return res.status(404).json({ message: 'Rider not found' });
    await rider.update({ isApproved: req.body.isApproved });
    broadcastSystemUpdate(req, 'RIDER_STATUS_CHANGED', { id: req.params.id, isApproved: req.body.isApproved });
    res.json({ ...rider.toJSON(), _id: rider.id });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.resetRiderSos = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const rider = await DeliveryPartner.findByPk(req.params.id);
    if (!rider) return res.status(404).json({ message: 'Rider not found' });
    await rider.update({ isSosActive: false });
    broadcastSystemUpdate(req, 'RIDER_SOS_RESET', { id: req.params.id });
    await logAuditAction(req, rider.id, 'FLEET_SOS_RESET', { name: rider.name });
    res.json({ message: 'SOS reset successful' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateRider = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const rider = await DeliveryPartner.findByPk(req.params.id);
    if (!rider) return res.status(404).json({ message: 'Rider not found' });
    await rider.update(req.body);
    broadcastSystemUpdate(req, 'RIDER_UPDATED', rider);
    res.json({ ...rider.toJSON(), _id: rider.id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─── User & Elite Tiering ──────────────────────────────────────
exports.getAllUsers = async (req, res) => {
  try {
    const User = getUserModel();
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows: users } = await User.findAndCountAll({ 
      attributes: { exclude: ['password'] },
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    res.json({
      users: users.map(u => ({ ...u.toJSON(), _id: u.id })),
      total: count,
      pages: Math.ceil(count / limit)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.setEliteStatus = async (req, res) => {
  try {
    const User = getUserModel();
    const user = await User.findByPk(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    await user.update({ isElite: req.body.isElite });
    broadcastSystemUpdate(req, 'USER_ELITE_STATUS', { userId: req.params.userId, isElite: req.body.isElite });
    await logAuditAction(req, user.id, 'ELITE_STATUS_CHANGE', { email: user.email, isElite: req.body.isElite });
    res.json({ ...user.toJSON(), _id: user.id });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.updateUserWallet = async (req, res) => {
  try {
    const User = getUserModel();
    const { amount } = req.body;
    const user = await User.findByPk(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    const newBalance = (user.walletBalance || 0) + Number(amount);
    await user.update({ walletBalance: newBalance });
    
    await logAuditAction(req, user.id, 'WALLET_UPDATE', { email: user.email, added: amount, newBalance });
    broadcastSystemUpdate(req, 'USER_UPDATED', { userId: user.id, walletBalance: newBalance });
    
    res.json({ message: 'Wallet updated', walletBalance: newBalance });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getAuditLogs = async (req, res) => {
  try {
    const VerificationLog = getVerificationLogModel();
    const { page = 1, limit = 100 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows: logs } = await VerificationLog.findAndCountAll({ 
      order: [['timestamp', 'DESC']], 
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      logs: logs.map(l => ({ ...l.toJSON(), _id: l.id })),
      total: count,
      pages: Math.ceil(count / limit)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateGlobalConfig = async (req, res) => {
  try {
    const GlobalConfig = getGlobalConfigModel();
    const { key, value, description } = req.body;
    const [_config, created] = await GlobalConfig.upsert({ key, value, description });
    broadcastSystemUpdate(req, 'GLOBAL_CONFIG_UPDATED', { key, value });
    res.json({ key, value, description, created });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.getGlobalConfig = async (req, res) => {
  try {
    const GlobalConfig = getGlobalConfigModel();
    const configs = await GlobalConfig.findAll();
    res.json(configs.map(c => ({ ...c.toJSON(), _id: c.id })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─── Dashboard Stats ──────────────────────────────────────────
exports.getDashboardStats = async (req, res) => {
  try {
    const Order = getOrderModel();
    const DeliveryPartner = getDeliveryPartnerModel();
    const Restaurant = getRestaurantModel();
    
    // Optimized single-pass aggregation
    const [totalOrders, activeFleet, localVendorCount] = await Promise.all([
      Order.count(),
      DeliveryPartner.count({ where: { isApproved: true } }),
      Restaurant.count({ where: { vendorType: 'LOCAL_VENDOR', isActive: true } })
    ]);

    const deliveredStats = await Order.findAll({
      where: { status: 'Delivered' },
      attributes: [[require('sequelize').fn('SUM', require('sequelize').col('totalPrice')), 'revenue']]
    });

    const activeOrdersList = await Order.findAll({
      where: { status: { [Op.notIn]: ['Delivered', 'Cancelled'] } },
      attributes: ['totalPrice']
    });

    const totalRevenue = Number(deliveredStats[0]?.dataValues.revenue || 0);
    const activeRevenue = activeOrdersList.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
    const activeOrdersCount = activeOrdersList.length;

    res.json({
      revenue: `₹${totalRevenue.toLocaleString()}`,
      activeRevenue: `₹${activeRevenue.toLocaleString()}`,
      orderActivity: totalOrders.toString(),
      activeFleet: activeFleet.toString(),
      commission: `₹${Math.round(totalRevenue * 0.1).toLocaleString()}`,
      activeOrders: activeOrdersCount.toString(),
      localVendorCount: localVendorCount.toString()
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getFinanceReport = async (req, res) => {
  try {
    const Order = getOrderModel();
    const Restaurant = getRestaurantModel();
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Get total stats (non-paginated)
    const allDelivered = await Order.findAll({ 
      where: { status: 'Delivered' },
      attributes: ['totalPrice', 'finalPrice', 'restaurantId', 'deliveryFee']
    });

    const restaurants = await Restaurant.findAll();
    const restaurantMap = restaurants.reduce((acc, r) => ({ ...acc, [r.id]: r }), {});

    const totalRevenue = allDelivered.reduce((s, o) => s + (o.finalPrice || o.totalPrice), 0);
    const totalDeliveryFees = allDelivered.reduce((s, o) => s + (o.deliveryFee || 30), 0);
    const totalCommission = allDelivered.reduce((s, o) => {
      const rest = restaurantMap[o.restaurantId];
      return s + ((o.finalPrice || o.totalPrice) * ((rest?.commissionRate || 10) / 100));
    }, 0);

    // Get paginated transactions
    const { count, rows: orders } = await Order.findAndCountAll({
      where: { status: 'Delivered' },
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const transactions = orders.map(order => {
      const restaurant = restaurantMap[order.restaurantId] || { commissionRate: 10, name: 'Zenvy Kitchen' };
      const itemPrice = order.finalPrice || order.totalPrice;
      const commission = itemPrice * ((restaurant.commissionRate || 10) / 100);
      return {
        _id: order.id,
        orderId: order.id.slice(-6),
        restaurantName: restaurant.name,
        totalAmount: itemPrice,
        commissionEarned: Math.round(commission),
        deliveryFee: order.deliveryFee || 30,
        timestamp: order.createdAt
      };
    });

    res.json({
      transactions,
      totalRevenue: Math.round(totalRevenue),
      totalCommission: Math.round(totalCommission),
      totalDeliveryFees: Math.round(totalDeliveryFees),
      total: count,
      pages: Math.ceil(count / limit)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─── Seed Database ─────────────────────────────────────────────
exports.seedDatabase = async (req, res) => {
  try {
    clearRestaurantsCache();
    let { restaurants } = req.body;
    
    if (!restaurants || !Array.isArray(restaurants) || restaurants.length === 0) {
      // Default cinematic collection
      restaurants = [
        {
          "name": "Biryani Hub",
          "location": "Amaravathi Central",
          "imageUrl": "https://images.unsplash.com/photo-1589302168068-964664d93dc0?q=80&w=400&auto=format&fit=crop",
          "categories": ["Biryani", "Kebabs"],
          "vendorType": "RESTAURANT",
          "menu": [
            { "name": "Special Mutton Fry", "price": 280, "description": "Tender goat cooked in traditional spices.", "image": "https://images.unsplash.com/photo-1514327605112-b887c0e61c0a?w=400", "category": "Biryani" },
            { "name": "Hyderabadi Dum Biryani", "price": 250, "description": "Classic slow-cooked chicken biryani.", "image": "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=400", "category": "Biryani" }
          ]
        },
        {
          "name": "The Burger Club",
          "location": "SRM North",
          "imageUrl": "https://images.unsplash.com/photo-1571091718767-18b5b1457add?q=80&w=400",
          "categories": ["Burgers", "Shakes"],
          "vendorType": "RESTAURANT",
          "menu": [
            { "name": "Classic Cheeseburger", "price": 150, "description": "Juicy patty with melted cheddar.", "image": "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400", "category": "Burgers" }
          ]
        },
        {
          "name": "Nezumi Sushi",
          "location": "Amaravathi East",
          "imageUrl": "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?q=80&w=400",
          "categories": ["Sushi", "Japanese"],
          "vendorType": "RESTAURANT",
          "menu": [
            { "name": "Salmon Nigiri", "price": 450, "description": "Fresh salmon on vinegared rice.", "image": "https://images.unsplash.com/photo-1583623025817-d180a2221d0a?w=400", "category": "Sushi" }
          ]
        }
      ];
    }

    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();

    console.log(`[SEED] Processing ${restaurants.length} nodes...`);

    for (const restData of restaurants) {
      // Use UPSERT by name to avoid foreign key violations with Orders
      // PostgreSQL requires a unique constraint for true upsert, 
      // but we'll do 1: Find/Delete-Item or 2: Generic Create
      
      let restaurant = await Restaurant.findOne({ where: { name: restData.name } });
      
      if (!restaurant) {
        restaurant = await Restaurant.create({
          name: restData.name,
          location: restData.location || 'Main Campus',
          imageUrl: restData.imageUrl || restData.image,
          vendorType: restData.vendorType || 'RESTAURANT',
          commissionRate: restData.commissionRate || 10,
          commissionType: restData.commissionType || 'percentage',
          operatingHours: restData.operatingHours || { start: '09:00', end: '22:00' },
          isActive: restData.isActive !== undefined ? restData.isActive : true,
          tags: restData.categories || restData.tags || []
        });
      } else {
        // Update existing to refresh images/tags
        await restaurant.update({
          imageUrl: restData.imageUrl || restData.image,
          vendorType: restData.vendorType || 'RESTAURANT',
          tags: restData.categories || restData.tags || []
        });
      }

      if (restData.menu && Array.isArray(restData.menu)) {
        // Clear items only for THIS restaurant to preserve DB integrity
        await MenuItem.destroy({ where: { restaurantId: restaurant.id } });

        const vendorTagMap = {
          'PHARMACY': ['pharmacy', 'medicine'],
          'STATIONARY': ['stationary', 'books'],
          'LAUNDRY': ['laundry', 'dry-wash'],
          'GYM': ['gym', 'high-protein', 'healthy'],
          'DRINKS': ['drinks'],
          'SEASONAL': ['seasonal'],
          'RENTAL': ['rental'],
          'GROCERY': ['fruits', 'healthy'],
          'SWEETS': ['sweets'],
          'RESTAURANT': [],
          'GLOBAL_MARKET': []
        };
        const vendorTags = vendorTagMap[restData.vendorType] || [];

        for (const item of restData.menu) {
          const itemTags = [...new Set([
            ...vendorTags,
            ...(item.tags || []),
            ...(item.category ? [item.category.toLowerCase()] : [])
          ])];
          await MenuItem.create({
            restaurantId: restaurant.id,
            name: item.name,
            price: item.price,
            description: item.description,
            imageUrl: item.image || item.imageUrl,
            category: item.category,
            tags: itemTags,
            isAvailable: true,
            isEliteOnly: false
          });
        }
      }
    }

    broadcastSystemUpdate(req, 'DATABASE_SEEDED', { count: restaurants.length });
    res.json({ message: `Successfully synchronized ${restaurants.length} restaurants.` });
  } catch (error) {
    console.error('[SEED_ERROR]', error);
    res.status(500).json({ message: `Database Sync failed: ${error.message}` });
  }
};

// ─── Zenvy Vault Control (Stubs for PostgreSQL) ─────────────────
exports.getVaultItems = async (req, res) => {
  try {
    const VaultItem = getVaultItemModel();
    const items = await VaultItem.findAll();
    res.json(items.map(i => ({ ...i.toJSON(), _id: i.id })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.upsertVaultItem = async (req, res) => {
  try {
    const VaultItem = getVaultItemModel();
    const { id } = req.params;
    const updateData = { ...req.body };
    delete updateData._id;
    delete updateData.id;

    let item;
    if (id && id !== 'new') {
      item = await VaultItem.findByPk(id);
      if (item) await item.update(updateData);
      else item = await VaultItem.create({ ...updateData, id });
    } else {
      item = await VaultItem.create(updateData);
    }
    broadcastSystemUpdate(req, 'VAULT_UPDATED', item);

    res.json({ ...item.toJSON(), _id: item.id });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.deleteVaultItem = async (req, res) => {
  try {
    const VaultItem = getVaultItemModel();
    await VaultItem.destroy({ where: { id: req.params.id } });
    broadcastSystemUpdate(req, 'VAULT_DELETED', { id: req.params.id });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─── Gamification & Rewards Analytics ──────────────────────────

exports.getRewardsAnalytics = async (req, res) => {
  try {
    const User = getUserModel();
    const users = await User.findAll({ 
      where: { role: 'student' },
      attributes: ['completedOrders', 'spinsUsed', 'badges', 'name', 'zenPoints']
    });

    let totalSpinsEarned = 0;
    let totalSpinsUsed = 0;
    let totalZenPoints = 0;
    const badgeCounts = {};
    const tiers = { Elite: 0, Diamond: 0, Platinum: 0, Gold: 0, Silver: 0, Bronze: 0, None: 0 };
    
    const topPerformers = users
      .map(u => {
        const uJson = u.toJSON();
        const earned = Math.floor((uJson.completedOrders || 0) / 5);
        totalSpinsEarned += earned;
        totalSpinsUsed += (uJson.spinsUsed || 0);
        totalZenPoints += (uJson.zenPoints || 0);
        
        const badges = Array.isArray(uJson.badges) ? uJson.badges : (typeof uJson.badges === 'string' ? JSON.parse(uJson.badges) : []);
        badges.forEach(b => {
          badgeCounts[b] = (badgeCounts[b] || 0) + 1;
        });

        // Tier classification based on highest badge held
        let userTier = 'None';
        if (badges.some(b => b.includes('Elite'))) userTier = 'Elite';
        else if (badges.some(b => b.includes('Diamond'))) userTier = 'Diamond';
        else if (badges.some(b => b.includes('Platinum'))) userTier = 'Platinum';
        else if (badges.some(b => b.includes('Gold'))) userTier = 'Gold';
        else if (badges.some(b => b.includes('Silver'))) userTier = 'Silver';
        else if (badges.some(b => b.includes('Bronze'))) userTier = 'Bronze';
        
        tiers[userTier]++;

        return {
          name: uJson.name,
          completedOrders: uJson.completedOrders,
          badgesCount: badges.length,
          zenPoints: uJson.zenPoints || 0,
          tier: userTier
        };
      })
      .sort((a, b) => b.completedOrders - a.completedOrders)
      .slice(0, 5);

    res.json({
      totalSpinsEarned,
      totalSpinsUsed,
      totalZenPoints,
      activeRewardUsers: users.filter(u => u.completedOrders > 0).length,
      badgeDistribution: badgeCounts,
      tierDistribution: tiers,
      topPerformers,
      redemptionRate: totalSpinsEarned > 0 ? (totalSpinsUsed / totalSpinsEarned * 100).toFixed(1) : 0
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
exports.deleteRestaurant = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    const id = req.params.id;
    
    const restaurant = await Restaurant.findByPk(id);
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' });
    
    // Cleanup items
    await MenuItem.destroy({ where: { restaurantId: id } });
    await restaurant.destroy();
    clearRestaurantsCache();
    
    broadcastSystemUpdate(req, 'RESTAURANT_DELETED', { id });
    logAuditAction(req, id, 'RESTAURANT_DELETE', `Deleted restaurant "${restaurant.name}"`);
    
    res.json({ message: 'Restaurant successfully removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getOrderVolumeStats = async (req, res) => {
  try {
    const Order = getOrderModel();
    const { getSequelize } = require('../config/db');
    const sequelize = getSequelize();
    
    // Fetch last 12 hours of order counts
    const stats = await Order.findAll({
      attributes: [
        [sequelize.fn('date_trunc', 'hour', sequelize.col('createdAt')), 'hour'],
        [sequelize.fn('count', sequelize.col('id')), 'count']
      ],
      where: {
        createdAt: { [Op.gte]: new Date(Date.now() - 12 * 60 * 60 * 1000) }
      },
      group: [sequelize.fn('date_trunc', 'hour', sequelize.col('createdAt'))],
      order: [[sequelize.fn('date_trunc', 'hour', sequelize.col('createdAt')), 'ASC']]
    });

    res.json(stats.map(s => ({
      hour: new Date(s.dataValues.hour).getHours() + ':00',
      count: parseInt(s.dataValues.count)
    })));
  } catch (error) {
    console.error('[VOLUME_STATS_ERROR]', error);
    res.status(500).json({ message: 'Failed to aggregate volume telemetry' });
  }
};

exports.batchUpdateOrders = async (req, res) => {
  try {
    const Order = getOrderModel();
    const { targetStatus, newStatus } = req.body;
    
    if (!targetStatus || !newStatus) return res.status(400).json({ message: 'Missing parameters' });

    const [updatedCount] = await Order.update(
      { status: newStatus },
      { where: { status: targetStatus } }
    );

    broadcastSystemUpdate(req, 'BATCH_ORDER_UPDATE', { targetStatus, newStatus, count: updatedCount });
    await logAuditAction(req, 'global', 'BATCH_ORDER_UPDATE', `Updated ${updatedCount} orders from ${targetStatus} to ${newStatus}`);

    res.json({ message: `Successfully updated ${updatedCount} orders.`, count: updatedCount });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getAllCoupons = async (req, res) => {
  try {
    const { getCouponModel } = require('../models/Coupon');
    const Coupon = getCouponModel();
    const User = getUserModel();
    const coupons = await Coupon.findAll({
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'phone'] }],
      order: [['createdAt', 'DESC']]
    });
    res.json(coupons.map(c => ({ ...c.toJSON(), _id: c.id })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createCoupon = async (req, res) => {
  try {
    const { getCouponModel } = require('../models/Coupon');
    const Coupon = getCouponModel();
    const { code, type, value, userId, expiryDate } = req.body;
    
    if (!code || !userId) {
      return res.status(400).json({ message: 'Code and User ID are required' });
    }

    const User = getUserModel();
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if code is unique
    const existing = await Coupon.findOne({ where: { code } });
    if (existing) {
      return res.status(400).json({ message: 'Coupon code already exists' });
    }

    const coupon = await Coupon.create({
      code,
      type: type || 'FREEDEL',
      value: value || 0,
      userId,
      isUsed: false,
      expiryDate: expiryDate ? new Date(expiryDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    await logAuditAction(req, coupon.id, 'CREATE_COUPON', { code: coupon.code, userId });
    broadcastSystemUpdate(req, 'COUPON_CREATED', coupon);

    res.status(201).json({ ...coupon.toJSON(), _id: coupon.id });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.deleteCoupon = async (req, res) => {
  try {
    const { getCouponModel } = require('../models/Coupon');
    const Coupon = getCouponModel();
    const coupon = await Coupon.findByPk(req.params.id);
    if (!coupon) return res.status(404).json({ message: 'Coupon not found' });
    
    await coupon.destroy();
    await logAuditAction(req, req.params.id, 'DELETE_COUPON', { code: coupon.code });
    broadcastSystemUpdate(req, 'COUPON_DELETED', { id: req.params.id });
    
    res.json({ message: 'Coupon successfully removed/revoked' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─── Finance & Operations (Payouts & Refunds) ────────────────
exports.getRestaurantPayouts = async (req, res) => {
  try {
    const Order = getOrderModel();
    const Restaurant = getRestaurantModel();
    
    // Group only Delivered orders to calculate real earnings
    const deliveredOrders = await Order.findAll({ 
      where: { status: 'Delivered' }
    });
    const restaurants = await Restaurant.findAll();
    const restMap = restaurants.reduce((acc, r) => ({ ...acc, [r.id]: r }), {});

    const payouts = {};
    deliveredOrders.forEach(o => {
      const rest = restMap[o.restaurantId];
      if (!rest) return;
      const price = o.finalPrice || o.totalPrice || 0;
      const commissionRate = rest.commissionRate || 10;
      const commission = price * (commissionRate / 100);
      
      if (!payouts[rest.id]) {
        payouts[rest.id] = {
          restaurantId: rest.id,
          restaurantName: rest.name,
          vendorType: rest.vendorType,
          totalOrders: 0,
          totalGMV: 0,
          totalCommission: 0,
          netPayout: 0
        };
      }
      payouts[rest.id].totalOrders += 1;
      payouts[rest.id].totalGMV += price;
      payouts[rest.id].totalCommission += commission;
      payouts[rest.id].netPayout += (price - commission);
    });

    res.json(Object.values(payouts).map(p => ({
      ...p,
      totalGMV: Math.round(p.totalGMV),
      totalCommission: Math.round(p.totalCommission),
      netPayout: Math.round(p.netPayout)
    })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getDisputedOrders = async (req, res) => {
  try {
    const Order = getOrderModel();
    const User = require('../models/User').getUserModel();
    
    const disputes = await Order.findAll({
      where: { status: 'Cancelled' },
      order: [['createdAt', 'DESC']],
      include: [{ model: User, as: 'user', attributes: ['name', 'phone'] }]
    });
    res.json(disputes.map(d => ({ ...d.toJSON(), _id: d.id, userId: d.user || { name: 'Student', phone: '' } })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.processManualRefund = async (req, res) => {
  try {
    const Order = getOrderModel();
    const { getUserModel } = require('../models/User');
    const User = getUserModel();
    
    const order = await Order.findByPk(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'Cancelled') return res.status(400).json({ message: 'Can only refund Cancelled orders.' });
    if (order.paymentMethod === 'COD') return res.status(400).json({ message: 'COD orders do not require refunds.' });

    const user = await User.findByPk(order.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const refundAmount = order.finalPrice || order.totalPrice;
    
    // Perform manual wallet refund
    user.walletBalance = (user.walletBalance || 0) + refundAmount;
    await user.save();
    
    await logAuditAction(req, order.id, 'MANUAL_REFUND_PROCESSED', { amount: refundAmount, userId: user.id });
    
    res.json({ message: 'Refund successful', refundAmount, walletBalance: user.walletBalance });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─── God-Tier Administrative Endpoints ───────────────────────

exports.toggleUserBan = async (req, res) => {
  try {
    const { getUserModel } = require('../models/User');
    const User = getUserModel();
    const user = await User.findByPk(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.isActive = req.body.isActive !== undefined ? req.body.isActive : !user.isActive;
    await user.save();
    
    const action = user.isActive ? 'USER_UNBANNED' : 'USER_BANNED';
    await logAuditAction(req, user.id, action, { userId: user.id });

    res.json({ message: `User account ${user.isActive ? 'reactivated' : 'suspended'}`, user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.broadcastPushNotification = async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) return res.status(400).json({ message: 'Title and body required' });
    
    // In a real prod environment, we would use firebase-admin.
    // For this demonstration, we just log it as sent to all FCM tokens.
    const { getUserModel } = require('../models/User');
    const User = getUserModel();
    const activeUsers = await User.count({ where: { isActive: true } });

    await logAuditAction(req, null, 'GLOBAL_PUSH_SENT', { title, body, userCount: activeUsers });
    
    res.json({ message: `Push notification broadcasted successfully to approximately ${activeUsers} active devices.` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getRecentReviews = async (req, res) => {
  try {
    const Order = getOrderModel();
    const User = require('../models/User').getUserModel();
    const Restaurant = getRestaurantModel();
    const { Op } = require('sequelize');

    const reviews = await Order.findAll({
      where: {
        review: { [Op.not]: null }
      },
      order: [['createdAt', 'DESC']],
      limit: 50,
      include: [
        { model: User, as: 'user', attributes: ['name', 'phone'] },
      ]
    });
    
    // Quick and dirty manual join for restaurant name since associations might be missing
    const restaurants = await Restaurant.findAll();
    const restMap = restaurants.reduce((acc, r) => ({ ...acc, [r.id]: r.name }), {});

    const mapped = reviews.map(r => {
      const data = r.toJSON();
      data.restaurantName = restMap[r.restaurantId] || 'Unknown Node';
      return data;
    });

    res.json(mapped);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteReview = async (req, res) => {
  try {
    const Order = getOrderModel();
    const order = await Order.findByPk(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Review not found' });
    
    order.review = null;
    order.rating = null;
    await order.save();
    
    await logAuditAction(req, order.id, 'REVIEW_DELETED', { orderId: order.id });
    res.json({ message: 'Review successfully removed from the ecosystem.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getRiderPayouts = async (req, res) => {
  try {
    const Order = getOrderModel();
    
    const deliveredOrders = await Order.findAll({ 
      where: { status: 'Delivered' }
    });

    // In a full implementation, we'd pull from DeliveryPartner model for names.
    // We will aggregate by deliveryPartnerId.
    const payouts = {};
    deliveredOrders.forEach(o => {
      if (!o.deliveryPartnerId) return;
      const fee = o.deliveryFee || 0;
      const rid = o.deliveryPartnerId;
      
      if (!payouts[rid]) {
        payouts[rid] = {
          riderId: rid,
          totalDeliveries: 0,
          totalDeliveryFees: 0,
        };
      }
      payouts[rid].totalDeliveries += 1;
      payouts[rid].totalDeliveryFees += fee;
    });

    res.json(Object.values(payouts));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
