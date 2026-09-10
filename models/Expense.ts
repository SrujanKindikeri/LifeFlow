import mongoose, { Document, Model, Schema } from 'mongoose'

export type ExpenseCategory =
  | 'food'
  | 'transport'
  | 'shopping'
  | 'bills'
  | 'entertainment'
  | 'education'
  | 'health'
  | 'subscriptions'
  | 'other'

export type ExpenseSource = 'personal' | 'group_bill' | 'subscription'
 
export type PaymentMethod =
  | 'upi'
  | 'cash'
  | 'card'
  | 'net_banking'
  | 'wallet'
  | 'other'

export type TransactionDirection = 'sent' | 'received' | 'unknown'

export type TransactionStatus =
  | 'successful'
  | 'completed'
  | 'paid'
  | 'received'
  | 'failed'
  | 'pending'
  | 'declined'
  | 'unknown'

export type TransactionReferenceType =
  | 'UPI_REF'
  | 'UPI_TRANSACTION_ID'
  | 'UTR'
  | 'TRANSACTION_ID'
  | 'REFERENCE_NUMBER'
  | 'OTHER'

export interface ITransactionReference {
  value: string
  type: TransactionReferenceType
}

export interface ITransactionProof {
  fileId: string          // reference to TransactionProof document
  filename: string
  mimeType: string
  sizeBytes: number
  uploadedAt: Date
}

export interface ITransactionCapture {
  // Core amounts (stored in paise for precision)
  amountMinor?: number               // e.g. 7500 for ₹75
  currency?: string                  // default 'INR'

  // Direction & status
  direction?: TransactionDirection
  status?: TransactionStatus

  // Parties
  paidTo?: string                    // merchant or person name
  receivedFrom?: string
  upiId?: string                     // masked or full UPI ID
  phoneNumber?: string
  bank?: string

  // Payment provider (e.g. 'PhonePe', 'Paytm', 'Google Pay', 'BHIM')
  // Distinct from paymentMethod — method is 'upi', provider is the app/bank name
  provider?: string

  // References — array to support multiple IDs (UTR + Transaction ID etc.)
  references?: ITransactionReference[]

  // Time
  transactionDate?: string           // YYYY-MM-DD
  transactionTime?: string           // HH:MM format

  // Metadata
  extractedAt: Date
  extractionMethod: 'ocr_text' | 'manual'
  rawText?: string                   // raw OCR text — NOT logged, stored privately
  multipleDetected?: boolean         // OCR found more than one transaction in image
  lowConfidence?: boolean            // OCR could not reliably parse

  // Proof attachments
  proofs?: ITransactionProof[]       // original screenshot(s) attached by user
}

export interface IExpense extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  amount: number
  category: ExpenseCategory
  description?: string
  date: string // YYYY-MM-DD

  // Payment method
  paymentMethod?: PaymentMethod

  // Separation fields — every expense is one of these three sources
  source: ExpenseSource
  sourceGroupBillId?: mongoose.Types.ObjectId // only set when source='group_bill'

  // Subscription auto-expense metadata — only set when source='subscription'
  sourceSubscriptionId?: mongoose.Types.ObjectId
  /**
   * The billing date this expense was generated for (YYYY-MM-DD).
   * Together with sourceSubscriptionId this forms the idempotency key.
   */
  subscriptionBillingDate?: string

  // Smart Transaction Capture — only present when captured from a screenshot
  transactionCapture?: ITransactionCapture

  createdAt: Date
  updatedAt: Date
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const TransactionReferenceSchema = new Schema<ITransactionReference>(
  {
    value: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['UPI_REF', 'UPI_TRANSACTION_ID', 'UTR', 'TRANSACTION_ID', 'REFERENCE_NUMBER', 'OTHER'],
      required: true,
    },
  },
  { _id: false }
)

const TransactionProofSchema = new Schema<ITransactionProof>(
  {
    fileId:     { type: String, required: true },
    filename:   { type: String, required: true },
    mimeType:   { type: String, required: true },
    sizeBytes:  { type: Number, required: true },
    uploadedAt: { type: Date, required: true, default: () => new Date() },
  },
  { _id: false }
)

const TransactionCaptureSchema = new Schema<ITransactionCapture>(
  {
    amountMinor:      { type: Number },
    currency:         { type: String, default: 'INR' },
    direction:        { type: String, enum: ['sent', 'received', 'unknown'] },
    status:           { type: String, enum: ['successful', 'completed', 'paid', 'received', 'failed', 'pending', 'declined', 'unknown'] },
    paidTo:           { type: String, trim: true, maxlength: 200 },
    receivedFrom:     { type: String, trim: true, maxlength: 200 },
    upiId:            { type: String, trim: true, maxlength: 200 },
    phoneNumber:      { type: String, trim: true, maxlength: 20 },
    bank:             { type: String, trim: true, maxlength: 200 },
    provider:         { type: String, trim: true, maxlength: 100 },
    references:       { type: [TransactionReferenceSchema], default: [] },
    transactionDate:  { type: String },
    transactionTime:  { type: String },
    extractedAt:      { type: Date, required: true, default: () => new Date() },
    extractionMethod: { type: String, enum: ['ocr_text', 'manual'], required: true, default: 'ocr_text' },
    rawText:          { type: String, select: false },  // excluded from default queries (privacy)
    multipleDetected: { type: Boolean, default: false },
    lowConfidence:    { type: Boolean, default: false },
    proofs:           { type: [TransactionProofSchema], default: [] },
  },
  { _id: false }
)

// ─── Main schema ──────────────────────────────────────────────────────────────

const ExpenseSchema = new Schema<IExpense>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    category: {
      type: String,
      enum: ['food', 'transport', 'shopping', 'bills', 'entertainment', 'education', 'health', 'subscriptions', 'other'],
      required: true,
    },
    description: { type: String, trim: true, maxlength: 200 },
    date: { type: String, required: true },

    // Payment method
    paymentMethod: {
      type: String,
      enum: ['upi', 'cash', 'card', 'net_banking', 'wallet', 'other'],
      default: null,
    },

    // Source tracking — personal expense vs. share from group bill vs. auto-generated subscription
    source: {
      type: String,
      enum: ['personal', 'group_bill', 'subscription'],
      default: 'personal',
    },
    sourceGroupBillId: {
      type: Schema.Types.ObjectId,
      ref: 'GroupBill',
      default: null,
    },

    // Subscription auto-expense — only present when source='subscription'
    sourceSubscriptionId: {
      type: Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
    },
    subscriptionBillingDate: {
      type: String,   // YYYY-MM-DD
      default: null,
    },

    // Smart Transaction Capture data — only present when added via screenshot
    transactionCapture: { type: TransactionCaptureSchema, default: null },
  },
  { timestamps: true }
)

ExpenseSchema.index({ userId: 1, date: -1 })
ExpenseSchema.index({ userId: 1, category: 1 })
ExpenseSchema.index({ userId: 1, source: 1 })
// Index to quickly find expenses with transaction proofs
ExpenseSchema.index({ userId: 1, 'transactionCapture.proofs': 1 }, { sparse: true })
// Unique idempotency key: one auto-expense per subscription per billing cycle.
// sparse=true so the index only covers documents that have both fields set.
ExpenseSchema.index(
  { sourceSubscriptionId: 1, subscriptionBillingDate: 1 },
  { unique: true, sparse: true, name: 'subscription_billing_idempotency' }
)

const Expense: Model<IExpense> =
  mongoose.models.Expense || mongoose.model<IExpense>('Expense', ExpenseSchema)

export default Expense
