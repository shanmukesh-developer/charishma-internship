// Copies a photo from a web link into ZenWe's own media store (7 Nov 2026: CSV menu imports with Google Drive /
// share links showed "photo does not load" on every row: those links open a web page, not a picture, and other
// sites' links can disappear later). The server downloads the picture once, checks that it really is a JPEG /
// PNG / WEBP / GIF, saves it like an upload and the row gets our own /api/campus/media/<id> link.
//
// Safety (server-side request to a link an admin typed): http(s) only, ports 80/443 only, every host (also after
// each redirect) must resolve to public addresses only (no localhost, private, link-local or metadata ranges),
// at most 4 redirects, 15 s timeout, 5 MB cap while reading.
const dns = require('dns').promises;
const net = require('net');

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 4;

let netImpl = { fetch: (...a) => fetch(...a), lookup: (host) => dns.lookup(host, { all: true, verbatim: true }) };
/** Tests: replace fetch / DNS lookup. Pass null to restore. */
const _setNetForTests = (impl) => { netImpl = impl ? { ...netImpl, ...impl } : { fetch: (...a) => fetch(...a), lookup: (host) => dns.lookup(host, { all: true, verbatim: true }) }; };

/** Share-page links -> direct download links (Google Drive, Dropbox). Other links are returned as they are. */
const directPhotoLink = (raw) => {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return String(raw || '').trim(); }
  const host = u.hostname.toLowerCase();
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    const m = u.pathname.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/) || u.pathname.match(/\/d\/([A-Za-z0-9_-]{10,})/);
    const id = (m && m[1]) || u.searchParams.get('id');
    if (id && /^[A-Za-z0-9_-]{10,}$/.test(id)) return `https://drive.google.com/uc?export=download&id=${id}`;
  }
  if (/(^|\.)dropbox\.com$/.test(host)) {
    u.searchParams.delete('dl');
    u.searchParams.set('raw', '1');
    return u.toString();
  }
  return u.toString();
};

const privateV4 = (ip) => {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
};
const privateIp = (ip) => {
  if (net.isIPv4(ip)) return privateV4(ip);
  if (!net.isIPv6(ip)) return true;
  const v = ip.toLowerCase();
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]);
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
};

const fail = (code, message) => ({ ok: false, code, message });

const checkHost = async (u) => {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return fail('IMAGE_LINK_BAD', 'The photo link must start with http:// or https://.');
  if (u.port && u.port !== '80' && u.port !== '443') return fail('IMAGE_LINK_BAD', 'That photo link uses an unusual port. Use a normal web link.');
  if (u.username || u.password) return fail('IMAGE_LINK_BAD', 'That photo link has a login in it. Use a public link.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addrs;
  if (net.isIP(host)) addrs = [{ address: host }];
  else {
    try { addrs = await netImpl.lookup(host); } catch { return fail('IMAGE_LINK_UNREACHABLE', 'That photo link’s website could not be found. Check the link.'); }
  }
  if (!addrs || !addrs.length || addrs.some((a) => privateIp(a.address))) return fail('IMAGE_LINK_BAD', 'That photo link does not point to a public website.');
  return null;
};

/** Reads the body up to `max` bytes. Returns Buffer | 'too_large'. */
const readCapped = async (res, max) => {
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > max) return 'too_large';
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > max ? 'too_large' : buf;
  }
  const reader = res.body.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { try { await reader.cancel(); } catch { /* ignore */ } return 'too_large'; }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
};

/**
 * Downloads the picture behind `rawUrl`. Resolves { ok: true, buf, mime, finalUrl } or { ok: false, code, message }.
 * Never throws.
 */
const downloadImage = async (rawUrl, { maxBytes = MAX_BYTES, timeoutMs = TIMEOUT_MS } = {}) => {
  const { sniffImage } = require('./imageStore');
  let url;
  try { url = new URL(directPhotoLink(rawUrl)); } catch { return fail('IMAGE_LINK_BAD', 'That is not a web link.'); }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const bad = await checkHost(url);
      if (bad) return bad;
      let res;
      try {
        res = await netImpl.fetch(url.toString(), { redirect: 'manual', signal: ctrl.signal, headers: { Accept: 'image/*', 'User-Agent': 'ZenWe-photo-import/1.0' } });
      } catch (err) {
        return ctrl.signal.aborted
          ? fail('IMAGE_LINK_TIMEOUT', 'That photo link took too long to answer. Try again or upload the photo.')
          : fail('IMAGE_LINK_UNREACHABLE', 'That photo link could not be opened. Check the link.');
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        try { url = new URL(res.headers.get('location'), url); } catch { return fail('IMAGE_LINK_BAD', 'That photo link redirects somewhere invalid.'); }
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        return fail('IMAGE_LINK_PRIVATE', /google\.com$/.test(url.hostname)
          ? 'That Google Drive photo is not shared. In Drive set it to "Anyone with the link", then import again.'
          : 'That photo link needs a login. Use a public link or upload the photo.');
      }
      if (res.status === 404) return fail('IMAGE_LINK_NOT_FOUND', 'Nothing is at that photo link (not found).');
      if (!res.ok) return fail('IMAGE_LINK_UNREACHABLE', `That photo link answered with an error (${res.status}).`);
      const buf = await readCapped(res, maxBytes);
      if (buf === 'too_large') return fail('FILE_TOO_LARGE', `That photo is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`);
      const mime = sniffImage(buf);
      if (!mime) {
        const type = String(res.headers.get('content-type') || '');
        return fail('IMAGE_LINK_NOT_IMAGE', /drive\.google|googleusercontent/.test(url.hostname) || /text\/html/i.test(type)
          ? 'That link opens a web page, not a picture. Use the photo’s direct link (or share a Drive photo as "Anyone with the link").'
          : 'That link is not a JPEG, PNG, WEBP or GIF picture.');
      }
      return { ok: true, buf, mime, finalUrl: url.toString() };
    }
    return fail('IMAGE_LINK_BAD', 'That photo link redirects too many times.');
  } finally {
    clearTimeout(timer);
  }
};

/** Downloads and stores the picture. Resolves { ok: true, value: '<base>/api/campus/media/<id>' } or a failure. */
const importImageFromUrl = async (rawUrl, { req = null, ownerId = null, purpose = 'menu' } = {}) => {
  const got = await downloadImage(rawUrl);
  if (!got.ok) return got;
  const { saveImageBytes, publicBase } = require('./imageStore');
  try {
    const saved = await saveImageBytes(got.buf, { ownerId: ownerId || (req && req.user && req.user.id), purpose });
    return { ok: true, value: `${publicBase(req)}/api/campus/media/${saved.id}` };
  } catch (err) {
    return fail(err.code || 'MEDIA_SAVE_FAILED', err.status ? err.message : 'Could not save that photo. Please try again.');
  }
};

module.exports = { importImageFromUrl, downloadImage, directPhotoLink, privateIp, _setNetForTests };
