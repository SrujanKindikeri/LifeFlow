/**
 * models/ActivityHeartbeat.ts — Tracks active user sessions per module.
 *
 * DESIGN
 * ──────
 * One document per (userId, sessionId) pair. The client sends a heartbeat
 * at a configured interval (default 60 s) while the user is on a module page.
 * Each heartbeat upserts this document, setting module and lastSeenAt.
 *
 * SESSION IDs
 * ───────────
 * The sessionId is a client-generated UUID created once per browser tab at
 * page load. Multiple tabs produce separate documents and are therefore
 * distinguishable. Admins see "X sessions" rather than "X users" to avoid
 * over-counting.
 *
 * ACTIVE / RECENTLY ACTIVE / INACTIVE
 * ────────────────────────────────────
 * Thresholds are configurable via env vars:
 *   HEARTBEAT_ACTIVE_MINUTES      — default  3  (considered "active now")
 *   HEARTBEAT_RECENT_MINUTES      — default 30  (considered "recently active")
 * Any session whose lastSeenAt is older than HEARTBEAT_RECENT_MINUTES is
 * inactive (the TTL will eventually remove it).
 *
 * RETENTION
 * ─────────
 * A TTL index expires documents after HEARTBEAT_TTL_HOURS (default 24 h).
 * This prevents stale "active" ghosts after browser closures or network loss.
 * Browser-close and network-loss scenarios are never declared a confirmed
 * logout — the document simply ages out.
 *
 * PRIVACY
 * ───────
 * Only userId, publicId (LF-XXXXXXXX), module name, sessionId (UUID), and
 * timing metadata are stored. No page content, query params, or user inputs.
 */

import mongoose, { Document, Model, Schema } from 'mongoose'
import type { ModuleName }                   from './ModuleEvent'

// ── Configurable thresholds ───────────────────────────────────────────────────

export const HEARTBEAT_ACTIVE_MINUTES: number =
  parseInt(process.env.HEARTBEAT_ACTIVE_MINUTES ?? '3', 10) || 3

export const HEARTBEAT_RECENT_MINUTES: number =
  parseInt(process.env.HEARTBEAT_RECENT_MINUTES ?? '30', 10) || 30

const HEARTBEAT_TTL_HOURS: number =
  parseInt(process.env.HEARTBEAT_TTL_HOURS ?? '24', 10) || 24

// ── Document interface ────────────────────────────────────────────────────────

export interface IActivityHeartbeat extends Document {
  _id: mongoose.Types.ObjectId

  /** MongoDB ObjectId of the user sending heartbeats */
  userId: mongoose.Types.ObjectId

  /**
   * LifeFlow public identifier (LF-XXXXXXXX).
   * Derived from the server-verified session — never from client data.
   */
  publicId: string

  /** Which module the user is currently viewing */
  module: ModuleName

  /**
   * Client-generated UUID created once per browser tab at page load.
   * Different tabs for the same user get different sessionIds, preventing
   * duplicate "active user" counts from being under-counted (one tab)
   * or over-counted (same session counted twice).
   */
  sessionId: string

  /**
   * UTC time of the most recent heartbeat for this session.
   * Used to determine "active now" vs "recently active" vs "inactive".
   */
  lastSeenAt: Date

  /**
   * UTC time of the first heartbeat for this (userId, sessionId) pair.
   * Set on insert, never updated.
   */
  sessionStartedAt: Date

  createdAt: Date
  updatedAt: Date
}

// ── Schema ────────────────────────────────────────────────────────────────────

const ActivityHeartbeatSchema = new Schema<IActivityHeartbeat>(
  {
    userId: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },
    publicId: {
      type:     String,
      required: true,
    },
    module: {
      type:     String,
      enum:     ['notes', 'tasks', 'habits', 'projects', 'expenses', 'subscriptions'],
      required: true,
    },
    sessionId: {
      type:     String,
      required: true,
    },
    lastSeenAt: {
      type:     Date,
      required: true,
      index:    true,
    },
    sessionStartedAt: {
      type:     Date,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'activityheartbeats',
  }
)

// ── Indexes ───────────────────────────────────────────────────────────────────

// One document per (userId, sessionId) — upsert key
ActivityHeartbeatSchema.index({ userId: 1, sessionId: 1 }, { unique: true })

// "Active in module" queries
ActivityHeartbeatSchema.index({ module: 1, lastSeenAt: -1 })

// "All sessions for a user"
ActivityHeartbeatSchema.index({ userId: 1, lastSeenAt: -1 })

// TTL — remove stale sessions after configured hours
ActivityHeartbeatSchema.index(
  { lastSeenAt: 1 },
  {
    expireAfterSeconds: HEARTBEAT_TTL_HOURS * 60 * 60,
    name: 'heartbeat_ttl',
  }
)

const ActivityHeartbeat: Model<IActivityHeartbeat> =
  mongoose.models.ActivityHeartbeat ||
  mongoose.model<IActivityHeartbeat>('ActivityHeartbeat', ActivityHeartbeatSchema)

export default ActivityHeartbeat
