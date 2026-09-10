import mongoose, { Document, Model, Schema } from 'mongoose'

export interface ISavingsGoal extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  title: string
  /** Target amount in minor currency units (paise for INR). */
  targetAmountMinor: number
  currency: string
  icon?: string
  color?: string
  targetDate?: string  // YYYY-MM-DD
  notes?: string
  createdAt: Date
  updatedAt: Date
}

const SavingsGoalSchema = new Schema<ISavingsGoal>(
  {
    userId:            { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title:             { type: String, required: true, trim: true, maxlength: 200 },
    targetAmountMinor: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'Must be integer paise' },
    },
    currency:  { type: String, default: 'INR', maxlength: 5 },
    icon:      { type: String, maxlength: 10, default: '🎯' },
    color:     { type: String, maxlength: 7, default: '#3b82f6' },
    targetDate: { type: String },
    notes:     { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
)

SavingsGoalSchema.index({ userId: 1, createdAt: -1 })

const SavingsGoal: Model<ISavingsGoal> =
  mongoose.models.SavingsGoal || mongoose.model<ISavingsGoal>('SavingsGoal', SavingsGoalSchema)

export default SavingsGoal
