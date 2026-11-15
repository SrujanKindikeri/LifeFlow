/**
 * models/UserSession.ts — Server-side session presence record.
 *
 * Purpose
 * ───────
 * The LifeFlow session itself lives in an encrypted iron-session cookie
 * (lib/session.ts).  There is no DB session table that can be queried for
 * "who is online".  This model is the *observability layer* on top of that:
 * every time a client heartbeat arrives we upsert a UserSession document
 * that records the IP, device fingerprint (coarse UA parse only), login
 * time, and last-seen time.
 *
 * Combined with the existing ActivityHeartbeat model (which tracks
 * per-module presence), this gives the admin dashboard:
 *   • Live sessions with IP, browser, OS, device category
 *   • Configurable presence states (active / idle / expired / revoked / logged_out)
 *   • Session history and revocation
 *
 * Multi-tab / multi-device handling
 * ─────────────────────────────────
 * The `sessionId` is a client-generated UUID (one per browser tab), shared
 * with ActivityHeartbeat.  The unique index on (userId, sessionId) means
 * one document per tab.  A user with two tabs has two UserSession documents
 * — both show as active.  Closing one tab does not affect the other.
 *
 * Presence states
 * ───────────────
 *   active     — lastSeenAt within HEARTBEAT_ACTIVE_MINUTES (default 3 min)
 *   idle       — lastSeenAt within HEARTBEAT_RECENT_MINUTES (default 30 min)
 *   expired    — lastSeenAt beyond recent threshold but within TTL window
 *   revoked    — an admin has revoked this session
 *   logged_out — the user explicitly logged out
 *
 * Note: because browser closure / sleep / network loss can prevent
 * immediate detection, "active" / "idle" are ESTIMATES based on the last
 * heartbeat.  The UI always shows the last-seen timestamp and labels
 * status as estimated.
 *
 * Retention
 * ─────────
 * TTL index on lastSeenAt expires documents after USER_SESSION_TTL_HOURS
 * (default 24h).  Revoked and logged-out sessions are retained for the
 * same window for audit purposes, then cleaned up by TTL.
 *
 * Privacy
 * ───────
 * IP addresses and device information are stored ONLY in this model
 * (admin-only access).  They are never exposed to user-facing APIs,
 * never logged in full in audit logs (use redactIp for logs), and never
 * used as proof of identity.
 */

import mongoose, { Document, Model, Schema } from 'mongoose'
import type { ModuleName } from './ModuleEvent'

// ── Configurable thresholds (reused from ActivityHeartbeat for consistency) ──

export const HEARTBEAT_ACTIVE_MINUTES: number =
  parseInt(process.env.HEARTBEAT_ACTIVE_MINUTES ?? '3', 10) || 3

export const HEARTBEAT_RECENT_MINUTES: number =
  parseInt(process.env.HEARTBEAT_RECENT_MINUTES ?? '30', 10) || 30

const USER_SESSION_TTL_HOURS: number =
  parseInt(process.env.USER_SESSION_TTL_HOURS ?? '24', 10) || 24

// ── Types ─────────────────────────────────────────────────────────────────────

export type SessionStatus = 'active' | 'idle' | 'expired' | 'revoked' | 'logged_out'

export type DeviceCategory = 'desktop' | 'mobile' | 'tablet' | 'unknown'

export interface IUserSession extends Document {
  _id: mongoose.Types.ObjectId

  /** MongoDB ObjectId of the user owning this session. */
  userId: mongoose.Types.ObjectId

  /** LifeFlow public identifier (LF-XXXXXXXX) — server-derived. */
  publicId: string

  /**
   * Client-generated UUID — one per browser tab.  Shared with
   * ActivityHeartbeat so per-module presence can be correlated to the
   * session record.  This is NOT an authentication token.
   */
  sessionId: string

  /** Current session status. See model header for definitions. */
  status: SessionStatus

  /**
   * IP address observed by the server.  Derived from trusted-proxy-aware
   * extraction (lib/ip.ts).  Never proof of identity.
   */
  ip: string | null

  /** How the IP was resolved — for audit/debugging only. */
  ipSource: 'direct' | 'forwarded' | 'real_ip' | 'untrusted' | 'unknown'

  /** Browser name (e.g. "Chrome", "Firefox", "Safari"). */
  browser: string

  /** Browser version string (e.g. "120.0.6099"). */
  browserVersion: string

  /** Operating system name (e.g. "Windows", "macOS", "Android"). */
  os: string

  /** Operating system version (e.g. "10/11", "14.2"). */
  osVersion: string

  /** Device category — desktop, mobile, tablet, or unknown. */
  deviceCategory: DeviceCategory

  /**
   * Approximate location derived from IP geolocation — ONLY when an
   * approved geolocation service is configured.  This is a coarse label
   * (e.g. "Mumbai, IN"), never a precise address.  Null when no
   * geolocation service is available.
   */
  approximateLocation: string | null

  /** The module the user was most recently active in (from heartbeat). */
  lastModule: ModuleName | null

  /** UTC time of the first heartbeat for this session. */
  sessionStartedAt: Date

  /** UTC time of the most recent heartbeat.  Indexed for active-user queries. */
  lastSeenAt: Date

  /** UTC time when the user explicitly logged out (if applicable). */
  loggedOutAt: Date | null

  /** UTC time when an admin revoked this session (if applicable). */
  revokedAt: Date | null

  /** AdminId of the admin who revoked this session. */
  revokedBy: string | null

  /** Reason for revocation (admin-provided, sanitized). */
  revokeReason: string | null

  createdAt: Date
  updatedAt: Date
}

// ── Schema ───────────────────────────────────────────────────────────────────

const UserSessionSchema = new Schema<IUserSession>(
  {
    userId: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },
    publicId: {
      type:     String,
      required: true,
      index:    true,
    },
    sessionId: {
      type:     String,
      required: true,
    },
    status: {
      type:    String,
      enum:     ['active', 'idle', 'expired', 'revoked', 'logged_out'] as SessionStatus[],
      default:  'active',
      index:    true,
    },
    ip: {
      type:    String,
      default: null,
    },
    ipSource: {
      type:    String,
      enum:    ['direct', 'forwarded', 'real_ip', 'untrusted', 'unknown'],
      default: 'unknown',
    },
    browser: {
      type:    String,
      default: 'Unknown',
    },
    browserVersion: {
      type:    String,
      default: '',
    },
    os: {
      type:    String,
      default: 'Unknown',
    },
    osVersion: {
      type:    String,
      default: '',
    },
    deviceCategory: {
      type:    String,
      enum:    ['desktop', 'mobile', 'tablet', 'unknown'] as DeviceCategory[],
      default: 'unknown',
      index:    true,
    },
    approximateLocation: {
      type:    String,
      default: null,
    },
    lastModule: {
      type:    String,
      enum:    ['notes', 'tasks', 'habits', 'projects', 'expenses', 'subscriptions', null],
      default: null,
    },
    sessionStartedAt: {
      type:     Date,
      required: true,
    },
    lastSeenAt: {
      type:     Date,
      required: true,
      index:    true,
    },
    loggedOutAt: {
      type:    Date,
      default: null,
    },
    revokedAt: {
      type:    Date,
      default: null,
    },
    revokedBy: {
      type:    String,
      default: null,
    },
    revokeReason: {
      type:     String,
      default:  null,
      maxlength: 500,
      trim:      true,
    },
  },
  {
    timestamps: true,
    collection: 'usersessions',
  }
)

// ── Indexes ───────────────────────────────────────────────────────────────────

// One document per (userId, sessionId) — the upsert key
UserSessionSchema.index({ userId: 1, sessionId: 1 }, { unique: true })

// "All sessions for a user" — newest first
UserSessionSchema.index({ userId: 1, lastSeenAt: -1 })

// "Active users" queries — status + recent lastSeenAt
UserSessionSchema.index({ status: 1, lastSeenAt: -1 })

// "Sessions by IP" — for IP history page
UserSessionSchema.index({ ip: 1, lastSeenAt: -1 })

// TTL — remove stale sessions after configured hours
UserSessionSchema.index(
  { lastSeenAt: 1 },
  {
    expireAfterSeconds: USER_SESSION_TTL_HOURS * 60 * 60,
    name: 'usersession_ttl',
  }
)

const UserSession: Model<IUserSession> =
  mongoose.models.UserSession ||
  mongoose.model<IUserSession>('UserSession', UserSessionSchema)

export default UserSession

// ── Presence state helper ────────────────────────────────────────────────────

/**
 * Compute the effective presence status of a session based on its
 * lastSeenAt timestamp and the configured thresholds.
 *
 * This is a PURE function — no DB access — so it can be unit-tested
 * and called from both the admin API and the client component.
 *
 * Note: 'revoked' and 'logged_out' are stored statuses that take
 * precedence over time-based estimation.  This function only computes
 * the time-based states; callers should check the stored status first.
 */
export function computePresenceStatus(
  lastSeenAt: Date | null,
  now: Date = new Date(),
): 'active' | 'idle' | 'expired' {
  if (!lastSeenAt) return 'expired'

  const activeMs = HEARTBEAT_ACTIVE_MINUTES * 60 * 1000
  const recentMs = HEARTBEAT_RECENT_MINUTES * 60 * 1000
  const elapsed = now.getTime() - lastSeenAt.getTime()

  if (elapsed <= activeMs) return 'active'
  if (elapsed <= recentMs) return 'idle'
  return 'expired'
}
