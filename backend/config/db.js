const { Sequelize } = require('sequelize');
const path = require('path');

let sequelize;

// Import init functions
const { initUserModel } = require('../models/User');
const { initRestaurantModel } = require('../models/Restaurant');
const { initMenuItemModel } = require('../models/MenuItem');
const { initOrderModel } = require('../models/Order');
const { initDeliveryPartnerModel } = require('../models/DeliveryPartner');
const { initVaultItemModel } = require('../models/VaultItem');
const { initGlobalConfigModel } = require('../models/GlobalConfig');
const { initVerificationLogModel } = require('../models/VerificationLog');
const { initCouponModel } = require('../models/Coupon');
const { initCommunityPostModel } = require('../models/CommunityPost');
const { initTicketModel } = require('../models/Ticket');
const { initBikePoolModel } = require('../models/BikePool');
const { initPoolRequestModel } = require('../models/PoolRequest');
const { initPGHostelModel } = require('../models/PGHostel');
const { initPGRoomModel } = require('../models/PGRoom');
const { initPGBookingModel } = require('../models/PGBooking');
const { initMegaBasketModel } = require('../models/MegaBasket');
const { initMegaBasketItemModel } = require('../models/MegaBasketItem');

const initializeAllModels = (instance) => {
  initUserModel(instance);
  initRestaurantModel(instance);
  initMenuItemModel(instance);
  initOrderModel(instance);
  initDeliveryPartnerModel(instance);
  initVaultItemModel(instance);
  initGlobalConfigModel(instance);
  initVerificationLogModel(instance);
  initCouponModel(instance);
  initCommunityPostModel(instance);
  initTicketModel(instance);
  initBikePoolModel(instance);
  initPoolRequestModel(instance);
  initPGHostelModel(instance);
  initPGRoomModel(instance);
  initPGBookingModel(instance);
  initMegaBasketModel(instance);
  initMegaBasketItemModel(instance);

  // Define Associations
  const Restaurant = instance.models.Restaurant;
  const MenuItem = instance.models.MenuItem;
  const Order = instance.models.Order;
  const User = instance.models.User;

  if (Restaurant && MenuItem) {
    Restaurant.hasMany(MenuItem, { foreignKey: 'restaurantId', as: 'menuItems' });
    MenuItem.belongsTo(Restaurant, { foreignKey: 'restaurantId', as: 'restaurant' });
  }

  if (Order && Restaurant) {
    Order.belongsTo(Restaurant, { foreignKey: 'restaurantId', as: 'restaurant' });
  }

  const DeliveryPartner = instance.models.DeliveryPartner;
  if (Order && DeliveryPartner) {
    Order.belongsTo(DeliveryPartner, { foreignKey: 'deliveryPartnerId', as: 'deliveryPartner' });
    DeliveryPartner.hasMany(Order, { foreignKey: 'deliveryPartnerId', as: 'orders' });
  }

  if (Order && User) {
    Order.belongsTo(User, { foreignKey: 'userId', as: 'user' });
    User.hasMany(Order, { foreignKey: 'userId', as: 'orders' });
  }

  const Coupon = instance.models.Coupon;
  if (Coupon && User) {
    Coupon.belongsTo(User, { foreignKey: 'userId', as: 'user' });
    User.hasMany(Coupon, { foreignKey: 'userId', as: 'coupons' });
  }

  const Ticket = instance.models.Ticket;
  if (Ticket && User) {
    Ticket.belongsTo(User, { foreignKey: 'userId', as: 'user' });
    User.hasMany(Ticket, { foreignKey: 'userId', as: 'tickets' });
  }
  if (Ticket && Order) {
    Ticket.belongsTo(Order, { foreignKey: 'orderId', as: 'order' });
    Order.hasMany(Ticket, { foreignKey: 'orderId', as: 'tickets' });
  }

  const BikePool = instance.models.BikePool;
  const PoolRequest = instance.models.PoolRequest;
  
  if (BikePool && User) {
    BikePool.belongsTo(User, { foreignKey: 'creatorId', as: 'creator' });
    BikePool.belongsTo(User, { foreignKey: 'coRiderId', as: 'coRider' });
  }

  if (PoolRequest && BikePool && User) {
    PoolRequest.belongsTo(BikePool, { foreignKey: 'poolId', as: 'pool' });
    BikePool.hasMany(PoolRequest, { foreignKey: 'poolId', as: 'requests' });
    PoolRequest.belongsTo(User, { foreignKey: 'passengerId', as: 'passenger' });
  }

  const PGHostel = instance.models.PGHostel;
  const PGRoom = instance.models.PGRoom;
  const PGBooking = instance.models.PGBooking;

  if (PGHostel && User) {
    PGHostel.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });
    User.hasMany(PGHostel, { foreignKey: 'ownerId', as: 'pgs' });
  }

  if (PGHostel && PGRoom) {
    PGRoom.belongsTo(PGHostel, { foreignKey: 'hostelId', as: 'hostel' });
    PGHostel.hasMany(PGRoom, { foreignKey: 'hostelId', as: 'rooms' });
  }

  if (PGBooking && PGRoom && User && PGHostel) {
    PGBooking.belongsTo(User, { foreignKey: 'userId', as: 'user' });
    PGBooking.belongsTo(PGRoom, { foreignKey: 'roomId', as: 'room' });
    PGBooking.belongsTo(PGHostel, { foreignKey: 'hostelId', as: 'hostel' });
    User.hasMany(PGBooking, { foreignKey: 'userId', as: 'pgBookings' });
    PGRoom.hasMany(PGBooking, { foreignKey: 'roomId', as: 'bookings' });
    PGHostel.hasMany(PGBooking, { foreignKey: 'hostelId', as: 'bookings' });
  }

  // MegaBasket Associations
  const MegaBasket = instance.models.MegaBasket;
  const MegaBasketItem = instance.models.MegaBasketItem;

  if (MegaBasket && User) {
    MegaBasket.belongsTo(User, { foreignKey: 'userId', as: 'user' });
    User.hasMany(MegaBasket, { foreignKey: 'userId', as: 'megaBaskets' });
  }

  if (MegaBasket && DeliveryPartner) {
    MegaBasket.belongsTo(DeliveryPartner, { foreignKey: 'deliveryPartnerId', as: 'deliveryPartner' });
    DeliveryPartner.hasMany(MegaBasket, { foreignKey: 'deliveryPartnerId', as: 'megaBaskets' });
  }

  if (MegaBasket && MegaBasketItem) {
    MegaBasket.hasMany(MegaBasketItem, { foreignKey: 'basketId', as: 'items' });
    MegaBasketItem.belongsTo(MegaBasket, { foreignKey: 'basketId', as: 'basket' });
  }
};

const configureSqlitePragmas = (instance) => {
  instance.addHook('afterConnect', (connection) => {
    try {
      if (connection && typeof connection.run === 'function') {
        connection.run('PRAGMA journal_mode=WAL;');
        connection.run('PRAGMA busy_timeout=5000;');
        connection.run('PRAGMA synchronous=NORMAL;');
        connection.run('PRAGMA cache_size=-10000;');
      }
    } catch (err) {
      console.error('Failed to set SQLite pragmas:', err);
    }
  });
};

const connectDB = async () => {
  const dbUrl = process.env.DATABASE_URL;
  const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  console.log(`[DB_INIT] DATABASE_URL present: ${!!dbUrl}`);
  console.log(`[DB_INIT] Production Mode: ${isProduction}`);

  if (!dbUrl) {
    if (isProduction) {
      console.error('❌ [FATAL_ERROR] DATABASE_URL IS MISSING ON RENDER!');
      console.error('❌ All data (restaurants, items, users) WILL BE LOST on the next deploy if using SQLite.');
      console.error('❌ Please create a PostgreSQL database on Render and add the DATABASE_URL environment variable.');
      process.exit(1);
    }
    const sqlitePath = path.join(__dirname, '..', 'local_dev.sqlite');
    console.log(`📦 Using LOCAL SQLite: ${sqlitePath}`);
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: sqlitePath,
      logging: false
    });
    configureSqlitePragmas(sequelize);
  } else {
    // Generate self-healing database URL connection candidates for Render environments
    const candidates = [];
    
    // Add internal connection attempts first to prioritize private network (free & fast)
    candidates.push(dbUrl); // Attempt 1: Initial internal DNS attempt
    candidates.push(dbUrl); // Attempt 2: Retry internal DNS after 3s sleep
    candidates.push(dbUrl); // Attempt 3: Retry internal DNS after another 3s sleep

    try {
      const parsedUrl = new URL(dbUrl);
      const hostname = parsedUrl.hostname;
      if (hostname.startsWith('dpg-') && !hostname.includes('.')) {
        // Automatically try to fall back to public/external hosts across major Render database regions
        const regions = [
          'oregon-postgres.render.com',
          'frankfurt-postgres.render.com',
          'singapore-postgres.render.com',
          'ohio-postgres.render.com'
        ];
        regions.forEach(region => {
          const altUrl = new URL(dbUrl);
          altUrl.hostname = `${hostname}.${region}`;
          candidates.push(altUrl.toString());
        });
      }
    } catch {
      // Ignore URL parsing errors and rely on original DATABASE_URL
    }

    let connected = false;
    let lastError = null;

    for (let i = 0; i < candidates.length; i++) {
      const currentUrl = candidates[i];
      let urlInfo = null;
      let isInternal = true;

      try {
        urlInfo = new URL(currentUrl);
        isInternal = !urlInfo.hostname.includes('.');
        console.log(`📡 Connecting to PostgreSQL at ${urlInfo.hostname.slice(0, 4)}***${urlInfo.hostname.slice(-4)} (Attempt ${i + 1}/${candidates.length}) [SSL: ${!isInternal}]...`);
        if (urlInfo.hostname === 'localhost' || urlInfo.hostname === '127.0.0.1') {
          console.warn('⚠️ [DB_WARNING] DATABASE_URL points to LOCALHOST. This will NOT persist data on Render!');
        }
      } catch {
        console.log(`📡 Connecting to PostgreSQL (Attempt ${i + 1}/${candidates.length})...`);
      }

      // Render internal database connections reject SSL. External connections require SSL.
      const dialectOptions = {
        // High-concurrency guards: Prevent queries and idle transactions from locking rows indefinitely
        statement_timeout: 30000,                  // Abort any query taking longer than 30 seconds
        idle_in_transaction_session_timeout: 30000 // Terminate session if transaction is left open/idle for 30 seconds
      };
      if (!isInternal) {
        dialectOptions.ssl = {
          require: true,
          rejectUnauthorized: false
        };
      }

      sequelize = new Sequelize(currentUrl, {
        dialect: 'postgres',
        dialectOptions: dialectOptions,
        pool: {
          max: 5, // Reduced to prevent "too many connections" under Render's clustering limits
          min: 1,  // Keep a minimal pool of warm connections ready
          acquire: 60000,
          idle: 30000,
          evict: 15000 // Check for stale connections every 15s
        },
        retry: {
          match: [
            /SequelizeConnectionError/,
            /SequelizeConnectionRefusedError/,
            /SequelizeHostNotFoundError/,
            /SequelizeHostNotReachableError/,
            /SequelizeInvalidConnectionError/,
            /SequelizeConnectionTimedOutError/,
            /TimeoutError/,
            /ECONNRESET/,
            /TERMINATING/
          ],
          max: 5 // Retry up to 5 times for transient failures
        },
        logging: false,
        benchmark: false
      });

      try {
        await sequelize.authenticate();
        console.log(`✅ [DB_SUCCESS] Authenticated successfully with PostgreSQL candidate ${i + 1}.`);
        connected = true;
        break;
      } catch (err) {
        console.warn(`⚠️ [DB_CONNECT_WARN] Candidate ${i + 1} connection failed: ${err.message}`);
        lastError = err;
        
        // Wait 3 seconds before next candidate to allow DNS propagation and cool off socket
        if (i < candidates.length - 1) {
          console.log('🔄 Sleeping 3 seconds before attempting next database candidate...');
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }

    if (!connected) {
      console.error('❌ [DB_FATAL] All PostgreSQL connection candidates failed.');
      if (isProduction) {
        console.error('🛑 [CRITICAL_FAILURE] Production environment detected. Fallback to SQLite is FORBIDDEN.');
        console.error('🛑 Data loss prevention triggered. Process will exit to prevent serving a blank database.');
        throw new Error('PostgreSQL connection failed in production. Fallback to SQLite is forbidden.');
      }
      console.warn('⚠️ [DB_FALLBACK] Falling back to local SQLite database...');
      const sqlitePath = path.join(__dirname, '..', 'local_prod.sqlite');
      console.log(`📦 Using LOCAL SQLite: ${sqlitePath}`);
      sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: sqlitePath,
        logging: false
      });
      configureSqlitePragmas(sequelize);
    }
  }

  try {
    const dialect = sequelize.getDialect();
    console.log(`✅ [DB_SUCCESS] Connected to ${dialect.toUpperCase()} database.`);
    
    initializeAllModels(sequelize);
    
    if (!isProduction) {
      console.log('🔄 Development Sync: Running { alter: true }...');
      try {
        // SQLite + alter:true often fails on backup table constraints. 
        // We try a normal sync first.
        await sequelize.sync({ alter: true });
      } catch (syncErr) {
        if (dialect === 'sqlite') {
          console.warn('⚠️ [DB_SYNC_WARN] SQLite alter failed. Attempting graceful recovery...');
          // If alter fails in SQLite, it's often due to backup table leftover or complex FK changes.
          // We'll fallback to a non-altering sync and log the need for manual migration if columns changed.
          await sequelize.sync(); 
        } else {
          throw syncErr;
        }
      }

      // Self-Healing SQLite Migration Guard: Ensure community post expiry column exists
      if (dialect === 'sqlite') {
        const poolCols = [
          { name: 'rideVibe', type: "VARCHAR(255) DEFAULT 'Any'" },
          { name: 'vehicleType', type: "VARCHAR(255) DEFAULT 'Bike'" },
          { name: 'availableSeats', type: 'INTEGER DEFAULT 1' },
          { name: 'autoApprove', type: 'BOOLEAN DEFAULT 0' },
          { name: 'stopovers', type: "TEXT DEFAULT '[]'" }
        ];
        for (const col of poolCols) {
          try {
            await sequelize.query(`ALTER TABLE "BikePools" ADD COLUMN "${col.name}" ${col.type};`);
            console.log(`✅ [SQLite_MIGRATION] Added ${col.name} column to BikePools.`);
          } catch (_err) {}
        }

        try {
          await sequelize.query('ALTER TABLE "Users" ADD COLUMN "email" VARCHAR(255);');
          console.log('✅ [SQLite_MIGRATION] Added email column to Users.');
        } catch (_err) {
          // Suppress error if already exists
        }

        try {
          await sequelize.query('ALTER TABLE "Users" ADD COLUMN "googleId" VARCHAR(255);');
          console.log('✅ [SQLite_MIGRATION] Added googleId column to Users.');
        } catch (_err) {}

        try {
          await sequelize.query('ALTER TABLE "Users" ADD COLUMN "gender" VARCHAR(255) DEFAULT \'Prefer not to say\';');
          console.log('✅ [SQLite_MIGRATION] Added gender column to Users.');
        } catch (_err) {}

        try {
          await sequelize.query('ALTER TABLE "Users" ADD COLUMN "genderPreference" VARCHAR(255) DEFAULT \'Any\';');
          console.log('✅ [SQLite_MIGRATION] Added genderPreference column to Users.');
        } catch (_err) {}

        try {
          await sequelize.query('ALTER TABLE "DeliveryPartners" ADD COLUMN "loginStreak" INTEGER DEFAULT 0;');
          console.log('✅ [SQLite_MIGRATION] Added loginStreak column to DeliveryPartners.');
        } catch (_err) {}

        try {
          await sequelize.query('ALTER TABLE "DeliveryPartners" ADD COLUMN "lastLoginDate" VARCHAR(255);');
          console.log('✅ [SQLite_MIGRATION] Added lastLoginDate column to DeliveryPartners.');
        } catch (_err) {}

        // Restaurant Local Vendor & new fields migration
        const restCols = [
          { name: 'vendorType', type: "VARCHAR(255) DEFAULT 'RESTAURANT'" },
          { name: 'campus', type: 'VARCHAR(255)' },
          { name: 'isOpenNow', type: 'BOOLEAN DEFAULT 1' },
          { name: 'whatsappNumber', type: 'VARCHAR(255)' },
          { name: 'subscriptionTier', type: "VARCHAR(255) DEFAULT 'free'" },
          { name: 'stallDescription', type: 'TEXT' },
          { name: 'promoOffer', type: 'VARCHAR(255)' },
          { name: 'clickCount', type: 'INTEGER DEFAULT 0' },
          { name: 'isOffline', type: 'BOOLEAN DEFAULT 0' }
        ];
        for (const col of restCols) {
          try {
            await sequelize.query(`ALTER TABLE "Restaurants" ADD COLUMN "${col.name}" ${col.type};`);
            console.log(`✅ [SQLite_MIGRATION] Added ${col.name} column to Restaurants.`);
          } catch (_err) {}
        }

        // MenuItem new fields migration
        const itemCols = [
          { name: 'isEliteOnly', type: 'BOOLEAN DEFAULT 0' },
          { name: 'customCommission', type: 'FLOAT' },
          { name: 'specs', type: 'TEXT' },
          { name: 'ownerName', type: 'VARCHAR(255)' },
          { name: 'ownerPhone', type: 'VARCHAR(255)' }
        ];
        for (const col of itemCols) {
          try {
            await sequelize.query(`ALTER TABLE "MenuItems" ADD COLUMN "${col.name}" ${col.type};`);
            console.log(`✅ [SQLite_MIGRATION] Added ${col.name} column to MenuItems.`);
          } catch (_err) {}
        }
        // PGRooms new fields migration
        const pgRoomCols = [
          { name: 'floorNumber', type: 'INTEGER DEFAULT 1' },
          { name: 'hasAttachedBathroom', type: 'BOOLEAN DEFAULT 1' },
          { name: 'hasAC', type: 'BOOLEAN DEFAULT 0' },
          { name: 'hasBalcony', type: 'BOOLEAN DEFAULT 0' },
          { name: 'furnishing', type: "VARCHAR(255) DEFAULT 'Fully Furnished'" },
          { name: 'images', type: 'TEXT DEFAULT \'[]\'' }
        ];
        for (const col of pgRoomCols) {
          try {
            await sequelize.query(`ALTER TABLE "PGRooms" ADD COLUMN "${col.name}" ${col.type};`);
            console.log(`✅ [SQLite_MIGRATION] Added ${col.name} column to PGRooms.`);
          } catch (_err) {}
        }
      }
    } else {
      console.log('🔒 Production Sync: Running { alter: true } (Resilient Mode)');
      // In production (PostgreSQL), alter:true is safer and necessary for fresh deploys.
      await sequelize.sync({ alter: true });
      
      // Auto-check for empty DB to help user identify missing data
      const Restaurant = sequelize.models.Restaurant;
      if (Restaurant) {
        const count = await Restaurant.count();
        if (count === 0) {
          console.warn('⚠️ [DB_EMPTY] No restaurants found in PostgreSQL. Please use the Admin Portal to seed data or POST /api/seed.');
        } else {
          console.log(`✅ [DB_STATUS] Found ${count} restaurants in PostgreSQL. Persistence confirmed.`);
        }
      }

      // Critical Migrations: Ensure image columns can hold Base64 data
      try {
        await sequelize.query('ALTER TABLE "Users" ALTER COLUMN "profileImage" TYPE TEXT;');
        await sequelize.query('ALTER TABLE "Restaurants" ALTER COLUMN "imageUrl" TYPE TEXT;');
        await sequelize.query('ALTER TABLE "MenuItems" ALTER COLUMN "imageUrl" TYPE TEXT;');
        console.log('✅ [DB_MIGRATION] Asset columns expanded to TEXT.');
      } catch (err) { 
        // console.log('[DB_MIGRATION_SKIP] Already done or PG error:', err.message); 
      }
    }
  } catch (error) {
    console.error('❌ [DB_FATAL] Database connection failed:', error.message);
    
    // STRICT GUARD: Never fallback to SQLite on Render or Production
    if (isProduction) {
      console.error('🛑 [CRITICAL_FAILURE] Production environment detected. Fallback to SQLite is FORBIDDEN.');
      console.error('🛑 Data loss prevention triggered. Process will exit to prevent erroneous local storage usage.');
      process.exit(1); 
    }
    
    console.log('🔄 Fallback: Triggering Emergency SQLite (Local Dev Only)...');
    const sqlitePath = path.join(__dirname, '..', 'local_dev.sqlite');
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: sqlitePath,
      logging: false
    });
    configureSqlitePragmas(sequelize);
    initializeAllModels(sequelize);
    await sequelize.sync({ alter: true });
    console.log('✅ [DB_FALLBACK] Emergency SQLite is now active.');
  }
};

const getSequelize = () => sequelize;

module.exports = { connectDB, getSequelize };
