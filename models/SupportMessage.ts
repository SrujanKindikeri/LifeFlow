/**
 * models/SupportMessage.ts — Individual messages within a support ticket thread.
 *
 * WRITE POLICY
 * ────────────
 * Messages are written ONLY by authenticated route handlers.
 * Every message is persisted in MongoDB before being acknowledged as sent.
 * Server-generated timestamps — clients never supply createdAt.
 *
 * IDEMPOTENCY
 * ───────────
 * `clientMsgId` is a stable client-supplied UUID (UUIDv4) that the browser
 * generates before sending.  The route handler performs an upsert on this field
 * to prevent duplicate messages on retries (network retry, double-click, etc.).
 * The field is indexed with a sparse unique index.
 *
 * SECURITY
 * ────────
 * Message content is validated and length-capped server-side.
 * No file uploads or HTML — text only.
 * senderId is ALWAYS server-derived from the authenticated session — never
 * taken from the request body.
 *
 * PRESENCE NOTE
 * ─────────────
 * Messages are delivered in real time via SSE.  Each message has a stable
 * server-assigned `_id`.  The SSE stream returns `{ type: 'message', data: ... }`;
 * after reconnection the client fetches from `?after=<lastMessageId>` to load
 * any missed messages without duplicates.
 */

import mongoose, { Document, Model, Schema } from 'mongoose'

export type MessageSenderRole = 'user' | 'admin' | 'system'

export interface ISupportMessage extends Document {
  _id: mongoose.Types.ObjectId

  /** Ticket this message belongs to */
  ticketId: mongoose.Types.ObjectId

  /**
   * MongoDB ObjectId string of the sender.
   * For user messages: userId.  For admin messages: adminId.
   * For system messages (status changes, etc.): 'system'.
   * Always server-derived — NEVER trusted from request body.
   */
  senderId: string
  senderName: string
  senderRole: MessageSenderRole

  /** Message text — validated and length-capped server-side */
  content: string

  /**
   * Client-supplied stable UUID for idempotency.
   * The route handler upserts on this field to prevent duplicates on retries.
   * Optional — system messages don't have a clientMsgId.
   */
  clientMsgId: string | null

  /**
   * Server-generated UTC timestamp.
   * Used as the canonical message ordering key.
   */
  createdAt: Date
}

const SupportMessageSchema = new Schema<ISupportMessage>(
  {
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: 'SupportTicket',
      required: true,
      index: true,
    },
    senderId:   { type: String, required: true },
    senderName: { type: String, required: true, trim: true, maxlength: 100 },
    senderRole: {
      type: String,
      enum: ['user', 'admin', 'system'],
      required: true,
    },
    content: {
      type: String, required: true, trim: true,
      minlength: 1, maxlength: 4000,
    },
    clientMsgId: {
      type: String,
      default: undefined,   // sparse: true requires field to be absent (not null) to allow multiple docs
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'supportmessages',
  }
)

// ── Indexes ────────────────────────────────────────────────────────────────────
// Primary conversation query: all messages in a ticket, oldest first
SupportMessageSchema.index({ ticketId: 1, createdAt: 1 })
// Pagination: messages after a cursor (for reconnection recovery)
SupportMessageSchema.index({ ticketId: 1, _id: 1 })
// Idempotency: prevent duplicate messages on retry
SupportMessageSchema.index({ clientMsgId: 1 }, { unique: true, sparse: true })

const SupportMessage: Model<ISupportMessage> =
  mongoose.models.SupportMessage ||
  mongoose.model<ISupportMessage>('SupportMessage', SupportMessageSchema)

export default SupportMessage
