/**
 * TransactionProof — stores screenshot binaries attached to expenses.
 *
 * Images are stored as base64 strings inside MongoDB (acceptable for
 * receipt-sized images — typically 100KB–2MB, well within the 16MB doc limit).
 * Never exposed publicly; every read is gated behind requireAuth() + ownership check.
 */

import mongoose, { Document, Model, Schema } from 'mongoose'

export interface ITransactionProof extends Document {
  _id: mongoose.Types.ObjectId
  /** Always derived from session — never from request body. */
  userId: mongoose.Types.ObjectId
  /** Original filename as reported by the browser. */
  filename: string
  mimeType: string
  sizeBytes: number
  /**
   * Base64-encoded image data.
   * Excluded from default queries with `select: false` to avoid
   * loading image bytes unless explicitly requested.
   */
  data: string
  createdAt: Date
}

const TransactionProofSchema = new Schema<ITransactionProof>(
  {
    userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    filename:  { type: String, required: true, trim: true, maxlength: 255 },
    mimeType:  { type: String, required: true, maxlength: 100 },
    sizeBytes: { type: Number, required: true },
    data:      { type: String, required: true, select: false }, // never returned in list queries
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

// Fast ownership lookup when serving proof images
TransactionProofSchema.index({ _id: 1, userId: 1 })

const TransactionProof: Model<ITransactionProof> =
  mongoose.models.TransactionProof ||
  mongoose.model<ITransactionProof>('TransactionProof', TransactionProofSchema)

export default TransactionProof
