/**
 * lib/env.ts — Centralized environment variable validation.
 *
 * Validates required server-side environment variables at module load time.
 * Import this module early in any server entry-point so misconfigured
 * deployments fail loudly with a clear message rather than a cryptic
 * runtime crash deep inside a request handler.
 *
 * NEXT_PUBLIC_* variables are safe to expose to the browser.
 * All other variables here are SERVER-ONLY and must never be sent to the client.
 *
 * Usage:
 *   import '@/lib/env'          // side-effect import — validates on load
 *   import { serverEnv } from '@/lib/env'  // typed access to validated vars
 */

// ─── Server-only variables ────────────────────────────────────────────────────
// These are NEVER exposed to the browser bundle.

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
  'DEFAULT_TIMEZONE',
] as const

// ─── Public variables (NEXT_PUBLIC_*) ─────────────────────────────────────────
// These ARE included in the browser bundle — never put secrets here.

const PUBLIC_VARS = [
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_CURRENCY',
] as const

// ─── Validation ───────────────────────────────────────────────────────────────

function validateEnv(): void {
  // Only validate on the server side
  if (typeof window !== 'undefined') return

  const missing: string[] = []

  for (const key of REQUIRED_SERVER_VARS) {
    const value = process.env[key]
    if (!value || value.trim() === '') {
      missing.push(key)
    }
  }

  // SESSION_SECRET length check — iron-session requires ≥ 32 characters
  const sessionSecret = process.env.SESSION_SECRET
  if (sessionSecret && sessionSecret.trim().length < 32) {
    throw new Error(
      `[LifeFlow] SESSION_SECRET must be at least 32 characters long.\n` +
      `Generate a secure value with: openssl rand -base64 32`
    )
  }

  if (missing.length > 0) {
    throw new Error(
      `[LifeFlow] Missing required environment variables:\n` +
      missing.map((k) => `  - ${k}`).join('\n') +
      `\n\nCopy .env.example to .env.local and fill in the values.`
    )
  }
}

// Run validation immediately when this module is loaded on the server
validateEnv()

// ─── Typed accessors ──────────────────────────────────────────────────────────

/**
 * Validated server-only environment variables.
 * Accessing these on the client will return undefined — use only in server
 * components, API routes, middleware, and server utilities.
 */
export const serverEnv = {
  // Database
  MONGODB_URI:      process.env.MONGODB_URI!,
  MONGODB_DB_NAME:  process.env.MONGODB_DB_NAME ?? 'lifeflow',

  // Auth
  SESSION_SECRET: process.env.SESSION_SECRET!,

  // Scheduler / Cron
  SCHEDULER_SECRET: process.env.SCHEDULER_SECRET ?? process.env.CRON_SECRET ?? '',
  CRON_SECRET:      process.env.CRON_SECRET ?? process.env.SCHEDULER_SECRET ?? '',

  // Storage
  STORAGE_PROVIDER:              (process.env.STORAGE_PROVIDER ?? 'mongodb') as 'mongodb' | 's3' | 'azure' | 'local',
  STORAGE_BUCKET:                process.env.STORAGE_BUCKET ?? '',
  STORAGE_REGION:                process.env.STORAGE_REGION ?? 'ap-south-1',
  STORAGE_ACCESS_KEY_ID:         process.env.STORAGE_ACCESS_KEY_ID ?? '',
  STORAGE_SECRET_ACCESS_KEY:     process.env.STORAGE_SECRET_ACCESS_KEY ?? '',
  STORAGE_ENDPOINT:              process.env.STORAGE_ENDPOINT ?? '',
  AZURE_STORAGE_ACCOUNT_NAME:    process.env.AZURE_STORAGE_ACCOUNT_NAME ?? '',
  AZURE_STORAGE_ACCOUNT_KEY:     process.env.AZURE_STORAGE_ACCOUNT_KEY ?? '',
  AZURE_STORAGE_CONTAINER:       process.env.AZURE_STORAGE_CONTAINER ?? '',

  // OCR
  OCR_PROVIDER:        (process.env.OCR_PROVIDER ?? 'auto') as 'google_vision' | 'tesseract' | 'auto',
  GOOGLE_VISION_API_KEY: process.env.GOOGLE_VISION_API_KEY ?? '',
  OCR_API_KEY:         process.env.OCR_API_KEY ?? '',

  // Email / Notifications
  EMAIL_PROVIDER: (process.env.EMAIL_PROVIDER ?? 'none') as 'resend' | 'sendgrid' | 'smtp' | 'none',
  EMAIL_API_KEY:  process.env.EMAIL_API_KEY ?? '',
  EMAIL_FROM:     process.env.EMAIL_FROM ?? 'noreply@lifeflow.app',

  // App
  DEFAULT_TIMEZONE: process.env.DEFAULT_TIMEZONE ?? 'Asia/Kolkata',
  NODE_ENV:         process.env.NODE_ENV ?? 'development',
} as const

/**
 * Public environment variables (safe for browser use).
 * These must all be prefixed with NEXT_PUBLIC_.
 */
export const publicEnv = {
  APP_URL:  process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  CURRENCY: process.env.NEXT_PUBLIC_CURRENCY ?? 'INR',
} as const

// Re-export the types for consumers
export type StorageProvider = typeof serverEnv.STORAGE_PROVIDER
export type OcrProvider = typeof serverEnv.OCR_PROVIDER
export type EmailProvider = typeof serverEnv.EMAIL_PROVIDER

// Suppress unused-variable lint warnings for optional var arrays
void OPTIONAL_SERVER_VARS
void PUBLIC_VARS
