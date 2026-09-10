import mongoose, { Document, Model, Schema } from 'mongoose'

export type ActivityType = 'note' | 'task' | 'habit' | 'expense' | 'groupBill'
export type ActivityAction = 'created' | 'updated' | 'opened' | 'completed'

export interface IRecentActivity extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  type: ActivityType
  entityId: mongoose.Types.ObjectId
  entityTitle: string
  action: ActivityAction
  timestamp: Date
}

const RecentActivitySchema = new Schema<IRecentActivity>({
  userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type:        { type: String, enum: ['note', 'task', 'habit', 'expense', 'groupBill'], required: true },
  entityId:    { type: Schema.Types.ObjectId, required: true },
  entityTitle: { type: String, required: true, trim: true, maxlength: 200 },
  action:      { type: String, enum: ['created', 'updated', 'opened', 'completed'], required: true },
  timestamp:   { type: Date, default: Date.now },
})

// Only keep the 50 most recent activities per user (TTL via sparse capped approach)
RecentActivitySchema.index({ userId: 1, timestamp: -1 })
// Prevent duplicate records for the same entity+action within the same minute
RecentActivitySchema.index({ userId: 1, entityId: 1, action: 1, timestamp: 1 })

const RecentActivity: Model<IRecentActivity> =
  mongoose.models.RecentActivity ||
  mongoose.model<IRecentActivity>('RecentActivity', RecentActivitySchema)

export default RecentActivity
