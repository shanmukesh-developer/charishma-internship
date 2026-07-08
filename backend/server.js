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
const helmet = require('helmet');
const morgan = require('morgan');
// xss-clean removed due to Express 5 query getter incompatibility; custom safeXssMiddleware used instead.

// ── Global Bulletproof Shield (Prevents any Node.js Crash) ──────────────
process.on('uncaughtException', (err) => {
  console.error('🔥 [CRITICAL] Uncaught Exception Blocked:', err.message);
  console.error(err.stack);
  // Do NOT exit process. This guarantees the server stays alive.
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 [CRITICAL] Unhandled Promise Rejection Blocked:', reason);
  // Do NOT exit process.
});

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

// Enable trust proxy to correctly identify client IPs behind reverse proxies (like Render, Nginx, or Cloudflare)
app.set('trust proxy', 1);

const rateLimit = require('express-rate-limit');

// ── Global API Shield (DDoS Protection — Scaled for 500+ campus users) ──────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 99999999, // User requested no limits for maximum smoothness
  message: { message: 'Too many requests from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Order Spam Shield (Per-User via JWT, not just IP) ─────────────────────────────────────────
const orderRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 99999999, // User requested no limits for maximum smoothness
  message: { message: 'Too many orders placed. Please wait a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Auth Rate Limiter (Generous for shared campus IP) ─────────────────────────
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 99999999, // User requested no limits for maximum smoothness
  message: { message: 'Too many authentication attempts, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Export auth limiter for routes to use
app.set('authRateLimiter', authRateLimiter);

// Apply the global rate limiting middleware to all requests starting with /api
app.use('/api/', globalLimiter);
app.post('/api/orders', orderRateLimiter);
const server = http.createServer(app);

// ── High-Concurrency Server Tuning ──────────────────────
server.maxConnections = 2000; // Allow 2000 simultaneous TCP connections
server.keepAliveTimeout = 65000; // Keep connections alive (must be > nginx/ALB timeout)
server.headersTimeout = 70000; // Must be > keepAliveTimeout

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
  // ── Socket.io Tuning for 500+ Concurrent Connections ──
  connectTimeout: 45000,
  pingTimeout: 30000,    // Increased from 20s — prevents false disconnects on slow campus Wi-Fi
  pingInterval: 25000,
  maxHttpBufferSize: 1e6, // 1MB max message size
  perMessageDeflate: { threshold: 1024 }, // Compress messages > 1KB to save bandwidth
  transports: ['websocket', 'polling'], // Prefer WebSocket, fallback to polling
  allowUpgrades: true
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
app.use(helmet({
  crossOriginResourcePolicy: false, // Allows cross-origin image loading
}));
app.use(morgan('combined')); // Enterprise-grade API logging
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
app.use(compression({ level: 6, threshold: 512 })); // Compress responses > 512 bytes
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));

// Custom In-Place XSS Sanitizer to prevent TypeError on Express 5 read-only req.query/req.params properties
const sanitizeXSS = (data) => {
  if (typeof data === 'string') {
    return data
      .replace(/<script[^>]*>([\S\s]*?)<\/script>/gi, '')
      .replace(/<[^>]*>?/gm, '');
  }
  if (Array.isArray(data)) {
    return data.map(sanitizeXSS);
  }
  if (typeof data === 'object' && data !== null) {
    const cleanObj = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        cleanObj[key] = sanitizeXSS(data[key]);
      }
    }
    return cleanObj;
  }
  return data;
};

app.use((req, res, next) => {
  if (req.body) {
    req.body = sanitizeXSS(req.body);
  }
  if (req.query) {
    for (const key in req.query) {
      if (Object.prototype.hasOwnProperty.call(req.query, key)) {
        req.query[key] = sanitizeXSS(req.query[key]);
      }
    }
  }
  if (req.params) {
    for (const key in req.params) {
      if (Object.prototype.hasOwnProperty.call(req.params, key)) {
        req.params[key] = sanitizeXSS(req.params[key]);
      }
    }
  }
  next();
});

// ── Response Caching for Static Data (Menu, Restaurants) ──────────────────────
app.use((req, res, next) => {
  // Cache GET requests for restaurant listings and menus (reduces DB load under 500+ users)
  if (req.method === 'GET' && (req.path.startsWith('/api/restaurants') || req.path.startsWith('/api/search'))) {
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60'); // 30s fresh, 60s stale OK
  }
  next();
});

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
    app.use('/api/bikepool', require('./routes/bikePoolRoutes'));
    app.use('/api/pg', require('./routes/pgRoutes'));

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
      // Production: Auto-seed if database is empty or critically low on data
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
        const PGHostel = instance.models.PGHostel;
        const pgCount = PGHostel ? await PGHostel.count() : 0;
        // Trigger seed if DB is empty OR critically low (partial data loss)
        if (menuCount < 5 || pgCount === 0) {
          console.log(`🌱 [PROD_SEED] Data critically low (Restaurants: ${restCount}, MenuItems: ${menuCount}, Users: ${userCount}, PGs: ${pgCount}). Re-seeding...`);
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
    const upload = multer({ 
      storage, 
      limits: { fileSize: 2 * 1024 * 1024 }, // Enforce 2MB size limit server-side
      fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('Only JPEG, PNG, and WEBP image formats are allowed.'));
        }
      }
    });
    
    const { protect: protectUpload } = require('./middleware/authMiddleware');
    app.post('/api/upload', protectUpload, (req, res, next) => {
      upload.single('image')(req, res, (err) => {
        if (err) {
          return res.status(400).json({ message: err.message });
        }
        next();
      });
    }, async (req, res) => {
      let imageUrl = '';
      if (req.file) {
        const mimetype = req.file.mimetype;
        const base64Data = req.file.buffer.toString('base64');
        imageUrl = `data:${mimetype};base64,${base64Data}`;
      } else if (req.body.image) {
        // Enforce size check on direct base64 body uploads too
        if (Buffer.byteLength(req.body.image, 'base64') > 2 * 1024 * 1024) {
          return res.status(400).json({ message: 'Image size exceeds 2MB limit' });
        }
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
    const activeCartRooms = new Map(); // roomCode -> Set of userId

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
        // 🛡️ Security Check: Prevent anonymous or arbitrary hijacking of cart rooms
        if (room.startsWith('ZN-')) {
          const userId = (socket.user && socket.user.id !== 'anonymous') ? socket.user.id : socket.id;
          if (!activeCartRooms.has(room)) {
            activeCartRooms.set(room, new Set());
          }
          activeCartRooms.get(room).add(userId);
          socket.effectiveCartId = userId;
        }
        await socket.join(room);
        log(`[JOIN_ROOM] ${socket.id} -> ${room}`);
      });

      socket.on('cart_change', (data) => {
        const room = String(data.roomCode).trim();
        // 🛡️ Security Check: Validate that emitter belongs to the cart room
        if (room.startsWith('ZN-')) {
          const members = activeCartRooms.get(room);
          const userId = socket.effectiveCartId || (socket.user && socket.user.id !== 'anonymous' ? socket.user.id : socket.id);
          if (!members || !members.has(userId)) {
            console.warn(`[SOCKET_DENIED] User ${userId} not authorized to broadcast to room ${room}`);
            return;
          }
        }
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
      socket.on('updateLocation', async (data) => {
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'rider') {
          const room = String(data.orderId).trim();
          try {
            const { getOrderModel } = require('./models/Order');
            const Order = getOrderModel();
            const order = await Order.findByPk(room);
            if (order && order.deliveryPartnerId === socket.user.id) {
              io.to(room).emit('checkpointUpdated', { currentCheckpoint: data.currentCheckpoint });
              log(`[CHECKPOINT] ${data.orderId} → ${data.currentCheckpoint}`);
            } else {
              console.warn(`[SOCKET_DENIED] Rider ${socket.user.id} not assigned to order ${room} for location update`);
            }
          } catch (err) {
            console.error('[SOCKET_UPDATE_LOCATION_ERROR]', err.message);
          }
        } else {
          console.warn(`[SOCKET_DENIED] Unauthorized location update by ${socket.user?.id}`);
        }
      });
      
      socket.on('sos_alert', (data) => {
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'rider' && data.riderId === socket.user.id) {
          log(`[CRITICAL SOS] Triggered by ${data.riderName} (ID: ${data.riderId}) at ${data.timestamp}`);
          io.to('admin-room').emit('sos_received', data);
        } else {
          console.warn(`[SOCKET_DENIED] Unauthorized sos_alert attempt by user ${socket.user?.id}`);
        }
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
        // 🛡️ Security Check: Force senderRole to match the socket's authenticated user role
        let verifiedRole = 'customer';
        if (socket.user && socket.user.role) {
          const role = socket.user.role.toLowerCase();
          if (role === 'rider') verifiedRole = 'rider';
          else if (role === 'admin') verifiedRole = 'admin';
        }
        log(`[CHAT] ${verifiedRole} (${data.sender}) in room ${room}: ${data.message}`);
        const chatData = {
          orderId: room,
          sender: data.sender,
          senderRole: verifiedRole,
          message: data.message,
          timestamp: new Date()
        };
        io.to(room).emit('receiveMessage', chatData);
        // Intercept for admin monitoring
        io.to('admin-room').emit('admin_intercept_chat', chatData);
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
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'rider' && data.driverId === socket.user.id) {
          log(`[RIDER ONLINE] ${data.name} (${data.driverId})`);
          io.to('admin-room').emit('admin_rider_online', { riderId: data.driverId, name: data.name, timestamp: new Date().toISOString() });
        } else {
          console.warn(`[SOCKET_DENIED] Unauthorized rider_connected attempt by user ${socket.user?.id}`);
        }
      });

      // Rider went offline
      socket.on('rider_disconnected', (data) => {
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'rider' && data.driverId === socket.user.id) {
          log(`[RIDER OFFLINE] ${data.driverId}`);
          io.to('admin-room').emit('admin_rider_offline', { riderId: data.driverId, timestamp: new Date().toISOString() });
        } else {
          console.warn(`[SOCKET_DENIED] Unauthorized rider_disconnected attempt by user ${socket.user?.id}`);
        }
      });

      // Rider toggled online/offline status
      socket.on('rider_status_change', (data) => {
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'rider' && data.riderId === socket.user.id) {
          log(`[RIDER STATUS] ${data.name} → ${data.isOnline ? 'ONLINE' : 'OFFLINE'}`);
          io.to('admin-room').emit('admin_rider_status', { riderId: data.riderId, name: data.name, isOnline: data.isOnline });
        } else {
          console.warn(`[SOCKET_DENIED] Unauthorized rider_status_change attempt by user ${socket.user?.id}`);
        }
      });

      // Rider accepted → notify admin + join the broadcast room
      socket.on('rider_accepted', async (data) => {
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'rider' && data.riderId === socket.user.id) {
          const room = String(data.orderId).trim();
          await socket.join(room);
          log(`[RIDER ACCEPTED] ${data.riderName} accepted order ${data.orderId}`);
          io.to('admin-room').emit('admin_order_accepted', { orderId: data.orderId, riderId: data.riderId, riderName: data.riderName });
        } else {
          console.warn(`[SOCKET_DENIED] Unauthorized rider_accepted attempt by user ${socket.user?.id}`);
        }
      });

      // Rider live GPS → admin map + customer tracking (already via updateLocation, this is admin stream)
      socket.on('rider_location_update', async (data) => {
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'rider' && data.riderId === socket.user.id) {
          // Verify activeOrderId if provided
          if (data.activeOrderId) {
            try {
              const { getOrderModel } = require('./models/Order');
              const Order = getOrderModel();
              const order = await Order.findByPk(String(data.activeOrderId).trim());
              if (!order || order.deliveryPartnerId !== socket.user.id) {
                console.warn(`[SOCKET_DENIED] Rider ${socket.user.id} tried to update location for unauthorized order ${data.activeOrderId}`);
                return;
              }
            } catch (err) {
              console.error('[SOCKET_RIDER_LOCATION_UPDATE_ERROR]', err.message);
              return;
            }
          }

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
        } else {
          console.warn(`[SOCKET_DENIED] Unauthorized rider_location_update by user ${socket.user?.id}`);
        }
      });

      // Rider completed a delivery
      socket.on('rider_delivered', async (data) => {
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'rider' && data.riderId === socket.user.id) {
          try {
            const { getOrderModel } = require('./models/Order');
            const Order = getOrderModel();
            const order = await Order.findByPk(String(data.orderId).trim());
            if (order && order.deliveryPartnerId === socket.user.id) {
              log(`[DELIVERED] ${data.riderName} completed order ${data.orderId} (+₹${data.earnings})`);
              io.to('admin-room').emit('admin_delivery_complete', {
                orderId: data.orderId,
                riderId: data.riderId,
                riderName: data.riderName,
                earnings: data.earnings,
                timestamp: new Date().toISOString()
              });
            } else {
              console.warn(`[SOCKET_DENIED] Rider ${socket.user.id} not assigned to order ${data.orderId} for delivery completion`);
            }
          } catch (err) {
            console.error('[SOCKET_RIDER_DELIVERED_ERROR]', err.message);
          }
        } else {
          console.warn(`[SOCKET_DENIED] Unauthorized rider_delivered attempt by user ${socket.user?.id}`);
        }
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

    // ── Graceful Shutdown (Prevents 500+ user connection drops) ──────────────────────
    const gracefulShutdown = (signal) => {
      console.log(`\n🛑 [SHUTDOWN] ${signal} received. Closing server gracefully...`);
      server.close(() => {
        console.log('✅ [SHUTDOWN] HTTP server closed. Cleaning up...');
        io.close(() => {
          console.log('✅ [SHUTDOWN] Socket.io closed.');
          process.exit(0);
        });
      });
      // Force kill after 10 seconds if graceful shutdown hangs
      setTimeout(() => {
        console.error('💀 [SHUTDOWN] Forced exit after 10s timeout');
        process.exit(1);
      }, 10000);
    };
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

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
    if (!MenuItem) return;
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
