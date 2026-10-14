import mongoose, { Document, Model, Schema } from 'mongoose'

export interface IHabit extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  /** Owner's LifeFlow ID (LF-XXXXXXXX). Sourced from User.publicId at creation. */
  lifeFlowId: string
  name: string
  icon: string
  description?: string
  frequency: 'daily' | 'weekly'
  target: number
  /** Monotonically-increasing revision counter — incremented on every sync write. */
  serverRevision: number
  /** MutationId of the last accepted sync mutation — used as an idempotency key. */
  lastMutationId?: string
  createdAt: Date
  updatedAt: Date
}

const HabitSchema = new Schema<IHabit>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Owner's LifeFlow ID (LF-XXXXXXXX). Server-derived from authenticated session. */
    lifeFlowId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    icon: { type: String, default: '⭐', maxlength: 10 },
    description: { type: String, trim: true, maxlength: 500 },
    frequency: { type: String, enum: ['daily', 'weekly'], default: 'daily' },
    target: { type: Number, default: 1, min: 1, max: 100 },
    serverRevision: { type: Number, default: 0 },
    lastMutationId: { type: String, index: true, sparse: true },
  },
  { timestamps: true }
)

HabitSchema.index({ userId: 1, createdAt: -1 })

const Habit: Model<IHabit> =
  mongoose.models.Habit || mongoose.model<IHabit>('Habit', HabitSchema)

export default Habit
