const { getRestaurantModel } = require('../models/Restaurant');
const { getMenuItemModel } = require('../models/MenuItem');
const { getOrderModel } = require('../models/Order');
const jwt = require('jsonwebtoken');

// @desc    Restaurant Login
// @route   POST /api/restaurants/login
const restaurantLogin = async (req, res) => {
  const { id, password } = req.body;
  try {
    // UUID basic validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUuid = uuidRegex.test(id);

    const Restaurant = getRestaurantModel();
    let restaurant;

    if (isUuid) {
      restaurant = await Restaurant.findByPk(id);
    } else {
      // Fallback: Try finding by name (case-insensitive for better UX)
      const { Op } = require('sequelize');
      const dialect = Restaurant.sequelize.getDialect();
      const operator = dialect === 'postgres' ? Op.iLike : Op.like;
      
      restaurant = await Restaurant.findOne({ 
        where: { name: { [operator]: id } } 
      });
    }

    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' });
    
    if (restaurant.password) {
      const isMatch = await restaurant.comparePassword(password);
      if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('[AUTH_FATAL] JWT_SECRET is not configured.');
      return res.status(500).json({ message: 'Server configuration error' });
    }
    const token = jwt.sign({ id: restaurant.id, role: 'restaurant' }, secret, { expiresIn: '30d' });
    res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ restaurant, token });
  } catch (error) {
    console.error('[RESTAURANT_LOGIN_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get orders for restaurant
// @route   GET /api/restaurants/:id/orders
const getRestaurantOrders = async (req, res) => {
  try {
    const isOwner = req.user.id === req.params.id;
    const isAdmin = req.user.role?.toLowerCase() === 'admin';
    if (!isOwner && !isAdmin) {
      console.warn(`[SECURITY_WARN] User ${req.user.id} attempted to fetch orders for restaurant ${req.params.id}`);
      return res.status(403).json({ message: 'Not authorized to view these orders' });
    }

    const { getUserModel } = require('../models/User');
    const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
    
    const Order = getOrderModel();
    const User = getUserModel();
    const DeliveryPartner = getDeliveryPartnerModel();

    const orders = await Order.findAll({
      where: { restaurantId: req.params.id },
      include: [
        { model: User, as: 'user', attributes: ['name', 'phone'] },
        { model: DeliveryPartner, as: 'deliveryPartner', attributes: ['name', 'phone'] }
      ],
      order: [['createdAt', 'DESC']]
    });
    res.json(orders.map(o => ({ ...o.toJSON(), _id: o.id })));
  } catch (error) {
    console.error('[GET_ORDERS_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get all active restaurants
// @route   GET /api/restaurants
const getRestaurants = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    const restaurants = await Restaurant.findAll({ where: { isActive: true } });
    
    // Stitch all valid menu items into the restaurants array for catalog rendering
    const allMenuItems = await MenuItem.findAll({ where: { isAvailable: true } });
    
    const augmentedRestaurants = restaurants.map(r => {
      const rJson = r.toJSON();
      rJson._id = rJson.id; // Map UUIDs to expected legacy Mongo _id formats
      rJson.menu = allMenuItems
        .filter(m => m.restaurantId === r.id)
        .map(m => {
          const item = m.toJSON();
          // Ensure tags is an array (SQLite might return it as a string)
          if (typeof item.tags === 'string') {
            try { item.tags = JSON.parse(item.tags); } catch { item.tags = []; }
          }
          return { ...item, _id: item.id };
        });
      return rJson;
    });

    res.json(augmentedRestaurants);
  } catch (error) {
    console.error('[RESTAURANT_ERROR]', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Get menu for a specific restaurant
// @route   GET /api/restaurants/:id/menu
const getRestaurantMenu = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();
    const menu = await MenuItem.findAll({ where: { restaurantId: req.params.id } });
    res.json(menu);
  } catch (error) {
    console.error('[MENU_ERROR]', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Create a new restaurant (Admin only)
// @route   POST /api/restaurants
const createRestaurant = async (req, res) => {
  const { name, location, imageUrl, deliveryTime, commissionRate, isOffline, password } = req.body;
  try {
    const Restaurant = getRestaurantModel();
    const restaurant = await Restaurant.create({ name, location, imageUrl, deliveryTime, commissionRate, isOffline, password });
    res.status(201).json(restaurant);
  } catch (error) {
    console.error('[CREATE_RESTAURANT_ERROR]', error);
    res.status(400).json({ message: 'Invalid restaurant data' });
  }
};

// @desc    Toggle menu item availability
// @route   PUT /api/restaurants/menu/:itemId/toggle
const toggleMenuItemAvailability = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();
    const item = await MenuItem.findByPk(req.params.itemId);
    if (!item) return res.status(401).json({ message: 'Menu data missing or session stale (Nexus Sync Required)' });

    // Security: Only the restaurant that owns the item or an admin can toggle it
    const isOwner = item.restaurantId === req.user.id;
    const isAdmin = req.user.role?.toLowerCase() === 'admin';
    if (!isOwner && !isAdmin) {
       console.warn(`[SECURITY_WARN] User ${req.user.id} attempted to modify menu item ${item.id}`);
       return res.status(403).json({ message: 'Not authorized to manage this asset' });
    }

    item.isAvailable = !item.isAvailable;
    if (req.body.outOfStockUntil && !item.isAvailable) {
      item.outOfStockUntil = new Date(req.body.outOfStockUntil);
    } else {
      item.outOfStockUntil = null;
    }
    await item.save();

    const io = req.app.get('io');
    io.emit('inventory_updated', { itemId: item.id, isAvailable: item.isAvailable });

    res.json({ message: 'Item availability updated', _id: item.id, isAvailable: item.isAvailable });
  } catch (error) {
    console.error('[TOGGLE_MENU_ERROR]', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update menu item tags (Dietary etc)
// @route   PUT /api/restaurants/menu/:itemId/tags
const updateMenuItemTags = async (req, res) => {
  const { tags } = req.body;
  try {
    const MenuItem = getMenuItemModel();
    const item = await MenuItem.findByPk(req.params.itemId);
    if (!item) return res.status(401).json({ message: 'Menu data missing or session stale (Nexus Sync Required)' });

    // Security check
    const isOwner = item.restaurantId === req.user.id;
    const isAdmin = req.user.role?.toLowerCase() === 'admin';
    if (!isOwner && !isAdmin) {
       console.warn(`[SECURITY_WARN] User ${req.user.id} attempted to modify tags for menu item ${item.id}`);
       return res.status(403).json({ message: 'Not authorized to manage this asset' });
    }

    item.tags = tags;
    await item.save();

    res.json({ message: 'Item tags updated', _id: item.id, tags: item.tags });
  } catch {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Create Menu Item (Restaurant Portal)
// @route   POST /api/restaurants/menu
const createMenuItem = async (req, res) => {
  try {
    const { name, price, description, imageUrl, category, isVegetarian } = req.body;
    const MenuItem = getMenuItemModel();
    
    const restaurantId = req.user.role?.toLowerCase() === 'restaurant' ? req.user.id : req.body.restaurantId;
    if (!restaurantId) return res.status(400).json({ message: 'Restaurant ID required' });
    
    const isOwner = restaurantId === req.user.id;
    const isAdmin = req.user.role?.toLowerCase() === 'admin';
    if (!isOwner && !isAdmin) {
       return res.status(403).json({ message: 'Not authorized to create items for this restaurant' });
    }

    const newItem = await MenuItem.create({
      restaurantId,
      name,
      price,
      description,
      imageUrl,
      category,
      isVegetarian,
      isAvailable: true
    });

    res.status(201).json(newItem);
  } catch (error) {
    console.error('[CREATE_MENU_ITEM_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update Menu Item (Restaurant Portal)
// @route   PUT /api/restaurants/menu/:itemId
const updateMenuItem = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();
    const item = await MenuItem.findByPk(req.params.itemId);
    if (!item) return res.status(404).json({ message: 'Menu item not found' });

    // Security check
    const isOwner = item.restaurantId === req.user.id;
    const isAdmin = req.user.role?.toLowerCase() === 'admin';
    if (!isOwner && !isAdmin) {
       console.warn(`[SECURITY_WARN] User ${req.user.id} attempted to update menu item ${item.id}`);
       return res.status(403).json({ message: 'Not authorized to manage this asset' });
    }

    const { name, price, description, imageUrl, category, isVegetarian, isAvailable, isEliteOnly } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (price !== undefined) updateData.price = price;
    if (description !== undefined) updateData.description = description;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
    if (category !== undefined) updateData.category = category;
    if (isVegetarian !== undefined) updateData.isVegetarian = isVegetarian;
    if (isAvailable !== undefined) updateData.isAvailable = isAvailable;
    if (isEliteOnly !== undefined) updateData.isEliteOnly = isEliteOnly;

    await item.update(updateData);
    res.json(item);
  } catch {
    res.status(500).json({ message: 'Server error' });
  }
};

// ── CampusBites: Get Local Vendors ───────────────────────────
// @desc    Get all LOCAL_VENDOR stalls, optionally filtered by campus
// @route   GET /api/restaurants/local-vendors
const getLocalVendors = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    const { campus } = req.query;

    const where = { vendorType: 'LOCAL_VENDOR', isActive: true };
    if (campus) where.campus = campus;

    const vendors = await Restaurant.findAll({ where, order: [['subscriptionTier', 'DESC'], ['rating', 'DESC']] });
    const vendorIds = vendors.map(v => v.id);

    // Batch-fetch menu items for all local vendors
    const { Op } = require('sequelize');
    const allMenuItems = vendorIds.length > 0
      ? await MenuItem.findAll({ where: { restaurantId: { [Op.in]: vendorIds } } })
      : [];

    const augmented = vendors.map(v => {
      const vJson = v.toJSON();
      vJson._id = vJson.id;
      vJson.menu = allMenuItems
        .filter(m => m.restaurantId === v.id)
        .map(m => {
          const item = m.toJSON();
          if (typeof item.tags === 'string') {
            try { item.tags = JSON.parse(item.tags); } catch { item.tags = []; }
          }
          return { ...item, _id: item.id };
        });
      return vJson;
    });

    res.json(augmented);
  } catch (error) {
    console.error('[LOCAL_VENDOR_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ── CampusBites: Increment Click Counter ─────────────────────
// @desc    Increment visitor click analytics for a stall
// @route   POST /api/restaurants/:id/click
const incrementClickCount = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const restaurant = await Restaurant.findByPk(req.params.id);
    if (!restaurant) return res.status(404).json({ message: 'Vendor not found' });

    await restaurant.increment('clickCount');
    res.json({ success: true, clickCount: restaurant.clickCount + 1 });
  } catch (error) {
    console.error('[CLICK_COUNT_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Toggle master offline state for restaurant
// @route   PUT /api/restaurants/:id/offline
const toggleRestaurantOffline = async (req, res) => {
  try {
    const isOwner = req.user.id === req.params.id;
    const isAdmin = req.user.role?.toLowerCase() === 'admin';
    if (!isOwner && !isAdmin) {
       return res.status(403).json({ message: 'Not authorized to change store status' });
    }

    const Restaurant = getRestaurantModel();
    const restaurant = await Restaurant.findByPk(req.params.id);
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' });

    restaurant.isOffline = !restaurant.isOffline;
    await restaurant.save();

    // Broadcast to riders/customers that the store state changed
    const io = req.app.get('io');
    io.emit('store_status_changed', { restaurantId: restaurant.id, isOffline: restaurant.isOffline });

    res.json({ message: 'Store status updated', isOffline: restaurant.isOffline });
  } catch (error) {
    console.error('[TOGGLE_OFFLINE_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { 
  getRestaurants, 
  getRestaurantMenu, 
  createRestaurant, 
  restaurantLogin, 
  getRestaurantOrders, 
  toggleMenuItemAvailability,
  updateMenuItemTags,
  createMenuItem,
  updateMenuItem,
  getLocalVendors,
  incrementClickCount,
  toggleRestaurantOffline
};
