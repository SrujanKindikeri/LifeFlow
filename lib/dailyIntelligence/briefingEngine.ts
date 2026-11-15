/**
 * lib/dailyIntelligence/briefingEngine.ts
 *
 * Orchestrates all Daily Intelligence sub-services for a single user.
 *
 * RESPONSIBILITIES
 * ────────────────
 * 1. Fetch all necessary data from MongoDB (one parallel Promise.all).
 * 2. Call detectOverdue(), detectConflicts(), buildFinancialAlerts(),
 *    buildTomorrowPriorities() with real data.
 * 3. Build the IBriefingContent struct.
 * 4. Persist the result to DailyBriefing (upsert by userId+forDate+type).
 * 5. Return the persisted document.
 *
 * PRIVACY
 * ───────
 * All queries include userId so users never see each other's data.
 * No data leaves the server; no external AI provider is called.
 *
 * RATE LIMITING (manual refresh)
 * ───────────────────────────────
 * The API route enforces a minimum 5-minute gap between user-triggered
 * regenerations. The engine itself does not enforce this — the Route Handler
 * does, so scheduler-triggered runs are unrestricted.
 */

import { connectDB } from '@/lib/db'
import mongoose from 'mongoose'
import Task from '@/models/Task'
import Habit from '@/models/Habit'
import HabitLog from '@/models/HabitLog'
import Project from '@/models/Project'
import Goal from '@/models/Goal'
import Expense from '@/models/Expense'
import Budget from '@/models/Budget'
import Subscription from '@/models/Subscription'
import MoneyRecord from '@/models/MoneyRecord'
import MoneyPayment from '@/models/MoneyPayment'
import DailyBriefingModel, { type IBriefingContent, type BriefingType } from '@/models/DailyBriefing'
import {
  detectOverdue,
  getLocalDateAndHour,
  type OverdueTask,
  type OverdueProject,
  type OverdueGoal,
  type OverdueMoneyRecord,
} from './overdueDetector'
import { detectConflicts, type ConflictTask } from './conflictDetector'
import { buildFinancialAlerts } from './financialIntelligence'
import { buildTomorrowPriorities } from './tomorrowPriorities'
import type { IDailyBriefing } from '@/models/DailyBriefing'
import logger from '@/lib/logger'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BriefingEngineOptions {
  userId: string
  lifeFlowId: string
  timezone: string
  type: BriefingType
  includeFinancial?: boolean
  now?: Date  // injectable for tests
}

export interface BriefingEngineResult {
  briefing: IDailyBriefing
  /** Was this briefing loaded from an existing document (true) or freshly generated (false)? */
  cached: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().split('T')[0]
}

function currentMonth(today: string): string {
  return today.slice(0, 7) // YYYY-MM
}

/**
 * Build a human-readable suggested plan from the briefing data.
 * This is deterministic — no AI. We pick the most important items and
 * format them as bullet-point suggestions.
 */
function buildSuggestedPlan(
  type: BriefingType,
  today: string,
  localHour: number,
  overdueTasks: OverdueTask[],
  todayTaskTitles: string[],
  incompleteHabitNames: string[],
  upcomingProjectTitles: string[],
  financialAlertTitles: string[]
): string[] {
  const plan: string[] = []

  if (type === 'morning') {
    plan.push('Start your day by reviewing today\'s task list.')

    if (overdueTasks.length > 0) {
      plan.push(
        `Address the ${overdueTasks.length} overdue item${overdueTasks.length > 1 ? 's' : ''} before taking on new work.`
      )
    }

    const highPriorityToday = todayTaskTitles.slice(0, 3)
    if (highPriorityToday.length > 0) {
      plan.push(`Focus on: ${highPriorityToday.join(', ')}.`)
    }

    if (incompleteHabitNames.length > 0) {
      plan.push(`Complete your habits: ${incompleteHabitNames.slice(0, 3).join(', ')}.`)
    }

    if (upcomingProjectTitles.length > 0) {
      plan.push(`Make progress on: ${upcomingProjectTitles[0]}.`)
    }

    if (financialAlertTitles.length > 0) {
      plan.push(`Financial: ${financialAlertTitles[0]}.`)
    }

    plan.push('End of day: review what you completed and plan tomorrow.')
  } else {
    // evening
    if (overdueTasks.length > 0) {
      plan.push(
        `${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''} remain — carry them forward to tomorrow.`
      )
    }

    if (todayTaskTitles.length > 0) {
      plan.push(
        `${todayTaskTitles.length} task${todayTaskTitles.length > 1 ? 's' : ''} still open today — complete what you can tonight.`
      )
    }

    if (incompleteHabitNames.length > 0) {
      const remaining = 24 - localHour
      if (remaining > 1) {
        plan.push(
          `You still have time to complete: ${incompleteHabitNames.slice(0, 2).join(', ')}.`
        )
      }
    }

    plan.push('Plan tomorrow\'s top 3 priorities before you close out.')
  }

  return plan
}

// ─── Main engine function ─────────────────────────────────────────────────────

export async function generateBriefing(
  opts: BriefingEngineOptions
): Promise<BriefingEngineResult> {
  const {
    userId,
    lifeFlowId,
    timezone,
    type,
    includeFinancial = true,
    now = new Date(),
  } = opts

  const t0 = Date.now()

  await connectDB()

  const { today, localHour, localTime } = getLocalDateAndHour(now, timezone)
  const tomorrow = addDays(today, 1)
  const in7Days  = addDays(today, 7)
  const month    = currentMonth(today)

  // ── Parallel DB fetch ──────────────────────────────────────────────────────
  // All queries filter by userId. We fetch bounded slices to avoid loading
  // every record into memory.

  const userObjectId = new mongoose.Types.ObjectId(userId)

  const [
    allTasks,
    allHabits,
    todayHabitLogs,
    recentHabitLogs,
    activeProjects,
    activeGoals,
    monthExpenses,
    currentMonthBudgets,
    activeSubscriptions,
    moneyRecords,
    moneyPayments,
  ] = await Promise.all([
    // Tasks: incomplete + recent completions for context. Bounded at 200.
    Task.find({ userId: userObjectId, completed: false })
        .sort({ dueDate: 1, priority: -1 })
        .limit(200)
        .lean(),

    // All habits (typically < 50)
    Habit.find({ userId: userObjectId }).lean(),

    // Today's habit logs
    HabitLog.find({ userId: userObjectId, date: today }).lean(),

    // Last 14 days of habit logs for trend detection
    HabitLog.find({ userId: userObjectId, date: { $gte: addDays(today, -14) } }).lean(),

    // Active + on_hold projects, limit 50
    Project.find({ userId: userObjectId, status: { $in: ['active', 'on_hold'] } })
           .sort({ dueDate: 1 })
           .limit(50)
           .lean(),

    // Active goals, limit 50
    Goal.find({ userId: userObjectId, status: 'active' })
        .sort({ targetDate: 1 })
        .limit(50)
        .lean(),

    // This month's personal expenses for budget calculations, limit 500
    Expense.find({ userId: userObjectId, source: 'personal', date: { $gte: `${month}-01` } })
           .limit(500)
           .lean(),

    // Current month budgets
    Budget.find({ userId: userObjectId, month }).lean(),

    // Active subscriptions with billing due in next 3 days
    Subscription.find({
      userId: userObjectId,
      status: 'active',
      nextBillingDate: { $lte: addDays(today, 3) },
    })
    .sort({ nextBillingDate: 1 })
    .lean(),

    // Money records with due dates (pending or overdue), limit 30
    MoneyRecord.find({
      userId: userObjectId,
      status: { $in: ['pending', 'partially_paid', 'overdue'] },
      dueDate: { $exists: true },
    })
    .sort({ dueDate: 1 })
    .limit(30)
    .lean(),

    // Payment records for money records above
    MoneyPayment.find({ userId: userObjectId })
                .select('recordId amountMinor')
                .limit(300)
                .lean(),
  ])

  // ── Build project title map for task enrichment ────────────────────────────
  const projectTitleMap = new Map<string, string>()
  for (const p of activeProjects) {
    projectTitleMap.set(p._id.toString(), p.title)
  }

  // ── Overdue detection ──────────────────────────────────────────────────────
  const overdueResult = detectOverdue({
    now,
    timezone,
    tasks: allTasks as Parameters<typeof detectOverdue>[0]['tasks'],
    habits: allHabits as Parameters<typeof detectOverdue>[0]['habits'],
    habitLogs: recentHabitLogs as Parameters<typeof detectOverdue>[0]['habitLogs'],
    projects: activeProjects as Parameters<typeof detectOverdue>[0]['projects'],
    goals: activeGoals as Parameters<typeof detectOverdue>[0]['goals'],
    moneyRecords: moneyRecords as Parameters<typeof detectOverdue>[0]['moneyRecords'],
    moneyPayments: moneyPayments as Parameters<typeof detectOverdue>[0]['moneyPayments'],
    projectTitleMap,
  })

  // ── Today's tasks ──────────────────────────────────────────────────────────
  const todayTasks = allTasks
    .filter((t) => t.dueDate === today)
    .map((t) => ({
      _id: t._id.toString(),
      title: t.title,
      priority: t.priority as 'low' | 'medium' | 'high',
      dueDate: t.dueDate,
      dueTime: t.dueTime,
    }))

  // Top priorities for today (morning): high overdue → high today → medium today
  const topPriorities = [
    ...overdueResult.tasks.filter((t) => t.priority === 'high').slice(0, 2),
    ...todayTasks.filter((t) => t.priority === 'high').slice(0, 2),
    ...todayTasks.filter((t) => t.priority === 'medium').slice(0, 1),
  ]
    .filter((t, i, arr) => arr.findIndex((x) => x._id === t._id) === i) // dedupe
    .slice(0, 3)

  // ── Habits ─────────────────────────────────────────────────────────────────
  const completedTodayIds = new Set(
    todayHabitLogs.filter((l) => l.completed).map((l) => l.habitId.toString())
  )
  const todayHabits = allHabits.map((h) => ({
    _id: h._id.toString(),
    name: h.name,
    icon: h.icon,
    completedToday: completedTodayIds.has(h._id.toString()),
    frequency: h.frequency as 'daily' | 'weekly',
  }))

  // ── Conflict detection ─────────────────────────────────────────────────────
  const conflictTasks: ConflictTask[] = allTasks.map((t) => ({
    _id: t._id.toString(),
    title: t.title,
    dueDate: t.dueDate ?? '',
    dueTime: t.dueTime,
    priority: t.priority as 'low' | 'medium' | 'high',
    completed: t.completed,
  }))
  const conflicts = detectConflicts({ today, localTime, tasks: conflictTasks })

  // ── Financial alerts ───────────────────────────────────────────────────────
  const financialAlerts = buildFinancialAlerts({
    today,
    currentMonth: month,
    subscriptions: activeSubscriptions as Parameters<typeof buildFinancialAlerts>[0]['subscriptions'],
    budgets: currentMonthBudgets as Parameters<typeof buildFinancialAlerts>[0]['budgets'],
    monthExpenses: monthExpenses as Parameters<typeof buildFinancialAlerts>[0]['monthExpenses'],
    moneyRecords: moneyRecords as Parameters<typeof buildFinancialAlerts>[0]['moneyRecords'],
    moneyPayments: moneyPayments as Parameters<typeof buildFinancialAlerts>[0]['moneyPayments'],
    includeFinancial,
  })

  // ── Tomorrow priorities ────────────────────────────────────────────────────
  const tomorrowPriorities = buildTomorrowPriorities({
    today,
    tasks: allTasks as Parameters<typeof buildTomorrowPriorities>[0]['tasks'],
    habits: allHabits as Parameters<typeof buildTomorrowPriorities>[0]['habits'],
    habitLogs: recentHabitLogs as Parameters<typeof buildTomorrowPriorities>[0]['habitLogs'],
    projects: activeProjects as Parameters<typeof buildTomorrowPriorities>[0]['projects'],
    goals: activeGoals as Parameters<typeof buildTomorrowPriorities>[0]['goals'],
  })

  // ── Upcoming projects / goals ──────────────────────────────────────────────
  const upcomingProjects = activeProjects
    .filter((p) => p.dueDate && p.dueDate >= today && p.dueDate <= in7Days)
    .map((p) => ({
      _id: p._id.toString(),
      title: p.title,
      dueDate: p.dueDate,
      status: p.status,
    }))

  const upcomingGoals = activeGoals
    .filter((g) => g.targetDate && g.targetDate >= today && g.targetDate <= in7Days)
    .map((g) => ({
      _id: g._id.toString(),
      title: g.title,
      targetDate: g.targetDate,
      progress: g.targetValue > 0
        ? Math.min(100, Math.round((g.currentValue / g.targetValue) * 100))
        : 0,
    }))

  // ── Suggested plan ─────────────────────────────────────────────────────────
  const suggestedPlan = buildSuggestedPlan(
    type,
    today,
    localHour,
    overdueResult.tasks,
    todayTasks.map((t) => t.title),
    overdueResult.habitsAtRisk.map((h) => `${h.icon} ${h.name}`),
    upcomingProjects.map((p) => p.title),
    financialAlerts.map((a) => a.title)
  )

  // ── Assemble content ───────────────────────────────────────────────────────
  const content: IBriefingContent = {
    topPriorities,
    todayTasks,
    overdueTasks: overdueResult.tasks,
    todayHabits,
    habitsAtRisk: overdueResult.habitsAtRisk,
    upcomingProjects,
    overdueProjects: overdueResult.projects,
    upcomingGoals,
    overdueGoals: overdueResult.goals,
    conflicts,
    financialAlerts,
    overdueMoneyRecords: overdueResult.moneyRecords,
    tomorrowPriorities,
    suggestedPlan,
  }

  // ── Determine hasContent ───────────────────────────────────────────────────
  // Evening: content exists if there are incomplete tasks/habits or overdue items.
  // Morning: content exists if there is anything to do today.
  const hasContent = type === 'evening'
    ? (
        overdueResult.tasks.length > 0 ||
        todayTasks.length > 0 ||
        overdueResult.habitsAtRisk.length > 0 ||
        overdueResult.projects.length > 0 ||
        financialAlerts.length > 0
      )
    : (
        todayTasks.length > 0 ||
        overdueResult.tasks.length > 0 ||
        todayHabits.length > 0 ||
        upcomingProjects.length > 0 ||
        financialAlerts.length > 0
      )

  // ── Persist (upsert) ───────────────────────────────────────────────────────
  const dataSources = {
    tasks:         true,
    habits:        true,
    projects:      true,
    goals:         true,
    expenses:      true,
    subscriptions: true,
    moneyRecords:  true,
  }

  const generationMs = Date.now() - t0

  try {
    const briefing = await DailyBriefingModel.findOneAndUpdate(
      { userId: userObjectId, forDate: today, type },
      {
        $set: {
          lifeFlowId,
          generatedAt: now,
          hasContent,
          content,
          dataSources,
          generationMs,
        },
      },
      { upsert: true, returnDocument: 'after', runValidators: false }
    )

    return { briefing: briefing!, cached: false }
  } catch (err) {
    logger.error('[briefingEngine] Failed to persist briefing', {
      userId,
      forDate: today,
      type,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

/**
 * Fetch the most recent persisted briefing for a user (no regeneration).
 * Used by the GET /api/daily-intelligence endpoint.
 */
export async function getLatestBriefing(
  userId: string,
  type: BriefingType,
  today: string
): Promise<IDailyBriefing | null> {
  await connectDB()
  return DailyBriefingModel.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    forDate: today,
    type,
  })
  .sort({ generatedAt: -1 })
  .lean()
}
