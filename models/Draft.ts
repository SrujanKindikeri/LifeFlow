import mongoose, { Document, Model, Schema } from 'mongoose'

// ─── Draft types ──────────────────────────────────────────────────────────────

export type DraftType =
  | 'note'
  | 'task'
  | 'habit'
  | 'expense'
  | 'groupBill'
  | 'moneyGiven'
  | 'moneyBorrowed'
  | 'goal'
  | 'project'
  | 'subscription'
  | 'savingsGoal'

// ─── Per-type data shapes (stored in the flexible `data` field) ───────────────
// These are intentionally loose — drafts may be incomplete.

export interface NoteDraftData {
  title?: string
  content?: string
  tags?: string   // comma-separated
  pinned?: boolean
}

export interface TaskDraftData {
  title?: string
  description?: string
  priority?: 'low' | 'medium' | 'high'
  dueDate?: string
  dueTime?: string
  recurring?: 'none' | 'daily' | 'weekly' | 'monthly'
}

export interface HabitDraftData {
  name?: string
  description?: string
  icon?: string
  frequency?: 'daily' | 'weekly'
  target?: number
}

export interface ExpenseDraftData {
  amount?: string   // stored as string to allow partial input like "50"
  category?: string
  description?: string
  date?: string
  paymentMethod?: string
  // Transaction capture fields — stored so draft can be restored with proof info
  transactionCapture?: {
    amountMinor?: number
    currency?: string
    direction?: string
    status?: string
    paidTo?: string
    receivedFrom?: string
    upiId?: string
    phoneNumber?: string
    bank?: string
    provider?: string
    references?: Array<{ value: string; type: string }>
    transactionDate?: string
    transactionTime?: string
    extractedAt?: string
    extractionMethod?: string
    multipleDetected?: boolean
    lowConfidence?: boolean
    proofs?: Array<{
      fileId: string
      filename: string
      mimeType: string
      sizeBytes: number
      uploadedAt?: string
    }>
  } | null
}

export interface GroupBillDraftData {
  name?: string
  date?: string
  currency?: string
  people?: { id: string; name: string; paidAmount: number }[]
  items?: { id: string; name: string; price: number; quantity: number; assignedPeople: string[] }[]
  splitMode?: 'item' | 'equal' | 'custom'
  customSplits?: { personId: string; value: number; type: 'amount' | 'percent' }[]
  discountType?: 'amount' | 'percent'
  discountValue?: number
  taxType?: 'amount' | 'percent'
  taxValue?: number
  serviceChargeType?: 'amount' | 'percent'
  serviceChargeValue?: number
  tipType?: 'amount' | 'percent'
  tipValue?: number
}

export interface MoneyRecordDraftData {
  direction?: 'given' | 'borrowed'
  personName?: string
  personPhone?: string
  personEmail?: string
  amount?: string   // stored as string to allow partial input
  currency?: string
  reason?: string
  category?: string
  givenDate?: string
  dueDate?: string
  note?: string
}

export interface GoalDraftData {
  title?: string
  description?: string
  category?: string
  targetValue?: string
  unit?: string
  startDate?: string
  targetDate?: string
}

export interface ProjectDraftData {
  title?: string
  description?: string
  dueDate?: string
  status?: 'active' | 'on_hold' | 'completed' | 'archived'
  color?: string
}

export interface SubscriptionDraftData {
  serviceName?: string
  amount?: string   // stored as string
  currency?: string
  billingCycle?: string
  customIntervalDays?: number
  nextBillingDate?: string
  category?: string
  paymentMethod?: string
  status?: string
  notes?: string
}

export interface SavingsGoalDraftData {
  title?: string
  targetAmount?: string   // stored as string
  currency?: string
  icon?: string
  color?: string
  targetDate?: string
  notes?: string
}

export type DraftData =
  | NoteDraftData
  | TaskDraftData
  | HabitDraftData
  | ExpenseDraftData
  | GroupBillDraftData
  | MoneyRecordDraftData
  | GoalDraftData
  | ProjectDraftData
  | SubscriptionDraftData
  | SavingsGoalDraftData

// ─── Main interface ───────────────────────────────────────────────────────────

export interface IDraft extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  type: DraftType
  title: string          // human-readable title for display in Drafts list
  data: Record<string, unknown>  // the partial form data
  createdAt: Date
  updatedAt: Date
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const DraftSchema = new Schema<IDraft>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        'note', 'task', 'habit', 'expense', 'groupBill',
        'moneyGiven', 'moneyBorrowed', 'goal', 'project',
        'subscription', 'savingsGoal',
      ],
      required: true,
    },
    title: {
      type: String,
      trim: true,
      maxlength: 300,
      default: 'Untitled Draft',
    },
    data: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
)

// Indexes for efficient per-user queries
DraftSchema.index({ userId: 1, updatedAt: -1 })
DraftSchema.index({ userId: 1, type: 1 })
DraftSchema.index({ userId: 1, createdAt: -1 })

const Draft: Model<IDraft> =
  mongoose.models.Draft || mongoose.model<IDraft>('Draft', DraftSchema)

export default Draft
