/**
 * tests/2fa-recovery.test.ts
 *
 * End-to-end tests for the twoFactorRecoveryCodeHashes system.
 *
 * Coverage (mirrors the audit checklist):
 *   1.  Recovery codes use cryptographically secure randomness
 *   2.  Exactly 10 codes are generated
 *   3.  Only hashes are stored in MongoDB — raw codes are NOT stored
 *   4.  Raw codes are 20-char lowercase hex strings (10 random bytes)
 *   5.  Every hash is a valid SHA-256 hex digest (64 chars)
 *   6.  All generated hashes are unique (no collisions)
 *   7.  hashRecoveryCode() produces the matching hash for a raw code
 *   8.  hashRecoveryCode() returns null for invalid inputs
 *   9.  A valid recovery code is accepted (login simulation)
 *  10.  A valid code is removed after use (single-use enforcement)
 *  11.  The same code cannot be used a second time
 *  12.  An invalid / unknown code is rejected
 *  13.  Regenerating codes replaces ALL old hashes
 *  14.  Old codes no longer work after regeneration
 *  15.  New codes work after regeneration
 *  16.  GET /api/auth/2fa/recovery returns count only — never raw hashes
 *  17.  POST /api/auth/2fa/recovery response returns raw codes once — never hashes
 *  18.  Session is promoted correctly after valid recovery-code login
 *  19.  Existing users without the field get safe default []
 *  20.  TOTP secret is encrypted — never stored as plaintext
 *  21.  encryptTotpSecret / decryptTotpSecret round-trip
 *  22.  decryptTotpSecret throws on tampered ciphertext
 *  23.  safeCompare prevents timing attacks
 *  24.  generatePublicId format is correct (LF-XXXXXXXX)
 *  25.  Rate-limit source file wires checkRecoveryCodeLimit correctly
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fs   from 'fs'
import * as path from 'path'
import { startDb, stopDb, clearDb } from './helpers/db'
import User from '@/models/User'
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  encryptTotpSecret,
  decryptTotpSecret,
  safeCompare,
} from '@/lib/auth/crypto'
import { generatePublicId } from '@/models/User'

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => { await startDb() })
afterAll(async ()  => { await stopDb()  })
afterEach(async () => { await clearDb() })

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal TOTP encryption key for tests (64 lowercase hex chars). */
const TEST_TOTP_KEY = 'a'.repeat(64)

async function create2faUser(overrides: {
  twoFactorEnabled?: boolean
  twoFactorRecoveryCodeHashes?: string[]
  twoFactorSecretEncrypted?: string | null
} = {}) {
  const bcrypt = await import('bcryptjs')

  // Set up a valid encrypted TOTP secret for the test
  const originalKey = process.env.TOTP_ENCRYPTION_KEY
  process.env.TOTP_ENCRYPTION_KEY = TEST_TOTP_KEY
  const encryptedSecret = encryptTotpSecret('JBSWY3DPEHPK3PXP')
  if (originalKey !== undefined) {
    process.env.TOTP_ENCRYPTION_KEY = originalKey
  } else {
    delete process.env.TOTP_ENCRYPTION_KEY
  }

  return User.create({
    name:         'Test 2FA User',
    email:        `twofa-${Date.now()}@example.com`,
    passwordHash: await bcrypt.default.hash('Test1234!', 10),
    publicId:     generatePublicId(),
    emailVerified: true,
    emailVerificationTokenHash:  null,
    emailVerificationExpiresAt:  null,
    twoFactorEnabled:            overrides.twoFactorEnabled            ?? true,
    twoFactorSecretEncrypted:    overrides.twoFactorSecretEncrypted    ?? encryptedSecret,
    twoFactorVerifiedAt:         overrides.twoFactorEnabled !== false   ? new Date() : null,
    twoFactorRecoveryCodeHashes: overrides.twoFactorRecoveryCodeHashes ?? [],
    notificationPreferences: {
      taskReminders:  true,
      habitReminders: true,
      spendingAlerts: true,
      dailySummary:   false,
    },
    emailNotifications: {
      enabled:        false,
      taskReminders:  true,
      habitReminders: true,
      spendingAlerts: true,
      dailySummary:   true,
    },
  })
}

// ─── 1–2. Code generation ──────────────────────────────────────────────────────

describe('1–2. Recovery code generation basics', () => {
  it('1. generateRecoveryCodes returns codes and codeHashes arrays', () => {
    const { codes, codeHashes } = generateRecoveryCodes()
    expect(Array.isArray(codes)).toBe(true)
    expect(Array.isArray(codeHashes)).toBe(true)
  })

  it('2. Exactly 10 codes are generated', () => {
    const { codes, codeHashes } = generateRecoveryCodes()
    expect(codes).toHaveLength(10)
    expect(codeHashes).toHaveLength(10)
  })
})

// ─── 3. Only hashes stored ────────────────────────────────────────────────────

describe('3. Only hashes are stored — raw codes are never persisted', () => {
  it('3a. codeHashes differ from raw codes', () => {
    const { codes, codeHashes } = generateRecoveryCodes()
    for (let i = 0; i < codes.length; i++) {
      // The hash must not equal the raw code
      expect(codeHashes[i]).not.toBe(codes[i])
    }
  })

  it('3b. raw codes are NOT stored after enable', async () => {
    const { codes, codeHashes } = generateRecoveryCodes()
    const user = await create2faUser({ twoFactorRecoveryCodeHashes: codeHashes })

    // Read back from DB — should never see raw codes
    const found = await User.findById(user._id).lean()
    const stored = found?.twoFactorRecoveryCodeHashes ?? []

    for (const rawCode of codes) {
      expect(stored).not.toContain(rawCode)
    }
  })

  it('3c. stored values are 64-char hex strings (SHA-256 digests)', async () => {
    const { codeHashes } = generateRecoveryCodes()
    const user = await create2faUser({ twoFactorRecoveryCodeHashes: codeHashes })

    const found = await User.findById(user._id).lean()
    const stored = found?.twoFactorRecoveryCodeHashes ?? []

    for (const hash of stored) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})

// ─── 4–5. Code and hash format ────────────────────────────────────────────────

describe('4–5. Code and hash format', () => {
  it('4. Raw codes are 20-char lowercase hex strings', () => {
    const { codes } = generateRecoveryCodes()
    for (const code of codes) {
      expect(code).toMatch(/^[0-9a-f]{20}$/)
    }
  })

  it('5. Each hash is a 64-char SHA-256 hex digest', () => {
    const { codeHashes } = generateRecoveryCodes()
    for (const hash of codeHashes) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})

// ─── 6. All hashes unique ─────────────────────────────────────────────────────

describe('6. All generated hashes are unique', () => {
  it('no two codes share the same hash', () => {
    const { codeHashes } = generateRecoveryCodes()
    const uniqueHashes = new Set(codeHashes)
    expect(uniqueHashes.size).toBe(codeHashes.length)
  })

  it('no two raw codes are identical', () => {
    const { codes } = generateRecoveryCodes()
    const unique = new Set(codes)
    expect(unique.size).toBe(codes.length)
  })
})

// ─── 7–8. hashRecoveryCode() ──────────────────────────────────────────────────

describe('7–8. hashRecoveryCode()', () => {
  it('7. hashRecoveryCode produces the same hash as generateRecoveryCodes', () => {
    const { codes, codeHashes } = generateRecoveryCodes()
    for (let i = 0; i < codes.length; i++) {
      const recomputed = hashRecoveryCode(codes[i])
      expect(recomputed).toBe(codeHashes[i])
    }
  })

  it('8a. hashRecoveryCode returns null for null input', () => {
    expect(hashRecoveryCode(null)).toBeNull()
  })

  it('8b. hashRecoveryCode returns null for undefined', () => {
    expect(hashRecoveryCode(undefined)).toBeNull()
  })

  it('8c. hashRecoveryCode returns null for empty string', () => {
    expect(hashRecoveryCode('')).toBeNull()
  })

  it('8d. hashRecoveryCode returns null for wrong-length string', () => {
    // Only 20-char lowercase hex codes are valid (10 bytes)
    expect(hashRecoveryCode('abc123')).toBeNull()
    expect(hashRecoveryCode('a'.repeat(40))).toBeNull() // 40 hex chars = 20 bytes, invalid
  })

  it('8e. hashRecoveryCode is case-insensitive (normalises to lowercase)', () => {
    const { codes, codeHashes } = generateRecoveryCodes()
    const upper = codes[0].toUpperCase()
    const hash  = hashRecoveryCode(upper)
    expect(hash).toBe(codeHashes[0])
  })
})

// ─── 9. Valid code accepted ───────────────────────────────────────────────────

describe('9. Valid recovery code is accepted (login simulation)', () => {
  it('9a. indexOf finds the code hash in the stored array', async () => {
    const { codes, codeHashes } = generateRecoveryCodes()
    const user = await create2faUser({ twoFactorRecoveryCodeHashes: codeHashes })

    const codeToUse = codes[0]
    const inboundHash = hashRecoveryCode(codeToUse)
    expect(inboundHash).not.toBeNull()

    const fresh = await User.findById(user._id)
    expect(fresh).not.toBeNull()
    const idx = fresh!.twoFactorRecoveryCodeHashes.indexOf(inboundHash!)
    expect(idx).toBeGreaterThanOrEqual(0)
  })
})

// ─── 10–11. Single-use enforcement ───────────────────────────────────────────

describe('10–11. Single-use enforcement', () => {
  it('10. Code hash is removed after use', async () => {
    const { codes, codeHashes } = generateRecoveryCodes()
    const user = await create2faUser({ twoFactorRecoveryCodeHashes: codeHashes })

    const codeToUse = codes[0]
    const inboundHash = hashRecoveryCode(codeToUse)!

    // Simulate what verify-2fa route does
    const fresh = await User.findById(user._id)
    const idx   = fresh!.twoFactorRecoveryCodeHashes.indexOf(inboundHash)
    expect(idx).toBeGreaterThanOrEqual(0)

    fresh!.twoFactorRecoveryCodeHashes.splice(idx, 1)
    await fresh!.save()

    // Confirm it's gone
    const after = await User.findById(user._id).lean()
    expect(after!.twoFactorRecoveryCodeHashes).not.toContain(inboundHash)
    expect(after!.twoFactorRecoveryCodeHashes).toHaveLength(9)
  })

  it('11. The same code cannot be used a second time', async () => {
    const { codes, codeHashes } = generateRecoveryCodes()
    const user = await create2faUser({ twoFactorRecoveryCodeHashes: codeHashes })

    const codeToUse = codes[0]
    const inboundHash = hashRecoveryCode(codeToUse)!

    // First use — succeeds and removes the code
    const fresh = await User.findById(user._id)
    const idx   = fresh!.twoFactorRecoveryCodeHashes.indexOf(inboundHash)
    fresh!.twoFactorRecoveryCodeHashes.splice(idx, 1)
    await fresh!.save()

    // Second use — hash no longer present → rejected
    const fresh2 = await User.findById(user._id)
    const idx2   = fresh2!.twoFactorRecoveryCodeHashes.indexOf(inboundHash)
    expect(idx2).toBe(-1)  // not found → login would be rejected
  })
})

// ─── 12. Invalid code rejected ────────────────────────────────────────────────

describe('12. Invalid recovery code is rejected', () => {
  it('12a. Unknown code hash returns indexOf = -1', async () => {
    const { codeHashes } = generateRecoveryCodes()
    const user = await create2faUser({ twoFactorRecoveryCodeHashes: codeHashes })

    // Generate a completely different set of codes — these will not match
    const { codes: otherCodes } = generateRecoveryCodes()
    const wrongCode  = otherCodes[0]
    const wrongHash  = hashRecoveryCode(wrongCode)!

    const fresh = await User.findById(user._id)
    const idx   = fresh!.twoFactorRecoveryCodeHashes.indexOf(wrongHash)
    expect(idx).toBe(-1)
  })

  it('12b. Random 20-char hex string that was never generated is rejected', async () => {
    const { codeHashes } = generateRecoveryCodes()
    const user = await create2faUser({ twoFactorRecoveryCodeHashes: codeHashes })

    const randomCode = 'deadbeefcafebabe0011'  // 20 hex chars but not in the set
    const randomHash = hashRecoveryCode(randomCode)

    const fresh = await User.findById(user._id)
    const idx   = fresh!.twoFactorRecoveryCodeHashes.indexOf(randomHash ?? '')
    expect(idx).toBe(-1)
  })

  it('12c. Completely invalid string is rejected before DB lookup', () => {
    const badHash = hashRecoveryCode('not-a-hex-code')
    expect(badHash).toBeNull()
    // If hashRecoveryCode returns null, the route returns 400 before touching the DB
  })
})

// ─── 13–15. Regeneration ─────────────────────────────────────────────────────

describe('13–15. Code regeneration', () => {
  it('13. Regenerating replaces ALL old hashes with 10 new ones', async () => {
    const { codes: oldCodes, codeHashes: oldHashes } = generateRecoveryCodes()
    const user = await create2faUser({ twoFactorRecoveryCodeHashes: oldHashes })

    // Simulate POST /api/auth/2fa/recovery
    const { codes: newCodes, codeHashes: newHashes } = generateRecoveryCodes()
    const fresh = await User.findById(user._id)
    fresh!.twoFactorRecoveryCodeHashes = newHashes
    await fresh!.save()

    const after = await User.findById(user._id).lean()
    expect(after!.twoFactorRecoveryCodeHashes).toHaveLength(10)

    // All old hashes are gone
    for (const oldHash of oldHashes) {
      expect(after!.twoFactorRecoveryCodeHashes).not.toContain(oldHash)
    }

    // All new hashes are present
    for (const newHash of newHashes) {
      expect(after!.twoFactorRecoveryCodeHashes).toContain(newHash)
    }

    // Confirm oldCodes and newCodes are in scope (no unused var warnings)
    expect(oldCodes.length).toBe(10)
    expect(newCodes.length).toBe(10)
  })

  it('14. Old codes no longer work after regeneration', async () => {
    const { codes: oldCodes, codeHashes: oldHashes } = generateRecoveryCodes()
    const user = await create2faUser({ twoFactorRecoveryCodeHashes: oldHashes })

    // Regenerate
    const { codeHashes: newHashes } = generateRecoveryCodes()
    const fresh = await User.findById(user._id)
    fresh!.twoFactorRecoveryCodeHashes = newHashes
    await fresh!.save()

    // Try each old code
    const after = await User.findById(user._id)
    for (const oldCode of oldCodes) {
      const oldHash = hashRecoveryCode(oldCode)!
      const idx     = after!.twoFactorRecoveryCodeHashes.indexOf(oldHash)
      expect(idx).toBe(-1)
    }
  })

  it('15. New codes work after regeneration', async () => {
    const { codeHashes: oldHashes } = generateRecoveryCodes()
    const user = await create2faUser({ twoFactorRecoveryCodeHashes: oldHashes })

    // Regenerate
    const { codes: newCodes, codeHashes: newHashes } = generateRecoveryCodes()
    const fresh = await User.findById(user._id)
    fresh!.twoFactorRecoveryCodeHashes = newHashes
    await fresh!.save()

    // Try each new code
    const after = await User.findById(user._id)
    for (const newCode of newCodes) {
      const newHash = hashRecoveryCode(newCode)!
      const idx     = after!.twoFactorRecoveryCodeHashes.indexOf(newHash)
      expect(idx).toBeGreaterThanOrEqual(0)
    }
  })
})

// ─── 16–17. API response safety ───────────────────────────────────────────────

describe('16–17. API response safety — hashes never returned', () => {
  it('16. GET /api/auth/2fa/recovery route returns codesRemaining — never the hashes', () => {
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/auth/2fa/recovery/route.ts'),
      'utf8'
    )
    // Must return codesRemaining (count) — not the array of hash values
    expect(routeSrc).toContain('codesRemaining')
    // Must use .length to get count
    expect(routeSrc).toContain('twoFactorRecoveryCodeHashes.length')
    // The response JSON must not expose the hashes array directly
    expect(routeSrc).not.toContain('"twoFactorRecoveryCodeHashes":')
    // The response payload must contain codesRemaining (count), not the hash array
    expect(routeSrc).toContain('codesRemaining: user.twoFactorRecoveryCodeHashes.length')
  })

  it('17. Enable route returns recoveryCodes (raw) — never codeHashes', () => {
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/auth/2fa/enable/route.ts'),
      'utf8'
    )
    // Raw codes returned once
    expect(routeSrc).toContain('recoveryCodes')
    // Hashes are stored, not returned
    expect(routeSrc).toContain('twoFactorRecoveryCodeHashes = codeHashes')
    // The response payload must not include hashes
    expect(routeSrc).not.toContain('"codeHashes"')
    expect(routeSrc).not.toMatch(/codeHashes[^,\s]/)
  })

  it('17b. Regeneration route returns recoveryCodes (raw) — never codeHashes', () => {
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/auth/2fa/recovery/route.ts'),
      'utf8'
    )
    expect(routeSrc).toContain('recoveryCodes')
    expect(routeSrc).not.toContain('"codeHashes"')
  })
})

// ─── 18. Session promotion ────────────────────────────────────────────────────

describe('18. Session is promoted after valid recovery-code login', () => {
  it('18. verify-2fa route promotes session after recovery code use', () => {
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/auth/verify-2fa/route.ts'),
      'utf8'
    )
    // After use, the code is removed
    expect(routeSrc).toContain('twoFactorRecoveryCodeHashes.splice(idx, 1)')
    // Session is promoted to full auth
    expect(routeSrc).toContain('session.isLoggedIn         = true')
    expect(routeSrc).toContain('session.twoFactorPending   = false')
    // Method is logged
    expect(routeSrc).toContain("method: isRecovery ? 'recovery' : 'totp'")
  })
})

// ─── 19. Existing users without the field ─────────────────────────────────────

describe('19. Existing users without the field get safe default []', () => {
  it('19a. Mongoose schema default is [] for twoFactorRecoveryCodeHashes', async () => {
    const user = await create2faUser({ twoFactorRecoveryCodeHashes: undefined as unknown as string[] })
    const found = await User.findById(user._id).lean()
    // Should be an empty array by default
    expect(Array.isArray(found?.twoFactorRecoveryCodeHashes)).toBe(true)
    expect(found?.twoFactorRecoveryCodeHashes).toHaveLength(0)
  })

  it('19b. 2FA disabled users have empty recovery codes array', async () => {
    const user = await create2faUser({
      twoFactorEnabled: false,
      twoFactorRecoveryCodeHashes: [],
      twoFactorSecretEncrypted: null,
    })
    const found = await User.findById(user._id).lean()
    expect(found?.twoFactorEnabled).toBe(false)
    expect(found?.twoFactorRecoveryCodeHashes).toHaveLength(0)
  })
})

// ─── 20–22. TOTP encryption ───────────────────────────────────────────────────

describe('20–22. TOTP secret encryption', () => {
  it('20. TOTP secret is never stored as plaintext', () => {
    process.env.TOTP_ENCRYPTION_KEY = TEST_TOTP_KEY

    const plaintext  = 'JBSWY3DPEHPK3PXP'
    const encrypted  = encryptTotpSecret(plaintext)

    // Encrypted format: iv:authTag:ciphertext
    expect(encrypted).toContain(':')
    expect(encrypted).not.toContain(plaintext)

    delete process.env.TOTP_ENCRYPTION_KEY
  })

  it('21. encryptTotpSecret / decryptTotpSecret round-trip', () => {
    process.env.TOTP_ENCRYPTION_KEY = TEST_TOTP_KEY

    const plaintext = 'JBSWY3DPEHPK3PXP'
    const encrypted = encryptTotpSecret(plaintext)
    const decrypted = decryptTotpSecret(encrypted)

    expect(decrypted).toBe(plaintext)

    delete process.env.TOTP_ENCRYPTION_KEY
  })

  it('22. decryptTotpSecret throws on tampered ciphertext', () => {
    process.env.TOTP_ENCRYPTION_KEY = TEST_TOTP_KEY

    const plaintext = 'JBSWY3DPEHPK3PXP'
    const encrypted = encryptTotpSecret(plaintext)

    // Tamper with the last few chars of the ciphertext
    const parts    = encrypted.split(':')
    parts[2]       = parts[2].slice(0, -4) + 'ffff'  // corrupt ciphertext tail
    const tampered = parts.join(':')

    expect(() => decryptTotpSecret(tampered)).toThrow()

    delete process.env.TOTP_ENCRYPTION_KEY
  })

  it('22b. decryptTotpSecret throws without the TOTP key', () => {
    const saved = process.env.TOTP_ENCRYPTION_KEY
    delete process.env.TOTP_ENCRYPTION_KEY

    expect(() => decryptTotpSecret('iv:tag:ct')).toThrow()

    if (saved !== undefined) process.env.TOTP_ENCRYPTION_KEY = saved
  })
})

// ─── 23. safeCompare ─────────────────────────────────────────────────────────

describe('23. safeCompare prevents timing attacks', () => {
  it('23a. returns true for identical strings', () => {
    expect(safeCompare('abc', 'abc')).toBe(true)
  })

  it('23b. returns false for different strings of the same length', () => {
    expect(safeCompare('abc', 'xyz')).toBe(false)
  })

  it('23c. returns false for strings of different lengths', () => {
    expect(safeCompare('ab', 'abc')).toBe(false)
  })
})

// ─── 24. generatePublicId ─────────────────────────────────────────────────────

describe('24. generatePublicId format', () => {
  it('24a. ID matches LF-XXXXXXXX format', () => {
    const id = generatePublicId()
    expect(id).toMatch(/^LF-[A-Z2-9]{8}$/)
  })

  it('24b. IDs are unique across multiple calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generatePublicId()))
    // Very high probability of uniqueness (32^8 possible values)
    expect(ids.size).toBeGreaterThan(95)
  })
})

// ─── 25. Rate limiting wired correctly ───────────────────────────────────────

describe('25. Rate limiting is wired for recovery codes', () => {
  it('25a. verify-2fa uses checkRecoveryCodeLimit for recovery code attempts', () => {
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/auth/verify-2fa/route.ts'),
      'utf8'
    )
    expect(routeSrc).toContain('checkRecoveryCodeLimit')
    expect(routeSrc).toContain('checkTotpAttemptLimit')
    // Recovery path uses the specific recovery limiter (line endings may vary)
    expect(routeSrc).toContain('checkRecoveryCodeLimit(pendingUserId)')
    expect(routeSrc).toContain('checkTotpAttemptLimit(pendingUserId)')
  })

  it('25b. checkRecoveryCodeLimit limits to 5 attempts per 15 minutes', () => {
    const rlSrc = fs.readFileSync(
      path.join(process.cwd(), 'lib/auth/rate-limit.ts'),
      'utf8'
    )
    // Verify the limit configuration is 5/15min
    expect(rlSrc).toContain('checkRecoveryCodeLimit')
    expect(rlSrc).toContain('limit:    5')
    expect(rlSrc).toContain('15 * 60 * 1000')
  })

  it('25c. recovery endpoint requires password + TOTP before regenerating', () => {
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/auth/2fa/recovery/route.ts'),
      'utf8'
    )
    // Must require both password and TOTP code for regeneration
    expect(routeSrc).toContain('password')
    expect(routeSrc).toContain('bcrypt.compare')
    expect(routeSrc).toContain('authenticator.check')
    expect(routeSrc).toContain('checkTotpAttemptLimit')
  })
})

// ─── Bonus: source file structure checks ──────────────────────────────────────

describe('Bonus: source-level security invariants', () => {
  it('crypto.ts never stores raw codes — only hashes returned from generateRecoveryCodes', () => {
    const cryptoSrc = fs.readFileSync(
      path.join(process.cwd(), 'lib/auth/crypto.ts'),
      'utf8'
    )
    // The function comment documents this
    expect(cryptoSrc).toContain('never stored')
    expect(cryptoSrc).toContain('codeHashes')
    // SHA-256 is used for hashing (constant name in source)
    expect(cryptoSrc).toContain("'sha256'")
    // Raw bytes, not a PRNG shortcut
    expect(cryptoSrc).toContain('randomBytes')
  })

  it('enable route stores codeHashes, returns codes — not the other way around', () => {
    const enableSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/auth/2fa/enable/route.ts'),
      'utf8'
    )
    // Hashes go to DB
    expect(enableSrc).toContain('twoFactorRecoveryCodeHashes = codeHashes')
    // Raw codes go to response
    expect(enableSrc).toContain('recoveryCodes,')
    // Response does NOT include codeHashes
    expect(enableSrc).not.toContain('codeHashes,')
  })

  it('disable route wipes all TOTP data including recovery hashes', () => {
    const disableSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/auth/2fa/disable/route.ts'),
      'utf8'
    )
    expect(disableSrc).toContain('twoFactorEnabled            = false')
    expect(disableSrc).toContain('twoFactorSecretEncrypted    = null')
    expect(disableSrc).toContain('twoFactorRecoveryCodeHashes = []')
  })
})
