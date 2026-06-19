const crypto = require('crypto');

// ERP API secrets are stored encrypted at rest (AES-256-GCM) keyed by
// ERP_CRED_KEY (64 hex chars = 32 bytes). The blob format is
// `iv:tag:ciphertext`, all hex. Pure and unit-testable: no DB, no env reads
// beyond the explicitly resolved key.

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the GCM standard.
const KEY_HEX_LENGTH = 64; // 32 bytes.

// Resolves and validates the configured key. Throws when it is absent or not
// exactly 64 hex chars; returns the 32-byte Buffer otherwise. Reused by the
// startup guard (server.js) so boot fails fast on a bad key.
function validateKey(rawKey = process.env.ERP_CRED_KEY) {
  const key = String(rawKey || '');
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('ERP_CRED_KEY must be exactly 64 hex characters (32 bytes)');
  }
  return Buffer.from(key, 'hex');
}

function encryptSecret(plain, rawKey = process.env.ERP_CRED_KEY) {
  const key = validateKey(rawKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plain == null ? '' : plain), 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function decryptSecret(blob, rawKey = process.env.ERP_CRED_KEY) {
  const key = validateKey(rawKey);
  const parts = String(blob || '').split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted secret blob');
  }
  const [ivHex, tagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  if (iv.length !== IV_LENGTH) {
    throw new Error('Invalid encrypted secret blob');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}

module.exports = {
  validateKey,
  encryptSecret,
  decryptSecret
};
