import mongoose, { Document, Model, Schema } from 'mongoose'

export type TaskPriority = 'low' | 'medium' | 'high'
export type TaskRecurring = 'none' | 'daily' | 'weekly' | 'monthly'

export interface ITask extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  title: string
  description?: string
  completed: boolean
  priority: TaskPriority
  dueDate?: string
  dueTime?: string
  recurring: TaskRecurring
  /** Optional project association */
  projectId?: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const TaskSchema = new Schema<ITask>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000 },
    completed: { type: Boolean, default: false },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    dueDate: { type: String },
    dueTime: { type: String },
    recurring: {
      type: String,
      enum: ['none', 'daily', 'weekly', 'monthly'],
      default: 'none',
    },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
  },
  { timestamps: true }
)

TaskSchema.index({ userId: 1, dueDate: 1 })
TaskSchema.index({ userId: 1, completed: 1 })
TaskSchema.index({ userId: 1, projectId: 1 })

const Task: Model<ITask> =
  mongoose.models.Task || mongoose.model<ITask>('Task', TaskSchema)

export default Task
