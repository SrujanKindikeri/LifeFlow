/**
 * models/PushSubscription.ts — Web Push subscription storage.
 *
 * One document per browser/device per user.  A single user can have many
 * active subscriptions (phone, laptop, work desktop, etc.).
 *
 * SECURITY RULES
 * ──────────────
 * - userId is always set server-side from the authenticated session.
 * - Never trust a userId supplied by the client.
 * - Queries always include userId so one user can never read or delete
 *   another user's subscriptions.
 *
 * CLEANUP
 * ───────
 * When the push provider returns a 410 Gone or 404 error for an endpoint,
 * the subscription is stale and should be removed.  The push sender utility
 * (lib/pushSender.ts) handles this automatically.
 */

import mongoose, { Document, Model, Schema } from 'mongoose'

export interface IPushSubscriptionKeys {
  p256dh: string
  auth: string
}

export interface IPushSubscription extends Document {
  _id: mongoose.Types.ObjectId
  /** Server-derived from authenticated session — never from client input. */
  userId: mongoose.Types.ObjectId
  /** LF-XXXXXXXX identifier, server-derived. */
  lifeFlowId: string
  /** The push endpoint URL returned by the browser's PushManager. */
  endpoint: string
  /** Optional expiry time returned by the browser (null = no explicit expiry). */
  expirationTime: number | null
  /** ECDH public key and auth secret for message encryption. */
  keys: IPushSubscriptionKeys
  /** Browser / UA string (first 200 chars only — not sensitive, useful for debugging). */
  userAgent: string
  createdAt: Date
  updatedAt: Date
}

const PushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    lifeFlowId: { type: String, required: true, index: true },
    endpoint: { type: String, required: true, maxlength: 2048 },
    expirationTime: { type: Number, default: null },
    keys: {
      p256dh: { type: String, required: true },
      auth:   { type: String, required: true },
    },
    userAgent: { type: String, default: '', maxlength: 200 },
  },
  { timestamps: true }
)

// One endpoint can only be registered once per user.
// Two different users on the same shared browser are an edge-case we guard
// against — the endpoint is still globally unique, but we scope the unique
// index to (userId, endpoint) to allow the same browser to re-subscribe
// after account switch without hitting a global duplicate-key error.
PushSubscriptionSchema.index({ userId: 1, endpoint: 1 }, { unique: true })

const PushSubscription: Model<IPushSubscription> =
  mongoose.models.PushSubscription ||
  mongoose.model<IPushSubscription>('PushSubscription', PushSubscriptionSchema)

export default PushSubscription
