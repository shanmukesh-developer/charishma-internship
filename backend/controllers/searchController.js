const { getRestaurantModel } = require('../models/Restaurant');
const { getMenuItemModel } = require('../models/MenuItem');
const { Op } = require('sequelize');

// @desc    Global search across restaurants and menu items
// @route   GET /api/search
const globalSearch = async (req, res) => {
  const { q } = req.query;
  
  try {
    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    
    // Check dialect to use appropriate case-insensitive operator
    const dialect = Restaurant.sequelize.getDialect();
    const likeOp = dialect === 'postgres' ? Op.iLike : Op.like;

    if (!q || q.trim().length < 3) {
      // Return Trending/Featured if no query
      const trendingRestaurants = await Restaurant.findAll({
        where: { isActive: true },
        order: [['rating', 'DESC']],
        limit: 4
      });
      const trendingItems = await MenuItem.findAll({
        where: { isAvailable: true },
        limit: 6,
        include: [{ model: Restaurant, as: 'restaurant', attributes: ['id', 'name', 'imageUrl'] }]
      });

      return res.json({
        restaurants: trendingRestaurants.map(r => ({
          _id: r.id, id: r.id, name: r.name, location: r.location, imageUrl: r.imageUrl, rating: r.rating || 4.5
        })),
        items: trendingItems.map(item => {
          const itemJSON = item.toJSON();
          return {
            ...itemJSON,
            _id: itemJSON.id,
            restaurantId: itemJSON.restaurant ? { _id: itemJSON.restaurant.id, name: itemJSON.restaurant.name } : { _id: itemJSON.restaurantId, name: 'Unknown' }
          };
        }),
        isTrending: true
      });
    }

    // Search Restaurants by name
    const restaurants = await Restaurant.findAll({
      where: {
        name: { [likeOp]: `%${q}%` },
        isActive: true
      },
      limit: 5
    });

    // Search Menu Items by name, description, or category
    const menuItems = await MenuItem.findAll({
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
      include: [{ model: Restaurant, as: 'restaurant', attributes: ['id', 'name', 'imageUrl'] }],
      limit: 15
    });

    // Transform menuItems to match the expected format
    const items = menuItems.map(item => {
      const itemJSON = item.toJSON();
      return {
        ...itemJSON,
        _id: itemJSON.id,
        restaurantId: itemJSON.restaurant ? { 
          _id: itemJSON.restaurant.id, 
          name: itemJSON.restaurant.name 
        } : { _id: itemJSON.restaurantId, name: 'Unknown' }
      };
    });

    res.json({
      restaurants: restaurants.map(r => ({
        _id: r.id,
        name: r.name,
        location: r.location,
        imageUrl: r.imageUrl,
        rating: r.rating || 4.5
      })),
      items
    });
  } catch (error) {
    console.error('[SEARCH_ERROR]', error);
    res.status(500).json({ message: 'Error performing search', error: error.message });
  }
};

module.exports = { globalSearch };
