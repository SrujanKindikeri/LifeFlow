import mongoose, { Document, Model, Schema } from 'mongoose'

export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived'

export interface IProject extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  title: string
  description?: string
  status: ProjectStatus
  dueDate?: string   // YYYY-MM-DD
  color?: string     // hex colour for visual differentiation
  createdAt: Date
  updatedAt: Date
}

const ProjectSchema = new Schema<IProject>(
  {
    userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title:       { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 2000 },
    status: {
      type: String,
      enum: ['active', 'on_hold', 'completed', 'archived'],
      default: 'active',
    },
    dueDate: { type: String },
    color:   { type: String, maxlength: 7, default: '#3b82f6' },
  },
  { timestamps: true }
)

ProjectSchema.index({ userId: 1, status: 1 })
ProjectSchema.index({ userId: 1, dueDate: 1 })
ProjectSchema.index({ userId: 1, createdAt: -1 })

const Project: Model<IProject> =
  mongoose.models.Project || mongoose.model<IProject>('Project', ProjectSchema)

export default Project
