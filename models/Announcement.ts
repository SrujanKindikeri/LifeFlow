/**
 * models/Announcement.ts — System-wide announcements shown to users.
 *
 * Announcements are created by administrators and displayed in the user
 * application (e.g. a banner on the dashboard).  They can be published
 * immediately or scheduled for a future date, and they expire automatically.
 */

import mongoose, { Document, Model, Schema } from 'mongoose'

export type AnnouncementStatus = 'draft' | 'published' | 'expired' | 'scheduled'
export type AnnouncementType   = 'info' | 'warning' | 'success' | 'maintenance'

export interface IAnnouncement extends Document {
  _id: mongoose.Types.ObjectId
  /** Short headline shown in the banner */
  title: string
  /** Full announcement body — plain text, no HTML */
  body: string
  /** Visual style of the banner */
  type: AnnouncementType
  /** Lifecycle status */
  status: AnnouncementStatus
  /** UTC datetime when the announcement should become visible. null = publish immediately */
  scheduledAt: Date | null
  /** UTC datetime when the announcement should stop being shown. null = never expires */
  expiresAt: Date | null
  /** Admin ID of the creator */
  createdBy: string
  /** Admin name at creation time */
  createdByName: string
  createdAt: Date
  updatedAt: Date
}

const AnnouncementSchema = new Schema<IAnnouncement>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    type: {
      type: String,
      enum: ['info', 'warning', 'success', 'maintenance'],
      default: 'info',
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'expired', 'scheduled'],
      default: 'draft',
      index: true,
    },
    scheduledAt: { type: Date, default: null },
    expiresAt:   { type: Date, default: null, index: true },
    createdBy:     { type: String, required: true },
    createdByName: { type: String, required: true },
  },
  {
    timestamps: true,
    collection: 'announcements',
  }
)

AnnouncementSchema.index({ status: 1, expiresAt: 1 })

const Announcement: Model<IAnnouncement> =
  mongoose.models.Announcement ||
  mongoose.model<IAnnouncement>('Announcement', AnnouncementSchema)

export default Announcement
