/**
 * models/DailyBriefing.ts
 *
 * Persisted Daily Intelligence briefing document.
 *
 * PURPOSE
 * ───────
 * Stores the generated briefing for each user per day (morning / evening).
 * Enables:
 *   • In-app briefing history (no re-generation needed)
 *   • Stale-data detection (show when briefing was last generated)
 *   • Data source audit (which collections were checked)
 *   • Scheduled email idempotency (cross-reference with NotificationLog)
 *
 * IDEMPOTENCY
 * ───────────
 * Unique index on { userId, forDate, type } — one morning and one evening
 * briefing per user per calendar date.
 * The briefing engine upserts on this key so re-runs overwrite rather than
 * duplicate.
 *
 * TTL
 * ───
 * A 90-day TTL on generatedAt auto-expires old briefings to keep the
 * collection small.
 */

import mongoose, { Document, Model, Schema } from 'mongoose'
import type { OverdueTask, AtRiskHabit, OverdueProject, OverdueGoal, OverdueMoneyRecord } from '@/lib/dailyIntelligence/overdueDetector'
import type { ScheduleConflict } from '@/lib/dailyIntelligence/conflictDetector'
import type { FinancialAlert } from '@/lib/dailyIntelligence/financialIntelligence'
import type { TomorrowPriority } from '@/lib/dailyIntelligence/tomorrowPriorities'

export type BriefingType = 'morning' | 'evening'

export interface IBriefingTask {
  _id: string
  title: string
  priority: 'low' | 'medium' | 'high'
  dueDate?: string
  dueTime?: string
}

export interface IBriefingHabit {
  _id: string
  name: string
  icon: string
  completedToday: boolean
  frequency: 'daily' | 'weekly'
}

export interface IBriefingProject {
  _id: string
  title: string
  dueDate?: string
  status: string
}

export interface IBriefingGoal {
  _id: string
  title: string
  targetDate?: string
  progress: number  // 0–100
}

/** The full structured content of a briefing. */
export interface IBriefingContent {
  /** Top 3 priorities for today (morning) or carry-forward (evening) */
  topPriorities: IBriefingTask[]
  /** Tasks due today that are not yet complete */
  todayTasks: IBriefingTask[]
  /** Overdue tasks */
  overdueTasks: OverdueTask[]
  /** Habits due today with completion state */
  todayHabits: IBriefingHabit[]
  /** Habits at risk of being missed */
  habitsAtRisk: AtRiskHabit[]
  /** Project deadlines approaching within 7 days */
  upcomingProjects: IBriefingProject[]
  overdueProjects: OverdueProject[]
  /** Goal deadlines approaching within 7 days */
  upcomingGoals: IBriefingGoal[]
  overdueGoals: OverdueGoal[]
  /** Detected schedule conflicts */
  conflicts: ScheduleConflict[]
  /** Financial alerts (subscriptions, budgets, money records) */
  financialAlerts: FinancialAlert[]
  /** Overdue money records */
  overdueMoneyRecords: OverdueMoneyRecord[]
  /** Tomorrow's top 3 priorities */
  tomorrowPriorities: TomorrowPriority[]
  /** Human-readable suggested plan (generated from data, not AI) */
  suggestedPlan: string[]
}

export interface IDailyBriefing extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  /** Owner's LifeFlow ID (LF-XXXXXXXX) */
  lifeFlowId: string
  /** 'morning' | 'evening' */
  type: BriefingType
  /** YYYY-MM-DD in the user's timezone */
  forDate: string
  /** UTC timestamp when this briefing was generated */
  generatedAt: Date
  /** Whether this briefing has useful content (false = nothing to show/send) */
  hasContent: boolean
  /** Structured briefing content */
  content: IBriefingContent
  /** Which data sources were successfully queried */
  dataSources: {
    tasks: boolean
    habits: boolean
    projects: boolean
    goals: boolean
    expenses: boolean
    subscriptions: boolean
    moneyRecords: boolean
  }
  /** Milliseconds taken to generate this briefing */
  generationMs: number
  createdAt: Date
  updatedAt: Date
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const BriefingTaskSchema = new Schema(
  { _id: String, title: String, priority: String, dueDate: String, dueTime: String },
  { _id: false }
)

const BriefingHabitSchema = new Schema(
  { _id: String, name: String, icon: String, completedToday: Boolean, frequency: String },
  { _id: false }
)

const BriefingProjectSchema = new Schema(
  { _id: String, title: String, dueDate: String, status: String },
  { _id: false }
)

const BriefingGoalSchema = new Schema(
  { _id: String, title: String, targetDate: String, progress: Number },
  { _id: false }
)

// For complex nested types (conflicts, financialAlerts, etc.) we use Mixed
// since they have varying shapes. The application layer (TypeScript) enforces
// their structure.
const BriefingContentSchema = new Schema(
  {
    topPriorities:       { type: [BriefingTaskSchema],    default: [] },
    todayTasks:          { type: [BriefingTaskSchema],    default: [] },
    overdueTasks:        { type: Schema.Types.Mixed,      default: [] },
    todayHabits:         { type: [BriefingHabitSchema],   default: [] },
    habitsAtRisk:        { type: Schema.Types.Mixed,      default: [] },
    upcomingProjects:    { type: [BriefingProjectSchema], default: [] },
    overdueProjects:     { type: Schema.Types.Mixed,      default: [] },
    upcomingGoals:       { type: [BriefingGoalSchema],    default: [] },
    overdueGoals:        { type: Schema.Types.Mixed,      default: [] },
    conflicts:           { type: Schema.Types.Mixed,      default: [] },
    financialAlerts:     { type: Schema.Types.Mixed,      default: [] },
    overdueMoneyRecords: { type: Schema.Types.Mixed,      default: [] },
    tomorrowPriorities:  { type: Schema.Types.Mixed,      default: [] },
    suggestedPlan:       { type: [String],                default: [] },
  },
  { _id: false }
)

// ─── Main schema ──────────────────────────────────────────────────────────────

const DailyBriefingSchema = new Schema<IDailyBriefing>(
  {
    userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    lifeFlowId:  { type: String, required: true, index: true },
    type:        { type: String, enum: ['morning', 'evening'], required: true },
    forDate:     { type: String, required: true },
    generatedAt: { type: Date, required: true, index: true },
    hasContent:  { type: Boolean, default: false },
    content:     { type: BriefingContentSchema, default: () => ({}) },
    dataSources: {
      tasks:         { type: Boolean, default: false },
      habits:        { type: Boolean, default: false },
      projects:      { type: Boolean, default: false },
      goals:         { type: Boolean, default: false },
      expenses:      { type: Boolean, default: false },
      subscriptions: { type: Boolean, default: false },
      moneyRecords:  { type: Boolean, default: false },
    },
    generationMs: { type: Number, default: 0 },
  },
  { timestamps: true }
)

// One morning + one evening briefing per user per date
DailyBriefingSchema.index({ userId: 1, forDate: 1, type: 1 }, { unique: true })

// History queries: most recent first per user
DailyBriefingSchema.index({ userId: 1, generatedAt: -1 })

// TTL: auto-expire after 90 days
DailyBriefingSchema.index({ generatedAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 })

const DailyBriefing: Model<IDailyBriefing> =
  mongoose.models.DailyBriefing ||
  mongoose.model<IDailyBriefing>('DailyBriefing', DailyBriefingSchema)

export default DailyBriefing
