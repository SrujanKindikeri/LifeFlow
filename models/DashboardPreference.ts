import mongoose, { Document, Model, Schema } from 'mongoose'
import { DEFAULT_SECTIONS, type DashboardSectionId } from '@/lib/dashboardSections'

// Re-export for server-side callers that import from this module
export { DEFAULT_SECTIONS, type DashboardSectionId }

export interface IDashboardSection {
  id: DashboardSectionId
  visible: boolean
  order: number
}

export interface IDashboardPreference extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  /** Owner's LifeFlow ID (LF-XXXXXXXX). Sourced from User.publicId at creation. */
  lifeFlowId: string
  sections: IDashboardSection[]
  createdAt: Date
  updatedAt: Date
}

const DashboardSectionSchema = new Schema<IDashboardSection>(
  {
    id:      { type: String, required: true },
    visible: { type: Boolean, default: true },
    order:   { type: Number, required: true },
  },
  { _id: false }
)

const DashboardPreferenceSchema = new Schema<IDashboardPreference>(
  {
    userId:   { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    /** Owner's LifeFlow ID (LF-XXXXXXXX). Server-derived from authenticated session. */
    lifeFlowId: { type: String, required: true, index: true },
    sections: { type: [DashboardSectionSchema], default: DEFAULT_SECTIONS },
  },
  { timestamps: true }
)

// NOTE: The unique index on userId is already declared via `unique: true` in
// the field definition above. A second explicit .index() call for the same
// field causes Mongoose to register it twice, which produces a
// "duplicate schema index" warning at startup. The .index() call is removed.

const DashboardPreference: Model<IDashboardPreference> =
  mongoose.models.DashboardPreference ||
  mongoose.model<IDashboardPreference>('DashboardPreference', DashboardPreferenceSchema)

export default DashboardPreference
