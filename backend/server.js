require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require('socket.io');
const { connectDB } = require('./config/db');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// ── Async Buffered Logger (Non-Blocking) ──────────────────────
const logFile = path.join(__dirname, 'socket_debug.txt');
let logBuffer = [];
let logFlushTimer = null;
const flushLogs = () => {
  if (logBuffer.length === 0) return;
  const batch = logBuffer.join('');
  logBuffer = [];
  fs.appendFile(logFile, batch, () => { /* fire-and-forget */ });
};
const log = (msg) => {
  logBuffer.push(`[${new Date().toISOString()}] ${msg}\n`);
  if (!logFlushTimer) {
    logFlushTimer = setTimeout(() => { logFlushTimer = null; flushLogs(); }, 2000);
  }
};

// Surge Pricing Engine (Zone-Aware) ────────────────────────
const SURGE_WINDOW_MS = 2 * 60 * 1000;
const SURGE_THRESHOLD = 4;
const SURGE_MULTIPLIER = 1.25;

let zoneOrders = {}; // { zoneName: [timestamps] }
let activeSurgeZones = new Set();

function checkSurgeState(io, zone = 'Amaravathi_Central') {
  if (!zoneOrders[zone]) zoneOrders[zone] = [];
  
  const now = Date.now();
  zoneOrders[zone].push(now); // Track incoming order for this zone
  
  // Clean up old timestamps for this zone
  zoneOrders[zone] = zoneOrders[zone].filter(t => now - t < SURGE_WINDOW_MS);
  
  const count = zoneOrders[zone].length;
  const isNowSurge = count >= SURGE_THRESHOLD;
  const wasSurge = activeSurgeZones.has(zone);

  if (!wasSurge && isNowSurge) {
    activeSurgeZones.add(zone);
    io.emit('surge_active', { zone, multiplier: SURGE_MULTIPLIER, orderCount: count });
    log(`[SURGE] Zone ${zone} ACTIVE — ${count} orders`);
  } else if (wasSurge && !isNowSurge) {
    activeSurgeZones.delete(zone);
    io.emit('surge_ended', { zone });
    log(`[SURGE] Zone ${zone} ENDED`);
  }
}

// Periodic cleanup and check for all zones
setInterval(() => {
  const now = Date.now();
  Object.keys(zoneOrders).forEach(zone => {
    const oldCount = zoneOrders[zone].length;
    zoneOrders[zone] = zoneOrders[zone].filter(t => now - t < SURGE_WINDOW_MS);
    if (oldCount >= SURGE_THRESHOLD && zoneOrders[zone].length < SURGE_THRESHOLD) {
      activeSurgeZones.delete(zone);
      if (typeof io !== 'undefined') io.emit('surge_ended', { zone });
      log(`[SURGE] Zone ${zone} ENDED (Timeout)`);
    }
  });
}, 30000);

// Periodic cleanup and check for all zones

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002'
];

// 🌐 Production-Resilient CORS Handler
const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (origin.includes('localhost') || origin.includes('127.0.0.1') || origin.startsWith('capacitor://')) return true;
  // Allow any Render subdomain for this specific project
  if (origin.includes('hostelbites') && origin.endsWith('.onrender.com')) return true;
  if (origin.includes('zenvy') && origin.endsWith('.onrender.com')) return true;
  return false;
};

const app = express();
const rateLimit = require('express-rate-limit');

// ── Global API Shield (DDoS Protection) ──────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 300 requests per `window`
  message: { message: 'Too many requests from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Order Spam Shield ─────────────────────────────────────────
const orderRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Limit each IP to 5 order creation attempts per minute
  message: { message: 'Too many orders placed. Please wait a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply the global rate limiting middleware to all requests starting with /api
app.use('/api/', globalLimiter);
app.post('/api/orders', orderRateLimiter);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true
  },
  connectTimeout: 45000,
  pingTimeout: 20000,
  pingInterval: 25000
});

// 🛡️ Socket.io JWT Authentication Middleware
const jwt = require('jsonwebtoken');
io.use((socket, next) => {
  try {
    let token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
    
    // Check for token in cookies if not found in auth payload or headers
    if (!token && socket.handshake.headers.cookie) {
      const cookieHeader = socket.handshake.headers.cookie;
      const cookies = cookieHeader.split(';').reduce((res, c) => {
        const parts = c.trim().split('=');
        if (parts.length >= 2) {
          try {
            res[parts[0]] = decodeURIComponent(parts[1]);
          } catch (e) {
            res[parts[0]] = parts[1];
          }
        }
        return res;
      }, {});
      token = cookies.token;
    }
    
    if (!token) {
      // Some public endpoints (like global announcements or open basket rooms) 
      // might try to connect without a token. We should allow anonymous sockets but mark them.
      socket.user = { id: 'anonymous', role: 'guest' };
      return next();
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('[SOCKET_AUTH_FATAL] JWT_SECRET not configured. Rejecting all connections.');
      return next(new Error('Server configuration error'));
    }

    const decoded = jwt.verify(token, secret);
    socket.user = decoded; // { id, role }
    next();
  } catch (err) {
    console.warn('[SOCKET_AUTH_WARN] Connection rejected:', err.message);
    next(new Error('Authentication error: Invalid token'));
  }
});

// Make io accessible to routes
app.set('io', io);

// Middleware
app.use(cors({
  origin: function(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', async (req, res) => {
  const { getSequelize } = require('./config/db');
  const instance = getSequelize();
  let dbStatus = 'disconnected';
  
  let dbHost = 'unknown';
  if (instance) {
    try {
      await instance.authenticate();
      dbStatus = 'connected';
      // Safely extract hostname if possible
      const dbUrl = process.env.DATABASE_URL;
      if (dbUrl) {
         try {
           const url = new URL(dbUrl);
           dbHost = `${url.hostname.slice(0, 4)}***${url.hostname.slice(-4)}`;
         } catch { /* ignore */ }
      } else {
        dbHost = 'local-sqlite';
      }
    } catch (err) {
      dbStatus = 'error';
    }
  }

  res.json({ 
    status: 'online', 
    nexus: dbStatus,
    dialect: instance ? instance.getDialect() : 'none',
    host: dbHost,
    timestamp: new Date(),
    uptime: process.uptime()
  });
});
// Static uploads served once below after DB init

// Connect to PostgreSQL, then initialize routes
const startServer = async () => {
  try {
    await connectDB();

    // Routes
    app.use('/api/users', require('./routes/userRoutes'));
    app.use('/api/restaurants', require('./routes/restaurantRoutes'));
    app.use('/api/orders', require('./routes/orderRoutes'));
    app.use('/api/delivery', require('./routes/deliveryPartnerRoutes'));
    app.use('/api/search', require('./routes/searchRoutes'));

    // 🚀 Auto-Seed: DEVELOPMENT ONLY — Never overwrite production data
    const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
    if (!isProduction) {
      const { unifiedSeed } = require('./scripts/unified_seed');
      const { getUserModel } = require('./models/User');
      const User = getUserModel();
      if (User) {
        const userCount = await User.count();
        const { getSequelize } = require('./config/db');
        const instance = getSequelize();
        const Restaurant = instance.models.Restaurant;
        const restCount = Restaurant ? await Restaurant.count() : 0;
        
        if (userCount === 0 || restCount === 0) {
          console.log(`🌱 [AUTO_SEED] Dev data missing (Users: ${userCount}, Rests: ${restCount}). Seeding...`);
          await unifiedSeed();
          console.log('✅ [AUTO_SEED] Development defaults initialized.');
        }
      }
    } else {
      // Production: Auto-seed if database is completely empty (fresh deploy)
      const { getUserModel } = require('./models/User');
      const User = getUserModel();
      if (User) {
        const userCount = await User.count();
        const { getSequelize } = require('./config/db');
        const instance = getSequelize();
        const Restaurant = instance.models.Restaurant;
        const restCount = Restaurant ? await Restaurant.count() : 0;
        const MenuItem = instance.models.MenuItem;
        const menuCount = MenuItem ? await MenuItem.count() : 0;
        if (restCount === 0 || menuCount < 80) {
          console.log(`🌱 [PROD_SEED] Catalog needs seeding (Restaurants: ${restCount}, MenuItems: ${menuCount}). Seeding...`);
          try {
            const seedPath = require('path').join(__dirname, 'scripts', 'seed_full.js');
            delete require.cache[seedPath]; // Clear cache
            // Inline the seed logic instead of running the script (which calls connectDB again)
            const { seedProduction } = require('./scripts/seed_prod');
            await seedProduction(instance);
            console.log('✅ [PROD_SEED] Database seeded successfully!');
          } catch (seedErr) {
            console.warn('⚠️ [PROD_SEED] Auto-seed failed:', seedErr.message);
            console.warn('⚠️ Use POST /api/seed with JWT_SECRET to manually seed.');
          }
        }
      }
    }

    // 🦾 Secure Manual Seed Trigger
    app.post('/api/seed', async (req, res) => {
      const { key } = req.body;
      const seedKey = process.env.SEED_KEY || process.env.JWT_SECRET;
      
      if (!seedKey || seedKey === 'nexus_protocol_9' || seedKey === 'secret') {
        console.error('[SECURITY_ALERT] Attempted to seed with insecure or missing key.');
        return res.status(500).json({ error: 'Server key not configured for seeding' });
      }

      if (key === seedKey) {
        console.log('📥 [MANUAL_SEED] Triggered via API');
        const { unifiedSeed: runSeed } = require('./scripts/unified_seed');
        await runSeed();
        return res.json({ message: 'Seeding complete' });
      }
      res.status(403).json({ error: 'Access Denied' });
    });
    app.use('/api/blocks', require('./routes/blockRoutes'));
    app.use('/api/vault', require('./routes/vaultRoutes'));
    app.use('/api/admin', require('./routes/adminRoutes'));
    app.use('/api/rewards', require('./routes/rewardRoutes'));
    app.use('/api/community', require('./routes/communityRoutes'));
    app.use('/api/tickets', require('./routes/ticketRoutes'));
    app.use('/api/features', require('./routes/featureRoutes'));

    // ── Hourly Cleanup: Delete expired community posts ──────────────────────
    const runExpiryCleanup = async () => {
      try {
        const { getCommunityPostModel } = require('./models/CommunityPost');
        const { Op: CleanupOp } = require('sequelize');
        const CommunityPost = getCommunityPostModel();
        if (!CommunityPost) return;
        const deleted = await CommunityPost.destroy({
          where: { expiresAt: { [CleanupOp.lt]: new Date() } }
        });
        if (deleted > 0) console.log(`🗑️  [EXPIRY_CLEANUP] Deleted ${deleted} expired community post(s).`);
      } catch (e) { console.warn('[EXPIRY_CLEANUP] Error:', e.message); }
    };
    // Run once on startup, then every hour
    runExpiryCleanup();
    setInterval(runExpiryCleanup, 60 * 60 * 1000);
    
    // Global Error Handler
    const { errorHandler } = require('./middleware/errorMiddleware');
    app.use(errorHandler);

    // Serve uploaded files statically
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    app.use('/uploads', express.static(uploadsDir));

    // Persistent Base64 Image Storage (survives on Render)
    const storage = multer.memoryStorage();
    const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
    
    const { protect: protectUpload } = require('./middleware/authMiddleware');
    app.post('/api/upload', protectUpload, upload.single('image'), async (req, res) => {
      let imageUrl = '';
      if (req.file) {
        const mimetype = req.file.mimetype;
        const base64Data = req.file.buffer.toString('base64');
        imageUrl = `data:${mimetype};base64,${base64Data}`;
      } else if (req.body.image) {
        imageUrl = req.body.image.startsWith('data:') ? req.body.image : `data:image/jpeg;base64,${req.body.image}`;
      } else {
        return res.status(400).json({ message: 'No file uploaded' });
      }
      
      // Persist to order if orderId is provided
      const { orderId } = req.body;
      if (orderId) {
        try {
          const { getOrderModel } = require('./models/Order');
          const Order = getOrderModel();
          const order = await Order.findByPk(orderId);
          if (order) {
            await order.update({ proofImage: imageUrl, proofTimestamp: new Date() });
          }
        } catch (err) {
          console.error('[UPLOAD_PERSIST_ERROR]', err);
        }
      }
      
      res.json({ imageUrl });
    });

    // Basic Health Check
    app.get('/', (req, res) => {
      res.status(200).json({ status: 'success', message: 'Zenvy API (PostgreSQL) is running...', version: '2.0.1' });
    });

    // Socket.io
    io.on('connection', (socket) => {
      console.log(`[SOCKET CONNECT] ${socket.id} (User: ${socket.user.id}, Role: ${socket.user.role})`);
      
      socket.on('joinOrder', async (orderId) => {
        const room = String(orderId).trim();
        
        // 🛡️ Permission Check: Only the order creator, assigned rider, or admin can join the room
        try {
          const { getOrderModel } = require('./models/Order');
          const Order = getOrderModel();
          const order = await Order.findByPk(room);
          
          const isOwner = order && order.userId === socket.user.id;
          const isRider = order && order.deliveryPartnerId === socket.user.id;
          const isAdmin = socket.user.role === 'admin';

          if (isOwner || isRider || isAdmin) {
            await socket.join(room);
            log(`[JOIN] ${socket.id} (${socket.user.role}) -> ${room}`);
          } else {
            console.warn(`[SOCKET_AUTH_DENIED] User ${socket.user.id} tried to join room ${room}`);
          }
        } catch (err) {
          console.error('[JOIN_ORDER_ERROR]', err.message);
        }
      });

      socket.on('joinRoom', async (roomName) => {
        const room = String(roomName).trim();
        // Allow general rooms (surges, etc) but restrict sensitive ones if needed
        await socket.join(room);
        log(`[JOIN_ROOM] ${socket.id} -> ${room}`);
      });

      socket.on('cart_change', (data) => {
        const room = String(data.roomCode).trim();
        socket.to(room).emit('cart_updated', data.cart);
        log(`[CART_SYNC] Room ${room} sync: ${data.cart?.length || 0} items`);
      });

      socket.on('joinAdmin', async () => {
        // 🛡️ Permission Check: Strictly Admin Only
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'admin') {
          await socket.join('admin-room');
          log(`[JOIN_ADMIN] ${socket.id}`);
        } else {
          console.warn(`[SOCKET_ADMIN_DENIED] Unauthorized joinAdmin attempt by ${socket.user?.id}`);
        }
      });
      socket.on('updateLocation', (data) => {
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'rider') {
          const room = String(data.orderId).trim();
          io.to(room).emit('checkpointUpdated', { currentCheckpoint: data.currentCheckpoint });
          log(`[CHECKPOINT] ${data.orderId} → ${data.currentCheckpoint}`);
        } else {
          console.warn(`[SOCKET_DENIED] Unauthorized location update by ${socket.user?.id}`);
        }
      });
      
      socket.on('sos_alert', (data) => {
        log(`[CRITICAL SOS] Triggered by ${data.riderName} (ID: ${data.riderId}) at ${data.timestamp}`);
        io.to('admin-room').emit('sos_received', data);
      });

      socket.on('admin_broadcast', (data) => {
        // 🛡️ Permission Check: Admin Only
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'admin') {
          log(`[MEGAPHONE] Admin broadcast: "${data.message}" (type: ${data.type})`);
          io.emit('global_announcement', data);
        } else {
          console.warn(`[SOCKET_BROADCAST_DENIED] Unauthorized broadcast by ${socket.user?.id}`);
        }
      });

      socket.on('inventory_update', (data) => {
        log(`[INVENTORY] Item ${data.itemId} is now ${data.isAvailable ? 'available' : 'SOLD OUT'}`);
        io.emit('inventory_updated', data);
      });

      socket.on('typing_start', (data) => {
        socket.to(String(data.orderId)).emit('typing_start', { sender: data.sender });
      });

      socket.on('typing_end', (data) => {
        socket.to(String(data.orderId)).emit('typing_end', { sender: data.sender });
      });

      socket.on('sendMessage', (data) => {
        const room = String(data.orderId).trim();
        log(`[CHAT] ${data.senderRole} (${data.sender}) in room ${room}: ${data.message}`);
        io.to(room).emit('receiveMessage', {
          sender: data.sender,
          senderRole: data.senderRole,
          message: data.message,
          timestamp: new Date()
        });
      });

      socket.on('report_issue', (data) => {
        const room = String(data.orderId).trim();
        log(`[ISSUE] ${data.senderRole} reported: ${data.issueType} for order ${room}`);
        // Notify both parties in the room and the admin
        io.to(room).emit('issue_alert', {
          orderId: data.orderId,
          senderRole: data.senderRole,
          issueType: data.issueType,
          details: data.details,
          timestamp: new Date()
        });
        io.to('admin-room').emit('admin_issue_reported', data);
      });

      // ── F6: Group Order Polls ────────────────────
      socket.on('poll_create', (data) => {
        const room = String(data.roomCode).trim();
        const poll = {
          id: `poll_${Date.now()}`,
          question: data.question || 'Where should we order from?',
          options: data.options || [],
          votes: {},
          createdBy: socket.user?.id || 'anonymous',
          createdAt: new Date().toISOString()
        };
        io.to(room).emit('poll_started', poll);
        log(`[POLL] Created in room ${room}: "${poll.question}"`);
      });

      socket.on('poll_vote', (data) => {
        const room = String(data.roomCode).trim();
        io.to(room).emit('poll_vote_update', {
          pollId: data.pollId,
          optionIndex: data.optionIndex,
          voterId: socket.user?.id || 'anonymous',
          voterName: data.voterName || 'Someone'
        });
        log(`[POLL_VOTE] ${data.voterName} voted option ${data.optionIndex} in ${room}`);
      });

      socket.on('poll_end', (data) => {
        const room = String(data.roomCode).trim();
        io.to(room).emit('poll_ended', {
          pollId: data.pollId,
          winnerIndex: data.winnerIndex,
          winnerOption: data.winnerOption
        });
        log(`[POLL_END] Winner in ${room}: "${data.winnerOption}"`);
      });

      // ── Cross-Portal: Rider ↔ Admin ↔ Customer ────────────────

      // Rider came online: broadcast to admin dashboard
      socket.on('rider_connected', (data) => {
        log(`[RIDER ONLINE] ${data.name} (${data.driverId})`);
        io.to('admin-room').emit('admin_rider_online', { riderId: data.driverId, name: data.name, timestamp: new Date().toISOString() });
      });

      // Rider went offline
      socket.on('rider_disconnected', (data) => {
        log(`[RIDER OFFLINE] ${data.driverId}`);
        io.to('admin-room').emit('admin_rider_offline', { riderId: data.driverId, timestamp: new Date().toISOString() });
      });

      // Rider toggled online/offline status
      socket.on('rider_status_change', (data) => {
        log(`[RIDER STATUS] ${data.name} → ${data.isOnline ? 'ONLINE' : 'OFFLINE'}`);
        io.to('admin-room').emit('admin_rider_status', { riderId: data.riderId, name: data.name, isOnline: data.isOnline });
      });

      // Rider accepted → notify admin + join the broadcast room
      socket.on('rider_accepted', async (data) => {
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'rider') {
          const room = String(data.orderId).trim();
          await socket.join(room);
          log(`[RIDER ACCEPTED] ${data.riderName} accepted order ${data.orderId}`);
          io.to('admin-room').emit('admin_order_accepted', { orderId: data.orderId, riderId: data.riderId, riderName: data.riderName });
        }
      });

      // Rider live GPS → admin map + customer tracking (already via updateLocation, this is admin stream)
      socket.on('rider_location_update', (data) => {
        // Broadcast checkpoint to admin dashboard room ONLY
        io.to('admin-room').emit('admin_rider_location', {
          riderId: data.riderId,
          riderName: data.riderName,
          currentCheckpoint: data.currentCheckpoint,
          activeOrderCount: data.activeOrderCount,
          isOnline: data.isOnline,
          timestamp: Date.now()
        });
        // Also emit to specific order room for customer tracking
        if (data.activeOrderId) {
            io.to(String(data.activeOrderId)).emit('checkpointUpdated', { currentCheckpoint: data.currentCheckpoint });
        }
        log(`[GPS] Rider ${data.riderName} at ${data.currentCheckpoint}`);
      });

      // Rider completed a delivery
      socket.on('rider_delivered', (data) => {
        log(`[DELIVERED] ${data.riderName} completed order ${data.orderId} (+₹${data.earnings})`);
        io.to('admin-room').emit('admin_delivery_complete', {
          orderId: data.orderId,
          riderId: data.riderId,
          riderName: data.riderName,
          earnings: data.earnings,
          timestamp: new Date().toISOString()
        });
      });

      socket.on('disconnect', () => {
        console.log(`[SOCKET DISCONNECT] ${socket.id}`);
      });
    });

    const PORT = process.env.PORT || 5005;
    
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is in use. Process probably hasn't exited yet. Shutting down...`);
        process.exit(1); 
      }
    });

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);

      // ── Self-Ping Keep-Alive (Prevents Render Free Tier Sleep) ──
      if (process.env.NODE_ENV === 'production' || process.env.RENDER === 'true') {
        const KEEP_ALIVE_INTERVAL = 14 * 60 * 1000; // 14 minutes (Render sleeps at 15 min)
        const selfUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
        setInterval(async () => {
          try {
            const https = require('https');
            const httpModule = require('http');
            const mod = selfUrl.startsWith('https') ? https : httpModule;
            mod.get(`${selfUrl}/api/health`, (res) => {
              console.log(`[KEEP_ALIVE] Ping OK (${res.statusCode})`);
            }).on('error', (err) => {
              console.warn('[KEEP_ALIVE] Ping failed:', err.message);
            });
          } catch (err) {
            console.warn('[KEEP_ALIVE] Error:', err.message);
          }
        }, KEEP_ALIVE_INTERVAL);
        console.log(`🏓 Keep-alive enabled: pinging every ${KEEP_ALIVE_INTERVAL / 60000} minutes`);
      }
    });
  } catch (error) {
    console.error('❌ Server failed to start. CRITICAL ERROR:');
    console.error(error);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
};

startServer();

// ── F2: Scheduled Push Campaigns (Daily abandoned cart nudge at 10 AM) ──
try {
  const cron = require('node-cron');
  cron.schedule('0 10 * * *', async () => {
    console.log('[CRON] Running daily abandoned cart nudge...');
    try {
      const http = require('http');
      const port = process.env.PORT || 5005;
      const options = { hostname: 'localhost', port, path: '/api/features/push/abandoned-cart', method: 'POST' };
      const req = http.request(options, (res) => {
        console.log(`[CRON] Abandoned cart nudge response: ${res.statusCode}`);
      });
      req.on('error', (e) => console.warn('[CRON] Nudge failed:', e.message));
      req.end();
    } catch (e) { console.warn('[CRON] Error:', e.message); }
  });
  console.log('⏰ [CRON] Daily abandoned cart nudge scheduled at 10:00 AM');
} catch (e) {
  console.warn('[CRON] node-cron not available, skipping scheduled jobs');
}

// ── Restaurant out-of-stock auto-restore periodic check ──
setInterval(async () => {
  try {
    const { getMenuItemModel } = require('./models/MenuItem');
    const MenuItem = getMenuItemModel();
    const { Op } = require('sequelize');
    
    const expiredItems = await MenuItem.findAll({
      where: {
        isAvailable: false,
        outOfStockUntil: {
          [Op.ne]: null,
          [Op.lte]: new Date()
        }
      }
    });

    if (expiredItems.length > 0) {
      console.log(`[AUTO-RESTORE] Restoring ${expiredItems.length} menu items...`);
      for (const item of expiredItems) {
        item.isAvailable = true;
        item.outOfStockUntil = null;
        await item.save();

        // Broadcast to clients via Socket.io
        io.emit('inventory_updated', { itemId: item.id, isAvailable: true });
        console.log(`[AUTO-RESTORE] Restored item: ${item.name} (${item.id})`);
      }
    }
  } catch (err) {
    console.warn('[AUTO-RESTORE_ERROR] Failed to run auto-restore:', err.message);
  }
}, 30000); // Check every 30 seconds

module.exports = { 
  checkSurgeState, 
  isSurgeActive: (zone) => activeSurgeZones.has(zone), 
  SURGE_MULTIPLIER 
};
