import mongoose, { Document, Model, Schema } from 'mongoose'

export type BillingCycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled'
export type SubscriptionCategory =
  | 'streaming'
  | 'music'
  | 'software'
  | 'cloud'
  | 'fitness'
  | 'news'
  | 'gaming'
  | 'education'
  | 'utilities'
  | 'other'

export interface ISubscription extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  serviceName: string
  /** Amount in minor currency units (paise for INR). */
  amountMinor: number
  currency: string
  billingCycle: BillingCycle
  /** Custom interval in days — only used when billingCycle = 'custom'. */
  customIntervalDays?: number
  nextBillingDate: string   // YYYY-MM-DD
  /** The last date on which an expense was auto-created (YYYY-MM-DD). */
  lastBillingDate?: string
  category: SubscriptionCategory
  paymentMethod?: string
  status: SubscriptionStatus
  /**
   * When true, LifeFlow automatically creates a Personal Expense on each
   * billing date. Defaults to true for new subscriptions.
   */
  autoCreateExpense: boolean
  notes?: string
  createdAt: Date
  updatedAt: Date
}

const SubscriptionSchema = new Schema<ISubscription>(
  {
    userId:              { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    serviceName:         { type: String, required: true, trim: true, maxlength: 100 },
    amountMinor:         {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'Must be integer paise' },
    },
    currency:            { type: String, default: 'INR', maxlength: 5 },
    billingCycle: {
      type: String,
      enum: ['weekly', 'monthly', 'quarterly', 'yearly', 'custom'],
      default: 'monthly',
    },
    customIntervalDays:  { type: Number, min: 1 },
    nextBillingDate:     { type: String, required: true },
    lastBillingDate:     { type: String, default: null },
    category: {
      type: String,
      enum: ['streaming', 'music', 'software', 'cloud', 'fitness', 'news', 'gaming', 'education', 'utilities', 'other'],
      default: 'other',
    },
    paymentMethod:       { type: String, trim: true, maxlength: 100 },
    status: {
      type: String,
      enum: ['active', 'paused', 'cancelled'],
      default: 'active',
    },
    autoCreateExpense:   { type: Boolean, default: true },
    notes:               { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
)

SubscriptionSchema.index({ userId: 1, status: 1 })
SubscriptionSchema.index({ userId: 1, nextBillingDate: 1 })
SubscriptionSchema.index({ userId: 1, createdAt: -1 })

const Subscription: Model<ISubscription> =
  mongoose.models.Subscription || mongoose.model<ISubscription>('Subscription', SubscriptionSchema)

export default Subscription
