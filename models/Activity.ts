/**
 * Activity Timeline — records meaningful user actions.
 *
 * Distinct from the legacy RecentActivity model which only covers 5 entity
 * types and 4 action verbs. This model supports every feature in LifeFlow
 * and is the source of truth for the Activity Timeline page.
 *
 * Writes are intentional: only significant user-initiated events are recorded.
 * Never write an Activity entry for read-only UI interactions.
 */

import mongoose, { Document, Model, Schema } from 'mongoose'

export type ActivityType =
  | 'task_created'
  | 'task_completed'
  | 'task_deleted'
  | 'note_created'
  | 'note_updated'
  | 'habit_completed'
  | 'expense_added'
  | 'group_bill_created'
  | 'group_bill_settled'
  | 'money_given'
  | 'money_borrowed'
  | 'money_amount_added'
  | 'payment_received'
  | 'payment_made'
  | 'goal_created'
  | 'goal_completed'
  | 'goal_updated'
  | 'project_created'
  | 'project_completed'
  | 'savings_contributed'
  | 'subscription_added'

export interface IActivity extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  /** Owner's LifeFlow ID (LF-XXXXXXXX). Sourced from User.publicId at creation. */
  lifeFlowId: string
  type: ActivityType
  /** ID of the related entity (Task, Note, Goal, etc.) */
  referenceId?: mongoose.Types.ObjectId
  /** Human-readable title shown in the timeline */
  title: string
  /** Optional extra info — amounts, categories, etc. */
  metadata?: Record<string, unknown>
  createdAt: Date
}

const ActivitySchema = new Schema<IActivity>(
  {
    userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Owner's LifeFlow ID (LF-XXXXXXXX). Server-derived from authenticated session. */
    lifeFlowId:  { type: String, required: true, index: true },
    type: {
      type: String,
      enum: [
        'task_created', 'task_completed', 'task_deleted',
        'note_created', 'note_updated',
        'habit_completed',
        'expense_added',
        'group_bill_created', 'group_bill_settled',
        'money_given', 'money_borrowed', 'money_amount_added',
        'payment_received', 'payment_made',
        'goal_created', 'goal_completed', 'goal_updated',
        'project_created', 'project_completed',
        'savings_contributed',
        'subscription_added',
      ],
      required: true,
    },
    referenceId: { type: Schema.Types.ObjectId },
    title:       { type: String, required: true, trim: true, maxlength: 300 },
    metadata:    { type: Schema.Types.Mixed },
  },
  {
    // Only createdAt — activities are immutable
    timestamps: { createdAt: true, updatedAt: false },
  }
)

ActivitySchema.index({ userId: 1, createdAt: -1 })
ActivitySchema.index({ userId: 1, type: 1, createdAt: -1 })

const Activity: Model<IActivity> =
  mongoose.models.Activity || mongoose.model<IActivity>('Activity', ActivitySchema)

export default Activity
