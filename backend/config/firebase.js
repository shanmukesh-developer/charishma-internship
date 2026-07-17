const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

/**
 * Robustly cleans and formats a Private Key from any environment variable format.
 * Handles: Base64 wrappers, escaped newlines, literal strings, and fragments.
 */
/**
 * Robustly cleans and formats a Private Key from any environment variable format.
 * Handles: Base64 wrappers, escaped newlines, literal strings, and fragments.
 */
const cleanPrivateKey = (raw) => {
  if (!raw) return null;
  
  // 1. Initial cleanup (stripping quotes and normalizing escapes)
  let s = raw.replace(/^["']|["']$/g, '').trim();
  s = s.replace(/\\n/g, '\n').replace(/\\r/g, '');

  // 2. Base64 Detection & Decoding
  // If no PEM header is present and string is long, it's likely a base64 wrapper
  if (!s.includes('-----') && (s.length > 500 || s.endsWith('='))) {
    try {
      const decoded = Buffer.from(s, 'base64').toString('utf8');
      if (decoded.includes('-----')) {
        s = decoded;
      }
    } catch {
      console.warn('[FIREBASE_INIT] Base64 decode attempt failed.');
    }
  }

  // 3. Robust PEM Validation
  // If it already looks like a valid PEM, return it directly but ensured trimmed
  if (s.includes('-----BEGIN PRIVATE KEY-----') && s.includes('-----END PRIVATE KEY-----')) {
    return s.trim() + '\n';
  }

  // 4. Fragmented Key Reconstruction (Last channel fallback)
  const header = '-----BEGIN PRIVATE KEY-----';
  const footer = '-----END PRIVATE KEY-----';

  // Extract only the base64-like characters to rebuild the body
  let body = s.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----/g, '');
  body = body.replace(/[^a-zA-Z0-9+/=\s]/g, '').trim();
  
  // Normalize whitespace to single newlines or nothing
  const cleanBody = body.replace(/\s/g, '');

  if (cleanBody.length < 500) {
    console.error('[FIREBASE_INIT] Private key body too short.');
    return null;
  }

  // Reconstruct standard PEM format
  const formattedBody = (cleanBody.match(/.{1,64}/g) || []).join('\n');
  return `${header}\n${formattedBody}\n${footer}\n`;
};

const initializeFirebase = () => {
  const apps = (admin.getApps ? admin.getApps() : admin.apps) || [];
  if (apps.length > 0) return admin;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;
  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

  // --- METHOD 1: FULL JSON BASE64 ---
  if (serviceAccountBase64) {
    try {
      const decoded = Buffer.from(serviceAccountBase64, 'base64').toString('utf8');
      const serviceAccount = JSON.parse(decoded);
      admin.initializeApp({
        credential: (admin.cert || admin.credential.cert)(serviceAccount)
      });
      console.log('✅ Firebase Admin initialized via FIREBASE_SERVICE_ACCOUNT_BASE64');
      return admin;
    } catch (err) {
      console.error('❌ Failed to initialize via FIREBASE_SERVICE_ACCOUNT_BASE64:', err.message);
    }
  }

  // --- METHOD 2: INDIVIDUAL ENV VARS ---
  if (projectId && clientEmail && privateKeyRaw) {
    try {
      const privateKey = cleanPrivateKey(privateKeyRaw);
      if (privateKey) {
        admin.initializeApp({
          credential: (admin.cert || admin.credential.cert)({
            projectId,
            clientEmail,
            privateKey
          })
        });
        console.log('✅ Firebase Admin initialized via individual environment variables.');
        return admin;
      } else {
        console.warn('⚠️ FIREBASE_ENV_WARN: Cleaned private key was invalid.');
      }
    } catch (err) {
      console.error('❌ Failed to initialize via individual ENV vars:', err.message);
      // Delete partially initialized app if any
      const currentApps = (admin.getApps ? admin.getApps() : admin.apps) || [];
      if (currentApps.length > 0) admin.app().delete().catch(() => {});
    }
  }

  // --- METHOD 3: LOCAL JSON FALLBACK ---
  const serviceAccountPath = path.join(__dirname, '..', 'firebase-key.json');
  if (fs.existsSync(serviceAccountPath)) {
    try {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: (admin.cert || admin.credential.cert)(serviceAccount)
      });
      console.log('✅ Firebase Admin initialized via firebase-key.json');
      return admin;
    } catch (err) {
      console.error('❌ Failed to initialize via local firebase-key.json:', err.message);
    }
  }

  console.warn('⚠️ No Firebase credentials found or all methods failed. Push notifications and phone auth verification will be disabled.');
  return admin;
};

module.exports = initializeFirebase();
