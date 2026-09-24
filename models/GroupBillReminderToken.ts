/**
 * models/GroupBillReminderToken.ts — Secure public-access tokens for Group Bill reminder links.
 *
 * PURPOSE
 * ───────
 * When a sender clicks "Send Reminder" for a Group Bill, the email used to
 * contain a link to /app/expenses?tab=group — an authenticated route that
 * requires the recipient to be logged in to LifeFlow.
 *
 * This model enables a PUBLIC, READ-ONLY reminder page that the recipient can
 * open directly from their email, without a LifeFlow account.
 *
 * SECURITY MODEL
 * ─────────────
 * 1. A cryptographically secure random token (32 bytes, base64url) is generated
 *    at reminder-send time.  Only the SHA-256 hash is stored here — the raw
 *    token lives only in the email URL and is discarded immediately after use.
 *
 * 2. The URL contains the raw token:
 *      /group-bill/view/<rawToken>
 *    The server hashes the incoming token and looks up the hash.
 *
 * 3. Tokens expire after TOKEN_TTL_DAYS (7 days by default).
 *    Expired tokens return a clean "link expired" page with no financial data.
 *
 * 4. Tokens can be revoked via the revokedAt field (e.g. when the sender
 *    deletes the underlying Group Bills or the reminder context is invalidated).
 *
 * 5. Financial information is stored as a SNAPSHOT (senderSnapshot, billsSnapshot)
 *    so the public page always shows exactly what was sent in the reminder.
 *    If the sender later changes their UPI ID, old reminder links keep the old UPI.
 *
 * 6. Internal IDs (senderUserId, recipientPersonId) are NEVER exposed to the
 *    public page — the API returns only the safe snapshot fields.
 *
 * DOCUMENT FIELDS
 * ───────────────
 * tokenHash         — SHA-256 hex digest of the raw token.  Used for lookup.
 *                     Unique index.  The raw token is never stored.
 *
 * notificationLogId — ObjectId of the NotificationLog entry that triggered this
 *                     token's creation (for audit / cross-reference).
 *
 * senderUserId      — ObjectId of the authenticated LifeFlow user who sent the
 *                     reminder.  Server-only — never returned to the public page.
 *
 * recipientPersonId — ObjectId of the Person record the reminder was sent to.
 *                     Server-only — never returned to the public page.
 *
 * recipientEmail    — Email address the reminder was delivered to.
 *                     Stored hashed (SHA-256) so it can be compared server-side
 *                     without exposing the raw address in the token record.
 *                     Never returned to the public page.
 *
 * billIds           — Array of GroupBill ObjectIds whose data is snapshotted
 *                     below.  Used for future revocation checks.
 *
 * senderSnapshot    — Safe snapshot of sender info captured at send time.
 *                     Contains only fields intended for public display:
 *                       name, lifeFlowId, upiId (may be null).
 *                     Stored so that a later profile change does NOT alter
 *                     old reminder pages.
 *
 * billsSnapshot     — Array of per-bill summaries captured at send time.
 *                     Contains billName, billDate, amountOwed, currency.
 *                     Totals are always re-derived from this array on render
 *                     (never trusted from a URL query parameter).
 *
 * recipientName     — Display name of the recipient (from Person.name).
 *                     Safe for public display (it is the name the SENDER
 *                     entered in their People directory — not an internal ID).
 *
 * currency          — Currency code, e.g. "INR".
 *
 * expiresAt         — UTC timestamp after which the link is no longer valid.
 *                     Defaults to now + TOKEN_TTL_DAYS.
 *
 * revokedAt         — UTC timestamp set when the token is explicitly revoked
 *                     (e.g. all underlying Group Bills are deleted).
 *                     Null = not revoked.
 *
 * createdAt/updatedAt — Mongoose timestamps.
 */

import mongoose, { Document, Model, Schema } from 'mongoose'

// ─── Configuration ─────────────────────────────────────────────────────────────

/** Number of days a public reminder link remains valid. */
export const TOKEN_TTL_DAYS = 7

// ─── Sub-document: sender snapshot ────────────────────────────────────────────

export interface ISenderSnapshot {
  /** Sender's display name, e.g. "Kindikeri Srujan Kumar Reddy". */
  name: string
  /** Sender's public LifeFlow ID, e.g. "LF-7K29X4P1". Safe to display. */
  lifeFlowId: string
  /**
   * Sender's UPI ID at the time the reminder was sent.
   * Null if the sender had not configured a UPI ID.
   * Captured as a snapshot — does NOT update if the sender later changes UPI.
   */
  upiId: string | null
}

// ─── Sub-document: bill snapshot entry ────────────────────────────────────────

export interface IBillSnapshot {
  /** GroupBill ObjectId as a string, for future revocation cross-checks. */
  billId: string
  /** Human-readable bill name, e.g. "Dominos". */
  billName: string
  /** Bill date in YYYY-MM-DD format. */
  billDate: string
  /** Amount this recipient owes on this specific bill (always positive). */
  amountOwed: number
  /** Currency code, e.g. "INR". */
  currency: string
}

// ─── Main document interface ───────────────────────────────────────────────────

export interface IGroupBillReminderToken extends Document {
  _id: mongoose.Types.ObjectId

  /**
   * SHA-256 hex digest of the raw URL token.
   * Unique — one token per reminder send event.
   * Never the raw token itself.
   */
  tokenHash: string

  /**
   * ObjectId of the NotificationLog entry that created this token.
   * Used for audit trail and cross-reference.
   */
  notificationLogId: mongoose.Types.ObjectId | null

  /**
   * ObjectId of the LifeFlow user (sender) who triggered the reminder.
   * SERVER-ONLY — never returned to the public API endpoint.
   */
  senderUserId: mongoose.Types.ObjectId

  /**
   * ObjectId of the Person record (recipient) in the sender's People directory.
   * May be null if the Person record was deleted since the reminder was sent.
   * SERVER-ONLY — never returned to the public API endpoint.
   */
  recipientPersonId: mongoose.Types.ObjectId | null

  /**
   * SHA-256 hex digest of the recipient's email address (lowercase).
   * Stored hashed so the raw email is not in this collection.
   * Used server-side for audit; never returned to the public page.
   */
  recipientEmailHash: string | null

  /**
   * Array of GroupBill ObjectIds referenced in this reminder.
   * Used for future revocation: if all bills are deleted, the token can be
   * revoked automatically.
   */
  billIds: mongoose.Types.ObjectId[]

  /**
   * Snapshot of the sender's public display info captured at send time.
   * Immutable after creation — historical accuracy is the goal.
   */
  senderSnapshot: ISenderSnapshot

  /**
   * Snapshot of the per-bill amounts captured at send time.
   * The public page renders from this snapshot, not live DB data.
   */
  billsSnapshot: IBillSnapshot[]

  /**
   * Recipient's display name (from Person.name in sender's People directory).
   * Safe for display on the public page (it is not an internal ID).
   */
  recipientName: string

  /** Currency code for this reminder, e.g. "INR". */
  currency: string

  /**
   * UTC timestamp after which this token is no longer valid.
   * Default: createdAt + TOKEN_TTL_DAYS days.
   */
  expiresAt: Date

  /**
   * UTC timestamp set when the token is explicitly revoked.
   * Null = token is active (subject to expiry).
   */
  revokedAt: Date | null

  createdAt: Date
  updatedAt: Date
}

// ─── Sub-schemas ───────────────────────────────────────────────────────────────

const SenderSnapshotSchema = new Schema<ISenderSnapshot>(
  {
    name:       { type: String, required: true, trim: true, maxlength: 100 },
    lifeFlowId: { type: String, required: true, trim: true, maxlength: 20  },
    upiId:      { type: String, default: null,  trim: true, maxlength: 100 },
  },
  { _id: false },
)

const BillSnapshotSchema = new Schema<IBillSnapshot>(
  {
    billId:    { type: String, required: true },
    billName:  { type: String, required: true, trim: true, maxlength: 200 },
    billDate:  { type: String, required: true, maxlength: 10 },
    amountOwed:{ type: Number, required: true, min: 0 },
    currency:  { type: String, required: true, maxlength: 5 },
  },
  { _id: false },
)

// ─── Main schema ───────────────────────────────────────────────────────────────

const GroupBillReminderTokenSchema = new Schema<IGroupBillReminderToken>(
  {
    tokenHash: {
      type:     String,
      required: true,
      // No maxlength constraint — SHA-256 hex is always 64 chars,
      // but we leave this open for algorithm agility.
    },

    notificationLogId: {
      type:    Schema.Types.ObjectId,
      ref:     'NotificationLog',
      default: null,
    },

    senderUserId: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true,
    },

    recipientPersonId: {
      type:    Schema.Types.ObjectId,
      ref:     'Person',
      default: null,
    },

    recipientEmailHash: {
      type:    String,
      default: null,
    },

    billIds: [
      {
        type: Schema.Types.ObjectId,
        ref:  'GroupBill',
      },
    ],

    senderSnapshot:  { type: SenderSnapshotSchema, required: true },
    billsSnapshot:   { type: [BillSnapshotSchema], required: true, default: [] },
    recipientName:   { type: String, required: true, trim: true, maxlength: 100 },
    currency:        { type: String, required: true, maxlength: 5, default: 'INR' },

    expiresAt: {
      type:     Date,
      required: true,
      index:    true,
    },

    revokedAt: {
      type:    Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
)

// ─── Indexes ───────────────────────────────────────────────────────────────────

// Primary lookup: hash incoming URL token → find document.
GroupBillReminderTokenSchema.index({ tokenHash: 1 }, { unique: true })

// Sender-scoped queries (e.g. revoke all tokens for a given sender).
GroupBillReminderTokenSchema.index({ senderUserId: 1, createdAt: -1 })

// Expiry cleanup — MongoDB TTL index auto-removes expired tokens after 30 days
// past expiry so recent-ish history is still available for debugging.
// (Tokens are functionally expired at expiresAt; this just trims the collection.)
GroupBillReminderTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 },  // remove 30 days after expiresAt
)

// Compound index to support "revoke all tokens for these billIds" queries.
GroupBillReminderTokenSchema.index({ billIds: 1 })

// ─── Model ─────────────────────────────────────────────────────────────────────

const GroupBillReminderToken: Model<IGroupBillReminderToken> =
  mongoose.models.GroupBillReminderToken ||
  mongoose.model<IGroupBillReminderToken>(
    'GroupBillReminderToken',
    GroupBillReminderTokenSchema,
  )

export default GroupBillReminderToken
