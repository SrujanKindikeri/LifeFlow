/**
 * models/AnalyticsEvent.ts
 *
 * Records one section-view event per user, per section, per hour bucket.
 * The unique index on `key` enables server-side deduplication — duplicate
 * inserts are silently caught as E11000 errors in the track route.
 *
 * Used by:
 *   POST /api/analytics/track          — writes events (via useSectionView hook)
 *   GET  /api/admin/intelligence/overview — aggregates DAU/WAU/MAU and top sections
 */

import mongoose, { Schema, Model } from 'mongoose'

export const TRACKED_SECTIONS = [
  'dashboard',
  'notes',
  'tasks',
  'habits',
  'expenses',
  'budgets',
  'goals',
  'savings',
  'subscriptions',
  'projects',
  'people',
  'calendar',
  'analytics',
  'notifications',
  'money',
  'drafts',
  'daily-intelligence',
  'weekly-planning',
  'financial-review',
  'activity',
  'focus',
  'invitations',
  'profile',
  'settings',
] as const

export type TrackedSection = (typeof TRACKED_SECTIONS)[number]

interface IAnalyticsEvent {
  userId:     mongoose.Types.ObjectId
  section:    TrackedSection
  dateString: string   // "YYYY-MM-DD"
  hour:       number   // 0–23 (UTC)
  key:        string   // dedup key: `userId:section:dateString:hour`
  createdAt:  Date
  updatedAt:  Date
}

const AnalyticsEventSchema = new Schema<IAnalyticsEvent>(
  {
    userId:     { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
    section:    { type: String, required: true, enum: TRACKED_SECTIONS },
    dateString: { type: String, required: true, index: true },
    hour:       { type: Number, required: true, min: 0, max: 23 },
    // Unique compound deduplication key: one record per user+section+date+hour.
    // E11000 on duplicate insert is intentional and silently caught in the route.
    key:        { type: String, required: true, unique: true },
  },
  { timestamps: true },
)

const AnalyticsEvent: Model<IAnalyticsEvent> =
  (mongoose.models.AnalyticsEvent as Model<IAnalyticsEvent>) ||
  mongoose.model<IAnalyticsEvent>('AnalyticsEvent', AnalyticsEventSchema)

export default AnalyticsEvent
