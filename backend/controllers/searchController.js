const { getRestaurantModel } = require('../models/Restaurant');
const { getMenuItemModel } = require('../models/MenuItem');
const { Op } = require('sequelize');
const { stripItemSecrets } = require('../utils/publicFields');
// In-Campus Booking stalls are pickup-only (owner, 30 Oct 2026): they are found under In-Campus Booking, never in
// search, which opens the delivery store page (a dish added there was refused at checkout as BOOKING_ONLY_STALL).
const NOT_BOOKING_STALL = { [Op.or]: [{ campusBookingEnabled: false }, { campusBookingEnabled: null }] };

// Real rating only (0 = not rated yet → null, the app shows "New").
const realRating = (r) => (Number(r) > 0 ? Number(r) : null);
// LIKE wildcards typed by users are treated as plain spaces.
const cleanQuery = (q) => String(q || '').replace(/[%_]/g, ' ').trim().slice(0, 60);

// P1: responseCache key. The response depends only on the cleaned query (never on the caller), so
// /api/search and /api/users/search share entries. ASCII queries are lower-cased (ILIKE on Postgres
// and SQLite's LIKE are case-insensitive for ASCII); anything else keeps its exact spelling.
const searchCacheKey = (req) => {
  const raw = req && req.query ? req.query.q : '';
  const q = cleanQuery(Array.isArray(raw) ? raw[raw.length - 1] : raw);
  if (q.length < 2) return 'search|trending';
  return `search|q=${/^[ -~]*$/.test(q) ? q.toLowerCase() : q}`;
};

// @desc    Global search across restaurants and menu items
// @route   GET /api/search
const globalSearch = async (req, res) => {
  const q = cleanQuery(req.query.q);
  
  try {
    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    
    // Check dialect to use appropriate case-insensitive operator
    const dialect = Restaurant.sequelize.getDialect();
    const likeOp = dialect === 'postgres' ? Op.iLike : Op.like;

    if (!q || q.trim().length < 2) {
      // Return Trending/Featured if no query
      // Independent reads: one round trip of wall time, not two.
      const [trendingRestaurants, trendingItems] = await Promise.all([
        Restaurant.findAll({
          where: { isActive: true, ...(await require('../utils/receiptSettings').listingWhere()), [Op.and]: [NOT_BOOKING_STALL] },
          order: [['rating', 'DESC NULLS LAST']], // Postgres puts NULL first on plain DESC
          limit: 4
        }),
        MenuItem.findAll({
          where: { isAvailable: true },
          limit: 6,
          include: [{ model: Restaurant, as: 'restaurant', attributes: ['id', 'name', 'imageUrl', 'vendorType'], where: { isActive: true, ...(await require('../utils/receiptSettings').listingWhere()), [Op.and]: [NOT_BOOKING_STALL] } }]
        }),
      ]);

      return res.json({
        restaurants: trendingRestaurants.map(r => ({
          _id: r.id, id: r.id, name: r.name, location: r.location, imageUrl: r.imageUrl, vendorType: r.vendorType, rating: realRating(r.rating)
        })),
        items: trendingItems.map(item => {
          const itemJSON = stripItemSecrets(item.toJSON());
          return {
            ...itemJSON,
            _id: itemJSON.id,
            restaurantId: { _id: itemJSON.restaurantId, name: itemJSON.restaurant ? itemJSON.restaurant.name : null, vendorType: itemJSON.restaurant ? itemJSON.restaurant.vendorType : null }
          };
        }),
        isTrending: true
      });
    }

    // Restaurants by name and menu items by name / description / category: independent reads, run
    // together (one round trip of wall time, not two).
    const [restaurants, menuItems] = await Promise.all([Restaurant.findAll({
      where: {
        name: { [likeOp]: `%${q}%` },
        isActive: true, ...(await require('../utils/receiptSettings').listingWhere()), [Op.and]: [NOT_BOOKING_STALL]
      },
      limit: 5
    }), MenuItem.findAll({
      where: {
        [Op.and]: [
          { isAvailable: true },
          {
            [Op.or]: [
              { name: { [likeOp]: `%${q}%` } },
              { description: { [likeOp]: `%${q}%` } },
              { category: { [likeOp]: `%${q}%` } }
            ]
          }
        ]
      },
      include: [{ model: Restaurant, as: 'restaurant', attributes: ['id', 'name', 'imageUrl', 'vendorType'], where: { isActive: true, ...(await require('../utils/receiptSettings').listingWhere()), [Op.and]: [NOT_BOOKING_STALL] } }],
      limit: 15
    })]);

    // Transform menuItems to match the expected format
    const items = menuItems.map(item => {
      const itemJSON = stripItemSecrets(item.toJSON());
      return {
        ...itemJSON,
        _id: itemJSON.id,
        restaurantId: {
          _id: itemJSON.restaurantId,
          name: itemJSON.restaurant ? itemJSON.restaurant.name : null,
          vendorType: itemJSON.restaurant ? itemJSON.restaurant.vendorType : null
        }
      };
    });

    res.json({
      restaurants: restaurants.map(r => ({
        _id: r.id,
        id: r.id,
        name: r.name,
        location: r.location,
        imageUrl: r.imageUrl,
        vendorType: r.vendorType,
        rating: realRating(r.rating)
      })),
      items
    });
  } catch (error) {
    console.error('[SEARCH_ERROR]', error);
    res.status(500).json({ message: 'Search is having a moment. Please try again.' });
  }
};

module.exports = { globalSearch, searchCacheKey };
