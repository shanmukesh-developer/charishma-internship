const crypto = require('crypto');

// Ensure key is exactly 32 bytes (SHA-256 of JWT_SECRET or fallback)
const secret = process.env.JWT_SECRET || 'fallback_zenvy_super_secure_key_12345';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(secret).digest(); 
const IV_LENGTH = 16; // For AES-256-CBC

/**
 * Encrypt cleartext into formatted string 'iv_hex:ciphertext_hex'
 * @param {string} text 
 * @returns {string}
 */
function encryptText(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt formatted cipherText 'iv_hex:ciphertext_hex' back into cleartext
 * @param {string} cipherText 
 * @returns {string}
 */
function decryptText(cipherText) {
  if (!cipherText) return '';
  try {
    const parts = cipherText.split(':');
    if (parts.length !== 2) {
      // Fallback if message wasn't encrypted (e.g. legacy/system messages)
      return cipherText;
    }
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[CRYPTO_DECRYPT_FAIL] Failed to decrypt message:', err.message);
    return '[Decryption Failed - Encryption Keys Out of Sync]';
  }
}

module.exports = {
  encryptText,
  decryptText
};
