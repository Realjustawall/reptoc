import crypto from 'crypto';

/**
 * AES-256-GCM encryption helpers for session cookies and PII columns.
 *
 * Security notes:
 *  - The encryption key MUST come from process.env.ENCRYPTION_KEY (64 hex chars / 32 bytes).
 *  - IV is 12 bytes (96 bits), per NIST SP 800-38D recommendation for GCM.
 *    The previous implementation used 16-byte IVs which, while accepted by Node.js,
 *    increase the probability of counter wrap-around across the lifetime of a long-running service.
 *  - Each call to encrypt() generates a fresh random IV; reuse is impossible.
 *  - decrypt() is fail-closed: any tampering or wrong key returns null.
 *
 * BACKWARD COMPATIBILITY:
 *  - The legacy 16-byte IV format is still readable: decrypt() inspects the IV hex length
 *    and accepts either 24-hex (12 bytes) or 32-hex (16 bytes) IVs.
 *  - New ciphertexts always use the 12-byte IV form.
 */

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY environment variable is required");
}

let key: Buffer;
try {
  key = Buffer.from(ENCRYPTION_KEY, 'hex');
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes) for AES-256");
  }
} catch (err) {
  if (err instanceof Error && err.message.includes("Invalid hex string")) {
    throw new Error("ENCRYPTION_KEY must contain only valid hex characters (0-9, a-f)");
  }
  throw err;
}

// GCM standard IV length per NIST SP 800-38D.
const IV_LENGTH = 12;
const LEGACY_IV_LENGTH = 16;

// Matches 12-byte IV (24 hex), legacy 16-byte IV (32 hex), 16-byte authTag (32 hex), ciphertext (any length)
const ENCRYPTED_VALUE_PATTERN = /^[0-9a-f]{24,32}:[0-9a-f]{32}:[0-9a-f]+$/i;

export function isEncryptedValue(value: unknown): boolean {
  return typeof value === "string" && ENCRYPTED_VALUE_PATTERN.test(value.trim());
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedText: string): string | null {
  try {
    if (!isEncryptedValue(encryptedText)) return null;
    const [ivHex, authTag, encrypted] = encryptedText.split(':');

    // Validate IV length: accept only 12 bytes (new) or 16 bytes (legacy).
    const ivBytes = Buffer.from(ivHex, 'hex');
    if (ivBytes.length !== IV_LENGTH && ivBytes.length !== LEGACY_IV_LENGTH) {
      return null;
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      ivBytes,
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    // Tampered ciphertext, wrong key, or corrupt payload.
    // Log a warning so brute-force / fuzzing attempts are visible in logs.
    // We do NOT call logSecurityEvent here because that function requires
    // an Express Request object (req) which decrypt() does not have access to.
    // Callers that detect repeated decrypt failures should log security events
    // from their own request context.
    try {
      const signature = crypto.createHash('sha256').update(String(encryptedText || '').slice(0, 64)).digest('hex').slice(0, 16);
      console.warn('[encryption] Decrypt failed — possible tampering attempt', { signature });
    } catch {
      // Logging is best-effort; never let it mask the original null return.
    }
    return null;
  }
}
