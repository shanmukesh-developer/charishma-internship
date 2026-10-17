// Minimal S3-compatible client (AWS Signature Version 4) for Cloudflare R2 — no SDK dependency.
// Path-style requests (https://<endpoint>/<bucket>/<key>), which R2 and every S3-compatible server accept.
//   putObject / getObject (stream) / headObject / deleteObject / presignGet
// Uses the global fetch (Node 18+). Every request has a timeout (default 15 s).
const crypto = require('crypto');
const { Readable } = require('stream');

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// RFC 3986 encoding as SigV4 wants it (encodeURIComponent leaves !'()* alone).
const uriEncode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodeKeyPath = (key) => String(key).split('/').map(uriEncode).join('/');

const amzDates = (now = new Date()) => {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20261018T101500Z
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
};

class S3Error extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'S3Error';
    this.status = status;
    this.code = code;
  }
}

class S3Lite {
  /**
   * @param {{ endpoint: string, region?: string, accessKeyId: string, secretAccessKey: string, timeoutMs?: number, fetchImpl?: Function }} cfg
   */
  constructor(cfg) {
    if (!cfg || !cfg.endpoint || !cfg.accessKeyId || !cfg.secretAccessKey) throw new Error('S3Lite: endpoint, accessKeyId and secretAccessKey are required');
    const u = new URL(cfg.endpoint);
    this.protocol = u.protocol;
    this.host = u.host; // includes a non-default port
    this.basePath = u.pathname.replace(/\/+$/, '');
    this.region = cfg.region || 'auto';
    this.accessKeyId = cfg.accessKeyId;
    this.secretAccessKey = cfg.secretAccessKey;
    this.timeoutMs = cfg.timeoutMs || 15000;
    this.fetch = cfg.fetchImpl || ((...a) => fetch(...a));
  }

  path(bucket, key) {
    return `${this.basePath}/${uriEncode(bucket)}${key ? `/${encodeKeyPath(key)}` : ''}`;
  }

  signingKey(dateStamp) {
    const kDate = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, 's3');
    return hmac(kService, 'aws4_request');
  }

  /** Signed headers for a request (Authorization etc.). */
  sign(method, path, { query = {}, headers = {}, payloadHash, now } = {}) {
    const { amzDate, dateStamp } = amzDates(now);
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host: this.host, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash };
    const names = Object.keys(all).sort();
    const canonicalHeaders = names.map((n) => `${n}:${String(all[n]).replace(/\s+/g, ' ')}\n`).join('');
    const signedHeaders = names.join(';');
    const canonicalQuery = Object.keys(query).sort().map((k) => `${uriEncode(k)}=${uriEncode(String(query[k]))}`).join('&');
    const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
    const signature = crypto.createHmac('sha256', this.signingKey(dateStamp)).update(stringToSign).digest('hex');
    const out = { ...all };
    delete out.host; // fetch sets Host itself
    out.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return { headers: out, canonicalQuery };
  }

  async request(method, bucket, key, { body, headers = {}, query = {} } = {}) {
    const p = this.path(bucket, key);
    const payloadHash = sha256Hex(body || '');
    const signed = this.sign(method, p, { query, headers, payloadHash });
    const url = `${this.protocol}//${this.host}${p}${signed.canonicalQuery ? `?${signed.canonicalQuery}` : ''}`;
    const res = await this.fetch(url, { method, headers: signed.headers, body: body && body.length ? body : undefined, signal: AbortSignal.timeout(this.timeoutMs) });
    return res;
  }

  static async fail(res, what) {
    let text = '';
    try { text = await res.text(); } catch { /* ignore */ }
    const code = (/<Code>([^<]+)<\/Code>/.exec(text) || [])[1] || `HTTP_${res.status}`;
    throw new S3Error(`${what} failed: ${res.status} ${code}`, res.status, code);
  }

  /** Uploads a Buffer. metadata keys become x-amz-meta-<key>. Returns { etag }. */
  async putObject(bucket, key, body, { contentType = 'application/octet-stream', cacheControl, metadata = {} } = {}) {
    // Content-Length is set by fetch itself (not signed: only signed headers must match).
    const headers = { 'content-type': contentType };
    if (cacheControl) headers['cache-control'] = cacheControl;
    for (const [k, v] of Object.entries(metadata)) headers[`x-amz-meta-${k.toLowerCase()}`] = String(v);
    const res = await this.request('PUT', bucket, key, { body, headers });
    if (!res.ok) await S3Lite.fail(res, 'PUT');
    try { await res.arrayBuffer(); } catch { /* drain */ }
    return { etag: String(res.headers.get('etag') || '').replace(/"/g, '') };
  }

  /** { stream (Node Readable), contentType, contentLength, etag, metadata } or null when the object is missing. */
  async getObject(bucket, key) {
    const res = await this.request('GET', bucket, key);
    if (res.status === 404) { try { await res.arrayBuffer(); } catch { /* drain */ } return null; }
    if (!res.ok) await S3Lite.fail(res, 'GET');
    return {
      stream: res.body ? Readable.fromWeb(res.body) : Readable.from([]),
      contentType: res.headers.get('content-type') || null,
      contentLength: Number(res.headers.get('content-length')) || null,
      etag: String(res.headers.get('etag') || '').replace(/"/g, ''),
      metadata: S3Lite.metaFrom(res.headers),
    };
  }

  /** Whole object as a Buffer (or null). */
  async getObjectBuffer(bucket, key) {
    const res = await this.request('GET', bucket, key);
    if (res.status === 404) { try { await res.arrayBuffer(); } catch { /* drain */ } return null; }
    if (!res.ok) await S3Lite.fail(res, 'GET');
    return Buffer.from(await res.arrayBuffer());
  }

  async headObject(bucket, key) {
    const res = await this.request('HEAD', bucket, key);
    if (res.status === 404) return null;
    if (!res.ok) throw new S3Error(`HEAD failed: ${res.status}`, res.status, `HTTP_${res.status}`);
    return {
      contentLength: Number(res.headers.get('content-length')) || 0,
      contentType: res.headers.get('content-type') || null,
      etag: String(res.headers.get('etag') || '').replace(/"/g, ''),
      metadata: S3Lite.metaFrom(res.headers),
    };
  }

  async deleteObject(bucket, key) {
    const res = await this.request('DELETE', bucket, key);
    try { await res.arrayBuffer(); } catch { /* drain */ }
    if (!res.ok && res.status !== 404) throw new S3Error(`DELETE failed: ${res.status}`, res.status, `HTTP_${res.status}`);
    return true;
  }

  /** Pre-signed GET URL valid for expiresSec (1..604800). */
  presignGet(bucket, key, expiresSec = 300, now = new Date()) {
    const { amzDate, dateStamp } = amzDates(now);
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const p = this.path(bucket, key);
    const query = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.accessKeyId}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(Math.max(1, Math.min(604800, Math.floor(expiresSec)))),
      'X-Amz-SignedHeaders': 'host',
    };
    const canonicalQuery = Object.keys(query).sort().map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`).join('&');
    const canonicalRequest = ['GET', p, canonicalQuery, `host:${this.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
    const signature = crypto.createHmac('sha256', this.signingKey(dateStamp)).update(stringToSign).digest('hex');
    return `${this.protocol}//${this.host}${p}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  static metaFrom(headers) {
    const out = {};
    try {
      headers.forEach((v, k) => { if (k.toLowerCase().startsWith('x-amz-meta-')) out[k.toLowerCase().slice(11)] = v; });
    } catch { /* ignore */ }
    return out;
  }
}

module.exports = { S3Lite, S3Error, uriEncode, encodeKeyPath, sha256Hex };
