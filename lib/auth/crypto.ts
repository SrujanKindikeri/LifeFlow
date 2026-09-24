/**
 * lib/auth/crypto.ts — Cryptographic utilities for authentication security.
 *
 * Covers:
 *  - Email-verification / password-reset token generation & hashing
 *  - AES-256-GCM encryption/decryption of TOTP secrets
 *  - Recovery code generation & hashing
 *
 * SECURITY RULES enforced here:
 *  - Raw tokens are NEVER logged or stored; only their SHA-256 hashes are persisted.
 *  - TOTP secrets are NEVER stored in plaintext; they are encrypted with AES-256-GCM.
 *  - Recovery codes are NEVER stored in plaintext; only their SHA-256 hashes are stored.
 *  - No secret value is returned from any function except during initial generation.
 *
 * This module is SERVER-ONLY.  Do not import it from client components or
 * NEXT_PUBLIC_* code paths.
 */

import crypto from 'crypto'

// ─── Email verification / password-reset tokens ───────────────────────────────

const TOKEN_BYTES = 32   // 256 bits of entropy
const HASH_ALG    = 'sha256'

/**
 * Generate a cryptographically secure random token and its SHA-256 hash.
 *
 * Returns:
 *   token     — raw URL-safe base64 string.  Include in the verification URL.
 *                Discard immediately after constructing the URL.
 *   tokenHash — SHA-256 hex digest.  Store this in MongoDB.
 */
export function generateVerificationToken(): { token: string; tokenHash: string } {
  const rawBytes = crypto.randomBytes(TOKEN_BYTES)
  const token    = rawBytes.toString('base64url')        // URL-safe, no padding
  const tokenHash = crypto
    .createHash(HASH_ALG)
    .update(rawBytes)                                    // hash the raw bytes
    .digest('hex')
  return { token, tokenHash }
}

/**
 * Hash an incoming raw token (from a URL query-string) for safe DB lookup.
 * Returns null if the input is falsy or not a string.
 */
export function hashToken(rawToken: string | null | undefined): string | null {
  if (!rawToken || typeof rawToken !== 'string') return null
  try {
    // Decode base64url back to Buffer, then hash the same bytes
    const rawBytes = Buffer.from(rawToken, 'base64url')
    return crypto.createHash(HASH_ALG).update(rawBytes).digest('hex')
  } catch {
    return null
  }
}

// ─── TOTP secret encryption (AES-256-GCM) ────────────────────────────────────

const CIPHER_ALG    = 'aes-256-gcm'
const IV_BYTES       = 12   // 96-bit IV recommended for GCM
const AUTH_TAG_BYTES = 16   // 128-bit auth tag (GCM default)
const KEY_BYTES      = 32   // 256-bit key

/**
 * Derive the AES-256 key from TOTP_ENCRYPTION_KEY env var.
 *
 * The env var can be:
 *   - a 64-character hex string (32 bytes)  → used directly
 *   - any other non-empty string            → SHA-256 stretched to 32 bytes
 *
 * @throws if TOTP_ENCRYPTION_KEY is not configured.
 */
function getTotpEncryptionKey(): Buffer {
  const raw = process.env.TOTP_ENCRYPTION_KEY
  if (!raw || raw.trim() === '') {
    throw new Error(
      '[LifeFlow] TOTP_ENCRYPTION_KEY environment variable is not set. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    )
  }
  const trimmed = raw.trim()
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex')
  }
  // Stretch arbitrary-length string to exactly KEY_BYTES
  return crypto.createHash(HASH_ALG).update(trimmed).digest().slice(0, KEY_BYTES)
}

/**
 * Encrypt a TOTP base32 secret for safe MongoDB storage.
 *
 * Returns a string in the format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 *
 * @throws if TOTP_ENCRYPTION_KEY is not configured.
 */
export function encryptTotpSecret(plaintext: string): string {
  const key    = getTotpEncryptionKey()
  const iv     = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(CIPHER_ALG, key, iv) as crypto.CipherGCM

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return [
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':')
}

/**
 * Decrypt an encrypted TOTP secret from MongoDB.
 *
 * @param stored — the "<iv_hex>:<authTag_hex>:<ciphertext_hex>" string.
 * @returns the plaintext TOTP base32 secret.
 * @throws if decryption fails (wrong key, tampered data, bad format).
 */
export function decryptTotpSecret(stored: string): string {
  const parts = stored.split(':')
  if (parts.length !== 3) {
    throw new Error('[LifeFlow] Invalid encrypted TOTP secret format.')
  }
  const [ivHex, authTagHex, ciphertextHex] = parts
  const key        = getTotpEncryptionKey()
  const iv         = Buffer.from(ivHex, 'hex')
  const authTag    = Buffer.from(authTagHex, 'hex')
  const ciphertext = Buffer.from(ciphertextHex, 'hex')

  if (
    iv.length !== IV_BYTES ||
    authTag.length !== AUTH_TAG_BYTES
  ) {
    throw new Error('[LifeFlow] Invalid encrypted TOTP secret lengths.')
  }

  const decipher = crypto.createDecipheriv(CIPHER_ALG, key, iv) as crypto.DecipherGCM
  decipher.setAuthTag(authTag)

  return (
    decipher.update(ciphertext).toString('utf8') +
    decipher.final('utf8')
  )
}

// ─── Recovery codes ───────────────────────────────────────────────────────────

const RECOVERY_CODE_COUNT  = 10
const RECOVERY_CODE_BYTES  = 10   // 80 bits per code → displayed as 20 hex chars

/**
 * Generate `RECOVERY_CODE_COUNT` single-use recovery codes.
 *
 * Returns:
 *   codes      — array of raw codes to display ONCE to the user (e.g. "a3f9b2c1d4e5f6a7b8c9")
 *   codeHashes — SHA-256 hex digests of each raw code, for MongoDB storage.
 *
 * The raw codes must be displayed immediately and never stored.
 * The hashes are what get persisted to twoFactorRecoveryCodeHashes.
 */
export function generateRecoveryCodes(): {
  codes: string[]
  codeHashes: string[]
} {
  const codes: string[]      = []
  const codeHashes: string[] = []

  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const rawBytes = crypto.randomBytes(RECOVERY_CODE_BYTES)
    const code     = rawBytes.toString('hex')              // 20 lowercase hex chars
    const hash     = crypto.createHash(HASH_ALG).update(rawBytes).digest('hex')
    codes.push(code)
    codeHashes.push(hash)
  }

  return { codes, codeHashes }
}

/**
 * Hash a raw recovery code submitted by a user.
 * Returns null if the input is falsy or not a string.
 */
export function hashRecoveryCode(rawCode: string | null | undefined): string | null {
  if (!rawCode || typeof rawCode !== 'string') return null
  try {
    const rawBytes = Buffer.from(rawCode.trim().toLowerCase(), 'hex')
    if (rawBytes.length !== RECOVERY_CODE_BYTES) return null
    return crypto.createHash(HASH_ALG).update(rawBytes).digest('hex')
  } catch {
    return null
  }
}

// ─── Constant-time comparison ─────────────────────────────────────────────────

/**
 * Constant-time string comparison to prevent timing attacks when comparing
 * hashes or tokens.
 */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}


// ─── Group Bill Reminder public-link tokens ───────────────────────────────────
//
// Public reminder tokens use the same cryptographic mechanism as email-
// verification tokens (32 random bytes, base64url raw token, SHA-256 hash
// stored in MongoDB).  The aliases below make call-sites self-documenting.

/**
 * Generate a cryptographically secure token for a public Group Bill reminder link.
 *
 * Returns:
 *   rawToken  — URL-safe base64url string.  Embed in the email URL only.
 *               Discard immediately after constructing the URL — never persist.
 *   tokenHash — SHA-256 hex digest.  Store ONLY this in MongoDB.
 *
 * The URL:
 *   /group-bill/view/<rawToken>
 *
 * The database stores:
 *   { tokenHash: '<sha256-hex>' }
 */
export function generateReminderToken(): { rawToken: string; tokenHash: string } {
  const { token, tokenHash } = generateVerificationToken()
  return { rawToken: token, tokenHash }
}

/**
 * Hash an incoming raw reminder token (from a URL path segment) for safe DB lookup.
 *
 * Returns null if the input is empty, not a string, or cannot be decoded.
 * A null result must be treated as "token not found" — never expose error detail.
 */
export function hashReminderToken(rawToken: string | null | undefined): string | null {
  return hashToken(rawToken)
}

/**
 * Hash an email address for storage in GroupBillReminderToken.recipientEmailHash.
 * Lower-cases and trims the address before hashing for consistent lookup.
 * Returns null for empty/invalid input.
 */
export function hashEmailForStorage(email: string | null | undefined): string | null {
  if (!email || typeof email !== 'string') return null
  const normalised = email.toLowerCase().trim()
  if (!normalised.includes('@')) return null
  return crypto.createHash('sha256').update(normalised, 'utf8').digest('hex')
}
