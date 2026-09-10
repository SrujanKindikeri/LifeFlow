import mongoose, { Document, Model, Schema } from 'mongoose'

export interface ISavingsContribution extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  savingsGoalId: mongoose.Types.ObjectId
  /** Contribution amount in minor currency units (paise for INR). Must be > 0. */
  amountMinor: number
  date: string   // YYYY-MM-DD
  note?: string
  createdAt: Date
  updatedAt: Date
}

const SavingsContributionSchema = new Schema<ISavingsContribution>(
  {
    userId:        { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    savingsGoalId: { type: Schema.Types.ObjectId, ref: 'SavingsGoal', required: true, index: true },
    amountMinor: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'Must be integer paise' },
    },
    date: { type: String, required: true },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
)

SavingsContributionSchema.index({ userId: 1, savingsGoalId: 1, date: -1 })
SavingsContributionSchema.index({ userId: 1, date: -1 })

const SavingsContribution: Model<ISavingsContribution> =
  mongoose.models.SavingsContribution ||
  mongoose.model<ISavingsContribution>('SavingsContribution', SavingsContributionSchema)

export default SavingsContribution
