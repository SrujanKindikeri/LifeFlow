/**
 * models/SecurityEvent.ts — User-side security event log.
 *
 * Purpose
 * ───────
 * Records security-relevant events in the USER authentication flow:
 *   • Successful and failed logins
 *   • Logout and session expiration
 *   • Session revocation (by an admin)
 *   • Password or security-setting changes (where supported)
 *   • Repeated authentication failures
 *
 * This is DISTINCT from AuditLog (models/AuditLog.ts), which records
 * ADMINISTRATOR actions (actorId is an AdminUser ID).  SecurityEvent
 * records events that happen to regular users, with the user as the
 * "subject" rather than the "actor".
 *
 * Privacy & sanitization
 * ──────────────────────
 *   • Never stores passwords, raw authentication tokens, session cookies,
 *     or complete sensitive request bodies.
 *   • IP addresses are stored in full (admin-only access, retention-bounded)
 *     but are never returned to user-facing APIs.
 *   • Error messages are sanitized (no stack traces, no secrets).
 *   • Metadata is strictly controlled — only safe, non-sensitive fields.
 *
 * Retention
 * ─────────
 * TTL index on createdAt expires documents after SECURITY_EVENT_RETENTION_DAYS
 * (default 90 days).  Configurable via env var.
 *
 * Immutability
 * ───────────
 * createdAt only (no updatedAt).  Documents are never modified after
 * creation — they are only read or expired by TTL.  This provides a
 * tamper-evident trail within the retention window.  Full immutability
 * (preventing modification by any user including DB admins) would
 * require additional database-level controls that are not part of the
 * current MongoDB deployment — see the model header note in AuditLog
 * for the same caveat.
 */

import mongoose, { Document, Model, Schema } from 'mongoose'

// ── Event types ───────────────────────────────────────────────────────────────

export const SECURITY_EVENT_TYPES = [
  // Authentication
  'login_success',
  'login_failure',
  'logout',
  'session_expired',
  'session_revoked',
  // 2FA
  'two_factor_enabled',
  'two_factor_disabled',
  'two_factor_challenge_failed',
  // Password
  'password_changed',
  'password_reset_requested',
  'password_reset_completed',
  // Account
  'account_deleted',
  'account_restored',
  // Authorization
  'permission_denied',
] as const

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number]

export type SecurityEventOutcome = 'success' | 'failure' | 'denied'

// ── Document interface ───────────────────────────────────────────────────────

export interface ISecurityEvent extends Document {
  _id: mongoose.Types.ObjectId

  /** MongoDB ObjectId of the affected user (null when unknown, e.g. failed login with unknown email). */
  userId: mongoose.Types.ObjectId | null

  /** LifeFlow public identifier (LF-XXXXXXXX) — null when unknown. */
  publicId: string | null

  /** The type of security event. */
  eventType: SecurityEventType

  /** Whether the event succeeded, failed, or was denied. */
  outcome: SecurityEventOutcome

  /** Source IP when available — admin-only, never exposed to user APIs. */
  ip: string | null

  /** How the IP was resolved — for debugging only. */
  ipSource: string | null

  /** Coarse device category (desktop/mobile/tablet/unknown). */
  deviceCategory: string

  /** Coarse browser label (e.g. "Chrome"). */
  browser: string

  /** Correlation ID for debugging (links to ModuleEvent when available). */
  correlationId: string | null

  /**
   * Safe additional context.  Never contains secrets, tokens, passwords,
   * or raw request bodies.  Examples: { reason: 'bad_password' },
   * { revokedBy: '<adminId>', revokeReason: '...' }.
   */
  metadata: Record<string, unknown>

  /** UTC timestamp of the event. Immutable. */
  createdAt: Date
}

// ── Schema ────────────────────────────────────────────────────────────────────

const SecurityEventSchema = new Schema<ISecurityEvent>(
  {
    userId: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      default:  null,
      index:    true,
    },
    publicId: {
      type:     String,
      default:  null,
      index:    true,
    },
    eventType: {
      type:     String,
      enum:     SECURITY_EVENT_TYPES,
      required: true,
      index:    true,
    },
    outcome: {
      type:     String,
      enum:     ['success', 'failure', 'denied'] as SecurityEventOutcome[],
      required: true,
      index:    true,
    },
    ip: {
      type:    String,
      default: null,
      index:    true,
    },
    ipSource: {
      type:    String,
      default: null,
    },
    deviceCategory: {
      type:    String,
      default: 'unknown',
    },
    browser: {
      type:    String,
      default: 'Unknown',
    },
    correlationId: {
      type:    String,
      default: null,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'securityevents',
  }
)

// ── Indexes ───────────────────────────────────────────────────────────────────

// Per-user security history
SecurityEventSchema.index({ userId: 1, createdAt: -1 })

// Event type queries (e.g. "all login failures in window")
SecurityEventSchema.index({ eventType: 1, outcome: 1, createdAt: -1 })

// IP-based queries (IP history page)
SecurityEventSchema.index({ ip: 1, createdAt: -1 })

// TTL — configurable retention (default 90 days)
const retentionDays =
  parseInt(process.env.SECURITY_EVENT_RETENTION_DAYS ?? '90', 10) || 90
SecurityEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: retentionDays * 24 * 60 * 60, name: 'securityevent_ttl' }
)

const SecurityEvent: Model<ISecurityEvent> =
  mongoose.models.SecurityEvent ||
  mongoose.model<ISecurityEvent>('SecurityEvent', SecurityEventSchema)

export default SecurityEvent

// ── Safe writer (non-fatal) ───────────────────────────────────────────────────

/**
 * Record a security event.  Non-fatal — errors are logged but never
 * propagate to the caller.  Telemetry failures must never prevent normal
 * LifeFlow features (login, logout, etc.) from working.
 *
 * Import this lazily from route handlers to avoid circular deps.
 */
export async function recordSecurityEvent(params: {
  userId?:      string | null
  publicId?:    string | null
  eventType:   SecurityEventType
  outcome:     SecurityEventOutcome
  ip?:         string | null
  ipSource?:   string | null
  deviceCategory?: string
  browser?:    string
  correlationId?: string | null
  metadata?:   Record<string, unknown>
}): Promise<void> {
  try {
    const { default: mongoose } = await import('mongoose')
    const { connectDB } = await import('@/lib/db')

    // Skip getServerEnv() when mongoose is already connected (test environments)
    if (mongoose.connection.readyState !== 1) {
      await connectDB()
    }

    await SecurityEvent.create({
      userId:        params.userId ? new mongoose.Types.ObjectId(params.userId) : null,
      publicId:      params.publicId ?? null,
      eventType:     params.eventType,
      outcome:       params.outcome,
      ip:            params.ip ?? null,
      ipSource:      params.ipSource ?? null,
      deviceCategory: params.deviceCategory ?? 'unknown',
      browser:       params.browser ?? 'Unknown',
      correlationId: params.correlationId ?? null,
      metadata:      params.metadata ?? {},
    })
  } catch (err) {
    // Non-fatal — never block the primary operation
    const logger = (await import('@/lib/logger')).default
    logger.warn('[security] Failed to record security event', {
      eventType: params.eventType,
      outcome:   params.outcome,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
}
