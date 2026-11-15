/**
 * models/AuditLog.ts — Immutable audit trail for privileged administrator actions.
 *
 * WRITE POLICY
 * ────────────
 * Records are written ONLY by server-side code in API route handlers.
 * No client component, user-facing API, or external service writes here.
 * Records are NEVER modified or deleted after creation (no update/delete).
 *
 * RETENTION
 * ─────────
 * No TTL index — audit logs are retained indefinitely.
 * Archiving is an operations task, not an application concern.
 *
 * SECURITY
 * ────────
 * NEVER log: passwords, password hashes, session tokens, OTPs, reset tokens,
 * SMTP credentials, API keys, or any field from the BLOCKED_FIELDS list in logger.ts.
 * Safe metadata only: IDs, names, emails (when strictly necessary), counts, status flags.
 */

import mongoose, { Document, Model, Schema } from 'mongoose'
import type { AdminRole } from './AdminUser'

// ── Action categories ─────────────────────────────────────────────────────────
export type AuditAction =
  // Auth
  | 'admin_login'
  | 'admin_logout'
  | 'admin_login_failed'
  // User management
  | 'user_viewed'
  | 'user_suspended'
  | 'user_activated'
  | 'user_deleted'
  | 'user_restored'
  | 'user_session_revoked'
  // Admin management
  | 'admin_created'
  | 'admin_deactivated'
  | 'admin_activated'
  | 'admin_role_changed'
  | 'admin_deleted'
  // Notifications
  | 'notification_retry'
  | 'notification_test_sent'
  // Announcements
  | 'announcement_created'
  | 'announcement_updated'
  | 'announcement_deleted'
  | 'announcement_published'
  // Admin self-service
  | 'admin_profile_updated'
  | 'admin_password_changed'
  // Settings
  | 'setting_updated'
  // Exports
  | 'data_exported'
  // Security
  | 'security_event_viewed'
  // Support tickets
  | 'ticket_assigned'
  | 'ticket_resolved'
  | 'ticket_closed'
  | 'ticket_reopened'
  | 'ticket_status_changed'
  // Intelligence & monitoring
  | 'intelligence_profile_viewed'
  | 'intelligence_data_exported'
  | 'session_revocation_viewed'

export type AuditResult = 'success' | 'failure' | 'denied'

export interface IAuditLog extends Document {
  _id: mongoose.Types.ObjectId
  /** ID of the AdminUser who performed the action */
  actorId: string
  /** Display name of the actor at the time of the action */
  actorName: string
  /** Role of the actor at the time of the action */
  actorRole: AdminRole
  /** The action performed */
  action: AuditAction
  /**
   * Type and ID of the entity affected, if applicable.
   * e.g. { type: 'user', id: 'LF-XXXXXXXX' }
   */
  target: {
    type: string
    id: string
  } | null
  /** Whether the action succeeded, failed, or was denied */
  result: AuditResult
  /** Safe additional context — never contains secrets */
  metadata: Record<string, unknown>
  /** UTC timestamp of the action */
  createdAt: Date
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actorId:   { type: String, required: true, index: true },
    actorName: { type: String, required: true },
    actorRole: {
      type: String,
      enum: ['super_admin', 'admin', 'support', 'auditor'],
      required: true,
    },
    action: {
      type: String,
      enum: [
        'admin_login', 'admin_logout', 'admin_login_failed',
        'user_viewed', 'user_suspended', 'user_activated', 'user_deleted',
        'user_restored', 'user_session_revoked',
        'admin_created', 'admin_deactivated', 'admin_activated',
        'admin_role_changed', 'admin_deleted',
        'notification_retry', 'notification_test_sent',
        'announcement_created', 'announcement_updated',
        'announcement_deleted', 'announcement_published',
        'setting_updated',
        'data_exported',
        'security_event_viewed',
        'admin_profile_updated',
        'admin_password_changed',
        // Support ticket actions
        'ticket_assigned',
        'ticket_resolved',
        'ticket_closed',
        'ticket_reopened',
        'ticket_status_changed',
        // Intelligence & monitoring
        'intelligence_profile_viewed',
        'intelligence_data_exported',
        'session_revocation_viewed',
      ],
      required: true,
      index: true,
    },
    target: {
      type: new mongoose.Schema({
        type: { type: String, required: true },
        id:   { type: String, required: true },
      }, { _id: false }),
      default: undefined,
    },
    result: {
      type: String,
      enum: ['success', 'failure', 'denied'],
      required: true,
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },  // updatedAt deliberately excluded
    collection: 'auditlogs',
  }
)

// Compound index for the most common admin queries
AuditLogSchema.index({ actorId: 1, createdAt: -1 })
AuditLogSchema.index({ action: 1, createdAt: -1 })
AuditLogSchema.index({ 'target.id': 1, createdAt: -1 })

const AuditLog: Model<IAuditLog> =
  mongoose.models.AuditLog ||
  mongoose.model<IAuditLog>('AuditLog', AuditLogSchema)

export default AuditLog
