const AppConfig = require('../models/AppConfig');

exports.getConfig = async (req, res) => {
  try {
    let config = await AppConfig.findOne();
    
    if (!config) {
      // Seed default config if none exists
      config = await AppConfig.create({
        maintenanceMode: false,
        campusOpen: true,
        banners: [
          {
            imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?q=80&w=1974&auto=format&fit=crop',
            tagline: 'MEGA BASKET',
            title1: 'YOUR ESSENTIALS',
            title2: 'DELIVERED TODAY',
            description: 'CREATE A CUSTOM SHOPPING LIST AND HAVE OUR PERSONAL SHOPPERS BUY AND DELIVER YOUR DAILY NEEDS.',
            buttonText: 'CREATE BASKET',
            redirectUrl: '/mega-basket',
            isActive: true
          }
        ],
        categories: [
          { name: 'Fruits', img: '/assets/3d-fruit.png', order: 1, isActive: true },
          { name: 'Rental', img: '/assets/3d-bike.png', order: 2, isActive: true },
          { name: 'Sweets', img: '/assets/3d-donut.png', order: 3, isActive: true }
        ]
      });
    }

    res.status(200).json({
      success: true,
      config
    });
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch config' });
  }
};

exports.updateConfig = async (req, res) => {
  try {
    const updates = req.body;
    let config = await AppConfig.findOne();
    
    if (!config) {
      config = new AppConfig(updates);
    } else {
      // Merge updates
      Object.keys(updates).forEach(key => {
        config[key] = updates[key];
      });
    }
    
    config.lastUpdatedBy = req.user ? req.user._id : null;
    await config.save();
    
    // Broadcast via socket if available
    if (req.app.get('io')) {
      req.app.get('io').emit('config_updated', config);
    }

    res.status(200).json({
      success: true,
      config
    });
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ success: false, message: 'Failed to update config', error: error.message });
  }
};
