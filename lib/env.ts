/**
 * lib/env.ts — Centralized environment variable validation.
 *
 * Design: build-safe, runtime-strict.
 *
 * During `next build` the module may be imported (e.g. by static analysis of
 * route files) without the production secrets being present.  To avoid build
 * failures in Docker / CI where MONGODB_URI and SESSION_SECRET are intentionally
 * absent, this module NO LONGER validates at import time.
 *
 * Instead:
 *   - `serverEnv`      — lazy object whose properties read `process.env` on
 *                        every access; safe to import at build time.
 *   - `getServerEnv()` — validates ALL required variables and throws clearly
 *                        if any are missing; call this inside request handlers,
 *                        connectDB(), getSession(), etc. — never at module level.
 *
 * NEXT_PUBLIC_* variables are safe to expose to the browser.
 * All other variables here are SERVER-ONLY and must never be sent to the client.
 *
 * Usage (runtime — API routes, server components, utilities):
 *   import { getServerEnv } from '@/lib/env'
 *   const env = getServerEnv()   // validates & returns typed snapshot
 *   env.MONGODB_URI              // guaranteed non-empty at runtime
 *
 * Usage (build-safe lazy access — avoid for required vars):
 *   import { serverEnv } from '@/lib/env'
 *   serverEnv.DEFAULT_TIMEZONE   // reads process.env on access, no validation
 */

// ─── Variable lists (documentation / startup check only) ─────────────────────

const REQUIRED_SERVER_VARS = [
  'MONGODB_URI',
  'SESSION_SECRET',
] as const

const OPTIONAL_SERVER_VARS = [
  'MONGODB_DB_NAME',
  'SCHEDULER_SECRET',
  'CRON_SECRET',
  'STORAGE_PROVIDER',
  'STORAGE_BUCKET',
  'STORAGE_REGION',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'STORAGE_ENDPOINT',
  'AZURE_STORAGE_ACCOUNT_NAME',
  'AZURE_STORAGE_ACCOUNT_KEY',
  'AZURE_STORAGE_CONTAINER',
  'OCR_PROVIDER',
  'GOOGLE_VISION_API_KEY',
  'OCR_API_KEY',
  'EMAIL_PROVIDER',
  'EMAIL_API_KEY',
  'EMAIL_FROM',
  'EMAIL_FROM_NAME',
  // SMTP relay (required when EMAIL_PROVIDER=smtp)
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  // TOTP secret encryption key (required when 2FA is in use)
  'TOTP_ENCRYPTION_KEY',
  'DEFAULT_TIMEZONE',
] as const

// ─── Public variables (NEXT_PUBLIC_*) ─────────────────────────────────────────
// These ARE included in the browser bundle — never put secrets here.

const PUBLIC_VARS = [
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_CURRENCY',
] as const

// ─── Runtime validation ───────────────────────────────────────────────────────

/**
 * Validate all required server-side environment variables and return a
 * fully-typed, immutable snapshot.
 *
 * Call this INSIDE request handlers, connectDB(), getSession(), etc.
 * NEVER call it at module level — doing so would break `next build` in
 * environments where secrets are not available (e.g. Docker build stage).
 *
 * @throws {Error} with a clear list of missing/invalid variables.
 */
export function getServerEnv() {
  // Guard: only valid on the server
  if (typeof window !== 'undefined') {
    throw new Error('[LifeFlow] getServerEnv() must only be called on the server.')
  }

  const missing: string[] = []

  for (const key of REQUIRED_SERVER_VARS) {
    const value = process.env[key]
    if (!value || value.trim() === '') {
      missing.push(key)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `[LifeFlow] Missing required environment variables:\n` +
      missing.map((k) => `  - ${k}`).join('\n') +
      `\n\nCopy .env.example to .env.local and fill in the values.`
    )
  }

  // SESSION_SECRET length check — iron-session requires ≥ 32 characters
  const sessionSecret = process.env.SESSION_SECRET!
  if (sessionSecret.trim().length < 32) {
    throw new Error(
      `[LifeFlow] SESSION_SECRET must be at least 32 characters long.\n` +
      `Generate a secure value with: openssl rand -base64 32`
    )
  }

  return {
    // Database
    MONGODB_URI:      process.env.MONGODB_URI!,
    MONGODB_DB_NAME:  process.env.MONGODB_DB_NAME ?? 'lifeflow',

    // Auth
    SESSION_SECRET: process.env.SESSION_SECRET!,

    // Scheduler / Cron
    SCHEDULER_SECRET: process.env.SCHEDULER_SECRET ?? process.env.CRON_SECRET ?? '',
    CRON_SECRET:      process.env.CRON_SECRET ?? process.env.SCHEDULER_SECRET ?? '',

    // Storage
    STORAGE_PROVIDER:              (process.env.STORAGE_PROVIDER ?? 'mongodb') as StorageProvider,
    STORAGE_BUCKET:                process.env.STORAGE_BUCKET ?? '',
    STORAGE_REGION:                process.env.STORAGE_REGION ?? 'ap-south-1',
    STORAGE_ACCESS_KEY_ID:         process.env.STORAGE_ACCESS_KEY_ID ?? '',
    STORAGE_SECRET_ACCESS_KEY:     process.env.STORAGE_SECRET_ACCESS_KEY ?? '',
    STORAGE_ENDPOINT:              process.env.STORAGE_ENDPOINT ?? '',
    AZURE_STORAGE_ACCOUNT_NAME:    process.env.AZURE_STORAGE_ACCOUNT_NAME ?? '',
    AZURE_STORAGE_ACCOUNT_KEY:     process.env.AZURE_STORAGE_ACCOUNT_KEY ?? '',
    AZURE_STORAGE_CONTAINER:       process.env.AZURE_STORAGE_CONTAINER ?? '',

    // OCR
    OCR_PROVIDER:          (process.env.OCR_PROVIDER ?? 'auto') as OcrProvider,
    GOOGLE_VISION_API_KEY: process.env.GOOGLE_VISION_API_KEY ?? '',
    OCR_API_KEY:           process.env.OCR_API_KEY ?? '',

    // Email / Notifications
    EMAIL_PROVIDER: (process.env.EMAIL_PROVIDER ?? 'none') as EmailProvider,
    EMAIL_API_KEY:  process.env.EMAIL_API_KEY ?? '',
    EMAIL_FROM:     process.env.EMAIL_FROM ?? 'noreply@lifeflow.app',
    EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME ?? 'LifeFlow',

    // SMTP relay (used when EMAIL_PROVIDER=smtp)
    SMTP_HOST:     process.env.SMTP_HOST ?? '',
    SMTP_PORT:     parseInt(process.env.SMTP_PORT ?? '587', 10),
    SMTP_USER:     process.env.SMTP_USER ?? '',
    SMTP_PASSWORD: process.env.SMTP_PASSWORD ?? process.env.SMTP_PASS ?? '',

    // TOTP 2FA — AES-256-GCM encryption key for stored secrets
    // Must be a 32-byte (256-bit) hex string.
    // Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    TOTP_ENCRYPTION_KEY: process.env.TOTP_ENCRYPTION_KEY ?? '',

    // App
    DEFAULT_TIMEZONE: process.env.DEFAULT_TIMEZONE ?? 'Asia/Kolkata',
    NODE_ENV:         process.env.NODE_ENV ?? 'development',
  } as const
}

// ─── Lazy build-safe accessor ─────────────────────────────────────────────────

/**
 * Build-safe lazy accessor for server environment variables.
 *
 * Each property reads `process.env` at access time — importing this object
 * does NOT validate or throw, so it is safe to import during `next build`.
 *
 * For required variables (MONGODB_URI, SESSION_SECRET) prefer `getServerEnv()`
 * inside your handler/function body so you get a clear error if they are absent.
 *
 * Optional and defaulted variables are fine to read here at any time.
 */
export const serverEnv = {
  // Database
  get MONGODB_URI()      { return process.env.MONGODB_URI ?? '' },
  get MONGODB_DB_NAME()  { return process.env.MONGODB_DB_NAME ?? 'lifeflow' },

  // Auth
  get SESSION_SECRET()   { return process.env.SESSION_SECRET ?? '' },

  // Scheduler / Cron
  get SCHEDULER_SECRET() { return process.env.SCHEDULER_SECRET ?? process.env.CRON_SECRET ?? '' },
  get CRON_SECRET()      { return process.env.CRON_SECRET ?? process.env.SCHEDULER_SECRET ?? '' },

  // Storage
  get STORAGE_PROVIDER()           { return (process.env.STORAGE_PROVIDER ?? 'mongodb') as StorageProvider },
  get STORAGE_BUCKET()             { return process.env.STORAGE_BUCKET ?? '' },
  get STORAGE_REGION()             { return process.env.STORAGE_REGION ?? 'ap-south-1' },
  get STORAGE_ACCESS_KEY_ID()      { return process.env.STORAGE_ACCESS_KEY_ID ?? '' },
  get STORAGE_SECRET_ACCESS_KEY()  { return process.env.STORAGE_SECRET_ACCESS_KEY ?? '' },
  get STORAGE_ENDPOINT()           { return process.env.STORAGE_ENDPOINT ?? '' },
  get AZURE_STORAGE_ACCOUNT_NAME() { return process.env.AZURE_STORAGE_ACCOUNT_NAME ?? '' },
  get AZURE_STORAGE_ACCOUNT_KEY()  { return process.env.AZURE_STORAGE_ACCOUNT_KEY ?? '' },
  get AZURE_STORAGE_CONTAINER()    { return process.env.AZURE_STORAGE_CONTAINER ?? '' },

  // OCR
  get OCR_PROVIDER()          { return (process.env.OCR_PROVIDER ?? 'auto') as OcrProvider },
  get GOOGLE_VISION_API_KEY() { return process.env.GOOGLE_VISION_API_KEY ?? '' },
  get OCR_API_KEY()           { return process.env.OCR_API_KEY ?? '' },

  // Email / Notifications
  get EMAIL_PROVIDER() { return (process.env.EMAIL_PROVIDER ?? 'none') as EmailProvider },
  get EMAIL_API_KEY()  { return process.env.EMAIL_API_KEY ?? '' },
  get EMAIL_FROM()     { return process.env.EMAIL_FROM ?? 'noreply@lifeflow.app' },
  get EMAIL_FROM_NAME() { return process.env.EMAIL_FROM_NAME ?? 'LifeFlow' },

  // SMTP relay
  get SMTP_HOST()     { return process.env.SMTP_HOST ?? '' },
  get SMTP_PORT()     { return parseInt(process.env.SMTP_PORT ?? '587', 10) },
  get SMTP_USER()     { return process.env.SMTP_USER ?? '' },
  get SMTP_PASSWORD() { return process.env.SMTP_PASSWORD ?? process.env.SMTP_PASS ?? '' },

  // TOTP 2FA encryption key
  get TOTP_ENCRYPTION_KEY() { return process.env.TOTP_ENCRYPTION_KEY ?? '' },

  // App
  get DEFAULT_TIMEZONE() { return process.env.DEFAULT_TIMEZONE ?? 'Asia/Kolkata' },
  get NODE_ENV()         { return process.env.NODE_ENV ?? 'development' },
}

// ─── Public variables (safe for browser) ─────────────────────────────────────

/**
 * Public environment variables (safe for browser use).
 * These must all be prefixed with NEXT_PUBLIC_.
 */
export const publicEnv = {
  APP_URL:  process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  CURRENCY: process.env.NEXT_PUBLIC_CURRENCY ?? 'INR',
} as const

// ─── Type exports ─────────────────────────────────────────────────────────────

export type StorageProvider = 'mongodb' | 's3' | 'azure' | 'local'
export type OcrProvider     = 'google_vision' | 'tesseract' | 'auto'
export type EmailProvider   = 'resend' | 'sendgrid' | 'smtp' | 'none'

// Suppress unused-variable lint warnings for documentation-only arrays
void OPTIONAL_SERVER_VARS
void PUBLIC_VARS
