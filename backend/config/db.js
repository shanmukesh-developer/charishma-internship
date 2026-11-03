const { Sequelize } = require('sequelize');
const path = require('path');
const dbSettings = require('./dbSettings');

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
const { initCommunityPostLikeModel } = require('../models/CommunityPostLike');
const { initTicketModel } = require('../models/Ticket');
const { initBikePoolModel } = require('../models/BikePool');
const { initPoolRequestModel } = require('../models/PoolRequest');
const { initRideTemplateModel } = require('../models/RideTemplate');
const { initRideTemplateRunModel } = require('../models/RideTemplateRun');
const { initPGHostelModel } = require('../models/PGHostel');
const { initPGRoomModel } = require('../models/PGRoom');
const { initPGBookingModel } = require('../models/PGBooking');
const { initPGReviewModel } = require('../models/PGReview');
const { initPgPromotionModel } = require('../models/PgPromotion');
const { initSplashAdModel } = require('../models/SplashAd');
const { initMegaBasketModel } = require('../models/MegaBasket');
const { initMegaBasketItemModel } = require('../models/MegaBasketItem');
const { initAppConfigModel } = require('../models/AppConfig');
const { initBirthdayCelebrationModel } = require('../models/BirthdayCelebration');
const { initBirthdayWishModel } = require('../models/BirthdayWish');
const { initConversationModel } = require('../models/Conversation');
const { initMessageModel } = require('../models/Message');
const { initFriendshipModel } = require('../models/Friendship');
const { initRoomModel } = require('../models/Room');
const { initRoomParticipantModel } = require('../models/RoomParticipant');
const { initWallEventModel } = require('../models/WallEvent');
const { initWallSubmissionModel } = require('../models/WallSubmission');
const { initWallLikeModel } = require('../models/WallLike');
const { initServiceBookingModel } = require('../models/ServiceBooking');
const { initProductReviewModel } = require('../models/ProductReview');
const { initDailyContentModel } = require('../models/DailyContent');
const { initOtpCodeModel } = require('../models/OtpCode');
const { initCatalogueImportLedgerModel } = require('../models/CatalogueImportLedger');
const { initNotificationModel } = require('../models/Notification');
const { initIdempotencyKeyModel } = require('../models/IdempotencyKey');
const { initSmsDailyCountModel } = require('../models/SmsDailyCount');
const { initWalletTransactionModel } = require('../models/WalletTransaction');
const { initRiderCashEntryModel } = require('../models/RiderCashEntry');
const { initPayoutModel } = require('../models/Payout');
const { initReceiptCounterModel } = require('../models/ReceiptCounter');
const { initOrderMessageModel } = require('../models/OrderMessage');
const { initCampusModels } = require('../modules/campus/models');
const { initFriendsModels } = require('../modules/friends');
const { initRentalsModels } = require('../modules/rentals');
const { initAutoRideModels } = require('../modules/autoRide');
const { initCampusEventsModels } = require('../modules/campusEvents');
const { initCampusBookingModels } = require('../modules/campusBooking');
const { initPgOwnerModels } = require('../modules/pgOwner');

const initializeAllModels = (instance) => {
  // P1 perf: per-request DB time / query count + pool wait (utils/perfMetrics), dev-only DEV_DB_LATENCY_MS.
  try { require('../utils/perfMetrics').instrumentSequelize(instance); } catch (e) { console.warn('[PERF] instrumentation skipped:', e.message); }
  initUserModel(instance);
  initCampusModels(instance);
  initAppConfigModel(instance);
  initRestaurantModel(instance);
  initMenuItemModel(instance);
  initOrderModel(instance);
  initDeliveryPartnerModel(instance);
  initVaultItemModel(instance);
  initGlobalConfigModel(instance);
  initVerificationLogModel(instance);
  initCouponModel(instance);
  initCommunityPostModel(instance);
  initCommunityPostLikeModel(instance);
  initTicketModel(instance);
  initBikePoolModel(instance);
  initPoolRequestModel(instance);
  // Co-Ride regular rides (RideTemplates) + their once-per-date publish log (RideTemplateRuns).
  initRideTemplateModel(instance);
  initRideTemplateRunModel(instance);
  initPGHostelModel(instance);
  initPGRoomModel(instance);
  initPGBookingModel(instance);
  // PG v2: stay reviews (one per confirmed booking) + list-page promotions (admin curated).
  initPGReviewModel(instance);
  initPgPromotionModel(instance);
  // Splash ads: full-screen store ads after the customer app intro (admin curated, one active per style).
  initSplashAdModel(instance);
  initMegaBasketModel(instance);
  initMegaBasketItemModel(instance);
  initBirthdayCelebrationModel(instance);
  initBirthdayWishModel(instance);
  initConversationModel(instance);
  initMessageModel(instance);
  initFriendshipModel(instance);
  initRoomModel(instance);
  initRoomParticipantModel(instance);
  initWallEventModel(instance);
  initWallSubmissionModel(instance);
  initWallLikeModel(instance);
  initServiceBookingModel(instance);
  initProductReviewModel(instance);
  initDailyContentModel(instance);
  initOtpCodeModel(instance);
  initCatalogueImportLedgerModel(instance);
  initNotificationModel(instance);
  initIdempotencyKeyModel(instance);
  initSmsDailyCountModel(instance);
  // C5 wallet ledger (WalletTransactions).
  initWalletTransactionModel(instance);
  // C6 rider cash ledger (RiderCashEntries) + payout statements (Payouts).
  initRiderCashEntryModel(instance);
  initPayoutModel(instance);
  // C8 receipt number counters (ReceiptCounters).
  initReceiptCounterModel(instance);
  // C9 persisted order chat (OrderMessages, 90-day retention).
  initOrderMessageModel(instance);
  // Zenvy Friends tables (after Users / campus / chat models they reference).
  initFriendsModels(instance);
  // Zenvy Rentals: peer-to-peer student vehicle rentals (Others > Rentals).
  initRentalsModels(instance);
  // Zenvy Auto-Ride: shared autos seat booking + Zenvy Auto Driver accounts (off until AUTO_RIDE_ENABLED).
  initAutoRideModels(instance);
  // Zenvy Campus Events (Ce* tables; off until CAMPUS_EVENTS_ENABLED).
  initCampusEventsModels(instance);
  // In-Campus Booking: pickup bookings paid straight to the stall by UPI (CampusBookings).
  initCampusBookingModels(instance);
  // ZCS PG Partner: PG owner accounts, listing links, rent ledger, tenant complaints (pg_* tables).
  initPgOwnerModels(instance);
  // Owner-only test rows (utils/testView): every find and count of these in a non-tester request skips them.
  require('../utils/testView').hideTestRows(
    instance.models.Restaurant, instance.models.MenuItem, instance.models.Order, instance.models.VaultItem,
    instance.models.PGHostel, instance.models.PGRoom, instance.models.BikePool, instance.models.RentalListing,
    instance.models.CeEvent,
  );

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

  const Friendship = instance.models.Friendship;
  if (Friendship && User) {
    Friendship.belongsTo(User, { foreignKey: 'requesterId', as: 'requester' });
    Friendship.belongsTo(User, { foreignKey: 'recipientId', as: 'recipient' });
  }

  const Room = instance.models.Room;
  const RoomParticipant = instance.models.RoomParticipant;

  if (Room && RoomParticipant && User) {
    Room.belongsTo(User, { foreignKey: 'adminId', as: 'admin' });
    
    Room.hasMany(RoomParticipant, { foreignKey: 'roomId', as: 'participants' });
    RoomParticipant.belongsTo(Room, { foreignKey: 'roomId', as: 'room' });
    
    User.hasMany(RoomParticipant, { foreignKey: 'userId', as: 'roomMemberships' });
    RoomParticipant.belongsTo(User, { foreignKey: 'userId', as: 'user' });
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
  const RideTemplate = instance.models.RideTemplate;
  if (RideTemplate && User) {
    RideTemplate.belongsTo(User, { foreignKey: 'creatorId', as: 'creator' });
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

  const WallEvent = instance.models.WallEvent;
  const WallSubmission = instance.models.WallSubmission;
  const WallLike = instance.models.WallLike;

  if (WallEvent && WallSubmission) {
    WallEvent.hasMany(WallSubmission, { foreignKey: 'eventId', as: 'submissions' });
    WallSubmission.belongsTo(WallEvent, { foreignKey: 'eventId', as: 'event' });
  }

  if (WallSubmission && User) {
    WallSubmission.belongsTo(User, { foreignKey: 'userId', as: 'user' });
    User.hasMany(WallSubmission, { foreignKey: 'userId', as: 'wallSubmissions' });
  }

  if (WallSubmission && WallLike) {
    WallSubmission.hasMany(WallLike, { foreignKey: 'submissionId', as: 'likes' });
    WallLike.belongsTo(WallSubmission, { foreignKey: 'submissionId', as: 'submission' });
  }

  const ServiceBooking = instance.models.ServiceBooking;
  if (ServiceBooking && User) {
    ServiceBooking.belongsTo(User, { foreignKey: 'userId', as: 'user' });
    User.hasMany(ServiceBooking, { foreignKey: 'userId', as: 'serviceBookings' });
  }
  if (ServiceBooking && DeliveryPartner) {
    ServiceBooking.belongsTo(DeliveryPartner, { foreignKey: 'assignedPartnerId', as: 'assignedPartner' });
    DeliveryPartner.hasMany(ServiceBooking, { foreignKey: 'assignedPartnerId', as: 'serviceBookings' });
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
      // High-concurrency guards (config/dbSettings.js): statement_timeout (DB_STATEMENT_TIMEOUT_MS,
      // default 30 s, 0 = off) and idle_in_transaction_session_timeout (30 s), sent as connection
      // startup options (never a session SET, so nothing leaks behind a transaction-mode pooler).
      const dialectOptions = dbSettings.getPgTimeoutOptions();
      // DB_SSL (config/dbSettings.js): auto (default) = SSL for hosts with a dot, none for the Render
      // internal host (exactly the old rule); disable / require / verify (+ DB_SSL_CA) override it.
      const ssl = dbSettings.getSslOptions(urlInfo ? urlInfo.hostname : (isInternal ? '' : 'x.y'));
      if (ssl) dialectOptions.ssl = ssl;

      sequelize = new Sequelize(currentUrl, {
        dialect: 'postgres',
        dialectOptions: dialectOptions,
        // DB_POOL_MAX / DB_POOL_MIN / DB_POOL_ACQUIRE_MS / DB_POOL_IDLE_MS / DB_POOL_EVICT_MS
        // (defaults 20 / 4 / 10 s / 10 min / 10 s; config/dbSettings.js).
        pool: dbSettings.getPoolConfig(),
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
        require('../utils/bootTimings').mark('dbConnected');
        console.log(`✅ [DB_SUCCESS] Authenticated successfully with PostgreSQL candidate ${i + 1}.`);
        console.log(`[DB_INIT] ${dbSettings.describe()}`);
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
        console.warn('⚠️ [DB_SYNC_WARN] Database alter sync warning:', syncErr.message);
        console.log('🔄 Retrying standard sync without alter...');
        await sequelize.sync(); 
      }
      await addMissingColumns(sequelize);
      await ensureOrderIdempotencyIndex(sequelize);

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
          { name: 'isOffline', type: 'BOOLEAN DEFAULT 0' },
          { name: 'brandTheme', type: 'TEXT' },
          { name: 'phone', type: 'VARCHAR(255)' },
          { name: 'tokenVersion', type: 'INTEGER DEFAULT 0' },
          { name: 'fcmTokens', type: "TEXT DEFAULT '[]'" },
          { name: 'publishedAt', type: 'DATETIME' },
          { name: 'packagingFee', type: 'FLOAT DEFAULT 0' },
          { name: 'minOrderValue', type: 'FLOAT DEFAULT 0' },
          { name: 'logoUrl', type: 'TEXT' }
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
          { name: 'ownerPhone', type: 'VARCHAR(255)' },
          { name: 'dietType', type: 'VARCHAR(8)' },
          { name: 'originalPrice', type: 'FLOAT' }
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
        
        // Orders new fields migration
        const orderCols = [
          { name: 'isPurchasingApprovedByCustomer', type: 'BOOLEAN DEFAULT 0' },
          { name: 'itemPhotoUrl', type: 'TEXT' },
          { name: 'billProofUrl', type: 'TEXT' },
          { name: 'billAmount', type: 'FLOAT' },
          { name: 'isBillApproved', type: 'BOOLEAN DEFAULT 0' },
          { name: 'category', type: "VARCHAR(255) DEFAULT 'Food'" },
          { name: 'isMultiRestaurant', type: 'BOOLEAN DEFAULT 0' },
          { name: 'pickupStops', type: "TEXT DEFAULT '[]'" },
          { name: 'acceptedAt', type: 'DATETIME' },
          { name: 'readyAt', type: 'DATETIME' },
          { name: 'dropLat', type: 'FLOAT' },
          { name: 'dropLng', type: 'FLOAT' },
          { name: 'fulfilment', type: "VARCHAR(16) DEFAULT 'ZENVY'" },
          { name: 'outForDeliveryAt', type: 'DATETIME' },
          { name: 'refundedAt', type: 'DATETIME' },
          { name: 'stuckFlaggedAt', type: 'DATETIME' },
          { name: 'cancelledBy', type: 'VARCHAR(16)' }
        ];
        for (const col of orderCols) {
          try {
            await sequelize.query(`ALTER TABLE "Orders" ADD COLUMN "${col.name}" ${col.type};`);
            console.log(`✅ [SQLite_MIGRATION] Added ${col.name} column to Orders.`);
          } catch (_err) {}
        }
        
        for (const t of ['Users', 'DeliveryPartners']) {
          try {
            await sequelize.query(`ALTER TABLE "${t}" ADD COLUMN "tokenVersion" INTEGER DEFAULT 0;`);
          } catch (_err) {}
        }

        // WallEvents migration
        try {
          await sequelize.query('ALTER TABLE "WallEvents" ADD COLUMN "bannerText" TEXT;');
          console.log('✅ [SQLite_MIGRATION] Added bannerText column to WallEvents.');
        } catch (_err) {}

        try {
          await sequelize.query('ALTER TABLE "WallEvents" ADD COLUMN "bannerGradient" VARCHAR(255) DEFAULT \'fire\';');
          console.log('✅ [SQLite_MIGRATION] Added bannerGradient column to WallEvents.');
        } catch (_err) {}

        // Friendships new fields migration
        const friendshipCols = [
          { name: 'streakCount', type: 'INTEGER DEFAULT 0' },
          { name: 'lastInteractionAt', type: 'DATETIME' },
          { name: 'theme', type: "VARCHAR(255) DEFAULT 'friendship'" }
        ];
        for (const col of friendshipCols) {
          try {
            await sequelize.query(`ALTER TABLE "Friendships" ADD COLUMN "${col.name}" ${col.type};`);
            console.log(`✅ [SQLite_MIGRATION] Added ${col.name} column to Friendships.`);
          } catch (_err) {}
        }
        // Self-Healing SQLite Migration Guard: Ensure Messages table does not have old foreign key to Conversations
        try {
          const [results] = await sequelize.query("PRAGMA foreign_key_list('Messages');");
          if (results && results.some(r => r.table === 'Conversations')) {
            console.log('🔄 [SQLite] Old foreign key constraint detected on Messages table. Re-creating table...');
            await sequelize.query('DROP TABLE IF EXISTS "Messages";');
            await sequelize.models.Message.sync({ force: true });
            console.log('✅ [SQLite] Messages table re-created without foreign key constraints.');
          }
        } catch (e) {
          console.warn('⚠️ [SQLite_MIGRATION_WARN] Failed checking/dropping Messages foreign keys:', e.message);
        }

        // Campus Buddy self-healing column migrations
        try {
          const { runCampusMigrations } = require('../modules/campus/migrations/campusMigrations');
          await runCampusMigrations(sequelize);
        } catch (mErr) {
          console.warn('⚠️ [CAMPUS_MIGRATION_WARN]', mErr.message);
        }
      }
      // Zenvy Friends: idempotent indexes / columns / checks (every dialect).
      try {
        const { runFriendsMigrations } = require('../modules/friends/migrations/friendsMigrations');
        await runFriendsMigrations(sequelize);
      } catch (fErr) {
        console.warn('⚠️ [FRIENDS_MIGRATION_WARN]', fErr.message);
      }
      // Zenvy Rentals: named unique indexes (additive, idempotent).
      try {
        const { runRentalsMigrations } = require('../modules/rentals/migrations');
        await runRentalsMigrations(sequelize);
      } catch (rErr) {
        console.warn('⚠️ [RENTALS_MIGRATION_WARN]', rErr.message);
      }
      // Zenvy Auto-Ride: named unique / partial unique indexes (race guards; additive, idempotent).
      try {
        const { runAutoRideMigrations } = require('../modules/autoRide/migrations');
        await runAutoRideMigrations(sequelize);
      } catch (aErr) {
        console.warn('⚠️ [AUTORIDE_MIGRATION_WARN]', aErr.message);
      }
      // Zenvy Campus Events: named unique / partial unique indexes (race guards; additive, idempotent).
      try {
        const { runCampusEventsMigrations } = require('../modules/campusEvents/migrations');
        await runCampusEventsMigrations(sequelize);
      } catch (ceErr) {
        console.warn('⚠️ [CAMPUS_EVENTS_MIGRATION_WARN]', ceErr.message);
      }
      // In-Campus Booking: named unique / plain indexes (race guards; additive, idempotent).
      try {
        const { runCampusBookingMigrations } = require('../modules/campusBooking/migrations');
        await runCampusBookingMigrations(sequelize);
      } catch (cbErr) {
        console.warn('⚠️ [CAMPUS_BOOKING_MIGRATION_WARN]', cbErr.message);
      }
      // C5 wallet ledger: named indexes + one-time OPENING_BALANCE rows (additive, idempotent, never
      // changes a balance). Never throws.
      await require('../utils/walletLedger').runWalletLedgerMigrations(sequelize);
      // C6: rider cash ledger indexes, ledger start marker, one-time commission snapshot of unsettled
      // orders (current rate). Additive, idempotent, never changes money. Never throws.
      await require('../utils/financeMigrations').runFinanceMigrations(sequelize);
      // C8: unique index on Orders.receiptNumber (additive, idempotent; no data written). Never throws.
      await require('../utils/receipts').runReceiptMigrations(sequelize);
      // Delivery slots: index on Orders / MegaBaskets slotStart for the rider dispatch job (additive,
      // idempotent; the columns come from the models via addMissingColumns). Never throws.
      await require('../utils/deliverySlots').runDeliverySlotMigrations(sequelize);
    } else {
      // Production: no sync({ alter: true }) on every boot. Sequelize v6 alter re-adds UNIQUE
      // constraints each run (duplicate *_key indexes pile up), slows startup (API is 503 until
      // done) and can change column types on live data. Instead: create missing tables, then add
      // missing columns only (nullable, never altering or dropping anything).
      // Set DB_SYNC_ALTER=true for a one-off full alter sync if ever needed.
      // Skipped when no model changed since the last boot that synced cleanly (fingerprint of every table,
      // column and declared index, kept in "_zcs_schema_state"): sync() + the column check cost a couple of
      // database round trips per model (~100 models, ~180 ms each from Virginia to Seoul), i.e. a minute or
      // more of 503s on every restart / deploy. DB_SYNC_ALWAYS=true forces the full run.
      const fingerprint = schemaFingerprint(sequelize);
      const forceSync = String(process.env.DB_SYNC_ALWAYS || '').toLowerCase() === 'true' || String(process.env.DB_SYNC_ALTER || '').toLowerCase() === 'true';
      if (!forceSync && await schemaUnchanged(sequelize, fingerprint)) {
        console.log('✅ [DB_SYNC] Models unchanged since the last boot: table / column sync skipped.');
      } else {
        let syncOk = true;
        if (String(process.env.DB_SYNC_ALTER || '').toLowerCase() === 'true') {
          try {
            await sequelize.sync({ alter: true });
          } catch (syncErr) {
            syncOk = false;
            console.warn('⚠️ [DB_SYNC_WARN] PostgreSQL alter sync warning:', syncErr.message);
          }
        }
        try {
          await sequelize.sync();
        } catch (normalSyncErr) {
          syncOk = false;
          console.warn('⚠️ [DB_SYNC_WARN] Standard sync warning:', normalSyncErr.message);
        }
        const columns = await addMissingColumns(sequelize);
        // Saved only when everything is in place; otherwise the next boot runs the check again.
        if (syncOk && columns.failed === 0) await saveSchemaFingerprint(sequelize, fingerprint);
      }
      require('../utils/bootTimings').mark('dbSchemaChecked');
      await ensureOrderIdempotencyIndex(sequelize);
      try {
        const { runCampusMigrations } = require('../modules/campus/migrations/campusMigrations');
        await runCampusMigrations(sequelize);
      } catch (mErr) {
        console.warn('⚠️ [CAMPUS_MIGRATION_WARN]', mErr.message);
      }
      // Zenvy Friends: idempotent indexes / columns / CHECK constraints (additive only).
      try {
        const { runFriendsMigrations } = require('../modules/friends/migrations/friendsMigrations');
        await runFriendsMigrations(sequelize);
      } catch (fErr) {
        console.warn('⚠️ [FRIENDS_MIGRATION_WARN]', fErr.message);
      }
      // Zenvy Rentals: named unique indexes (additive, idempotent).
      try {
        const { runRentalsMigrations } = require('../modules/rentals/migrations');
        await runRentalsMigrations(sequelize);
      } catch (rErr) {
        console.warn('⚠️ [RENTALS_MIGRATION_WARN]', rErr.message);
      }
      // Zenvy Auto-Ride: named unique / partial unique indexes (race guards; additive, idempotent).
      try {
        const { runAutoRideMigrations } = require('../modules/autoRide/migrations');
        await runAutoRideMigrations(sequelize);
      } catch (aErr) {
        console.warn('⚠️ [AUTORIDE_MIGRATION_WARN]', aErr.message);
      }
      // Zenvy Campus Events: named unique / partial unique indexes (race guards; additive, idempotent).
      try {
        const { runCampusEventsMigrations } = require('../modules/campusEvents/migrations');
        await runCampusEventsMigrations(sequelize);
      } catch (ceErr) {
        console.warn('⚠️ [CAMPUS_EVENTS_MIGRATION_WARN]', ceErr.message);
      }
      // In-Campus Booking: named unique / plain indexes (race guards; additive, idempotent).
      try {
        const { runCampusBookingMigrations } = require('../modules/campusBooking/migrations');
        await runCampusBookingMigrations(sequelize);
      } catch (cbErr) {
        console.warn('⚠️ [CAMPUS_BOOKING_MIGRATION_WARN]', cbErr.message);
      }
      // C5 wallet ledger: named indexes + one-time OPENING_BALANCE rows (additive, idempotent, never
      // changes a balance). Never throws.
      await require('../utils/walletLedger').runWalletLedgerMigrations(sequelize);
      // C6: rider cash ledger indexes, ledger start marker, one-time commission snapshot of unsettled
      // orders (current rate). Additive, idempotent, never changes money. Never throws.
      await require('../utils/financeMigrations').runFinanceMigrations(sequelize);
      // C8: unique index on Orders.receiptNumber (additive, idempotent; no data written). Never throws.
      await require('../utils/receipts').runReceiptMigrations(sequelize);
      // Delivery slots: index on Orders / MegaBaskets slotStart for the rider dispatch job (additive,
      // idempotent; the columns come from the models via addMissingColumns). Never throws.
      await require('../utils/deliverySlots').runDeliverySlotMigrations(sequelize);
      
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

      // Kitchen timestamps for the restaurant partner app (idempotent; covers a failed alter sync).
      for (const col of ['acceptedAt', 'readyAt']) {
        try {
          await sequelize.query(`ALTER TABLE "Orders" ADD COLUMN IF NOT EXISTS "${col}" TIMESTAMP WITH TIME ZONE;`);
        } catch (err) {
          console.warn(`⚠️ [DB_MIGRATION_WARN] Orders.${col}:`, err.message);
        }
      }
      // Drop coordinates for rider navigation (nullable, idempotent).
      for (const col of ['dropLat', 'dropLng']) {
        try {
          await sequelize.query(`ALTER TABLE "Orders" ADD COLUMN IF NOT EXISTS "${col}" DOUBLE PRECISION;`);
        } catch (err) {
          console.warn(`⚠️ [DB_MIGRATION_WARN] Orders.${col}:`, err.message);
        }
      }
      // 2026-10-12 Zenvy Vendor (stall orders) + admin store wizard + partner push columns.
      // All nullable, all idempotent (ADD COLUMN IF NOT EXISTS), never altering existing data.
      const pgNewCols = [
        ['Orders', 'fulfilment', "VARCHAR(16) DEFAULT 'ZENVY'"],
        ['Orders', 'outForDeliveryAt', 'TIMESTAMP WITH TIME ZONE'],
        ['Restaurants', 'phone', 'VARCHAR(255)'],
        ['Restaurants', 'tokenVersion', 'INTEGER DEFAULT 0'],
        ['Restaurants', 'fcmTokens', "TEXT DEFAULT '[]'"],
        ['Restaurants', 'publishedAt', 'TIMESTAMP WITH TIME ZONE'],
        ['Restaurants', 'packagingFee', 'DOUBLE PRECISION DEFAULT 0'],
        ['Restaurants', 'minOrderValue', 'DOUBLE PRECISION DEFAULT 0'],
        ['Restaurants', 'logoUrl', 'TEXT'],
        ['MenuItems', 'dietType', 'VARCHAR(8)'],
        ['MenuItems', 'originalPrice', 'DOUBLE PRECISION'],
        // 2026-10-13 security sweep: session revocation for customers/admins/riders and a
        // one-shot manual refund marker.
        ['Users', 'tokenVersion', 'INTEGER DEFAULT 0'],
        ['DeliveryPartners', 'tokenVersion', 'INTEGER DEFAULT 0'],
        ['Orders', 'refundedAt', 'TIMESTAMP WITH TIME ZONE'],
        // 2026-10-26 delivery slots (utils/deliverySlots): slot window on orders / shopping lists, the
        // rider release marker, and the specialized-cake flag (2½ h booking lead).
        ['Orders', 'slotStart', 'TIMESTAMP WITH TIME ZONE'],
        ['Orders', 'slotEnd', 'TIMESTAMP WITH TIME ZONE'],
        ['Orders', 'slotDispatchedAt', 'TIMESTAMP WITH TIME ZONE'],
        ['MegaBaskets', 'deliverySlot', 'VARCHAR(255)'],
        ['MegaBaskets', 'slotStart', 'TIMESTAMP WITH TIME ZONE'],
        ['MegaBaskets', 'slotEnd', 'TIMESTAMP WITH TIME ZONE'],
        // 2026-10-27 rider jobs (utils/riderJobs): when riders were told about a shopping list.
        ['MegaBaskets', 'slotDispatchedAt', 'TIMESTAMP WITH TIME ZONE'],
        ['MenuItems', 'isSpecializedCake', 'BOOLEAN DEFAULT false'],
      ];
      for (const [table, col, type] of pgNewCols) {
        try {
          await sequelize.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${col}" ${type};`);
        } catch (err) {
          console.warn(`⚠️ [DB_MIGRATION_WARN] ${table}.${col}:`, err.message);
        }
      }
      try {
        await sequelize.query('CREATE INDEX IF NOT EXISTS "orders_restaurant_id_created_at" ON "Orders" ("restaurantId", "createdAt");');
      } catch (err) {
        console.warn('⚠️ [DB_MIGRATION_WARN] Orders restaurantId+createdAt index:', err.message);
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

      // Drop conversationId foreign key constraint if it exists to allow Rooms & Friendships as conversationIds
      try {
        await sequelize.query('ALTER TABLE "Messages" DROP CONSTRAINT IF EXISTS "Messages_conversationId_fkey";');
        console.log('✅ [DB_MIGRATION] Messages conversationId foreign key constraint dropped.');
      } catch (err) {
        console.warn('⚠️ [DB_MIGRATION_WARN] Failed to drop Messages conversationId constraint:', err.message);
      }

      // Self-Healing: Clear broken /uploads/ birthday photo URLs.
      // Render's filesystem is ephemeral — any file written to /uploads/ is lost on restart.
      // This migration sets those broken paths to NULL so the app shows a clean fallback emoji
      // instead of a broken image. Future uploads are now stored as base64 directly in the DB.
      try {
        const [result] = await sequelize.query(
          `UPDATE "BirthdayCelebrations" 
           SET "candidatePhotoUrl" = NULL 
           WHERE "candidatePhotoUrl" LIKE '/uploads/%'`
        );
        console.log('✅ [DB_MIGRATION] Cleared broken ephemeral /uploads/ birthday photo paths. Rows fixed:', result?.rowCount ?? 'N/A');
      } catch (err) {
        console.warn('⚠️ [DB_MIGRATION_WARN] Could not clear broken birthday photo paths:', err.message);
      }

      // Also clear broken /uploads/ paths from CommunityPosts if any exist
      try {
        await sequelize.query(
          `UPDATE "CommunityPosts" 
           SET "imageUrl" = NULL 
           WHERE "imageUrl" LIKE '/uploads/%'`
        );
        console.log('✅ [DB_MIGRATION] Cleared broken ephemeral /uploads/ community post image paths.');
      } catch (err) {
        // Silently skip if column doesn't exist
      }

      // Also clear broken /uploads/ paths from Users profileImage
      try {
        await sequelize.query(
          `UPDATE "Users" 
           SET "profileImage" = NULL 
           WHERE "profileImage" LIKE '/uploads/%'`
        );
        console.log('✅ [DB_MIGRATION] Cleared broken ephemeral /uploads/ user profile image paths.');
      } catch (err) {
        // Silently skip
      }
    }
    require('../utils/bootTimings').mark('dbMigrationsDone');
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

// Fingerprint of what sync() + addMissingColumns() would create: every model's table, columns (name, type,
// nullability, uniqueness) and declared indexes.
function schemaFingerprint(db) {
  try { return schemaFingerprintOf(db); } catch (err) {
    console.warn('⚠️ [DB_SYNC_WARN] Schema fingerprint failed, running the full sync:', err.message);
    return null;
  }
}
function schemaFingerprintOf(db) {
  const crypto = require('crypto');
  const tableOf = (m) => { const t = m.getTableName(); return typeof t === 'string' ? t : `${t.schema || ''}.${t.tableName}`; };
  const parts = Object.values(db.models)
    .map((m) => JSON.stringify([
      tableOf(m),
      Object.entries(m.rawAttributes).map(([n, a]) => [a.field || n, a.type && (a.type.key || String(a.type)), a.allowNull !== false, a.unique ? 1 : 0, a.primaryKey ? 1 : 0]),
      (m.options.indexes || []).map((i) => [i.name || '', i.fields, !!i.unique]),
    ]))
    .sort();
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}
async function schemaUnchanged(db, fingerprint) {
  if (!fingerprint) return false;
  try {
    const rows = await db.query('SELECT "hash" FROM "_zcs_schema_state" WHERE "id" = 1', { type: require('sequelize').QueryTypes.SELECT });
    return !!(rows && rows[0] && rows[0].hash === fingerprint);
  } catch (_err) {
    return false; // first boot with this code: the table does not exist yet
  }
}
async function saveSchemaFingerprint(db, fingerprint) {
  if (!fingerprint) return;
  try {
    await db.query('CREATE TABLE IF NOT EXISTS "_zcs_schema_state" ("id" INTEGER PRIMARY KEY, "hash" TEXT NOT NULL, "at" TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    await db.query('INSERT INTO "_zcs_schema_state" ("id", "hash", "at") VALUES (1, :h, NOW()) ON CONFLICT ("id") DO UPDATE SET "hash" = EXCLUDED."hash", "at" = NOW()', { replacements: { h: fingerprint } });
  } catch (err) {
    console.warn('⚠️ [DB_SYNC_WARN] Could not save the schema fingerprint:', err.message);
  }
}

// Additive-only schema catch-up: for every model, add columns the table does not have yet
// (nullable, model default when it is a plain value). Never alters types, constraints or indexes.
// Every table's columns come from ONE information_schema query (was a describeTable round trip per model).
// A column that could not be added (e.g. the connection to the database dropped mid-boot) is retried once; the
// result says how many still failed, so the boot does not save the schema fingerprint and the next boot checks
// again (a missing column such as Restaurants.visibleCampuses would otherwise break every query on that table
// until the models changed again).
async function addMissingColumns(db, { retryDelayMs = 1500 } = {}) {
  const qi = db.getQueryInterface();
  let added = 0;
  let columnsByTable = null;
  try {
    const rows = await db.query('SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()', { type: require('sequelize').QueryTypes.SELECT });
    columnsByTable = new Map();
    for (const r of rows) {
      if (!columnsByTable.has(r.table_name)) columnsByTable.set(r.table_name, {});
      columnsByTable.get(r.table_name)[r.column_name] = true;
    }
  } catch (_err) {
    columnsByTable = null; // fall back to one describeTable per model
  }
  const tableName = (table) => (typeof table === 'string' ? table : table.tableName);
  const tryAdd = async (table, field, attr) => {
    const dv = attr.defaultValue;
    const plainDefault = dv === undefined || dv === null || ['string', 'number', 'boolean'].includes(typeof dv);
    try {
      await qi.addColumn(table, field, {
        type: attr.type,
        allowNull: true,
        ...(plainDefault && dv !== undefined ? { defaultValue: dv } : {}),
      });
      console.log(`✅ [DB_MIGRATION] Added ${tableName(table)}.${field}`);
      return true;
    } catch (err) {
      // The first try may have gone through before its answer was lost: the column is there.
      if (/already exists|duplicate column/i.test(String(err && err.message))) return true;
      console.warn(`⚠️ [DB_MIGRATION_WARN] Could not add ${tableName(table)}.${field}:`, err.message);
      return false;
    }
  };
  const pending = [];
  for (const model of Object.values(db.models)) {
    const table = model.getTableName();
    let existing;
    if (columnsByTable && typeof table === 'string') {
      existing = columnsByTable.get(table);
      if (!existing) continue; // table missing (sync() failed for it); nothing safe to do here
    } else {
      try {
        existing = await qi.describeTable(table);
      } catch (_err) {
        continue; // table missing (sync() failed for it); nothing safe to do here
      }
    }
    for (const [name, attr] of Object.entries(model.rawAttributes)) {
      const field = attr.field || name;
      if (existing[field]) continue;
      if (attr.type && attr.type.key === 'VIRTUAL') continue;
      if (await tryAdd(table, field, attr)) added++;
      else pending.push([table, field, attr]);
    }
  }
  let failed = 0;
  if (pending.length) {
    await new Promise((r) => setTimeout(r, retryDelayMs));
    for (const [table, field, attr] of pending) {
      if (await tryAdd(table, field, attr)) added++;
      else failed++;
    }
  }
  if (added === 0 && failed === 0) console.log('✅ [DB_MIGRATION] Schema up to date (no missing columns).');
  if (failed) console.warn(`⚠️ [DB_MIGRATION_WARN] ${failed} column(s) still missing; the schema check runs again on the next boot.`);
  return { added, failed };
}

// One order per (user, Idempotency-Key). Partial index: orders without a key are unaffected.
async function ensureOrderIdempotencyIndex(db) {
  try {
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS "orders_user_idempotency_key" ON "Orders" ("userId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;');
  } catch (err) {
    console.warn('⚠️ [DB_MIGRATION_WARN] Orders idempotency index:', err.message);
  }
  // 2026-10-13 race guards (check-then-insert flows). If old duplicate rows exist the index
  // cannot be built; the routes also guard in code, so this only logs.
  const uniques = [
    ['pool_requests_pool_passenger_unique', 'CREATE UNIQUE INDEX IF NOT EXISTS "pool_requests_pool_passenger_unique" ON "PoolRequests" ("poolId", "passengerId");'],
    // Co-Ride regular rides: one publish per template per IST date (also declared on the model).
    ['ride_template_runs_template_date', 'CREATE UNIQUE INDEX IF NOT EXISTS "ride_template_runs_template_date" ON "RideTemplateRuns" ("templateId", "rideDate");'],
  ];
  for (const [name, sql] of uniques) {
    try {
      await db.query(sql);
    } catch (err) {
      console.warn(`⚠️ [DB_MIGRATION_WARN] ${name}:`, err.message);
    }
  }
  await ensurePgOpenBookingIndex(db);
}

// One open (Pending / Confirmed) PG booking per student per residence. Older double taps can have left
// duplicate open rows; then the index cannot be built. Startup says so clearly, and admins resolve
// them in Admin -> PG & Hostels -> Bookings ("Duplicate open requests"), which retries the index.
const PG_OPEN_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS "pg_bookings_open_unique" ON "PGBookings" ("userId", "hostelId") WHERE "status" IN ('Pending', 'Confirmed');`;
const pgOpenIndexState = { built: null, duplicateGroups: 0, extraRows: 0, error: null, checkedAt: null };

async function countPgOpenDuplicates(db) {
  const rows = await db.query(
    `SELECT COUNT(*) AS n FROM "PGBookings" WHERE "status" IN ('Pending', 'Confirmed') GROUP BY "userId", "hostelId" HAVING COUNT(*) > 1`,
    { type: db.QueryTypes.SELECT },
  );
  return { groups: rows.length, extra: rows.reduce((sum, r) => sum + Number(r.n) - 1, 0) };
}

async function ensurePgOpenBookingIndex(db = sequelize) {
  pgOpenIndexState.checkedAt = new Date().toISOString();
  try {
    await db.query(PG_OPEN_INDEX_SQL);
    Object.assign(pgOpenIndexState, { built: true, duplicateGroups: 0, extraRows: 0, error: null });
  } catch (err) {
    let dup = { groups: 0, extra: 0 };
    try { dup = await countPgOpenDuplicates(db); } catch { /* table missing: keep zeros */ }
    Object.assign(pgOpenIndexState, { built: false, duplicateGroups: dup.groups, extraRows: dup.extra, error: err.message });
    if (dup.groups > 0) {
      console.warn(`⚠️ [PG_BOOKINGS_DUPLICATES] ${dup.groups} student + PG pair(s) have more than one open booking (${dup.extra} extra row(s)), so the one-open-booking guard index "pg_bookings_open_unique" was NOT built. The booking route still refuses new duplicates in code. Resolve them in Admin -> PG & Hostels -> Bookings -> "Duplicate open requests" (it rebuilds the index).`);
    } else {
      console.warn('⚠️ [DB_MIGRATION_WARN] pg_bookings_open_unique:', err.message);
    }
  }
  return { ...pgOpenIndexState };
}

const getPgOpenIndexState = () => ({ ...pgOpenIndexState });

const getSequelize = () => sequelize;

module.exports = { connectDB, getSequelize, ensurePgOpenBookingIndex, getPgOpenIndexState, addMissingColumns };
