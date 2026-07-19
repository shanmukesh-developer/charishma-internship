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
const { initEphemeralPurge } = require('./cron/ephemeralPurge');
// xss-clean removed due to Express 5 query getter incompatibility; custom safeXssMiddleware used instead.

// ── Global Bulletproof Shield (Prevents any Node.js Crash in Dev, Restarts in Prod) ──────────────
process.on('uncaughtException', (err) => {
  console.error('🔥 [CRITICAL] Uncaught Exception:', err.message);
  console.error(err.stack);
  const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  if (isProd) {
    console.error('🔥 Exiting process due to uncaught exception in production...');
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 [CRITICAL] Unhandled Promise Rejection:', reason);
  const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  if (isProd) {
    console.error('🔥 Exiting process due to unhandled promise rejection in production...');
    process.exit(1);
  }
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

// ── Global API Shield (DDoS Protection — Scaled for 500-1000 campus users) ──────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // 2000 requests per IP per 15 min — generous for shared campus Wi-Fi
  message: { message: 'Too many requests from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Order Spam Shield (Per-User via JWT, not just IP) ─────────────────────────────────────────
const orderRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Max 10 order submissions per minute per IP
  message: { message: 'Too many orders placed. Please wait a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Auth Rate Limiter (Generous for shared campus IP) ─────────────────────────
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50, // 50 auth attempts per IP per 15 min — prevents brute force but allows shared WiFi retries
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

    app.get('/auth-helper', (req, res) => {
      res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zenvy Secure Auth Gateway</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #0A0A0B;
      color: #FFFFFF;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      width: 100%;
      max-width: 400px;
      background: rgba(26, 26, 28, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 24px;
      padding: 32px;
      text-align: center;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }
    .logo-container {
      width: 64px;
      height: 64px;
      background: rgba(201, 168, 76, 0.1);
      border: 1px solid rgba(201, 168, 76, 0.3);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      margin: 0 auto 16px auto;
    }
    h1 {
      font-size: 24px;
      font-weight: 900;
      letter-spacing: 2px;
      color: #FFFFFF;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    h1 span {
      color: #C9A84C;
    }
    p.subtitle {
      font-size: 12px;
      color: #9CA3AF;
      margin-bottom: 24px;
    }
    .spinner {
      border: 3px solid rgba(255, 255, 255, 0.1);
      border-radius: 50%;
      border-top: 3px solid #C9A84C;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 20px auto;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .btn-google {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      background-color: #FFFFFF;
      color: #000000;
      border: none;
      padding: 16px;
      border-radius: 14px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.2s;
      margin-bottom: 16px;
    }
    .btn-google:hover {
      background-color: #E5E7EB;
    }
    .divider {
      display: flex;
      align-items: center;
      margin: 20px 0;
    }
    .divider-line {
      flex: 1;
      height: 1px;
      background-color: rgba(255, 255, 255, 0.1);
    }
    .divider-text {
      padding: 0 12px;
      font-size: 11px;
      font-weight: 700;
      color: #6B7280;
    }
    .input-group {
      text-align: left;
      margin-bottom: 20px;
    }
    .input-label {
      font-size: 10px;
      font-weight: 900;
      color: #C9A84C;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      margin-bottom: 8px;
      display: block;
    }
    .input-wrapper {
      display: flex;
      gap: 8px;
    }
    .input-prefix {
      background-color: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 14px;
      padding: 14px;
      color: #9CA3AF;
      font-weight: 700;
      font-size: 14px;
    }
    input {
      flex: 1;
      background-color: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 14px;
      padding: 14px 16px;
      color: #FFFFFF;
      font-size: 14px;
      font-weight: 700;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus {
      border-color: rgba(201, 168, 76, 0.4);
    }
    .btn-submit {
      width: 100%;
      background-color: #C9A84C;
      color: #000000;
      border: none;
      padding: 16px;
      border-radius: 14px;
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(201, 168, 76, 0.2);
      transition: background 0.2s;
    }
    .btn-submit:hover {
      background-color: #E4C875;
    }
    .btn-back {
      width: 100%;
      background-color: rgba(255, 255, 255, 0.05);
      color: #FFFFFF;
      border: none;
      padding: 16px;
      border-radius: 14px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      cursor: pointer;
      transition: background 0.2s;
      margin-top: 12px;
    }
    .btn-back:hover {
      background-color: rgba(255, 255, 255, 0.1);
    }
    .error-container {
      margin-top: 16px;
      padding: 12px;
      background-color: rgba(239, 79, 95, 0.1);
      border: 1px solid rgba(239, 79, 95, 0.2);
      border-radius: 14px;
      color: #EF4F5F;
      font-size: 12px;
      font-weight: 600;
      text-align: center;
    }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="card">
    <div>
      <div class="logo-container">
        ✨
      </div>
      <h1>ZENVY <span>SECURE</span></h1>
      <p id="subtitle" class="subtitle">Authenticating session...</p>
    </div>

    <!-- UI FOR CHOOSING / ERROR -->
    <div id="loading-state" class="hidden">
      <div class="spinner"></div>
      <p style="font-size: 12px; color: #9CA3AF;">Verifying session...</p>
    </div>

    <div id="auth-options">
      <!-- GOOGLE BUTTON -->
      <button onclick="loginWithGoogle()" class="btn-google">
        <svg style="width:18px;height:18px" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v3.92h6.69c-.29 1.5-1.14 2.77-2.4 3.61v3h3.86c2.26-2.09 3.59-5.16 3.59-8.46z"/>
          <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A11.993 11.993 0 0 0 12 24z"/>
          <path fill="#FBBC05" d="M5.27 14.29a7.18 7.18 0 0 1 0-4.58V6.61H1.29a11.993 11.993 0 0 0 0 10.78l3.98-3.1z"/>
          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.93 1.19 15.24 0 12 0 7.33 0 3.29 2.68 1.29 6.61l3.98 3.1c.95-2.85 3.6-4.96 6.73-4.96z"/>
        </svg>
        Continue with Google
      </button>

      <!-- MOCK BYPASS GATEWAY REMOVED FOR PRODUCTION -->
      
      <div class="divider">
        <div class="divider-line"></div>
        <span class="divider-text">OR</span>
        <div class="divider-line"></div>
      </div>

      <!-- PHONE INPUT -->
      <div class="input-group">
        <label class="input-label">Phone Number</label>
        <div class="input-wrapper">
          <span class="input-prefix">+91</span>
          <input id="phone-number" type="tel" placeholder="9876543210" />
        </div>
      </div>

      <div id="recaptcha-container" style="margin-top: 10px;"></div>

      <button id="send-otp-btn" onclick="sendOtp()" class="btn-submit">
        Send Verification SMS
      </button>
    </div>

    <!-- UI FOR ENTERING OTP -->
    <div id="otp-input-state" class="hidden">
      <div class="input-group">
        <label class="input-label" style="text-align: center;">Enter 6-Digit OTP</label>
        <input id="otp-code" type="number" placeholder="123456" style="text-align: center; letter-spacing: 8px; font-size: 18px;" />
      </div>

      <button onclick="verifyOtp()" class="btn-submit">
        Verify & Continue
      </button>
      
      <button onclick="showOptions()" class="btn-back">
        ← Back
      </button>
    </div>

    <!-- ERROR BLOCK -->
    <div id="error-message" class="error-container hidden"></div>
  </div>

  <script type="module">
    window.onerror = function(message, source, lineno, colno, error) {
      document.getElementById('error-message').innerText = "System Error: " + message + " at line " + lineno;
      document.getElementById('error-message').classList.remove('hidden');
    };
    
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
    import { getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult, RecaptchaVerifier, signInWithPhoneNumber } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

    const firebaseConfig = {
      apiKey: "AIzaSyASKW2EosQpJjkZMGILrURhoiP7vhjj8TY",
      authDomain: "hostelbites-c77a8.firebaseapp.com",
      projectId: "hostelbites-c77a8",
      storageBucket: "hostelbites-c77a8.appspot.com",
      messagingSenderId: "785490473159",
      appId: "1:785490473159:web:7e7b7b00cc9e2669000ee2"
    };

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    let confirmationResult = null;

    // Parse phone parameter from URL query if provided
    window.addEventListener('load', async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const queryPhone = urlParams.get('phone');
        if (queryPhone) {
          // Strip +91 if present for raw display in the input
          const cleanPhone = queryPhone.replace('+91', '').trim();
          const phoneInputEl = document.getElementById('phone-number');
          if (phoneInputEl) {
            phoneInputEl.value = cleanPhone;
          }
        }

        // Run redirect checks silently in the background
        const result = await getRedirectResult(auth).catch(() => null);
        if (result && result.user) {
          const token = await result.user.getIdToken();
          sendToApp({ type: 'GOOGLE_SUCCESS', token: token });
        } else {
          // If no redirect user, check if we're already logged in
          if (auth.currentUser) {
            const token = await auth.currentUser.getIdToken();
            sendToApp({ type: 'GOOGLE_SUCCESS', token: token });
          }
        }
      } catch (err) {
        console.warn('Redirect verification error:', err);
      }
    });

    window.bypassOtp = () => {
      const phoneInput = document.getElementById('phone-number').value.trim();
      if (!phoneInput || phoneInput.length < 10) {
        showError("Please enter a valid 10-digit phone number in the field above before bypassing.");
        return;
      }
      const cleanPhone = phoneInput.slice(-10);
      sendToApp({ type: 'OTP_SUCCESS', token: 'E2E_MOCK_TOKEN', phone: cleanPhone });
    };

    window.bypassGoogle = () => {
      sendToApp({ type: 'GOOGLE_SUCCESS', token: 'E2E_MOCK_GOOGLE_TOKEN' });
    };

    window.loginWithGoogle = () => {
      showLoading("Redirecting to Google...");
      signInWithRedirect(auth, provider);
    };

    window.sendOtp = async () => {
      const phoneInput = document.getElementById('phone-number').value.trim();
      if (!phoneInput || phoneInput.length < 10) {
        showError("Please enter a valid 10-digit phone number.");
        return;
      }
      
      // EXCLUSIVE BACKDOOR FOR TESTING RESTAURANTS
      const cleanPhone = phoneInput.slice(-10);
      if (cleanPhone === '9391955675') {
        showLoading("Developer backdoor active! Logging in...");
        setTimeout(() => {
          sendToApp({ type: 'OTP_SUCCESS', token: 'E2E_MOCK_TOKEN', phone: cleanPhone });
        }, 1500);
        return;
      }
      
      showLoading("Initiating security check...");
      try {
        if (!window.recaptchaVerifier) {
          window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
            'size': 'normal',
            'callback': (response) => {}
          });
        }
        
        const fullPhone = "+91" + phoneInput.slice(-10);
        const result = await signInWithPhoneNumber(auth, fullPhone, window.recaptchaVerifier);
        confirmationResult = result;
        
        document.getElementById('loading-state').classList.add('hidden');
        document.getElementById('auth-options').classList.add('hidden');
        document.getElementById('otp-input-state').classList.remove('hidden');
        document.getElementById('subtitle').innerText = "Enter verification code sent to " + fullPhone;
        hideError();
      } catch (err) {
        showError(err.message);
        showOptions();
      }
    };

    window.verifyOtp = async () => {
      const code = document.getElementById('otp-code').value.trim();
      if (!code || code.length < 6) {
        showError("Please enter the 6-digit OTP code.");
        return;
      }
      
      showLoading("Verifying OTP code...");
      try {
        const result = await confirmationResult.confirm(code);
        const token = await result.user.getIdToken();
        const phone = document.getElementById('phone-number').value.trim().slice(-10);
        sendToApp({ type: 'OTP_SUCCESS', token: token, phone: phone });
      } catch (err) {
        showError(err.message || "Invalid OTP code.");
        document.getElementById('loading-state').classList.add('hidden');
        document.getElementById('otp-input-state').classList.remove('hidden');
      }
    };

    window.showOptions = () => {
      document.getElementById('loading-state').classList.add('hidden');
      document.getElementById('otp-input-state').classList.add('hidden');
      document.getElementById('auth-options').classList.remove('hidden');
      document.getElementById('subtitle').innerText = "Choose sign-in method";
    };

    function showLoading(msg) {
      document.getElementById('auth-options').classList.add('hidden');
      document.getElementById('otp-input-state').classList.add('hidden');
      document.getElementById('loading-state').classList.remove('hidden');
      document.getElementById('loading-state').querySelector('p').innerText = msg;
    }

    function showError(msg) {
      const errBlock = document.getElementById('error-message');
      errBlock.innerText = msg;
      errBlock.classList.remove('hidden');
    }

    function hideError() {
      document.getElementById('error-message').classList.add('hidden');
    }

    function sendToApp(data) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(data));
      } else {
        console.log("Not in React Native WebView, payload:", data);
        alert("Authentication Success! Token: " + data.token.slice(0, 20) + "...");
      }
    }
  </script>
</body>
</html>
      `);
    });

    // Routes
    app.use('/api/users', require('./routes/userRoutes'));
    const ticketRoutes = require('./routes/ticketRoutes');
    const testRoutes = require('./routes/testRoutes');
    const systemRoutes = require('./routes/systemRoutes');
    const appConfigRoutes = require('./routes/appConfigRoutes');
    app.use('/api/restaurants', require('./routes/restaurantRoutes'));
    app.use('/api/orders', require('./routes/orderRoutes'));
    app.use('/api/delivery', require('./routes/deliveryPartnerRoutes'));
    app.use('/api/search', require('./routes/searchRoutes'));
    app.use('/api/bikepool', require('./routes/bikePoolRoutes'));
    app.use('/api/pg', require('./routes/pgRoutes'));
    app.use('/api/mega-basket', require('./routes/megaBasketRoutes'));

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
        const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
        if (isProduction) {
          const { getSequelize } = require('./config/db');
          const instance = getSequelize();
          const { seedProduction } = require('./scripts/seed_prod');
          await seedProduction(instance);
        } else {
          const { unifiedSeed: runSeed } = require('./scripts/unified_seed');
          await runSeed();
        }
        return res.json({ message: 'Seeding complete' });
      }
      res.status(403).json({ error: 'Access Denied' });
    });
    app.use('/api/blocks', require('./routes/blockRoutes'));
    app.use('/api/vault', require('./routes/vaultRoutes'));
    app.use('/api/admin', require('./routes/adminRoutes'));
    app.use('/api/rewards', require('./routes/rewardRoutes'));
    app.use('/api/community', require('./routes/communityRoutes'));
    app.use('/api/birthdays', require('./routes/birthdayRoutes'));
    app.use('/api/tickets', ticketRoutes);
    app.use('/api/test', testRoutes);
    app.use('/api/system', systemRoutes);
    app.use('/api/config', appConfigRoutes);
    app.use('/api/features', require('./routes/featureRoutes'));
    app.use('/api/chat', require('./routes/chatRoutes'));
    app.use('/api/friends', require('./routes/friendRoutes'));
    app.use('/api/rooms', require('./routes/roomRoutes'));

    // ── Hourly Cleanup: Delete expired community posts and mark expired birthdays ──────────────────────
    const runExpiryCleanup = async () => {
      try {
        const { getCommunityPostModel } = require('./models/CommunityPost');
        const { getBirthdayCelebrationModel } = require('./models/BirthdayCelebration');
        const { Op: CleanupOp } = require('sequelize');
        
        const CommunityPost = getCommunityPostModel();
        if (CommunityPost) {
          const deleted = await CommunityPost.destroy({
            where: { expiresAt: { [CleanupOp.lt]: new Date() } }
          });
          if (deleted > 0) console.log(`🗑️  [EXPIRY_CLEANUP] Deleted ${deleted} expired community post(s).`);
        }

        const BirthdayCelebration = getBirthdayCelebrationModel();
        if (BirthdayCelebration) {
          const [updated] = await BirthdayCelebration.update(
            { status: 'expired' },
            {
              where: {
                status: 'approved',
                expiresAt: { [CleanupOp.lt]: new Date() }
              }
            }
          );
          if (updated > 0) console.log(`🗑️  [EXPIRY_CLEANUP] Marked ${updated} expired birthday celebration(s) as expired.`);
        }
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
    const activeCallRooms = new Map(); // callRoom -> Map of socketId -> { userId, userName }

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

      // --- Zenvy After Dark Social Engine ---
      
      const isAfterDark = () => {
        return true; // Temporarily unlocked for testing
      };

      socket.on('join_after_dark_group', async (data) => {
        if (!isAfterDark()) return;
        const groupId = `afterdark_${data.groupId}`;
        await socket.join(groupId);
        log(`[AFTER_DARK] User ${socket.user?.id} joined group ${groupId}`);
      });

      socket.on('leave_after_dark_group', async (data) => {
        const groupId = `afterdark_${data.groupId}`;
        await socket.leave(groupId);
        log(`[AFTER_DARK] User ${socket.user?.id} left group ${groupId}`);
      });

      socket.on('send_after_dark_message', async (data) => {
        if (!isAfterDark()) return;
        const { groupId, text } = data;
        const room = `afterdark_${groupId}`;
        
        try {
          const { getMessageModel } = require('./models/Message');
          const Message = getMessageModel();
          const newMsg = await Message.create({
            conversationId: groupId,
            senderId: socket.user.id,
            senderName: data.senderName || 'Anonymous',
            text
          });
          io.to(room).emit('receive_after_dark_message', newMsg);
        } catch (err) {
          console.error('[AFTER_DARK_MSG_ERR]', err);
        }
      });

      // Call Signaling (Limit 20)
      socket.on('join_after_dark_call', (data) => {
        if (!isAfterDark()) return;
        const callRoom = `afterdark_call_${data.groupId}`;
        const userName = data.userName || 'Anonymous';
        
        if (!activeCallRooms.has(callRoom)) {
          activeCallRooms.set(callRoom, new Map());
        }
        const roomMap = activeCallRooms.get(callRoom);
        
        if (roomMap.size >= 20) {
          socket.emit('call_error', { message: 'This lounge is full (Max 20 participants).' });
          return;
        }

        socket.join(callRoom);
        roomMap.set(socket.id, { 
          userId: socket.user?.id || socket.id, 
          socketId: socket.id,
          userName,
          mute: data.mute || false,
          video: data.video || false,
          isSpeaker: data.isSpeaker !== undefined ? data.isSpeaker : true,
          requestToSpeak: false
        });
        
        // Send list of all current participants to the joining user
        const participants = Array.from(roomMap.values());
        io.to(callRoom).emit('call_participants_list', { participants });
        
        // Notify others
        socket.to(callRoom).emit('user_joined_call', { 
          userId: socket.user?.id || socket.id, 
          socketId: socket.id,
          userName,
          mute: data.mute || false,
          video: data.video || false,
          isSpeaker: data.isSpeaker !== undefined ? data.isSpeaker : true,
          requestToSpeak: false
        });
        log(`[AFTER_DARK_CALL] User ${userName} joined call ${callRoom}`);
      });

      socket.on('leave_after_dark_call', (data) => {
        const callRoom = `afterdark_call_${data.groupId}`;
        socket.leave(callRoom);
        
        const roomMap = activeCallRooms.get(callRoom);
        if (roomMap) {
          const p = roomMap.get(socket.id);
          roomMap.delete(socket.id);
          if (roomMap.size === 0) {
            activeCallRooms.delete(callRoom);
          }
          
          const participants = Array.from(roomMap.values());
          io.to(callRoom).emit('call_participants_list', { participants });
          
          socket.to(callRoom).emit('user_left_call', { 
            userId: socket.user?.id || socket.id, 
            socketId: socket.id,
            userName: p?.userName || 'Anonymous'
          });
          log(`[AFTER_DARK_CALL] User ${p?.userName || 'Anonymous'} left call ${callRoom}`);
        }
      });

      socket.on('update_call_state', (data) => {
        const callRoom = `afterdark_call_${data.groupId}`;
        const roomMap = activeCallRooms.get(callRoom);
        if (roomMap && roomMap.has(socket.id)) {
          const participant = roomMap.get(socket.id);
          if (data.mute !== undefined) participant.mute = data.mute;
          if (data.video !== undefined) participant.video = data.video;
          if (data.isSpeaker !== undefined) participant.isSpeaker = data.isSpeaker;
          if (data.requestToSpeak !== undefined) participant.requestToSpeak = data.requestToSpeak;
          
          const participants = Array.from(roomMap.values());
          io.to(callRoom).emit('call_participants_list', { participants });
        }
      });

      socket.on('approve_speaker', (data) => {
        const callRoom = `afterdark_call_${data.groupId}`;
        const roomMap = activeCallRooms.get(callRoom);
        if (roomMap && roomMap.has(data.targetSocketId)) {
          const participant = roomMap.get(data.targetSocketId);
          participant.isSpeaker = true;
          participant.requestToSpeak = false;
          
          const participants = Array.from(roomMap.values());
          io.to(callRoom).emit('call_participants_list', { participants });
          
          io.to(data.targetSocketId).emit('speaker_approved', { groupId: data.groupId });
        }
      });

      socket.on('mute_user', (data) => {
        const callRoom = `afterdark_call_${data.groupId}`;
        const roomMap = activeCallRooms.get(callRoom);
        if (roomMap && roomMap.has(data.targetSocketId)) {
          const participant = roomMap.get(data.targetSocketId);
          participant.mute = true;
          
          const participants = Array.from(roomMap.values());
          io.to(callRoom).emit('call_participants_list', { participants });
          
          io.to(data.targetSocketId).emit('user_muted_by_host', { groupId: data.groupId });
        }
      });
      // --------------------------------------

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
        // Clean up from voice call rooms
        for (const [callRoom, roomMap] of activeCallRooms.entries()) {
          if (roomMap.has(socket.id)) {
            const p = roomMap.get(socket.id);
            roomMap.delete(socket.id);
            if (roomMap.size === 0) {
              activeCallRooms.delete(callRoom);
            }
            socket.to(callRoom).emit('user_left_call', {
              userId: socket.user?.id || socket.id,
              socketId: socket.id,
              userName: p?.userName || 'Anonymous'
            });
            log(`[AFTER_DARK_CALL] User ${p?.userName || 'Anonymous'} disconnected and left call ${callRoom}`);
          }
        }
      });
    });

    const PORT = process.env.PORT || 5005;
    
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is in use. Process probably hasn't exited yet. Shutting down...`);
        process.exit(1); 
      }
    });

    server.listen(PORT, '0.0.0.0', async () => {
      console.log(`🚀 Server running on port ${PORT}`);

      // Auto-backfill missing friendCodes on startup (especially for Render PostgreSQL DB)
      try {
        const { getUserModel } = require('./models/User');
        const User = getUserModel();
        if (User) {
          const users = await User.findAll({ where: { friendCode: null } });
          if (users.length > 0) {
            console.log(`[BOOT] Backfilling friendCode for ${users.length} users...`);
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            for (const user of users) {
              let code = '';
              for (let i = 0; i < 5; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
              }
              user.friendCode = 'ZNV-' + code;
              await user.save();
            }
            console.log('[BOOT] Backfill completed.');
          }
        }
      } catch (err) {
        console.error('[BOOT_ERROR] FriendCode backfill failed:', err.message);
      }

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

// ── Ephemeral Purge (Zenvy After Dark) ──
try {
  initEphemeralPurge();
} catch (e) {
  console.warn('[CRON] Failed to init Ephemeral Purge:', e.message);
}

module.exports = { 
  checkSurgeState, 
  isSurgeActive: (zone) => activeSurgeZones.has(zone), 
  SURGE_MULTIPLIER 
};
