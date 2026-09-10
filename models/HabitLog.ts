import mongoose, { Document, Model, Schema } from 'mongoose'

export interface IHabitLog extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  habitId: mongoose.Types.ObjectId
  date: string // ISO date string YYYY-MM-DD
  completed: boolean
  createdAt: Date
  updatedAt: Date
}

const HabitLogSchema = new Schema<IHabitLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    habitId: { type: Schema.Types.ObjectId, ref: 'Habit', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    completed: { type: Boolean, default: true },
  },
  { timestamps: true }
)

// Each habit can only have one log per date
HabitLogSchema.index({ userId: 1, habitId: 1, date: 1 }, { unique: true })
HabitLogSchema.index({ userId: 1, date: 1 })

const HabitLog: Model<IHabitLog> =
  mongoose.models.HabitLog || mongoose.model<IHabitLog>('HabitLog', HabitLogSchema)

export default HabitLog
