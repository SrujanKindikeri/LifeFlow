/**
 * models/SupportTicket.ts — Support ticket model for LifeFlow.
 *
 * STATE MACHINE
 * ─────────────
 *   open              → waiting_for_admin (user sent first message, no admin yet)
 *                     → waiting_for_user  (admin replied, awaiting user)
 *                     → resolved          (admin marks resolved)
 *                     → closed            (admin closes)
 *   waiting_for_admin → waiting_for_user  (admin picks up and replies)
 *                     → resolved / closed (admin action)
 *   waiting_for_user  → waiting_for_admin (user replies)
 *                     → resolved / closed (admin action)
 *   resolved          → open              (admin reopens)
 *                     → closed            (admin closes)
 *   closed            → open              (admin reopens — writes audit record)
 *
 * WRITE POLICY
 * ────────────
 * Status transitions to resolved/closed are ONLY executed by admin route handlers
 * after requireAdmin() succeeds.  Users can only advance to waiting_for_admin
 * and waiting_for_user via the message endpoint.
 *
 * PRESENCE
 * ────────
 * Online presence is tracked server-side via connection leases in the
 * SupportPresence sub-document.  Client heartbeats update a lastSeen timestamp;
 * a server-side grace window of PRESENCE_LEASE_TTL_MS marks the participant
 * offline if no heartbeat is received within that window.
 */

import mongoose, { Document, Model, Schema } from 'mongoose'

export type TicketStatus =
  | 'open'
  | 'waiting_for_admin'
  | 'waiting_for_user'
  | 'resolved'
  | 'closed'

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'

export type TicketCategory =
  | 'account_and_login'
  | 'notifications'
  | 'offline_sync'
  | 'notes_tasks_habits_projects'
  | 'expenses_and_subscriptions'
  | 'payments_and_group_bills'
  | 'bugs_and_technical'
  | 'other'

export interface IStatusHistoryEntry {
  from: TicketStatus | null
  to: TicketStatus
  changedBy: string       // adminId or userId (string)
  changedByRole: 'user' | 'admin'
  reason?: string
  timestamp: Date
}

export interface ISupportTicket extends Document {
  _id: mongoose.Types.ObjectId

  /** MongoDB ObjectId of the user who opened the ticket */
  userId: mongoose.Types.ObjectId
  /** LifeFlow public ID of the owner (LF-XXXXXXXX), server-derived */
  lifeFlowId: string
  /** Display name at time of submission */
  userName: string

  subject: string
  category: TicketCategory
  priority: TicketPriority
  /** Initial description provided at ticket creation */
  description: string

  status: TicketStatus

  /**
   * MongoDB ObjectId string of the assigned AdminUser.
   * Null until an admin picks up the ticket.
   */
  assignedTo: string | null
  /** Display name of the assigned admin, cached for list queries */
  assignedToName: string | null

  /** Immutable status transition history */
  statusHistory: IStatusHistoryEntry[]

  /** Last message timestamp — drives sort in ticket lists */
  lastMessageAt: Date | null
  /** Unread message count for the user (admin-sent messages not yet read by user) */
  userUnreadCount: number
  /** Unread message count for admins */
  adminUnreadCount: number
  /** Total messages in this thread */
  messageCount: number

  /**
   * Idempotency key for the new-ticket email notification.
   * Prevents duplicate emails if the creation request is retried.
   * Format: "ticket-created:<ticketId>"
   */
  emailNotificationKey: string | null
  /** Whether the new-ticket notification email has been sent */
  emailNotificationSent: boolean
  /** Error from last email attempt, if any */
  emailNotificationError: string | null

  createdAt: Date
  updatedAt: Date
}

const StatusHistorySchema = new Schema<IStatusHistoryEntry>(
  {
    from:          { type: String, default: null },
    to:            { type: String, required: true },
    changedBy:     { type: String, required: true },
    changedByRole: { type: String, enum: ['user', 'admin'], required: true },
    reason:        { type: String, default: undefined },
    timestamp:     { type: Date,   default: () => new Date() },
  },
  { _id: false }
)

const SupportTicketSchema = new Schema<ISupportTicket>(
  {
    userId:     { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    lifeFlowId: { type: String, required: true, index: true },
    userName:   { type: String, required: true, trim: true, maxlength: 100 },

    subject: {
      type: String, required: true, trim: true,
      minlength: 5, maxlength: 120,
    },
    category: {
      type: String,
      enum: [
        'account_and_login', 'notifications', 'offline_sync',
        'notes_tasks_habits_projects', 'expenses_and_subscriptions',
        'payments_and_group_bills', 'bugs_and_technical', 'other',
      ],
      required: true,
      index: true,
    },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high', 'urgent'],
      default: 'normal',
      index: true,
    },
    description: {
      type: String, required: true, trim: true,
      minlength: 10, maxlength: 2000,
    },

    status: {
      type: String,
      enum: ['open', 'waiting_for_admin', 'waiting_for_user', 'resolved', 'closed'],
      default: 'open',
      index: true,
    },

    assignedTo:     { type: String, default: null, index: true },
    assignedToName: { type: String, default: null },

    statusHistory: { type: [StatusHistorySchema], default: [] },

    lastMessageAt:   { type: Date,   default: null, index: true },
    userUnreadCount: { type: Number, default: 0, min: 0 },
    adminUnreadCount:{ type: Number, default: 0, min: 0 },
    messageCount:    { type: Number, default: 0, min: 0 },

    emailNotificationKey:   { type: String, default: null },
    emailNotificationSent:  { type: Boolean, default: false },
    emailNotificationError: { type: String, default: null },
  },
  {
    timestamps: true,
    collection: 'supporttickets',
  }
)

// ── Indexes ────────────────────────────────────────────────────────────────────
// Primary query: user's own tickets
SupportTicketSchema.index({ userId: 1, createdAt: -1 })
// Admin list: filter by status + sort by last activity
SupportTicketSchema.index({ status: 1, lastMessageAt: -1 })
// Admin list: sort by creation time
SupportTicketSchema.index({ status: 1, createdAt: -1 })
// Admin list: sort by priority
SupportTicketSchema.index({ priority: 1, status: 1, createdAt: -1 })
// Assigned tickets per admin
SupportTicketSchema.index({ assignedTo: 1, status: 1, lastMessageAt: -1 })
// Email idempotency
SupportTicketSchema.index({ emailNotificationKey: 1 }, { sparse: true })

const SupportTicket: Model<ISupportTicket> =
  mongoose.models.SupportTicket ||
  mongoose.model<ISupportTicket>('SupportTicket', SupportTicketSchema)

export default SupportTicket
