import mongoose, { Document, Model, Schema } from 'mongoose'

export interface IHabitLog extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  /** Owner's LifeFlow ID (LF-XXXXXXXX). Sourced from User.publicId at creation. */
  lifeFlowId: string
  habitId: mongoose.Types.ObjectId
  date: string // ISO date string YYYY-MM-DD
  completed: boolean
  /** Monotonically-increasing revision counter — incremented on every sync write. */
  serverRevision: number
  /** MutationId of the last accepted sync mutation — used as an idempotency key. */
  lastMutationId?: string
  createdAt: Date
  updatedAt: Date
}

const HabitLogSchema = new Schema<IHabitLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Owner's LifeFlow ID (LF-XXXXXXXX). Server-derived from authenticated session. */
    lifeFlowId: { type: String, required: true, index: true },
    habitId: { type: Schema.Types.ObjectId, ref: 'Habit', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    completed: { type: Boolean, default: true },
    serverRevision: { type: Number, default: 0 },
    lastMutationId: { type: String, sparse: true },
  },
  { timestamps: true }
)

// Each habit can only have one log per date
HabitLogSchema.index({ userId: 1, habitId: 1, date: 1 }, { unique: true })
HabitLogSchema.index({ userId: 1, date: 1 })

const HabitLog: Model<IHabitLog> =
  mongoose.models.HabitLog || mongoose.model<IHabitLog>('HabitLog', HabitLogSchema)

export default HabitLog
