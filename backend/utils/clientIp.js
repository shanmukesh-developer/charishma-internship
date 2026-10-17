// Client IP behind Render (+ optionally Cloudflare).
//
// Today: app.set('trust proxy', 1) — Render's load balancer is the one trusted hop, so req.ip is the
// address that connected to Render. Behind Cloudflare that address is a Cloudflare edge, i.e. every user
// would share a handful of IPs for rate limits and logs.
//
//   TRUST_PROXY=<n>        number of trusted proxy hops for Express (default 1 = unchanged). Leave it at 1
//                          with Cloudflare too: Cloudflare's address is checked below instead.
//   TRUST_CLOUDFLARE=1     when the hop that reached Render is a Cloudflare edge (published Cloudflare IP
//                          ranges, override with CLOUDFLARE_IPS=cidr,cidr), req.ip becomes the
//                          CF-Connecting-IP header. A request that did NOT come through Cloudflare (someone
//                          calling the onrender.com address directly) keeps its own IP, so the header cannot
//                          be spoofed to dodge a rate limit. Unset = nothing changes.
const net = require('net');

// https://www.cloudflare.com/ips/ (stable for years; refresh with CLOUDFLARE_IPS if Cloudflare adds ranges).
const CLOUDFLARE_RANGES = Object.freeze([
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
]);

const truthy = (v) => ['1', 'true', 'yes', 'on'].includes(String(v || '').trim().toLowerCase());

/** Express 'trust proxy' value: TRUST_PROXY as a hop count (1..10), default 1. */
const trustProxySetting = (env = process.env) => {
  const n = Number(String(env.TRUST_PROXY || '').trim());
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 1;
};

const buildBlockList = (ranges) => {
  const list = new net.BlockList();
  for (const r of ranges) {
    const [addr, bitsRaw] = String(r).trim().split('/');
    const bits = Number(bitsRaw);
    const type = net.isIPv6(addr) ? 'ipv6' : (net.isIPv4(addr) ? 'ipv4' : null);
    if (!type || !Number.isInteger(bits)) continue;
    try { list.addSubnet(addr, bits, type); } catch { /* skip a bad range */ }
  }
  return list;
};

const normalizeIp = (ip) => {
  const s = String(ip || '').trim();
  if (s.startsWith('::ffff:') && net.isIPv4(s.slice(7))) return s.slice(7);
  return s;
};

const isInList = (list, ip) => {
  const a = normalizeIp(ip);
  if (net.isIPv4(a)) return list.check(a, 'ipv4');
  if (net.isIPv6(a)) return list.check(a, 'ipv6');
  return false;
};

/**
 * Middleware factory. Returns null when TRUST_CLOUDFLARE is off (nothing is installed).
 * Must run after app.set('trust proxy') and before rate limiters / loggers.
 */
const cloudflareIpMiddleware = (env = process.env) => {
  if (!truthy(env.TRUST_CLOUDFLARE)) return null;
  const custom = String(env.CLOUDFLARE_IPS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const list = buildBlockList(custom.length ? custom : CLOUDFLARE_RANGES);
  return (req, res, next) => {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf && net.isIP(normalizeIp(cf))) {
      const edge = req.ip; // the hop Render saw (trust proxy = 1)
      if (isInList(list, edge)) {
        try {
          Object.defineProperty(req, 'ip', { value: normalizeIp(cf), configurable: true, enumerable: true, writable: true });
          req.viaCloudflare = true;
        } catch { /* keep req.ip */ }
      }
    }
    next();
  };
};

module.exports = { CLOUDFLARE_RANGES, trustProxySetting, cloudflareIpMiddleware, buildBlockList, isInList, normalizeIp };
