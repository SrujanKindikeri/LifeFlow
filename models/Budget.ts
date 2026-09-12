import mongoose, { Document, Model, Schema } from 'mongoose'
import type { ExpenseCategory } from './Expense'

export type BudgetStatus = 'active' | 'paused'

export interface IBudget extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  /** Owner's LifeFlow ID (LF-XXXXXXXX). Sourced from User.publicId at creation. */
  lifeFlowId: string
  category: ExpenseCategory
  /** Budget limit in minor currency units (paise for INR). */
  amountMinor: number
  currency: string
  /**
   * The month this budget applies to, as YYYY-MM.
   * A budget marked 'active' auto-rolls over each month if no new budget
   * is created for that category+month. The API creates a copy per month
   * when queried, so this field stores the actual month.
   */
  month: string  // YYYY-MM
  status: BudgetStatus
  createdAt: Date
  updatedAt: Date
}

const BudgetSchema = new Schema<IBudget>(
  {
    userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Owner's LifeFlow ID (LF-XXXXXXXX). Server-derived from authenticated session. */
    lifeFlowId:  { type: String, required: true, index: true },
    category: {
      type: String,
      enum: ['food', 'transport', 'shopping', 'bills', 'entertainment', 'education', 'health', 'subscriptions', 'other'],
      required: true,
    },
    amountMinor: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'Must be integer paise' },
    },
    currency:    { type: String, default: 'INR', maxlength: 5 },
    month:       { type: String, required: true }, // YYYY-MM
    status: {
      type: String,
      enum: ['active', 'paused'],
      default: 'active',
    },
  },
  { timestamps: true }
)

// One budget per category per month per user
BudgetSchema.index({ userId: 1, category: 1, month: 1 }, { unique: true })
BudgetSchema.index({ userId: 1, month: 1 })

const Budget: Model<IBudget> =
  mongoose.models.Budget || mongoose.model<IBudget>('Budget', BudgetSchema)

export default Budget
