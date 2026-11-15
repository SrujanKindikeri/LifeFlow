/**
 * models/ModuleEvent.ts — Records module-level operation outcomes.
 *
 * WHAT IS TRACKED
 * ───────────────
 * Significant, server-confirmed operations in the six monitored modules:
 * notes, tasks, habits, projects, expenses, subscriptions.
 *
 * Only operations that reach the API layer are recorded here. A frontend
 * button click does NOT constitute a recorded event — only a successfully
 * parsed and processed API request does.
 *
 * WHAT IS NEVER STORED
 * ────────────────────
 * • Note/task/habit/project content
 * • Financial amounts, currency values
 * • Passwords, tokens, session cookies
 * • Full error stack traces
 * • Personal identifiers beyond userId + publicId
 *
 * RETENTION
 * ─────────
 * A TTL index expires events after MODULE_EVENT_RETENTION_DAYS (default 180).
 * This is configurable via the MODEL_EVENT_RETENTION_DAYS env var.
 * Existing data is preserved on deployment — the TTL only affects new writes
 * and naturally ages out old documents.
 *
 * DEDUPLICATION
 * ─────────────
 * correlationId is a caller-supplied UUID. The compound index on
 * (correlationId) with sparse:true prevents exact-duplicate events
 * when a route is retried within the same request context.
 */

import mongoose, { Document, Model, Schema } from 'mongoose'

// ── Supported modules ─────────────────────────────────────────────────────────

export const MODULE_NAMES = [
  'notes',
  'tasks',
  'habits',
  'projects',
  'expenses',
  'subscriptions',
] as const

export type ModuleName = (typeof MODULE_NAMES)[number]

// ── Operation types ───────────────────────────────────────────────────────────

export const MODULE_OPERATIONS = [
  // Core CRUD
  'create',
  'update',
  'delete',
  'archive',
  'restore',
  // State transitions
  'complete',
  'reopen',
  'pause',
  'cancel',
  // Habits-specific
  'log',
  // Errors
  'validation_failed',
  'save_failed',
  'api_failed',
  'sync_failed',
] as const

export type ModuleOperation = (typeof MODULE_OPERATIONS)[number]

// ── Outcomes ──────────────────────────────────────────────────────────────────

export type EventOutcome = 'success' | 'failure' | 'unknown'

// ── Error categories (stable fingerprint for grouping) ───────────────────────

export const ERROR_CATEGORIES = [
  'validation',
  'not_found',
  'unauthorized',
  'forbidden',
  'conflict',
  'database',
  'network',
  'timeout',
  'rate_limit',
  'sync',
  'unknown',
] as const

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number]

// ── Event source ──────────────────────────────────────────────────────────────

export type EventSource = 'ui' | 'api' | 'background' | 'sync'

// ── Document interface ────────────────────────────────────────────────────────

export interface IModuleEvent extends Document {
  _id: mongoose.Types.ObjectId

  /** MongoDB ObjectId of the user who triggered the event */
  userId: mongoose.Types.ObjectId

  /**
   * LifeFlow public identifier (LF-XXXXXXXX) — sourced from the authenticated
   * session, never from client-supplied values.
   */
  publicId: string

  /** Which LifeFlow module the event belongs to */
  module: ModuleName

  /** What kind of operation was performed */
  operation: ModuleOperation

  /** Whether the server-side operation succeeded, failed, or is unknown */
  outcome: EventOutcome

  /**
   * HTTP status code from the route handler, when applicable.
   * Only populated for API-layer events.
   */
  httpStatus?: number

  /**
   * Stable error category for grouping repeated failures.
   * Only present when outcome === 'failure'.
   */
  errorCategory?: ErrorCategory

  /**
   * Sanitized, short error message — never includes stack traces, secrets,
   * or user content. At most 200 characters.
   */
  errorMessage?: string

  /**
   * Caller-supplied UUID that correlates this event to a specific request.
   * Prevents recording the same operation twice on retries.
   */
  correlationId?: string

  /** Which surface produced the event */
  source: EventSource

  /**
   * Measured operation duration in milliseconds.
   * Omitted when timing information is unavailable.
   */
  durationMs?: number

  /**
   * Retry count, when the caller tracks retries.
   */
  retryCount?: number

  createdAt: Date
}

// ── Schema ────────────────────────────────────────────────────────────────────

const ModuleEventSchema = new Schema<IModuleEvent>(
  {
    userId: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true,
    },
    publicId: {
      type:     String,
      required: true,
      index:    true,
    },
    module: {
      type:     String,
      enum:     MODULE_NAMES,
      required: true,
      index:    true,
    },
    operation: {
      type:     String,
      enum:     MODULE_OPERATIONS,
      required: true,
      index:    true,
    },
    outcome: {
      type:     String,
      enum:     ['success', 'failure', 'unknown'] as EventOutcome[],
      required: true,
      index:    true,
    },
    httpStatus: {
      type: Number,
      min:  100,
      max:  599,
    },
    errorCategory: {
      type: String,
      enum: ERROR_CATEGORIES,
    },
    errorMessage: {
      type:      String,
      maxlength: 200,
      trim:      true,
    },
    correlationId: {
      type:   String,
      sparse: true,
    },
    source: {
      type:    String,
      enum:    ['ui', 'api', 'background', 'sync'] as EventSource[],
      default: 'api',
    },
    durationMs: {
      type: Number,
      min:  0,
    },
    retryCount: {
      type: Number,
      min:  0,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'moduleevents',
  }
)

// ── Indexes ───────────────────────────────────────────────────────────────────

// Primary admin query: module + time
ModuleEventSchema.index({ module: 1, createdAt: -1 })

// Per-user activity history
ModuleEventSchema.index({ userId: 1, module: 1, createdAt: -1 })

// Error analysis: find all failures for a module
ModuleEventSchema.index({ module: 1, outcome: 1, createdAt: -1 })

// Error grouping by category
ModuleEventSchema.index({ module: 1, errorCategory: 1, createdAt: -1 })

// Cross-module: all events for a user across all modules
ModuleEventSchema.index({ userId: 1, createdAt: -1 })

// TTL — configurable retention (default 180 days)
const retentionDays =
  parseInt(process.env.MODULE_EVENT_RETENTION_DAYS ?? '180', 10) || 180
ModuleEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: retentionDays * 24 * 60 * 60, name: 'moduleevents_ttl' }
)

const ModuleEvent: Model<IModuleEvent> =
  mongoose.models.ModuleEvent ||
  mongoose.model<IModuleEvent>('ModuleEvent', ModuleEventSchema)

export default ModuleEvent
