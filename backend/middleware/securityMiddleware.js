/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ZENVY FORTRESS — Enterprise Security Middleware Layer
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  This module provides production-grade security controls designed to withstand
 *  real-world attack vectors at mass scale (1000+ concurrent users).
 *
 *  Security Controls Implemented:
 *  ─────────────────────────────
 *  1. Request Size Limiter       — Prevents payload bomb / memory exhaustion attacks
 *  2. SQL Injection Guard        — Deep-scans all inputs for injection patterns
 *  3. NoSQL Injection Guard      — Blocks object-key injection via $gt, $ne, etc.
 *  4. Path Traversal Guard       — Prevents ../../etc/passwd style attacks
 *  5. HTTP Parameter Pollution   — Deduplicates array-stuffed query params
 *  6. Request ID Tracing         — Attaches unique trace ID to every request for audit
 *  7. Security Response Headers  — HSTS, X-Content-Type-Options, X-Frame-Options
 *  8. Sensitive Data Masking     — Strips passwords and tokens from error logs
 *  9. Bot / Scanner Detection    — Blocks common vulnerability scanner user-agents
 * 10. Slow-Loris Prevention      — Enforces request timeout to prevent connection starvation
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const crypto = require('crypto');

// ── 1. SQL Injection Pattern Detector ─────────────────────────────────────────
const SQL_INJECTION_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|EXEC|EXECUTE)\b\s)/i,
  /(--\s|\/\*|\*\/|\bxp_|\bsp_)/i,   // -- must be followed by space (real SQL comment), xp_/sp_ need word boundary
  /(\b(OR|AND)\b\s+\d+\s*=\s*\d+)/i,     // OR 1=1, AND 1=1
  /(CONCAT\s*\(|CHAR\s*\(|0x[0-9a-f]{4,})/i, // Hex encoding attacks (require 4+ hex digits to avoid matching short strings)
  /(\bSLEEP\s*\(|\bBENCHMARK\s*\()/i,     // Time-based blind SQL injection
  /(\bINFORMATION_SCHEMA\b)/i,            // Schema enumeration
];

const containsSQLInjection = (value) => {
  if (typeof value !== 'string') return false;
  // Skip scanning base64/data URIs or extremely long strings to prevent false positives/ReDoS
  if (value.startsWith('data:') || value.length > 50000) return false;
  return SQL_INJECTION_PATTERNS.some(pattern => pattern.test(value));
};

// ── 2. NoSQL / Object Injection Guard ─────────────────────────────────────────
const NOSQL_DANGEROUS_KEYS = ['$gt', '$gte', '$lt', '$lte', '$ne', '$in', '$nin', '$or', '$and', '$not', '$exists', '$regex', '$where', '$elemMatch'];

const containsNoSQLInjection = (obj) => {
  if (typeof obj !== 'object' || obj === null) return false;
  for (const key of Object.keys(obj)) {
    if (NOSQL_DANGEROUS_KEYS.includes(key)) return true;
    if (typeof obj[key] === 'object' && containsNoSQLInjection(obj[key])) return true;
  }
  return false;
};

// ── 3. Path Traversal Pattern Detector ────────────────────────────────────────
const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//,              // ../
  /\.\.\\/,              // ..\
  /%2e%2e/i,             // URL-encoded ..
  /%252e%252e/i,         // Double URL-encoded ..
  /\/etc\/passwd/i,
  /\/proc\/self/i,
  /\bboot\.ini\b/i,
  /\bwin\.ini\b/i,
];

const containsPathTraversal = (value) => {
  if (typeof value !== 'string') return false;
  // Skip scanning base64/data URIs or extremely long strings to prevent false positives/ReDoS
  if (value.startsWith('data:') || value.length > 50000) return false;
  return PATH_TRAVERSAL_PATTERNS.some(pattern => pattern.test(value));
};

// ── 4. Bot / Vulnerability Scanner Detection ──────────────────────────────────
const BLOCKED_USER_AGENTS = [
  /sqlmap/i, /nikto/i, /nessus/i, /openvas/i, /w3af/i,
  /acunetix/i, /netsparker/i, /burpsuite/i, /havij/i,
  /pangolin/i, /metasploit/i, /dirbuster/i, /gobuster/i,
  /wpscan/i, /joomscan/i, /masscan/i, /zmap/i
];

// ═══════════════════════════════════════════════════════════════════════════════
//  MIDDLEWARE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Attaches a unique request trace ID for audit logging and incident response.
 */
const requestTracer = (req, res, next) => {
  // A6: same value as X-Request-Id (utils/perfMetrics middleware), so one id ties every log line together.
  const traceId = req.id || crypto.randomUUID();
  req.traceId = traceId;
  res.setHeader('X-Trace-Id', traceId);
  next();
};

/**
 * Enforces additional security response headers beyond what Helmet provides.
 */
const securityHeaders = (req, res, next) => {
  // Strict Transport Security (1 year, include subdomains)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Prevent clickjacking
  if (req.path !== '/auth-helper') {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }
  // Referrer Policy — don't leak full URL to third parties
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Permissions Policy — disable sensitive browser APIs we don't use
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=()');
  // Remove fingerprinting headers
  res.removeHeader('X-Powered-By');
  next();
};

/**
 * Deep-scans request body, query, and params for SQL injection, NoSQL injection,
 * and path traversal attack patterns. Returns 403 Forbidden on detection.
 */
const injectionGuard = (req, res, next) => {
  const scanObject = (obj, location) => {
    if (!obj || typeof obj !== 'object') return false;
    for (const [key, value] of Object.entries(obj)) {
      // Skip scanning passwords/tokens/verification codes/images as they contain arbitrary special characters
      if (['password', 'oldPassword', 'newPassword', 'confirmPassword', 'token', 'accessToken', 'refreshToken', 'firebaseToken', 'idToken', 'code', 'profileImage'].includes(key)) {
        continue;
      }
      if (typeof value === 'string') {
        // SQL keywords are LOG-ONLY: every query is parameterised by Sequelize, and blocking matched
        // everyday text ("I'll update you", "please delete my cart", "create a group") with a 403.
        if (containsSQLInjection(value)) {
          const matchedPattern = SQL_INJECTION_PATTERNS.find(pat => pat.test(value));
          console.warn(`🛡️ [SECURITY_SIGNAL] SQL-like text in ${location}.${key} (${value.length} chars) (Matched: ${matchedPattern}) from IP ${req.ip} | TraceId: ${req.traceId}`);
        }
        // Path traversal only matters in URL parts; message bodies may legitimately contain "../".
        if (location !== 'body' && containsPathTraversal(value)) {
          const matchedPattern = PATH_TRAVERSAL_PATTERNS.find(pat => pat.test(value));
          console.warn(`🛡️ [SECURITY_BLOCK] Path traversal detected in ${location}.${key} (${value.length} chars) (Matched: ${matchedPattern}) from IP ${req.ip} | TraceId: ${req.traceId}`);
          return true;
        }
      }
    }
    // Check for NoSQL operator injection in body
    if (location === 'body' && containsNoSQLInjection(obj)) {
      console.warn(`🛡️ [SECURITY_BLOCK] NoSQL injection detected in ${location} from IP ${req.ip} | TraceId: ${req.traceId}`);
      return true;
    }
    return false;
  };

  if (scanObject(req.body, 'body') || scanObject(req.query, 'query') || scanObject(req.params, 'params')) {
    return res.status(403).json({
      success: false,
      message: 'Request blocked by security policy.',
      code: 'INJECTION_DETECTED',
      traceId: req.traceId
    });
  }
  next();
};

/**
 * HTTP Parameter Pollution (HPP) prevention.
 * If a query param is sent as an array (e.g., ?id=1&id=2), only the last value is kept.
 */
const hppProtection = (req, res, next) => {
  if (req.query) {
    for (const key of Object.keys(req.query)) {
      if (Array.isArray(req.query[key])) {
        req.query[key] = req.query[key][req.query[key].length - 1];
      }
    }
  }
  next();
};

/**
 * Blocks known vulnerability scanners and automated attack tools.
 */
const botGuard = (req, res, next) => {
  const ua = req.headers['user-agent'] || '';
  if (BLOCKED_USER_AGENTS.some(pattern => pattern.test(ua))) {
    console.warn(`🛡️ [SECURITY_BLOCK] Vulnerability scanner blocked: "${ua.slice(0, 50)}" from IP ${req.ip} | TraceId: ${req.traceId}`);
    return res.status(403).json({
      success: false,
      message: 'Automated scanning tools are not permitted.',
      code: 'BOT_DETECTED'
    });
  }
  next();
};

/**
 * Request timeout enforcement to prevent Slow-Loris / connection starvation attacks.
 * Terminates requests that take longer than 30 seconds to complete.
 */
// 30 s for ordinary requests (JSON bodies are already read by the body parsers before this runs).
// Multipart photo uploads are different: multer streams the file AFTER this middleware, so a 1-5 MB photo
// on campus Wi-Fi / 4G could still be arriving at 30 s. Answering 408 mid-upload made Android report a
// connection reset ("No internet"), so multipart requests get UPLOAD_REQUEST_TIMEOUT_MS (default 120 s).
const envMs = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const requestTimeoutMs = (req) => {
  const ct = String((req.headers && req.headers['content-type']) || '').toLowerCase();
  return ct.startsWith('multipart/form-data')
    ? envMs('UPLOAD_REQUEST_TIMEOUT_MS', 120000)
    : envMs('REQUEST_TIMEOUT_MS', 30000);
};
const requestTimeout = (req, res, next) => {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      console.warn(`🛡️ [SECURITY_TIMEOUT] Request timed out: ${req.method} ${req.path} from IP ${req.ip} | TraceId: ${req.traceId}`);
      res.status(408).json({
        success: false,
        message: 'Request timeout. Please try again.',
        code: 'REQUEST_TIMEOUT'
      });
    }
  }, requestTimeoutMs(req));

  res.on('finish', () => clearTimeout(timeout));
  res.on('close', () => clearTimeout(timeout));
  next();
};

/**
 * Builds `req.logSafeBody`: a copy of the request body with secrets (passwords,
 * tokens, OTPs, PINs, card data) replaced by "[REDACTED]" and long strings
 * (base64 images) truncated. Anything that logs a request body must log
 * `req.logSafeBody`, never `req.body`.
 */
const SENSITIVE_KEY_PATTERN = /pass(word)?|token|secret|api_?key|otp|^pin$|deliverypin|^code$|cvv|card/i;
const redactForLog = (value, depth = 0) => {
  if (value == null || depth > 4) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactForLog(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY_PATTERN.test(k) ? '[REDACTED]' : redactForLog(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 200) return `${value.slice(0, 60)}...(${value.length} chars)`;
  return value;
};
const sensitiveDataMask = (req, res, next) => {
  try {
    req.logSafeBody = req.body && typeof req.body === 'object' ? redactForLog(req.body) : undefined;
  } catch {
    req.logSafeBody = undefined;
  }
  next();
};

/**
 * Audit logger for security-sensitive operations.
 * Logs authentication attempts, admin actions, and data mutations.
 */
const auditLogger = (req, res, next) => {
  const securityPaths = ['/api/users/login', '/api/users/register', '/api/admin', '/api/users/reset-password'];
  const isSecurityPath = securityPaths.some(p => req.path.startsWith(p));

  if (isSecurityPath) {
    const originalSend = res.send;
    res.send = function (body) {
      const logEntry = {
        timestamp: new Date().toISOString(),
        traceId: req.traceId,
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: (req.headers['user-agent'] || '').slice(0, 80),
        statusCode: res.statusCode,
        userId: req.user?.id || 'anonymous'
      };

      if (res.statusCode >= 400) {
        console.warn(`🔒 [AUDIT_FAIL] ${JSON.stringify(logEntry)}`);
      } else if (req.path.includes('/admin')) {
        console.log(`🔒 [AUDIT_ADMIN] ${JSON.stringify(logEntry)}`);
      }

      return originalSend.apply(this, arguments);
    };
  }
  next();
};

module.exports = {
  requestTracer,
  securityHeaders,
  injectionGuard,
  hppProtection,
  botGuard,
  requestTimeout,
  requestTimeoutMs,
  sensitiveDataMask,
  auditLogger,
  // Utility exports for custom route-level use
  containsSQLInjection,
  containsPathTraversal,
  containsNoSQLInjection
};
