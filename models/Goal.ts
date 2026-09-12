import mongoose, { Document, Model, Schema } from 'mongoose'

export type GoalStatus = 'active' | 'completed' | 'archived'
export type GoalCategory =
  | 'health'
  | 'finance'
  | 'education'
  | 'career'
  | 'personal'
  | 'fitness'
  | 'creative'
  | 'other'

export interface IGoal extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  /** Owner's LifeFlow ID (LF-XXXXXXXX). Sourced from User.publicId at creation. */
  lifeFlowId: string
  projectId?: mongoose.Types.ObjectId // optional — null means standalone goal
  title: string
  description?: string
  category: GoalCategory
  targetValue: number
  currentValue: number
  unit: string
  startDate: string   // YYYY-MM-DD
  targetDate?: string // YYYY-MM-DD
  status: GoalStatus
  linkedTaskIds: mongoose.Types.ObjectId[]
  linkedHabitIds: mongoose.Types.ObjectId[]
  createdAt: Date
  updatedAt: Date
}

const GoalSchema = new Schema<IGoal>(
  {
    userId:         { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Owner's LifeFlow ID (LF-XXXXXXXX). Server-derived from authenticated session. */
    lifeFlowId:     { type: String, required: true, index: true },
    projectId:      { type: Schema.Types.ObjectId, ref: 'Project', index: true, default: null },
    title:          { type: String, required: true, trim: true, maxlength: 200 },
    description:    { type: String, trim: true, maxlength: 1000 },
    category: {
      type: String,
      enum: ['health', 'finance', 'education', 'career', 'personal', 'fitness', 'creative', 'other'],
      default: 'personal',
    },
    targetValue:    { type: Number, required: true, min: 0 },
    currentValue:   { type: Number, default: 0, min: 0 },
    unit:           { type: String, trim: true, maxlength: 50, default: 'units' },
    startDate:      { type: String, required: true },
    targetDate:     { type: String },
    status:         { type: String, enum: ['active', 'completed', 'archived'], default: 'active' },
    linkedTaskIds:  [{ type: Schema.Types.ObjectId, ref: 'Task' }],
    linkedHabitIds: [{ type: Schema.Types.ObjectId, ref: 'Habit' }],
  },
  { timestamps: true }
)

GoalSchema.index({ userId: 1, status: 1 })
GoalSchema.index({ userId: 1, projectId: 1 })
GoalSchema.index({ userId: 1, targetDate: 1 })
GoalSchema.index({ userId: 1, createdAt: -1 })

const Goal: Model<IGoal> =
  mongoose.models.Goal || mongoose.model<IGoal>('Goal', GoalSchema)

export default Goal
